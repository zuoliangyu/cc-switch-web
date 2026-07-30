# Web 端跟进上游计划（2026-07）

## 基线

- 上游仓库：`E:\zuolan_lib\AI_Hub\cc-switch`
- 上游本次拉取：`50270d5e..30409878`，119 个提交
- Web 最后明确同步的上游提交：`09f67c1b`（2026-05-19）
- Web 到当前上游完整差距：469 个提交
- Web 基线：`a94f2e6` / `v0.8.0`

本轮目标是引入所有适用于 Web 运行时的上游能力。Tauri 窗口、托盘、桌面更新器、桌面发行流程等仅桌面壳能力不移植；共享业务能力按 Web 的 Axum API、服务端文件系统和现有前端运行时适配，不直接 cherry-pick。

## 执行阶段

### P0：安全与数据保护

- [x] SQL 导入使用 SQLite authorizer 拒绝跨文件操作和危险 PRAGMA（`c98913df`）
- [x] Skill 仓库引用、下载、解压、目录写入/删除边界加固（`ff3bc242` 适用部分）
- [x] Gemini 通用配置凭据过滤及历史泄漏清理（`ff3bc242` 适用部分）
- [x] Codex MCP / OpenCode 非法配置不再 panic（`ff3bc242` 适用部分）
- [x] 通用配置递归合并阻止原型链键（`cd17912f`）
- [x] deeplink 风险分级、MCP 参数展示、URL-safe Base64、usage script 默认禁用（`6dbb944b`、`a443eae9`、`19bf236e`、`cfa90f39`）
- [x] 托管账号接管仅注入一个正确的认证占位符（`c6197ae3`）

### P1：代理与用量正确性

- [x] 对齐 Responses / Chat / Anthropic 请求、响应与 SSE 转换修复
- [x] 对齐 reasoning、tool call、tool-result media 的顺序与身份保持
- [x] 对齐稳定 usage key、幂等写入和 session import 单次通知
- [x] 对齐 Codex fork / sub-agent 用量重建与维护入口
- [x] 对齐 managed OAuth routing-required 判定与失败策略

### P2：功能与生态

- [x] 项目档案（profiles）及 Web API / 页面适配
  - [x] schema、DAO、scope 快照编排与 Web API/runtime
  - [x] Profile 切换与管理页面
- [x] Grok Build 应用目标、配置、代理、MCP、Skills、Prompts、Session 与 Usage
  - [x] 应用标识、配置文件、Provider、官方登录态、导入与基础 Web API
  - [x] MCP、Skills 与 Prompts
  - [x] 代理接管与协议路由
  - [x] Session 与 Usage
  - [x] 前端应用入口与现有功能页面接入
  - [x] 专用 Provider 表单与 TOML 配置工具
  - [x] 第三方 Provider 预设
- [x] xAI OAuth 设备流、账号管理和 Claude / Claude Desktop / Codex 路由
  - [x] OIDC 设备流、刷新令牌、多账号持久化与统一 Web auth API
  - [x] Claude / Claude Desktop Provider 与代理路由
  - [x] Codex Provider 与原生 Responses 路由
  - [x] 账号管理 UI
  - [x] Claude Code Provider 预设与托管账号绑定
  - [x] Claude Desktop Provider 专属表单、预设与托管账号绑定
  - [x] Codex Provider 预设与托管账号绑定
  - [x] xAI 订阅额度查询与展示
- [x] Grok/Kimi/Opus 5/GPT-5.6 内置定价
- [x] A6API 跨应用预设与 PackyCode 备用端点（`dbb26595`、`30409878`）
- [x] Gemini Code0 / Qiniu 默认模型更新（`bfb767ae`）
- [x] 完整供应商预设目录同步
  - [x] Gemini
  - [x] OpenCode
  - [x] OpenClaw
  - [x] Claude
  - [x] Codex
  - [x] Hermes
    - [x] 后端应用标识、YAML Provider 生命周期、导入、切换、连通检查与配置目录接入
    - [x] 前端 Provider 页面与专属表单
    - [x] 完整预设目录
- [x] models.dev 定价同步
  - [x] 手动选择单个模型并导入定价
  - [x] 持久化配置与启动周期同步
