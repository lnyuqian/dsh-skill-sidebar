# dsh-skill-sidebar

**English**: A DSH plugin (web **and Desktop**) that adds a "Skills" page tab to DSH's **official right Sidebar** (`@deepseek-ai/dsh-client-ui-sidebar-right`, the docking tab surface added in DSH `0.1.5-rc.1`). It scans the local skill directories (`.agents/skills`, `.codex/skills`, `.claude/skills`, `.opencode/skills`), lists every skill with a short 4–6 character phrase describing what it does, and offers one-click copy of the `/skill-name` trigger syntax, pinning, directory tags, live re-scan on new skills, and instant rendering from cache. It runs unchanged inside the **DeepSeek Harness desktop client** (Electron, `dsh-app://app/` shell), where only the hover overlay geometry differs. As of `v0.2.0` it registers through the official two-stage tab-type API and no longer depends on the third-party `betterSidebar` service；as of `v0.3.0` it is dual-shell（中文说明见下）。

DSH 插件（**web 版 / 桌面版通用**）：在 **DSH 官方右侧边栏**（`@deepseek-ai/dsh-client-ui-sidebar-right`，官方新增的可停靠标签页系统）中新增一个「技能」标签页，列出本机可读取的全部技能，并以简短描述介绍每个技能的功能。桌面版（DeepSeek Harness Desktop，Electron）渲染同一套前端，因此**同一份代码两端通用**，仅悬停浮层按窗口尺寸自适应。

> v0.2.0 起从第三方 `dsh-better-sidebar` 面板迁移到官方侧边栏；不再依赖 `betterSidebar` 服务。版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

## 功能

- **官方侧边栏标签页**：走官方两段式注册 —— 先在 `ctx.sidebarRightTabs.register` 声明页面类型（`kind: 'skills'`，`priority: 'extension'`），再在 `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` 两个 keyed 座位下以定义 `id` 注册主体与标签头。图标为官方技能图标 `IconSkillOutline16`。
- **指南页入口**：类型自带一个 `guide` 条目，官方侧边栏的「开始」指南页出现「技能」胶囊，点击即以 `replaceTab` 打开技能页（与官方「工作区文件」同样的公开路径）。
- **默认自动打开**：官方侧边栏默认折叠且为空，`openTab` 会在同一步展开右栏；本插件在**每个新会话打开一次**（`AUTO_OPEN = true`，`lib/client.js` 顶部一个常量即可关闭）。侧边栏座位未挂载时命令会抛错，故做了**有界重试**（250ms 起，最多 25 次）；关闭标签页后本次页面加载内不再自动打开。
- **紧凑排版**：每个技能两行展示 —— 第一行技能名（+ 目录标签 + 操作按钮），第二行 4-6 字功能短语；行与行之间以细分隔线隔开，鼠标悬停任意技能行弹出浮层显示完整功能描述。
- **目录标签**：非公共目录（`.codex` / `.claude` / `.opencode`）的技能名后跟 `#目录` 小标签；公共目录 `.agents` 不加。
- **复制（一键调用）**：每行「复制」按钮，点击复制 `/技能名`（带斜杠，DSH 输入框的技能触发语法），粘贴到输入框即可触发该技能。
- **置顶 / 取消置顶**：每行 12px 图钉按钮；点击置顶后该技能**排到列表最前**（图标变主题色实心），再点取消；置顶状态存浏览器 localStorage（`dsh-skill-sidebar:pins:v1`），刷新后保留。
- **目录扩展扫描**：扫描本机 4 个技能目录 —— `.agents/skills`（公共）、`.codex/skills`、`.claude/skills`、`.opencode/skills`（后三个均可用环境变量 `DSH_CODEX_SKILL_DIR` / `DSH_CLAUDE_SKILL_DIR` / `DSH_OPENCODE_SKILL_DIR` 覆盖）；同名技能以 `.agents` 优先去重（`.claude` 的 junction 软链接不重复显示）。各目录类型均支持 `$DSH_SKILL_DIRS` 追加。
- **短语来源**：插件自带 `lib/phrases.json`（为中文技能手写的 4-6 字短语清单）与 `lib/skills-zh.json`（为**英文** SKILL.md 技能提供的中文短语 + 一句话中文说明，随包分发）；两者都没有的新安装技能自动用规则从描述中拆分生成短语（按标点切分、取每段前 6 字、去重、最多 6 条）。解析自动处理 UTF-8 BOM 与 GBK 编码文件。
- **中文化（v0.3.0）**：本机多数技能的 `SKILL.md` 是英文，规则短语只能截出 `Use when`、`adding A` 这类片段。现在列表第二行显示随包的中文短语（如 `网页搜索，整页抓取，资料检索`），悬停浮层把**中文说明排在最前**、英文原文与 `whenToUse` 保留在后；技能名保持英文原样，因为它就是 `/技能名` 的调用标识。中文技能沿用 `phrases.json` 的手写短语，不受影响。
- **立即列出，无需等待**：服务端把技能列表直接注入页面（`window.__DSH_SKILLS__`），同时持久化到浏览器 localStorage 与会话缓存文件，再次启动打开选项卡即可瞬间渲染，无需网络往返。**桌面版例外**：Electron 直接读取打包好的前端（`dsh-app://app/` 由 `serveWebDocument` 提供），不经过 `webServer` 的 index 变换管道，因此该首屏注入在桌面端不生效 —— 桌面端首屏来自 localStorage 快照与实时目录，随后由 `/skillpanel/skills` 补齐（功能不受影响，只是没有"零请求"那一层）。
- **自动添加新技能**：4 个技能目录被 `fs.watch` 监听（含父目录），新技能安装后自动重新扫描；标签页可见期间每 30 秒后台刷新一次实时目录；缓存随目录集合变化自动失效重扫。
- **每周一重新读取**：周一时服务端强制对全部技能做一次全量重读；此后每 6 小时校验一次，若缓存早于当天则再次刷新。
- **桌面版（v0.3.0）**：同一份代码在 **DeepSeek Harness 桌面版**里运行 —— 页面挂在 `dsh-app://app/` 协议下，相对 `fetch('/skillpanel/skills')` 由 Electron 主进程带认证 cookie 转发给本地 webserver，槽位注册与数据通道与 web 版完全一致；仅悬停浮层按窗口尺寸自适应（左右夹紧、上下翻转、限高，超出空间的描述截断为省略号），长技能名在窄栏里省略显示而不是把操作按钮挤出可视区，页脚显示当前运行外壳（桌面版 / 浏览器）。

