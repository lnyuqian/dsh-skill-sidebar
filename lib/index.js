/**
 * dsh-skill-sidebar — host half.
 *
 * 这个文件负责四件事：
 *
 * **1. 扫描本机技能**（原行为）。扫 `~/.agents/skills`、`~/.codex/skills`、
 * `~/.claude/skills`、`~/.opencode/skills`（+ `$DSH_SKILL_DIRS`），从 YAML frontmatter
 * 读 `name` / `description` / `whenToUse` / `tags` / `category`，结果落盘到
 * `~/.dsh/storages/dsh-skill-sidebar/skills.json`，下次启动无须重读全部文件。
 * 刷新策略：启动复用缓存（>7 天或周一且非当日则重扫）、`fs.watch` 增量重扫（防抖）、
 * 5 分钟轮询兜底、周一 6 小时一次全量重读。
 *
 * **2. 分类与标签**（v0.4.0 新增）。按「插件/家族」把技能归入 `lib/categories.json`
 * 里的固定分类（firecrawl → 网页检索、wecomcli → 企业微信…）。**新装技能在扫描时
 * 自动归类**并写入 policy.json；可人工覆盖，覆盖后不再被自动改写。
 *
 * **3. 使用证据**（v0.4.0 新增）。两条来源：
 *   · 实时：`tools/execute` 事件里 `skill` 工具（或本插件的 `skill_search`）的调用；
 *   · 回填：启动后台扫最近 30 天的会话日志（多帧 zstd JSONL），挖出历史上的
 *     `skill` 调用与「曾进入新会话目录」的技能（`advertised`）。
 *
 * **4. 新会话加载清单**（v0.4.0 新增，可用 `DSH_SKILL_POLICY=off|dry` 关掉）。
 * 默认只让「30 天内使用过的技能」+「顶标（置顶）技能」进入新会话的 `<available_skills>`；
 * 30 天内被加载进目录却**从未使用过**的技能退出清单（转为「索引」：侧栏仍可见、
 * `/技能名` 仍可用、`skill_search` 仍可检索并加载）。实现手段是给这些技能注册一个
 * **同名 runtime 影子**（rank 250 > 用户技能的 400/500/600），只把 `modelInvocable`
 * 设为 false —— 这是 DSH 官方区分「模型可见」与「用户可见」的开关，因此不需要改动
 * DSH 本体。契约由 `test-registry-shadow.mjs` 对着真实注册表验证。
 *
 * 路由（与 /api 相同的浏览器信任围栏：loopback Host 或 trustedHosts）：
 *   GET  /skillpanel/skills           -> 技能列表（含分类/标签/清单状态）+ 策略摘要
 *   GET  /skillpanel/skills/refresh   -> 强制重扫后返回
 *   GET  /skillpanel/policy           -> 完整策略（含每个技能为什么在/不在清单）
 *   POST /skillpanel/pins             -> 覆盖置顶清单 { pins: [...] }
 *   POST /skillpanel/classify         -> 人工改分类 { name, category }
 *   POST /skillpanel/mine             -> 立刻重跑会话日志回填
 *   GET  /skillpanel/usage            -> 使用证据（诊断用）
 */
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { watch, readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import {
  WINDOW_DAYS, GRACE_DAYS,
  emptyStore, loadStore, saveStore, isSkillName,
  parseTable, classify, familyOf, deriveTags,
  computePolicy, recordUse, recordAdvertised, mergeScan,
  policySummary, whyLabel, policyFile,
} from './policy.js'
import { mineSessions, mergeMined } from './mining.js'

/** Stable Cordis plugin name (matches the loader row id in cordis.patch.yml). */
export const name = 'skill-sidebar'
/** Services required before mounting: the webserver routes + the loader's connection row (for the fence). */
export const inject = ['webServer', 'loader']

/** 影子注册用的 provider 标签（出现在技能元数据里，便于排查）。 */
const PROVIDER_LABEL = 'dsh-skill-sidebar'

/**
 * Optional file-based request trace for /skillpanel/skills.
 * Set `DSH_SKILL_SIDEBAR_TRACE` to an absolute file path to enable it.
 */
const REQUEST_LOG = process.env.DSH_SKILL_SIDEBAR_TRACE || ''

/** The weekday number for Monday (Date#getDay). */
const MONDAY = 1
/** A cache older than this is considered stale and triggers a re-scan on boot. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000
/** Debounce window for filesystem watcher events. */
const WATCH_DEBOUNCE_MS = 500
/** Fallback poll interval (watcher unsupported / missed events). */
const POLL_MS = 5 * 60 * 1000
/** Monday-policy timer: every 6 hours, re-scan if today is Monday and the cache predates today. */
const MONDAY_CHECK_MS = 6 * 60 * 60 * 1000
/** 使用记录写盘防抖（连续调用合并成一次写）。 */
const SAVE_DEBOUNCE_MS = 1500
/** 策略重算防抖（用一次就立刻生效，但别每步都重算）。 */
const APPLY_DEBOUNCE_MS = 2500
/** 回填后多久算「不新鲜」，需要重跑（默认 6 小时）。 */
const MINE_FRESH_MS = 6 * 60 * 60 * 1000
/** 单个会话日志超过这个大小就跳过（防止一次性吃爆内存）。 */
const MAX_LOG_BYTES = 256 * 1024 * 1024
/** 影子注册上限（异常数据保护）。 */
const MAX_SHADOWS = 2000

const DAY_MS = 24 * 60 * 60 * 1000

/* ------------------------------------------------------------------ */
/* skill roots & cache paths                                           */
/* ------------------------------------------------------------------ */

/** The agents home (defaults to ~/.agents, honoring $DSH_AGENTS_HOME like dsh-skill-filesystem). */
function agentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** The primary skill root: <agentsHome>/skills. */
function skillsRoot() {
  return join(agentsHome(), 'skills')
}

/** Extra skill roots from $DSH_SKILL_DIRS (path.delimiter separated). */
function extraRoots() {
  const raw = process.env.DSH_SKILL_DIRS
  if (!raw) return []
  return raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * All skill roots scanned by this plugin, each with a source label.
 * Order matters: `.agents` (the shared/public directory) is scanned first,
 * so later roots whose entries alias the same skill are deduplicated in its favor.
 */
function allRoots() {
  return [
    { source: 'agents', path: skillsRoot() },
    { source: 'codex', path: process.env.DSH_CODEX_SKILL_DIR || join(homedir(), '.codex', 'skills') },
    { source: 'claude', path: process.env.DSH_CLAUDE_SKILL_DIR || join(homedir(), '.claude', 'skills') },
    { source: 'opencode', path: process.env.DSH_OPENCODE_SKILL_DIR || join(homedir(), '.opencode', 'skills') },
    ...extraRoots().map((path) => ({ source: 'extra', path })),
  ]
}

/** 会话日志根目录（回填用）。 */
function sessionsRoot() {
  return process.env.DSH_SKILL_SESSIONS_DIR
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
}

/** 策略模式：on（默认，真生效）/ dry（只统计不改行为）/ off（完全关闭）。 */
function policyMode() {
  const raw = String(process.env.DSH_SKILL_POLICY || 'on').toLowerCase()
  return raw === 'off' || raw === 'dry' ? raw : 'on'
}

/** 数字型环境变量（非法值回落默认）。 */
function envNumber(key, fallback) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * A stable signature of the current root set plus the shipped tables —
 * a change to any of them invalidates the persisted cache.
 */
function rootsSignature() {
  const roots = allRoots().map((r) => `${r.source}:${r.path}`).join('|')
  return `${roots}|zh:${ZH_SIGNATURE}|cat:${CATEGORY_VERSION}`
}

/** Cache directory: $DSH_SKILL_CACHE_DIR, else $DSH_HOME/storages/dsh-skill-sidebar. */
function cacheDir() {
  if (process.env.DSH_SKILL_CACHE_DIR) return process.env.DSH_SKILL_CACHE_DIR
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-skill-sidebar')
}

/** Cache file path. */
function cacheFile() {
  return join(cacheDir(), 'skills.json')
}

/* ------------------------------------------------------------------ */
/* tiny YAML frontmatter parser (no dependencies)                      */
/* ------------------------------------------------------------------ */

/**
 * Decode a SKILL.md byte buffer: UTF-8 by default, falling back to GBK when
 * the UTF-8 decode produced replacement characters. A leading BOM is stripped.
 */
function decodeSkillText(buf) {
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf)
      if (!gbk.includes('\uFFFD')) text = gbk
    } catch { /* keep the UTF-8 attempt */ }
  }
  return text
}