- [x] 适用于 Web 的供应商排序、导入错误、表单和配置编辑改进
  - [x] live 配置导入错误展示与失败后列表刷新
  - [x] 预设排序和选择器交互
  - [x] 表单与配置编辑改进
    - [x] 新增 Provider 页面间距与固定底栏填写提示
    - [x] OpenClaw 预设分类、API Key 获取链接与官方分类凭据输入
    - [x] Provider 自定义 User-Agent、预设选择与代理/检测/模型拉取一致性
    - [x] Codex 默认模型安全读写、目录建议与映射回退（`7479d10d`）
    - [x] Codex 高级选项收口及上游格式/模型映射解耦（`e7761609`、`a4eb5f37`）
    - [x] Codex 通用配置改用后端 `toml_edit` 合并并保护异步编辑（`88d5ffba`）
    - [x] Codex 内置官方 Provider 与原生 ChatGPT 登录代理接管（`51d6c458`、`f15184ed`）
    - [x] Codex 官方 Provider 统一新会话历史开关（`948d7627`）
    - [x] Codex 官方存量会话迁移、备份账本恢复与 `CODEX_SQLITE_HOME` 探测（`eab6bfd2`、`69341db2`）

## 验证原则

- 每笔非平凡逻辑保留最小回归测试。
- 阶段内先跑相关测试文件或测试名；全量前端、后端和 Docker 验证在阶段收口时单独确认。
- 行为、配置或接口变化同步更新 `CHANGELOG.md`；发生版本或对外说明变化时同步检查三语 README。

## 执行记录

