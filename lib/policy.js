/**
 * dsh-skill-sidebar — 策略与分类（纯逻辑 + 小文件存储，无 cordis 依赖）。
 *
 * 这里实现三件事：
 *  1. **分类/标签**：把每个技能按「插件/家族」归入固定分类（`lib/categories.json`），
 *     新装技能自动归类并把结果落盘，可人工覆盖。
 *  2. **使用证据**：`usage`（真调用）与 `advertised`（曾进入新会话目录）两张表。
 *  3. **新会话加载清单**：resident（常驻 = 会写进新会话的技能目录）与
 *     indexed（索引 = 不进目录，靠侧栏/`skill_search` 按需发现）。
 *
 * 规则（用户 2026-10-12 定稿，本文件第 6 节）：
 *   默认只加载「30 天内使用过的技能」+「置顶（顶标）的技能」；
 *   30 天内被加载进目录却从未使用过的技能 → 退出新会话加载清单（转索引）。
 *
 * 「更好的方式」的两点补充（同样落在本文件，均可在配置里关掉）：
 *   · 新装技能有 GRACE_DAYS 天试用期：直接进常驻清单，避免「没用过 → 不列 → 永远用不上」的死锁；
 *   · 证据不足（usage/advertised 都为空）时整条策略**不生效**（degraded），只做统计，不动 DSH 行为。
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 使用窗口：30 天。 */
export const WINDOW_DAYS = 30
/** 新装技能试用期：7 天。 */
export const GRACE_DAYS = 7
/** 存储结构版本；不匹配时重建（只丢统计，不影响技能文件）。 */
export const STORE_VERSION = 1

const DAY_MS = 24 * 60 * 60 * 1000

/** DSH 技能名语法（与 @deepseek-ai/dsh-skill 的 SKILL_NAME 一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 一个字符串是否是可被 DSH 注册/加载的合法技能名。
 * 中文名、大写、下划线等都不合法 —— 这些技能只出现在侧栏，进不了模型目录。
 * @param name - 候选技能名。
 * @returns 是否合法。
 */
export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name)
}

/** 空存储。 */
export function emptyStore() {
  return {
    version: STORE_VERSION,
    updatedAt: null,
    /** 置顶（= 侧栏顶标 = 新会话常驻清单）技能名，按用户操作顺序。 */
    pins: [],
    /** 人工强制常驻 / 强制索引（可空）。 */
    forcedResident: [],
    forcedIndexed: [],
    /** name -> { calls, sessions, firstUsedAt, lastUsedAt, lastSessionId }。 */
    usage: {},
    /** name -> 最后一次进入新会话技能目录的时间戳（ms）。 */
    advertised: {},
    /** name -> 首次发现时间戳（ms，取 SKILL.md 的 mtime）。 */
    firstSeen: {},
    /** name -> 分类 id（自动归类结果，可人工改）。 */
    categories: {},
    /** name -> 标签数组（自动派生，可人工改）。 */
    tags: {},
    /** 会话日志回填进度：绝对路径 -> { mtimeMs, size }。 */
    mined: {},
    minedAt: null,
  }
}

/** 读取时补齐缺失字段（老版本文件也能用）。 */
export function normalizeStore(raw) {
  const base = emptyStore()
  if (!raw || typeof raw !== 'object') return base
  const out = { ...base, ...raw }
  if (out.version !== STORE_VERSION) return base
  for (const key of ['pins', 'forcedResident', 'forcedIndexed']) {
    if (!Array.isArray(out[key])) out[key] = []
    out[key] = out[key].filter((n) => typeof n === 'string')
  }
  for (const key of ['usage', 'advertised', 'firstSeen', 'categories', 'tags', 'mined']) {
    if (!out[key] || typeof out[key] !== 'object' || Array.isArray(out[key])) out[key] = {}
  }
  return out
}

