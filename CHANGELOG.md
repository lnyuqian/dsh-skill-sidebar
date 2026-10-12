# 更新日志

本文件记录本插件的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 2026-10-12

按「插件/家族」分类 + 使用证据驱动的**新会话按需加载**。本机实测：181 个技能里
157 个会写进每个新会话的技能目录（≈44,010 字符 ≈ **14.9K token**，且目录一变就重发一次）；
最近 30 天真正被调用过的只有 21 个。v0.4.0 让新会话只带「30 天内用过 + 顶标」的那一份。

### 新增

- **分类与标签**：`lib/categories.json` 把技能按「插件/家族」归入 12 个固定分类
  （firecrawl-* → 网页检索、wecomcli-* → 企业微信、photon-* → 多媒体生成、dsh-* → DSH 运维…），
  规则是「人工覆盖 > frontmatter `category` > 名字前缀家族 > 名称/说明关键词打分 > 兜底分类」。
  标签来自 frontmatter 的 `tags`/`keywords`（现在本机技能还没有，将来会有）+ 名字家族 + 非同公共目录的来源根。
- **新装技能自动归类**：每次扫描把没见过的技能自动归入合适分类并写入 `policy.json`；
  已归类的不再改写，可人工改（`POST /skillpanel/classify`）。重装/新装技能零手工步骤即可出现在对的分类下。
- **侧栏按分类查询**：顶部新增分类筛选条（全部 / 常驻 / 索引 / 新装 + 各分类计数），
  列表按分类分组、每组标题带数量；搜索框支持 `tag:xxx`（或 `#xxx`）、`分类:xxx` / `category:xxx`、
  以及 `常驻` / `索引` 关键词；每行显示「分类 · #标签」，并标出该技能是否**常驻**（会进新会话目录）。
- **使用证据**（`lib/mining.js`）：实时订阅 `tools/execute` 记录 `skill` 工具调用；
  启动后台回填最近 30 天的会话日志（**多帧** zstd JSONL，帧扫描算法移植自
  `@deepseek-ai/dsh-session-persistence-jsonl` 的 `scanZstdFrames`，BSD-3-Clause），
  挖出历史上的真实调用与被注入过目录的技能。回填有台账+`max` 合并语义，重复跑不会把调用数翻倍。
- **新会话加载清单**（`lib/policy.js` + 宿主影子注册）：
  - 常驻 = **30 天内使用过的技能** ∪ **顶标（置顶）的技能**；
  - **30 天内被加载进目录却从未使用过 → 退出新会话加载清单**（转为「索引」）；
  - 生效手段是给索引里的技能注册一个同名 **runtime 影子**（rank 250 压过用户技能 400/500/600），
    只把 `modelInvocable` 设为 `false` —— 这是 DSH 官方区分「模型可见／用户可见」的开关，
    **不需要改动 DSH 本体**。契约由 `test-registry-shadow.mjs` 对着真实注册表验证。
  - 索引里的技能仍然：侧栏可见、`/技能名` 可直接调用、`skill_search` 可检索并加载。
- **`skill_search` 工具**：全量索引检索（含被移出目录的技能），支持关键词、分类、标签；
  传精确 `name` 直接返回该技能的完整说明（并记为一次使用）。这是「按需加载」的入口。
- **置顶下沉到宿主**：顶标不再只是浏览器偏好 —— 它同时决定新会话常驻清单，
  因此改为写入 `~/.dsh/storages/dsh-skill-sidebar/policy.json`（`POST /skillpanel/pins`），
  浏览器 localStorage 仅作首帧回退。
- 新路由：`GET /skillpanel/policy`（含每个技能为什么在/不在清单）、`POST /skillpanel/classify`、
  `POST /skillpanel/mine`、`GET /skillpanel/usage`（诊断）。

### 两点「更好的方式」（相对原始规则）

1. **新装技能试用期**：完全按使用过滤会死锁（没用过 → 不列 → 永远用不上）。
   新装/新改的 SKILL.md（`mtime` 在 7 天内）直接进常驻清单，试用期结束后仍未使用才转索引。
