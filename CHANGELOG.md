# 更新日志

本文件记录本插件的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