/** 读取存储文件（缺失/损坏 → 空存储）。 */
export async function loadStore(file) {
  try {
    return normalizeStore(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return emptyStore()
  }
}

/** 原子写存储文件（临时文件 + rename，避免半截 JSON）。 */
export async function saveStore(file, store) {
  const next = { ...normalizeStore(store), updatedAt: new Date().toISOString() }
  try {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 1), 'utf8')
    await rename(tmp, file)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 1. 分类表与自动归类                                                  */
/* ------------------------------------------------------------------ */

/** 内置兜底分类表（categories.json 缺失时也能跑）。 */
function builtinTable() {
  return {
    _meta: { version: 'builtin' },
    categories: [
      { id: 'search', name: '网页检索', icon: 'search', prefixes: ['firecrawl'], keywords: ['搜索', '抓取', '网页', '文献', 'scrape', 'crawl', 'search'] },
      { id: 'design', name: '界面设计', icon: 'palette', prefixes: ['ui-', 'design'], keywords: ['ui', 'ux', '界面', '设计', '样式', 'css'] },
      { id: 'media', name: '多媒体生成', icon: 'image', prefixes: ['photon-', 'zimage'], keywords: ['图片', '视频', '音频', '生图', '配音', 'image', 'video', 'audio'] },
      { id: 'wecom', name: '企业微信', icon: 'chat', prefixes: ['wecomcli'], keywords: ['企业微信', '企微'] },
      { id: 'dsh', name: 'DSH 运维', icon: 'terminal', prefixes: ['dsh-'], keywords: ['dsh', '插件', 'plugin', '会话', 'codex'] },
      { id: 'engineering', name: '软件开发', icon: 'code', prefixes: [], keywords: ['代码', '测试', '重构', 'code', 'test', 'api', '数据库'] },
      { id: 'agent', name: '智能体与模型', icon: 'sparkles', prefixes: [], keywords: ['agent', '智能体', 'llm', 'prompt', '提示词', 'rag'] },
      { id: 'local', name: '本机工具', icon: 'wrench', prefixes: [], keywords: ['本机', '本地', 'windows', '安装', '诊断'] },
    ],
    fallback: { id: 'misc', name: '其他', icon: 'folder' },
  }
}

/** 解析并规范化分类表（丢弃结构不对的行，保证 id 唯一）。 */
export function normalizeTable(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.categories)) return builtinTable()
  const seen = new Set()
  const categories = []
  for (const row of raw.categories) {
    if (!row || typeof row !== 'object') continue
    const id = typeof row.id === 'string' && row.id !== '' ? row.id : null
    const name = typeof row.name === 'string' && row.name !== '' ? row.name : null
    if (id === null || name === null || seen.has(id)) continue
    seen.add(id)
    categories.push({
      id,
      name,
      icon: typeof row.icon === 'string' ? row.icon : 'folder',
      prefixes: Array.isArray(row.prefixes) ? row.prefixes.filter((p) => typeof p === 'string' && p !== '').map((p) => p.toLowerCase()) : [],
      keywords: Array.isArray(row.keywords) ? row.keywords.filter((k) => typeof k === 'string' && k.trim() !== '').map((k) => k.toLowerCase()) : [],
      members: Array.isArray(row.members) ? row.members.filter((m) => typeof m === 'string') : [],
    })
  }
  const fallback = raw.fallback && typeof raw.fallback === 'object' && typeof raw.fallback.id === 'string'
    ? { id: raw.fallback.id, name: typeof raw.fallback.name === 'string' ? raw.fallback.name : '其他', icon: typeof raw.fallback.icon === 'string' ? raw.fallback.icon : 'folder' }
    : { id: 'misc', name: '其他', icon: 'folder' }
  return { _meta: raw._meta && typeof raw._meta === 'object' ? raw._meta : {}, categories, fallback }
}

/** 从随包 JSON 文本解析分类表。 */
export function parseTable(text) {
  try {
    return normalizeTable(JSON.parse(text))
  } catch {
    return builtinTable()
  }
}

/** 分类 id -> { id, name, icon }。 */
export function categoryIndex(table) {
  const map = new Map()
  for (const c of table.categories) map.set(c.id, { id: c.id, name: c.name, icon: c.icon })
  map.set(table.fallback.id, { id: table.fallback.id, name: table.fallback.name, icon: table.fallback.icon })
  return map
}

