/**
 * dsh-skill-sidebar — client half.
 *
 * Registers a 技能 (Skills) page tab into DSH's OFFICIAL right Sidebar
 * (`@deepseek-ai/dsh-client-ui-sidebar-right`), the docking surface whose tab
 * types any package may contribute. The tab lists every skill readable in this
 * environment with a short description.
 *
 * Two-stage official registration (same public path the shipped guide and the
 * official Files type use — see ui-sidebar-files):
 *  1. `ctx.sidebarRightTabs.register({ id, kind, title, guide })` — the type:
 *     a page type (no `patterns`), opened by kind `'skills'`, plus one guide
 *     entry so the guide page offers a 技能 capsule that opens this tab.
 *  2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)`
 *     — the body, receiving the framework `useTabInfo()` hook; and a second
 *     registration in `sidebar.right.pane.tab.title` for the chip glyph.
 *
 * Data flow:
 *  - instant first paint: a localStorage snapshot written by a previous
 *    session ("下次启动后打开就能列出，无须再次读取");
 *  - authoritative: the live per-session catalog
 *    (connection.api.skills.list — the same source the "/" skill menu uses),
 *    which the host keeps fresh when skills are installed/changed (auto-add);
 *  - fallback: the host half's machine-wide filesystem scan
 *    (GET /skillpanel/skills), which re-reads all skills every Monday;
 *  - while the tab is visible it re-fetches every 30s, so a newly installed
 *    skill appears automatically.
 *
 * Bundle format: the DSH client module table (window.__ModuleLoader__.load),
 * same as dsh-better-sidebar / dsh-client-ui-skill — no build step needed.
 *
 * web / 桌面双端 (DSH Desktop, Electron):
 *  - the desktop client renders this very same Web front end, served from the
 *    `dsh-app://app/` scheme instead of `http(s)://`; the relative
 *    `fetch('/skillpanel/skills')` is proxied by the Electron main process to
 *    the local webserver with the session cookie, so the host routes, the slot
 *    registrations and the data channel are identical on both shells;
 *  - the desktop window is typically much smaller than a browser window, so the
 *    hover tooltip is placed by `computeTipPos` (flip above/below, clamp to the
 *    frame, cap the height and ellipsize what no longer fits) and a long skill
 *    name ellipsizes in the narrow right Sidebar instead of pushing the
 *    pin/copy buttons out of view;
 *  - the footer shows which shell is running (桌面版 / 浏览器) for diagnosis.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-sidebar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /* @zh-inline-start (generated from lib/skills-zh.json by scripts/sync-zh.mjs — do not edit by hand) */
    var ZH_INLINE = {
      "Codex": {"phrases":["技能安装","钩子配置","权限设置","MCP 注册"],"summary":"配置 Codex 时使用，包括安装技能与智能体、写钩子、设权限、注册 MCP 及编写项目指令。"},
      "Codex-api": {"phrases":["接口调用","流式输出","工具调用","批量处理"],"summary":"开发或调试调用 Codex API 的应用，实现工具调用、流式输出与智能体循环，适合接入模型能力时参考。"},
      "accessibility": {"phrases":["无障碍适配","键盘导航","读屏兼容"],"summary":"为界面补齐键盘与读屏兼容并检查 WCAG AA 达标情况，适合上线前的无障碍审查。"},
      "agentex": {"phrases":["智能体搭建","配置调试","流程排错"],"summary":"搭建和调试 Agentex 智能体，配置类型、消息状态与 Windows 环境问题。"},
      "agents-sdk": {"phrases":["智能体开发","状态保持","定时任务","实时通信"],"summary":"用 Agents SDK 在 Cloudflare 上搭建有状态智能体，适合实时通信、定时任务与 MCP 服务场景。"},
      "ai-engineer": {"phrases":["RAG 管道","向量库选型","智能体编排"],"summary":"搭建生产级大模型应用，覆盖检索增强、向量库选型与智能体编排，适合做成本与安全加固。"},
      "angular": {"phrases":["组件重构","状态管理","路由配置","测试编写"],"summary":"构建和重构 Angular 应用，在信号、RxJS 与 NgRx 之间取舍并优化变更检测。"},
      "api-design": {"phrases":["接口设计","分页过滤","版本规划","契约评审"],"summary":"设计新的 REST 接口或评审现有 API 契约，需要分页、过滤或版本规划时使用。"},
      "aws": {"phrases":["AWS 开发","S3 读写","权限配置","队列处理"],"summary":"编写 boto3 与 SDK 代码，配置 IAM 权限、读写 S3、设计数据库与函数，适合排查凭证与限流报错。"},
      "azure": {"phrases":["云存储集成","混合检索","身份认证"],"summary":"编写接入 Azure 存储、检索与密钥服务的 Python 代码，并排查 SDK 重试问题。"},
      "azure-service-bus": {"phrases":["队列与主题","死信处理","顺序消费","可靠消息处理"],"summary":"用 Azure Service Bus 做可靠消息处理，在队列与主题选型、死信处理或顺序消费时使用。"},
      "banner-design": {"phrases":["横幅设计","社媒海报","广告图制作"],"summary":"生成社媒、广告与网站首屏的横幅图，提供多种视觉风格与配图，适合运营素材快速出稿。"},
      "brand": {"phrases":["品牌语气","视觉识别","素材管理"],"summary":"统一品牌语气、视觉识别与营销素材，保证多渠道内容与风格指南一致。"},
      "caching": {"phrases":["缓存策略","TTL 设计","击穿防护","失效处理"],"summary":"为服务添加或排查缓存，在选策略、设 TTL、防击穿和配置 HTTP 缓存头时使用。"},
      "canvas-design": {"phrases":["海报创作","视觉艺术","静态设计"],"summary":"用设计理念生成 png 与 pdf 视觉作品，可做海报或艺术图，适合需要原创静态画面时使用。"},
      "ci-cd": {"phrases":["流水线搭建","云端认证","制品发布","环境晋升"],"summary":"搭建和排查 GitHub Actions 流水线，配置质量门禁、矩阵测试与制品发布。"},
      "claude-api": {"phrases":["工具调用","流式输出","视觉批处理","智能体循环"],"summary":"开发或调试调用 Claude API 的应用，涉及工具调用、流式输出、批处理或智能体循环时使用。"},
      "claude-code": {"phrases":["技能安装","钩子配置","MCP 注册","权限设置"],"summary":"配置 Claude Code 的技能、代理、钩子、工具权限与 MCP 服务，也覆盖项目说明文件编写。"},
      "cloudflare": {"phrases":["平台开发","存储服务","网络安全"],"summary":"覆盖 Workers、Pages、存储、AI 与安全的全平台开发，随手查官方文档。"},
      "cloudflare-email-service": {"phrases":["邮件收发","路由配置","送达率优化","邮件 MCP"],"summary":"用 Cloudflare 收发事务邮件，配置路由、SPF/DKIM/DMARC 或排查送达问题时使用。"},
      "cloudflare-one": {"phrases":["零信任配置","访问策略","隧道排错"],"summary":"指导 Cloudflare One 零信任与 SASE 部署，覆盖访问控制、网关与隧道，适合设计与排障时查阅。"},
      "cloudflare-one-migrations": {"phrases":["迁移评估","策略映射","上线规划"],"summary":"把传统 VPN、SWG 或 SASE 安全架构迁移到 Cloudflare One，输出评估、策略映射与上线计划。"},
      "coding-standards": {"phrases":["代码审查","命名规范","设计模式","重构建议"],"summary":"审查代码质量、统一命名与设计模式，为新项目定下编码规范。"},
      "complex-doc-rag": {"phrases":["文档解析入库","检索问答","表格图表处理","图片内容提取"],"summary":"搭建能读 PDF、Excel、图片的 RAG 流程，遇到数据丢失、OCR 选型或表格图表难题时使用。"},
      "containerization": {"phrases":["镜像构建","容器编排","资源限额","Helm 打包"],"summary":"编写 Dockerfile 与 compose 配置，部署 Kubernetes 资源并用 Helm 打包服务，适合本地开发与上线部署。"},
      "data-pipelines": {"phrases":["管道搭建","增量加载","数据校验","任务编排"],"summary":"用 Airflow、Prefect 与 dbt 搭建数据管道，做增量加载、质量校验与编排。"},
      "database-design": {"phrases":["表结构设计","索引优化","零停机迁移","连接池配置"],"summary":"设计数据库结构、加索引优化慢查询、写零停机迁移或排查 N+1 问题时使用。"},
      "deployment-strategies": {"phrases":["灰度发布","蓝绿部署","特性开关","回滚方案"],"summary":"为版本发布选择灰度或蓝绿方案，用特性开关解耦上线，并规划零停机迁移与回滚标准。"},
      "design": {"phrases":["品牌设计","设计令牌","图标生成","演示文稿"],"summary":"生成品牌识别、设计令牌、Logo、横幅、图标与演示文稿等成套视觉素材。"},
      "design-system": {"phrases":["设计令牌","组件规范","幻灯片生成","品牌一致性"],"summary":"建立三层设计令牌与组件规范，并生成符合品牌调性的演示文稿时使用。"},
      "development-workflow": {"phrases":["分支策略","提交规范","代码评审","版本打标"],"summary":"规划分支策略、规范提交信息、发起与评审合并请求并给版本打标签，适合搭建团队协作流程。"},
      "doc-coauthoring": {"phrases":["文档协作","提案撰写","技术规格"],"summary":"带你按流程共创文档，把零散背景整理成提案、技术规格或决策记录。"},
      "docker": {"phrases":["镜像构建","容器编排","镜像瘦身","容器排障"],"summary":"编写和优化 Dockerfile、配置 Compose 服务，或给 Python、Node.js 应用减小镜像体积时使用。"},
      "docx": {"phrases":["Word 生成","文档编辑","内容提取","格式排版"],"summary":"创建、读取与编辑 Word 文档，支持目录、页眉、图片替换与批注修订，适合产出正式报告文稿。"},
      "durable-objects": {"phrases":["有状态协调","存储设计","代码审查"],"summary":"创建和审查 Cloudflare Durable Objects，实现房间、游戏等有状态协调逻辑并排查问题。"},
      "event-driven": {"phrases":["分区策略","发件箱模式","死信队列","幂等消费"],"summary":"设计或排查事件驱动系统，涉及 Kafka 分区、发件箱模式、死信队列与幂等消费时使用。"},
      "fastapi": {"phrases":["应用分层","依赖注入","数据校验","异步测试"],"summary":"组织接口项目结构，设计依赖注入与数据模型并加登录认证，适合搭建后端服务时参考。"},
      "feature-flags": {"phrases":["开关接入","灰度发布","实验设计"],"summary":"为服务接入功能开关，设计灰度发布与 A/B 实验，并管理开关生命周期。"},
      "firecrawl": {"phrases":["网页搜索","整页抓取","批量抓取","变更监控"],"summary":"用 Firecrawl 处理联网任务，搜索网页、抓取正文、发现站点链接或监控页面变化时使用。"},
      "firecrawl-agent": {"phrases":["多页抓取","结构化提取","网页数据采集"],"summary":"自动遍历多个页面并按给定结构提取数据，适合抓取价格表或商品列表这类跨页信息。"},
      "firecrawl-company-directories": {"phrases":["公司名录抓取","结构化导出","线索整理"],"summary":"用 Firecrawl 把 YC、Crunchbase 等企业名录抓成 JSON 或可直接入库的列表，方便做线索整理。"},
      "firecrawl-competitive-intel": {"phrases":["竞品监控","定价对比","更新追踪","变化预警"],"summary":"持续跟踪竞争对手的定价、功能与更新日志，需要定期竞品情报或变化提醒时使用。"},
      "firecrawl-crawl": {"phrases":["整站抓取","批量采集","文档归档"],"summary":"批量抓取某个站点或目录下的所有页面，适合把整片文档或栏目内容一次性取回。"},
      "firecrawl-dashboard-reporting": {"phrases":["看板取数","指标汇总","定时报表"],"summary":"用浏览器抓取分析看板与内部工具，输出跨平台指标汇总和按日期段的报表。"},
      "firecrawl-deep-research": {"phrases":["深度调研","多角度分析","带引用报告","正反观点梳理"],"summary":"针对复杂科学、技术或市场议题，需要严谨综述并带完整引用的正式报告时使用。"},
      "firecrawl-demo-walkthrough": {"phrases":["流程走查","体验分析","演示准备"],"summary":"用浏览器走通注册、引导与定价等关键流程并输出体验报告，适合产品演示或体验复盘。"},
      "firecrawl-developer-index": {"phrases":["问题检索","合并请求查询","文档速查"],"summary":"检索 issue、合并 PR 与文档，弄清库或接口行为、报错含义和缺陷是否已修。"},
      "firecrawl-download": {"phrases":["站点下载","离线文档","本地存档","截图保存"],"summary":"把整个站点或某个板块保存成本地 markdown 与截图，用于离线查阅资料时使用。"},
      "firecrawl-interact": {"phrases":["浏览器操作","表单填写","登录翻页","滚动加载"],"summary":"在页面上驱动真实浏览器点击、填表、登录与翻页，适合内容需要交互或抓取不完整时补救。"},
      "firecrawl-knowledge-base": {"phrases":["知识库构建","RAG 语料切片","语料整理"],"summary":"把网页内容整理成本地参考文档、RAG 切片或微调语料，建成可检索知识库。"},
      "firecrawl-knowledge-ingest": {"phrases":["知识库采集","登录门户抓取","分页文档抓取","结构化提取"],"summary":"采集公开或需登录的知识库与文档门户，处理重 JS 页面和分页帮助中心时使用。"},
      "firecrawl-lead-gen": {"phrases":["线索挖掘","客户名单","数据导出"],"summary":"从名录与网页中按职位、行业、地区筛出潜在客户并导出表格，适合销售拓客前整理名单。"},
      "firecrawl-lead-research": {"phrases":["客户调研","会前简报","要点准备"],"summary":"在销售或合作会面前，快速整理对方公司、人员和近期动态，备好话题与痛点。"},
      "firecrawl-map": {"phrases":["站点地图","链接发现","站内检索","结构梳理"],"summary":"已知网站但不确定具体页面时，用它列出站点全部链接并定位目标地址。"},
      "firecrawl-market-research": {"phrases":["市场调研","行业趋势","财报数据","竞品对比"],"summary":"抓取并整理市场、行业与上市公司财务数据形成报告，适合做行业趋势或竞品分析时使用。"},
      "firecrawl-monitor": {"phrases":["网页监控","变更告警","结果订阅"],"summary":"对固定网址或全网关键词做周期性检查，网页一有变化就通过邮件或 Webhook 告警。"},
      "firecrawl-parse": {"phrases":["本地文件解析","格式转换","内容问答"],"summary":"输入是本地 PDF、DOCX、XLSX 等文件而非网址时，把它转成 markdown 并回答问题。"},
      "firecrawl-qa": {"phrases":["网站测试","表单验证","链接检查","缺陷报告"],"summary":"用浏览器对线上站点做探索式测试与取证，检查表单、跳转与响应式表现，适合上线前的质量验收。"},
      "firecrawl-research-index": {"phrases":["论文检索","文献追踪","语义搜索"],"summary":"在论文索引里用语义搜索找文献，覆盖生物医学与 arXiv 预印本等研究问题。"},
      "firecrawl-research-papers": {"phrases":["论文检索","文献综述","相关论文扩展","学术来源整理"],"summary":"检索并综述 PubMed、bioRxiv、arXiv 等论文，需要文献综述或研究现状梳理时使用。"},
      "firecrawl-scrape": {"phrases":["网页抓取","正文提取","JS 渲染"],"summary":"把一个网址的内容抓成干净的 markdown，支持动态渲染页面，适合已知链接时取全文。"},
      "firecrawl-search": {"phrases":["网页搜索","整页抓取","资料检索"],"summary":"在还不知道网址时做网页搜索并抓取整页内容，适合找资料、文章和新闻。"},
      "firecrawl-seo-audit": {"phrases":["SEO 审计","元数据检查","关键词机会","竞品排名对比"],"summary":"审查网站的 SEO，检查标题描述、站点结构与关键词机会，并给出优化优先级建议。"},
      "firecrawl-shop": {"phrases":["商品比价","选品推荐","评价分析"],"summary":"跨站搜集商品信息并比较价格与评价，给出购买建议，适合购物前做功课或整理购物清单。"},
      "firecrawl-website-design-clone": {"phrases":["设计系统提取","配色字体","风格克隆"],"summary":"把任意网站的设计系统提取成 DESIGN.md，供 AI 参考配色、字体与布局做新页面。"},
      "firecrawl-workflows": {"phrases":["调研报告","线索清单","知识库搭建","网站设计系统"],"summary":"需要 Firecrawl 直接产出调研报告、线索名单、SEO 审计或知识库等成品时使用。"},
      "flclash-monitor-transfer": {"phrases":["脚本迁移","开机自启","代理监控","状态排查"],"summary":"迁移并注册 FlClash 自动代理监控脚本到其他电脑，配置代理组并检查日志，适合换机或排障。"},
      "frontend": {"phrases":["组件设计","状态管理","数据请求","渲染优化"],"summary":"设计 React 组件结构与状态归属，用 TanStack Query 取数并优化渲染性能。"},
      "frontend-design": {"phrases":["前端界面设计","组件开发","页面美化","视觉风格打磨"],"summary":"制作有设计感的前端页面、组件或仪表盘，想让界面摆脱通用 AI 风格时使用。"},
      "general-temporal": {"phrases":["工作流编排","重试超时","确定性校验","状态回放"],"summary":"用 Python 构建 Temporal 工作流，处理重试、超时与状态回放，适合排查长任务执行失败。"},
      "github-issues": {"phrases":["议题管理","缺陷报告","严重度分级"],"summary":"创建和分诊 GitHub issue，写缺陷报告与需求单，处理回归和跨仓库依赖。"},
      "go": {"phrases":["错误处理","并发设计","泛型用法","Go 惯用法"],"summary":"编写或调试较复杂的 Go 代码，涉及并发、错误处理、泛型或惯用写法时使用。"},
      "incident-response": {"phrases":["告警分级","故障复盘","值班升级","手册编写"],"summary":"处理线上告警并定级，撰写复盘与运维手册并安排值班升级路径，适合事故后快速响应。"},
      "infrastructure-as-code": {"phrases":["基础设施编排","远程状态","模块复用"],"summary":"用 Terraform 管理云资源，规划模块与多环境，并在 apply 前审查变更。"},
      "integration-testing": {"phrases":["集成测试","测试环境搭建","端到端测试","契约测试"],"summary":"写连接真实数据库或消息中间件的测试，用 Testcontainers 搭建环境或做契约测试时使用。"},
      "internal-comms": {"phrases":["内部通告","状态汇报","公司简报"],"summary":"按公司惯用格式撰写各类内部沟通材料，如状态汇报、领导简报与常见问答，适合对内发布信息。"},
      "langgraph": {"phrases":["状态图设计","条件路由","多智能体编排"],"summary":"构建和调试 LangGraph 工作流，设计状态图、条件分支、流式输出与人机协同。"},
      "ltx23-video-prompting": {"phrases":["视频提示词","图生视频","多关键帧","音效设计"],"summary":"为 LTX-2.3 音视频模型写生产级提示词，做文生视频、图生视频或音效设计时使用。"},
      "mcp-builder": {"phrases":["MCP 服务","工具设计","接口对接"],"summary":"构建高质量的服务端，把外部接口封装成模型可调用的工具，适合做服务集成时参考。"},
      "memory-map": {"phrases":["记忆配置","上下文管理","压缩调优"],"summary":"安装和配置 memory_map，决定哪些内容进记忆，并解决会话启动时上下文缺失。"},
      "microservices": {"phrases":["服务拆分","服务间通信","熔断补偿","网关搭建"],"summary":"拆分单体应用、设计服务间通信与熔断补偿，或为分布式系统搭建网关时使用。"},
      "minimax-h3-comfyui-troubleshooting": {"phrases":["视频黑屏","音频异常","显存优化","采样提速"],"summary":"排查 ComfyUI 里模型加载失败、黑屏、音频异常与采样过慢，适合旧显卡部署生成任务时调优。"},
      "modlens": {"phrases":["图像识别","文字转录","视觉插件"],"summary":"让纯文本模型也能看图：把图片转成结构化 JSON，包含文字、版式与视觉线索。"},
      "mongodb": {"phrases":["聚合管道","索引创建","多文档事务","异步查询"],"summary":"用 Motor 写异步 MongoDB 查询、设计聚合管道、建索引或使用事务时使用。"},
      "monid": {"phrases":["端点发现","数据检索","内容监控","信息补全"],"summary":"检索可用的数据端点，覆盖抓取、社媒与内容监控，适合在写爬虫或缺少数据源时使用。"},
      "observability": {"phrases":["结构化日志","指标埋点","链路追踪","告警规则"],"summary":"为服务补上结构化日志、Prometheus 指标、链路追踪和 SLO 告警与看板。"},
      "obsidian-cli": {"phrases":["笔记管理","库内搜索","任务与属性","插件调试"],"summary":"用命令行读写和搜索 Obsidian 笔记库，或开发调试插件与主题时使用。"},
      "obsidian-markdown": {"phrases":["双链笔记","标注卡片","属性字段"],"summary":"编写带双链、嵌入与标注的 Obsidian 笔记语法，适合整理知识库或维护笔记时使用。"},
      "openai-agents": {"phrases":["智能体编排","工具交接","流式响应"],"summary":"用 OpenAI Agents SDK 定义智能体、工具与交接，接入带类型的上下文和护栏。"},
      "pdf": {"phrases":["文本表格提取","合并拆分","加水印表单","扫描件识别"],"summary":"处理 PDF 文件的各种操作，如提取内容、合并拆分、加水印、填表单或 OCR 识别。"},
      "performance": {"phrases":["慢接口排查","缓存加速","查询优化","延迟预算"],"summary":"诊断接口变慢与重复查询，加缓存并把计算任务转交线程，适合给服务定延迟指标时使用。"},
      "performance-testing": {"phrases":["压力测试","阈值设定","瓶颈定位"],"summary":"上线前或流量突变后做压测，用 k6、Locust 写脚本并定位性能瓶颈。"},
      "photon-batch-production": {"phrases":["批量变体生成","画板管理","图层合成","批量导出"],"summary":"用声明式批次批量产出 Photon 变体、画板、图层合成与导出文件时使用。"},
      "photon-composite": {"phrases":["图层合成","照片拼贴","矢量叠加"],"summary":"把照片、抠图、文字与矢量形状合成为分层设计稿，适合制作海报与视觉合成图。"},
      "photon-edit": {"phrases":["文档编辑","实时协作","会话管理"],"summary":"通过 Photon 命令行或 MCP 创建和编辑文档，支持未保存项目与后台会话。"},
      "photon-generated-images": {"phrases":["图像生成","参考图套用","蒙版编辑","可编辑贴图"],"summary":"结合 Photon 的参考图、蒙版与可编辑摆放，用智能体的图像工具生成图像时使用。"},
      "photon-photo-finish": {"phrases":["照片调色","人像修图","蒙版滤镜"],"summary":"在 Photon 里用可编辑的调整、蒙版与滤镜完成调色与修图，适合照片后期收尾处理。"},
      "photon-vector-design": {"phrases":["矢量设计","图标绘制","字体排版"],"summary":"在 Photon 里用贝塞尔曲线和矢量运算设计可编辑的 Logo、图标与文字。"},
      "postgresql": {"phrases":["复杂查询","慢查询诊断","索引调优","迁移规划"],"summary":"编写复杂 PostgreSQL 查询、用 EXPLAIN ANALYZE 排查慢查询或规划大表迁移时使用。"},
      "pptx": {"phrases":["幻灯片制作","演示文稿","内容提取","模板排版"],"summary":"创建、读取与编辑演示文稿文件，处理模板、备注与母版，适合做汇报或提案时使用。"},
      "promptbase": {"phrases":["技能上架","文案打磨","风险检查"],"summary":"为在 PromptBase 出售的 Codex 技能做范围、描述、示例和上架风险检查。"},
      "punk-avatar": {"phrases":["头像生成","风格套用","宠物肖像","纪念卡片"],"summary":"为人物、宠物或物件生成头像与提示词，需要统一朋克风格或做头像衍生卡片时使用。"},
      "pydantic": {"phrases":["数据建模","自定义校验","序列化控制","配置加载"],"summary":"定义请求与响应的数据模型，编写校验器并控制序列化，适合规范接口数据结构时使用。"},
      "python": {"phrases":["异步调试","类型设计","性能优化"],"summary":"编写和调试稍复杂的 Python，避开异步陷阱，选对类型与数据结构写法。"},
      "react": {"phrases":["自定义钩子","并发渲染","服务端组件","动画实现"],"summary":"开发进阶 React 功能，涉及自定义 Hook、Suspense、服务端组件或动画时使用。"},
      "redis": {"phrases":["结构选型","缓存限流","消息订阅","分布式锁"],"summary":"按场景选择内存数据结构，实现缓存、限流与消息订阅，适合搭建实时与并发控制逻辑。"},
      "repowise-workflow": {"phrases":["代码库索引","风险评估","健康检查"],"summary":"在 Repowise 代码库上开发：先建索引，改前查风险，改后复盘新鲜度与健康度。"},
      "requirements-planning": {"phrases":["需求文档","用户故事","迭代拆分","完成标准"],"summary":"写 PRD、拆解用户故事与迭代表，或和团队约定完成标准时使用。"},
      "sandbox-migrate-to-next": {"phrases":["版本迁移","接口升级","兼容排查"],"summary":"把云端沙箱应用从稳定版迁到预览版并处理接口变化，适合升级到 1.0 时使用。"},
      "sandbox-next": {"phrases":["沙箱开发","代码执行","终端管理"],"summary":"在 Cloudflare Sandbox 预览版上构建应用，处理执行、文件、隧道与生命周期。"},
      "sandbox-stable": {"phrases":["沙箱应用开发","会话与文件","端口隧道","稳定版适配"],"summary":"用 Cloudflare 稳定版沙箱包开发应用，处理会话、文件、端口隧道或清理旧接口时使用。"},
      "security": {"phrases":["身份认证","权限校验","密钥管理","威胁建模"],"summary":"实现认证、授权与输入校验，对照 OWASP 十大风险排查，适合新服务上线前的安全加固。"},
      "skill-creator": {"phrases":["技能创建","技能优化","效果评测"],"summary":"从零创建或改写技能，跑评测对比表现，并优化描述以提升触发准确率。"},
      "slack-gif-creator": {"phrases":["动图制作","尺寸适配","动画设计","规格校验"],"summary":"制作适合 Slack 的动图，需要尺寸限制、校验工具与动画创意时使用。"},
      "slides": {"phrases":["网页幻灯片","图表呈现","版式设计","文案公式"],"summary":"用网页技术制作策略型演示页，配图表、设计变量与响应式版式，适合做网页端汇报材料。"},
      "solution-testing": {"phrases":["端到端测试","冒烟验证","脚本调试"],"summary":"用 Playwright 写关键路径的端到端测试，配置上线冒烟测试并排查不稳定用例。"},
      "spellbook-setup": {"phrases":["首次安装","全局配置","钩子启用","换机迁移"],"summary":"首次安装 Codex-spellbook，配置技能与智能体、注册 MCP 或迁移到新机器时使用。"},
      "sqlalchemy": {"phrases":["模型定义","异步会话","查询优化","迁移管理"],"summary":"使用异步数据库框架定义模型与查询，管理会话与关联加载，适合调试迁移与慢查询问题。"},
      "system-design": {"phrases":["架构设计","技术方案","容量估算"],"summary":"从零设计新服务，写技术方案或 RFC，选型数据库并评估扩展性与可靠性。"},
      "tailwind": {"phrases":["工具类组合","响应式布局","暗色模式","主题配置"],"summary":"组合 Tailwind 原子类，做响应式或暗色布局、处理类名冲突与自定义主题时使用。"},
      "technical-documentation": {"phrases":["接口文档","运维手册","技术方案","文档托管"],"summary":"撰写说明文档、接口文档、运维手册与技术方案，并搭建自动发布的文档站点。"},
      "template-skill": {"phrases":["技能模板","结构占位","填写示例"],"summary":"技能模板占位项，用真实说明替换后即可作为新技能的起手骨架。"},
      "temporal": {"phrases":["工作流编排","活动设计","信号路由","重放状态管理"],"summary":"开发或排查 Temporal 智能体，涉及工作流、活动、信号路由与重试耗尽时使用。"},
      "test-strategy": {"phrases":["测试选型","覆盖率目标","用例计划","测试评审"],"summary":"为新项目选定测试模型并设定覆盖率目标，编写发布前的测试计划，适合评审低效测试套件。"},
      "turnstile-spin": {"phrases":["人机验证","表单防护","接口加固"],"summary":"给项目端到端接入 Cloudflare Turnstile，为表单、接口和下载链接挡住机器人。"},
      "typescript": {"phrases":["工具类型","联合类型收窄","类型报错排查","严格模式配置"],"summary":"编写进阶 TypeScript，造工具类型、收窄联合类型、排查类型错误或开严格模式时使用。"},
      "ui-styling": {"phrases":["组件样式","设计系统","响应式布局","主题配色"],"summary":"用主流组件库与原子化样式搭建美观可用的界面，定制主题与暗色模式，适合统一产品视觉。"},
      "ui-ux-pro-max": {"phrases":["界面设计","设计规范","无障碍优化","组件实现"],"summary":"做网页、移动与桌面界面设计，查风格、配色、字体与交互规范并落地实现。"},
      "unit-testing": {"phrases":["单元测试","依赖打桩","测试驱动开发","覆盖率达标"],"summary":"为函数或模块写单元测试、模拟外部依赖，或在 Python、TypeScript、Go 中推行 TDD 时使用。"},
      "voxcpm-audio-generation": {"phrases":["语音合成","音色克隆","批量配音"],"summary":"用本地语音项目把文稿或台词转成音频，支持音色设计与克隆，适合做旁白与广告配音。"},
      "watch": {"phrases":["视频解析","字幕提取","抽帧分析"],"summary":"把视频链接或本地文件下载抽帧并取字幕，让模型能回答视频内容相关问题。"},
      "web-artifacts-builder": {"phrases":["复杂页面构建","组件库集成","状态与路由","网页制品"],"summary":"构建带状态管理和路由的多组件 HTML 制品，用 React、Tailwind 与 shadcn/ui 时使用。"},
      "web-perf": {"phrases":["加载性能","指标测量","渲染阻塞","性能优化"],"summary":"用开发者工具测量核心网页指标并定位阻塞资源与布局偏移，适合排查页面加载缓慢问题。"},
      "webapp-testing": {"phrases":["前端验证","界面调试","截图抓取"],"summary":"用 Playwright 操作和测试本地网页应用，验证功能、调试界面并抓取截图日志。"},
      "websockets-sse": {"phrases":["实时推送","连接保活","广播扩容","断线排查"],"summary":"用 WebSocket 或 SSE 做实时功能，在选型、心跳保活、集群广播或排查掉线时使用。"},
      "workers-best-practices": {"phrases":["代码审查","配置规范","反模式排查"],"summary":"按生产规范审查与编写边缘函数代码，检查流式处理与全局状态等常见隐患，适合上线前把关。"},
      "wrangler": {"phrases":["服务部署","资源管理","命令行排错"],"summary":"用 Cloudflare Workers 命令行部署和管理 KV、R2、D1、队列等资源与服务，运行前先确认语法。"},
      "writing-plans": {"phrases":["实施计划","改动排序","迁移排期","任务移交"],"summary":"为跨多文件、含数据库迁移或需交给子智能体执行的复杂改动写实施计划时使用。"},
      "xlsx": {"phrases":["表格读写","公式计算","格式整理","数据清洗"],"summary":"读取与编辑表格文件，补列、算公式、做图表并清洗杂乱数据，适合处理表格与文本数据。"},
    }
    /* @zh-inline-end */

    /* ------------------------------------------------------------------ */
    /* official tab-type identity                                          */
    /* ------------------------------------------------------------------ */

    /** The page kind the official sidebar opens this tab by. */
    var SKILLS_KIND = 'skills'
    /** This implementation's identity in the tab system, and the key its body/title register under. */
    var SKILLS_ID = 'dsh-skill-sidebar'

    /** Auto-open the 技能 tab once per session (the previous behaviour: 默认自动打开). */
    var AUTO_OPEN = true
    /** Bounded auto-open retry timing (a collapsed column has no seated surface yet). */
    var AUTO_OPEN_FIRST_MS = 250
    var AUTO_OPEN_RETRY_MS = 400
    var AUTO_OPEN_TRIES = 25

    /* ------------------------------------------------------------------ */
    /* styles (plugin-scoped classes; DSW design tokens with fallbacks)    */
    /* ------------------------------------------------------------------ */
    var CSS_ID = 'dsh-skill-sidebar/styles'
    var css = '' +
      // The official panel gives the tab body a flex column; fill it edge to edge.
      '.dss-root{display:flex;flex-direction:column;height:100%;min-height:0;flex:auto;min-width:0;font:13px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary,#d6d6de);background:transparent}' +
      '.dss-header{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;flex:none}' +
      '.dss-header h3{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ee);flex:none;display:inline-flex;align-items:center;gap:5px}' +
      '.dss-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a96);flex:none}' +
      '.dss-refresh{margin-left:auto;flex:none;border:1px solid var(--dsw-alias-border-l2,#33333c);background:var(--dsw-alias-bg-base,#1c1c23);color:var(--dsw-alias-label-secondary,#b8b8c4);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}' +
      '.dss-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#2a2a33)}' +
      '.dss-refresh:disabled{opacity:.5;cursor:default}' +
      '.dss-search{padding:0 12px 6px;flex:none}' +
      '.dss-search input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#33333c);background:var(--dsw-alias-bg-base,#1c1c23);color:var(--dsw-alias-label-primary,#e8e8ee);border-radius:6px;padding:4px 8px;font-size:12px;outline:none}' +
      '.dss-search input:focus{border-color:var(--dsw-alias-accent-primary,#5b8cff)}' +
      '.dss-list{flex:auto;min-height:0;overflow:auto;padding:2px 8px 8px}' +
      '.dss-row{position:relative;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}' +
      '.dss-row:last-child{border-bottom:none}' +
      '.dss-row:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.05))}' +
      '.dss-row-top{display:flex;align-items:center;gap:6px;min-width:0}' +
      // 名字占据剩余宽度并在窄栏里省略：桌面版右栏比浏览器窗口窄，
      // 若用 flex:none，长技能名会把置顶/复制按钮挤出可视区。
      '.dss-name{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary,#e8e8ee);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dss-tag{flex:none;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:var(--dsw-alias-bg-strong,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#9a9aa6);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
      // ---- v0.4.0：分类筛选条 / 分组标题 / 清单状态 ----
      '.dss-cats{display:flex;gap:4px;flex-wrap:wrap;padding:0 12px 6px;flex:none;max-height:86px;overflow:auto}' +
      '.dss-cat{flex:none;border:1px solid var(--dsw-alias-border-l2,#33333c);background:transparent;color:var(--dsw-alias-label-secondary,#b0b0bc);border-radius:999px;padding:1px 8px;font-size:11px;line-height:1.5;cursor:pointer;white-space:nowrap;transition:background .1s,color .1s}' +
      '.dss-cat:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.06))}' +
      '.dss-cat-on{background:var(--dsw-alias-accent-primary,#5b8cff);border-color:transparent;color:#fff}' +
      '.dss-cat-on:hover{background:var(--dsw-alias-accent-primary,#5b8cff)}' +
      '.dss-group{display:flex;align-items:center;gap:6px;padding:8px 8px 3px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a96);position:sticky;top:0;background:var(--dsw-alias-bg-base,#1c1c23);z-index:1}' +
      '.dss-group-n{font-weight:400;opacity:.8}' +
      '.dss-state{flex:none;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
      '.dss-state-on{background:rgba(91,140,255,.18);color:#8fb0ff}' +
      '.dss-state-off{background:rgba(255,255,255,.06);color:var(--dsw-alias-label-tertiary,#8a8a96)}' +
      '.dss-rowtags{margin:2px 0 0;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a96);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dss-rowtags .dss-fam{color:var(--dsw-alias-label-secondary,#b0b0bc)}'
      '.dss-copy{margin-left:auto;flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a96);font-size:0;line-height:0;cursor:pointer;padding:2px 3px;border-radius:4px;opacity:0;display:inline-flex;align-items:center;justify-content:center;transition:opacity .1s}' +
      '.dss-row:hover .dss-copy{opacity:1}' +
      '.dss-copy:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8e8ee)}' +
      '.dss-copy-on{color:var(--dsw-alias-accent-primary,#5b8cff);opacity:1}' +
      '.dss-pin{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a96);cursor:pointer;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;opacity:.75;transition:opacity .1s}' +
      '.dss-pin:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.08))}' +
      '.dss-pin-on{color:var(--dsw-alias-accent-primary,#5b8cff);opacity:1}' +
      '.dss-badge{flex:none;font-size:10px;line-height:1;padding:2px 5px;border-radius:999px;background:var(--dsw-alias-bg-strong,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#9a9aa6)}' +
      '.dss-phrases{font-size:12px;color:var(--dsw-alias-label-secondary,#b0b0bc);margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dss-more{color:var(--dsw-alias-accent-primary,#5b8cff);font-weight:600}' +
      '.dss-tip-fixed{position:fixed;z-index:2147483000;max-width:300px;box-sizing:border-box;background:var(--dsw-alias-bg-strong,#26262e);border:1px solid var(--dsw-alias-border-l2,#3a3a44);border-radius:8px;padding:8px 10px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary,#c0c0cc);white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none;overflow:hidden}' +
      '.dss-foot{padding:4px 12px 8px;flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a96);display:flex;gap:10px;align-items:center;flex-wrap:wrap;row-gap:2px}' +
      '.dss-diag{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a96)}' +
      '.dss-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a96);font-size:12px}' +
      '.dss-error{padding:8px 12px;font-size:11px;color:var(--dsw-alias-state-error-primary,#f2a1a1);flex:none}' +
      // The chip: the skill glyph followed by the tab's title text.
      '.dss-titleIcon{flex:none}'
    if (typeof document !== 'undefined') {
      var cssTag = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')
      if (cssTag === null) {
        var tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-skill-sidebar'
        tag.dataset.pluginCss = CSS_ID
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    /* ------------------------------------------------------------------ */
    /* runtime shell + overlay geometry (web 浏览器 / 桌面客户端双端)        */
    /* ------------------------------------------------------------------ */

    /**
     * Whether this page runs inside the DSH desktop client (DeepSeek Harness
     * Desktop, Electron) rather than a plain browser tab.
     *
     * The desktop shell renders the very same Web front end, but serves it from
     * the `dsh-app://app/` scheme instead of `http(s)://`, and its window is
     * typically much smaller than a browser window — the two facts the overlay
     * geometry below adapts to. Relative `fetch('/skillpanel/skills')` keeps
     * working under that scheme: the Electron main process proxies it to the
     * local webserver with the session cookie (same path dsh-quick-prompts uses
     * for `/api/quick-prompts`).
     * @returns true for the desktop shell, false for a browser (and when no
     * environment object exists at all).
     */
    function isDesktopShell() {
      try {
        if (typeof location !== 'undefined' && location && location.protocol === 'dsh-app:') return true
      } catch (e) { /* no location — treat as browser */ }
      try {
        if (typeof navigator !== 'undefined' && navigator && /Electron\//.test(navigator.userAgent || '')) return true
      } catch (e) { /* no navigator — treat as browser */ }
      return false
    }

    /** Tooltip width cap; a narrower viewport shrinks it. */
    var TIP_MAX_W = 300
    /** Floor for the shrunk width (a frame narrower than this gets a fitting tip). */
    var TIP_MIN_W = 80
    /** Gap between the hovered row and the tooltip. */
    var TIP_GAP = 6
    /** Keep the tooltip this far from every viewport edge. */
    var TIP_MARGIN = 8
    /** Preferred floor for the height budget (never overshoots the room available). */
    var TIP_MIN_H = 40
    /** Advance of one CJK / full-width glyph in the tooltip font (11.5px). */
    var TIP_CJK_W = 11.5
    /** Average advance of one latin glyph in the tooltip font (11.5px). */
    var TIP_LATIN_W = 6.2
    /** Tooltip line height in px (CSS line-height 1.55 × 11.5px). */
    var TIP_LINE_H = 18
    /** Tooltip vertical padding in px (CSS 8px top + 8px bottom). */
    var TIP_PAD_Y = 16

    /** `Number(value)` that never yields NaN (missing/NaN rect fields). */
    function toNum(value) {
      var n = Number(value)
      return Number.isFinite(n) ? n : 0
    }

    /**
     * Advance width of one character in the tooltip font.
     *
     * The tooltip mostly shows Chinese prose, and a CJK glyph is ~1.85× a latin
     * one at 11.5px (11.5px vs ~6.2px, measured with Microsoft YaHei). Treating
     * every character as latin — as the first implementation did — underestimates
     * a Chinese description by ~1.7×, so a "height-capped" tip dropped its last
     * lines with no way to reach them. The script therefore picks the advance.
     */
    function tipCharWidth(ch) {
      var code = ch.codePointAt(0)
      if (
        (code >= 0x1100 && code <= 0x115f)                        // Hangul Jamo
        || code === 0x2329 || code === 0x232a                     // angle brackets
        || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)  // CJK radicals … Yi
        || (code >= 0xac00 && code <= 0xd7a3)                     // Hangul syllables
        || (code >= 0xf900 && code <= 0xfaff)                     // CJK compatibility ideographs
        || (code >= 0xfe30 && code <= 0xfe6f)                     // CJK compatibility forms
        || (code >= 0xff00 && code <= 0xff60)                     // full-width forms
        || (code >= 0xffe0 && code <= 0xffe6)
        || (code >= 0x20000 && code <= 0x3fffd)                   // CJK extension B+
      ) return TIP_CJK_W
      return TIP_LATIN_W
    }

    /** Wrapped line count of `text` in a tip `width` px wide (greedy, honours '\n'). */
    function tipLineCount(text, width) {
      var maxW = Math.max(24, width - 20)   // CSS padding: 10px per side
      var parts = String(text === undefined || text === null ? '' : text).split('\n')
      var lines = 0
      for (var p = 0; p < parts.length; p++) {
        var s = parts[p]
        if (s === '') { lines += 1; continue }
        var used = 0
        var n = 1
        for (var i = 0; i < s.length; i++) {
          var w = tipCharWidth(s[i])
          if (used + w > maxW && used > 0) { n++; used = w } else { used += w }
        }
        lines += n
      }
      return Math.max(1, lines)
    }

    /** Estimated rendered height of a tooltip for `text` at `width`. */
    function estimateTipHeight(text, width) {
      return Math.round(tipLineCount(text, width) * TIP_LINE_H + TIP_PAD_Y)
    }

    /**
     * Shorten `text` so its estimated box fits `maxHeight`.
     *
     * The tooltip is `pointer-events:none` (it must never steal the hovered row's
     * events), so a capped box cannot be scrolled — text beyond the budget would
     * be permanently unreachable. When the budget cannot hold the whole text we
     * therefore cut it at the last fully visible character and mark the cut with
     * an ellipsis, using the same script-aware measurement as the height estimate.
     * @param text - the full feature text.
     * @param width - the tooltip width the text wraps at.
     * @param maxHeight - the height budget returned by computeTipPos.
     * @returns the text to render (unchanged when it already fits).
     */
    function fitTipText(text, width, maxHeight) {
      var full = String(text === undefined || text === null ? '' : text)
      if (estimateTipHeight(full, width) <= maxHeight) return full
      var maxW = Math.max(24, width - 20)
      var maxLines = Math.max(1, Math.floor((maxHeight - TIP_PAD_Y) / TIP_LINE_H))
      var lines = 1
      var used = 0
      var cut = full.length
      for (var i = 0; i < full.length; i++) {
        var ch = full[i]
        if (ch === '\n') {
          lines++
          used = 0
        } else {
          var w = tipCharWidth(ch)
          if (used + w > maxW && used > 0) { lines++; used = w } else { used += w }
        }
        if (lines > maxLines) { cut = i; break }
      }
      if (cut >= full.length) return full
      return full.slice(0, Math.max(1, cut - 1)) + '…'
    }

    /**
     * Place the fixed-position hover tooltip inside the viewport.
     *
     * This is the desktop-shell adaptation: a browser window is usually wide
     * enough that a centred tip never leaves the frame, while the desktop window
     * (and a narrow right Sidebar) is not — the left edge is clamped to the
     * frame, the tip flips above/below the row depending on the room available,
     * and its height budget is the room actually left (the tip cannot scroll, so
     * `fitTipText` trims the text to that budget).
     *
     * The height *estimate* only picks the flip side; it is deliberately NOT used
     * as the cap, because an estimate error would then turn straight into lost
     * text.
     * @param rect - the hovered row's bounding rect (null/false while unknown).
     * @param viewport - `{ width, height }` of the frame.
     * @param text - the tooltip's full text (height is estimated from it).
     * @returns `{ left, top, width, maxHeight, above }` — `left` is the
     * horizontal centre the CSS `translate(-50%)` anchors to, `width` an upper
     * bound to apply as `max-width` (the box still shrinks to its content).
     */
    function computeTipPos(rect, viewport, text) {
      var vw = Math.max(0, toNum(viewport && viewport.width))
      var vh = Math.max(0, toNum(viewport && viewport.height))
      // Shrink with the frame, and never exceed the frame itself: a viewport
      // narrower than TIP_MIN_W still gets a tip that fits inside it.
      var width = Math.max(0, Math.min(TIP_MAX_W, Math.max(TIP_MIN_W, vw - 2 * TIP_MARGIN)))
      if (vw > 0 && width > vw) width = vw
      var height = estimateTipHeight(text, width)

      var rLeft = rect ? toNum(rect.left) : 0
      var rWidth = rect ? toNum(rect.width) : 0
      var center = rect ? rLeft + rWidth / 2 : TIP_MARGIN + width / 2
      var minLeft = TIP_MARGIN + width / 2
      var maxLeft = vw - TIP_MARGIN - width / 2
      var left = maxLeft >= minLeft
        ? Math.min(Math.max(center, minLeft), maxLeft)
        : vw / 2

      if (!rect) {
        return {
          left: left,
          top: TIP_MARGIN,
          width: width,
          maxHeight: Math.max(0, Math.min(Math.max(TIP_MIN_H, Math.min(height, vh - 2 * TIP_MARGIN)), vh - 2 * TIP_MARGIN)),
          above: false,
        }
      }

      var rTop = toNum(rect.top)
      var rBottom = Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : rTop
      var spaceAbove = rTop - TIP_GAP - TIP_MARGIN
      var spaceBelow = vh - rBottom - TIP_GAP - TIP_MARGIN
      // Prefer the side that fits the whole tip; otherwise the roomier one.
      var above
      if (spaceAbove >= height) above = true
      else if (spaceBelow >= height) above = false
      else above = spaceAbove >= spaceBelow
      var space = Math.max(0, above ? spaceAbove : spaceBelow)
      return {
        left: left,
        // `top` is a bottom edge when above (CSS translate(-50%,-100%)), so a
        // squeezed tip grows upward and never covers the hovered row.
        top: Math.max(0, above ? rTop - TIP_GAP : rBottom + TIP_GAP),
        width: width,
        // The budget is the room actually available. When even TIP_MIN_H does not
        // fit, the budget shrinks with it rather than pushing the tip off-screen.
        maxHeight: space >= TIP_MIN_H ? Math.max(TIP_MIN_H, Math.min(height, space)) : space,
        above: above,
      }
    }

    /* ------------------------------------------------------------------ */
    /* persistence helpers                                                 */
    /* ------------------------------------------------------------------ */
    var STORAGE_KEY = 'dsh-skill-sidebar:cache:v1'
    var POLL_MS = 30000

    function pad2(n) { return String(n).padStart(2, '0') }
    function todayStr() {
      var d = new Date()
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    function isMonday() { return new Date().getDay() === 1 }

    function readLocalCache() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        var data = JSON.parse(raw)
        if (data && Array.isArray(data.skills)) return data
        return null
      } catch (e) { return null }
    }

    function writeLocalCache(skills, fetchedAt) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          skills: skills,
          fetchedAt: fetchedAt || new Date().toISOString(),
          refreshedDate: todayStr(),
        }))
      } catch (e) { /* storage full/blocked — non-fatal */ }
    }

    /* ------------------------------------------------------------------ */
    /* fetchers                                                            */
    /* ------------------------------------------------------------------ */

    /** Live per-session catalog (the "/" skill menu source). Null for subagent scopes. */
    function fetchLiveCatalog(ctx, sessionId) {
      var sessions = ctx.get('sessions')
      var connection = ctx.get('connection')
      if (!connection || !connection.api || !connection.api.skills) return Promise.resolve(null)
      if (sessions && typeof sessions.subagentAddress === 'function' && sessions.subagentAddress(sessionId) !== undefined) {
        return Promise.resolve(null)
      }
      return connection.api.skills.list({ sessionId: sessionId }).then(function (res) {
        if (!res || !res.result || !res.result.ok) {
          var code = res && res.result && res.result.error ? res.result.error.code : 'skill.list'
          var message = res && res.result && res.result.error ? res.result.error.message : 'skill list unavailable'
          throw new Error(code + ': ' + message)
        }
        return res.result.value.skills
      })
    }

    /** Machine-wide filesystem scan served by the host half (now also carries分类 + 加载清单). */
    function fetchServerCatalog() {
      return fetch('/skillpanel/skills', { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        })
        .then(function (json) {
          if (!json || json.ok !== true || !Array.isArray(json.skills)) throw new Error('malformed response')
          return {
            skills: json.skills,
            scannedAt: json.scannedAt || null,
            policy: json.policy || null,
            categories: Array.isArray(json.categories) ? json.categories : [],
            categoryNames: json.categoryNames || {},
            settings: json.settings || null,
            pins: Array.isArray(json.pins) ? json.pins : null,
            usage: json.usage || null,
          }
        })
    }

    /**
     * 把置顶（顶标）清单写回宿主。
     *
     * v0.4.0 起置顶不再只是浏览器偏好：它同时是「新会话加载清单」的常驻项，
     * 所以必须落到宿主（policy.json），否则宿主侧的加载策略看不到。
     * @param names - 完整置顶技能名数组。
     * @returns 成功与否（失败只是本地不同步，不阻塞界面）。
     */
    function pushPins(names) {
      return fetch('/skillpanel/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ pins: names }),
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
    }

    /**
     * Union of two skill lists by name, primary winning for duplicates —
     * the live per-session catalog (canonical descriptions) plus machine-wide
     * entries the session scope hides (e.g. user-only skills) or misses
     * (filesystem scan of every local root). Result sorted by name.
     */
    function mergeLists(primary, secondary) {
      var map = {}
      var order = []
      function put(list) {
        for (var i = 0; i < list.length; i++) {
          var s = list[i]
          if (!s || typeof s.name !== 'string' || s.name === '') continue
          var prev = map[s.name]
          if (prev === undefined) {
            order.push(s.name)
            map[s.name] = s
          } else {
            // The overriding entry wins, but keep the other side's phrases
            // and directory source when the winner carries none — the live
            // per-session catalog has neither `phrases` nor `source`, while
            // the machine-wide scan does.
            map[s.name] = {
              ...prev, ...s,
              phrases: (s.phrases && s.phrases.length) ? s.phrases : (prev.phrases || []),
              source: s.source || prev.source || 'agents',
            }
          }
        }
      }
      put(secondary || [])
      put(primary || [])
      // localeCompare, matching the host scan's sort: a code-point sort would
      // order the first paint differently from the refreshed list.
      return order.sort(function (a, b) { return a.localeCompare(b) }).map(function (name) { return map[name] })
    }

    /**
     * Apply the inlined Chinese table to one skill entry.
     *
     * The desktop client reloads this bundle through client-hmr as soon as the
     * file changes, while the host half (lib/index.js) only picks up new code
     * after the application restarts. Inlining the table therefore puts the
     * Chinese phrases and 中文说明 on screen without waiting for a restart; once
     * the host ships its own `zh` field the merge is a no-op, because both sides
     * are generated from the very same lib/skills-zh.json.
     * @param s - a skill entry from any source (cache, live catalog, host scan).
     * @returns the entry, localized when the table covers it.
     */
    function applyZh(s) {
      if (!s || typeof s.name !== 'string') return s
      var entry = ZH_INLINE[s.name]
      if (!entry) return s
      var next = s
      if (Array.isArray(entry.phrases) && entry.phrases.length > 0) {
        next = { ...next, phrases: entry.phrases }
      }
      if (typeof entry.summary === 'string' && entry.summary !== '' && !next.zh) {
        next = { ...next, zh: entry.summary }
      }
      return next
    }

    /** Max 4-6 字 phrases shown inline before the trailing "+n" marker. */
    var MAX_INLINE_PHRASES = 4

    /**
     * Split a skill's phrase list into the inline text and the "+n" overflow
     * count: show at most MAX_INLINE_PHRASES joined by 中文顿号, with the
     * remainder surfaced as "+n" (hover shows the full feature text).
     */
    function phraseRow(phrases) {
      var list = phrases && phrases.length ? phrases : []
      var shown = list.slice(0, MAX_INLINE_PHRASES)
      return {
        text: shown.join('，'),
        more: list.length - shown.length,
      }
    }

    /**
     * The full feature text a hover tooltip shows for one skill.
     *
     * The shipped 中文说明 goes first: most local SKILL.md files are English, and
     * the tooltip is height-capped on the small desktop window, so the part that
     * makes the skill understandable must never be the part that gets cut. The
     * original description and `whenToUse` stay underneath as the source text.
     */
    function fullTextOf(s) {
      var parts = []
      if (s.zh) parts.push(s.zh)
      if (s.description) parts.push(s.description)
      if (s.whenToUse) parts.push('适用：' + s.whenToUse)
      return parts.join('\n')
    }

    /* ------------------------------------------------------------------ */
    /* pinned skills (browser-local preference)                            */
    /* ------------------------------------------------------------------ */

    var PINS_KEY = 'dsh-skill-sidebar:pins:v1'

    /** Read the pinned skill-name list (best effort). */
    function readPins() {
      try {
        var raw = localStorage.getItem(PINS_KEY)
        if (!raw) return []
        var parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(function (n) { return typeof n === 'string' }) : []
      } catch (e) { return [] }
    }

    /** Persist the pinned skill-name list. */
    function writePins(names) {
      try { localStorage.setItem(PINS_KEY, JSON.stringify(names)) } catch (e) { /* non-fatal */ }
    }

    /** Toggle one skill in a pin list. */
    function togglePinIn(names, name) {
      return names.indexOf(name) === -1 ? names.concat([name]) : names.filter(function (n) { return n !== name })
    }

    /** Sort skills: pinned first (both groups alphabetical). */
    function sortPinnedFirst(skills, pinned) {
      var set = {}
      for (var i = 0; i < pinned.length; i++) set[pinned[i]] = true
      var top = []
      var rest = []
      for (var j = 0; j < skills.length; j++) {
        if (set[skills[j].name]) top.push(skills[j])
        else rest.push(skills[j])
      }
      return top.concat(rest)
    }

    /* ------------------------------------------------------------------ */
    /* v0.4.0 分类 / 标签 / 加载清单（纯函数，便于单测）                      */
    /* ------------------------------------------------------------------ */

    /** 新装技能的试用期（天），与宿主 policy.js 的 GRACE_DAYS 保持一致。 */
    var GRACE_DAYS = 7
    /** 「新装」筛选的定义：SKILL.md 的 mtime 在最近 GRACE_DAYS 天内。 */
    var NEW_WINDOW_MS = GRACE_DAYS * 24 * 60 * 60 * 1000

    /** 一个技能的清单状态：resident（进新会话目录）/ indexed（转按需）/ unknown。 */
    function stateOf(s) {
      if (s && typeof s.state === 'string' && s.state !== '') return s.state
      return 'unknown'
    }

    /** 分类 id（缺失时用兜底 id，保持分组不塌）。 */
    function categoryOf(s) {
      if (s && typeof s.category === 'string' && s.category !== '') return s.category
      return 'misc'
    }

    /** 分类显示名（categoryNames 是宿主给的 id→名称表）。 */
    function categoryLabel(id, categoryNames) {
      if (categoryNames && typeof categoryNames[id] === 'string' && categoryNames[id] !== '') return categoryNames[id]
      return id
    }

    /**
     * 分类筛选条的 chip 列表：全部 / 常驻 / 索引 / 新装 + 每个分类（带计数）。
     * @param skills - 全部技能。
     * @param categories - 宿主的分类表 [{ id, name, count }]。
     * @returns [{ id, name, count }]。
     */
    function filterChips(skills, categories, nowMs) {
      var list = skills || []
      var now = Number.isFinite(nowMs) ? nowMs : Date.now()
      var resident = 0
      var indexed = 0
      var fresh = 0
      for (var i = 0; i < list.length; i++) {
        var st = stateOf(list[i])
        if (st === 'resident') resident++
        else if (st === 'indexed') indexed++
        if (Number(list[i].installMtime) > 0 && now - Number(list[i].installMtime) <= NEW_WINDOW_MS) fresh++
      }
      var chips = [{ id: 'all', name: '全部', count: list.length }]
      if (resident > 0) chips.push({ id: 'resident', name: '常驻', count: resident })
      if (indexed > 0) chips.push({ id: 'indexed', name: '索引', count: indexed })
      if (fresh > 0) chips.push({ id: 'new', name: '新装', count: fresh })
      var rows = (categories || []).slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0) })
      for (var j = 0; j < rows.length; j++) chips.push({ id: rows[j].id, name: rows[j].name, count: rows[j].count })
      return chips
    }

    /** 是否命中分类/清单筛选。 */
    function matchFilter(s, filter, nowMs) {
      var f = filter || 'all'
      if (f === 'all') return true
      if (f === 'resident') return stateOf(s) === 'resident'
      if (f === 'indexed') return stateOf(s) === 'indexed'
      if (f === 'new') {
        var now = Number.isFinite(nowMs) ? nowMs : Date.now()
        return Number(s.installMtime) > 0 && now - Number(s.installMtime) <= NEW_WINDOW_MS
      }
      return categoryOf(s) === f
    }

    /**
     * 搜索匹配。支持三种语法 + 自由文本：
     *   `tag:xxx` / `#xxx`      → 标签
     *   `分类:xxx` / `category:xxx` → 分类
     *   `常驻` / `索引`           → 清单状态
     * 自由文本命中 名称 / 描述 / 中文说明 / 短语 / 标签 / 分类名。
     */
    function matchQuery(s, query, categoryNames) {
      var q = String(query || '').trim().toLowerCase()
      if (q === '') return true
      var tagMatch = /^tag[:：]\s*(.+)$/.exec(q) || /^#(.+)$/.exec(q)
      if (tagMatch !== null) {
        var needle = tagMatch[1].trim()
        var tags = Array.isArray(s.tags) ? s.tags : []
        for (var i = 0; i < tags.length; i++) if (String(tags[i]).toLowerCase().indexOf(needle) !== -1) return true
        return false
      }
      var catMatch = /^(分类|category)[:：]\s*(.+)$/.exec(q)
      if (catMatch !== null) {
        var want = catMatch[2].trim()
        return categoryOf(s).toLowerCase().indexOf(want) !== -1
          || categoryLabel(categoryOf(s), categoryNames).toLowerCase().indexOf(want) !== -1
      }
      if (q === '常驻') return stateOf(s) === 'resident'
      if (q === '索引') return stateOf(s) === 'indexed'
      var haystack = [s.name, s.description, s.zh, (s.phrases || []).join(' '), (s.tags || []).join(' '), categoryLabel(categoryOf(s), categoryNames)]
        .filter(function (v) { return typeof v === 'string' }).join(' ').toLowerCase()
      return haystack.indexOf(q) !== -1
    }

    /**
     * 按分类分组（保持 chips 的顺序：常驻在前 → 分类按数量）。
     * @returns [{ id, name, skills }]。
     */
    function groupSkills(skills, categoryNames, categories) {
      var order = (categories || []).slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0) }).map(function (c) { return c.id })
      var buckets = {}
      var seen = []
      for (var i = 0; i < skills.length; i++) {
        var id = categoryOf(skills[i])
        if (!buckets[id]) { buckets[id] = []; seen.push(id) }
        buckets[id].push(skills[i])
      }
      var rank = {}
      for (var j = 0; j < order.length; j++) rank[order[j]] = j
      seen.sort(function (a, b) {
        var ra = rank[a] === undefined ? 999 : rank[a]
        var rb = rank[b] === undefined ? 999 : rank[b]
        return ra - rb || a.localeCompare(b)
      })
      return seen.map(function (id) {
        return { id: id, name: categoryLabel(id, categoryNames), skills: buckets[id] }
      })
    }

    /** 加载清单的一句话说明（页脚展示）。 */
    function policyLabel(policy) {
      if (!policy || typeof policy !== 'object') return ''
      if (policy.degraded) return '加载清单：证据不足，暂不裁剪（' + (policy.windowDays || 30) + ' 天窗口）'
      if (policy.mode === 'off') return '加载清单：已关闭（列出全部技能）'
      if (policy.mode === 'dry') return '加载清单：试算模式（常驻 ' + policy.stats.resident + ' / 索引 ' + policy.stats.indexed + '）'
      return '加载清单：' + (policy.windowDays || 30) + ' 天内用过 + 顶标常驻 · ' + policy.stats.resident + ' 常驻 / ' + policy.stats.indexed + ' 索引'
    }

    /** A push-pin glyph (inline SVG, follows currentColor; `filled` = pinned). */
    function PinIcon(size, filled) {
      return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        React.createElement('path', { d: 'M12 17v5' }),
        React.createElement('path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z' }),
      )
    }

    /** Copy (two overlapping squares) glyph. */
    function CopyIcon(size) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        React.createElement('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }),
        React.createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      )
    }

    /** Check glyph for the "copied" feedback. */
    function CheckIcon(size) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        React.createElement('polyline', { points: '20 6 9 17 4 12' }),
      )
    }

    /** The skill glyph, as a guide capsule and chip title draw it. */
    function SkillGlyph(props) {
      var Icon = primitives && primitives.IconSkillOutline16
      if (!Icon) return null
      return React.createElement(Icon, { size: props && props.size ? props.size : 16, className: props ? props.className : undefined })
    }

    /* ------------------------------------------------------------------ */
    /* the skills tab body (official `sidebar.right.pane.tab` seat)         */
    /* ------------------------------------------------------------------ */

    /**
     * The 技能 tab's body.
     *
     * Props: `useTabInfo()` (framework-bound, gives the live sidebar/tab record
     * — `tab.visible` gates the auto-refresh and `tab.signal` bounds its life),
     * `sessionId` (the session scope the tab is drawn in), and `ctx` (the
     * business face this package injects, for the two catalog fetchers).
     */
    function SkillsBody(props) {
      // Framework hook: must be called unconditionally, before any early return.
      var info = props.useTabInfo()
      var tab = info && info.tab ? info.tab : null
      var visible = !!(tab && tab.visible)
      var signal = tab ? tab.signal : undefined

      var ctx = props.ctx
      var sessionId = props.sessionId

      // Boot-injected machine-wide list (server tapIndex) — render it instantly
      // with zero network round-trips; fetch refreshes it in the background.
      var bootSkills = null
      var bootPolicy = null
      try {
        if (typeof window !== 'undefined' && window.__DSH_SKILLS__ && window.__DSH_SKILLS__.length) {
          bootSkills = window.__DSH_SKILLS__
        }
        if (typeof window !== 'undefined' && window.__DSH_SKILL_POLICY__ && typeof window.__DSH_SKILL_POLICY__ === 'object') {
          bootPolicy = window.__DSH_SKILL_POLICY__
        }
      } catch (e) { /* ignore */ }

      var stateHook = React.useState({
        skills: bootSkills,      // null = not loaded yet
        loading: false,
        error: null,
        source: bootSkills ? 'server' : 'cache',   // cache | live | server | local
        updatedAt: null,
        query: '',
        // v0.4.0：分类筛选（all / resident / indexed / new / 分类 id）与分组开关。
        filter: 'all',
        group: true,
        categories: (bootPolicy && bootPolicy.categories) || [],
        categoryNames: (bootPolicy && bootPolicy.categoryNames) || {},
        policy: (bootPolicy && bootPolicy.policy) || null,
        settings: null,
        diagServer: bootSkills ? '本机 ' + bootSkills.length : '',
        diagLive: '',
      })
      var state = stateHook[0]
      var setState = stateHook[1]

      // Hover tooltip: fixed-position popover with the full feature text.
      var tipState = React.useState(null) // { text, left, top, above }
      var tip = tipState[0]
      var setTip = tipState[1]

      // Copy feedback: which skill name was just copied (cleared after a tick).
      var copiedState = React.useState(null)
      var copied = copiedState[0]
      var setCopied = copiedState[1]

      // Pinned skills (顶标): 本地即时生效，同时写回宿主（新会话加载清单要用宿主的这份）。
      var pinsState = React.useState(function () { return readPins() })
      var pins = pinsState[0]
      var setPins = pinsState[1]
      function togglePin(name) {
        setPins(function (prev) {
          var next = togglePinIn(prev, name)
          writePins(next)
          pushPins(next).catch(function (err) {
            console.error('[dsh-skill-sidebar] 置顶写回宿主失败：', err && err.message ? err.message : err)
          })
          return next
        })
      }
      function copySkill(name) {
        var text = '/' + name
        var finish = function (ok) {
          if (!ok) return
          setCopied(name)
          setTimeout(function () { setCopied(null) }, 1200)
        }
        // Fallback for a blocked or absent async Clipboard API: the desktop
        // client can reject writeText (permission/focus), and reporting "copied"
        // without checking would be a lie.
        var fallback = function () {
          var done = false
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            done = document.execCommand('copy')
            document.body.removeChild(ta)
          } catch (e) { done = false }
          finish(done)
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            // Await the promise: only a resolved write counts as copied.
            Promise.resolve(navigator.clipboard.writeText(text)).then(function () { finish(true) }, fallback)
            return
          }
        } catch (e) { /* fall through to execCommand */ }
        fallback()
      }
      function handleRowEnter(e, s) {
        var rect = e.currentTarget.getBoundingClientRect()
        var text = fullTextOf(s)
        // Desktop-adapted placement: clamp to the frame, flip above/below, cap
        // the height — see computeTipPos.
        var pos = computeTipPos(rect, { width: window.innerWidth, height: window.innerHeight }, text)
        setTip({
          // Capped to the placement budget: the tip cannot scroll (pointer-events
          // is none), so an over-long description is ellipsized instead of clipped.
          text: fitTipText(text, pos.width, pos.maxHeight),
          left: pos.left,
          top: pos.top,
          width: pos.width,
          maxHeight: pos.maxHeight,
          above: pos.above,
        })
      }
      function handleRowLeave() {
        setTip(null)
      }

      var refresh = React.useCallback(function (opts) {
        var silent = !!(opts && opts.silent)
        setState(function (prev) { return { ...prev, loading: !silent || prev.skills === null, error: silent ? prev.error : null } })
        // Each source reports { ok, value|error } so one failing source can
        // never blank the list; the union of both is "本机所有技能".
        var serverP = fetchServerCatalog()
          .then(function (v) { return { ok: true, value: v } })
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) } })
        var liveP = fetchLiveCatalog(ctx, sessionId)
          .then(function (v) { return { ok: true, value: v } })
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) } })
        return Promise.all([serverP, liveP]).then(function (results) {
          var server = results[0]
          var live = results[1]
          var serverValue = server.ok && server.value ? server.value : null
          var serverSkills = serverValue ? serverValue.skills : []
          var liveSkills = live.ok && Array.isArray(live.value) ? live.value : []
          var merged = mergeLists(liveSkills, serverSkills)
          if (merged.length === 0) {
            console.error('[dsh-skill-sidebar] empty catalog —',
              'live:', live.ok ? liveSkills.length + ' skills' : live.error,
              '| server:', server.ok ? serverSkills.length + ' skills' : server.error)
          }
          setState(function (prev) {
            var next = { ...prev, loading: false, diagServer: server.ok ? '本机 ' + serverSkills.length : '本机✗', diagLive: live.ok ? '实时 ' + liveSkills.length : '实时✗' }
            if (serverValue) {
              next.categories = serverValue.categories
              next.categoryNames = serverValue.categoryNames
              next.policy = serverValue.policy
              next.settings = serverValue.settings
            }
            if (merged.length > 0) {
              next.skills = merged
              next.error = null
              next.source = liveSkills.length > 0 ? 'live' : 'server'
              next.updatedAt = new Date().toISOString()
              writeLocalCache(merged, new Date().toISOString())
            } else if (prev.skills === null || (Array.isArray(prev.skills) && prev.skills.length === 0)) {
              // Nothing anywhere and nothing to fall back on: say exactly why.
              var details = []
              if (!server.ok) details.push('本机扫描: ' + server.error)
              else if (serverSkills.length === 0) details.push('本机扫描: 0 个技能')
              if (!live.ok) details.push('实时目录: ' + live.error)
              else if (liveSkills.length === 0) details.push('实时目录: 0 个技能')
              next.skills = []
              next.error = '技能目录为空（' + details.join('；') + '）'
            }
            return next
          })
          // 宿主是置顶的权威来源（它决定新会话加载清单）。
          if (serverValue && Array.isArray(serverValue.pins)) {
            setPins(function (prev) {
              if (prev.length === serverValue.pins.length && prev.every(function (n, i) { return n === serverValue.pins[i] })) return prev
              writePins(serverValue.pins)
              return serverValue.pins
            })
          }
          return merged
        })
      }, [ctx, sessionId])

      // First paint: serve the persisted snapshot instantly, then refresh.
      React.useEffect(function () {
        var cached = readLocalCache()
        if (cached && Array.isArray(cached.skills) && cached.skills.length > 0) {
          setState(function (prev) {
            return { ...prev, skills: cached.skills, source: 'local', updatedAt: cached.fetchedAt || null }
          })
        }
        // Monday: force a full re-read (the host re-scans disk; the live
        // catalog re-collects) even if a cache exists.
        var monday = isMonday()
        var needsMondayRefresh = monday && (!cached || cached.refreshedDate !== todayStr())
        refresh({ silent: !needsMondayRefresh })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [refresh])

      // Auto-add: while the tab is visible (and its record is alive), re-fetch every 30s.
      React.useEffect(function () {
        if (!visible) return undefined
        if (signal && signal.aborted) return undefined
        refresh({ silent: true })
        var timer = setInterval(function () {
          if (signal && signal.aborted) { clearInterval(timer); return }
          refresh({ silent: true })
        }, POLL_MS)
        return function () { clearInterval(timer) }
      }, [visible, refresh, signal])

      var query = state.query
      var skills = state.skills
      var filter = state.filter
      var grouped = state.group
      var categoryNames = state.categoryNames
      var categories = state.categories
      var policy = state.policy

      // 分类筛选条（全部 / 常驻 / 索引 / 新装 / 各分类）。
      var chips = React.useMemo(function () {
        return skills ? filterChips(skills, categories, Date.now()) : []
      }, [skills, categories])

      var filtered = React.useMemo(function () {
        if (!skills) return []
        // 中文表在这里落地：桌面端宿主未重启时也显示中文（宿主已给出 zh 时幂等）。
        var localized = skills.map(applyZh)
        var base = []
        for (var i = 0; i < localized.length; i++) {
          var s = localized[i]
          if (!matchFilter(s, filter)) continue
          if (!matchQuery(s, query, categoryNames)) continue
          base.push(s)
        }
        return sortPinnedFirst(base, pins)
      }, [skills, query, filter, pins, categoryNames])

      var groups = React.useMemo(function () {
        if (!grouped) return [{ id: '__all', name: '', skills: filtered }]
        return groupSkills(filtered, categoryNames, categories)
      }, [filtered, grouped, categoryNames, categories])

      var icon = primitives && primitives.IconSkillOutline16

      /** 一行技能：名称 + 清单状态 + 置顶/复制 + 短语 + 分类与标签。 */
      function renderRow(s) {
        var phrase = phraseRow(s.phrases)
        var st = stateOf(s)
        var stateText = st === 'resident' ? '常驻' : st === 'indexed' ? '索引' : ''
        var isPinned = pins.indexOf(s.name) !== -1
        var pinButtons = React.createElement('button', {
          key: 'pin',
          className: 'dss-pin' + (isPinned ? ' dss-pin-on' : ''),
          style: { width: 16, height: 16 },
          title: isPinned ? '取消顶标（移出新会话常驻清单）' : '顶标：始终进入新会话技能目录',
          onClick: function () { togglePin(s.name) },
        }, PinIcon(12, isPinned))
        var rowChildren = [
          React.createElement('div', { className: 'dss-row-top', key: 'top' },
            React.createElement('span', { className: 'dss-name', title: s.name }, s.name),
            stateText !== ''
              ? React.createElement('span', {
                className: 'dss-state ' + (st === 'resident' ? 'dss-state-on' : 'dss-state-off'),
                key: 'state',
                title: s.why || stateText,
              }, stateText)
              : null,
            s.source && s.source !== 'agents'
              ? React.createElement('span', { className: 'dss-tag', key: 'tag' }, '#' + s.source)
              : null,
            s.modelInvocable === false
              ? React.createElement('span', { className: 'dss-badge', key: 'badge' }, '仅用户')
              : null,
            pinButtons,
            React.createElement('button', {
              key: 'copy',
              className: 'dss-copy' + (copied === s.name ? ' dss-copy-on' : ''),
              title: copied === s.name ? '已复制 /' + s.name : '复制 /' + s.name + ' 以便调用',
              onClick: function () { copySkill(s.name) },
            }, copied === s.name ? CheckIcon(14) : CopyIcon(12)),
          ),
        ]
        if (phrase.text !== '' || phrase.more > 0) {
          rowChildren.push(React.createElement('div', { className: 'dss-phrases', key: 'phrases' },
            phrase.text,
            phrase.more > 0 ? React.createElement('span', { className: 'dss-more', key: 'more' }, ' +' + phrase.more) : null,
          ))
        }
        var tagList = Array.isArray(s.tags) ? s.tags : []
        rowChildren.push(React.createElement('div', { className: 'dss-rowtags', key: 'tags' },
          React.createElement('span', { className: 'dss-fam', key: 'cat' }, categoryLabel(categoryOf(s), categoryNames)),
          tagList.length > 0 ? ' · ' + tagList.map(function (t) { return '#' + t }).join(' ') : '',
        ))
        return React.createElement('div', {
          className: 'dss-row',
          key: s.name,
          onMouseEnter: function (e) { handleRowEnter(e, s) },
          onMouseLeave: handleRowLeave,
        }, rowChildren)
      }

      var rows = []
      groups.forEach(function (group) {
        if (group.name !== '') {
          rows.push(React.createElement('div', { className: 'dss-group', key: 'g:' + group.id },
            React.createElement('span', null, group.name),
            React.createElement('span', { className: 'dss-group-n' }, group.skills.length + ' 个'),
          ))
        }
        group.skills.forEach(function (s) { rows.push(renderRow(s)) })
      })

      var sourceLabel = state.source === 'live' ? '实时目录'
        : state.source === 'server' ? '本机扫描'
        : state.source === 'local' ? '本地缓存'
        : state.source === 'cache' ? '缓存' : state.source

      var residentCount = 0
      var indexedCount = 0
      if (skills) {
        for (var ci = 0; ci < skills.length; ci++) {
          if (stateOf(skills[ci]) === 'resident') residentCount++
          else if (stateOf(skills[ci]) === 'indexed') indexedCount++
        }
      }

      var headerChildren = [
        React.createElement('h3', { key: 't' }, icon ? React.createElement(icon, { size: 15 }) : null, ' 技能'),
        React.createElement('span', { className: 'dss-count', key: 'c' },
          skills ? String(skills.length) + ' 个' + (residentCount + indexedCount > 0 ? '（常驻 ' + residentCount + ' / 索引 ' + indexedCount + '）' : '') : ''),
        React.createElement('button', {
          key: 'r',
          className: 'dss-refresh',
          disabled: state.loading,
          onClick: function () { refresh({ silent: false }) },
        }, state.loading ? '刷新中…' : '刷新'),
      ]

      var chipRow = chips.length > 1
        ? React.createElement('div', { className: 'dss-cats' }, chips.map(function (c) {
          return React.createElement('button', {
            key: c.id,
            className: 'dss-cat' + (filter === c.id ? ' dss-cat-on' : ''),
            title: c.id === 'resident' ? '会写进新会话的技能目录' : (c.id === 'indexed' ? '不进目录，用 skill_search 或 /名字 按需加载' : undefined),
            onClick: function () { setState(function (prev) { return { ...prev, filter: prev.filter === c.id && c.id !== 'all' ? 'all' : c.id } }) },
          }, c.name + ' ' + c.count)
        }))
        : null

      var body
      if (skills === null) {
        body = React.createElement('div', { className: 'dss-empty' }, state.loading ? '正在读取技能列表…' : '正在加载…')
      } else if (filtered.length === 0) {
        body = React.createElement('div', { className: 'dss-empty' },
          query ? '没有匹配「' + query + '」的技能' : '该分类下没有技能')
      } else {
        body = React.createElement('div', { className: 'dss-list' }, rows)
      }

      var footChildren = [
        React.createElement('span', { key: 'src' }, '来源：' + sourceLabel + ' · v16'),
        React.createElement('span', { key: 'env' }, isDesktopShell() ? '桌面版' : '浏览器'),
        React.createElement('span', { key: 'pol' }, policyLabel(policy)),
        state.updatedAt
          ? React.createElement('span', { key: 'at' }, '更新于 ' + new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false }))
          : null,
        state.diagServer || state.diagLive
          ? React.createElement('span', { key: 'diag', className: 'dss-diag' },
            (state.diagServer || '本机 -') + ' · ' + (state.diagLive || '实时 -'))
          : null,
      ]

      var tipEl = null
      if (tip !== null) {
        tipEl = React.createElement('div', {
          className: 'dss-tip-fixed',
          style: {
            left: tip.left,
            top: tip.top,
            // max-width, not width: the box still shrinks to its content while a
            // narrow frame can squeeze it below the cap.
            maxWidth: tip.width,
            maxHeight: tip.maxHeight,
            transform: tip.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          },
        }, tip.text)
      }

      return React.createElement('div', { className: 'dss-root', 'data-dsh-skill-sidebar': 'body' },
        React.createElement('div', { className: 'dss-header' }, headerChildren),
        React.createElement('div', { className: 'dss-search' },
          React.createElement('input', {
            type: 'text',
            placeholder: '搜索名称/描述/标签，支持 tag:xxx、分类:xxx、常驻、索引',
            value: query,
            onChange: function (e) { setState(function (prev) { return { ...prev, query: e.target.value } }) },
          }),
        ),
        chipRow,
        state.error ? React.createElement('div', { className: 'dss-error' }, '技能目录获取失败：' + state.error) : null,
        body,
        React.createElement('div', { className: 'dss-foot' }, footChildren),
        tipEl,
      )
    }

    /* ------------------------------------------------------------------ */
    /* the tab chip (official `sidebar.right.pane.tab.title` seat)          */
    /* ------------------------------------------------------------------ */

    /**
     * The chip's content: the skill glyph followed by the tab's captured title.
     * @param props - the framework tab-information hook.
     */
    function SkillsTitle(props) {
      var info = props.useTabInfo()
      var title = info && info.tab ? info.tab.title : '技能'
      return React.createElement(React.Fragment, null,
        React.createElement(SkillGlyph, { size: 16, className: 'dss-titleIcon' }),
        title,
      )
    }

    /* ------------------------------------------------------------------ */
    /* cordis client plugin                                                */
    /* ------------------------------------------------------------------ */

    /** Required browser services: the tab registry, the keyed seats, and the catalog sources. */
    var inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'connection', 'sessions']

    /**
     * Register the type, then its body and chip under the same id — the two-stage
     * path the official sidebar documents for any contributing package (mirrors
     * `@deepseek-ai/dsh-client-ui-sidebar-files`). Every registration sits in its
     * own `ctx.effect`, so it lives exactly as long as this plugin.
     */
    function apply(ctx) {
      // Stage one: the page type + its guide entry (a capsule on the guide page).
      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: SKILLS_ID,
          kind: SKILLS_KIND,
          // A type from outside the product; page types are opened by kind.
          priority: 'extension',
          title: function () { return '技能' },
          guide: [{
            order: 20,
            title: function () { return '技能' },
            description: function () { return '列出本机可读取的全部技能，一键复制调用' },
            icon: SkillGlyph,
          }],
        })
      }, 'dsh-skill-sidebar: skills page type')

      // Stage two: the body, keyed by the definition's id.
      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: SKILLS_ID,
            inject: function () { return { ctx: ctx } },
          }, SkillsBody)
        })
      }, 'dsh-skill-sidebar: skills tab body')

      // Stage two (title seat): the chip glyph. Without it the chip shows the
      // registry's captured `title(address)` text alone.
      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: SKILLS_ID,
          }, SkillsTitle)
        })
      }, 'dsh-skill-sidebar: skills tab title')

      // Default-visible: open the tab once per session. The official sidebar
      // starts collapsed and empty, and `openTab` expands the column in the same
      // step; it throws with no mounted session surface, so retry until the seat
      // is up. Closing the tab is respected for the rest of the page load.
      ctx.effect(function () { return installAutoOpen(ctx) }, 'dsh-skill-sidebar: auto-open')
    }

    /**
     * Open the 技能 tab once per session through `ctx.sidebarRight.openTab`.
     *
     * Every command on that face needs a mounted session surface and throws
     * otherwise, so each session gets a bounded retry loop on top of a
     * subscription to the current-session signal.
     * @param ctx - the client cordis context carrying the `sidebarRight` face.
     * @returns a disposer clearing the subscription and every pending timer.
     */
    function installAutoOpen(ctx) {
      if (!AUTO_OPEN) return function () {}

      var opened = {}     // sessionId -> the open succeeded
      var pending = {}    // sessionId -> { tries, timer }
      var timers = []

      function attempt(sessionId) {
        if (!sessionId || opened[sessionId] || pending[sessionId]) return
        var st = { tries: 0, timer: null }
        pending[sessionId] = st
        var step = function () {
          st.tries++
          var ok = false
          try {
            ctx.sidebarRight.openTab(SKILLS_KIND)
            ok = true
          } catch (e) { ok = false }   // no mounted surface yet — retry
          if (ok) {
            opened[sessionId] = true
            delete pending[sessionId]
            return
          }
          if (st.tries >= AUTO_OPEN_TRIES) { delete pending[sessionId]; return }
          st.timer = setTimeout(step, AUTO_OPEN_RETRY_MS)
        }
        st.timer = setTimeout(step, AUTO_OPEN_FIRST_MS)
      }

      function currentSessionId() {
        try {
          var sessions = ctx.get('sessions')
          var snap = sessions && sessions.list && sessions.list.getSnapshot()
          var current = snap && snap.current
          return typeof current === 'string' && current !== '' ? current : null
        } catch (e) { return null }
      }

      var sessions = null
      try { sessions = ctx.get('sessions') } catch (e) { sessions = null }
      var unsub = null
      if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
        unsub = sessions.list.subscribe(function () {
          var id = currentSessionId()
          if (id !== null) attempt(id)
        })
      }
      // Safety net: the session may already be current before we subscribed.
      timers.push(setTimeout(function () {
        var id = currentSessionId()
        if (id !== null) attempt(id)
      }, AUTO_OPEN_FIRST_MS))

      return function () {
        if (unsub) unsub()
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i])
        for (var key in pending) { if (pending[key].timer) clearTimeout(pending[key].timer) }
      }
    }

    exports.inject = inject
    exports.apply = apply
    exports.internals = {
      SKILLS_KIND,
      SKILLS_ID,
      AUTO_OPEN,
      mergeLists,
      phraseRow,
      fullTextOf,
      readLocalCache,
      writeLocalCache,
      todayStr,
      isMonday,
      POLL_MS,
      MAX_INLINE_PHRASES,
      readPins,
      writePins,
      togglePinIn,
      sortPinnedFirst,
      // v0.4.0：分类 / 标签 / 加载清单（纯函数，可单测）
      GRACE_DAYS,
      NEW_WINDOW_MS,
      stateOf,
      categoryOf,
      categoryLabel,
      filterChips,
      matchFilter,
      matchQuery,
      groupSkills,
      policyLabel,
      pushPins,
      fetchServerCatalog,
      // web / 桌面双端：外壳识别与浮层几何（可单测的纯函数）
      isDesktopShell,
      computeTipPos,
      estimateTipHeight,
      fitTipText,
      tipLineCount,
      tipCharWidth,
      toNum,
      // web / 桌面双端：随包中文表与本地化合并（可单测的纯函数）
      applyZh,
      ZH_INLINE,
      TIP_MAX_W,
      TIP_MIN_W,
      TIP_GAP,
      TIP_MARGIN,
      TIP_MIN_H,
      TIP_LINE_H,
      TIP_PAD_Y,
      TIP_CJK_W,
      TIP_LATIN_W,
    }
    return module.exports
  },
})
