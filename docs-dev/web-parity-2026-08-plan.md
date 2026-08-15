# Web 端完整跟进上游计划（2026-08）

> 状态：已完成（W0–W9）
> 上游范围：`cc-switch` `30409878..40cac1a6`  
> 执行原则：完整吸收适用于 Web 运行时的最终语义，不机械 cherry-pick Tauri 实现

## 1. 目标与基线

用户已确认本轮按一个完整任务推进，不再拆成“只修 P0”或“Pi 后续再做”。目标是让 `cc-switch-web` 吸收上游从上一轮审计点到当前 `main` 的全部适用变化，包括 Pi 原生支持、用量统计、安全与数据修复、Provider 能力、预设、管理体验和必要文档。

### 1.1 仓库基线

- 上游仓库：`E:\zuolan_lib\AI_Hub\cc-switch`
- 上一轮 Web 最终审计点：`30409878`（2026-07-29，包含于 `v3.19.0`）
- 上游当前提交：`40cac1a6`（2026-08-15）
- 上游正式版本：`v3.19.1`、`v3.19.2`
- `v3.19.2` 之后未发布提交：43 个
- 完整增量：88 个提交、340 个文件，约 `+45,994 / -8,305`
- Web 当前版本：`1.0.0`
- Web 当前数据库 Schema：`v13`
- Web 当前主应用入口：Claude、Claude Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw；Hermes 后端已存在但前端主切换列表尚未开放

### 1.2 目标状态

- 上游适用于服务端文件系统、浏览器 UI 和本地代理的行为全部落地。
- Pi 成为完整应用目标，接入 Provider、Prompts、Skills、Sessions 和 Usage，但不接入代理、故障转移或登录托管。
- 修复数据库备份/同步、会话计费、官方登录恢复、代理转换和配置写入中的已知正确性问题。
- Provider 目录、模型定价、促销元数据和三语界面与上游当前最终状态一致。
- 新增 Web API 全部受现有访问密钥中间件保护，健康检查和认证接口边界保持不变。
- 更新 `CHANGELOG.md`；Pi 和应用范围变化同步更新 `README.md`、`README_EN.md`、`README_JA.md`。

## 2. “全部跟进”的边界

### 2.1 纳入范围

- `src-tauri/src` 中可迁移到 `backend/src` 的共享业务逻辑。
- Tauri command 对应的 Axum Web API、前端 API client 和 query 层适配。
- 所有适用于当前三语体系的 i18n 键及覆盖测试。
- Pi 原生应用支持和 Pi session usage。
- 安全、数据恢复、同步、计费、代理和配置正确性修复。
- Provider 表单、管理页、导航、IME、可访问性及响应式布局改进。
- 模型目录、定价种子、Provider 预设及应用内合作方信息。
- 与本仓库 CI 结构相容的 Corepack、路径过滤和 Windows/WSL 回归验证。
- 上游 release note 中与 Web 行为有关的内容，改写后进入 Web `CHANGELOG.md` 和正式文档。

### 2.2 语义适配，不直接复制

- 上游 `src-tauri/src/commands/*` 不保留 Tauri 壳，改为内部 service/command 函数加 Axum route。
- 上游前端 `invoke` 调用接入现有 `src/lib/runtime/client/core.ts` 和 HTTP API。
- 上游四语键只同步到 Web 已支持的中、英、日三语；本轮不额外引入繁体中文语言包。
- 上游 S3/WebDAV 共用修复只移植 Web 已有的 WebDAV 和公共同步协议部分，不为了复用修复而新增 S3 产品面。
- 上游 Schema 版本号不照抄。Web 从独立的 `v13` 增加最小迁移版本，保持自身迁移链连续。
- 上游桌面窗口焦点动画逻辑改用浏览器 `visibilitychange`、`focus/blur` 和 `prefers-reduced-motion`。
- 上游桌面工具探测/安装逻辑仅在 Web 后端存在对应功能时适配，不复制 GUI 启动环境假设。

### 2.3 明确排除

- Tauri 窗口、托盘、单实例、桌面更新器和进程插件。
- WiX 安装器、Windows 注册表模板和桌面发行流水线。
- 上游版本号与 release commit 本身；其行为说明由 Web changelog 吸收。
- 上游仓库专属的 GitHub Sponsors 按钮、README 赞助区和项目定位文案。
- 仅为繁体中文存在的翻译文件；保留三语键完整性测试即可。
- Pi 的 `/login`、`auth.json`、OAuth/API Key 登录托管、默认 Provider/Model 写入、代理和故障转移。
- Pi Extensions、Themes、Packages，以及相对 `sessionDir` 的项目上下文猜测。

排除项不是遗漏：它们在 Web 运行时没有对应产品语义，强行复制只会增加不可用代码。

## 3. 开始实现前必须补齐的现有缺口

### 3.1 Codex `model_catalog_json` 投影缺失

当前前端会把 `settingsConfig.modelCatalog.models` 保存进 Provider，并向用户说明会生成 `model_catalog_json`，但 Web 后端没有上一轮上游已经具备的目录生成、文件投影、反向解析和所有权保护链路。

这会阻塞以下新变化：

- DeepSeek 官方目录镜像（`8ae1ce85`）
- 用户自有目录保护（`413c09e0`）
- DeepSeek 目录文本修复（`5602324b`）
- 每模型推理档位（`40cac1a6`）

