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
- [ ] models.dev 定价同步
- [ ] 适用于 Web 的供应商排序、导入错误、表单和配置编辑改进

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
