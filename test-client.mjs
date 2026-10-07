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

/* A tiny React stand-in: `createElement` records a plain tree so a render can
   be inspected. Hook cells persist across renders of the same component, so
   `__reset()` starts a component fresh while `__begin()` re-renders it against
   the current cells (which is how a scripted setState is inspected). */
function makeReactStub() {
  const cells = []
  let hookIndex = 0
  return {
    useState: (init) => {
      const i = hookIndex++
      if (!(i in cells)) cells[i] = typeof init === 'function' ? init() : init
      return [cells[i], (v) => { cells[i] = typeof v === 'function' ? v(cells[i]) : v }]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: Symbol('Fragment'),
    __reset: () => { hookIndex = 0; cells.length = 0 },
    __begin: () => { hookIndex = 0 },
  }
}
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
const reactStub = makeReactStub()
try {
  mod = handoff.factory((spec) => {
    if (spec === 'react') return reactStub
    throw new Error(`unexpected require: ${spec}`)
  })
} catch (e) {
  factoryError = e
}

check('factory runs with react alone (no official primitives dependency)', factoryError === null, String(factoryError))
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
/* tree helpers + a scriptable render of the body component            */
/* ------------------------------------------------------------------ */

/** Every element node in a recorded tree, depth first. */
function collectNodes(node, acc) {
  const out = acc || []
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) collectNodes(n, out)
    return out
  }
  if (!('props' in node)) return out
  out.push(node)
  for (const k of (Array.isArray(node.children) ? node.children : [])) collectNodes(k, out)
  return out
}

/** The concatenated text content of a node (strings + template holes). */
function nodeText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && Array.isArray(node.children)) return node.children.map(nodeText).join('')
  return ''
}

/** The category header rows (role="button" + a `dss-cat*` class). */
function catHeaders(tree) {
  return collectNodes(tree).filter((n) => n.props && n.props.role === 'button'
    && typeof n.props.className === 'string' && n.props.className.indexOf('dss-cat') === 0)
}

/** The rendered skill rows, in render order. */
function skillRows(tree) {
  return collectNodes(tree).filter((n) => n.props && n.props.className === 'dss-row')
}

/** The skill names of the rendered rows, in render order. */
function rowNames(tree) {
  return skillRows(tree).map((row) => {
    const name = collectNodes(row).find((n) => n.props && n.props.className === 'dss-name')
    return name ? nodeText(name) : ''
  })
}

/** The header text of the category whose name matches, or null. */
function headerText(tree, name) {
  const head = catHeaders(tree).find((h) => h.props['data-dss-cat'] === name)
  return head ? nodeText(head) : null
}

/** Register the plugin once and hand back the body component it registered. */
function captureBody() {
  const { ctx, rec } = makeCtx({ current: 'session-1' })
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = () => 0
  globalThis.clearTimeout = () => {}
  try { mod.apply(ctx) } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
  const entry = rec.slots.find((s) => s.options.name === 'sidebar.right.pane.tab')
  return { component: entry.component, ctx, rec }
}

const TAB_INFO = () => ({
  sidebar: { expanded: true, fullscreen: false },
  panel: { id: 'pane-1' },
  tab: { id: 'tab-1', kind: 'skills', title: '技能', visible: true, signal: { aborted: false }, actions: {} },
})

/** Render the body with fresh hook cells. */
function renderFresh(component, ctx) {
  reactStub.__reset()
  return component({ useTabInfo: TAB_INFO, sessionId: 'session-1', ctx })
}

/** Re-render the body against the cells the previous render left behind. */
function renderAgain(component, ctx) {
  reactStub.__begin()
  return component({ useTabInfo: TAB_INFO, sessionId: 'session-1', ctx })
}

/** Type into the search box (scripted onChange), then re-render. */
function typeQuery(component, ctx, tree, value) {
  const input = collectNodes(tree).find((n) => n.type === 'input')
  if (!input) throw new Error('no search input in the rendered tree')
  input.props.onChange({ target: { value } })
  return renderAgain(component, ctx)
}

/* ------------------------------------------------------------------ */
/* the official registration contract                                  */
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
  check('bounded retries when no surface mounts', calls === 60, String(calls))
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