因此先从上游 `30409878` 恢复该完整基线能力，再叠加本轮增量。目录文件只能写入 Codex 配置目录；用户自有 `model_catalog_json` 不覆盖、不删除。

### 3.2 应用注册表不一致

- 前端 `APP_ICON_MAP` 有 Hermes，但 `APP_IDS` 没有 Hermes。
- 后端 `AppType::all()` 有 Hermes，Claude Desktop 又存在部分“脚手架”注释与实际能力不一致。
- Pi 加入后，应用列表、可见性、Provider、Prompt、Skills、Session、Usage、Proxy 排除表容易继续分叉。

实现时复用现有 `appConfig` 和 `AppType`，不新建第二套应用注册框架；逐个消费方显式声明支持能力。Pi 与 Hermes 一并修正主入口和能力矩阵。

### 3.3 Hermes Prompt 文件名错误

当前 Hermes 仍映射到 `AGENTS.md`，应按上游改为 `~/.hermes/SOUL.md`。迁移只改变后续读写目标，不擅自删除旧 `AGENTS.md`。

### 3.4 数据库迁移不能照搬版本号

上游 Pi usage 把 Schema `v16` 升到 `v17`，新增 `session_usage_dedup` 持久去重账本。Web 当前为独立 `v13`，应新增自己的下一版迁移，内容只包含最终所需表、索引和数据兼容逻辑，并验证：

- `v13` 原库可无损升级。
- 新库直接建出最终 Schema。
- 迁移失败回滚，迁移前备份仍可恢复。
- SQL 导出、WebDAV 同步和本地保留表包含正确的新表策略。

## 4. 实施工作包

所有工作包属于同一总任务，但必须逐包实现、局部验证和记录，避免一次性大改后无法定位数据或代理回归。

### W0：基线修复与瘦身

- [x] 恢复 Codex model catalog 生成、投影、反解和所有权基线。
- [x] 统一现有 Hermes、Claude Desktop 应用能力；Pi 能力随 W7 接入。
- [x] 对照 `3c1154be`、`4317bd99` 删除 Web 中确实无调用方的旧模块、重复 proxy query 和依赖。
- [x] 保留 Web 已实际使用的 `RepoManagerPanel`、图标和 JSONC 能力，不按上游文件名盲删。
- [x] 对齐 icon-only 应用切换器，并保留 Web 已完成的移动端可达菜单。

最小验证：TypeScript 类型检查、应用配置测试、proxy status hook 测试、Codex catalog 定向后端测试。

### W1：安全、备份与同步基础

- [x] usage script：5 秒中断、16 MiB 内存、256 KiB 栈限制。
- [x] Grok session：50 MiB 文件上限、16 层目录深度、拒绝 symlink。
- [x] Codex catalog：配置目录边界、canonicalize 二次校验、32 MiB 上限。
- [x] Proxy body：128 MiB 流式读取上限和有预算的 gzip/deflate/zstd/brotli 解压。
- [x] Deeplink：显示并遮蔽 `usageAccessToken`，显示 `usageUserId`。
- [x] SQL dump：批量 INSERT，保留 TEXT/BLOB/REAL 精度和 `sqlite_sequence`。
- [x] SQL import：拒绝截断事务，保留 incremental auto-vacuum，接受合法空数据导出。
- [x] 备份发布、保留清理和恢复串行化、原子化；损坏或未来版本备份不得触碰 live DB。
- [x] WebDAV 同步导入恢复本地表时使用单事务，下载/恢复失败保持数据库与 Skills 一致。
- [x] Windows/WSL 原子替换失败时使用安全回退。

主要上游提交：`6b8f3643`、`668bbda9`、`dfb2e523`、`c9fe340b`、`c39c9032`。

最小验证：每个安全边界一个回归测试；备份 round-trip、损坏/截断导入、并发备份、WebDAV 失败回滚测试。

### W2：用量、代理与认证正确性

- [x] 缓存 Codex fork 父 rollout timeline，避免重复解析。
- [x] Codex interleaved token counter 使用 exact last-turn usage 和来源签名去重。
- [x] Codex session 批量写入并预加载 cursor/pricing。
- [x] Claude Desktop proxy/session usage 单向去重，历史明细查询不再双算。
- [x] Codex official 切回时清理仅含第三方 Key 的陈旧 `auth.json`。
- [x] 接管恢复时保留接管期间刷新的官方 ChatGPT 登录，只恢复 config。
- [x] Chat tool call 全部被丢弃时返回失败，不伪造 completed。
- [x] GitHub Copilot 使用现代 Claude Code 可接受的认证占位符并剥离 `[1M]` 标记。
- [x] Grok Build 接管固定本地 Responses 路由，读取稳定 conversation/session header。
- [x] Grok Build usage 补齐必要 input token 细项。
- [x] Kimi 不再注入 `thinking` / `reasoning_content` 占位；DeepSeek/MiMo 保持原规则。
- [x] Zhipu quota 接受 `CREDIT_LIMIT` 条目。

主要上游提交：`56fb46c0`、`4bfb3fc3`、`c49cf96a`、`e3f80a98`、`13ea497a`、`9db9c56f`、`59a2bd10`、`baf07a27`、`d2b070c9`、`c8262476`、`6a7da87c`、`1f38c838`。

最小验证：按应用覆盖 usage 幂等、fork、交错计数、官方登录恢复、Chat 工具调用失败、Kimi 负向行为和 Grok Build session 稳定性。

### W3：Skills、Prompts、OMO 与原生配置