/**
 * Parse the `---`-delimited YAML frontmatter of a SKILL.md.
 *
 * Extracts scalar single-line keys (name, description, whenToUse, category, ...),
 * folded/literal block scalars (`key: >` / `key: |`), **inline lists**
 * (`tags: [a, b]`) and **block lists** (`tags:` + indented `- a` lines) — the last
 * two are what let a skill declare its own `tags` / `keywords`.
 * @returns `{ scalars: {...}, lists: {...} }`（用 `parseFrontmatter` 只要标量）。
 */
function parseFrontmatterFull(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const out = {}
  const lists = {}
  const first = text.indexOf('---')
  if (first !== 0) return { scalars: out, lists }
  const rest = text.slice(3)
  const second = rest.indexOf('\n---')
  if (second === -1) return { scalars: out, lists }
  const block = rest.slice(0, second)
  const lines = block.split(/\r?\n/)
  let pendingKey = null
  let pendingStyle = null
  let pendingParts = []
  let listKey = null
  let listItems = []
  const flushList = () => {
    if (listKey !== null && listItems.length > 0) lists[listKey] = listItems
    listKey = null
    listItems = []
  }
  for (const rawLine of lines) {
    // 块列表项：`  - value`
    const itemMatch = /^\s+-\s+(.*)$/.exec(rawLine)
    if (listKey !== null && itemMatch !== null) {
      listItems.push(unquote(itemMatch[1].trim()))
      continue
    }
    if (pendingKey !== null) {
      if (/^\s/.test(rawLine) && rawLine.trim() !== '') {
        pendingParts.push(rawLine.trim())
        continue
      }
      if (pendingParts.length > 0) {
        out[pendingKey] = pendingStyle === '|' ? pendingParts.join('\n') : pendingParts.join(' ')
      }
      pendingKey = null
      pendingStyle = null
      pendingParts = []
    }
    if (listKey !== null && !/^\s/.test(rawLine)) flushList()
    const line = rawLine.trimEnd()
    if (line.trim() === '' || line.startsWith('#') || /^\s/.test(rawLine)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      pendingKey = key
      pendingStyle = value[0]
      pendingParts = []
      continue
    }
    if (value === '') {
      // 可能是块列表的头部（下一行是 `- x`）；也可能只是空值。
      listKey = key
      listItems = []
      continue
    }
    // 行内列表：[a, b, "c"]
    if (value.startsWith('[') && value.endsWith(']')) {
      const items = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter((s) => s !== '')
      if (items.length > 0) lists[key] = items
      continue
    }
    out[key] = unquote(value)
  }
  if (pendingKey !== null && pendingParts.length > 0) {
    out[pendingKey] = pendingStyle === '|' ? pendingParts.join('\n') : pendingParts.join(' ')
  }
  flushList()
  return { scalars: out, lists }
}

/**
 * frontmatter 的标量视图（老契约：只返回 key -> string）。
 * @param text - SKILL.md 全文。
 * @returns 标量键值对象。
 */
function parseFrontmatter(text) {
  return parseFrontmatterFull(text).scalars
}