/* ---- panel chrome: own glyph, stay-open close rule ---- */
{
  const { ctx, rec } = makeCtx({ current: 'session-1' })
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = () => 0
  globalThis.clearTimeout = () => {}
  try { mod.apply(ctx) } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
  const titleEntry = rec.slots.find((s) => s.options.name === 'sidebar.right.pane.tab.title')
  const useTabInfo = () => ({ tab: { id: 'tab-1', kind: 'skills', title: '技能', visible: true } })
  let tree = null
  let renderError = null
  try { tree = titleEntry.component({ useTabInfo }) } catch (e) { renderError = e }
  check('chip renders without error', renderError === null, String(renderError && renderError.message))
  check(
    'chip marks its own tab for the stay-open rule',
    !!tree && tree.props.className === 'dss-chip' && tree.props['data-dsh-skills-chip'] === '1',
    JSON.stringify(tree && tree.props),
  )
  const glyphEl = tree && tree.children[0]
  // The React stub does not execute function components, so call the glyph.
  const glyph = glyphEl && typeof glyphEl.type === 'function' ? glyphEl.type(glyphEl.props) : glyphEl
  check(
    "chip draws the plugin's own inline SVG glyph",
    !!glyph && glyph.type === 'svg' && glyph.props.viewBox === '0 0 1024 1024'
      && glyph.props.fill === 'currentColor' && glyph.children.length === 1
      && /^M/.test(String(glyph.children[0].props.d || '')),
    JSON.stringify(glyph && glyph.type),
  )
  check('chip keeps the tab title text', !!(tree && tree.children[1] && tree.children[1].children[0] === '技能'), JSON.stringify(tree && tree.children[1]))
  const css = String(mod.internals.CSS_TEXT || '')
  check(
    "stay-open rule hides this tab's own close button",
    css.includes('[data-dockkit-tab]:has([data-dsh-skills-chip]) [data-dockkit-tab-close]{display:none!important}'),
    css.slice(0, 120),
  )
  const closeIdx = css.indexOf('[data-dockkit-tab-close]')
  check(
    'the close-button rule is scoped, not global',
    closeIdx > 0 && css.slice(Math.max(0, closeIdx - 60), closeIdx).includes(':has([data-dsh-skills-chip])'),
    css.slice(0, 120),
  )
  rec.disposeAll()
}

/* ------------------------------------------------------------------ */
/* category grouping, collapsing, merging and filtered counts          */
/* ------------------------------------------------------------------ */

const CAT_INDEX = '检索 / 抓取'
const CAT_DEV = '开发 / 环境'
const CAT_OTHER = '其他'
const CATS_KEY = mod.internals.CATS_KEY

/* Two categorised skills per group, one uncategorised (→ 其他), one blank. */
const FIXTURE_SKILLS = [
  { name: 'web-search', category: CAT_INDEX, phrases: ['联网检索'] },
  { name: 'firecrawl', category: CAT_INDEX, phrases: ['网页抓取'] },
  { name: 'docker-env', category: CAT_DEV },
  { name: 'loose-skill' },
  { name: 'blank-cat', category: '' },
]
const ALL_NAMES = FIXTURE_SKILLS.map((s) => s.name).sort()

/* ---- 1. grouping: a header per category, named and counted ---- */
{
  const { component, ctx, rec } = captureBody()
  window.__DSH_SKILLS__ = FIXTURE_SKILLS
  let tree = null
  let err = null
  try { tree = renderFresh(component, ctx) } catch (e) { err = e }
  check('grouped render without error', err === null, String(err && err.stack))

  const heads = catHeaders(tree)
  check(
    'one collapsible header per category with rows',
    heads.length === 3 && heads.map((h) => h.props['data-dss-cat']).join('|') === [CAT_INDEX, CAT_DEV, CAT_OTHER].join('|'),
    JSON.stringify(heads.map((h) => h.props['data-dss-cat'])),
  )
  check(
    'header shows the category name and its count',
    headerText(tree, CAT_INDEX) === '▾检索 / 抓取（2）',
    String(headerText(tree, CAT_INDEX)),
  )
  check(
    'skills without a category fall into 其他',
    headerText(tree, CAT_OTHER) === '▾其他（2）',
    String(headerText(tree, CAT_OTHER)),
  )
  check(
    'every row renders under its own category',
    rowNames(tree).slice().sort().join(',') === ALL_NAMES.join(','),
    JSON.stringify(rowNames(tree)),
  )
  const indexGroup = collectNodes(tree).find((n) => n.props && n.props['data-dss-group'] === CAT_INDEX)
  check(
    'a group holds its own header and skill rows',
    !!indexGroup && !!collectNodes(indexGroup).find((n) => n.props.className === 'dss-cat-body')
      && collectNodes(indexGroup).filter((n) => n.props.className === 'dss-row').length === 2,
    JSON.stringify(indexGroup && collectNodes(indexGroup).map((n) => n.props.className)),
  )
  check(
    'headers are keyboard-focusable and expose their state',
    heads.every((h) => h.props.role === 'button' && h.props.tabIndex === 0 && h.props['aria-expanded'] === true
      && typeof h.props.onClick === 'function' && typeof h.props.onKeyDown === 'function'),
    JSON.stringify(heads[0].props),
  )
  check('caret points down while expanded', nodeText(heads[0]).indexOf('▾') === 0)
  delete window.__DSH_SKILLS__
  rec.disposeAll()
}