- [x] Skill 源目录以真实 `SKILL.md` 锚点解析，不被同名包装目录误导。
- [x] README URL 使用最终解析出的真实源目录。
- [x] SSOT 目录缺失时报告可更新，允许现有 update 流程重建。
- [x] Hermes Prompt 改用 `SOUL.md`。
- [x] OMO 优先写统一 `omo.jsonc` / `omo.json` 的 `[opencode]` 节点，保持注释、顺序和换行；round-trip 不安全时拒绝写入。
- [x] OMO 模型选择器合并 `opencode models` 运行时结果，固定安全工作目录、禁用项目插件发现并设置超时。
- [x] OpenCode Go、DeepSeek context window 及相关直连语义对齐。

主要上游提交：`83830767`、`eb356e15`、`40b6376b`、`0345fad6`、`92ca95ff`、`967daa1a`、`390102a2`、`16cc0d7f`、`bef46cd5`。

最小验证：Skill 嵌套仓库、缺失 SSOT、Hermes 文件路径、OMO JSON5 无损往返、运行时模型命令隔离与超时。

### W4：Codex 目录、原生 Responses 与定价

- [x] DeepSeek 官方模型目录镜像和 native Responses 直连。
- [x] Volcengine Agent Plan 使用 `/api/coding/v3` native Responses；Coding Plan 保留独立产品语义。
- [x] 新增腾讯混元 TokenHub native Responses 预设。
- [x] `displayName`、`contextWindow` 改为显式优先，官方目录值不被默认值覆盖。
- [x] 用户自有 `model_catalog_json` 不被生成器覆盖。
- [x] 修复 DeepSeek 官方目录中被 HTML 提取误删的尖括号文本。
- [x] 每模型支持 `reasoningLevels`、`defaultReasoningLevel`，按规范顺序过滤并支持 Auto。
- [x] Proxy transform 补齐 `ultra` reasoning 映射。
- [x] 同步 v3.19.1、v3.19.2 和未发布区间的全部最终定价种子与精确修复条件。

主要上游提交：`8ae1ce85`、`56a66eea`、`58dd376d`、`f42534ed`、`f38722a4`、`413c09e0`、`5602324b`、`7dc0a725`、`40cac1a6`。

最小验证：目录所有权、目录边界、官方镜像快照、原生/聚合商 profile 区分、推理档位排序与默认值、用户自定义价格不被覆盖。

### W5：Provider 生态与表单体验

- [x] 移除 Unity2.ai、NekoCode 已下架预设及对应三语文案。
- [x] 更新 RunAPI 域名与备用端点、Kimi/RunAPI/FennoAI 信息和 Qiniu 排序。
- [x] 新增 PPIO、JieKou AI、XycAi 跨应用预设。
- [x] Volcengine 拆分 Agent Plan 与 Coding Plan。
- [x] 去除 Provider 卡片合作方星标，保留分类和必要促销信息。
- [x] 模型映射下拉支持模糊搜索并完成共用组件收口。
- [x] Claude、Claude Desktop、Grok Build、OpenCode、OpenClaw、Hermes 表单层级与高级选项对齐。
- [x] 统一 checkbox 视觉与 IME-safe input，macOS 中文输入组合期间不重建输入框。
- [x] 路由激活反馈使用克制动画并支持 reduced motion。
- [x] 消除 Provider 编辑器无意义空白，保证移动端和窄屏无裁切。

主要上游提交：`ebbf141f`、`996d512f`、`4d3e2c35`、`0e604b75`、`5b697abc`、`3711e1a0`、`7e152d75`、`076c2744`、`95b95da6`、`619a592c`、`5b77da2b`、`c0050623`、`58d92e56`、`ec842156`、`ccc86298`、`580a4d7b`、`7e5007d5`、`7de63227`、`bc7f5f41`、`8673e9d8`、`5f6072ce`、`c99550e0`、`a7f073e9`、`5b8bf1fe`、`eb69e492`、`d9d4a660`、`f748f3ac`。

最小验证：预设目录快照、三语键覆盖、表单 load/save 往返、IME composition、键盘操作和常见移动/桌面宽度。

### W6：管理页、导航与浏览器运行体验

- [x] MCP、Prompt、Skill 列表增加统一搜索，Esc 清空。
- [x] MCP、Skill 按应用批量启停，顺序执行并聚合失败；操作目标为全量列表而非过滤结果。
- [x] MCP 单列原子更新，Skill 更新校验 install generation，避免并发覆盖和卸载后复活。
- [x] Auth Center 展示每个 ChatGPT 账号的订阅用量，复用现有 query cache。
- [x] 所有应用启用时，主操作区不被裁切；当前应用始终可见，其余进入更多菜单。
- [x] 浏览器标签页隐藏或窗口失焦时停止纯装饰心跳动画。
- [x] 应用切换器固定为图标模式，但继续满足移动端可访问菜单和 tooltip。
- [x] 三语缺失键测试覆盖工具管理和管理列表；Pi 文案随 W7 功能接入时覆盖。

主要上游提交：`f5f4281d`、`b884595a`、`a354f08a`、`492245dc`、`968794e3`、`9f19d8fd`、`0cb6e014`。

最小验证：管理页组件测试、批量部分失败、并发开关、导航溢出、键盘、浏览器可见性和 reduced-motion。

### W7：Pi 原生应用核心

Pi 按上游最终契约一次落地，但复用现有 OpenCode/Hermes/Provider 基建，不复制一套平行架构。

#### W7.1 应用与配置

