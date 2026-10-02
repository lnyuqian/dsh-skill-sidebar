/**
 * dsh-skill-sidebar 桌面版（DeepSeek Harness Desktop / Electron）适配回归测试。
 *
 * 桌面版与 web 版渲染同一套前端，差异只有两点，测试也围绕这两点：
 *  1. 运行外壳识别 `isDesktopShell`：桌面版页面挂在 `dsh-app://app/` 下，
 *     浏览器是 `http(s)://`；Electron UA 作为兜底判据。
 *  2. 悬停浮层几何 `computeTipPos`：桌面窗口通常比浏览器窗口小得多，
 *     300px 的浮层必须夹紧到可视区内、按上下空间翻转并限高滚动，
 *     否则长描述会跑到窗口外面（web 窗口宽，问题不明显）。
 *
 * 另外覆盖桌面环境下的端到端行为：槽位注册照旧、行悬停后写回的浮层状态
 * 落在可视区内、列表底部标识出「桌面版」。
 *
 * 运行：node test-desktop.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

let handoff = null
globalThis.window = {
  __ModuleLoader__: { load: (h) => { handoff = h } },
  innerWidth: 1280,
  innerHeight: 800,
}
globalThis.document = undefined

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

/** 把全局环境切成桌面端 / 浏览器端（模块内每次调用都实时读取全局）。 */
function setShell(kind) {
  if (kind === 'desktop') {
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'dsh-app:' }, configurable: true })
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Electron/44.0.0' },
      configurable: true,
    })
  } else if (kind === 'browser') {
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:' }, configurable: true })
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36' },
      configurable: true,
    })
  } else {
    delete globalThis.location
    delete globalThis.navigator
  }
}

/** 基础 React stand-in：状态只取初值，渲染树可直接检查。 */
const React = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
}
const primitivesStub = { IconSkillOutline16: () => null }

setShell('desktop')
await import('./lib/client.js')

let passed = 0
const ok = (name) => { passed++; console.log('  \u2713 ' + name) }
function check(name, cond, detail) {
  assert.ok(cond, name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)))
  ok(name)
}

const mod = handoff.factory((spec) => {
  if (spec === 'react') return React
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error('未预期的 require: ' + spec)
})
const I = mod.internals