/* ---- declared categories drive the order (host `categories`) ---- */
{
  const G = mod.internals.groupSkills
  const ordered = G(FIXTURE_SKILLS, [CAT_DEV, CAT_INDEX])
  check(
    'declared categories set the display order (其他 last)',
    ordered.map((g) => g.name).join('|') === [CAT_DEV, CAT_INDEX, CAT_OTHER].join('|'),
    JSON.stringify(ordered.map((g) => g.name)),
  )
  check(
    'unknown categories are appended in first-appearance order',
    G([{ name: 'a', category: 'Z' }, { name: 'b', category: CAT_INDEX }], [CAT_INDEX]).map((g) => g.name).join('|') === CAT_INDEX + '|Z',
    JSON.stringify(G([{ name: 'a', category: 'Z' }, { name: 'b', category: CAT_INDEX }], [CAT_INDEX]).map((g) => g.name)),
  )
  check('empty skills give no groups', G([], null).length === 0)
}

/* ---- 2. collapsed: the category header stays, its rows do not ---- */
{
  const { component, ctx, rec } = captureBody()
  window.__DSH_SKILLS__ = FIXTURE_SKILLS
  localStorage.setItem(CATS_KEY, JSON.stringify({ [CAT_INDEX]: false }))
  const tree = renderFresh(component, ctx)
  const head = catHeaders(tree).find((h) => h.props['data-dss-cat'] === CAT_INDEX)
  check('a collapsed category keeps its header', !!head, JSON.stringify(catHeaders(tree).map((h) => h.props['data-dss-cat'])))
  check(
    'the collapsed header reports collapsed state and a right caret',
    !!head && head.props['aria-expanded'] === false && nodeText(head).indexOf('▸') === 0,
    String(head && nodeText(head)),
  )
  check(
    'the collapsed header still counts its filtered skills',
    headerText(tree, CAT_INDEX) === '▸检索 / 抓取（2）',
    String(headerText(tree, CAT_INDEX)),
  )
  check(
    'collapsed rows are not rendered at all',
    !rowNames(tree).includes('web-search') && !rowNames(tree).includes('firecrawl'),
    JSON.stringify(rowNames(tree)),
  )
  const indexGroup = collectNodes(tree).find((n) => n.props && n.props['data-dss-group'] === CAT_INDEX)
  check(
    'the collapsed group mounts no rows (zero height)',
    !!indexGroup && collectNodes(indexGroup).filter((n) => n.props.className === 'dss-row').length === 0,
    JSON.stringify(indexGroup && collectNodes(indexGroup).map((n) => n.props.className)),
  )
  check(
    'expanded categories keep rendering their rows',
    rowNames(tree).slice().sort().join(',') === ['blank-cat', 'docker-env', 'loose-skill'].sort().join(','),
    JSON.stringify(rowNames(tree)),
  )
  localStorage.removeItem(CATS_KEY)
  delete window.__DSH_SKILLS__
  rec.disposeAll()
}

