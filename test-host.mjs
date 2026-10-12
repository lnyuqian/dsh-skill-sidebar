/**
 * Standalone harness for the dsh-skill-sidebar host half: verifies the
 * frontmatter parser against real SKILL.md files, runs the scan over the real
 * skill root, and boots the plugin body with a mock cordis ctx to exercise the
 * routes, the cache file, and the disposer.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, internals } from './lib/index.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok: ${name}`)
  } else {
    failures++
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ---- 1. frontmatter parsing ---- */
console.log('\n[1] frontmatter parsing')
{
  const fm = internals.parseFrontmatter('---\nname: foo\nversion: "0.2.0"\ndescription: "a b: c d"\nmetadata:\n  requires:\n    bins: ["x"]\nwhenToUse: use when needed\n---\nbody')
  check('name', fm.name === 'foo', JSON.stringify(fm))
  check('quoted description with colon', fm.description === 'a b: c d', JSON.stringify(fm.description))
  check('whenToUse', fm.whenToUse === 'use when needed', JSON.stringify(fm.whenToUse))
  check('nested metadata skipped', fm.metadata === undefined, JSON.stringify(fm))
  const unq = internals.unquote("'it''s'")
  check("single-quote '' escape", unq === "it's", JSON.stringify(unq))
  const noFm = internals.parseFrontmatter('no frontmatter here')
  check('no frontmatter -> empty', Object.keys(noFm).length === 0)
  const fb = internals.fallbackDescription('---\na: 1\n---\n\n# Title\n\nReal body')
  check('fallback description', fb === 'Real body', JSON.stringify(fb))
  const folded = internals.parseFrontmatter('---\nname: lark-whiteboard\ndescription: >\n  飞书画板：第一行。\n  第二行内容。\nmetadata:\n  requires:\n    bins: ["x"]\n---\nbody')
  check('folded block scalar joined with space', folded.description === '飞书画板：第一行。 第二行内容。', JSON.stringify(folded.description))
  check('folded: nested metadata still skipped', folded.metadata === undefined, JSON.stringify(folded))
  const literal = internals.parseFrontmatter('---\ndescription: |\n  行一\n  行二\n---')
  check('literal block scalar keeps newline', literal.description === '行一\n行二', JSON.stringify(literal.description))
}

/* ---- 1b. 4-6 字功能短语 ---- */
console.log('\n[1b] short phrases')
{
  const fb = internals.phraseFallback('飞书日历：管理日历日程和会议室。查看/搜索日程、创建/更新日程、预定会议室。')
  check('fallback splits on punctuation and caps chars', fb.length >= 2 && fb.every((p) => p.length <= 8) && fb[0].startsWith('飞书日历'), JSON.stringify(fb))
  const dedupe = internals.phraseFallback('读图能力，读图能力，图片理解')
  check('fallback dedupes', dedupe.length === 2, JSON.stringify(dedupe))
  check('fallback tolerates empty', internals.phraseFallback('').length === 0)
  const larkCal = internals.phrasesOf('lark-calendar', '任意描述')
  check('hand-written override wins', Array.isArray(larkCal) && larkCal.includes('日程管理') && larkCal.includes('会议预定'), JSON.stringify(larkCal))
  const newSkill = internals.phrasesOf('brand-new-skill', '本地文件整理归档备份工具')
  check('unknown skill falls back to rule phrases', newSkill.length === 1 && newSkill[0].startsWith('本地文件'), JSON.stringify(newSkill))
}