## 桌面版（DeepSeek Harness Desktop）

桌面版是 Electron 外壳 + 内置本地 webserver，**渲染同一套 Web 前端**，插件通过 `~/.dsh/profiles/desktop` 这个独立 profile 装载（与 `profiles/web` 互不影响）。

| 项目 | web 版 | 桌面版 |
|---|---|---|
| profile | `$DSH_HOME/profiles/web` | `$DSH_HOME/profiles/desktop`（由 Electron 独占管理） |
| 页面来源 | `http://127.0.0.1:<port>`（浏览器访问） | `dsh-app://app/`（Electron 窗口） |
| 插件安装 | `dsh plugin --profile web add …` | 应用内插件管理（设置 → 插件）或 `install-desktop.ps1` |
| 侧边栏契约 | 官方 `sidebar.right.pane.tab(.title)` + `sidebarRightTabs` | **完全相同** |
| 数据通道 | `fetch('/skillpanel/skills')` | **相同**（`dsh-app://` 下由主进程代理并带认证 cookie） |
| 首屏注入 | `webServer.tapIndex` → `window.__DSH_SKILLS__` | **不生效**（Electron 直接读打包前端）；首屏用 localStorage 快照 + 实时目录 |
| 差异 | — | 窗口通常更小 → 浮层几何自适应、窄栏技能名省略 |

安装（桌面版已运行时，**无需重启**）：

```powershell
# 方式一：应用内插件管理 —— 设置 → 插件，或让 DSH 助手用 plugin_manager 工具安装
#         本次开发即用这条路：安装 link 指向本仓库后宿主热重组，右栏立即出现「技能」标签页

# 方式二：应用完全退出后，用桌面自带的 CLI 载体安装
pwsh -File .\install-desktop.ps1                    # link 安装（开发）
pwsh -File .\install-desktop.ps1 -Mode Tarball      # 从 tgz 安装（分发）
pwsh -File .\install-desktop.ps1 -Uninstall         # 卸载
```

在桌面版里确认已生效：

- 右侧边栏出现「技能」标签页（新会话会自动打开一次），或从右栏「开始」指南页点「技能」胶囊进入；
- 列表底部显示「桌面版」与技能来源（本机 / 实时 / 缓存）；
- 服务端缓存落在 `$DSH_HOME/storages/dsh-skill-sidebar/skills.json`，说明宿主半侧已扫描完成。

> 桌面版与 web 版共用同一份 `lib/`：没有平台分叉代码，`dsh.client.platform` 仍是 `"web"`（桌面版同样按 web 平台客户端加载，与 dsh-mobile、dsh-quick-prompts 一致）。唯一的实现差异是上面表格里的首屏注入一行：`tapIndex` 只在浏览器路径上执行。

## 与官方侧边栏的契约

| 项目 | 值 |
|---|---|
| 标签类型 `id` | `dsh-skill-sidebar`（同时是主体/标签头注册的 key） |
| 页面 `kind` | `skills`（页面类型，不声明 `patterns`） |
| 优先级 | `extension`（产品外插件） |
| 指南条目 | `order: 20`、标题「技能」、一行描述、技能图标 |
| 注册座位 | `sidebar.right.pane.tab`、`sidebar.right.pane.tab.title` |
| 插件级 `inject` | `slots`、`sidebarRightTabs`、`sidebarRight`、`connection`、`sessions` |
| `dsh.client.inject` | `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-sidebar-right` |

标签主体的 props：框架注入的 `useTabInfo()`（`tab.visible` 控制 30 秒轮询、`tab.signal` 限定生命周期）、`sessionId`，以及本插件通过 `inject` 提供的 `ctx`。