/**
 * 把一个技能归类。
 *
 * 优先级：人工覆盖（overrides）> frontmatter 的 `category` > 名字前缀家族 >
 * 名字词命中 > 名称/说明关键词打分 > 兜底分类。
 * @param skill - { name, description?, zh?, phrases?[], category?, tags?[] }。
 * @param table - normalizeTable() 的结果。
 * @param overrides - name -> category id（已落盘的人工/历史归类）。
 * @returns { id, name, icon, by, score }。
 */
export function classify(skill, table, overrides = {}) {
  const index = categoryIndex(table)
  const name = String(skill.name || '')
  const lower = name.toLowerCase()
  const forced = overrides[name]
  if (typeof forced === 'string' && index.has(forced)) return { ...index.get(forced), by: 'override', score: 1000 }
  // frontmatter 自带分类：先按 id/名称匹配，匹配不上就当成动态分类。
  const declared = typeof skill.category === 'string' ? skill.category.trim() : ''
  if (declared !== '') {
    const hit = table.categories.find((c) => c.id === declared || c.name === declared)
    if (hit) return { id: hit.id, name: hit.name, icon: hit.icon, by: 'frontmatter', score: 900 }
    return { id: `custom:${declared}`, name: declared, icon: 'tag', by: 'frontmatter', score: 900 }
  }
  const haystack = [skill.name, skill.description, skill.zh, (skill.phrases || []).join(' '), (skill.tags || []).join(' ')]
    .filter((v) => typeof v === 'string' && v !== '').join(' ').toLowerCase()
  let best = null
  for (const c of table.categories) {
    let score = 0
    for (const member of c.members) if (member.toLowerCase() === lower) score = Math.max(score, 1000)
    for (const p of c.prefixes) {
      if (lower === p || lower.startsWith(p.endsWith('-') ? p : `${p}-`) || lower.startsWith(`${p}-`)) {
        score = Math.max(score, 500 + p.length)
      }
    }
    for (const k of c.keywords) {
      if (k === '') continue
      if (lower === k || lower.includes(k)) score = Math.max(score, 200 + k.length)
      else if (haystack.includes(k)) score = Math.max(score, 40 + Math.min(k.length, 8))
    }
    if (score > 0 && (best === null || score > best.score)) best = { ...c, score }
  }
  if (best !== null) return { id: best.id, name: best.name, icon: best.icon, by: 'auto', score: best.score }
  return { ...index.get(table.fallback.id), by: 'fallback', score: 0 }
}

/** 技能「插件/家族」标签：取名字的第一个 '-' 前缀（firecrawl-* → firecrawl）。 */
export function familyOf(name) {
  const m = String(name).match(/^([a-z0-9]+)-/)
  return m ? m[1] : ''
}

/**
 * 派生一个技能的全部标签。
 *
 * 来源：技能自带 frontmatter `tags`（目前本机技能一个都没有，但将来会有）+
 * 名字家族 +（来源根不是 agents 时）来源根。
 * @param skill - { name, tags?, source? }（tags 可来自 frontmatter 的 tags/keywords）。
 * @returns 去重后的标签数组（小写，最多 6 个）。
 */
export function deriveTags(skill) {
  const out = []
  const push = (v) => {
    if (typeof v !== 'string') return
    const t = v.trim().toLowerCase()
    if (t === '' || out.includes(t)) return
    out.push(t)
  }
  for (const t of Array.isArray(skill.tags) ? skill.tags : []) push(t)
  push(familyOf(skill.name))
  if (skill.source && skill.source !== 'agents') push(skill.source)
  return out.slice(0, 6)
}

/* ------------------------------------------------------------------ */
/* 2. 新会话加载清单                                                    */
/* ------------------------------------------------------------------ */

/**
 * 计算新会话加载清单。
 *
 * @param skills - 扫描结果 [{ name, installMtime?, ... }]。
 * @param store - normalizeStore() 的结果。
 * @param now - 当前时间戳（ms），便于测试注入。
 * @param options - { windowDays?, graceDays?, mode? }。
 * @returns 见文件头；`active` 为 false 时调用方**不得**改变 DSH 行为。
 */