- [x] 增加 `AppType::Pi`、前端 `AppId`、图标、可见性和目录设置。
- [x] 管理 `~/.pi/agent/models.json.providers` 中的全部显式节点。
- [x] Provider ID 精确匹配；内置 ID 的显式覆盖也作为普通可管理配置。
- [x] 保存只替换目标 Provider，未知字段和其他顶层字段无损保留。
- [x] `auth.json` 始终不读、不写；不改变 `defaultProvider`、`defaultModel`。
- [x] Provider 为 additive 模式，启用/移除只增删显式节点，数据库卡片保留。
- [x] 模型列表获取只填 ID/名称，不为自定义模型猜测能力。
- [x] 预设离线提供模型能力和稀疏 `thinkingLevelMap`。

#### W7.2 Prompts、Skills 与 Sessions

- [x] 全局 Prompt 管理 `AGENTS.md`，外部内容先入库再覆盖。
- [x] 原生系统提示管理 `SYSTEM.md`、`APPEND_SYSTEM.md`。
- [x] 原生模板管理 `prompts/*.md`，空模板仍是有效文件。
- [x] Skills 以 Pi 原生目录存在性为唯一启用状态。
- [x] Sessions 读取绝对 `sessionDir`、`~` 和默认目录；相对路径明确提示缺少项目上下文。
- [x] 删除 Session 前验证根目录和 session ID。

#### W7.3 Web 边界

- [x] 新增 Pi API、query 和 runtime client 映射。
- [x] 所有 Pi API 经过 Web access key 保护。
- [x] Proxy、failover、takeover、OAuth 和 managed account 对 Pi 显式返回不支持或从 UI 隐藏。
- [x] 三语文案、键盘、深浅主题、移动端布局和可访问名称完整。

主要上游提交：`84e75ad2`。

最小验证：Pi 配置无损往返、外部修改同步、内置 ID 显式覆盖、默认值不变、`auth.json` 字节不变、Prompt/Skill/Session 路径边界和 API 鉴权。

### W8：Pi Session Usage 与数据库迁移

- [x] 增加 `session_usage_pi`，解析 Pi JSONL 树、分支重写和请求语义。
- [x] 新增持久 `session_usage_dedup` 账本，明细 rollup/prune 后仍可去重。
- [x] Pi usage 接入统一同步调度、统计筛选、Dashboard 和数据源类型。
- [x] 数据库从 Web `v13` 迁移到下一版本，不照抄上游版本号。
- [x] SQL 备份、WebDAV 同步和本地保留策略覆盖去重账本。
- [x] Pi 文件重写、fork、缺失 entry ID、重复导入和删除源文件场景保持幂等。

主要上游提交：`40d747c0`。

最小验证：Schema 新建/升级、去重账本、rollup 后重导、Pi 分支重写、重复同步、Usage 页面筛选。

### W9：CI、文档与收口

- [x] CI 使用 `packageManager` pin 对应的 Corepack，避免第二套 pnpm 版本来源。
- [x] 检查 Web workflow 的 path filter；纯文档提交不运行前后端重验证。
- [x] Windows job 增加 WSL 文件系统原子替换回归；若 GitHub runner 不具备稳定 WSL 条件，保留 Rust 平台测试而不引入脆弱 job。
- [x] 删除经 import/依赖扫描确认无调用方的旧代码和依赖。
- [x] 更新 `CHANGELOG.md`。
- [x] 同步更新三语 README 的应用范围、Pi 能力和明确边界。
- [x] 将 Pi 四份上游设计资料整理为 Web 正式文档，删除 Tauri 专属描述。
- [x] 在本文持续追加每个工作包的完成提交、验证证据和剩余差异。

相关上游提交：`6b13d018`、`3b9d0593`、`c0ff89b9`、`b3a20e58`、`28529620`、`a4bba43f`、`fbf52cff`、`425e932b`、`43eaf073`、`ceef0a52`、`36ed280d`、`c98cc3a9`、`290b65c0`、`3c592d93`。

其中 release commit 只吸收行为说明；`290b65c0` 的上游 Sponsors 按钮和 `3c592d93` 的 WiX 修改明确不进入 Web 产品代码。

## 5. 实施顺序与依赖

```text
W0 基线修复
 ├─> W1 安全/备份/同步
 ├─> W2 用量/代理/认证
 ├─> W3 Skills/Prompts/OMO
 └─> W4 Codex 目录/定价
          │
          ├─> W5 Provider 生态与表单
          └─> W6 管理页与导航
                    │
                    └─> W7 Pi 核心 -> W8 Pi Usage/Schema
                                      │
                                      └─> W9 CI/文档/收口
```

约束：

- W0 的 Codex catalog 基线是 W4 的硬前置。
- W1 的备份正确性先于任何 Schema 迁移。
- W6 的应用导航收口先于 Pi 最终接入，避免新增入口后再重写导航。
- W7 先稳定 Pi 原生配置和 Sessions，W8 再写 usage 和迁移。
- W9 最后做全局删除和文档收口，但各工作包仍即时补最小测试与 changelog 草稿。

## 6. 影响范围

### 后端

- `backend/src/database/*`
- `backend/src/services/session_usage*`、`usage_stats.rs`
- `backend/src/services/proxy.rs`、`backend/src/proxy/*`
- `backend/src/codex_config.rs`、`prompt_files.rs`、`services/skill.rs`
- 新增 Pi config/provider/prompt/session/usage 模块
- `backend/src/web_server.rs` 的 Pi、模型目录、管理和维护 API