/* ------------------------------------------------------------------ */
/* 1. 外壳识别                                                          */
/* ------------------------------------------------------------------ */
{
  setShell('desktop')
  check('dsh-app:// 协议判定为桌面版', I.isDesktopShell() === true)

  setShell('browser')
  check('http(s) 浏览器不判定为桌面版', I.isDesktopShell() === false)

  Object.defineProperty(globalThis, 'location', { value: { protocol: 'file:' }, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 Electron/44.0.0' }, configurable: true })
  check('Electron UA 兜底判定为桌面版', I.isDesktopShell() === true)

  setShell('none')
  check('缺少 location/navigator 时不抛错且按浏览器处理', I.isDesktopShell() === false)

  setShell('desktop')
}

/* ------------------------------------------------------------------ */
/* 2. 悬停浮层几何                                                      */
/* ------------------------------------------------------------------ */
{
  const vp = { width: 1280, height: 800 }

  // 字宽模型必须区分汉字与拉丁：11.5px 字号下汉字 ~11.5px、拉丁 ~6.2px。
  // 这些期望值来自真实字体度量（Microsoft YaHei @11.5px），与实现内部公式无关，
  // 若实现退化回"所有字符都按拉丁算"，这里会立刻失败。
  const one = I.TIP_PAD_Y + I.TIP_LINE_H
  check(
    '汉字按 ~11.5px 估算（280px 内容宽一行 24 字、26 字两行）',
    I.estimateTipHeight('中'.repeat(24), 300) === one && I.estimateTipHeight('中'.repeat(26), 300) === I.TIP_PAD_Y + 2 * I.TIP_LINE_H,
    { c24: I.estimateTipHeight('中'.repeat(24), 300), c26: I.estimateTipHeight('中'.repeat(26), 300) },
  )
  check('拉丁按 ~6.2px 估算（45 字一行）', I.estimateTipHeight('a'.repeat(45), 300) === one, I.estimateTipHeight('a'.repeat(45), 300))
  check('同长度中文比英文高', I.estimateTipHeight('中'.repeat(60), 300) > I.estimateTipHeight('a'.repeat(60), 300))
  check('汉字字宽大于拉丁字宽', I.tipCharWidth('中') > I.tipCharWidth('a'), { cjk: I.tipCharWidth('中'), latin: I.tipCharWidth('a') })
  check('换行符按新行计入', I.tipLineCount('a\nb', 300) === 2, I.tipLineCount('a\nb', 300))

  // 行在窗口中下部且描述短：上方放得下 → 向上展开、不限高、居中不夹紧
  const up = I.computeTipPos({ left: 600, top: 600, bottom: 626, width: 200 }, vp, '短描述')
  check('上方空间充足：向上展开且不压缩高度', up.above === true, up)
  check('上方展开时底边贴行上方 ' + I.TIP_GAP + 'px', up.top === 600 - I.TIP_GAP, up)
  check('位置充足时水平中心不被改动', up.left === 700, up)
  check('高度足够时 maxHeight 取估算高度', up.maxHeight >= I.TIP_MIN_H && up.maxHeight < vp.height, up)

  // 行贴近窗口顶部：上方放不下 → 翻到下方
  const down = I.computeTipPos({ left: 600, top: 20, bottom: 46, width: 200 }, vp, '短描述')
  check('贴近窗口顶部：翻转为向下展开', down.above === false, down)
  check('向下展开时顶边贴行下方 ' + I.TIP_GAP + 'px', down.top === 46 + I.TIP_GAP, down)

  // 桌面窗口窄 + 行靠右：宽度收缩、水平中心夹紧，浮层不越出右边缘
  const narrow = { width: 420, height: 720 }
  const right = I.computeTipPos({ left: 380, top: 400, bottom: 426, width: 100 }, narrow, '描述')
  check('窄窗口靠右行：浮层宽度收缩到可视区内', right.width <= narrow.width - 2 * I.TIP_MARGIN, right)
  check(
    '窄窗口靠右行：水平中心夹紧到右侧边界内',
    right.left + right.width / 2 <= narrow.width - I.TIP_MARGIN + 0.001,
    right,
  )

  // 行靠左同理
  const left = I.computeTipPos({ left: 0, top: 400, bottom: 426, width: 40 }, narrow, '描述')
  check('窄窗口靠左行：水平中心夹紧到左侧边界内', left.left - left.width / 2 >= I.TIP_MARGIN - 0.001, left)

  // 上下都很挤：限高到可用空间，避免溢出成长条
  const tight = I.computeTipPos(
    { left: 200, top: 200, bottom: 226, width: 100 },
    { width: 1200, height: 300 },
    'x'.repeat(400),
  )
  check('上下空间紧张：按可用空间限高', tight.maxHeight >= I.TIP_MIN_H && tight.maxHeight <= 300, tight)

  // 长描述：估算高度随文本增长，但被可视区夹住
  const longText = '很长的功能描述。'.repeat(60)
  const long = I.computeTipPos({ left: 600, top: 700, bottom: 726, width: 200 }, vp, longText)
  check(
    '长描述：估算高度大于短描述',
    I.estimateTipHeight(longText, I.TIP_MAX_W) > I.estimateTipHeight('短描述', I.TIP_MAX_W),
  )
  check('长描述：maxHeight 不超过可视区', long.maxHeight <= vp.height - 2 * I.TIP_MARGIN, long)

  // 浮层是 pointer-events:none（不抢行的悬停），因此限高后无法滚动，
  // 超长描述必须被截断成省略号，而不是被裁在半行。
  const capped = I.computeTipPos({ left: 200, top: 120, bottom: 146, width: 100 }, { width: 1200, height: 260 }, longText)
  check('上下都不够时被限高', capped.maxHeight < I.estimateTipHeight(longText, capped.width), {
    max: capped.maxHeight, full: I.estimateTipHeight(longText, capped.width),
  })
  const fitted = I.fitTipText(longText, capped.width, capped.maxHeight)
  check('限高时文本被截断并标注省略号', fitted.length < longText.length && fitted.endsWith('…'), { from: longText.length, to: fitted.length })
  check(
    '截断后的估算高度不超过限高',
    I.estimateTipHeight(fitted, capped.width) <= capped.maxHeight,
    { h: I.estimateTipHeight(fitted, capped.width), max: capped.maxHeight },
  )
  check('空间足够时不改动文本', I.fitTipText('短描述', I.TIP_MAX_W, 200) === '短描述')
  check('空文本不抛错', I.fitTipText(null, I.TIP_MAX_W, 80) === '' && I.fitTipText('', 140, 80) === '')

  // 极限几何：视口比最小宽度还窄、上下空间都小于最小高度 —— 不得越界
  const tiny = I.computeTipPos({ left: 0, top: 30, bottom: 56, width: 40 }, { width: 100, height: 80 }, '中文描述')
  check('极窄视口：浮层宽度不超过视口', tiny.width <= 100, tiny)
  check(
    '极窄视口：水平中心落在视口内',
    tiny.left - tiny.width / 2 >= -0.001 && tiny.left + tiny.width / 2 <= 100 + 0.001,
    tiny,
  )
  check('极扁视口：高度预算不超过剩余空间', tiny.maxHeight <= 80, tiny)
  const nan = I.computeTipPos({ left: NaN, top: NaN, bottom: NaN, width: NaN }, { width: 420, height: 720 }, 'x')
  check('rect 字段为 NaN 时不产生 NaN 定位', Number.isFinite(nan.left) && Number.isFinite(nan.top) && Number.isFinite(nan.maxHeight), nan)
  const partial = I.computeTipPos({ top: 100 }, { width: 420, height: 720 }, 'x')
  check('rect 字段缺失时不产生 NaN 定位', Number.isFinite(partial.left) && Number.isFinite(partial.top) && Number.isFinite(partial.maxHeight), partial)

  // 拿不到行矩形（初始渲染）时安全退化
  const none = I.computeTipPos(null, vp, '描述')
  check(
    '取不到行矩形：退化到左上角且不抛错',
    none.left === I.TIP_MARGIN + none.width / 2 && none.top === I.TIP_MARGIN && none.above === false,
    none,
  )

  // 视口为 0（极端测量失败）时不产生 NaN
  const zero = I.computeTipPos(null, { width: 0, height: 0 }, '描述')
  check(
    '视口为 0：不产生 NaN',
    Number.isFinite(zero.left) && Number.isFinite(zero.top) && Number.isFinite(zero.maxHeight),
    zero,
  )
}

/* ------------------------------------------------------------------ */
/* 3. 桌面环境端到端：槽位注册 + 悬停写回的浮层状态 + 底部外壳标识        */
/* ------------------------------------------------------------------ */

/** 可脚本化的 React stub：按队列取 useState 初值，并记录每次 setter 调用。 */
let stateQueue = []
let setters = []
const ReactScoped = {
  useState: (init) => {
    const idx = setters.length
    setters.push([])
    const value = stateQueue.length ? stateQueue.shift() : (typeof init === 'function' ? init() : init)
    const set = (next) => { setters[idx].push(typeof next === 'function' ? next(value) : next) }
    return [value, set]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
}

const modScoped = handoff.factory((spec) => {
  if (spec === 'react') return ReactScoped
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error('未预期的 require: ' + spec)
})

const components = {}
const rec = { types: [], slots: [], injections: [], openTab: [] }
const ctx = {
  effect(callback) { const d = callback(); return typeof d === 'function' ? d : () => {} },
  get(name) {
    if (name === 'sessions') return { list: { subscribe: () => () => {}, getSnapshot: () => ({ current: 'sess-1' }) } }
    if (name === 'connection') return { api: { skills: { list: async () => ({ result: { ok: true, value: { skills: [] } } }) } } }
    return undefined
  },
  sidebarRightTabs: { register(definition) { rec.types.push(definition); return () => {} } },
  sidebarRight: { openTab(kind) { rec.openTab.push(kind) } },
  slots: {
    inject(name, callback) { rec.injections.push(name); return callback() },
    register(options, component) {
      rec.slots.push({ options, component })
      components[options.name] = component
      return () => {}
    },
  },
}

// 自动打开的重试定时器立即执行，但被 setTimeout stub 吞掉，测试不会挂住进程
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = () => 0
globalThis.clearTimeout = () => {}
try {
  modScoped.apply(ctx)
} finally {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
}

{
  check('桌面端照样注册技能页类型（同 web 版契约）', rec.types.length === 1 && rec.types[0].kind === 'skills', rec.types)
  check(
    '桌面端注册主体与标题两个座位',
    rec.injections.includes('sidebar.right.pane.tab') && rec.injections.includes('sidebar.right.pane.tab.title'),
    rec.injections,
  )
  check(
    '桌面端座位 key 为 dsh-skill-sidebar',
    rec.slots.every((s) => s.options.key === 'dsh-skill-sidebar'),
    rec.slots.map((s) => s.options),
  )
  ok('桌面端 tab 类型 + 主体 + 标题座位注册齐备')
}

const skills = [
  { name: 'firecrawl-search', description: 'Web search with full page content.', zh: '网页搜索与整页抓取，适合找资料。', phrases: ['网页搜索', '整页抓取'] },
  { name: 'photom', description: '图像处理', phrases: ['图像处理'] },
]

function renderBody(shellWidth, shellHeight, tipState) {
  globalThis.window.innerWidth = shellWidth
  globalThis.window.innerHeight = shellHeight
  stateQueue = [{
    skills,
    loading: false,
    error: null,
    source: 'server',
    updatedAt: null,
    query: '',
    diagServer: '本机 ' + skills.length,
    diagLive: '实时 ' + skills.length,
  }]
  if (tipState !== undefined) stateQueue.push(tipState)
  setters = []
  const useTabInfo = () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: { id: 'tab-1', kind: 'skills', title: '技能', visible: true, signal: { aborted: false }, actions: {} },
  })
  return components['sidebar.right.pane.tab']({ useTabInfo, sessionId: 'sess-1', ctx })
}

function collect(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  for (const child of node.children || []) {
    if (Array.isArray(child)) child.forEach((c) => collect(c, pred, out))
    else collect(child, pred, out)
  }
  return out
}

{
  // 桌面窗口 420x720（远窄于浏览器窗口）
  const tree = renderBody(420, 720)
  const rows = collect(tree, (n) => n.props && n.props.className === 'dss-row')
  check('桌面窗口下渲染出技能行', rows.length === skills.length, rows.length)

  // 中文表已内联进客户端 bundle：桌面端宿主未重启也能显示中文
  const phraseNodes = collect(tree, (n) => n.props && n.props.className === 'dss-phrases')
  check(
    '第二行渲染内联中文短语（无需重启宿主）',
    phraseNodes.length > 0 && JSON.stringify(phraseNodes[0].children).includes('网页搜索'),
    phraseNodes[0] && phraseNodes[0].children,
  )

  // 行在窗口中下部、且偏右：写回的浮层状态必须完整落在可视区内
  rows[0].props.onMouseEnter({
    currentTarget: { getBoundingClientRect: () => ({ left: 380, top: 600, bottom: 626, width: 120 }) },
  })
  const setTipCalls = setters[1]
  check('悬停行写入浮层状态', Array.isArray(setTipCalls) && setTipCalls.length === 1, setTipCalls)
  const tip = setTipCalls[0]
  check('浮层宽度收缩到桌面窗口内', tip.width <= 420 - 2 * I.TIP_MARGIN, tip)
  check('浮层水平中心不越出右边界', tip.left + tip.width / 2 <= 420 - I.TIP_MARGIN + 0.001, tip)
  check('浮层水平中心不越出左边界', tip.left - tip.width / 2 >= I.TIP_MARGIN - 0.001, tip)
  check('浮层限高为有限值', Number.isFinite(tip.maxHeight) && tip.maxHeight > 0, tip)
  check('浮层带完整功能文本', typeof tip.text === 'string' && tip.text.includes('网页搜索'), tip.text)
  check('浮层把中文说明排在最前', tip.text.split('\n')[0] === '网页搜索与整页抓取，适合找资料。', tip.text.split('\n')[0])
  check('浮层保留英文原文', tip.text.includes('Web search with full page content.'))
  ok('桌面端悬停：浮层状态被夹紧在 420px 窗口内')

  // 浏览器宽窗口对照：同一行不再夹紧（水平中心就是行中心）
  const wide = I.computeTipPos({ left: 380, top: 600, bottom: 626, width: 120 }, { width: 1280, height: 800 }, '网页搜索')
  check('浏览器宽窗口下水平中心就是行中心', wide.left === 440, wide)
}

{
  // 底部标识出运行外壳
  setShell('desktop')
  const desktopTree = renderBody(420, 720)
  const foot = collect(desktopTree, (n) => n.props && n.props.className === 'dss-foot')[0]
  check('桌面版底部标识「桌面版」', JSON.stringify(foot.children).includes('桌面版'), foot && foot.children)

  setShell('browser')
  const browserTree = renderBody(1280, 800)
  const browserFoot = collect(browserTree, (n) => n.props && n.props.className === 'dss-foot')[0]
  check('浏览器底部标识「浏览器」', JSON.stringify(browserFoot.children).includes('浏览器'), browserFoot && browserFoot.children)

  // 主体渲染在桌面壳下不抛错，且带插件标记
  setShell('desktop')
  const tree = renderBody(420, 720)
  check(
    '桌面端主体渲染无异常且带插件标记',
    tree.props.className === 'dss-root' && tree.props['data-dsh-skill-sidebar'] === 'body',
    tree.props,
  )
}

/* ------------------------------------------------------------------ */
/* 4. 样式契约（三套测试都不加载 CSS，这里直接对源码做静态断言）          */
/* ------------------------------------------------------------------ */
{
  check('浮层 CSS 裁断而非滚动（浮层不可命中，滚动没有意义）', /\.dss-tip-fixed\{[^}]*overflow:hidden/.test(SRC))
  check('浮层 CSS 不设裸 width（靠 max-width 收缩）', !/\.dss-tip-fixed\{[^}]*\b(?<!max-)width:\s*\d/.test(SRC))
  check('技能名 CSS 允许收缩', /\.dss-name\{[^}]*min-width:0/.test(SRC))
  check('技能名 CSS 省略号显示', /\.dss-name\{[^}]*text-overflow:ellipsis/.test(SRC))
  check('技能名 CSS 不换行', /\.dss-name\{[^}]*white-space:nowrap/.test(SRC))
  check('页脚 CSS 允许换行（窄栏下不撑破）', /\.dss-foot\{[^}]*flex-wrap:wrap/.test(SRC))
  check('浮层内联样式用 maxWidth 而非 width', /maxWidth:\s*tip\.width/.test(SRC) && !/\bwidth:\s*tip\.width/.test(SRC))
}

console.log('\n全部通过：' + passed + ' 项')