/* ---- 3. default expanded: an empty collapse map shows every row ---- */
{
  const { component, ctx, rec } = captureBody()
  window.__DSH_SKILLS__ = FIXTURE_SKILLS
  localStorage.removeItem(CATS_KEY)
  const tree = renderFresh(component, ctx)
  check(
    'no stored collapse state → every category is expanded',
    catHeaders(tree).length === 3 && catHeaders(tree).every((h) => h.props['aria-expanded'] === true),
    JSON.stringify(catHeaders(tree).map((h) => h.props['aria-expanded'])),
  )
  check(
    'no stored collapse state → every row renders',
    rowNames(tree).slice().sort().join(',') === ALL_NAMES.join(','),
    JSON.stringify(rowNames(tree)),
  )
  delete window.__DSH_SKILLS__
  rec.disposeAll()
}

/* ---- collapse state helpers (browser-local, failure-safe) ---- */
{
  const I = mod.internals
  check('collapse key is the documented one', CATS_KEY === 'dsh-skill-sidebar:cats:v1', String(CATS_KEY))
  localStorage.removeItem(CATS_KEY)
  check('missing map reads as empty', JSON.stringify(I.readCollapsedCats()) === '{}')
  const toggled = I.toggleCollapsedCats({}, CAT_INDEX)
  check('toggling collapses', toggled[CAT_INDEX] === false, JSON.stringify(toggled))
  check('toggling again expands', I.toggleCollapsedCats(toggled, CAT_INDEX)[CAT_INDEX] === undefined)
  I.writeCollapsedCats(toggled)
  check('collapse map round-trips', JSON.stringify(I.readCollapsedCats()) === JSON.stringify(toggled), String(localStorage.getItem(CATS_KEY)))
  check('malformed collapse state is ignored', (() => {
    localStorage.setItem(CATS_KEY, '{not json')
    return JSON.stringify(I.readCollapsedCats()) === '{}'
  })())
  const realStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('storage blocked') },
    setItem: () => { throw new Error('storage blocked') },
    removeItem: () => { throw new Error('storage blocked') },
  }
  let threw = null
  try {
    check('blocked storage reads as empty', JSON.stringify(I.readCollapsedCats()) === '{}')
    I.writeCollapsedCats(toggled)
  } catch (e) { threw = e }
  globalThis.localStorage = realStorage
  check('blocked storage never throws', threw === null, String(threw))
  localStorage.removeItem(CATS_KEY)
  check('the ten categories are exported in display order', I.DEFAULT_CATEGORIES.length === 10
    && I.DEFAULT_CATEGORIES[0] === '飞书 / Lark' && I.DEFAULT_CATEGORIES[9] === '其他', JSON.stringify(I.DEFAULT_CATEGORIES))
  check('categoryOf defaults to 其他', I.categoryOf({}) === '其他' && I.categoryOf({ category: '  ' }) === '其他'
    && I.categoryOf({ category: ' 图像 / 视觉 ' }) === '图像 / 视觉', String(I.categoryOf({})))
}

