/**
 * Harness for the dsh-skill-sidebar client half: executes the factory exactly
 * as the browser module loader would (window.__ModuleLoader__.load + a require
 * that resolves react / primitives), then verifies the exported cordis plugin
 * contract (inject / apply) and the pure helpers (mergeLists, cache round-trip,
 * Monday detection).
 */
let handoff = null
globalThis.window = {
  __ModuleLoader__: {
    load: (h) => { handoff = h },
  },
}
globalThis.document = undefined

// localStorage stub (browser API shape).
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const reactStub = {
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: (type, props, ...children) => ({ type, props, children }),
}
const primitivesStub = { IconSkillOutline16: () => null }

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok: ${name}`)
  } else {
    failures++
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

await import('./dsh-skill-sidebar/lib/client.js')

check('module registered with __ModuleLoader__', handoff !== null && handoff.id === 'dsh-skill-sidebar', JSON.stringify(handoff))

let mod = null
let factoryError = null
try {
  mod = handoff.factory((spec) => {
    if (spec === 'react') return reactStub
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${spec}`)
  })
} catch (e) {
  factoryError = e
}
check('factory runs with react + primitives', factoryError === null, String(factoryError))
check('exports.inject declares betterSidebar', Array.isArray(mod.inject) && mod.inject.includes('betterSidebar') && mod.inject.includes('connection') && mod.inject.includes('sessions'), JSON.stringify(mod.inject))
check('exports.apply is a function', typeof mod.apply === 'function')
check('exports.internals present', !!mod.internals, JSON.stringify(mod.internals))

/* ---- mergeLists ---- */
{
  const M = mod.internals.mergeLists
  const live = [
    { name: 'b-skill', description: 'live b' },
    { name: 'a-skill', description: 'live a' },
  ]
  const machine = [
    { name: 'b-skill', description: 'machine b (should lose)', phrases: ['短语B1', '短语B2'] },
    { name: 'c-skill', description: 'machine only', phrases: ['短语C'] },
    { name: 'd-skill', description: 'machine d' },
  ]
  const merged = M(live, machine)
  check('merge union size', merged.length === 4, JSON.stringify(merged.map((s) => s.name)))
  check('merge sorted', merged.map((s) => s.name).join(',') === 'a-skill,b-skill,c-skill,d-skill', JSON.stringify(merged.map((s) => s.name)))
  check('primary wins on duplicate', merged.find((s) => s.name === 'b-skill').description === 'live b')
  check('primary without phrases keeps secondary phrases', merged.find((s) => s.name === 'b-skill').phrases.join(',') === '短语B1,短语B2')
  check('secondary-only kept', merged.find((s) => s.name === 'c-skill').description === 'machine only')
  check('secondary-only phrases kept', merged.find((s) => s.name === 'c-skill').phrases.join(',') === '短语C')
  check('merge tolerates null secondary', M(live, null).length === 2)
  check('merge tolerates junk entries', M([{ name: '' }, { name: 5 }, null], [{ name: 'ok', description: 'x' }]).length === 1)
}

/* ---- phraseRow / fullTextOf ---- */
{
  const I = mod.internals
  const r1 = I.phraseRow(['邮件收发', '附件下载', '收件箱管理', '邮件搜索', '邮件转发'])
  check('phraseRow shows 4 + more count', r1.text === '邮件收发，附件下载，收件箱管理，邮件搜索' && r1.more === 1, JSON.stringify(r1))
  const r2 = I.phraseRow(['日程管理', '会议预定'])
  check('phraseRow under limit has no more', r2.text === '日程管理，会议预定' && r2.more === 0, JSON.stringify(r2))
  check('phraseRow tolerates empty/missing', I.phraseRow(null).text === '' && I.phraseRow([]).more === 0)
  const full = I.fullTextOf({ description: '完整描述文本', whenToUse: 'x 时使用' })
  check('fullTextOf joins description + whenToUse', full.includes('完整描述文本') && full.includes('适用：x 时使用'), JSON.stringify(full))
  check('fullTextOf handles missing whenToUse', I.fullTextOf({ description: '只有描述' }) === '只有描述')
}

/* ---- pins ---- */
{
  const I = mod.internals
  check('togglePinIn adds', I.togglePinIn(['a'], 'b').join(',') === 'a,b')
  check('togglePinIn removes', I.togglePinIn(['a', 'b'], 'a').join(',') === 'b')
  const skills = [
    { name: 'b-skill' }, { name: 'a-skill' }, { name: 'pinned-skill' },
  ]
  const sorted = I.sortPinnedFirst(skills, ['pinned-skill', 'missing'])
  check('pinned first', sorted[0].name === 'pinned-skill', JSON.stringify(sorted.map((s) => s.name)))
  check('rest keeps order', sorted[1].name === 'b-skill' && sorted[2].name === 'a-skill')
  check('no pins keeps order', I.sortPinnedFirst(skills, []).map((s) => s.name).join(',') === 'b-skill,a-skill,pinned-skill')
  I.writePins(['x', 'y'])
  check('pins round-trip', I.readPins().join(',') === 'x,y', JSON.stringify(I.readPins()))
  localStorage.removeItem('dsh-skill-sidebar:pins:v1')
  check('pins miss -> empty', I.readPins().length === 0)
}

/* ---- cache round-trip ---- */
{
  const I = mod.internals
  const skills = [{ name: 'foo', description: 'Foo 描述' }]
  I.writeLocalCache(skills, '2026-08-14T00:00:00.000Z')
  const cached = I.readLocalCache()
  check('cache round-trip', Array.isArray(cached.skills) && cached.skills[0].name === 'foo' && cached.refreshedDate === I.todayStr(), JSON.stringify(cached))
  localStorage.removeItem('dsh-skill-sidebar:cache:v1')
  check('cache miss -> null', I.readLocalCache() === null)
}

/* ---- monday detection ---- */
{
  const I = mod.internals
  const d = new Date()
  check('isMonday matches Date#getDay', I.isMonday() === (d.getDay() === 1))
  check('todayStr format', /^\d{4}-\d{2}-\d{2}$/.test(I.todayStr()))
  check('POLL_MS sane', I.POLL_MS >= 5000 && I.POLL_MS <= 120000)
}

console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CLIENT CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