/** Strip one level of '...' or "..." quoting with basic unescaping. */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'")
    }
  }
  return value
}

/** Fallback description: first non-empty body paragraph, minus heading markers. */
function fallbackDescription(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const body = text.replace(/^---[\s\S]*?^---\s*/m, '')
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === '---' || /^#+\s/.test(trimmed)) continue
    return trimmed.replace(/^#+\s*/, '')
  }
  return ''
}

/* ------------------------------------------------------------------ */
/* 4-6 字功能短语                                                       */
/* ------------------------------------------------------------------ */

/** Hand-written short-phrase list per skill (name -> string[]), shipped with the plugin. */
const PHRASES_OVERRIDES = loadPhrasesOverrides()

/**
 * Shipped Chinese phrases + one-line summaries (`lib/skills-zh.json`), keyed by
 * skill name, for skills whose `SKILL.md` is written in English.
 */
const ZH_SKILLS = loadZhSkills()

/**
 * Fingerprint of the Chinese table, folded into the cache signature so
 * regenerating it invalidates a cached scan instead of waiting for Monday.
 */
const ZH_SIGNATURE = (() => {
  const meta = ZH_SKILLS._meta
  if (meta && typeof meta.version === 'string' && meta.version !== '') return meta.version
  return String(Object.keys(ZH_SKILLS).length)
})()

/** 分类表的指纹（表变了就重扫一次，让自动归类结果刷新）。 */
const CATEGORY_TABLE = parseTable(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'categories.json'), 'utf8'))
const CATEGORY_VERSION = typeof CATEGORY_TABLE._meta?.version === 'string' ? CATEGORY_TABLE._meta.version : 'v0'

/** Max phrase count generated by the rule-based fallback. */
const FALLBACK_MAX_PHRASES = 6
/** Max characters of one fallback phrase. */
const FALLBACK_MAX_CHARS = 8