### 前端

- `src/App.tsx`、`src/config/appConfig.tsx`
- Provider 表单、列表、状态与预设目录
- MCP、Prompts、Skills、Sessions、Usage、Auth Center
- runtime client、API、query、类型和三语 locale
- Pi 专用表单与原生 Prompt 资源页面

### 数据与配置

- SQLite Schema 和备份格式
- `~/.codex`、`~/.hermes`、OMO、Grok Build、Skills SSOT
- `~/.pi/agent/models.json`、Pi Prompt/Skills/Sessions
- WebDAV 同步快照

### 文档与发布

- `CHANGELOG.md`
- `README.md`、`README_EN.md`、`README_JA.md`
- `docs/` 中 Pi 和 Codex 路由正式说明
- 本文执行记录

## 7. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 88 个提交跨越共享逻辑、UI 和新应用，直接合并难以回滚 | 按 W0–W9 小步提交，每包可独立验证 |
| 上游 Tauri 与 Web Axum 生命周期不同 | 先落 service，再接 Web route；不把 Tauri state/invoke 带入后端 |
| 备份/同步改动可能造成数据丢失 | W1 先完成；损坏、截断、并发、保留清理和 round-trip 都留回归测试 |
| Codex 登录恢复会覆盖新 OAuth token | live 真实登录材料优先于旧备份；第三方 Key 可从 DB 恢复 |
| Pi 配置和登录所有权混淆 | 永不读写 `auth.json`，不写默认 Provider/Model，不接代理 |
| 新 API 扩大远程攻击面 | 全部走现有 access-key middleware；文件路径 canonicalize 和大小限制 |
| Schema 版本与上游不同 | 只迁移最终数据语义，使用 Web 自己的连续版本号 |
| 预设/文案更新污染 Web 项目定位 | 同步应用内功能数据；上游 Sponsors/README 项目文案不复制 |
| UI 全应用入口溢出 | 先完成导航溢出策略，再加入 Pi；移动端和窄屏截图验收 |
| 上游后续继续变化 | 本轮冻结到 `40cac1a6`；完成前不移动基线，新增变化另开审计 |

## 8. 验收标准

### 8.1 功能

- 上游 88 个提交均在附录中有明确处置结果，无未分类提交。
- W0–W9 清单全部完成或有用户确认的排除记录。
- Pi Provider、Prompts、Skills、Sessions、Usage 在 Web 中可用，且没有代理/登录托管入口。
- Codex model catalog、native Responses、推理档位和用户目录所有权行为正确。
- 所有 Provider 预设、定价和三语文案处于 `40cac1a6` 最终状态。

### 8.2 数据与安全

- 现有 Web `v13` 数据库升级成功，升级前备份可恢复。
- SQL dump/import 保留 SQLite 值类型、自增高水位和合法空库语义。
- WebDAV 下载失败不会留下半恢复数据库或 Skills 状态。
- usage script、目录递归、文件读取、代理响应和解压均有可执行上限测试。
- Codex 官方登录、Pi `auth.json` 和用户自有 model catalog 不被覆盖。

### 8.3 UI 与可访问性

- Chrome 桌面与移动视口下无工具栏、按钮、弹层和长文本重叠。
- 所有新输入有 Label，图标按钮有可访问名称，动态错误可被读屏发现。
- IME composition 不丢字、不重复、不触发表单重建。
- `prefers-reduced-motion` 下停止非必要动画。
- 中、英、日三语键结构一致，插值变量一致。

### 8.4 验证策略

- 每个非平凡逻辑至少保留一个最小回归测试。
- 工作包内只运行相关 Rust 测试、Vitest 文件、类型检查或格式检查。
- 不重复执行已有等价重验证。
- 全量 `pnpm check`、完整 Rust 测试、Docker build/smoke 和多平台 CI 在所有工作包完成后单独确认再执行。
- 真实 Pi 验收使用隔离配置目录，不触碰用户实际 `auth.json` 和会话数据。

## 9. 88 个上游提交处置表

标记：

- **适配**：实现对应 Web 行为。
- **审计**：检查 Web 是否仍存在目标代码，存在则修改/删除，不制造无效 diff。
- **吸收**：代码由其他提交实现，只把 release/docs 信息吸收到 Web 文档。
- **排除**：确认仅桌面或上游仓库身份相关，不进入 Web。

### 9.1 `30409878..v3.19.0`（5）

| 提交 | 处置 | 工作包 |
| --- | --- | --- |
| `56fb46c0` | 适配 Codex fork timeline 缓存 | W2 |
| `f5f4281d` | 适配应用切换器，保留 Web 移动端菜单 | W0/W6 |
| `6b13d018` | 吸收版本说明 | W9 |
| `3b9d0593` | 吸收 release note | W9 |
| `c0ff89b9` | 吸收安全说明 | W9 |

### 9.2 `v3.19.0..v3.19.1`（14）

