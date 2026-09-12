# dsh-skill-sidebar

**English**: A DSH Web plugin that adds a "Skills" page tab to DSH's **official right Sidebar** (`@deepseek-ai/dsh-client-ui-sidebar-right`, the docking tab surface added in DSH `0.1.5-rc.1`). It scans the local skill directories (`.agents/skills`, `.codex/skills`, `.claude/skills`, `.opencode/skills`), lists every skill with a short 4–6 character phrase describing what it does, and offers one-click copy of the `/skill-name` trigger syntax, pinning, directory tags, live re-scan on new skills, and instant rendering from cache. As of `v0.2.0` it registers through the official two-stage tab-type API and no longer depends on the third-party `betterSidebar` service.（中文说明见下）

DSH web 插件：在 **DSH 官方右侧边栏**（`@deepseek-ai/dsh-client-ui-sidebar-right`，官方新增的可停靠标签页系统）中新增一个「技能」标签页，列出本机可读取的全部技能，并以简短描述介绍每个技能的功能。

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
- **短语来源**：插件自带 `lib/phrases.json`（为全部技能手写的 4-6 字短语清单）；新安装的技能自动用规则从描述中拆分生成短语（按标点切分、取每段前 6 字、去重、最多 6 条）。解析自动处理 UTF-8 BOM 与 GBK 编码文件。
- **立即列出，无需等待**：服务端把技能列表直接注入页面（`window.__DSH_SKILLS__`），同时持久化到浏览器 localStorage 与会话缓存文件，再次启动打开选项卡即可瞬间渲染，无需网络往返。
- **自动添加新技能**：4 个技能目录被 `fs.watch` 监听（含父目录），新技能安装后自动重新扫描；标签页可见期间每 30 秒后台刷新一次实时目录；缓存随目录集合变化自动失效重扫。
- **每周一重新读取**：周一时服务端强制对全部技能做一次全量重读；此后每 6 小时校验一次，若缓存早于当天则再次刷新。

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

```powershell
# 安装（已在本机执行）
dsh plugin --profile web add link:E:/dsh-web/插件技能安装/dsh-skill-sidebar
# 或从任意目录：dsh plugin --profile web add link:<本包绝对路径>

# 卸载
dsh plugin --profile web remove dsh-skill-sidebar
```

安装/卸载后需**重启 dsh web 并硬刷新**（Ctrl/Cmd+Shift+R）。依赖以 `link:` 形式指向本目录，改动源码后重启即可生效（无需重新安装）。

## 开发

```powershell
# 客户端契约测试（官方两段式注册、自动打开重试、主体渲染、合并/缓存/置顶）
node test-client.mjs

# 服务端逻辑测试（frontmatter 解析、扫描、路由、watcher、缓存）
node test-host.mjs
```

`lib/client.js` 使用 DSH 客户端模块表格式（`window.__ModuleLoader__.load`），手写无需构建；`lib/index.js` 为纯 Node ESM，无第三方依赖。