2. **证据不足不生效**：`usage` 与 `advertised` 都为空时（全新机器/刚装插件）整条策略 **degraded**，
   只统计不改行为，避免第一次启动就把全部技能藏起来。

### 开关

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `DSH_SKILL_POLICY` | `on` | `on` 真生效 / `dry` 只统计不改行为 / `off` 完全关闭 |
| `DSH_SKILL_WINDOW_DAYS` | `30` | 使用窗口（天） |
| `DSH_SKILL_GRACE_DAYS` | `7` | 新装技能试用期（天） |
| `DSH_SKILL_MINE` | `on` | `off` 跳过会话日志回填 |
| `DSH_SKILL_SESSIONS_DIR` | `$DSH_HOME/sessions` | 会话日志根目录（回填用） |

### 测试

`test-policy.mjs`（55 项，纯逻辑：分类/标签/清单规则/保护机制/存储/多帧日志与证据提取）、
`test-registry-shadow.mjs`（12 项，对真实 `@deepseek-ai/dsh-skill` 验证影子机制）、
`test-client.mjs`（+38 项分类/标签/清单纯函数）、`test-host.mjs`、`test-desktop.mjs`。
`npm test` 一次跑完，全部通过。

### 已知边界

- rank 250 的 runtime 影子压不过项目内技能（`project-dsh` 100 / `project-agents` 200）——
  项目自带技能始终留在目录里，这是有意的安全边界。
- 中文名/大写名等不合法技能名本来就不进模型目录，策略对它们只做统计。
- 宿主 half 的改动需要重启 DSH 才生效（`link:` 安装，重启才会重新 import）。

## [0.3.0] - 2026-10-02

桌面版适配：同一个包现在同时运行在 DSH web（浏览器）与 **DeepSeek Harness 桌面版**（Electron）两端，
不再需要分叉代码 —— 桌面差异集中在「外壳识别」与「浮层几何」两处。

### 新增

- **英文技能的中文短语与中文说明**：本机 175 个技能里有 139 个的 `SKILL.md` 是英文，
  规则短语只能截出 `Use when`、`adding A` 这类片段，看不出技能能做什么。现在随包分发
  `lib/skills-zh.json`（139 条，key 为技能名）：列表第二行改为中文短语，悬停浮层把
  **中文说明排在最前**、英文原文与 `whenToUse` 保留在后（浮层在桌面小窗口里会被限高截断，
  中文不能被截掉）。技能名保持英文原样 —— 它就是 `/技能名` 的调用标识。
  该表的指纹（`_meta.version`）写进缓存签名，换表后自动重扫，不必等到周一。
  **同一张表还会内联进客户端 bundle**（`node scripts/sync-zh.mjs` 生成 `lib/client.js` 的
  `@zh-inline` 段）：客户端 bundle 由 `client-hmr` 热重载，而宿主半侧只有重启应用才会重新 import，
  内联让两端在改表后都立即显示中文，不必为了换一张表重启应用；宿主重启后服务端数据自带 `zh`，
  客户端合并对两者是幂等的（两侧同源，一致性由 `test-client.mjs` 断言）。搜索同时覆盖中文说明与短语。
- **桌面版（desktop profile）支持**：桌面版渲染的就是同一套 Web 前端，只是页面挂在 `dsh-app://app/`
  协议下、窗口通常远小于浏览器窗口。经实测：客户端两段式注册（`ctx.sidebarRightTabs.register`
  + `sidebar.right.pane.tab` / `.title`）与服务端 `webServer` 路由在桌面版**完全一致**；
  `fetch('/skillpanel/skills')` 由 Electron 主进程带认证 cookie 转发给本地 webserver
  （与 dsh-quick-prompts 的 `/api/quick-prompts` 同一通道），因此数据源无需改动。
  **例外**：`webServer.tapIndex`（`window.__DSH_SKILLS__` 首屏注入）在桌面端不生效 ——
  Electron 直接读取打包好的前端，不经过 index 变换管道；桌面端首屏由 localStorage 快照与
  实时目录承担，功能不受影响。