/* ---- 1c. shipped 中文短语 + 中文说明 (lib/skills-zh.json) ---- */
console.log('\n[1c] Chinese phrases for English skills')
{
  const zhTable = JSON.parse(readFileSync(new URL('./lib/skills-zh.json', import.meta.url), 'utf8'))
  const zhNames = Object.keys(zhTable).filter((k) => k !== '_meta')
  check('zh table carries a fingerprint version', typeof zhTable._meta?.version === 'string' && zhTable._meta.version !== '', JSON.stringify(zhTable._meta))
  check('zh table covers the English skills', zhNames.length > 100, String(zhNames.length))
  check('reported zh count matches the table', internals.zhSkillCount === zhNames.length, `${internals.zhSkillCount} vs ${zhNames.length}`)
  const badStructure = zhNames.filter((n) => !Array.isArray(zhTable[n].phrases) || zhTable[n].phrases.length < 2
    || typeof zhTable[n].summary !== 'string' || zhTable[n].summary === '')
  check('every zh entry has phrases + summary', badStructure.length === 0, JSON.stringify(badStructure.slice(0, 5)))
  const badChars = zhNames.filter((n) => zhTable[n].phrases.some((p) => typeof p !== 'string' || p.length < 3 || p.length > 8))
  check('zh phrases stay short (3-8 chars)', badChars.length === 0, JSON.stringify(badChars.slice(0, 5)))
  const sample = zhNames[0]
  check('zh phrases win over the rule fallback', JSON.stringify(internals.phrasesOf(sample, 'Use when building things.')) === JSON.stringify(zhTable[sample].phrases), sample)
  check('zhOf exposes the entry', internals.zhOf(sample)?.summary === zhTable[sample].summary, JSON.stringify(internals.zhOf(sample)))
  check('zhOf returns null for an unknown skill', internals.zhOf('definitely-not-a-skill-xyz') === null)
  check('phrases.json still wins for Chinese skills', internals.phrasesOf('lark-calendar', '任意描述').includes('日程管理'))
  check('cache signature carries the zh fingerprint', internals.rootsSignature().includes('zh:' + zhTable._meta.version), internals.rootsSignature().slice(-30))
}

/* ---- 2. scan the real skill root ---- */
console.log('\n[2] scanning real skill roots')
{
  const roots = internals.allRoots()
  console.log(`  roots: ${JSON.stringify(roots)}`)
  const scanned = await internals.scanSkills()
  const skills = scanned.skills
  console.log(`  found ${skills.length} skills`)
  check('found skills', skills.length > 30, `only ${skills.length}`)
  check('scan also returns skill bodies (for shadow registration)',
    scanned.bodies instanceof Map && scanned.bodies.size === skills.length, `bodies=${scanned.bodies.size}`)
  check('every entry carries an install timestamp', skills.every((s) => Number.isFinite(s.installMtime)))
  check('every entry carries a category from the table', skills.every((s) => {
    const id = internals.classify(s, internals.CATEGORY_TABLE, {}).id
    return typeof id === 'string' && id !== ''
  }))
  const firecrawl = skills.find((s) => s.name.startsWith('firecrawl-'))
  if (firecrawl) {
    check('family classification: firecrawl-* → 网页检索',
      internals.classify(firecrawl, internals.CATEGORY_TABLE, {}).id === 'search',
      JSON.stringify(internals.classify(firecrawl, internals.CATEGORY_TABLE, {})))
  } else {
    console.log('  note: no firecrawl-* skill installed here — family classification cross-check skipped')
  }
  check('deriveTags picks the name family', internals.deriveTags({ name: 'wecomcli-doc', source: 'agents' }).includes('wecomcli'))
  // Skill names differ per machine (a previously present skill may be
  // uninstalled), so assert the property instead of one fixed skill name.
  const cjkSample = skills.find((s) => /[\u4e00-\u9fff]/.test(s.description || ''))
  check('Chinese description parsed (any skill)', !!cjkSample && cjkSample.description.length > 5, JSON.stringify(cjkSample))
  const asciiSample = skills.find((s) => /^[\x20-\x7e]+$/.test(s.description || '') && s.description.length > 10)
  check('English description parsed (any skill)', !!asciiSample, JSON.stringify(asciiSample))
  const names = skills.map((s) => s.name)
  check('sorted by name (locale-aware)', names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0))
  check('no duplicate names', new Set(names).size === names.length)
  const bad = skills.filter((s) => !s.name || !s.description)
  check('every entry has name+description', bad.length === 0, JSON.stringify(bad.slice(0, 3)))
  const noPhrases = skills.filter((s) => !Array.isArray(s.phrases) || s.phrases.length === 0)
  check('every entry has phrases', noPhrases.length === 0, JSON.stringify(noPhrases.map((s) => s.name)))
  // The hand-written table outlives individual skills, so it is verified without
  // depending on which skills this machine happens to have installed.
  const handWritten = JSON.parse(readFileSync(new URL('./lib/phrases.json', import.meta.url), 'utf8'))
  const handNames = Object.keys(handWritten)
  check('hand-written phrase table is shipped', handNames.length >= 20, `entries=${handNames.length}`)
  check(
    'phrasesOf returns the hand-written list without a scan',
    JSON.stringify(internals.phrasesOf(handNames[0], '任意描述')) === JSON.stringify(handWritten[handNames[0]]),
    handNames[0],
  )
  const scannedHand = skills.find((s) => handNames.indexOf(s.name) !== -1)
  if (scannedHand) {
    check(
      'a scanned skill carries its hand-written phrases',
      JSON.stringify(scannedHand.phrases) === JSON.stringify(handWritten[scannedHand.name]),
      scannedHand.name,
    )
  } else {
    console.log(`  note: none of the ${handNames.length} hand-written skills is installed here — scan cross-check skipped`)
  }
  const phraseLen = skills.every((s) => s.phrases.every((p) => p.length <= 8))
  check('all phrases are short (<=8 chars)', phraseLen)
}

