# dsh-skill-sidebar

DSH web 插件：在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 右侧面板中新增一个「技能」选项卡，列出本机可读取的全部技能，并以简短描述介绍每个技能的功能。

## 功能

- **技能选项卡**：通过 `ctx.betterSidebar.registerTab` 注册，图标为技能图标，位于右侧面板的 `+` 菜单中（也可在侧边卡片设置里开关）。
- **紧凑排版**：每个技能两行展示 —— 第一行技能名，第二行以 4-6 字短语点出主要功能（如「日程管理，会议预定，忙闲查询」）；内联最多显示 4 个短语，功能更多的技能末尾以高亮 `+n` 表示。鼠标悬停任意技能行会弹出浮层显示完整功能描述。行与行之间以细分隔线隔开。
- **短语来源**：插件自带 `lib/phrases.json`（为当前全部技能手写的短语清单）；新安装的技能自动用规则从描述中拆分生成短语（按标点切分、取每段前 6 字、去重、最多 6 条）。
- **立即列出，无需等待**：数据优先来自会话实时技能目录（与输入框 `/` 技能菜单同源），并合并本机文件系统扫描结果；列表同时持久化到浏览器 localStorage 与会话缓存文件，再次启动打开选项卡即可瞬间渲染。
- **自动添加新技能**：本机技能根目录被 `fs.watch` 监听（含父目录，目录后建也能捕获），新技能安装后自动重新扫描；选项卡可见期间每 30 秒后台刷新一次实时目录。
- **每周一重新读取**：周一时服务端强制对本机所有技能做一次全量重读；此后每 6 小时校验一次，若缓存早于当天则再次刷新。

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
# 服务端逻辑测试（frontmatter 解析、扫描、路由、watcher、缓存）
node test-host.mjs

# 客户端契约测试（模块加载器格式、inject/apply、合并、缓存）
node test-client.mjs
```

`lib/client.js` 使用 DSH 客户端模块表格式（`window.__ModuleLoader__.load`），手写无需构建；`lib/index.js` 为纯 Node ESM，无第三方依赖。