| 提交 | 处置 | 工作包 |
| --- | --- | --- |
| `3c1154be` | 审计并删除 Web 真正无调用方的旧代码/依赖 | W0/W9 |
| `4317bd99` | 适配统一 proxy query 路径 | W0 |
| `b884595a` | 适配为三语工具管理键覆盖测试 | W6 |
| `c49cf96a` | 适配 Grok Build proxy/deeplink/session | W2 |
| `4bfb3fc3` | 适配 Claude Desktop usage 去重 | W2 |
| `a354f08a` | 适配缺失界面键到三语 | W6 |
| `f07edc76` | 审计 Web 后端 Grok upgrade 命令环境，存在同路径则适配 | W9 |
| `e3f80a98` | 适配 Codex official 陈旧 auth 清理 | W2 |
| `f42534ed` | 适配最终定价修复 | W4 |
| `8ae1ce85` | 适配 DeepSeek native Responses 与官方目录 | W4 |
| `56a66eea` | 适配 Volcengine native Responses | W4 |
| `58dd376d` | 适配腾讯混元 TokenHub | W4 |
| `b3a20e58` | 吸收版本说明 | W9 |
| `28529620` | 吸收 release note | W9 |

### 9.3 `v3.19.1..v3.19.2`（26）

| 提交 | 处置 | 工作包 |
| --- | --- | --- |
| `a4bba43f` | 适配 Web Codex 路由正式文档 | W9 |
| `fbf52cff` | 吸收文档链接修正 | W9 |
| `ebbf141f` | 适配移除 Unity2.ai | W5 |
| `83830767` | 适配 Hermes `SOUL.md` | W3 |
| `13ea497a` | 适配 GitHub Copilot 接管 | W2 |
| `f38722a4` | 适配 Qwen3.8 Max 定价 | W4 |
| `eb356e15` | 适配 Skill 源目录解析 | W3 |
| `9db9c56f` | 适配 dropped Chat tool call 失败语义 | W2 |
| `996d512f` | 适配移除 NekoCode | W5 |
| `4d3e2c35` | 适配 RunAPI 应用内信息 | W5 |
| `0e604b75` | 适配 Kimi 应用内信息 | W5 |
| `492245dc` | 适配 Auth Center 分账号额度 | W6 |
| `968794e3` | 适配浏览器可见性/reduced-motion | W6 |
| `92ca95ff` | 适配 OMO runtime model list | W3 |
| `9f19d8fd` | 适配管理页搜索与批量开关 | W6 |
| `6b8f3643` | 适配全部 Web 安全边界 | W1 |
| `59a2bd10` | 适配 Codex interleaved counter | W2 |
| `668bbda9` | 适配备份批处理与单事务恢复 | W1 |
| `40b6376b` | 适配 Skill README URL | W3 |
| `5b697abc` | 适配 Qiniu 预设排序 | W5 |
| `0cb6e014` | 适配全应用导航溢出 | W6 |
| `290b65c0` | 排除上游 Sponsors 按钮 | W9 |
| `0345fad6` | 适配 OMO 统一配置 | W3 |
| `baf07a27` | 适配 Codex usage 批量导入 | W2 |
| `425e932b` | 吸收版本说明 | W9 |
| `43eaf073` | 吸收 release note | W9 |

### 9.4 `v3.19.2..40cac1a6`（43）

| 提交 | 处置 | 工作包 |
| --- | --- | --- |
| `413c09e0` | 适配用户自有 Codex catalog 所有权 | W4 |
| `c39c9032` | 适配 WSL 原子替换回退 | W1 |
| `ceef0a52` | 适配可稳定运行的 Windows/WSL 回归 | W9 |
| `36ed280d` | 审计 Web CI 路径配置；无 labeler 时不新建 | W9 |
| `c98cc3a9` | 适配 Web workflow 路径过滤 | W9 |
| `390102a2` | 适配 DeepSeek context window | W3/W4 |
| `16cc0d7f` | 适配 Claude OpenCode Go 直连 | W3 |
| `bef46cd5` | 适配 Grok Build 预设说明 | W3/W5 |
| `3c592d93` | 排除 WiX 注册表模板 | W9 |
| `967daa1a` | 适配缺失 Skill SSOT 更新检测 | W3 |
| `7de63227` | 适配 Grok Build 表单容器 | W5 |
| `bc7f5f41` | 适配 Provider 编辑器间距 | W5 |
| `8673e9d8` | 适配 Claude 高级选项层级 | W5 |
| `3711e1a0` | 适配 PPIO 预设 | W5 |
| `7e152d75` | 适配模型映射模糊搜索 | W5 |
| `076c2744` | 适配模型下拉收口 | W5 |
| `95b95da6` | 适配 OpenClaw 模型编辑器 | W5 |
| `619a592c` | 适配 Claude Desktop 表单框架 | W5 |
| `5b77da2b` | 适配 OpenClaw User-Agent 层级 | W5 |
| `c0050623` | 适配 checkbox 样式 | W5 |
| `58d92e56` | 适配 JieKou AI 预设 | W5 |
| `ec842156` | 适配 OpenCode 表单层级 | W5 |
| `ccc86298` | 适配路由激活动效 | W5/W6 |
| `580a4d7b` | 适配 Hermes 表单层级 | W5 |
| `7e5007d5` | 适配 Claude Desktop 模型模式说明 | W5 |
| `1f38c838` | 适配 Zhipu `CREDIT_LIMIT` | W2 |
| `dfb2e523` | 适配 SQL fidelity 与恢复安全 | W1 |
| `c9fe340b` | 适配 WebDAV/公共同步一致性 | W1 |
| `d2b070c9` | 适配 Codex takeover restore 登录保护 | W2 |
| `c8262476` | 适配 Kimi reasoning 负向规则 | W2 |
| `7dc0a725` | 适配最终定价修复与新增模型 | W4 |
| `5602324b` | 适配 DeepSeek catalog 尖括号文本 | W4 |
| `5f6072ce` | 适配移除 Provider 星标 | W5 |
| `c99550e0` | 适配 RunAPI 新域名与 fallback | W5 |
| `a7f073e9` | 适配 FennoAI 应用内信息；不复制上游 README 赞助段 | W5/W9 |
| `5b8bf1fe` | 适配 Volcengine 双 Plan 预设 | W5 |
| `eb69e492` | 适配 XycAi 跨应用预设 | W5 |
| `6a7da87c` | 适配 Grok Build input token 明细 | W2 |
| `d9d4a660` | 适配 IME-safe input | W5 |
| `f748f3ac` | 适配 Grok Build/Codex 表单一致性 | W5 |
| `84e75ad2` | 适配 Pi 原生应用核心 | W7 |
| `40d747c0` | 适配 Pi session usage 与去重账本 | W8 |
| `40cac1a6` | 适配 Codex 每模型推理档位 | W4 |