- `install-desktop.ps1`：应用**未运行**时，用桌面自带的 CLI 载体
  （`app.asar` 内的 `dsh-desktop-host/lib/cli.js`，带 `manageDesktopProfile` 权限）把本插件安装到
  `$DSH_HOME/profiles/desktop`；支持 `-Mode Link|Tarball`、`-Uninstall`、`-WhatIf`。
  应用**运行中**则走应用内插件管理（设置 → 插件）或 DSH 助手的 plugin_manager 工具，**无需重启**。
- `dsh.plugin.json`：随包元数据（entry 与 client platform），与 dsh-quick-prompts 的写法一致。
  说明：本 build 的宿主并不读取该文件（`app.asar` 中零引用），它只是给插件市场/工具预留的描述，不影响加载。
- `test-desktop.mjs`：桌面适配回归 —— 外壳识别、浮层几何（字宽模型 / 翻转 / 夹紧 / 限高 / 退化）、
  桌面端槽位注册端到端、底部外壳标识、关键 CSS 静态断言。

### 变更

- **悬停浮层改为按可视区自适应**：新增纯函数 `computeTipPos`，负责左右夹紧、按上下空间翻转、
  限高。旧实现只把中心点夹在视口内，300px 宽的浮层在窄窗口里仍会越出右边缘。
  浮层保持 `pointer-events:none`（不抢被悬停行的鼠标事件），因此限高后无法滚动 ——
  超出可视空间的描述由 `fitTipText` 截断并加省略号，而不是被裁在半行。
- **高度模型按脚本区分字宽**：11.5px 字号下汉字约 11.5px、拉丁约 6.2px（Microsoft YaHei 实测）。
  旧模型一律按 6.6px/字估算，对中文低估约 1.7×。
- **高度预算改为"实际可用空间"**：估算值只用于决定向上/向下翻转，不再当作 max-height 上限 ——
  否则估算误差会直接变成被裁掉的正文。
- **窄栏里的技能名改为省略显示**：`.dss-name` 由 `flex:none` 改为可收缩 + `text-overflow:ellipsis`，
  否则长技能名会把置顶 / 复制按钮挤出右侧边栏可视区；`.dss-foot` 允许换行。
- 列表底部新增运行外壳标识（桌面版 / 浏览器），与来源信息并列，便于确认插件在哪一端生效。
- 页脚版本标记 `v13` → `v14`。

### 修复

**独立审查发现并修复的缺陷**（对抗性审查跑在真实方案上，含字体度量与 asar 取证）：

- **长中文说明被硬裁且不可达**（高）：高度模型按拉丁字宽估算，175 个技能里 30 个（17%）的真实
  渲染高度超过预算；又因为 `max-height` 用的是估算值、浮层 `pointer-events:none` 不可滚动，
  被裁的内容永久看不到。现按脚本加权估算 + 用可用空间作预算 + 必要时截断加省略号：
  同一探针下典型桌面窗口需要截断的技能从 30 个降到 2 个，且这 2 个是真实空间不足。
- **浮层被固定成 300px 宽**（中）：内联 `width` 使 4 个字的短描述渲染成 300px 空盒（本轮引入的
  视觉回归，web 与桌面都受影响）。改为 `maxWidth`，盒子仍然贴合内容。
- **极端几何越界/NaN**（低）：视口窄于最小宽度时宽度会越界、上下空间都小于最小高度时浮层会
  顶出窗口、`rect` 字段缺失或为 NaN 时定位为 NaN。现宽度随视口收缩并再次夹紧、预算按剩余空间
  收缩、`rect` 数值统一归一化。
- **剪贴板写失败也报"已复制"**（低）：`navigator.clipboard.writeText` 的 Promise 既没 await 也没
  catch，桌面端拒绝写入时会假报成功且不回退。现 await 成功才提示，失败回退 `execCommand`。