/* ---- 3b. the local fallback classifier (no server category) ---- */
{
  const I = mod.internals
  check('CATEGORY_RULES exported', Array.isArray(I.CATEGORY_RULES) && I.CATEGORY_RULES.length === 9
    && I.CATEGORY_RULES[0][0] === '飞书 / Lark', JSON.stringify(I.CATEGORY_RULES && I.CATEGORY_RULES.length))
  const samples = [
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
  let bad = null
  for (const [name, want] of samples) {
    const got = I.classifyLocally({ name })
    if (got !== want) bad = name + ' → ' + got + ' (want ' + want + ')'
  }
  check('fallback classifier matches the host rules', bad === null, String(bad))
  check('a host-provided category always wins over the fallback',
    I.categoryOf({ name: 'lark-im', category: '开发 / 环境' }) === '开发 / 环境',
    I.categoryOf({ name: 'lark-im', category: '开发 / 环境' }))
  check('description is used only when the name matches nothing',
    I.classifyLocally({ name: 'zzz', description: '通过 agently-cli 操作邮件' }) === '内容 / 发布',
    I.classifyLocally({ name: 'zzz', description: '通过 agently-cli 操作邮件' }))
  check('a generic token in the description cannot steal the category',
    I.classifyLocally({ name: 'zzz', description: 'runs a small cli helper' }) === '其他'
      && I.classifyLocally({ name: 'zzz', description: '读取本地文档并整理成表格' }) === '文档 / 表格',
    I.classifyLocally({ name: 'zzz', description: 'runs a small cli helper' }))
}

/* ---- 4. mergeLists inherits category/path from the server copy ---- */
{
  const M = mod.internals.mergeLists
  const liveOnly = [{ name: 'web-search', description: 'live description' }]
  const machine = [{ name: 'web-search', description: 'machine (loses)', category: CAT_INDEX, path: 'C:\\skills\\web-search\\SKILL.md', phrases: ['联网检索'] }]
  const merged = M(liveOnly, machine)
  check('merged entry keeps the live description', merged[0].description === 'live description', JSON.stringify(merged[0]))
  check('merged entry inherits category from the server copy', merged[0].category === CAT_INDEX, JSON.stringify(merged[0].category))
  check('merged entry inherits path from the server copy', merged[0].path === 'C:\\skills\\web-search\\SKILL.md', JSON.stringify(merged[0].path))
  const both = M([{ name: 'x', category: CAT_DEV }], [{ name: 'x', category: CAT_INDEX, path: 'p' }])
  check('a category the live catalog does carry wins',
    both[0].category === CAT_DEV && both[0].path === 'p', JSON.stringify(both[0]))
  const blank = M([{ name: 'y', category: '' }], [{ name: 'y', category: CAT_DEV, path: 'q' }])
  check('a blank live category falls back to the server copy',
    blank[0].category === CAT_DEV && blank[0].path === 'q', JSON.stringify(blank[0]))
  const alone = M([{ name: 'z' }], [])
  check('a live-only entry stays uncategorised (→ 其他)',
    alone[0].category === undefined && mod.internals.categoryOf(alone[0]) === CAT_OTHER, JSON.stringify(alone[0]))
  check('merge still tolerates null secondary', M(liveOnly, null).length === 1)
}

/* ---- 5. filtering: counts follow the filter, empty groups vanish ---- */
{
  const { component, ctx, rec } = captureBody()
  window.__DSH_SKILLS__ = FIXTURE_SKILLS
  localStorage.removeItem(CATS_KEY)
  let tree = renderFresh(component, ctx)
  check('unfiltered headers count 2/1/2',
    headerText(tree, CAT_INDEX) === '▾检索 / 抓取（2）' && headerText(tree, CAT_DEV) === '▾开发 / 环境（1）',
    JSON.stringify([headerText(tree, CAT_INDEX), headerText(tree, CAT_DEV)]))

  tree = typeQuery(component, ctx, tree, 'DOCKER')
  check(
    'a category emptied by the filter disappears',
    catHeaders(tree).length === 1 && catHeaders(tree)[0].props['data-dss-cat'] === CAT_DEV,
    JSON.stringify(catHeaders(tree).map((h) => h.props['data-dss-cat'])),
  )
  check('the surviving header counts the filtered rows', headerText(tree, CAT_DEV) === '▾开发 / 环境（1）', String(headerText(tree, CAT_DEV)))
  check('only the matching rows render', rowNames(tree).join(',') === 'docker-env', JSON.stringify(rowNames(tree)))

  tree = typeQuery(component, ctx, tree, 'search')
  check(
    'counts shrink with the filter (2 → 1)',
    catHeaders(tree).length === 1 && headerText(tree, CAT_INDEX) === '▾检索 / 抓取（1）',
    JSON.stringify(catHeaders(tree).map((h) => nodeText(h))),
  )
  check('the filtered row set is exact', rowNames(tree).join(',') === 'web-search', JSON.stringify(rowNames(tree)))

  tree = typeQuery(component, ctx, tree, 'zzzz')
  check('a filter that matches nothing drops every header', catHeaders(tree).length === 0, JSON.stringify(catHeaders(tree).length))
  const empty = collectNodes(tree).find((n) => n.props && n.props.className === 'dss-empty')
  check('the empty-state message names the query', !!empty && nodeText(empty).includes('zzzz'), nodeText(empty))

  tree = typeQuery(component, ctx, tree, '')
  check('clearing the query restores every group', catHeaders(tree).length === 3
    && rowNames(tree).slice().sort().join(',') === ALL_NAMES.join(','), JSON.stringify(catHeaders(tree).length))
  delete window.__DSH_SKILLS__
  rec.disposeAll()
}

console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CLIENT CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