合计：`5 + 14 + 26 + 43 = 88` 个提交。

## 10. 执行记录

- 2026-08-15：完成只读上游审计，确认 Web 基线 `30409878`、上游目标 `40cac1a6`、完整差距 88 个提交。
- 2026-08-15：确认本轮按完整任务推进，Pi、修复、功能、预设和文档均纳入；仅排除无 Web 产品语义的桌面壳与上游仓库身份内容。
- 2026-08-15：完成本文，尚未修改业务代码、Schema、README 或 changelog，尚未运行 build 和全量测试。
- 2026-08-15：完成 W0。Codex catalog 已覆盖生成、投影、反解、32 MiB 读取上限、配置目录/符号链接边界、用户目录所有权、DeepSeek/native Responses 和每模型推理档位；Web 稳定 Provider ID 继续使用 `ccswitch`。Hermes 加入主应用及 MCP/Skills 列表，应用切换器固定为图标模式且保留移动端菜单；Proxy query 收口，删除 9 个零调用旧模块。
- W0 验证：`cargo check --manifest-path backend/Cargo.toml` 通过；`codex_config::tests` 84/84 通过；catalog profile 测试 1/1 通过；`pnpm typecheck` 通过；AppSwitcher/useProxyStatus Vitest 2/2 通过。Windows 无符号链接权限时对应测试按平台条件跳过，目录词法边界及真实文件 canonicalize 测试仍执行。
- 2026-08-15：完成 W1。补齐脚本、目录遍历、Codex catalog、代理响应与解压边界；Deeplink 显示遮蔽后的用量凭据；同步上游最终 SQL dump/import、备份发布/恢复实现；Windows 使用 `ReplaceFileW`，WSL UNC 不支持时安全回退；WebDAV 快照用 Skills 全局读写锁保持 DB 与 SSOT 同一时点，下载后的 live projection 保持在同一次全局同步操作中。
- W1 验证：content encoding 15/15、usage script timeout 1/1、Grok session 9/9、Proxy body limit 1/1、Deeplink 1/1、备份模块 34/34（另 2 项性能诊断测试按设计 ignored）通过；Skills 锁、WebDAV 排队抑制、导入失败 Skills 回滚、Windows 原子替换各 1/1 通过；`pnpm typecheck` 通过。
- 2026-08-15：完成 W2。Codex session usage 对 fork timeline、交错计数、批量事务与 cursor 原子推进完成最终语义适配；Chat 转换补齐 dropped tool call 失败行为；Grok Build 固定 Responses 接管并补全 usage；Claude Desktop proxy/session 单向去重；Codex official 切换与接管恢复不再覆盖有效 ChatGPT 登录。Kimi、Zhipu 规则同步完成；Copilot 现代占位符与 `[1M]` 清理经审计已在 Web 基线存在，未制造重复实现。
- W2 验证：Codex session usage 44/44（另 1 项 ignored）、streaming/non-streaming dropped tool call 各 1/1、Grok input token details 1/1、Kimi/DeepSeek reasoning 各 1/1、Zhipu `CREDIT_LIMIT` 1/1、Grok conversation header 1/1、Grok takeover Responses 1/1、Claude Desktop/session 去重 1/1、Codex 接管恢复保留登录 1/1、陈旧第三方 auth 识别 1/1 通过；`git diff --check` 通过。
- 2026-08-15：完成 W3。Skills 安装以真实 `SKILL.md` 定位嵌套源目录并生成正确文档 URL，缺失 SSOT 不再被缓存哈希掩盖；Hermes Prompt 切换为 `SOUL.md`。OMO 支持统一 `~/.omo/omo.jsonc|json` 的 `[opencode]` 节点，保留 JSON5 注释、顺序、缩进和换行，写入前后校验语义并在并发修改时拒绝覆盖；旧 OMO 文件继续兼容。模型选择器合并隔离执行的 `opencode models` 结果，命令固定配置目录、禁用项目配置、20 秒超时。OpenCode Go 直连与 DeepSeek context window 同步完成。
- W3 验证：OMO service 25/25、Skills/Hermes/OpenCode 命令边界 6/6、Claude/Claude Desktop 预设 15/15 通过；`pnpm typecheck`、`git diff --check` 通过。
- 2026-08-15：完成 W4。Codex 的 DeepSeek 与火山 Agentplan 预设切换为 native Responses，DeepSeek context window 对齐 1048576；新增腾讯混元 TokenHub 及双端点。W0 已提前落地并验证 catalog 镜像、用户目录所有权、显式字段优先、推理档位与 `ultra` 映射，本包未重复实现。模型定价种子与精确修复函数逐字同步到上游 `40cac1a6`，仅在字段仍等于历史默认值时修复，保留用户自定义价格。
- W4 验证：定价修复回归 1/1、现有模型定价匹配 1/1、Codex 预设与 catalog 表单 Vitest 6/6 通过；`pnpm typecheck`、`git diff --check` 通过。
- 2026-08-16：完成 W5。Provider 预设同步到上游最终状态，新增 PPIO、JieKou AI、XycAi 并拆分火山双 Plan；移除已下架预设和卡片合作星标。Provider 表单复用共用模型搜索、Codex 字段和请求头编辑能力，补齐 Claude Desktop、Grok Build、OpenCode、OpenClaw、Hermes 层级；统一原生 checkbox、IME-safe input、窄屏间距和路由激活反馈。
- W5 验证：14 个定向 Vitest 文件共 92/92 通过，覆盖预设、三语键、表单 load/save、IME composition、搜索、Proxy 初始状态和 reduced-motion；`pnpm typecheck`、`git diff --check` 通过。
- 2026-08-16：完成 W6。MCP、Prompt、Skill 管理列表统一支持搜索，MCP 与 Skill 可按应用串行批量启停并汇总失败；MCP 单应用状态改为数据库单列原子更新。Auth Center 复用账号额度 query cache 展示各 ChatGPT 账号用量。应用切换器按可用宽度收纳溢出项并保持当前应用可见，页头主操作区不再被挤压；浏览器隐藏或失焦时停止状态心跳，reduced-motion 保持静态。
- W6 验证：管理列表、批量操作、账号额度、导航溢出和浏览器活动状态共 10 个定向 Vitest 文件 25/25 通过；MCP DAO 并发测试 2/2 通过；`pnpm typecheck`、`git diff --check` 通过。
- 2026-08-16：完成 W7。Pi 接入应用注册、目录、Provider、Prompts、Skills 和 Sessions；`models.json.providers` 使用 additive 原生适配并保留未知字段，不触碰 `auth.json` 或默认 Provider/Model。Pi 原生 Prompt 文件和模板使用 revision 防止陈旧覆盖，`AGENTS.md` 外部内容先备份；Proxy、failover、takeover、OAuth 和 managed account 均明确排除。前端采用精简表单与离线预设，完整 JSON 保留所有扩展字段，自定义模型不猜测能力。
- W7 验证：Pi 表单、预设、三语、目录设置、Provider 操作、应用入口、Prompts、Skills 和 Sessions 共 12 个定向 Vitest 文件 57/57 通过；Rust `pi` 过滤测试 286/286 通过，覆盖 Pi 配置、Provider、Prompt 外部修改保护、原生 Prompt 文件与 Session 边界；`pnpm typecheck`、W7 新增 Rust 文件 `rustfmt --check`、`git diff --check` 通过。
- 2026-08-16：完成 W8。Pi JSONL usage 接入统一同步调度，支持 assistant、tool result、compaction、branch summary、失败状态、追加/截断/同尺寸重写和 fork；请求 ID 与无 ID 语义哈希写入持久去重账本，明细 rollup/prune、源文件删除后恢复均不会重复计费。数据库按 Web 独立迁移链升级到 v14；账本由 SQL/WebDAV 远端载荷跳过并在本地恢复时保留。Usage 页面增加 Pi 筛选和三语数据源名称。
- W8 验证：Pi usage 15 个上游定向测试全部通过，另增源文件删除/恢复和超限文件发现各 1/1；v14 新库/升级 1/1；同步跳过与本地保留各 1/1；Pi Dashboard 筛选 1/1；`pnpm typecheck`、W8 Rust 文件 `rustfmt --check`、`git diff --check` 通过。
- 2026-08-16：完成 W9。两份 Web workflow 改由 Corepack 读取 `packageManager`，CI 路径覆盖前后端、测试、构建配置和部署输入，纯文档改动不触发重验证。保留 W1 的 Windows `ReplaceFileW`/WSL 安全回退及原子替换 Rust 平台测试，不引入依赖 Hosted Runner WSL2 状态、单次约 6 分钟且完整套件超过 50 分钟的脆弱 job。引用扫描后删除 5 个零调用前端文件、2 个废弃图标脚本及 4 个无直接调用依赖。Pi 四份上游资料整理为 Web 正式文档，CHANGELOG 与三语 README 同步完成。
- W9 验证：Corepack 解析 pnpm `10.20.0`；`pnpm install --lockfile-only --frozen-lockfile`、`pnpm typecheck` 通过；Windows 原子替换契约测试 1/1 通过；workflow、`package.json`、脚本文档与 Pi 文档 Prettier 检查通过；CI 路径、Pi 文档边界、三语关键语义、旧文件/依赖静态断言及 `git diff --check` 通过。
- 工作包提交：W0 `1defe63`、W1 `b4ca49c`、W2 `32a73cf`、W3 `f2e8f70`、W4 `56fa066`、W5 `9ba8df5`、W6 `cf2fa73`、W7 `05c170c`、W8 `884e533`；W9 由提交 `chore: 完成 W9 CI 文档与收口` 交付。
- 剩余差异：计划内 88 个上游提交均已处置；Sponsors、WiX 与 WSL2 Hosted Runner job 按既定 Web 边界排除。全量 `pnpm check`、完整 Rust 测试、Docker build/smoke 和多平台 CI 仍按本计划约束留待用户单独确认。