- 客户端合并排序改用 `localeCompare`，与服务端扫描排序一致（此前用码位排序，首屏与刷新后
  的顺序可能不同）。
- 请求跟踪日志（`DSH_SKILL_SIDEBAR_TRACE`）的 UA 截断由 60 字符放宽到 160 —— 原来恰好截掉
  `Electron/` 标记，桌面端命中无法自证。
- `test-host.mjs` 不再依赖本机特定技能：原先固定断言 `lark-calendar` / `watch` 存在并命中手写短语，
  技能被卸载后测试误报失败（`sorted by name` 也改为与实现的 `localeCompare` 语义一致）。
  现在手写短语表按"表本身的键"验证，扫描结果只做"命中则交叉核对"。

### 测试

三套测试全绿（Windows 11 + DeepSeek Harness 桌面版）：

| 测试 | 覆盖 |
|---|---|
| `node test-client.mjs` | official 侧边栏两段式注册、自动打开重试、主体渲染、合并 / 缓存 / 置顶、内联中文表与 `skills-zh.json` 的一致性、`applyZh` 幂等 |
| `node test-host.mjs` | frontmatter 解析、真实技能根扫描、中文表接入、路由与围栏、watcher 自动新增、缓存落盘 |
| `node test-desktop.mjs` | 桌面外壳识别、字宽模型（独立期望值）与浮层几何、极端几何、桌面端槽位注册与悬停写回、关键 CSS 静态断言 |

### 实测记录（Windows 11 + DeepSeek Harness 桌面版）

- 把本包 link 安装到 `$DSH_HOME/profiles/desktop` 后，宿主热重组：`sidebar.right.pane.tab` 的
  occupants 中出现 `dsh-skill-sidebar`（active），`sidebar.right.pane.tab.title` 同样注册成功；
- 服务端在桌面版进程内完成扫描，写入 `$DSH_HOME/storages/dsh-skill-sidebar/skills.json`。

## [0.2.1] - 2026-09-12

可移植性修正：去掉源码里只对开发机成立的绝对路径，并把文档与发布说明改成与机器、与平台无关的表述。

### 修复

- **服务端不再写死某台机器的绝对路径**：`lib/index.js` 里的请求跟踪日志原先硬编码到一个开发机路径，
  现已改为**默认关闭** —— 只有显式设置环境变量 `DSH_SKILL_SIDEBAR_TRACE=<绝对文件路径>` 才会写入。
  该写入本来就在 `try/catch` 中（在别的机器上只会静默失败、不影响功能），但把绝对路径留在已发布的包
  既不合适，也会让人误以为插件依赖它。现在未设置该变量时**不产生任何文件系统写入**。

### 变更

- README 的安装示例改为通用写法（`link:<本包绝对路径>`），不再出现某一台机器的具体路径；
  并新增「平台支持」一节。