export function computePolicy(skills, store, now = Date.now(), options = {}) {
  const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : WINDOW_DAYS
  const graceDays = Number.isFinite(options.graceDays) ? options.graceDays : GRACE_DAYS
  const mode = options.mode === 'off' || options.mode === 'dry' ? options.mode : 'on'
  const win = windowDays * DAY_MS
  const grace = graceDays * DAY_MS
  const pins = new Set(store.pins)
  const forcedResident = new Set(store.forcedResident)
  const forcedIndexed = new Set(store.forcedIndexed)

  let callEvidence = 0
  for (const rec of Object.values(store.usage)) if (Number(rec?.calls) > 0) callEvidence += 1
  const advertisedEvidence = Object.keys(store.advertised).length
  const degraded = callEvidence === 0 && advertisedEvidence === 0

  const resident = []
  const indexed = []
  const detail = {}
  let pinnedCount = 0
  let usedCount = 0
  let graceCount = 0

  for (const skill of skills) {
    const name = skill.name
    if (!isSkillName(name)) {
      // 非法名（中文/大写等）本就不进模型目录，也不算进清单。
      detail[name] = { state: 'invalid', why: 'name-not-model-invocable', calls: 0 }
      continue
    }
    const rec = store.usage[name]
    const calls = Number(rec?.calls) || 0
    const lastUsedAt = Number(rec?.lastUsedAt) || 0
    const lastAdvertised = Number(store.advertised[name]) || 0
    const installMtime = Number(skill.installMtime) || Number(store.firstSeen[name]) || 0
    const fresh = installMtime > 0 && now - installMtime <= grace
    const recentlyUsed = calls > 0 && lastUsedAt > 0 && now - lastUsedAt <= win
    const recentlyAdvertised = lastAdvertised > 0 && now - lastAdvertised <= win

    let state = 'indexed'
    let why = 'unused'
    if (forcedIndexed.has(name)) {
      state = 'indexed'; why = 'forced-indexed'
    } else if (pins.has(name)) {
      state = 'resident'; why = 'pinned'; pinnedCount += 1
    } else if (forcedResident.has(name)) {
      state = 'resident'; why = 'forced-resident'; pinnedCount += 1
    } else if (recentlyUsed) {
      state = 'resident'; why = 'used'; usedCount += 1
    } else if (calls > 0) {
      state = 'indexed'; why = 'stale'            // 用过，但超出 30 天窗口
    } else if (recentlyAdvertised) {
      state = 'indexed'; why = 'advertised-unused' // 30 天内进过目录却从未被调用
    } else if (fresh) {
      state = 'resident'; why = 'new-grace'; graceCount += 1
    } else if (lastAdvertised > 0) {
      state = 'indexed'; why = 'advertised-expired'
    } else {
      state = 'indexed'; why = calls > 0 ? 'stale' : 'never-used'
    }
    if (!degraded && mode === 'on' && state === 'indexed') {
      // 只有真正生效时才把它从常驻清单里拿掉；degraded/dry 时全部保持常驻。
      indexed.push(name)
      detail[name] = { state: 'indexed', why, calls, lastUsedAt, lastAdvertised, installMtime }
    } else {
      resident.push(name)
      detail[name] = {
        state: 'resident',
        why: degraded ? 'no-evidence' : (mode !== 'on' ? `mode-${mode}` : why),
        calls, lastUsedAt, lastAdvertised, installMtime,
      }
    }
  }

  return {
    mode,
    /** 只有 active=true 才真正改写新会话目录。 */
    active: !degraded && mode === 'on',
    degraded,
    degradedReason: degraded ? '没有使用证据（usage 与 advertised 均为空）——策略只统计不生效' : null,
    windowDays,
    graceDays,
    generatedAt: now,
    resident,
    indexed,
    detail,
    stats: {
      total: skills.length,
      modelInvocable: resident.length + indexed.length,
      resident: resident.length,
      indexed: indexed.length,
      pinned: pinnedCount,
      used30: usedCount,
      newGrace: graceCount,
      evidence: { calledSkills: callEvidence, advertisedSkills: advertisedEvidence },
    },
  }
}

