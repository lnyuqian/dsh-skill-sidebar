/**
 * Standalone harness for the dsh-skill-sidebar host half: verifies the
 * frontmatter parser against real SKILL.md files, runs the scan over the real
 * skill root, and boots the plugin body with a mock cordis ctx to exercise the
 * routes, the cache file, and the disposer.
 *
 * It also covers the v0.3 host additions: the per-entry `path` + `category`
 * fields, the CATEGORY_RULES table, the generated `skills.md` index, and the
 * `categories` / `docPath` fields on both routes.
 */
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { apply, internals, CATEGORIES } from './lib/index.js'

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

/* ---- 1c. category rules (ordered table, first hit wins) ---- */
console.log('\n[1c] category rules')
{
  const { categorize, CATEGORY_RULES, oneLineSummary } = internals
  const cases = [
    ['lark-im', '飞书 / Lark'],
    ['dsh-web-sidebar-plugin-fix', 'DSH / 插件'],
    ['firecrawl-parse', '检索 / 抓取'],
    ['aria-icons', '图像 / 视觉'],
    ['bilibili-downloader', '视频 / 音频'],
    ['jieqi-converter', '文档 / 表格'],
    ['agently-mail', '内容 / 发布'],
    ['n8n-architect', '自动化 / n8n'],
    ['electron-green-packaging', '开发 / 环境'],
    ['some-unknown-skill', '其他'],
  ]
  let mismatched = 0
  for (const [skillName, want] of cases) {
    const got = categorize(skillName, '')
    if (got !== want) {
      mismatched++
      console.error(`    ${skillName}: got ${got}, want ${want}`)
    }
  }
  check('10 rule-table cases classify as specified', mismatched === 0, `${mismatched} mismatched`)
  check('CATEGORIES is the 10 names in table order',
    CATEGORIES.length === 10 && CATEGORIES[0] === '飞书 / Lark' && CATEGORIES[8] === '开发 / 环境' && CATEGORIES[9] === '其他',
    JSON.stringify(CATEGORIES))
  check('CATEGORY_RULES is an ordered 10-entry table ending in the fallback',
    Array.isArray(CATEGORY_RULES) && CATEGORY_RULES.length === 10
      && CATEGORY_RULES[0].category === CATEGORIES[0]
      && CATEGORY_RULES[9].category === '其他' && CATEGORY_RULES[9].fallback === true,
    JSON.stringify(CATEGORY_RULES.map((r) => r.category)))
  check('name wins over description', categorize('watch', '图像 图片 图标') === '视频 / 音频')
  check('rule order: lark- prefix beats the plugin keyword', categorize('lark-plugin-fix', '') === '飞书 / Lark')
  check('description fallback applies when the name misses',
    categorize('zzz-unknown', '把 PDF 转成 Markdown 文档') === '文档 / 表格')
  check('unknown name + unknown description -> 其他', categorize('zzz-unknown', 'nothing relevant here') === '其他')
  check('empty input -> 其他', categorize('', '') === '其他')
  check('one-line summary is flattened and truncated',
    oneLineSummary(`a${'b'.repeat(200)}`).length === 81 && oneLineSummary(' x \n y ').indexOf('\n') === -1
      && oneLineSummary(' x \n y ') === 'x y' && oneLineSummary('') === '（无描述）',
    JSON.stringify([oneLineSummary(`a${'b'.repeat(200)}`).length, oneLineSummary(' x \n y ')]))
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

/* ---- 2b. path + category + generated skills.md (real roots) ---- */
console.log('\n[2b] entry path / category + skills.md')
{
  // Real roots, but a scratch cache dir so the machine's real skills.json and
  // skills.md are never touched by the test run.
  const docCacheTmp = mkdtempSync(join(process.cwd(), '.dss-doc-'))
  const prevCacheDir = process.env.DSH_SKILL_CACHE_DIR
  process.env.DSH_SKILL_CACHE_DIR = docCacheTmp
  try {
    const skills = await internals.scanSkills()

    // 1. every entry carries an absolute path that exists on disk.
    const realFile = (p) => {
      if (typeof p !== 'string' || p === '' || !isAbsolute(p)) return false
      try {
        return existsSync(p) && statSync(p).isFile()
      } catch {
        return false
      }
    }
    const badPath = skills.filter((s) => !realFile(s.path))
    check('every entry has an absolute, existing path', badPath.length === 0,
      JSON.stringify(badPath.slice(0, 3).map((s) => [s.name, s.path])))
    const dirSkill = skills.find((s) => s.name === 'lark-im')
    check('directory skill path points at its SKILL.md',
      !!dirSkill && dirSkill.path.toLowerCase().endsWith(join('lark-im', 'SKILL.md').toLowerCase()),
      String(dirSkill && dirSkill.path))

    // 2. category is always one of the 10 names, with at most 10 distinct.
    const badCategory = skills.filter((s) => !CATEGORIES.includes(s.category))
    check('every entry category ∈ CATEGORIES', badCategory.length === 0, JSON.stringify(badCategory.slice(0, 3)))
    const distinct = new Set(skills.map((s) => s.category))
    check('distinct categories <= 10', distinct.size <= 10, `${distinct.size}`)
    check('categories cover the machine skills', distinct.size >= 5, JSON.stringify([...distinct]))

    // 3. scan -> cache + skills.md, in the SAME directory.
    const persisted = await internals.persistScan(skills)
    const expectedDoc = join(docCacheTmp, 'skills.md')
    check('persistScan reports the sibling skills.md as docPath',
      persisted.docPath === expectedDoc && isAbsolute(persisted.docPath) && existsSync(persisted.docPath),
      `${persisted.docPath} vs ${expectedDoc}`)
    const cacheBack = JSON.parse(readFileSync(join(docCacheTmp, 'skills.json'), 'utf8'))
    check('cache keeps skills/scannedAt/roots and the new fields',
      Array.isArray(cacheBack.skills) && typeof cacheBack.scannedAt === 'string' && typeof cacheBack.roots === 'string'
        && cacheBack.skills.every((s) => typeof s.path === 'string' && typeof s.category === 'string'),
      cacheBack.scannedAt)

    const doc = readFileSync(persisted.docPath, 'utf8')
    const missingNames = skills.filter((s) => !doc.includes(`\`/${s.name}\``))
    check('skills.md mentions every skill name', missingNames.length === 0,
      JSON.stringify(missingNames.slice(0, 3).map((s) => s.name)))
    const missingPaths = skills.filter((s) => !doc.includes(s.path))
    check('skills.md mentions every absolute path', missingPaths.length === 0,
      JSON.stringify(missingPaths.slice(0, 3).map((s) => s.name)))
    const headers = CATEGORIES
      .map((category) => [category, skills.filter((s) => s.category === category).length])
      .filter(([, count]) => count > 0)
    const badHeaders = headers.filter(([category, count]) => !doc.includes(`## ${category}（${count}）`))
    check('skills.md has a `## <分类>（n）` header for every non-empty category', badHeaders.length === 0,
      JSON.stringify(badHeaders))
    const headerLines = doc.match(/^## .+$/gm) || []
    check('skills.md omits empty categories', headerLines.length === headers.length,
      `${headerLines.length} headers vs ${headers.length} non-empty`)
    check('skills.md header block carries the totals',
      doc.startsWith('# DSH 技能索引（自动生成）')
        && doc.includes(`共 ${skills.length} 个技能 / ${headers.length} 个分类`),
      doc.split('\n').slice(3, 5).join(' | '))
    check('skills.md line format is `- \\`/name\\` — … · 路径：\\`abs\\``',
      /\n- `\/[^`]+` — [^\n]+ · 路径：`[A-Za-z]:\\[^`]+`\n/.test(doc) || /\n- `\/[^`]+` — [^\n]+ · 路径：`\/[^`]+`\n/.test(doc),
      doc.split('\n').filter((l) => l.startsWith('- '))[0] || '')
    const stamp = '2026-01-02T03:04:05.000Z'
    check('skills.md rendering is deterministic/idempotent',
      internals.renderSkillsDoc(skills, stamp) === internals.renderSkillsDoc(skills, stamp)
        && doc === internals.renderSkillsDoc(skills, cacheBack.scannedAt),
      'second render differs')
    const bigLine = doc.split('\n').filter((l) => l.startsWith('- ')).find((l) => l.includes('…'))
    check('long descriptions are truncated with an ellipsis', bigLine !== undefined && bigLine.length < 400,
      String(bigLine).slice(0, 80))
    check('skills.md ends with the generated-by note', doc.trimEnd().endsWith('本文件由插件自动生成。'),
      JSON.stringify(doc.slice(-40)))
  } finally {
    if (prevCacheDir === undefined) delete process.env.DSH_SKILL_CACHE_DIR
    else process.env.DSH_SKILL_CACHE_DIR = prevCacheDir
    await import('node:fs/promises').then((fsp) => fsp.rm(docCacheTmp, { recursive: true, force: true }))
  }
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
  check('route carries categories (10, in order)',
    Array.isArray(payload.categories) && payload.categories.length === 10
      && payload.categories.every((c, i) => c === CATEGORIES[i]),
    JSON.stringify(payload.categories))
  check('route carries an absolute docPath next to skills.json',
    typeof payload.docPath === 'string' && isAbsolute(payload.docPath)
      && payload.docPath === join(cacheTmp, 'skills.md') && existsSync(payload.docPath),
    String(payload.docPath))
  check('empty scan still writes skills.md',
    readFileSync(payload.docPath, 'utf8').includes('# DSH 技能索引（自动生成）'), payload.docPath)

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
  const added = payload2.skills.find((s) => s.name === 'brand-new')
  check('auto-added entry has path + category',
    !!added && isAbsolute(added.path) && existsSync(added.path) && CATEGORIES.includes(added.category),
    JSON.stringify(added))
  const docAfterWatch = readFileSync(payload2.docPath, 'utf8')
  check('skills.md refreshed by the watcher rescan mentions the new skill and its path',
    docAfterWatch.includes('`/brand-new`') && docAfterWatch.includes(added.path)
      && docAfterWatch.includes(`## ${added.category}（1）`),
    docAfterWatch)

  // Refresh route: same envelope (including categories/docPath).
  const res3 = mockRes()
  routes['/skillpanel/skills/refresh'](mockReq(), res3)
  await new Promise((r) => setTimeout(r, 900))
  const payload3 = JSON.parse(res3.body || '{}')
  check('refresh route 200 + ok', res3.status === 200 && payload3.ok === true, `${res3.status} ${res3.body.slice(0, 80)}`)
  check('refresh route carries categories + docPath',
    Array.isArray(payload3.categories) && payload3.categories.length === 10
      && payload3.docPath === join(cacheTmp, 'skills.md') && isAbsolute(payload3.docPath),
    JSON.stringify([payload3.categories && payload3.categories.length, payload3.docPath]))
  check('refresh route still returns the scanned skills',
    Array.isArray(payload3.skills) && payload3.skills.some((s) => s.name === 'brand-new'), res3.body.slice(0, 120))

  const crossRefresh = mockRes()
  routes['/skillpanel/skills/refresh'](mockReq({ 'sec-fetch-site': 'cross-site' }), crossRefresh)
  check('refresh route fenced too', crossRefresh.status === 403, String(crossRefresh.status))

  // Cache file written.
  const cacheText = readFileSync(internals.cacheFile(), 'utf8')
  const cache = JSON.parse(cacheText)
  check('cache file persisted', Array.isArray(cache.skills) && cache.skills.some((s) => s.name === 'brand-new'), cacheText.slice(0, 120))
  check('cache entry keeps path + category',
    cache.skills.filter((s) => s.name === 'brand-new').every((s) => typeof s.path === 'string' && typeof s.category === 'string'),
    cacheText.slice(0, 200))

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