/** Load lib/phrases.json (missing/corrupt -> {}). */
function loadPhrasesOverrides() {
  try {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'phrases.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Load lib/skills-zh.json (missing/corrupt -> {}). */
function loadZhSkills() {
  try {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'skills-zh.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** The Chinese entry ({ phrases?, summary? }) for one skill, or null. */
function zhOf(name) {
  const entry = ZH_SKILLS[name]
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null
}

/**
 * Rule-based short-phrase generation for skills without hand-written phrases:
 * split the description on Chinese/ASCII punctuation, take the leading ~6 字,
 * dedupe, cap the count.
 */
function phraseFallback(description) {
  if (!description) return []
  const seen = new Set()
  const out = []
  for (const part of description.split(/[，。；、：,!;:]+/)) {
    const t = part.trim().replace(/^[-*>#\s]+/, '')
    if (t === '') continue
    const p = t.length <= FALLBACK_MAX_CHARS ? t : t.slice(0, FALLBACK_MAX_CHARS)
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
    if (out.length >= FALLBACK_MAX_PHRASES) break
  }
  return out
}

/**
 * Resolve a skill's short-phrase list: the hand-written Chinese table
 * (`phrases.json`) wins, then the shipped Chinese table for English skills
 * (`skills-zh.json`), and only then the rule fallback.
 */
function phrasesOf(name, description) {
  const override = PHRASES_OVERRIDES[name]
  if (Array.isArray(override) && override.length > 0) return override
  const zh = zhOf(name)
  if (zh && Array.isArray(zh.phrases) && zh.phrases.length > 0) return zh.phrases
  return phraseFallback(description)
}

/** 一行 SKILL.md 的元数据对象（frontmatter 标量 + 列表 + 描述兜底）。 */
function metaOfFile(text, fallbackName) {
  const parsed = parseFrontmatterFull(text)
  const meta = parsed.scalars
  const name = meta.name || fallbackName
  const description = meta.description || fallbackDescription(text)
  const zh = zhOf(name)
  const tags = []
  for (const key of ['tags', 'keywords']) {
    const list = parsed.lists[key]
    if (Array.isArray(list)) for (const t of list) tags.push(t)
  }
  return {
    name,
    description,
    phrases: phrasesOf(name, description),
    source: 'agents',
    tags,
    ...(meta.category ? { category: meta.category } : {}),
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
    ...(zh && typeof zh.summary === 'string' && zh.summary !== '' ? { zh: zh.summary } : {}),
  }
}

/** One scanned skill entry (+ installMtime / frontmatter tags). */
function skillEntry(meta, fallbackName, text, source, installMtime) {
  const base = metaOfFile(text, fallbackName)
  return {
    ...base,
    source: source || 'agents',
    ...(Number.isFinite(installMtime) ? { installMtime } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* scanning                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scan every skill root and return the merged list of skill entries
 * (name, description, phrases, source, tags, installMtime, ...), sorted by name.
 * Unreadable entries are skipped silently. The first root to claim a skill name
 * wins, so the public `.agents` copy deduplicates aliases in later roots.
 * @returns { skills, bodies }（bodies: name -> SKILL.md 正文，供影子注册/按需加载复用）。
 */
async function scanSkills() {
  const skills = []
  const bodies = new Map()
  const seen = new Set()
  for (const root of allRoots()) {
    let entries = []
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue // root missing or unreadable
    }
    for (const entry of entries) {
      const full = join(root.path, entry.name)
      try {
        let mdPath = null
        let fallbackName = ''
        if (entry.isDirectory()) {
          mdPath = join(full, 'SKILL.md')
          fallbackName = entry.name
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md' && entry.name.toLowerCase() !== 'readme.md') {
          mdPath = full
          fallbackName = entry.name.slice(0, -3)
        }
        if (mdPath === null) continue
        const info = await stat(mdPath)
        if (!info.isFile()) continue
        const text = decodeSkillText(await readFile(mdPath))
        const meta = parseFrontmatter(text)
        const skillName = meta.name || fallbackName
        if (seen.has(skillName)) continue
        seen.add(skillName)
        const item = skillEntry(meta, fallbackName, text, root.source, info.mtimeMs)
        item.path = mdPath
        skills.push(item)
        bodies.set(skillName, text)
      } catch {
        // unreadable entry — skip
      }
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, bodies }
}

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

/** Read the persisted cache (null when absent/malformed). */
async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(), 'utf8'))
    if (parsed && Array.isArray(parsed.skills)) return parsed
    return null
  } catch {
    return null
  }
}

/** Persist a scan result with its timestamp and root signature. */
async function saveCache(skills) {
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(cacheFile(), JSON.stringify({
    skills,
    scannedAt: new Date().toISOString(),
    roots: rootsSignature(),
  }, null, 2), 'utf8')
}

/** Local date string (YYYY-MM-DD) of a Date or ISO string. */
function dateStr(value) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whether `now` is Monday. */
function isMondayNow() {
  return new Date().getDay() === MONDAY
}

/** Whether the cached scan must be refreshed: stale, Monday with a pre-today cache, or the root set changed. */
function cacheNeedsRefresh(cached) {
  const scannedAt = cached?.scannedAt ? new Date(cached.scannedAt).getTime() : 0
  const stale = Number.isNaN(scannedAt) || Date.now() - scannedAt > STALE_MS
  if (stale) return true
  if (isMondayNow() && dateStr(cached.scannedAt) !== dateStr(new Date())) return true
  return cached.roots !== rootsSignature()
}

/* ------------------------------------------------------------------ */
/* browser-trust fence (same contract as the /api gateway)              */
/* ------------------------------------------------------------------ */

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Whether one request may reach the plugin routes. */
function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') return entry.options.config?.trustedHosts ?? []
  }
  return []
}

/** 读一个小 JSON 请求体（上限 64 KB，超限/坏 JSON 返回 null）。 */
function readJsonBody(request, limit = 65536) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve(null)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

/* ------------------------------------------------------------------ */
/* plugin body                                                         */
/* ------------------------------------------------------------------ */

/**
 * Plugin body: 扫描/缓存生命周期 + 分类/标签/使用证据 + 新会话加载清单 + 路由。
 * @param ctx - plugin context carrying webServer and loader.
 */
export function apply(ctx) {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  const mode = policyMode()
  const windowDays = envNumber('DSH_SKILL_WINDOW_DAYS', WINDOW_DAYS)
  const graceDays = envNumber('DSH_SKILL_GRACE_DAYS', GRACE_DAYS)
  const miningEnabled = String(process.env.DSH_SKILL_MINE || 'on').toLowerCase() !== 'off'

  /** 当前机器级技能列表 { skills, scannedAt }。 */
  let current = null
  /** name -> SKILL.md 正文（扫描时读取，供影子注册与按需加载复用）。 */
  let bodies = new Map()
  /** 策略存储（policy.json）。 */
  let store = emptyStore()
  /** 最近一次算出的策略。 */
  let policy = null
  /** 当前生效的影子注册器。 */
  let shadows = []
  /** 已影子化的技能名（用于判断是否需要重建）。 */
  let shadowSignature = ''
  /** Guards every async continuation after disposal. */
  let alive = true
  /** 后台回填的中断信号。 */
  const bootAbort = new AbortController()
  /** Resources created by boot() and released by the disposer. */
  const resources = { timers: [], watchers: [] }
  let saveTimer = null
  let applyTimer = null
  let mining = false

  const log = (level, message) => {
    try {
      ctx.logger?.[level]?.(`[dsh-skill-sidebar] ${message}`)
    } catch {
      // logger unavailable — nothing to report with
    }
  }

  const skillsService = () => {
    try { return ctx.get('skills') } catch { return undefined }
  }
  const toolsService = () => {
    try { return ctx.get('tools') } catch { return undefined }
  }

  /* ---------------- 扫描与持久化 ---------------- */

  /** Re-scan every root, persist, swap `current`, and fold the scan into the policy store. */
  async function rescan(reason) {
    if (!alive) return
    try {
      const scanned = await scanSkills()
      bodies = scanned.bodies
      current = { skills: scanned.skills, scannedAt: new Date().toISOString() }
      const merged = mergeScan(store, scanned.skills, CATEGORY_TABLE)
      store = merged.store
      if (merged.newly.length > 0) {
        log('info', `新发现 ${merged.newly.length} 个技能，已自动归类：${merged.newly.slice(0, 5).join(', ')}${merged.newly.length > 5 ? ' …' : ''}`)
      }
      await saveCache(scanned.skills)
      await saveStore(policyFile(cacheDir()), store)
      log('info', `rescanned ${scanned.skills.length} skills (${reason})`)
      void applyPolicy(`scan:${reason}`)
    } catch (error) {
      log('warn', `rescan failed (${reason}): ${String(error)}`)
    }
    armWatchers()
  }

  /** Debounced watcher callback (skill installed/changed/removed). */
  let watchTimer = null
  function scheduleWatchRescan() {
    if (watchTimer !== null) return
    watchTimer = setTimeout(() => {
      watchTimer = null
      void rescan('watcher')
    }, WATCH_DEBOUNCE_MS)
  }

  /** Drop every watcher (re-arming replaces them). */
  function clearWatchers() {
    for (const w of resources.watchers) try { w.close() } catch { /* already closed */ }
    resources.watchers.length = 0
  }

  /** Watch the skill roots (recursively) AND their parent directories (non-recursively). */
  function armWatchers() {
    if (!alive) return
    clearWatchers()
    const seen = new Set()
    const targets = []
    for (const root of allRoots()) {
      targets.push({ path: root.path, recursive: true })
      const parent = dirname(root.path)
      if (parent !== root.path) targets.push({ path: parent, recursive: false })
    }
    for (const t of targets) {
      if (seen.has(t.path)) continue
      seen.add(t.path)
      try {
        const w = watch(t.path, { recursive: t.recursive }, () => scheduleWatchRescan())
        resources.watchers.push(w)
      } catch {
        // watcher unsupported / path missing — the poll below covers it
      }
    }
  }

  /* ---------------- 使用证据 ---------------- */

  /** 立刻写盘（防抖到点、或进程内需要强一致时调用）。 */
  async function persistStore() {
    if (!alive) return
    await saveStore(policyFile(cacheDir()), store)
  }

  /** 合并式写盘：连续调用只写一次。 */
  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistStore()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 合并式重算策略。 */
  function scheduleApply() {
    if (applyTimer !== null) return
    applyTimer = setTimeout(() => {
      applyTimer = null
      void applyPolicy('debounced')
    }, APPLY_DEBOUNCE_MS)
  }

  /** 记一次技能使用（实时证据）。 */
  function noteUsage(skillName, sessionId) {
    if (typeof skillName !== 'string' || skillName === '') return
    store = recordUse(store, skillName, Date.now(), sessionId ?? null)
    scheduleSave()
    scheduleApply()
  }

  /** 从工具执行上下文里取会话 id（不同版本字段位置不同，容错取值）。 */
  function sessionIdOf(exec) {
    try {
      return exec?.agent?.session?.id ?? exec?.agent?.id ?? null
    } catch {
      return null
    }
  }

  /* ---------------- 影子注册（策略生效） ---------------- */

  /** 释放全部影子条目（恢复 DSH 原样）。 */
  function dropShadows() {
    for (const dispose of shadows) {
      try { dispose() } catch { /* already gone */ }
    }
    shadows = []
    shadowSignature = ''
  }

  /**
   * 为「不进新会话清单」的技能准备正文：优先用扫描时读到的正文，
   * 没有的（例如 DSH 自带/项目内技能）向注册表要一次。
   * 注意顺序：对**当前没有影子**的名字调用 get()，否则会拿到我们自己的影子正文。
   */
  async function ensureBodies(names, registry) {
    const missing = names.filter((n) => !bodies.has(n))
    if (missing.length === 0 || registry === undefined) return
    for (const n of missing) {
      if (bootAbort.signal.aborted) return
      try {
        const def = await registry.get(n, {})
        if (def && typeof def.content === 'string') bodies.set(n, def.content)
      } catch { /* 取不到正文就不影子化这个技能 */ }
    }
  }

  /** 描述与正文兜底（注册要求描述非空、正文为字符串）。 */
  function shadowDefinition(skill) {
    const description = typeof skill?.description === 'string' && skill.description.trim() !== ''
      ? skill.description
      : `（${skill?.name ?? 'skill'}：已移出新会话技能目录，可用 skill_search 按需加载）`
    const body = bodies.get(skill?.name)
    if (typeof body !== 'string') return null
    return {
      name: skill.name,
      description,
      content: body,
      source: 'custom',
      provider: PROVIDER_LABEL,
      invocation: { modelInvocable: false, userInvocable: true },
      ...(typeof skill.path === 'string' ? { path: skill.path } : {}),
    }
  }

  /**
   * 计算并落地策略：resident 进新会话目录，indexed 转「索引」（用户可见、可检索、
   * 但不再写进 `<available_skills>`）。
   */
  async function applyPolicy(reason) {
    if (!alive) return
    const byName = new Map()
    for (const s of current?.skills ?? []) byName.set(s.name, s)
    const registry = skillsService()
    if (registry !== undefined && typeof registry.list === 'function') {
      try {
        for (const summary of await registry.list({})) {
          if (!byName.has(summary.name)) {
            byName.set(summary.name, {
              name: summary.name,
              description: summary.description,
              source: summary.source || 'bundled',
              tags: [],
              ...(summary.path !== undefined ? { path: summary.path } : {}),
            })
          }
        }
      } catch (error) {
        log('warn', `读取技能注册表失败：${String(error)}`)
      }
    }
    const list = [...byName.values()]
    policy = computePolicy(list, store, Date.now(), { mode, windowDays, graceDays })
    // 把「本次进入加载清单」的技能记为 advertised —— 这正是用户规则里
    // 「前 30 天内加载过」的事实来源。
    store = recordAdvertised(store, policy.resident, Date.now())
    scheduleSave()

    if (!policy.active || registry === undefined || typeof registry.register !== 'function') {
      dropShadows()
      if (policy.degraded) {
        log('info', `加载策略未生效（${policy.degradedReason}），新会话仍列出全部 ${policy.stats.modelInvocable} 个模型可见技能`)
      } else if (mode !== 'on') {
        log('info', `加载策略模式 ${mode}：只统计，不改行为（常驻 ${policy.resident.length} / 索引 ${policy.indexed.length}）`)
      }
      return
    }

    const indexed = policy.indexed.slice(0, MAX_SHADOWS)
    const signature = indexed.join('\n')
    if (signature === shadowSignature) return
    await ensureBodies(indexed, registry)
    const definitions = []
    let skipped = 0
    for (const skillName of indexed) {
      const def = shadowDefinition(byName.get(skillName) ?? { name: skillName })
      if (def === null || !isSkillName(def.name)) { skipped += 1; continue }
      definitions.push(def)
    }
    dropShadows()
    for (const def of definitions) {
      try {
        const dispose = registry.register(def)
        shadows.push(dispose)
      } catch (error) {
        skipped += 1
        log('debug', `影子注册失败 ${def.name}: ${String(error)}`)
      }
    }
    shadowSignature = signature
    log('info', `加载清单已生效（${reason}）：常驻 ${policy.resident.length} 个进新会话目录，索引 ${definitions.length} 个转为按需（跳过 ${skipped}）`)
  }

  /* ---------------- 会话日志回填 ---------------- */

  /** 后台回填最近窗口内的技能使用证据（多帧 zstd 会话日志）。 */
  async function backfill(force = false) {
    if (!alive || !miningEnabled || mining) return
    if (!force) {
      const at = store.minedAt ? new Date(store.minedAt).getTime() : 0
      if (at > 0 && Date.now() - at < MINE_FRESH_MS) return
    }
    const root = sessionsRoot()
    if (!existsSync(root)) return
    mining = true
    try {
      const mined = await mineSessions({
        root,
        sinceMs: Date.now() - (windowDays + 2) * DAY_MS,
        ledger: store.mined,
        maxFileBytes: MAX_LOG_BYTES,
        signal: bootAbort.signal,
      })
      if (!alive) return
      store = mergeMined(store, mined, Date.now())
      await persistStore()
      log('info', `回填使用证据：会话日志 ${mined.total} 个（扫描 ${mined.scanned}，跳过 ${mined.skipped}，失败 ${mined.failed}），命中 ${mined.calls.size} 个被调用技能 / ${mined.advertised.size} 个曾进目录的技能`)
      await applyPolicy('backfill')
    } catch (error) {
      log('warn', `回填失败：${String(error)}`)
    } finally {
      mining = false
    }
  }

  /* ---------------- skill_search 工具 ---------------- */

  /** 全量技能视图（含清单状态），供工具与路由共用。 */
  function skillViews() {
    const views = []
    for (const skill of current?.skills ?? []) {
      const detail = policy?.detail?.[skill.name] ?? null
      views.push({
        ...skill,
        category: store.categories[skill.name] ?? CATEGORY_TABLE.fallback.id,
        tags: store.tags[skill.name] ?? deriveTags(skill),
        state: detail?.state ?? 'unknown',
        why: detail?.why ?? null,
        calls: Number(store.usage[skill.name]?.calls) || 0,
        lastUsedAt: Number(store.usage[skill.name]?.lastUsedAt) || 0,
        pinned: store.pins.includes(skill.name),
      })
    }
    return views
  }

  /** 分类 id -> 名称。 */
  function categoryNames() {
    const out = {}
    for (const c of CATEGORY_TABLE.categories) out[c.id] = c.name
    out[CATEGORY_TABLE.fallback.id] = CATEGORY_TABLE.fallback.name
    return out
  }

  /** 分类列表（带计数），供侧栏筛选条。 */
  function categoryList(views) {
    const counts = {}
    for (const v of views) counts[v.category] = (counts[v.category] || 0) + 1
    const rows = []
    for (const c of CATEGORY_TABLE.categories) {
      if (!counts[c.id]) continue
      rows.push({ id: c.id, name: c.name, icon: c.icon, count: counts[c.id] })
    }
    const fallbackCount = counts[CATEGORY_TABLE.fallback.id] || 0
    if (fallbackCount > 0) rows.push({ id: CATEGORY_TABLE.fallback.id, name: CATEGORY_TABLE.fallback.name, icon: CATEGORY_TABLE.fallback.icon, count: fallbackCount })
    return rows
  }

  /** 按关键词/分类/标签检索技能（工具与路由共用）。 */
  function searchSkills(query, options = {}) {
    const views = skillViews()
    const q = String(query || '').trim().toLowerCase()
    const category = typeof options.category === 'string' ? options.category.trim().toLowerCase() : ''
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, options.limit)) : 12
    return views.filter((v) => {
      if (category !== '') {
        const name = (categoryNames()[v.category] || '').toLowerCase()
        if (v.category.toLowerCase() !== category && name !== category) return false
      }
      if (q === '') return true
      // 支持 `tag:xxx` / `#xxx` / `分类:xxx` 语法
      const tagMatch = /^tag[:：#]\s*(.+)$/i.exec(q)
      if (tagMatch !== null) return v.tags.some((t) => t.includes(tagMatch[1].trim()))
      const catMatch = /^(分类|category)[:：]\s*(.+)$/i.exec(q)
      if (catMatch !== null) {
        const name = (categoryNames()[v.category] || '').toLowerCase()
        return v.category.toLowerCase().includes(catMatch[2].trim()) || name.includes(catMatch[2].trim())
      }
      const haystack = [v.name, v.description, v.zh, (v.phrases || []).join(' '), v.tags.join(' '), categoryNames()[v.category]]
        .filter((x) => typeof x === 'string').join(' ').toLowerCase()
      return haystack.includes(q)
    }).slice(0, limit)
  }

  /** 加载一个技能的完整正文（磁盘正文优先，其次问注册表）。 */
  async function loadSkillBody(skillName) {
    if (bodies.has(skillName)) return bodies.get(skillName)
    const registry = skillsService()
    if (registry !== undefined && typeof registry.get === 'function') {
      try {
        const def = await registry.get(skillName, {})
        if (def && typeof def.content === 'string') {
          bodies.set(skillName, def.content)
          return def.content
        }
      } catch { /* fall through */ }
    }
    return null
  }

  /** 渲染技能正文给模型（与本插件其他面向模型的文本保持同一套朴素包装）。 */
  function renderSkillBody(skillName, body) {
    return [
      `<skill_content name="${skillName}">`,
      '（由 dsh-skill-sidebar 按需加载；该技能不在本次会话的常驻技能目录里）',
      '',
      body,
      '</skill_content>',
    ].join('\n')
  }

  /** `skill_search` 工具：全量技能检索 + 按名加载（含未进目录的技能）。 */
  const skillSearchTool = {
    name: 'skill_search',
    description: 'Search the full local skill index by keyword, category, or tag — including skills that are not in the session skill catalog (they were moved out for being unused). Pass an exact `name` to load that skill\'s full instructions immediately.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keyword to search (name, description, Chinese summary, tag, or category). Use "" to list by category only.' },
        name: { type: 'string', description: 'Exact skill name; when given, that skill\'s full instructions are returned (and it is marked as used).' },
        category: { type: 'string', description: 'Restrict to one category id or Chinese name, e.g. "search" / "网页检索".' },
        limit: { type: 'integer', description: 'Max matches to return (default 12, max 50).' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const query = typeof args?.query === 'string' ? args.query : ''
      const wanted = typeof args?.name === 'string' && args.name !== '' ? args.name : null
      if (wanted !== null) {
        if (!isSkillName(wanted)) throw new Error(`invalid skill name "${wanted}"`)
        const body = await loadSkillBody(wanted)
        if (body === null) throw new Error(`skill "${wanted}" is unknown or no longer available`)
        noteUsage(wanted, null)
        return { text: renderSkillBody(wanted, body) }
      }
      const matches = searchSkills(query, { category: args?.category, limit: args?.limit })
      const names = categoryNames()
      if (matches.length === 0) {
        const lines = [`没有匹配「${query}」的技能。`]
        const cats = categoryList(skillViews())
        if (cats.length > 0) lines.push('可用分类：' + cats.map((c) => `${c.name}(${c.count})`).join('、'))
        return { text: lines.join('\n') }
      }
      const lines = [`匹配「${query}」的技能 ${matches.length} 个：`]
      for (const m of matches) {
        const state = m.state === 'resident' ? '常驻' : '索引'
        lines.push(`- ${m.name} [${names[m.category] || m.category}·${state}]${m.tags.length > 0 ? ' #' + m.tags.join(' #') : ''}: ${m.description}`)
      }
      lines.push('')
      lines.push('要使用其中某个技能，调用 skill_search({query:"", name:"<技能名>"}) 取得它的完整说明后再执行。')
      return { text: lines.join('\n') }
    },
  }

  /* ---------------- 路由 ---------------- */

  /** 列表接口的统一响应体。 */
  function skillsPayload(source) {
    const views = skillViews()
    return {
      ok: true,
      skills: views,
      scannedAt: current?.scannedAt ?? null,
      source,
      policy: policy === null ? null : policySummary(policy),
      categories: categoryList(views),
      categoryNames: categoryNames(),
      usage: {
        called: Object.keys(store.usage).length,
        advertised: Object.keys(store.advertised).length,
        minedAt: store.minedAt,
      },
      settings: { mode, windowDays, graceDays, mining: miningEnabled },
    }
  }

  const sendJson = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(JSON.stringify(body))
  }

  function handleSkills(req, res) {
    if (REQUEST_LOG !== '') {
      try {
        appendFileSync(REQUEST_LOG, `${new Date().toISOString()} HIT fence=${fence(req)} ua=${(req.headers['user-agent'] || '').slice(0, 160)}\n`)
      } catch { /* diagnostics only */ }
    }
    if (!fence(req)) {
      log('warn', 'skills route DENIED by fence')
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    sendJson(res, skillsPayload('filesystem'))
  }

  function handleRefresh(req, res) {
    if (!fence(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    void rescan('manual').then(() => {
      if (res.writableEnded) return
      sendJson(res, skillsPayload('filesystem'))
    })
  }

  function handlePolicy(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    if (policy === null) { sendJson(res, { ok: false, error: 'policy not computed yet' }, 503); return }
    const detail = {}
    for (const [skillName, d] of Object.entries(policy.detail)) {
      detail[skillName] = { ...d, whyText: whyLabel(d.why) }
    }
    sendJson(res, {
      ok: true,
      policy: { ...policySummary(policy), detail, generatedAt: policy.generatedAt },
      settings: { mode, windowDays, graceDays, mining: miningEnabled },
      store: { pins: store.pins, updatedAt: store.updatedAt, minedAt: store.minedAt },
    })
  }

  function handlePins(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    void readJsonBody(req).then(async (body) => {
      if (body === null || !Array.isArray(body.pins)) {
        sendJson(res, { ok: false, error: 'expected { pins: string[] }' }, 400)
        return
      }
      store = { ...store, pins: body.pins.filter((n) => typeof n === 'string' && n !== '') }
      await persistStore()
      await applyPolicy('pins')
      sendJson(res, { ok: true, pins: store.pins, policy: policy === null ? null : policySummary(policy) })
    })
  }

  function handleClassify(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    void readJsonBody(req).then(async (body) => {
      const skillName = body && typeof body.name === 'string' ? body.name : null
      const category = body && typeof body.category === 'string' ? body.category : null
      if (skillName === null || category === null) {
        sendJson(res, { ok: false, error: 'expected { name, category }' }, 400)
        return
      }
      store = { ...store, categories: { ...store.categories, [skillName]: category } }
      await persistStore()
      sendJson(res, { ok: true, name: skillName, category })
    })
  }

  function handleMine(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    void backfill(true).then(() => {
      if (res.writableEnded) return
      sendJson(res, {
        ok: true,
        minedAt: store.minedAt,
        called: Object.keys(store.usage).length,
        advertised: Object.keys(store.advertised).length,
        policy: policy === null ? null : policySummary(policy),
      })
    })
  }

  function handleUsage(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    const usage = Object.entries(store.usage)
      .map(([skillName, rec]) => ({ name: skillName, ...rec }))
      .sort((a, b) => (b.calls || 0) - (a.calls || 0))
    sendJson(res, {
      ok: true,
      usage,
      advertised: store.advertised,
      pins: store.pins,
      minedAt: store.minedAt,
      minedFiles: Object.keys(store.mined).length,
    })
  }

  const fence = (req) => isTrustedApiRequest(req, trustedHostsOf(ctx))

  /* ---------------- 生命周期 ---------------- */

  /** 注册 skill_search 工具（tools 服务可能比我们晚挂载，失败就返回 false 让调用方重试）。 */
  function registerSearchTool() {
    const tools = toolsService()
    if (tools === undefined || typeof tools.register !== 'function') return false
    const holder = { dispose: null }
    try {
      ctx.effect(() => {
        holder.dispose = tools.register(skillSearchTool)
        return () => { if (holder.dispose) holder.dispose() }
      }, 'dsh-skill-sidebar: skill_search tool')
      log('info', 'skill_search 工具已注册（按需检索/加载未进目录的技能）')
      return true
    } catch (error) {
      log('warn', `skill_search 注册失败：${String(error)}`)
      return true // 注册过就不要再重试（避免重复报错）
    }
  }

  /** Boot lifecycle: seed `current` + store, arm watchers/timers, apply policy, backfill. */
  async function boot() {
    if (!alive) return
    store = await loadStore(policyFile(cacheDir()))
    if (!alive) return
    const cached = await loadCache()
    if (alive && cached && !cacheNeedsRefresh(cached)) {
      current = cached
      store = mergeScan(store, cached.skills, CATEGORY_TABLE).store
      log('info', `loaded ${cached.skills.length} skills from cache (${dateStr(cached.scannedAt)})`)
      // 缓存里没有技能正文（影子注册要用）：立刻后台补齐 + 应用策略，不阻塞启动。
      void rescan('boot-bodies')
    } else {
      await rescan(cached ? 'monday-or-stale' : 'first-scan')
    }
    if (!alive) return

    armWatchers()
    resources.timers.push(setInterval(() => void rescan('poll'), POLL_MS))
    resources.timers.push(setInterval(() => {
      if (!alive) return
      if (isMondayNow() && current !== null && dateStr(current.scannedAt) !== dateStr(new Date())) {
        void rescan('monday')
      }
    }, MONDAY_CHECK_MS))
    // 回填稍后再跑：先让宿主启动完成，别抢启动时的 IO。
    resources.timers.push(setTimeout(() => { void backfill(false) }, 4000))

    // tools 服务若尚未就绪，退避重试几次。
    if (!registerSearchTool()) {
      let tries = 0
      const retry = setInterval(() => {
        tries += 1
        if (!alive || registerSearchTool() || tries >= 12) clearInterval(retry)
      }, 5000)
      resources.timers.push(retry)
    }
  }

  /** Disposer installed by the effect below; releases everything boot() armed. */
  function dispose() {
    alive = false
    bootAbort.abort(new Error('dsh-skill-sidebar disposed'))
    if (watchTimer !== null) clearTimeout(watchTimer)
    if (saveTimer !== null) clearTimeout(saveTimer)
    if (applyTimer !== null) clearTimeout(applyTimer)
    for (const t of resources.timers) clearTimeout(t)
    for (const w of resources.watchers) try { w.close() } catch { /* already closed */ }
    resources.timers.length = 0
    resources.watchers.length = 0
    dropShadows()
  }

  // 路由注册
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/skills', handler: handleSkills }), 'dsh-skill-sidebar: skills route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/skills/refresh', handler: handleRefresh }), 'dsh-skill-sidebar: skills refresh route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/policy', handler: handlePolicy }), 'dsh-skill-sidebar: policy route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/pins', handler: handlePins }), 'dsh-skill-sidebar: pins route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/classify', handler: handleClassify }), 'dsh-skill-sidebar: classify route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/mine', handler: handleMine }), 'dsh-skill-sidebar: mine route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/skillpanel/usage', handler: handleUsage }), 'dsh-skill-sidebar: usage route')

  // 启动注入：把当前列表（含分类/标签/清单状态）嵌进 index.html，首帧零请求渲染。
  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    const json = JSON.stringify(current?.skills ?? []).replaceAll('<', '\\u003c')
    const policyJson = JSON.stringify(current === null ? null : {
      policy: policy === null ? null : policySummary(policy),
      categories: categoryList(skillViews()),
      categoryNames: categoryNames(),
      scannedAt: current.scannedAt,
    }).replaceAll('<', '\\u003c')
    const script = `<script>window.__DSH_SKILLS__=${json};window.__DSH_SKILL_POLICY__=${policyJson}</script>`
    const head = html.indexOf('<head>')
    return head !== -1 ? html.slice(0, head + 6) + script + html.slice(head + 6) : script + html
  }), 'dsh-skill-sidebar: skills boot injection')

  // 实时使用证据：包住 skill 工具的调用（本插件的 skill_search 在自己的 execute 里记）。
  ctx.effect(() => ctx.on('tools/execute', async (exec, next) => {
    let result
    try {
      result = await next()
    } finally {
      try {
        if (exec && exec.name === 'skill') {
          const args = exec.arguments
          const skillName = args && typeof args.name === 'string' ? args.name : null
          if (skillName !== null) noteUsage(skillName, sessionIdOf(exec))
        }
      } catch { /* 记录失败绝不能影响工具调用 */ }
    }
    return result
  }), 'dsh-skill-sidebar: skill usage hook')

  // skill_search 工具（按需检索 / 加载未进目录的技能）—— 在 boot() 里注册（tools 服务可能稍后就绪）。

  ctx.effect(() => {
    void boot()
    return dispose
  }, 'dsh-skill-sidebar: scan lifecycle')
}

/** Test hook: exports the pure helpers so the harness can verify them without a live ctx. */
export const internals = {
  parseFrontmatter,
  parseFrontmatterFull,
  unquote,
  fallbackDescription,
  phraseFallback,
  phrasesOf,
  /** Chinese table lookup ({ phrases?, summary? }) — undefined for uncovered skills. */
  zhOf,
  /** Shipped Chinese table size minus its `_meta` row (used by diagnostics/tests). */
  zhSkillCount: Object.keys(ZH_SKILLS).filter((k) => k !== '_meta').length,
  scanSkills,
  cacheNeedsRefresh,
  dateStr,
  isMondayNow,
  skillsRoot,
  allRoots,
  sessionsRoot,
  rootsSignature,
  cacheFile,
  policyMode,
  CATEGORY_TABLE,
  CATEGORY_VERSION,
  classify,
  familyOf,
  deriveTags,
  computePolicy,
  recordUse,
  recordAdvertised,
  mergeScan,
  whyLabel,
  emptyStore,
}
