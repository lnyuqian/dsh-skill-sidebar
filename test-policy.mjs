/**
 * 纯逻辑测试：分类/标签、新会话加载清单（含用户规则）、使用证据与回填。
 * 不依赖 cordis、不读真实技能目录、不写任何文件。
 */
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import {
  isSkillName, emptyStore, normalizeStore, parseTable, classify, familyOf, deriveTags,
  computePolicy, recordUse, recordAdvertised, recordFirstSeen, mergeScan, whyLabel,
} from './lib/policy.js'
import { scanZstdFrames, extractEvidence, mergeMined } from './lib/mining.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-12T00:00:00+08:00')
const TABLE = parseTable(readFileSync(new URL('./lib/categories.json', import.meta.url), 'utf8'))

let passed = 0
let failed = 0
function check(label, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ok: ${label}${extra ? ' — ' + extra : ''}`) }
  else { failed += 1; console.log(`  FAIL: ${label}${extra ? ' — ' + extra : ''}`) }
}

/* ---- 1. 技能名与标签 ---- */
console.log('\n[1] 技能名 / 标签')
check('kebab-case 合法', isSkillName('firecrawl-search'))
check('中文名不合法（进不了模型目录）', !isSkillName('叫卖音频拼接'))
check('大写不合法', !isSkillName('AISO'))
check('下划线不合法', !isSkillName('foo_bar'))
check('familyOf 取第一个前缀', familyOf('firecrawl-deep-research') === 'firecrawl')
check('familyOf 单个词返回空', familyOf('accessibility') === '')
check('deriveTags 合并 frontmatter + 家族 + 来源根',
  JSON.stringify(deriveTags({ name: 'wecomcli-doc', source: 'codex', tags: ['文档'] })) === JSON.stringify(['文档', 'wecomcli', 'codex']),
  JSON.stringify(deriveTags({ name: 'wecomcli-doc', source: 'codex', tags: ['文档'] })))
check('deriveTags 去重且最多 6 个',
  deriveTags({ name: 'a-b', tags: ['x', 'x', 'y', 'z', '1', '2', '3', '4'] }).length === 6)

/* ---- 2. 分类：家族前缀 / 关键词 / 覆盖 / 兜底 ---- */
console.log('\n[2] 自动归类')
check('前缀家族：firecrawl-search → 网页检索', classify({ name: 'firecrawl-search' }, TABLE, {}).id === 'search')
check('前缀家族：wecomcli-meeting → 企业微信', classify({ name: 'wecomcli-meeting' }, TABLE, {}).id === 'wecom')
check('前缀家族：photon-edit → 多媒体生成', classify({ name: 'photon-edit' }, TABLE, {}).id === 'media')
check('前缀家族：dsh-session-rename → DSH 运维', classify({ name: 'dsh-session-rename' }, TABLE, {}).id === 'dsh')
check('关键词：postgresql → 数据与后端', classify({ name: 'postgresql', description: 'Use when writing complex PostgreSQL queries, designing indexes' }, TABLE, {}).id === 'data')
check('关键词：unit-testing → 软件开发', classify({ name: 'unit-testing', description: 'Use when writing unit tests' }, TABLE, {}).id === 'engineering')
check('人工覆盖优先于一切', classify({ name: 'firecrawl-search' }, TABLE, { 'firecrawl-search': 'media' }).id === 'media')
check('frontmatter 声明的分类优先于自动', classify({ name: 'foo', category: 'wecom' }, TABLE, {}).id === 'wecom')
check('frontmatter 声明未知分类 → 动态分类', classify({ name: 'foo', category: '公司内部' }, TABLE, {}).id === 'custom:公司内部')
check('认不出来 → 兜底分类', classify({ name: 'zzz-unknown-thing' }, TABLE, {}).id === TABLE.fallback.id)
check('新装技能：只有名字也能归类',
  classify({ name: 'firecrawl-brand-new-probe' }, TABLE, {}).id === 'search')

/* ---- 3. 新会话加载清单（用户 2026-10-12 的规则） ---- */
console.log('\n[3] 新会话加载清单')
const skills = [
  { name: 'used-recent', installMtime: NOW - 300 * DAY },
  { name: 'used-old', installMtime: NOW - 300 * DAY },
  { name: 'advertised-unused', installMtime: NOW - 300 * DAY },
  { name: 'advertised-expired', installMtime: NOW - 300 * DAY },
  { name: 'never-seen', installMtime: NOW - 300 * DAY },
  { name: 'fresh-install', installMtime: NOW - 2 * DAY },
  { name: 'pinned-but-cold', installMtime: NOW - 300 * DAY },
  { name: '叫卖音频拼接', installMtime: NOW - 300 * DAY },
]
let store = emptyStore()
store = { ...store, pins: ['pinned-but-cold'] }
store = recordUse(store, 'used-recent', NOW - 3 * DAY, 's1')
store = recordUse(store, 'used-old', NOW - 45 * DAY, 's2')
store = recordAdvertised(store, ['advertised-unused'], NOW - 2 * DAY)
store = recordAdvertised(store, ['advertised-expired'], NOW - 45 * DAY)
store = recordAdvertised(store, ['used-recent'], NOW - 3 * DAY)

const policy = computePolicy(skills, store, NOW, { mode: 'on', windowDays: 30, graceDays: 7 })
const detail = policy.detail
check('策略生效（有证据）', policy.active === true && policy.degraded === false)
check('规则①：30 天内用过的技能 → 常驻', detail['used-recent'].state === 'resident' && detail['used-recent'].why === 'used')
check('规则②：顶标（置顶）技能 → 常驻', detail['pinned-but-cold'].state === 'resident' && detail['pinned-but-cold'].why === 'pinned')
check('规则③：30 天内加载过但从未使用 → 退出清单（索引）',
  detail['advertised-unused'].state === 'indexed' && detail['advertised-unused'].why === 'advertised-unused')
check('超过 30 天没用过的 → 索引', detail['used-old'].state === 'indexed' && detail['used-old'].why === 'stale')
check('加载过且早已过期 → 索引', detail['advertised-expired'].state === 'indexed')
check('从未出现过的 → 索引（但仍在侧栏可见）', detail['never-seen'].state === 'indexed' && detail['never-seen'].why === 'never-used')
check('改进：新装 7 天内 → 试用期常驻（避免冷启动死锁）',
  detail['fresh-install'].state === 'resident' && detail['fresh-install'].why === 'new-grace')
check('非法名（中文）不进清单也不报错', detail['叫卖音频拼接'].state === 'invalid')
check('resident/indexed 数量对得上',
  policy.resident.length === 3 && policy.indexed.length === 4,
  `resident=${policy.resident.length} indexed=${policy.indexed.length}`)
check('统计口径正确', policy.stats.used30 === 1 && policy.stats.pinned === 1 && policy.stats.newGrace === 1, JSON.stringify(policy.stats))
check('whyLabel 有中文解释', whyLabel('advertised-unused') === '30 天内加载过但未使用')

/* ---- 4. 保护机制：证据不足 / dry / off ---- */
console.log('\n[4] 保护机制')
const noEvidence = computePolicy(skills, emptyStore(), NOW, { mode: 'on' })
check('没有证据时策略不生效（degraded）', noEvidence.active === false && noEvidence.degraded === true)
check('degraded 时全部保持常驻（不误伤）', noEvidence.resident.length === noEvidence.stats.modelInvocable, String(noEvidence.resident.length))
const dry = computePolicy(skills, store, NOW, { mode: 'dry' })
check('dry 模式只统计不改行为', dry.active === false && dry.resident.length === dry.stats.modelInvocable, `${dry.resident.length}/${dry.stats.modelInvocable}`)
const off = computePolicy(skills, store, NOW, { mode: 'off' })
check('off 模式同样不改行为', off.active === false)
const forced = computePolicy(skills, { ...store, forcedIndexed: ['used-recent'] }, NOW, { mode: 'on' })
check('人工强制索引优先于「用过」', forced.detail['used-recent'].state === 'indexed' && forced.detail['used-recent'].why === 'forced-indexed')

/* ---- 5. 存储：合并扫描 / 去重 / 容错 ---- */
console.log('\n[5] 存储')
check('normalizeStore 容错（乱数据不炸）', normalizeStore({ version: 1, usage: 'x', pins: 'y' }).usage.constructor === Object)
check('版本不匹配 → 重建', normalizeStore({ version: 99, usage: { a: 1 } }).usage.a === undefined)
const firstSeen = recordFirstSeen(emptyStore(), 'a-skill', NOW - 10 * DAY)
check('firstSeen 只写一次', recordFirstSeen(firstSeen, 'a-skill', NOW).firstSeen['a-skill'] === NOW - 10 * DAY)
const scan = mergeScan(emptyStore(), [
  { name: 'firecrawl-x', description: 'scrape', installMtime: NOW - DAY },
  { name: 'wecomcli-y', description: '企微', installMtime: NOW - 2 * DAY },
], TABLE)
check('mergeScan 自动归类新技能',
  scan.store.categories['firecrawl-x'] === 'search' && scan.store.categories['wecomcli-y'] === 'wecom',
  JSON.stringify(scan.store.categories))
check('mergeScan 记录首次发现时间与新增名单', scan.newly.length === 2 && scan.store.firstSeen['firecrawl-x'] === NOW - DAY)
const scanAgain = mergeScan(scan.store, [{ name: 'firecrawl-x', installMtime: NOW }], TABLE)
check('已归类的不再改写、也不算新增',
  scanAgain.newly.length === 0 && scanAgain.store.categories['firecrawl-x'] === 'search' && scanAgain.store.firstSeen['firecrawl-x'] === NOW - DAY)
const usedTwice = recordUse(recordUse(emptyStore(), 'k', NOW - 1000, 'sA'), 'k', NOW, 'sA')
check('同一会话多次调用只算一个 session', usedTwice.usage.k.calls === 2 && usedTwice.usage.k.sessions === 1, JSON.stringify(usedTwice.usage.k))
const adv = recordAdvertised(recordAdvertised(emptyStore(), ['k'], NOW - 1000), ['k'], NOW)
check('advertised 取最新时间', adv.advertised.k === NOW)
check('advertised 不因旧时间回退', recordAdvertised(adv, ['k'], NOW - 5000).advertised.k === NOW)

/* ---- 6. 会话日志：多帧 zstd + 证据提取 ---- */
console.log('\n[6] 会话日志回填')
const frameOf = (lines) => zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'))
const multiFrame = Buffer.concat([
  frameOf([JSON.stringify({ type: 'session', version: 4, id: 'session-test' })]),
  frameOf([
    JSON.stringify({ type: 'tool/call', seq: 2, time: NOW - 5 * DAY, data: { name: 'skill', arguments: JSON.stringify({ name: 'firecrawl' }) } }),
    JSON.stringify({ type: 'tool/call', seq: 3, time: NOW - 4 * DAY, data: { name: 'pwsh', arguments: '{"command":"ls"}' } }),
  ]),
  frameOf([
    JSON.stringify({ type: 'user/message', seq: 4, time: NOW - 3 * DAY, data: { source: { kind: 'skill-invocation', name: 'ui-preview-loop' } } }),
    JSON.stringify({
      type: 'user/message', seq: 5, time: NOW - 3 * DAY,
      data: { source: { kind: 'skill-catalog', entries: [{ name: 'a' }, { name: 'b' }] } },
    }),
  ]),
])
const frames = scanZstdFrames(multiFrame)
check('多帧 zstd 全部识别', frames.frames.length === 3, String(frames.frames.length))
const events = []
{
  const parts = []
  for (const { start, end } of frames.frames) {
    parts.push(...zstdDecompressLines(multiFrame.subarray(start, end)))
  }
  events.push(...parts)
}
function zstdDecompressLines(buf) {
  const text = zstdDecompressSync(buf).toString('utf8')
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
check('三帧事件行数正确', events.length === 5, String(events.length))
const evidence = extractEvidence(events, 'session-test')
check('提取 skill 工具调用', evidence.calls.get('firecrawl')?.calls === 1)
check('忽略非 skill 工具', !evidence.calls.has('pwsh'))
check('提取用户 /技能名 触发', evidence.calls.get('ui-preview-loop')?.calls === 1)
check('提取曾进入目录的技能', evidence.advertised.size === 2 && evidence.advertised.get('a') === NOW - 3 * DAY)
const merged = mergeMined(emptyStore(), { calls: evidence.calls, advertised: evidence.advertised, ledger: { 'C:/log': { mtimeMs: 1, size: 2 } } }, NOW)
check('回填写入 usage/advertised', merged.usage.firecrawl?.calls === 1 && merged.advertised.a === NOW - 3 * DAY)
const merged2 = mergeMined(merged, { calls: new Map([['firecrawl', { calls: 3, lastUsedAt: NOW, sessionId: 's' }]]), advertised: new Map(), ledger: {} }, NOW)
check('重复回填用 max 语义（不相加）', merged2.usage.firecrawl.calls === 3, JSON.stringify(merged2.usage.firecrawl))
check('回填不回退 lastUsedAt', merged2.usage.firecrawl.lastUsedAt === NOW)
check('台账记录已处理的日志', merged.mined['C:/log'] !== undefined)

console.log(failed === 0 ? `\nALL CHECKS PASSED (${passed})` : `\n${failed} CHECK(S) FAILED (${passed} passed)`)
process.exit(failed === 0 ? 0 : 1)
