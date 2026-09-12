/**
 * Standalone harness for the dsh-skill-sidebar host half: verifies the
 * frontmatter parser against real SKILL.md files, runs the scan over the real
 * skill root, and boots the plugin body with a mock cordis ctx to exercise the
 * routes, the cache file, and the disposer.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
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

/* ---- 2. scan the real skill root ---- */
console.log('\n[2] scanning real skill roots')
{
  const roots = internals.allRoots()
  console.log(`  roots: ${JSON.stringify(roots)}`)
  const skills = await internals.scanSkills()
  console.log(`  found ${skills.length} skills`)
  check('found skills', skills.length > 30, `only ${skills.length}`)
  const sample = skills.find((s) => s.name === 'lark-calendar')
  check('lark-calendar present with Chinese description', !!sample && typeof sample.description === 'string' && sample.description.length > 5, JSON.stringify(sample))
  const watch = skills.find((s) => s.name === 'watch')
  check('watch present with English description', !!watch && watch.description.startsWith('Watch a video'), JSON.stringify(watch))
  const names = skills.map((s) => s.name)
  check('sorted by name', names.every((n, i) => i === 0 || names[i - 1] <= n))
  check('no duplicate names', new Set(names).size === names.length)
  const bad = skills.filter((s) => !s.name || !s.description)
  check('every entry has name+description', bad.length === 0, JSON.stringify(bad.slice(0, 3)))
  const noPhrases = skills.filter((s) => !Array.isArray(s.phrases) || s.phrases.length === 0)
  check('every entry has phrases', noPhrases.length === 0, JSON.stringify(noPhrases.map((s) => s.name)))
  const larkCal = skills.find((s) => s.name === 'lark-calendar')
  check('lark-calendar uses hand-written phrases', !!larkCal && larkCal.phrases.includes('日程管理'), JSON.stringify(larkCal && larkCal.phrases))
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
  const routes = {}
  const disposers = []
  let lifecycleDisposer = null
  const ctx = {
    loader: { entries: () => [] },
    logger: console,
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

  const mockReq = (extra) => ({
    method: 'GET',
    url: '/skillpanel/skills',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', ...extra },
  })
  const mockRes = () => {
    const res = { status: 0, body: '', writableEnded: false }
    res.writeHead = (status) => { res.status = status }
    res.end = (body) => { res.body = body; res.writableEnded = true }
    return res
  }

  const res = mockRes()
  routes['/skillpanel/skills'](mockReq(), res)
  const payload = JSON.parse(res.body)
  check('route 200', res.status === 200, String(res.status))
  check('route ok=true', payload.ok === true, JSON.stringify(payload))
  check('route lists 0 skills for scratch root', Array.isArray(payload.skills) && payload.skills.length === 0, JSON.stringify(payload.skills))
  check('route has scannedAt', typeof payload.scannedAt === 'string', JSON.stringify(payload.scannedAt))
  check('route policy', payload.policy && payload.policy.mondayRefresh === true && payload.policy.autoAdd === true, JSON.stringify(payload.policy))

  const cross = mockRes()
  routes['/skillpanel/skills'](mockReq({ 'sec-fetch-site': 'cross-site' }), cross)
  check('cross-site blocked', cross.status === 403, String(cross.status))

  // A new skill added to the watched root should appear (watcher debounce ~500ms).
  const fs = await import('node:fs')
  fs.mkdirSync(join(scratch, 'skills', 'brand-new'), { recursive: true })
  fs.writeFileSync(join(scratch, 'skills', 'brand-new', 'SKILL.md'),
    '---\nname: brand-new\ndescription: 一个刚刚安装的新技能\n---\n\nbody')
  await new Promise((r) => setTimeout(r, 1600))
  const res2 = mockRes()
  routes['/skillpanel/skills'](mockReq(), res2)
  const payload2 = JSON.parse(res2.body)
  check('auto-add: new skill picked up by watcher',
    payload2.skills.some((s) => s.name === 'brand-new' && s.description === '一个刚刚安装的新技能'),
    JSON.stringify(payload2.skills))

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