- CHANGELOG 的实测清单与升级指引改为与机器无关的表述：profile 补丁路径统一写作
  `$DSH_HOME/profiles/web/cordis.patch.yml`（Windows 默认 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`），
  不再描述某次实测的条目数量等本机细节。

### 平台支持

| 平台 | 状态 |
|---|---|
| Windows 11 | ✅ 已验证（DSH `0.1.5-rc.1`） |
| macOS | ⚠️ 未测试 |

插件只用 Node 的跨平台 API（`node:path` 的 `join()`、`node:os` 的 `homedir()`）以及
`DSH_HOME` / `DSH_AGENTS_HOME` / `DSH_SKILL_DIRS` / `DSH_SKILL_CACHE_DIR` 等环境变量来定位文件，
不含平台专有路径，也不假设路径分隔符。客户端部分只在浏览器中运行，与操作系统无关。
升级到本版本无需改动配置：行为与 `0.2.0` 相同，只是不再有那个硬编码路径。

## [0.2.0] - 2026-09-12

**重大更新：从第三方 `dsh-better-sidebar` 面板迁移到 DSH 官方右侧边栏。**

DSH `0.1.5-rc.1` 起官方自带可停靠标签页的右侧边栏
（`@deepseek-ai/dsh-client-ui-sidebar-right`），任何包都能通过公开的两段式接口往里注册标签类型。
本次把「技能」标签整体搬到官方侧边栏，并去掉了对第三方 `betterSidebar` 服务的依赖。

### ⚠️ 破坏性变更

- **不再注册到 `dsh-better-sidebar`**：插件不再调用 `ctx.betterSidebar.registerTab`，
  插件级 `inject` 中也不再有 `betterSidebar`。使用了第三方右侧面板的 DSH 里，技能标签不会再出现在那个面板。
- **`dsh.client.inject` 改绑官方包**：由 `dsh-better-sidebar` 改为
  `@deepseek-ai/dsh-client-ui-sidebar-right`。该字段是 boot graph 的**包依赖边**，
  因此升级后**必须重启 dsh web**（只改 `lib/client.js` 则硬刷新即可，见下方「升级指引」）。
- **对 DSH 版本有要求**：需要 Web 端已内置 `@deepseek-ai/dsh-client-ui-sidebar-right` 的 DSH
  （`0.1.5-rc.1` 及以上）。更早的版本没有官方侧边栏，本插件无法注册。
- **两个右侧面板不能同时启用**：官方侧边栏与 `dsh-better-sidebar` 同时启用时会互相重叠 ——
  better-sidebar 的隐藏 Explorer 行会拦截官方面板上按钮的指针事件（实测「复制」按钮点不动），
  官方侧边栏因此无法正常使用。必须停用其中一个（推荐停用 better-sidebar，见「升级指引」）。
- **官方默认页会改变**：官方规则是「已注册的指南条目恰好只有一个时直接打开那个页面，否则打开『开始』指南页」。
  本插件新增了一个指南条目，因此官方登记的条目数从 1 变 2，空面板的默认页由「工作区文件」变为「开始」指南页。
  两者都能从指南页一键进入。

### 新增

- **官方两段式注册**：先在 `ctx.sidebarRightTabs.register` 声明页面类型
  （`id: 'dsh-skill-sidebar'`、`kind: 'skills'`、`priority: 'extension'`、`title`、`guide`），
  再在 keyed 座位 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 下以该 `id` 注册主体与标签头。
  实现路径与官方 `@deepseek-ai/dsh-client-ui-sidebar-files` 完全一致。
- **指南页入口**：类型自带一个 `guide` 条目（`order: 20`、标题「技能」、一行描述、官方技能图标
  `IconSkillOutline16`），官方「开始」指南页出现「技能」胶囊，点击即以 `replaceTab` 打开技能页。
- **标签头座位**：注册 `sidebar.right.pane.tab.title`，标签 chip 上显示技能图标 + 标签文字。
- **有界重试的自动打开**：官方侧边栏默认折叠且为空，且 `ctx.sidebarRight.openTab`
  在没有挂载的会话座位时会**抛错**（它不会往没人画的面板里写）。因此按会话做有界重试
  （250ms 起、最多 25 次），成功后本次页面加载内不再重复打开，用户手动关闭后也尊重其选择。
- **生命周期接入**：主体的 30 秒后台轮询改为由 `useTabInfo().tab.visible` 控制，
  并叠加 `tab.signal.aborted` 作为退出条件，标签关闭或插件卸载时能干净停下。
- **可断言的 DOM 标记**：主体根元素带 `data-dsh-skill-sidebar="body"`，便于验证与排障。

### 变更

- **组件契约适配**：主体组件从 `betterSidebar` 的 props 形态切到官方座位形态 ——
  `useTabInfo().tab.visible` 取代 `props.visible`；`sessionId` 取代 `props.scope.sessionId`；
  `ctx` 改由座位的 `inject` 工厂提供。
- **`test-client.mjs` 重写**：从「模块加载器格式 + 纯函数」扩展到完整契约测试 ——
  类型声明、两个座位的注册与 key、`inject` 列表、自动打开的重试与去重、主体在
  `useTabInfo()` 下的渲染，以及原有的合并/置顶/缓存等纯函数用例。
- **README 增补**：新增「与官方侧边栏的契约」表（`id` / `kind` / 优先级 / 指南条目 / 座位 / 两面 inject）
  与默认页变化的说明。
- **`cordis.patch.yml` 注释**同步为官方侧边栏口径。

### 移除

- `ctx.betterSidebar.registerTab` 注册路径与 `betterSidebar` 依赖。
- 隐藏标签关闭 × 的 better-sidebar 专用 DOM hack
  （`[data-dsh-better-sidebar] [title="技能"] > button:last-child{display:none}`）：
  停用 better-sidebar 后该选择器必然失效，官方标签的关闭规则由官方统一管理。

### 修复

- **测试脚本的相对导入路径**：`test-client.mjs` 与 `test-host.mjs` 原先按
  `./dsh-skill-sidebar/lib/*.js` 解析，在插件目录内直接运行会 `ERR_MODULE_NOT_FOUND`
  （相对导入以文件自身目录为基准，与 cwd 无关）。改为 `./lib/*.js` 后，
  在插件目录内即可 `node test-client.mjs` / `node test-host.mjs`。

### 验证

两套测试均通过：

```powershell
node test-client.mjs   # ALL CLIENT CHECKS PASSED
node test-host.mjs     # ALL CHECKS PASSED
```

并在真实 DSH Web GUI（默认地址 `http://127.0.0.1:3080`）逐项实测通过：

- 标签确实渲染在官方面板内（`[data-dsh-skill-sidebar="body"]` 位于 `[data-sidebar-right-panel]`，
  且不在 `[data-dsh-better-sidebar]` 内）；
- 技能列表正常列出，条目数与页脚「本机 / 实时」诊断行一致；
- 搜索过滤、无匹配提示、清空恢复；
- 置顶排到最前并落 `localStorage`（`dsh-skill-sidebar:pins:v1`）、取消置顶恢复字典序；
- 复制把 `/技能名` 写入剪贴板并显示对勾反馈；
- 悬停弹出完整描述浮层，移开后消失；
- 刷新按钮「刷新中… → 刷新」往返并且列表保持；
- 点标签条的 `+` 打开指南页，官方「工作区文件」胶囊与本插件的「技能」胶囊并列出现。

### 升级指引

1. 更新插件源码（或重装 `link:` 依赖）。
2. 确认 DSH Web 端已内置官方侧边栏（DSH 安装目录下的
   `node_modules/@deepseek-ai/dsh-client-ui-sidebar-right` 存在）。
3. **停用第三方 `dsh-better-sidebar`**（可逆，别卸载）：在 profile 的 patch 层
   `cordis.patch.yml` 中按行 id 禁用 —— 即 `$DSH_HOME/profiles/web/cordis.patch.yml`
   （Windows 默认 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`），行 id 取自该插件的 bundle patch：

   ```yaml
   - id: better-sidebar
     disabled: true
   ```

   改完先校验 YAML 能解析，再重启 —— profile patch 语法错误会让宿主起不来。
4. **重启 dsh web**：`dsh.client.inject` 是 boot graph 的依赖边，只有重启才会重新组合。
   重启后硬刷新页面（Ctrl/Cmd+Shift+R）。
5. 若仍需第三方右侧面板提供的其他能力（Office 查看器、终端、浏览器视图等），
   不要停用它 —— 改为让本插件与它共存，但要接受两个右侧面板重叠、点击被拦截的问题。

**回滚**：删掉上面那两行 patch 并重启即可恢复 `dsh-better-sidebar`；
把 `lib/client.js` 与 `package.json` 回退到 `v0.1.0` 并重启即可退回第三方面板版。

[0.2.1]: https://github.com/lnyuqian/dsh-skill-sidebar/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/lnyuqian/dsh-skill-sidebar/compare/v0.1.0...v0.2.0