> 注：官方默认页规则是「指南条目只有一个时直接打开它」。加入本插件的指南条目后，官方登记了 2 个指南条目（工作区文件 + 技能），因此空面板的默认页由「工作区文件」变为「开始」指南页；两者都能从指南页一键进入。

## 数据源

- **实时目录**：`connection.api.skills.list({ sessionId })` —— 当前会话可见的技能（含内置与用户技能），由 DSH 的 skill 注册表实时提供。
- **本机扫描**：`GET /skillpanel/skills` —— 插件服务端直接扫描技能根目录（`~/.agents/skills`，可用 `$DSH_AGENTS_HOME` 与 `$DSH_SKILL_DIRS` 扩展），解析 `SKILL.md` 的 YAML frontmatter（`name` / `description` / `whenToUse`）。
- **中文短语与说明**：`lib/skills-zh.json` —— 包内随附的中文表（key 为技能名，含 `phrases` 与 `summary`），服务端在扫描时把 `summary` 写进条目的 `zh` 字段；客户端列表用 `phrases`、悬停用 `zh` + 原文。该表的指纹写进缓存签名，换表后自动重扫（不必等周一）。
- 两份数据按名称求并集合并展示（实时目录优先），因此既能显示会话可调用的技能，也能显示仅用户可调用或机器上其他根目录的技能。

## 缓存与刷新策略

| 项目 | 位置 | 策略 |
|---|---|---|
| 服务端缓存 | `$DSH_HOME/storages/dsh-skill-sidebar/skills.json`（可用 `$DSH_SKILL_CACHE_DIR` 覆盖） | 启动时若非周一且 7 天内已扫描则直接使用；否则重扫 |
| 浏览器缓存 | localStorage `dsh-skill-sidebar:cache:v1` | 打开选项卡立即渲染，后台再刷新 |
| 自动添加 | `fs.watch`（500ms 防抖）+ 5 分钟轮询兜底 | 新技能出现即重扫 |
| 每周一 | 服务端 6 小时定时器 + 客户端周一强制刷新 | 全量重读 |

## 路由

- `GET /skillpanel/skills` —— 返回 `{ ok, skills, scannedAt, source, policy }`
- `GET /skillpanel/skills/refresh` —— 立即重扫并返回最新列表

两条路由均使用与 `/api` 网关相同的浏览器信任围栏（loopback Host 或 connection 行的 `trustedHosts`）。

## 安装 / 卸载

```bash
# web 版：把 <本包绝对路径> 换成本仓库在本机的路径（link: 安装，改源码后重启即生效）
dsh plugin --profile web add link:<本包绝对路径>

# web 版卸载
dsh plugin --profile web remove dsh-skill-sidebar
```

```powershell
# 桌面版（desktop profile 由 Electron 独占管理，全局 dsh CLI 会拒绝操作）：
#   应用运行中 → 设置 → 插件（或 DSH 助手用 plugin_manager 工具），无需重启
#   应用已退出 → 用本仓库脚本
pwsh -File .\install-desktop.ps1                 # link 安装
pwsh -File .\install-desktop.ps1 -Uninstall      # 卸载
```

web 版安装/卸载后需**重启 dsh web 并硬刷新**（Ctrl/Cmd+Shift+R）；桌面版通过应用内插件管理安装是热生效的（宿主重组后页面按需加载新 bundle），用脚本安装则在启动桌面版后生效。依赖以 `link:` 形式指向本目录，改动源码后重启/重载即可生效（无需重新安装）。

## 平台支持

| 平台 | 状态 |
|---|---|
| Windows 11 + DSH web（浏览器） | ✅ 已验证（DSH `0.2.0-rc.2`） |
| Windows 11 + DeepSeek Harness 桌面版 | ✅ 已验证（desktop profile；两段式注册与 host 路由实测生效） |
| macOS | ⚠️ 未测试 |

插件只用 Node 的跨平台 API（`node:path` 的 `join()`、`node:os` 的 `homedir()`）与
`DSH_HOME` / `DSH_AGENTS_HOME` / `DSH_SKILL_DIRS` / `DSH_SKILL_CACHE_DIR` 等环境变量定位文件：
没有平台专有路径，也不假设路径分隔符（技能根目录一律用 `join()` 拼接）。客户端部分只在 Web 运行时（浏览器或
桌面版 Electron 渲染进程）里运行，与操作系统无关，也不区分两种外壳 —— 只有浮层几何按窗口尺寸自适应。
可选的请求跟踪日志默认关闭，需显式设置 `DSH_SKILL_SIDEBAR_TRACE`（见「路由」）。

## 开发

```powershell
# 客户端契约测试（官方两段式注册、自动打开重试、主体渲染、合并/缓存/置顶）
node test-client.mjs

# 服务端逻辑测试（frontmatter 解析、扫描、路由、watcher、缓存）
node test-host.mjs

# 桌面版适配测试（外壳识别、浮层几何、桌面端槽位注册端到端）
node test-desktop.mjs

# 三套一起
npm test
```

`lib/client.js` 使用 DSH 客户端模块表格式（`window.__ModuleLoader__.load`），手写无需构建；`lib/index.js` 为纯 Node ESM，无第三方依赖。