/* ---- 3. plugin body with a mock ctx ---- */
console.log('\n[3] plugin body lifecycle + routes')
{
  // Isolate the scan root in a scratch dir and the cache inside this workspace
  // (the DSH file sandbox blocks writes outside the workspace).
  const scratch = mkdtempSync(join(tmpdir(), 'dss-test-'))
  const cacheTmp = mkdtempSync(join(process.cwd(), '.dss-cache-'))
  process.env.DSH_AGENTS_HOME = scratch
  process.env.DSH_SKILL_CACHE_DIR = cacheTmp
  process.env.DSH_CODEX_SKILL_DIR = join(scratch, 'codex')
  process.env.DSH_CLAUDE_SKILL_DIR = join(scratch, 'claude')
  process.env.DSH_OPENCODE_SKILL_DIR = join(scratch, 'opencode')
  // 别去挖真实会话日志（那要跑一分钟）：指向一个不存在的目录。
  process.env.DSH_SKILL_SESSIONS_DIR = join(scratch, 'no-sessions')
  process.env.DSH_SKILL_MINE = 'off'
  const routes = {}
  const disposers = []
  const events = {}
  let lifecycleDisposer = null
  const ctx = {
    loader: { entries: () => [] },
    logger: console,
    get: () => undefined,
    on: (eventName, listener) => {
      (events[eventName] = events[eventName] || []).push(listener)
      return () => {
        const list = events[eventName] || []
        const index = list.indexOf(listener)
        if (index !== -1) list.splice(index, 1)
      }
    },
    webServer: {
      register: (route) => {
        routes[route.path] = route.handler
        return () => { delete routes[route.path] }
      },
      tapIndex: () => () => {},
    },
    effect: (fn, label) => {
      const r = fn()
      disposers.push(r)
      return r
    },
  }
  apply(ctx)
  // boot() is async; the lifecycle effect's disposer is the LAST pushed.
  lifecycleDisposer = disposers[disposers.length - 1]

  await new Promise((r) => setTimeout(r, 1200))

  const mockReq = (extra, body) => {
    const listeners = {}
    const req = {
      method: body === undefined ? 'GET' : 'POST',
      url: '/skillpanel/skills',
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', ...extra },
      on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return req },
      destroy: () => {},
    }
    if (body !== undefined) {
      // 让处理器先挂上监听，再投递数据。
      setTimeout(() => {
        for (const fn of listeners.data || []) fn(Buffer.from(body, 'utf8'))
        for (const fn of listeners.end || []) fn()
      }, 0)
    }
    return req
  }
  const mockRes = () => {
    const res = { status: 0, body: '', writableEnded: false }
    res.writeHead = (status) => { res.status = status }
    res.end = (body) => { res.body = body; res.writableEnded = true }
    return res
  }
  const waitFor = async (fn, ms = 3000) => {
    const start = Date.now()
    for (;;) {
      const value = await fn()
      if (value) return value
      if (Date.now() - start > ms) return value
      await new Promise((r) => setTimeout(r, 60))
    }
  }

  const res = mockRes()
  routes['/skillpanel/skills'](mockReq(), res)
  const payload = JSON.parse(res.body)
  check('route 200', res.status === 200, String(res.status))
  check('route ok=true', payload.ok === true, JSON.stringify(payload))
  check('route lists 0 skills for scratch root', Array.isArray(payload.skills) && payload.skills.length === 0, JSON.stringify(payload.skills))
  check('route has scannedAt', typeof payload.scannedAt === 'string', JSON.stringify(payload.scannedAt))
  check('route carries the load policy', payload.policy !== null && typeof payload.policy.mode === 'string', JSON.stringify(payload.policy && payload.policy.mode))
  check('no evidence → policy inactive (degraded)', payload.policy.degraded === true && payload.policy.active === false, JSON.stringify(payload.policy.stats))
  check('route carries the category list', Array.isArray(payload.categories))
  check('route carries the runtime settings', payload.settings && payload.settings.windowDays === 30 && payload.settings.graceDays === 7, JSON.stringify(payload.settings))

  const cross = mockRes()
  routes['/skillpanel/skills'](mockReq({ 'sec-fetch-site': 'cross-site' }), cross)
  check('cross-site blocked', cross.status === 403, String(cross.status))

  // A new skill added to the watched root should appear (watcher debounce ~500ms),
  // 并且被**自动归类**：firecrawl-* → 网页检索，认不出来的 → 其他。
  const fs = await import('node:fs')
  fs.mkdirSync(join(scratch, 'skills', 'brand-new'), { recursive: true })
  fs.writeFileSync(join(scratch, 'skills', 'brand-new', 'SKILL.md'),
    '---\nname: brand-new\ndescription: 一个刚刚安装的新技能\ntags: [演示, demo]\n---\n\nbody')
  fs.mkdirSync(join(scratch, 'skills', 'firecrawl-probe'), { recursive: true })
  fs.writeFileSync(join(scratch, 'skills', 'firecrawl-probe', 'SKILL.md'),
    '---\nname: firecrawl-probe\ndescription: probe a website\n---\n\nbody')
  await new Promise((r) => setTimeout(r, 1600))
  const res2 = mockRes()
  routes['/skillpanel/skills'](mockReq(), res2)
  const payload2 = JSON.parse(res2.body)
  check('auto-add: new skill picked up by watcher',
    payload2.skills.some((s) => s.name === 'brand-new' && s.description === '一个刚刚安装的新技能'),
    JSON.stringify(payload2.skills))
  check('auto-category: new skill gets a category without any manual step',
    payload2.skills.every((s) => typeof s.category === 'string' && s.category !== ''))
  check('auto-category: firecrawl-probe → search',
    payload2.skills.find((s) => s.name === 'firecrawl-probe')?.category === 'search',
    JSON.stringify(payload2.skills.find((s) => s.name === 'firecrawl-probe')))
  check('auto-tags: frontmatter tags + name family',
    JSON.stringify(payload2.skills.find((s) => s.name === 'brand-new')?.tags) === JSON.stringify(['演示', 'demo', 'brand']),
    JSON.stringify(payload2.skills.find((s) => s.name === 'brand-new')?.tags))
  check('new entries expose the catalog state',
    ['resident', 'indexed'].includes(payload2.skills.find((s) => s.name === 'brand-new')?.state))

  // 置顶：POST /skillpanel/pins 写入宿主侧（新会话加载清单要用）。
  const pinRes = mockRes()
  routes['/skillpanel/pins'](mockReq({}, JSON.stringify({ pins: ['brand-new'] })), pinRes)
  const pinPayload = await waitFor(() => {
    if (!pinRes.writableEnded) return null
    return JSON.parse(pinRes.body)
  })
  check('pins route accepts a list', pinPayload?.ok === true && JSON.stringify(pinPayload.pins) === JSON.stringify(['brand-new']), pinRes.body.slice(0, 160))

  // 策略路由：置顶技能必须常驻，并带上「为什么」的说明。
  const policyRes = mockRes()
  routes['/skillpanel/policy'](mockReq(), policyRes)
  const policyPayload = JSON.parse(policyRes.body)
  check('policy route ok', policyPayload.ok === true, policyRes.body.slice(0, 160))
  check('pinned skill is resident', policyPayload.policy.resident.includes('brand-new'), JSON.stringify(policyPayload.policy.resident))
  check('policy explains why (顶标常驻)', policyPayload.policy.detail['brand-new']?.whyText === '顶标常驻', JSON.stringify(policyPayload.policy.detail['brand-new']))
  check('pins persisted in the store', JSON.stringify(policyPayload.store.pins) === JSON.stringify(['brand-new']))

  // 实时使用证据：tools/execute 里的 skill 调用（含本插件自己的加载路径）。
  const hook = (events['tools/execute'] || [])[0]
  check('tools/execute hook registered', typeof hook === 'function')
  if (typeof hook === 'function') {
    await hook({ name: 'skill', arguments: { name: 'firecrawl-probe' }, agent: { session: { id: 'session-x' } } }, async () => ({ ok: true }))
    await new Promise((r) => setTimeout(r, 1800))
    const usageRes = mockRes()
    routes['/skillpanel/usage'](mockReq(), usageRes)
    const usage = JSON.parse(usageRes.body)
    check('skill call recorded as usage',
      usage.usage.some((u) => u.name === 'firecrawl-probe' && u.calls >= 1),
      JSON.stringify(usage.usage))
  }

  // agent 作用域影子：这是**真正生效**的那条路（全局层会被 preset 层盖掉，见 lib/index.js 注释）。
  // 造一个「很久没用过」的技能 → 策略判为索引；再模拟一步 agent 运行，断言插件用该 agent 自己的
  // skills 实例把它注册成 modelInvocable=false（用户仍可调用）。
  fs.mkdirSync(join(scratch, 'skills', 'old-indexed'), { recursive: true })
  const oldSkillFile = join(scratch, 'skills', 'old-indexed', 'SKILL.md')
  fs.writeFileSync(oldSkillFile, '---\nname: old-indexed\ndescription: 一个很久没用过的技能\n---\n\nbody')
  const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
  fs.utimesSync(oldSkillFile, longAgo, longAgo)
  fs.utimesSync(join(scratch, 'skills', 'old-indexed'), longAgo, longAgo)
  await new Promise((r) => setTimeout(r, 2000))   // 等 watcher 重扫 + 策略重算

  {
    const registered = []
    const fakeScopedRegistry = {
      register: (def) => { registered.push(def); return () => {} },
      snapshot: async () => ({ skills: [{ name: 'old-indexed', invocation: { modelInvocable: false, userInvocable: true } }], complete: true }),
    }
    const fakeAgent = { ctx: { get: (n) => (n === 'skills' ? fakeScopedRegistry : undefined) } }
    const preStep = (events['agent/pre-step'] || [])[0]
    check('agent/pre-step hook registered', typeof preStep === 'function')
    if (typeof preStep === 'function') {
      await preStep({ agent: fakeAgent }, async () => ({ kind: 'continue', messages: [] }))
      const hit = registered.find((d) => d.name === 'old-indexed')
      check('agent 作用域影子：索引技能被注册为 modelInvocable=false',
        hit !== undefined && hit.invocation.modelInvocable === false && hit.invocation.userInvocable === true,
        JSON.stringify(registered.map((d) => d.name)))
      check('agent 作用域影子带正文与描述（用户 /技能名 仍能用）',
        hit !== undefined && typeof hit.content === 'string' && hit.content.length > 0 && hit.description !== '')
      const before = registered.length
      await preStep({ agent: fakeAgent }, async () => ({ kind: 'continue', messages: [] }))
      check('同一 agent 同策略修订内不重复注册', registered.length === before, String(registered.length))
    }
    const shadowRes = mockRes()
    routes['/skillpanel/skills'](mockReq(), shadowRes)
    const shadowPayload = JSON.parse(shadowRes.body)
    check('列表接口暴露影子自查结果（避免再次静默失效）',
      shadowPayload.shadow !== undefined && shadowPayload.shadow.agentScoped >= 1,
      JSON.stringify(shadowPayload.shadow))
  }

  // 技能索引文档 skills.md（上游并入：按分类分组 + 带 SKILL.md 绝对路径 + 清单标注）
  const doc = internals.renderSkillsDoc(payload2.skills, '2026-10-12T00:00:00.000Z', null)
  check('skills.md 渲染出分类分组标题', doc.includes('## 网页检索（1）'), doc.split('\n').slice(0, 10).join(' | '))
  check('skills.md 带 /技能名 与绝对路径', /- `\/firecrawl-probe` — .*路径：`.*firecrawl-probe.*SKILL\.md`/.test(doc), doc.split('\n').filter((l) => l.includes('firecrawl-probe')).join(' | '))
  check('skills.md 确定性（同输入同输出）', internals.renderSkillsDoc(payload2.skills, '2026-10-12T00:00:00.000Z', null) === doc)
  check('skills.md 超长描述截断', internals.oneLineSummary('x'.repeat(200)).length === 81, String(internals.oneLineSummary('x'.repeat(200)).length))
  check('skills.md 空描述有兜底', internals.oneLineSummary('') === '（无描述）')
  check('skills.md 无数据也能渲染', internals.renderSkillsDoc([], '2026-10-12T00:00:00.000Z', null).includes('技能总数：**0**'))
  check('skills.md 标注常驻/索引', internals.renderSkillsDoc(payload2.skills, 'x', {
    windowDays: 30,
    stats: { resident: 1, indexed: 1 },
    detail: { 'firecrawl-probe': { state: 'resident' } },
  }).includes('`/firecrawl-probe`（常驻）'))
  check('列表接口给出 docPath', typeof payload2.docPath === 'string' && payload2.docPath.endsWith('skills.md'), String(payload2.docPath))
  check('skills.md 已落盘', existsSync(internals.skillsDocFile()), internals.skillsDocFile())

  // Cache file written.
  const cacheText = readFileSync(internals.cacheFile(), 'utf8')
  const cache = JSON.parse(cacheText)
  check('cache file persisted', Array.isArray(cache.skills) && cache.skills.some((s) => s.name === 'brand-new'), cacheText.slice(0, 120))

  // Disposer runs without throwing and clears timers/watchers.
  lifecycleDisposer()
  check('disposer ran', true)

  // Cleanup scratch + cache temp dirs.
  await import('node:fs/promises').then((fsp) => Promise.allSettled([
    fsp.rm(scratch, { recursive: true, force: true }),
    fsp.rm(cacheTmp, { recursive: true, force: true }),
  ]))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