/** 记录一次技能使用（返回新存储；不改原对象）。 */
export function recordUse(store, name, at = Date.now(), sessionId = null) {
  if (typeof name !== 'string' || name === '') return store
  const usage = { ...store.usage }
  const prev = usage[name] || { calls: 0, sessions: 0, firstUsedAt: at, lastUsedAt: 0, lastSessionId: null }
  const sameSession = sessionId !== null && prev.lastSessionId === sessionId
  usage[name] = {
    calls: prev.calls + 1,
    sessions: prev.sessions + (sessionId !== null && !sameSession ? 1 : 0),
    firstUsedAt: prev.firstUsedAt || at,
    lastUsedAt: at,
    lastSessionId: sessionId !== null ? sessionId : prev.lastSessionId,
  }
  return { ...store, usage, updatedAt: new Date().toISOString() }
}

/** 记录「该技能进入过新会话目录」（返回新存储）。 */
export function recordAdvertised(store, names, at = Date.now()) {
  if (!Array.isArray(names) || names.length === 0) return store
  const advertised = { ...store.advertised }
  let changed = false
  for (const name of names) {
    if (typeof name !== 'string' || name === '') continue
    if ((advertised[name] || 0) >= at) continue
    advertised[name] = at
    changed = true
  }
  return changed ? { ...store, advertised, updatedAt: new Date().toISOString() } : store
}

/** 首次发现时间：只写一次（已存在则保留原值）。 */
export function recordFirstSeen(store, name, installMtime) {
  if (typeof name !== 'string' || name === '') return store
  if (store.firstSeen[name]) return store
  const at = Number(installMtime) > 0 ? Number(installMtime) : Date.now()
  return { ...store, firstSeen: { ...store.firstSeen, [name]: at } }
}

/**
 * 合并一次扫描的结果到存储：补齐 firstSeen / categories / tags。
 * @returns { store, changed, newly: [name] }（newly = 这次新发现的技能名）。
 */
export function mergeScan(store, skills, table) {
  let next = store
  const newly = []
  for (const skill of skills) {
    const name = skill.name
    if (typeof name !== 'string' || name === '') continue
    if (!next.firstSeen[name]) {
      next = recordFirstSeen(next, name, skill.installMtime)
      newly.push(name)
    }
    if (!next.categories[name]) {
      const c = classify(skill, table, {})
      next = { ...next, categories: { ...next.categories, [name]: c.id } }
    }
    if (!next.tags[name]) {
      next = { ...next, tags: { ...next.tags, [name]: deriveTags(skill) } }
    }
  }
  return { store: next, changed: next !== store, newly }
}

/** 供客户端使用的精简策略摘要。 */
export function policySummary(policy, categoriesOf = null) {
  return {
    mode: policy.mode,
    active: policy.active,
    degraded: policy.degraded,
    reason: policy.degradedReason,
    windowDays: policy.windowDays,
    graceDays: policy.graceDays,
    stats: policy.stats,
    resident: policy.resident,
    indexed: policy.indexed,
    categories: categoriesOf,
  }
}

/** 侧栏展示用：把 detail 压成 name -> 短语（为什么在/不在清单）。 */
export function whyLabel(why) {
  switch (why) {
    case 'pinned': return '顶标常驻'
    case 'forced-resident': return '手动常驻'
    case 'forced-indexed': return '手动转索引'
    case 'used': return '30 天内用过'
    case 'new-grace': return `新装试用期（${GRACE_DAYS} 天）`
    case 'stale': return '超 30 天未使用'
    case 'advertised-unused': return '30 天内加载过但未使用'
    case 'advertised-expired': return '加载过且已过期'
    case 'never-used': return '从未使用'
    case 'no-evidence': return '证据不足，策略未生效'
    default: return why.startsWith('mode-') ? `模式 ${why.slice(5)}：未生效` : why
  }
}

/** 默认存储路径（与扫描缓存同目录）。 */
export function policyFile(cacheDir) {
  return join(cacheDir, 'policy.json')
}
