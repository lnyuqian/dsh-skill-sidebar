/**
 * Harness for the dsh-skill-sidebar client half.
 *
 * Executes the factory exactly as the browser module loader would
 * (window.__ModuleLoader__.load + a require that resolves react / primitives),
 * then verifies:
 *  - the cordis plugin contract (inject / apply);
 *  - the OFFICIAL right-Sidebar two-stage registration: the page type in
 *    `ctx.sidebarRightTabs.register` and the body + chip under
 *    `sidebar.right.pane.tab(.title)` keyed by the definition's id;
 *  - auto-open through `ctx.sidebarRight.openTab` (retry until a seat exists,
 *    once per session, bounded);
 *  - the body component consumes the framework `useTabInfo()` hook and renders;
 *  - the pure helpers (mergeLists, phraseRow, cache round-trip, Monday).
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

/* A tiny React stand-in: `useState` seeds from its initializer and never
   updates, `useMemo`/`useCallback` run through, and `createElement` records a
   plain tree so a render can be inspected. */
function makeReactStub() {
  return {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: Symbol('Fragment'),
  }
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

await import('./lib/client.js')

check('module registered with __ModuleLoader__', handoff !== null && handoff.id === 'dsh-skill-sidebar', JSON.stringify(handoff))

let mod = null
let factoryError = null
try {
  mod = handoff.factory((spec) => {
    if (spec === 'react') return makeReactStub()
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${spec}`)
  })
} catch (e) {
  factoryError = e
}

check('factory runs with react + primitives', factoryError === null, String(factoryError))
check(
  'exports.inject declares the official sidebar services',
  Array.isArray(mod.inject)
    && mod.inject.includes('slots')
    && mod.inject.includes('sidebarRightTabs')
    && mod.inject.includes('sidebarRight')
    && mod.inject.includes('connection')
    && mod.inject.includes('sessions')
    && !mod.inject.includes('betterSidebar'),
  JSON.stringify(mod.inject),
)
check('exports.apply is a function', typeof mod.apply === 'function')
check('exports.internals present', !!mod.internals, JSON.stringify(mod.internals))

/* ------------------------------------------------------------------ */
/* official registration contract                                      */
/* ------------------------------------------------------------------ */

/**
 * A minimal cordis client context: `effect` runs its callback at once and keeps
 * the disposer, the slot/registry faces record every contribution, and the
 * session list + navigation faces are scripted per test.
 */
function makeCtx(opts) {
  const o = opts || {}
  const rec = {
    effects: [],
    types: [],
    slots: [],
    injections: [],
    openTab: [],
    disposeAll() {
      for (const dispose of rec.effects.slice().reverse()) {
        try { dispose() } catch (e) { /* ignore */ }
      }
    },
  }
  const sessionListeners = []
  const sessions = {
    list: {
      subscribe: (fn) => {
        sessionListeners.push(fn)
        return () => {
          const i = sessionListeners.indexOf(fn)
          if (i >= 0) sessionListeners.splice(i, 1)
        }
      },
      getSnapshot: () => ({ current: o.current === undefined ? 'session-1' : o.current }),
    },
  }
  const ctx = {
    effect(callback) {
      const dispose = callback()
      rec.effects.push(typeof dispose === 'function' ? dispose : () => {})
      return dispose
    },
    get(name) {
      if (name === 'sessions') return sessions
      if (name === 'connection') return { api: { skills: { list: async () => ({ result: { ok: true, value: { skills: [] } } }) } } }
      return undefined
    },
    sidebarRightTabs: {
      register(definition) { rec.types.push(definition); return () => {} },
    },
    sidebarRight: {
      openTab(kind, options) {
        if (o.openTabThrows && o.openTabThrows()) throw new Error('no mounted surface')
        rec.openTab.push({ kind, options })
      },
    },
    slots: {
      inject(name, callback) { rec.injections.push(name); return callback() },
      register(options, component) { rec.slots.push({ options, component }); return () => {} },
    },
  }
  return { ctx, rec, sessionListeners }
}

/* Run `body` with timers firing synchronously, so the auto-open retry loop is
   exercised without waiting. */
function withImmediateTimers(body) {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = (fn) => { fn(); return 0 }
  globalThis.clearTimeout = () => {}
  try {
    return body()
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
}

{
  const { ctx, rec } = makeCtx({ current: 'session-1' })
  withImmediateTimers(() => mod.apply(ctx))

  check('registers exactly one tab type', rec.types.length === 1, JSON.stringify(rec.types.length))
  const type = rec.types[0] || {}
  check('type id identifies the implementation', type.id === 'dsh-skill-sidebar', String(type.id))
  check('type kind is the skills page kind', type.kind === 'skills', String(type.kind))
  check('type declares no resource patterns (a page type)', type.patterns === undefined, JSON.stringify(type.patterns))
  check('type is an out-of-product extension band', type.priority === 'extension', String(type.priority))
  check('type title is 技能', type.title('sidebar://skills') === '技能', String(type.title('sidebar://skills')))
  check('type offers one guide entry', Array.isArray(type.guide) && type.guide.length === 1, JSON.stringify(type.guide))
  check(
    'guide entry carries order/title/description/icon',
    !!type.guide && type.guide[0].order === 20 && type.guide[0].title() === '技能'
      && typeof type.guide[0].description() === 'string' && typeof type.guide[0].icon === 'function',
    JSON.stringify(type.guide && type.guide[0]),
  )
  check('guide entry order after the official files entry (10)', type.guide[0].order > 10)

  check(
    'injects the body seat and the title seat',
    rec.injections.includes('sidebar.right.pane.tab') && rec.injections.includes('sidebar.right.pane.tab.title'),
    JSON.stringify(rec.injections),
  )
  check('registers exactly two slots (body + chip)', rec.slots.length === 2, JSON.stringify(rec.slots.map((s) => s.options && s.options.name)))
  const body = rec.slots.find((s) => s.options.name === 'sidebar.right.pane.tab')
  const title = rec.slots.find((s) => s.options.name === 'sidebar.right.pane.tab.title')
  check('body registered under the definition id', !!body && body.options.key === 'dsh-skill-sidebar', JSON.stringify(body && body.options))
  check('title registered under the definition id', !!title && title.options.key === 'dsh-skill-sidebar', JSON.stringify(title && title.options))
  check('both seats are components', typeof (body && body.component) === 'function' && typeof (title && title.component) === 'function')
  check('body injects the business face (ctx)', !!body && typeof body.options.inject === 'function' && body.options.inject('session-1').ctx === ctx)

  // Auto-open: the sessions subscription plus the immediate safety-net timer.
  check('auto-opens the skills tab once', rec.openTab.length === 1 && rec.openTab[0].kind === 'skills', JSON.stringify(rec.openTab))
  // Disposal clears the subscription and every pending timer.
  rec.disposeAll()
}

{
  // openTab keeps throwing (no seat ever mounts): the loop is bounded, not endless.
  let calls = 0
  const { ctx, rec } = makeCtx({ current: 'session-1', openTabThrows: () => { calls++; return true } })
  withImmediateTimers(() => mod.apply(ctx))
  check('bounded retries when no surface mounts', calls === 25, String(calls))
  check('nothing recorded when every open throws', rec.openTab.length === 0)
  rec.disposeAll()
}

{
  // The seat arrives late: fail twice, then succeed, and stop retrying.
  let calls = 0
  const { ctx, rec } = makeCtx({ current: 'session-1', openTabThrows: () => { calls++; return calls <= 2 } })
  withImmediateTimers(() => mod.apply(ctx))
  check('retries until the surface mounts, then stops', calls === 3, String(calls))
  check('the successful open is recorded once', rec.openTab.length === 1 && rec.openTab[0].kind === 'skills', JSON.stringify(rec.openTab))
  rec.disposeAll()
}

/* ------------------------------------------------------------------ */
/* the body component renders against the framework hook               */
/* ------------------------------------------------------------------ */
{
  const { ctx, rec } = makeCtx({ current: 'session-1' })
  // apply() only to obtain the registered component; no timers needed here.
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = () => 0
  globalThis.clearTimeout = () => {}
  try {
    mod.apply(ctx)
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }

  const bodyEntry = rec.slots.find((s) => s.options.name === 'sidebar.right.pane.tab')
  const useTabInfo = () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: { id: 'tab-1', kind: 'skills', title: '技能', visible: true, signal: { aborted: false }, actions: {} },
  })
  let tree = null
  let renderError = null
  try {
    tree = bodyEntry.component({ useTabInfo, sessionId: 'session-1', ctx })
  } catch (e) { renderError = e }
  check('body renders without error', renderError === null, String(renderError && renderError.stack))
  check('body root carries the plugin marker', !!tree && tree.props.className === 'dss-root' && tree.props['data-dsh-skill-sidebar'] === 'body', JSON.stringify(tree && tree.props))
  const search = tree && tree.children[1]
  const input = search && search.children[0]
  check('body renders the search box', !!input && input.props.placeholder === '搜索技能名称或描述…', JSON.stringify(input && input.props))
  const foot = tree && tree.children[4]
  check('body renders the source footer', !!foot && JSON.stringify(foot.children).includes('来源：'), JSON.stringify(foot && foot.children))
  rec.disposeAll()
}

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
  check('AUTO_OPEN on by default', I.AUTO_OPEN === true)
}

console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CLIENT CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