- 2026-07-30：完成现状调查，确认最新拉取 119 个提交、完整差距 469 个提交。
- 2026-07-30：P0 实现完成。Skill 下载/解压与文件系统 sink、Gemini 凭据清理、非法配置容错、通用配置原型链、Deeplink 风险可见性与托管账号认证占位符均已落地。
- 2026-07-30：P0 定向验证完成：前端安全测试 2 个文件、6 个用例通过，TypeScript 类型检查通过，Rust 新增安全回归测试通过。
- 2026-07-30：开始 P1，完成 Codex Chat / Responses / Anthropic 协议转换与接线；用量链仍在适配中，按“完成一阶段、验证、提交一次”继续推进。
- 2026-07-30：Codex session 增量同步完成，支持 fork、sub-agent、deferred 父会话恢复和疑似重复观测；28 项定向测试通过。
- 2026-07-30：Managed OAuth 与协议格式统一使用路由需求谓词，切换拦截改为检查当前应用 takeover；7 项前端测试和类型检查通过。
- 2026-07-30：稳定 usage key 与幂等写入完成；同语义重放忽略、跨语义碰撞保留两行，logger 5 项和 parser 28 项测试通过。
- 2026-07-30：会话同步改为全局串行后台任务，新增 Codex 备份、清理、重导维护 API；P1 收口。
- 2026-07-30：开始 P2；完成 Profiles schema v11 与 DAO，CRUD、排序、scope current 和迁移测试通过。
- 2026-07-30：完成 Profile 服务与 Web API/runtime；支持 scope 独立快照、切走自动保存、best-effort 应用、代理接管恢复及 current 指针维护，页面适配留到下一笔提交。
- 2026-07-30：完成 Profile 页面适配；主页面支持创建、切换、取消绑定、重命名和删除项目，设置页可隐藏入口，P2 Profiles 收口。
- 2026-07-30：完成 Grok Build 第一阶段；新增 `grokbuild` 应用目标、配置校验与安全凭据提取、官方/自定义 Provider 读写、导入和现有 Axum Provider API 接入。
- 2026-07-30：完成 Grok Build 第二阶段；schema v12 持久化 MCP/Skill 启用位，支持 Grok TOML MCP 投影、导入和回填剥离，Skill 与 Prompt 写入 Grok 标准目录。
- 2026-07-30：完成 Grok Build 第三阶段；schema v13 增加独立代理配置，接入 `/grokbuild/v1` Responses 路由、协议桥、接管/恢复与热切换备份，并拒绝官方态和代理占位符污染。
- 2026-07-30：完成 Grok Build 第四阶段；接入活跃与归档 Session 扫描、消息读取和严格边界删除，5 项定向测试通过。
- 2026-07-30：完成 Grok Build 第五阶段；官方态用量从 `updates.jsonl` 导入，支持沉降窗、稳定幂等键、代理活动去重和 CLI 自报成本，6 项定向测试通过。
- 2026-07-30：完成 Grok Build 第六阶段；前端接入应用切换、目录设置、MCP/Skills/Prompts、Session、Usage 与 Proxy 入口，34 项定向测试和 TypeScript 类型检查通过。
- 2026-07-30：完成 Grok Build 第七阶段；新增专用 Provider 表单及 TOML 解析、构建、更新和校验工具，支持官方空配置与 `env_key` 保留，8 项定向测试和 TypeScript 类型检查通过。
- 2026-07-30：完成 Grok Build 第八阶段并收口；引入独立第三方预设，官方条目复用固定 seed，并补齐 Grok 路由需求判定，33 项定向测试和 TypeScript 类型检查通过。
- 2026-07-30：补齐 Claude Opus 5、GPT-5.6、Kimi K3 与 Grok 4.5 内置价格；数据库种子定向测试通过。
- 2026-07-30：A6API 预设覆盖六个支持应用并复用 Web 本地图标注册；PackyCode 对齐新主域名和三组备用端点。目标 Gemini 尚无 Code0/Qiniu，相关默认模型更新并入后续完整供应商清单同步。
- 2026-07-30：完成 xAI OAuth 后端账号层；引入上游最终 OIDC 设备流、刷新令牌安全持久化、默认账号与重登录状态，接入现有 `/api/auth/*` 通用 Web API；12 项定向测试和后端二进制检查通过。
- 2026-07-30：完成 Claude / Claude Desktop xAI OAuth 代理路由；共享账号状态贯穿 Web 代理服务，固定 xAI 官方 Responses 端点并动态注入 token，增加完整 URL 绕过与 `PROXY_MANAGED` 泄漏防护；24 项定向测试和后端二进制检查通过。
- 2026-07-30：完成 Codex xAI OAuth 原生 Responses 路由；固定官方端点与托管认证，展开并还原 namespace 工具，清理 xAI 不支持的请求字段；38 项定向测试和后端二进制检查通过。
- 2026-07-30：完成 xAI OAuth 账号管理 UI；认证中心支持设备码登录、多账号、默认账号和失效凭据重登录提示，4 项前端定向测试和 TypeScript 类型检查通过。
- 2026-07-30：完成 Claude Code xAI OAuth Provider 预设与托管账号绑定；固定官方 Responses 端点和 Grok 4.5，未登录或绑定账号失效时阻止保存，11 项前端定向测试和 TypeScript 类型检查通过。
- 2026-07-30：同步 Claude Desktop 71 项最终预设目录，覆盖官方、合作方、直连、模型映射及 GitHub Copilot / Codex / xAI 托管 OAuth；专属表单接线留到下一笔提交。
- 2026-07-30：完成 Claude Desktop 前端入口与专属 Provider 表单；支持直连/四档映射、模型拉取、1M 声明和三类托管 OAuth 账号绑定，10 项组件测试、预设测试和 TypeScript 类型检查通过。
- 2026-07-30：完成 Claude Desktop 状态提示；列表每 5 秒检查平台支持、旧模型名、缺失映射、网关 token 和 Base URL 漂移，5 项列表测试和 TypeScript 类型检查通过。
- 2026-07-30：完成 Codex xAI API Key / OAuth 预设与托管账号绑定；OAuth 模式隐藏 Key、端点和格式编辑，支持按绑定账号获取模型目录，3 项定向测试、TypeScript 类型检查和后端二进制检查通过。
- 2026-07-30：完成 Grok/xAI 订阅额度；引入上游 gRPC-web/protobuf 账单解析，xAI 托管 Provider 按绑定账号展示额度，Grok Build 官方 Provider 复用同一查询服务；14 项后端与 5 项前端定向测试通过。
- 2026-07-30：补齐 Gemini Code0 与 Qiniu 预设，统一使用 Gemini 3.6 Flash，接入 Code0 推广说明及 Qiniu 双 Vertex 端点和三语文案；定向预设测试与 TypeScript 类型检查通过。
- 2026-07-30：完整同步 Gemini 23 项最终预设目录；新增 APINebula、Unity2.ai、SubRouter、APIKEY.FUN、ETok.ai、SudoCode.us、CherryIN，移除 3 个上游已下架条目，并对齐现存供应商域名、模型和备用端点。
- 2026-07-30：完整同步 OpenCode 最终预设与模型能力目录；补齐新合作方和 OpenCode Go，默认能力对齐 GPT-5.6 Sol、Gemini 3.6 Flash、Claude Opus/Sonnet 5、GLM 5.1 与 Kimi K3。
- 2026-07-30：完整同步 OpenClaw 最终预设目录；保存预设时按用户实际 Provider Key 重写主模型、回退模型和模型目录引用，避免内置 key 泄漏到配置。
- 2026-07-30：完整同步 Claude 74 项最终预设目录；补齐 Kimi、Code0、Qiniu、Gemini Native、OpenCode Go 等条目，选择器展示顶级合作方徽章，并将 DeepSeek 独立模型目录接入现有模型拉取链路。
- 2026-07-30：完成 Codex 完整目录的前置表单接线；支持预设模型目录、Chat reasoning 与 prompt-cache 路由的加载、编辑和保存，并保留原生 Responses 的隐藏模型能力字段。
- 2026-07-30：完整同步 Codex 68 项最终预设目录；补齐 Kimi、Code0、Qiniu、OpenCode Go 等条目，对齐 Chat/Responses 协议、默认模型、上下文窗口及推理能力配置。
- 2026-07-30：完成 Hermes 后端第一阶段；接入 additive Provider CRUD、live 导入、默认模型切换、三种 API 模式检查、Skills/Prompts 路径与只读 `providers:` overlay，4 项定向测试和后端二进制检查通过。
- 2026-07-30：完成 Hermes 前端第二阶段；接入 Provider 列表、专属表单、additive 生命周期、默认模型切换、live ID 锁定和 `providers:` overlay 只读交互，3 项定向测试和 TypeScript 类型检查通过。
- 2026-07-30：完整同步 Hermes 63 项最终预设目录；四种协议、Provider Key 唯一性、默认模型引用及三语名称/推广文案由 5 项目录测试锁定，TypeScript 类型检查通过。
- 2026-07-30：完成 models.dev 手动定价导入；支持供应商筛选、全量搜索、文本模型过滤、价格与模型 ID 归一化、超时错误和重试，自动同步留到下一阶段。
- 2026-07-30：完成 models.dev 自动定价同步；服务端持久化用户覆盖、删除标记、模型选择和同步结果，Web 页面启动时按 6 小时间隔检查，支持常用模型、多选配置、立即同步与本地文件重载。
- 2026-07-30：Provider live 配置导入失败时改为兼容字符串和对象错误，并刷新 Provider 查询以呈现失败前已产生的持久化副作用。
- 2026-07-30：同步 Provider 预设选择器最终交互；默认按官方、尊享合作方、赞助商和普通供应商分组，支持名称搜索、A-Z 排序、快捷键、等宽图标网格及搜索后正常选中。
- 2026-07-30：新增 Provider 页面支持内容区局部间距覆盖，收紧预设区顶部留白，并在固定底栏持续提示补充 API Key 等必填字段。
- 2026-07-30：补齐 OpenClaw Provider 的预设分类识别和 API Key 获取链接；官方分类仍保留凭据输入，避免沿用 OAuth-only 表单行为。
- 2026-07-30：完整接入 Provider 自定义 User-Agent；Claude、Codex 与 Grok Build 支持预设选择和非法字符提示，Web 代理转发、健康检查与模型拉取统一应用，官方 Provider 与 Copilot 指纹保持原行为。
- 2026-07-30：完善 Codex 默认模型配置；严格转义远端模型 ID，合并映射与 `/models` 建议，支持缺失映射提示、快速补入、过期响应丢弃及空值保存回退；14 项定向测试和 TypeScript 类型检查通过。
- 2026-07-30：收口 Codex 高级选项并解耦上游格式与模型映射；Responses 与 Chat 协议均可独立启用模型目录，3 项组件测试和 TypeScript 类型检查通过。
- 2026-07-30：Codex 通用配置合并迁移到后端 `toml_edit`，新增 Web API/runtime 适配，保留注释与键序并丢弃过期异步结果；2 项后端、6 项前端定向测试及前后端检查通过。
- 2026-07-30：接入本地代理请求覆盖；Claude 与 Codex 第三方 Provider 可配置 Header/Body JSON，协议转换后深合并 Body，并保护认证、连接、追踪、转发链和 `stream` 字段，Copilot 保持原始指纹链路。
- 2026-07-30：修复从应用导入 MCP 时吞错的问题；5 个 Web 已支持应用逐项 best-effort 导入，完成后聚合上报失败，并在部分失败时照常刷新已导入结果。
- 2026-07-30：隔离 MCP 跨应用重投影失败；全量同步逐应用聚合错误，Provider 保存、切换和单应用恢复只投影目标应用，已落盘的业务操作不再被无关坏配置伪装成失败。
- 2026-07-30：补齐 Claude/Codex 切换前的通用配置自动回收；把 live 中新增、删除或修改的共享项整体重提取回片段，尊重显式清空标记，并继续排除凭据、端点、模型目录及 MCP 注入项。
- 2026-07-30：接入 Codex 内置 OpenAI Official 稳定条目与原生 ChatGPT 登录代理接管；官方认证只透传到固定后端，第三方接管不再覆盖 `auth.json`，热切换会按目标 Provider 重新投影 live 路由。
- 2026-07-30：接入 Codex 官方 Provider 统一会话历史开关；仅在无显式路由且稳定路由名未被第三方占用时投影新会话桶，代理接管期间同步更新恢复备份，存量历史迁移留到下一阶段。
- 2026-07-30：完成 Codex 官方存量会话迁移；用户可选择把 `openai` 桶迁入 `ccswitch`，JSONL 与 `state_5.sqlite` 改写前按代际备份，关闭开关后只按官方 ID 账本精确恢复，并支持配置项和 `CODEX_SQLITE_HOME` 指定的状态库目录。
- 2026-07-30：以 cc-switch `30409878` 完成最终审计；适用于 Web 的差异均已落地，Tauri 窗口、托盘、桌面更新器和桌面发行流程继续排除。
