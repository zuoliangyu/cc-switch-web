# Web 跟进 cc-switch v4.0.1–v4.0.25 差异清单

> 状态：批次 1a、1b、1c 已完成，1d 进行中（累计已迁移 226、部分迁移 5）；其余待迁移 359 项、不适用 168 项。需决策项已由用户确定。
> 上游：`upstream` = `git@github.com:farion1231/cc-switch.git`，只读（push URL 已置为 `DISABLED_READ_ONLY`）。
> 起点：`a189980f`（v4.0.0 之后，上一轮冻结目标）；目标：`upstream/main` = `a3eafa40`（v4.0.25，2026-11-02）。
> 范围：758 个提交（无合并提交），1097 个文件变化（+180074/−23740）。Web 起点为 `be2ba289`（3.0.0 之后）。
> 前一轮：[2026-10 迁移台账](web-parity-post-f8788719-2026-10.md)。

说明：Web 仓库与上游无共同 Git 历史，差异按“冻结基线 / 上游目标 / Web 当前”三方文件内容比较，上游 `src-tauri/src/` 对应 Web `backend/src/`。

## 1. 版本分布

| 版本 | 日期 | 提交数 | 版本 | 日期 | 提交数 |
| --- | --- | --- | --- | --- | --- |
| v4.0.1 | 2026-10-05 | 20 | v4.0.14 | 2026-10-16 | 32 |
| v4.0.2 | 2026-10-06 | 17 | v4.0.15 | 2026-10-17 | 33 |
| v4.0.3 | 2026-10-06 | 31 | v4.0.16 | 2026-10-19 | 42 |
| v4.0.4 | 2026-10-07 | 7 | v4.0.17 | 2026-10-20 | 18 |
| v4.0.5 | 2026-10-08 | 20 | v4.0.18 | 2026-10-21 | 39 |
| v4.0.6 | 2026-10-09 | 24 | v4.0.19 | 2026-10-23 | 47 |
| v4.0.7 | 2026-10-10 | 22 | v4.0.20 | 2026-10-24 | 39 |
| v4.0.8 | 2026-10-10 | 10 | v4.0.21 | 2026-10-26 | 54 |
| v4.0.9 | 2026-10-11 | 35 | v4.0.22 | 2026-10-30 | 58 |
| v4.0.10 | 2026-10-13 | 34 | v4.0.23 | 2026-11-01 | 34 |
| v4.0.11 | 2026-10-13 | 16 | v4.0.24 | 2026-11-01 | 11 |
| v4.0.12 | 2026-10-14 | 51 | v4.0.25 | 2026-11-02 | 31 |
| v4.0.13 | 2026-10-16 | 33 |  |  |  |

## 2. 关键结构差异

| 领域 | 上游 v4.0.25 | Web 当前 | 影响 |
| --- | --- | --- | --- |
| 应用类型 | `AppType` 新增 `Kimi`、`Dsh`（DeepSeek Harness）、`Agy`（Antigravity）、`Omp`（Oh My Pi），共 14 种 | 10 种（至 `Mcode`） | 后端配置/live 写入、MCP/Skills 开关、会话与用量导入、前端应用页与表单均需新增；最大一块工作量 |
| 数据库 | `SCHEMA_VERSION = 24`；v19→24：MCP `enabled_pi`、MCP/Skills `enabled_agy`/`enabled_kimi`/`enabled_dsh`、MCP `enabled_omp`、`session_log_sync.parser_state` | `SCHEMA_VERSION = 16`，自有序列 | 按 Web 自有版本号新增迁移（v16→v17 起），不复用上游编号；Web 尚无 `enabled_pi`，Pi MCP 支持也需补齐 |
| 官方账号 | 新增 `services/claude_account`（17 文件，Claude 多订阅账号切换/额度/计划）、`agy_account`、`kimi_oauth`、`dsh_account`；ChatGPT 托管账号浏览器登录、复制登录链接 | 无 | 账号中心、官方卡片绑定账号；登录暂存须写 Web 数据目录 |
| 代理 | Codex 额度耗尽前保护 `codex_quota_protection`、`upstream_guard`、`browser_guard`、`proxy/session`；Claude thinking→Gemini thinkingConfig；Copilot 原生 `/v1/messages` 透传；45 项 proxy 修复 | 无上述模块 | 核心路由逻辑，需要回归测试 |
| MCP | 按需连通性检查 `mcp_connectivity`（引入 `rmcp` 依赖）；新应用 MCP 适配 `mcp/{kimi,dsh,agy,omp,pi}.rs` | 无 | 新增 Rust 依赖与 Web API |
| 用量 | 汇率自动获取 `exchange_rates`、自选货币、柱状/面积图、列选择、侧栏 Today 标签、Kimi/DSH/Agy/Omp 会话用量导入；用量页布局重构 | 无 | 前端 + 后端；汇率需联网，需评估 Web 默认行为 |
| 会话 | Kimi 会话读取/删除、Hermes WSL 读取、Codex 压缩 rollout 读取与压缩开关 | 无 | `session_manager` 扩展 |
| 终端 | 打开终端追加参数、跳过权限提示、隔离提示、Codex 卡片打开终端 | Web 已有 `open_provider_terminal` 与会话终端 API，由服务端在本机拉起 | 可在现有 API 上扩展参数；仅服务端所在机器可见终端窗口 |
| 托盘/桌面 | 玻璃托盘面板 `tray_panel`、轻量模式、MSI/Linux 更新器、macOS 窗口 | 不适用 | 不迁移 |
| 更新说明 | `src/whats-new/*.json` 更新后摘要弹窗 | 无 | 依赖桌面更新流程；Web 可评估改为版本说明，建议不适用 |
| i18n | 新增土耳其语 `tr.json`；保留 `zh-TW.json` | 仅 zh/en/ja | 用户决定不新增语言 |
| 预设 | 57 项新增预设、移除 DIT.ai/EveryAPI/ZetaAPI 赞助预设、去除合作标识 | — | 按既有约束：不展示赞助/合作标识，按名称 A–Z 排序 |
| 依赖 | `rmcp`、`process-wrap`、`prost`、`png`、`subtle`，tokio 增加 `net`/`process`；`smol-toml` 1.6→1.9.1 | — | 桌面专属依赖（gtk/webview2/objc2）不引入 |

## 3. 文件三方比较

| 分类 | 数量 | 含义 |
| --- | --- | --- |
| 上游修改·Web 已改（需适配） | 329 | 基线、上游、Web 三方均不同，需人工合并 |
| 上游新增·Web 无 | 284 | 新模块/组件/测试/图标/whats-new |
| 上游修改·Web 无此文件 | 110 | 多为 Web 已移除或重组的桌面文件（deeplink、tray、shell、settings 分节等），需按功能映射 |
| 上游修改·Web 未改（可直接同步） | 79 | Web 与基线一致，可整文件同步后定向测试 |
| 上游新增·Web 已有同名 | 2 | `tests/components/CodexFormFields.test.tsx`、`tests/config/claudeDesktopProviderPresets.test.ts` |
| 上游删除·Web 仍有 | 1 | `src/assets/icons/app-icon.png` |
| 上游删除·Web 已无 | 5 | — |

“可直接同步”中的非测试文件：

- `backend/src/codex_state_db.rs`
- `backend/src/live/project/codex.rs`
- `backend/src/mode/contract.rs`
- `backend/src/model_capabilities.rs`
- `backend/src/proxy/media_sanitizer.rs`
- `backend/src/proxy/model_mapper.rs`
- `backend/src/proxy/opaque_state_rectifier.rs`
- `backend/src/proxy/providers/codex_compaction.rs`
- `backend/src/proxy/providers/reasoning_bridge.rs`
- `backend/src/proxy/providers/streaming.rs`
- `backend/src/proxy/providers/streaming_codex_chat.rs`
- `backend/src/proxy/providers/streaming_responses.rs`
- `backend/src/proxy/providers/transform_codex_responses_xai_sanitize.rs`
- `backend/src/proxy/providers/transform_gemini.rs`
- `backend/src/proxy/session.rs`
- `backend/src/proxy/tool_media.rs`
- `backend/src/resources/gpt5_5_template.json`
- `backend/src/services/session_usage_codex.rs`
- `backend/src/session_manager/providers/claude.rs`
- `backend/src/session_manager/providers/codex.rs`
- `backend/src/session_manager/providers/gemini.rs`
- `backend/src/session_manager/providers/hermes.rs`
- `backend/src/session_manager/providers/mod.rs`
- `src/components/CodexOauthAccountQuota.tsx`
- `src/components/CopilotQuotaFooter.tsx`
- `src/components/providers/forms/hooks/useCodexOauth.ts`
- `src/components/providers/forms/hooks/useGeminiConfigState.ts`
- `src/components/providers/forms/hooks/useHermesFormState.ts`
- `src/components/providers/forms/hooks/useManagedAccountUsers.ts`
- `src/components/providers/forms/hooks/useModelState.ts`
- `src/components/providers/forms/hooks/useOpenclawFormState.ts`
- `src/components/providers/forms/hooks/useProviderCategory.ts`
- `src/components/providers/forms/modelMetadataFill.ts`
- `src/components/providers/forms/shared/index.ts`
- `src/components/quota/quotaRules.ts`
- `src/components/sessions/reader/exportMarkdown.ts`
- `src/config/codexProviderPresets.test.ts`
- `src/config/codexProviderPresets.tokenPlanTextOnly.test.ts`
- `src/config/codingPlanProviders.test.ts`
- `src/config/jiekouProviderPresets.test.ts`
- `src/config/mcodeProviderPresets.test.ts`
- `src/config/piModelCatalog.ts`
- `src/config/piProviderPresets.ts`
- `src/config/piThinkingProfiles.ts`
- `src/config/ppioProviderPresets.test.ts`
- `src/config/presetFamilies.ts`
- `src/config/presetModelMetadata.ts`
- `src/config/presetSearchAliases.ts`
- `src/hooks/useBackupManager.ts`
- `src/icons/extracted/dmxapi.png`
- `src/lib/api/types.ts`
- `src/lib/modelMetadata.ts`
- `src/lib/modelsDev.ts`
- `src/lib/usageRange.ts`
- `src/lib/version.ts`
- `src/types/icon.ts`
- `src/types/subscription.ts`
- `src/utils/textNormalization.ts`

需适配文件按目录（前 15）：

- `src/components/providers`：43
- `backend/src/services`：38
- `backend/src/proxy`：26
- `backend/src/commands`：17
- `src/components/usage`：13
- `src/lib/api`：12
- `src/components/settings`：10
- `src/components/sessions`：9
- `backend/src/database`：9
- `backend/src/mcp`：6
- `src/lib/query`：5
- `backend/src/mode`：5
- `src/components/ui`：4
- `backend/src/session_manager`：4
- `backend/src/live`：4

## 4. 批次与处置统计

确认方法：逐项核对提交标题、涉及文件、目标文件在 Web 的三方状态（第 3 节），并检查上游区间内的新增后撤销（净效果为空按不适用处理）。按提交新增代码行与 Web 现有代码的重合度，仅 20 项超过一半已存在，且均为预设片段的偶然重合，因此无提交可直接判为“已迁移”。

| 处置 | 数量 |
| --- | --- |
| 已迁移 | 87 |
| 部分迁移 | 2 |
| 待迁移 | 507 |
| 不适用 | 162 |

| 批次 | 范围 | 依赖 | 提交数 |
| --- | --- | --- | --- |
| 1a | 预设、定价、图标；移除 ZetaAPI 等净删除项 | — | 92（已完成：87 已迁移、2 部分迁移、1 不适用、2 转入 5a） |
| 1b | 代理协议转换、流式、错误与路由守卫 | — | 56（已完成：51 已迁移、2 部分迁移、2 转入 3、1 转入 4） |
| 1c | 会话读取与用量导入（Codex/Pi/OpenCode/Grok/MiniMax/Hermes） | — | 41（已完成：38 已迁移、1 不适用、1 转入 2b、1 转入 2c） |
| 1d | MCP/Skills/同步/备份/终端/工具生命周期/深链/语言初始化 | — | 90 |
| 2a | Pi 内置 MCP；Web schema v16→v17 增加 `enabled_pi` | — | 2 |
| 2b | Kimi Code（应用、OAuth 多账号、会话与用量） | 2a | 20 |
| 2c | Antigravity（应用、账号、额度、会话用量） | 2a | 28 |
| 2d | Oh My Pi（复用 Pi 表单与会话读取） | 2a | 15 |
| 2e | DeepSeek Harness（Web/Desktop、账号、用量） | 2a | 7 |
| 3 | 官方账号：Claude 多订阅、ChatGPT 浏览器登录、复制登录链接、Copilot 托管账号 | 2b–2e | 21 |
| 4 | 模式/路由/聚合、Claude Desktop 设备级模式、Codex 额度保护 | 1b、3 | 52 |
| 5a | 供应商编辑器、表单、侧栏、应用页、关于页、自定义图标 | 2、4 | 127 |
| 5b | 用量页重构、货币与汇率、额度展示 | 1c、3 | 46 |

数据库：上游 v19→v24 的列变更映射为 Web 自有序列：v17 `mcp_servers.enabled_pi`；随后按 2b–2e 迁移顺序为 MCP/Skills 增加 `enabled_kimi`/`enabled_agy`/`enabled_dsh`、MCP 增加 `enabled_omp`；`session_log_sync.parser_state` 随 1c 加入。不复用上游编号。

## 5. 决策记录

- 2026-11-02：用户确认不新增土耳其语，Web 保持 zh/en/ja；相关 6 项提交改为不适用。
- 2026-11-02：本机“打开目录”类功能（诊断日志、已安装 Skill 目录）改为在界面显示路径并提供一键复制，不由服务端调用本机文件管理器，以兼容远程访问与 Docker 部署。

## 6. 主要不适用类别

- 上游版本号、发行说明、whats-new 摘要（含 `165622b8` 更新后摘要弹窗）、README/赞助商表、用户手册、CI 与仓库模板。
- 系统托盘及轻量模式、MSI/Linux 安装与更新器、macOS/Linux/Wayland 窗口行为、WebView2 自动填充钩子。
- 区间内新增后撤销的净空变更：EveryAPI、DIT.ai 预设，侧栏今日徽标改动。
- 赞助推广文案与排位调整；对应预设的接入数据仍按 1a 迁移，但不展示赞助身份，排序按名称 A–Z。

## 7. 提交矩阵

| 提交 | 版本 | 标题 | 批次 | 说明 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `cddb3b68` | v4.0.1 | fix(sessions): read Gemini CLI JSONL chat files (#7866) | 1c 会话/用量导入 | 1c：读取 Gemini CLI JSONL 会话文件（会话浏览与用量导入） | 已迁移 |
| `55ef871f` | v4.0.1 | perf(shell): animate the sidebar edge on the compositor instead of width (#7860) | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx`、`hooks/useSidebarCollapsed.ts` | 待迁移 |
| `30318ac7` | v4.0.1 | fix(proxy): report zero-usage response.incomplete as api_error, not max_tokens (#7868) | 1b 代理协议 | 1b：零用量 response.incomplete 报 api_error 而非 max_tokens | 已迁移 |
| `a33c156e` | v4.0.1 | fix(shell): match the sidebar's bottom divider to the one above it (#7874) | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `636e1616` | v4.0.1 | feat(opencode): mark reasoning models so OpenCode offers thinking variants | 5a 供应商与全局 UI | 5a1：OpenCode 预设的 reasoning 标记与取模型补 reasoning:true 已随 1a 迁入（预设为上游最终版本）；本批补上游预设用例 | 已迁移 |
| `df08bb15` | v4.0.1 | fix(grokbuild): use preset apiKeyUrl for the get-API-key link | 5a 供应商与全局 UI | 5a1：Grok Build 表单的「获取 API Key」链接优先用预设的 apiKeyUrl | 已迁移 |
| `f6387b86` | v4.0.1 | style(quota): put the reset-credits chevron in the countdown slot | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `259d807f` | v4.0.1 | feat(settings): add a help tip explaining the Claude Code onboarding skip | 5a 供应商与全局 UI | 需新建或映射：`components/settings/sections/AppConfigSection.tsx` | 待迁移 |
| `43077f55` | v4.0.1 | fix(usage): stop parented Codex sync from deadlocking on a poisoned cache | 1c 会话/用量导入 | 1c：带父线程的 Codex 同步遇到中毒缓存不再死锁 | 已迁移 |
| `d115fddb` | v4.0.1 | fix(codex): skip Codex state DBs on WSL paths Windows cannot lock | 4 模式/路由 | 4a：Codex 状态库在 WSL 路径（\wsl$、\wsl.localhost）上时跳过（codex_state_db_is_lockable，只告警一次）：历史迁移、还原、会话标题加载都不再卡在拿不到锁上；claude_mcp 改用 config::is_wsl_path | 已迁移 |
| `e4960bba` | v4.0.1 | test(wsl): run the WSL2 nightly as a lib suite that can pass on 9P | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `f9e2ebbb` | v4.0.1 | ci(release): fail fast on notarization rejections and missing updater signatures | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `f344af02` | v4.0.1 | ci: install the Rust toolchain pinned in rust-toolchain.toml | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `c62eab2b` | v4.0.1 | build(release): compile with 16 codegen units | — | 上游发行构建并行单元参数；Web 构建配置独立维护 | 不适用 |
| `ef633b57` | v4.0.1 | test: fix the two clippy lints in test code | 1b 代理协议 | 1b：transform_codex_chat 测试 clippy 修正；usage_stats 对应测试 Web 不存在 | 已迁移 |
| `b544bc27` | v4.0.1 | ci: run backend tests under cargo-nextest and cache deps with rust-cache | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `e95c5e68` | v4.0.1 | ci: path-filter pushes to main too, with a weekly full run | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `ee66be22` | v4.0.1 | ci(release): build macOS arches in parallel and add manual dry runs | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `d36bb7a9` | v4.0.1 | chore(release): v4.0.1 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `4804b723` | v4.0.1 | docs(release): add v4.0.1 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `92fa72c7` | v4.0.2 | fix(mcp): run the time preset with uvx mcp-server-time (#7863) | 5a 供应商与全局 UI | 5a2：MCP time 预设改用 uvx mcp-server-time 已随 1a 迁入；本批补上三语的名称与占位文案（mcp-server-time）；docs/ 用户手册不适用 | 已迁移 |
| `c2c24b8c` | v4.0.2 | fix(usage): drop the gray border inside the active range field and space the picker below the presets (#7864) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `7f3fbd06` | v4.0.2 | test(pi): pin image input on official DeepSeek V4.1 Flash preset (#7865) | 1d 资源/设置/工具 | 1d：Pi DeepSeek V4.1 Flash 图片输入断言已随 1a 的预设测试同步 | 已迁移 |
| `5c573f19` | v4.0.2 | fix(proxy): whitelist fields carried by reasoning replay envelopes (#7876) | 1b 代理协议 | 1b：推理回放信封字段白名单 | 已迁移 |
| `d455dd85` | v4.0.2 | feat(mcp): sync MCP servers to Pi 1.0's built-in MCP (#7862) | 2a Pi MCP/迁移基线 | 2a：Pi 1.0 内置 MCP 同步（mcp/pi.rs，只替换连接字段、取消勾选改为 enabled:false、拒绝 SSE/非法名/仅 -_ 差异的重名，先写文件后提交数据库）；Web 自有 schema v16→v17 增加 mcp_servers.enabled_pi，并在建表阶段为版本号不低于 v17 却缺该列的桌面端 v17–v19 快照补列；MCP 面板与表单加入 Pi 列（Skills 列顺序不变）；Hermes MCP 在 Web 仍不可用，相关改动不适用 | 已迁移 |
| `2fdcebf1` | v4.0.2 | fix(codex): let users switch back to CC Switch's model catalog when aggregation is blocked | 4 模式/路由 | 4b：聚合模型被默认那家行里的 model_catalog_json 挡住时，模式面板给出「改用 CC Switch 的模型目录」（POST /api/proxy/codex/adopt-catalog：去掉路由行指向别的文件的指针、按 op::CATALOG 强制重写、返回剩余提示）；live 指针处理与编辑器特例随后被 cad592e0 撤掉，按最终状态迁移 | 部分迁移 |
| `cad592e0` | v4.0.2 | fix(codex): treat model_catalog_json as a plain key field | 4 模式/路由 | 4b：model_catalog_json 当普通关键字段跟目标供应商走（行里自己的指针 > 生成目录时用 CC Switch 的 > 无），不再记进契约独有字段；去掉 configOwnsCatalog 提示 | 已迁移 |
| `165622b8` | v4.0.2 | feat: show a short summary of what changed after updating | — | 更新后 whats-new 摘要弹窗依赖桌面更新流程；Web 以 CHANGELOG/Release 说明版本 | 不适用 |
| `f5db60db` | v4.0.2 | feat(ui): fill the icon box with tile-style provider icons | 5a 供应商与全局 UI | 需新建或映射：`components/ProviderIconBox.tsx` | 待迁移 |
| `20222460` | v4.0.2 | docs(whats-new): add the 4.0.2 summary | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `db8069ef` | v4.0.2 | fix(codex): keep the reasoning levels column from stretching the model catalog | 5a 供应商与全局 UI | 5a1：Codex 模型目录行按上游最终形态补上思考档位列（多选档位 + 默认档位，相邻三档以上折成 first → last），列宽不被长标签撑开 | 已迁移 |
| `91765357` | v4.0.2 | feat(ui): pick fetched models into the Codex model mapping table | 5a 供应商与全局 UI | 5a1b：Codex 模型列表标题上的「获取模型列表」打开同一个选择弹窗，选中的模型按 ID 建行并补窗口与思考档位；行内下拉仍可换单行模型；Codex 模型列表、Claude 聚合模型、OpenCode 列表的添加按钮改为「手动添加」 | 已迁移 |
| `fe831f0a` | v4.0.2 | feat(ui): pick the provider form layout from the tab it was opened in | 5a 供应商与全局 UI | 5a1：按打开表单的模式标签（直连 / 路由 / 聚合）选表单布局；Web 没有模式标签页与聚合表单布局，表单只有一种布局 | 不适用 |
| `9ec89fe8` | v4.0.2 | feat(claude): list aggregated models through modelPicker instead of gateway discovery | 4 模式/路由 | 4c：聚合模式下 Claude Code 的 /model 改用顶层 modelPicker（replaceBuiltInOptions，每个聚合模型一行），不再写 CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY（旧契约写过的按独有字段删）；路由契约逐字节不变；floor 与前端键字段镜像加 modelPicker | 已迁移 |
| `600fdb0c` | v4.0.2 | fix(ui): drop the restart hints for Claude Code aggregation changes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx`、`components/providers/mode/ModeDialog.tsx`等 4 个 | 待迁移 |
| `08f789a8` | v4.0.2 | chore(release): v4.0.2 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `bf2fe0d0` | v4.0.2 | docs(release): add v4.0.2 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `cf567ca6` | v4.0.3 | fix(claude): project CLAUDE_CODE_AUTO_MODE_SERVER from provider env into settings.json (#7893) | 4 模式/路由 | 随 1b 提前迁移：Claude 供应商 env 中的 CLAUDE_CODE_AUTO_MODE_SERVER 投影到 settings.json，前后端关键字段镜像一致 | 已迁移 |
| `a4d07f31` | v4.0.3 | feat(ui): edit MCP and prompts in full pages and confirm before leaving unsaved editors (#7842) | 5a 供应商与全局 UI | 需新建或映射：`components/prompts/PiPromptPanel.tsx`、`components/ui/sheet.tsx`等 3 个 | 待迁移 |
| `f68fe30f` | v4.0.3 | fix(presets): default Hermes and OpenClaw MiMo presets to mimo-v2.6-pro (#7890) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3af74823` | v4.0.3 | feat(opencode): round-trip native v2 providers via JSON editor (#7579) | 1d 资源/设置/工具 | 1d：OpenCode 2.0 原生 providers 读写（JSONC 保留注释）、来源格式记入 meta、原生卡用 JSON 编辑并校验 package/模型；Web 的 live 导入只新增不更新已有行，上游依赖导入更新的后端用例未迁移；MSW 补 live 供应商 ID 夹具 | 已迁移 |
| `d4a24107` | v4.0.3 | feat(provider): add MoArk (模力方舟) provider presets (#7580) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `bc4d1a50` | v4.0.3 | fix(usage): count cache tokens in provider and model stats | 5b 用量/额度 UI | 需新建或映射：`services/sql_helpers.rs` | 待迁移 |
| `fc8d884b` | v4.0.3 | feat(quota): show the Codex Credits balance for ChatGPT subscriptions | 5b 用量/额度 UI | 需新建或映射：`services/usage_cache.rs` | 待迁移 |
| `d7f615f0` | v4.0.3 | fix(skills): deploy imported skills to every app ticked in the import dialog | 1d 资源/设置/工具 | 1d：导入 Skill 时投影到勾选但尚无该 Skill 的应用，失败的应用不记启用并汇总报错 | 已迁移 |
| `dd07b8f4` | v4.0.3 | fix(usage): show localized names for session-log usage providers | 5b 用量/额度 UI | 需新建或映射：`components/usage/providerLabel.ts` | 待迁移 |
| `14003822` | v4.0.3 | fix(proxy): respect thinking-off and per-model effort floors when mapping Claude effort | 1b 代理协议 | 1b：Claude effort 映射尊重关闭思考与模型下限；Opus 5 归入默认自适应思考 | 已迁移 |
| `6f4d365b` | v4.0.3 | fix(usage): use a short session-log label where the app is already shown | 5b 用量/额度 UI | 需新建或映射：`components/usage/providerLabel.ts` | 待迁移 |
| `c615c3ee` | v4.0.3 | feat(usage): show success rate and speed in model stats | 5b 用量/额度 UI | 需新建或映射：`components/usage/statsColumns.tsx` | 待迁移 |
| `beff557e` | v4.0.3 | feat(logging): log provider switches and routing / aggregation mode changes (#7882) | 4 模式/路由 | 4d：切换与模式日志：ProviderService::switch 记 [SWITCH]（直连 / 代理路由的去向，完成、带警告、规则拒绝记 INFO、失败记 ERROR）；进入 / 退出 / 换路由记 [MODE]（模式变化、路由那家、客户端配置有没有重写），失败日志经 error_for_log 去掉 TOML 诊断里的配置原文。前端确认框日志不适用：Web 没有前端日志通道（上游 frontendLogger 基于 tauri plugin-log） | 部分迁移 |
| `243cd9a9` | v4.0.3 | fix(proxy): satisfy the OpenCode Go gateway's client identity requirements (#7773) | 1b 代理协议 | 1b：opencode.ai 上游补 x-opencode-session（原生会话头 > 客户端会话 > 对话指纹 > 生成 ID）与缺省 UA | 已迁移 |
| `34759f69` | v4.0.3 | fix(usage): move usage-stat writes off tokio workers with spawn_blocking (#7822) | 1c 会话/用量导入 | 1c：代理用量与错误日志写入移到阻塞线程池（含计费模式读取），新增运行时不被阻塞的回归 | 已迁移 |
| `a776a3b1` | v4.0.3 | feat(skills): add a select-all checkbox to the installed list header (#7887) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `edff2d76` | v4.0.3 | fix(proxy): handle mixed LF and CRLF SSE delimiters (#7853) | 1b 代理协议 | 1b：SSE 混合 LF/CRLF 分隔 | 已迁移 |
| `04638fd4` | v4.0.3 | fix(ui): stop WebKit layout jitter on the usage page (#7901) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `eef7efdc` | v4.0.3 | fix(config): let the test home override win over the legacy HOME fallback (#7812) | 1d 资源/设置/工具 | Web 的 get_home_dir 已优先读 CC_SWITCH_TEST_HOME，且 Web 数据目录没有 v3.10.3 的 HOME 兼容回退 | 不适用 |
| `3c3b9493` | v4.0.3 | docs(contributing): document which services get a built-in provider preset | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `8569ddd7` | v4.0.3 | feat(presets): add OpenCode Zen for Claude Code and Codex | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `d68f008f` | v4.0.3 | docs(contributing): accept large established aggregators as presets | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `58a9e8e2` | v4.0.3 | fix(presets): drop the expired OpenCode Go referral code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3144c820` | v4.0.3 | feat(backup): show all backup locations and their sizes | 1d 资源/设置/工具 | 1d：设置页列出全部备份位置与大小并可删除（新增 /api/backups/locations）；路径按 Web 数据目录映射；“在文件管理器中显示”按用户决定改为复制路径 | 已迁移 |
| `146f3196` | v4.0.3 | feat(claude): add auto mode server-check toggle and default it off for gateways | 5a 供应商与全局 UI | 5a1：Claude 快捷开关新增「关闭 auto mode 服务端检查」（CLAUDE_CODE_AUTO_MODE_SERVER=0）；新增 Claude 供应商除官方与云服务商外默认写上，预设自己写了的以预设为准 | 已迁移 |
| `cac218f3` | v4.0.3 | refactor(claude): drop the Teammates quick toggle | 5a 供应商与全局 UI | 5a1：去掉 Teammates 快捷开关 | 已迁移 |
| `997a34fe` | v4.0.3 | refactor(claude): drop the max effort quick toggle | 5a 供应商与全局 UI | 5a1：去掉思考强度快捷开关（Web 原为 effortHigh，同理去掉） | 已迁移 |
| `65e79de8` | v4.0.3 | feat(claude): explain each quick toggle with a help tip | 5a 供应商与全局 UI | 5a1：快捷开关按列表渲染，每个带帮助提示，帮助按钮不切换勾选；保留 Web 的通用配置片段与 Windows 变量提示 | 已迁移 |
| `f3e3a955` | v4.0.3 | docs(manual): add the auto mode server-check toggle to the Claude quick toggles table | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `014a33a4` | v4.0.3 | chore(release): v4.0.3 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `8596a233` | v4.0.3 | docs(release): add v4.0.3 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `d35726e2` | v4.0.4 | test(hermes): batch the scan-limit fixture inserts in one transaction | 1c 会话/用量导入 | 1c：Hermes 扫描上限夹具批量插入包进事务 | 已迁移 |
| `f61dc5f5` | v4.0.4 | fix(macos): relaunch via LaunchServices so the window comes to the front after restart | — | macOS LaunchServices 重启窗口；Web 无桌面窗口 | 不适用 |
| `e09fdf04` | v4.0.4 | feat(settings): give the About card's star prompt its own dismissible strip | 5a 供应商与全局 UI | 关于页 Star 提示独立可关闭；Web 已有指向 Web 仓库的 Star 提示 | 待迁移 |
| `e0b36500` | v4.0.4 | feat(profiles): hide the project switcher by default | 1d 资源/设置/工具 | 1d：项目切换器默认隐藏（设置缺省值与前端回退均为 false） | 已迁移 |
| `5b10d199` | v4.0.4 | fix(usage): keep the speed column visible in a narrow window | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `c2282a10` | v4.0.4 | chore(release): v4.0.4 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `a29a4f38` | v4.0.4 | docs(release): add v4.0.4 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `01ee685d` | v4.0.5 | docs(release): lead with usage stats in the v4.0.4 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `5dd824c7` | v4.0.5 | docs(readme): update all four READMEs for v4.0 | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `a7f66764` | v4.0.5 | chore(github): list all ten apps in issue templates | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `a40adef3` | v4.0.5 | fix(usage): import Grok Build session usage after 60s instead of 10min | 1c 会话/用量导入 | 1c：Grok Build 会话用量沉降 60s 后导入（不再等 10 分钟守卫窗口） | 已迁移 |
| `efd236a4` | v4.0.5 | docs(manual): update the user manual for v4.0 | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `f9db9f70` | v4.0.5 | feat(codex): support GitHub Copilot managed accounts with Responses/Chat routing (#7157) | 3 官方账号 | 3c：Codex → GitHub Copilot 托管账号（按模型能力选 Responses / Chat、显式协议覆盖 codexCopilotApiFormat、Copilot 目录档、按请求实际格式整流与转换响应、Copilot 预设与表单、账号模型能力填目录）；Web 无 Copilot 优化器配置与企业版动态端点（基线前即已移除），Codex 路径按默认开启只做请求分类与 interaction ID；新增卡片的草稿投影 meta 不适用（编辑已存卡片时后端沿用其 meta） | 部分迁移 |
| `c5233fe7` | v4.0.5 | fix(apps): enable native setup for Claude Code npm installs (#7929) | 1d 资源/设置/工具 | 1d：Claude Code npm 安装放行原生 postinstall（Web 生命周期代码位于 tool_management.rs） | 已迁移 |
| `d90de1ba` | v4.0.5 | fix(updater): support Linux package auto-updates (#7620) | — | Linux 安装包自动更新；Web 无桌面更新器 | 不适用 |
| `faae0e4d` | v4.0.5 | ci(wsl): run the WSL2 nightly from a nextest archive | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `7d8004c4` | v4.0.5 | test(wsl): skip three lib tests the 9P share cannot host | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `5ae6ad38` | v4.0.5 | ci(wsl): retry flaky lib tests in the WSL2 nightly | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `36c8b87e` | v4.0.5 | fix(linux): restore Wayland title-bar controls on first show and tray re-show (#7947) | — | Wayland 标题栏控件；Web 无桌面窗口 | 不适用 |
| `3c9e430f` | v4.0.5 | fix(installer): drop ProductIcon reference from MSI shortcuts (#5952) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `e40ebb6e` | v4.0.5 | fix(codex): list explicitly configured models from hidden templates (#7925) | 4 模式/路由 | 4a：显式配置的模型生成目录行时 visibility 固定为 list，不继承缓存模板的 hide（原生官方行仍保留自己的 visibility） | 已迁移 |
| `b1752e1c` | v4.0.5 | ci(release): require deb and rpm signatures in latest.json check (#7943) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `3af55c39` | v4.0.5 | fix(codex): give the MoArk preset a model catalog and native Responses format (#7940) | 5a 供应商与全局 UI | 5a1：模力方舟预设的模型目录与 apiFormat 已随 1a 迁入；本批补 codex_config 断言与上游 moarkProviderPresets 用例 | 已迁移 |
| `02759c67` | v4.0.5 | fix(proxy): mark converted function tools as non-strict for Responses (#7717) | 1b 代理协议 | 1b：转换后的 function 工具标记为非 strict | 已迁移 |
| `5d24fdf9` | v4.0.5 | feat(usage): show all history in the all-time heatmap | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `cf02f670` | v4.0.5 | chore(release): v4.0.5 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `2db86e94` | v4.0.5 | docs(release): add v4.0.5 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `889b797d` | v4.0.6 | fix(claude): allow npm scripts in the primary update path (#7099) | 4 模式/路由 | 4d：npm 安装的 Claude 主更新命令带 npm_config_allow_scripts 等环境变量（按真实路径判断，含 system 前缀）：此前工具管理批次已迁入（anchored_command_from_paths 与 4 个用例），本批无改动 | 已迁移 |
| `66144d58` | v4.0.6 | fix(codex): expose cached-account restart notice outside Stack mode (#8006) | 4 模式/路由 | 4b：Codex 旧客户端检测不再限于聚合：文件登录换过时任何模式都查（StaleClients.auth），模式面板单独给出「可能缓存旧账号」 | 已迁移 |
| `86421718` | v4.0.6 | fix(proxy): close open content blocks before terminal events in Anthropic SSE (#7986) | 1b 代理协议 | 1b：Anthropic SSE 终止事件前关闭未结束的内容块 | 已迁移 |
| `ffffd43c` | v4.0.6 | fix(codex): keep tools in third-party compaction summary turns (#7991) | 1b 代理协议 | 1b：原生 Responses 压缩摘要回合保留工具定义并强制 tool_choice=none；Web 压缩 HTTP 回归随之更新 | 已迁移 |
| `42d47956` | v4.0.6 | ci(release): fail fast when linux deb or rpm package is missing (#7985) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `f025ee05` | v4.0.6 | docs(faq): update window controls setting path for v4 in zh/en/ja manuals (#7983) | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `b4a07943` | v4.0.6 | fix(codex): stop storing representative apiFormat for Copilot (#7972) | 5a 供应商与全局 UI | 5a1：托管 Copilot 不再存 apiFormat 代表值（旧卡保存时去掉），协议只存 codexCopilotApiFormat；Chat 专属选项按实际可能走 Chat 判断 | 已迁移 |
| `0be33a84` | v4.0.6 | fix(quota): bring back colored quota numbers and warn below 20% | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `18bdea7c` | v4.0.6 | chore(icons): update DMXAPI logo | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6760cfbb` | v4.0.6 | feat(codex): add an opt-in classic sub-agent tools toggle for aggregation | 4 模式/路由 | 4b：聚合合并目录每行写 multi_agent_version = "v1" 的设备级开关（按 6aeaeb17 最终形态 codexStackClassicTools，默认开）；[features] multi_agent_v2 强制新版时提示不生效（GET /api/settings/codex-forces-multi-agent-v2）；开关变了立即重写、失败回滚设置 | 已迁移 |
| `c37a2625` | v4.0.6 | fix(proxy): explain unreadable sub-agent tasks instead of emptying them | 1b 代理协议 | 1b：子 agent 加密任务不被整流清空；解不开时返回中性 400 并说明；原样转发流在首个非生命周期事件前暂存（Web 无首包超时配置，固定上限 10s），新增 ProxyResponse::Streamed | 已迁移 |
| `4aeaccf1` | v4.0.6 | fix(codex): unbind providers when a managed account is removed | 5a 供应商与全局 UI | 5a1：删除 ChatGPT 托管账号 / 全部登出时，在 Codex 切换锁内单事务解绑绑着这些账号的 Codex 卡（去掉 authBinding、auth 置空、旧卡补 category=official）；前端删号/登出后刷新 Codex 供应商列表；上游集成用例改为 DAO 用例 | 已迁移 |
| `449c7e78` | v4.0.6 | docs: add aggregation mode guide and update user manuals | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `1beb8fa8` | v4.0.6 | feat(ui): make the CC Switch update dot green and open About from it | 5a 供应商与全局 UI | 更新点改绿色并跳转关于页；适配 Web UpdateBadge；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `ae934663` | v4.0.6 | fix(codex): build third-party catalog entries from the bundled classic tool template | 4 模式/路由 | 4b：ProxyChat / Copilot 的第三方目录条目一律用内置经典工具模板（unified_exec），不再读 models_cache.json、不再跑 codex 取模板，去掉模板缓存 | 已迁移 |
| `c1cb531f` | v4.0.6 | feat(skills): update all Skills from the check button and list them before confirming | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `033017b0` | v4.0.6 | fix(skills): stop the import dialog from locking while discover refetches | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `8919d05c` | v4.0.6 | fix(ui): use the action color for the apps page visibility switches | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `4629ee2f` | v4.0.6 | fix(tray): show every quota tier in the app row title | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `dc93c496` | v4.0.6 | fix(codex): keep official models visible in the aggregation catalog | 4 模式/路由 | 4b：官方列表按本机在用的最新 Codex 版本取（PATH 上的 codex 与最近线程的 cli_version）；没有 visibility = list 的列表不合格，退回自带列表并提示 officialModelsOutdated（含 4a 留下的 2e20cdcb 部分） | 已迁移 |
| `c5efe0ba` | v4.0.6 | feat(providers): add a search button to the provider page header | 5a 供应商与全局 UI | 供应商页头搜索按钮依赖 SwitchModePanel 与 GeneralSection 等 UI 结构，随 5a 处理 | 待迁移 |
| `ee50c12b` | v4.0.6 | test(apps): expect the action color on the apps page visibility switches | 5a 供应商与全局 UI | 应用页可见性开关配色断言，随 5a 的开关样式改动一起迁移 | 待迁移 |
| `314968b6` | v4.0.6 | chore(release): v4.0.6 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `c2611266` | v4.0.6 | docs(release): add v4.0.6 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `ef24a019` | v4.0.7 | test(codex): skip the thread version SQLite fixture on WSL temp dirs | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `3e566a3b` | v4.0.7 | fix(pi): point Volcengine Agent Plan at its own endpoint and add Coding Plan (#8044) | 5a 供应商与全局 UI | 5a2：Pi 火山 Agent Plan 改用自己的 /api/plan/v3 端点并新增 Coding Plan 预设、对应用例此前批次已迁入，本批无改动 | 已迁移 |
| `8641cd1d` | v4.0.7 | feat(codex): read compressed session rollouts and add a compression toggle | 5a 供应商与全局 UI | 需新建或映射：`codex_rollout_file.rs`、`services/backup_storage.rs`等 5 个 | 待迁移 |
| `347c60c3` | v4.0.7 | docs(aggregation): add Codex troubleshooting for sub-agent tasks and the official quota lock | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `f264ce62` | v4.0.7 | fix(codex): run stale-client detection outside the aggregate stack view (#7892) | 4 模式/路由 | 4b：模型目录的旧客户端检测不分模式（只在默认那家自己管目录时跳过） | 已迁移 |
| `533055bb` | v4.0.7 | fix(usage): bill Claude 1-hour cache writes at the 1h rate (#7653) | 1c 会话/用量导入 | 1c：Claude 1 小时缓存写入按 1h 价计费（代理解析与会话导入） | 已迁移 |
| `3da322eb` | v4.0.7 | feat(pricing): seed Claude Sonnet 5.5 and Haiku 5.5 (#8053) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `4bbdbcdd` | v4.0.7 | fix(usage): import Codex cache-write tokens from session rollouts (#7635) | 1c 会话/用量导入 | 1c：从 Codex rollout 导入缓存写入 token 并计费；Web 无 input_token_semantics 列，写入量为 0 的 Codex 代理行一律按早期代理放行去重 | 已迁移 |
| `a0be6456` | v4.0.7 | fix(usage): keep provider stats rows distinct across apps (#8032) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `2625bcf1` | v4.0.7 | fix(opencode): preserve untouched extra-option value types on edit (#7841) | 5a 供应商与全局 UI | 5a2：OpenCode / MiniMax Code 额外选项按行合并进已存选项（mergeOpencodeExtraOptionRows）：没改的行保留原值与类型（"123"、"false"、"null" 不再被改成数字 / 布尔 / null），改名继承旧值，改名撞上已有键时拒绝；补上游 useOpencodeFormState 用例 | 已迁移 |
| `00db3eef` | v4.0.7 | fix(openclaw): preserve custom headers when toggling User-Agent (#7847) | 5a 供应商与全局 UI | 5a2：OpenClaw 开关 User-Agent 时保留自定义请求头（含导入的大小写变体，关时移除所有 UA 变体、开时只写一个规范 UA）；上游用例的 msw 改用 Web 的全局 server 与 runtime.local | 已迁移 |
| `5667b287` | v4.0.7 | fix(usage): treat explicit-zero OpenAI cache fields as unreported (#8045) | 1c 会话/用量导入 | 1c：OpenAI 缓存字段显式 0 视为未上报，继续读低顺位字段（解析、转换、流式） | 已迁移 |
| `eda410e5` | v4.0.7 | feat(settings): scroll to and highlight app configuration entries (#7934) | 5a 供应商与全局 UI | 需新建或映射：`components/settings/SettingsLayout.tsx`、`components/settings/sections/AppConfigSection.tsx` | 待迁移 |
| `84457b51` | v4.0.7 | fix(codex): keep a top-level base_url when saving a provider | 4 模式/路由 | 4a：顶层 base_url（没有 model_provider）的 Codex 行在投影时归一成 [model_providers.custom]，编辑器显示地址、保存不丢；前端 setCodexBaseUrl 在没有选路时写进选中的 custom 表，核对不过退回顶层写法 | 已迁移 |
| `69dbb307` | v4.0.7 | fix(i18n): scope unified Codex session history copy to the CLI | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `e06ba573` | v4.0.7 | fix(windows): keep non-ASCII paths out of generated batch files | 1d 资源/设置/工具 | 1d：工具安装/升级批处理先 chcp 65001；Claude 与会话启动器的非 ASCII 目录经环境变量传入、配置文件以 %%~dp0 引用（Web 的会话启动器同样适配） | 已迁移 |
| `e5b1e096` | v4.0.7 | fix(codex): tell ChatGPT workspaces of the same user apart when switching official cards | 4 模式/路由 | 4a：Codex 登录按「用户 + ChatGPT workspace」认人，同一人的 Plus / Team 是两个登录；登录暂存加版本号，旧暂存读入时按新身份重算并从官方卡行补回被合并掉的 workspace（登出不复活） | 已迁移 |
| `0fc67c3b` | v4.0.7 | fix(codex): warn about stale Codex clients on Windows without a process table | 4 模式/路由 | 4b：Windows 看不到进程表时按 daemon.pid（pid + 创建时间）判断守护进程；桌面版 / 插件退化为「上次关掉提示后目录或登录变了」（unverified），关掉提示记下当前状态（POST /api/proxy/codex/stale-clients/acknowledge），staleRevision 变了重新显示；windows-sys 加 Win32_System_Threading 特性 | 已迁移 |
| `b7d548b6` | v4.0.7 | feat(quota): let quota windows show what is used instead of what is left | 5b 用量/额度 UI | 需新建或映射：`components/quota/useQuotaDisplay.ts`、`components/settings/sections/GeneralSection.tsx` | 待迁移 |
| `e049660a` | v4.0.7 | fix(codex): explain that old third-party sessions cannot continue on the official route | 1b 代理协议 | 1b：官方路由旧第三方会话提示新建会话；对应断言 Web 无此测试 | 已迁移 |
| `fda103e9` | v4.0.7 | chore(release): v4.0.7 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `790ed800` | v4.0.7 | docs(release): add v4.0.7 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `0b8662a4` | v4.0.8 | fix(i18n): align quota help and backup hint wording with UI labels | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `1f786dad` | v4.0.8 | docs(release): expand the Codex session compression section in v4.0.7 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `74b1a98c` | v4.0.8 | fix(models): send the configured request headers when fetching OpenCode model lists (#7759) | 5a 供应商与全局 UI | 5a1：OpenCode 取模型列表带上配置的请求头 | 已迁移 |
| `315aeda7` | v4.0.8 | fix(model-fetch): honor provider header overrides when fetching models (#7760) | 5a 供应商与全局 UI | 5a1：Claude / Codex 表单取模型带上本地代理 Header 覆盖（非法或为空时不带）；Header 覆盖改了即清空已取列表、丢弃在途响应 | 已迁移 |
| `4215f7ee` | v4.0.8 | feat(settings): add an Open log button to the diagnostic log section | 1d 资源/设置/工具 | Web 服务的诊断日志写到进程标准错误（env_logger），没有 cc-switch.log 文件可定位，因此不提供日志路径复制 | 不适用 |
| `3784fd9e` | v4.0.8 | fix(ui): soften dark-mode text colors to reduce glare | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `979ce6a6` | v4.0.8 | fix(codex): find the CLI bundled with the Codex desktop app | 4 模式/路由 | 4a：取 Codex 自带模型列表时，检测不到 codex 就按桌面版自带的 CLI 兜底（macOS ChatGPT.app / Codex.app；Windows %LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe 按修改时间从新到旧），以固定参数、空 stdin、超时运行；模板候选也加入桌面版 | 已迁移 |
| `2e20cdcb` | v4.0.8 | fix(codex): explain why the official model list is unavailable | 4 模式/路由 | 4a：官方模型列表没取到时带上原因（OfficialSkip / BundledSkip），Stack 视图给出 noticeReasons，Web 模式面板逐条列出；回落后官方列表恢复时自动重写客户端。依赖 dc93c496 Outdated / 隐藏行判断的分支随 4b；上游控制器层用例改写为 Web 的判定与原因码映射用例 | 部分迁移 |
| `ed15cd01` | v4.0.8 | chore(release): v4.0.8 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `df40d53c` | v4.0.8 | docs(release): add v4.0.8 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `f88068b9` | v4.0.9 | fix(proxy): let clients reach local routing through a separate connection address (#7878) | 4 模式/路由 | 4d：设备级「连接地址」proxyClientHost 存在本机 settings.json（不进同步的库），写进客户端的代理地址（路由契约、Codex 路由表、Claude Desktop 网关、旧接管路径）客户端地址优先、否则按监听地址；保存时按新地址重写各接上路由的应用，浏览器防护也按它放行；GET/PUT /api/proxy/client-host，代理面板基础设置里编辑；docs/ 不适用 | 已迁移 |
| `c69679a2` | v4.0.9 | docs(flatpak): pass bundle flags to Tauri (#8132) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `40d19110` | v4.0.9 | fix(macOS): request local network permission (#7213) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `4cde722c` | v4.0.9 | fix(providers): avoid flicker when opening the provider editor (#8145) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `9055dd37` | v4.0.9 | fix(proxy): stop sending unmatched tool results as role=tool to Chat upstreams (#8136) | 1b 代理协议 | 1b：未匹配的工具结果不再以 role=tool 发往 Chat 上游 | 已迁移 |
| `5b708ebd` | v4.0.9 | feat(presets): add SoruxGPT presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `fec99c56` | v4.0.9 | feat(presets): add IKunCode presets and SoruxGPT/IKunCode icons | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `d25e8d54` | v4.0.9 | feat(presets): add RunToken presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `2ff37a76` | v4.0.9 | feat(codex): set a default sub-agent model and reasoning effort | 4 模式/路由 | 4b：Codex 卡的子代理模型 / 推理强度写进 config.toml 的 [agents]（清空删键、表空删表头）；模型不在映射里时提示并可加进映射；聚合模式下不写行里的子代理设置 | 已迁移 |
| `89add5de` | v4.0.9 | feat(presets): add Grok Build presets for SoruxGPT, IKunCode and RunToken | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `233310d7` | v4.0.9 | feat(presets): add OpenModel sponsor presets across ten apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `886915a7` | v4.0.9 | feat(presets): add BotCF presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c4770472` | v4.0.9 | feat(presets): add YYLX presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `4f08989a` | v4.0.9 | refactor(stack): explain the default model with a help tip instead of stars | 4 模式/路由 | 4b：上游 Stack 布局模型列表的星标改帮助提示；Web 的供应商表单没有 Stack 布局与星标，聚合模型编辑器（ClaudeAggregationModels）本来就是文字说明加「移到首位设为默认」 | 不适用 |
| `0dae89e2` | v4.0.9 | refactor(codex): move the model list out of the advanced options | 5a 供应商与全局 UI | 5a1b：Codex 模型列表移出高级选项，排在连接信息之后、默认模型之前，标题改为「模型列表」；去掉 Web 为 #6 加的「自定义模型目录」开关（be2ba289），列表常驻、留空即不生成目录，目录仍不决定是否需要路由，Chat 思考与缓存参数照旧独立；路由指南同步 | 已迁移 |
| `9f7ac1fa` | v4.0.9 | refactor(codex): make the first row of the model list the default model | 5a 供应商与全局 UI | 5a1b：有模型列表时第一行就是默认模型、不再显示默认模型框；列表为空时显示，加第一行时用当前默认模型打底；改名 / 删除第一行时 model 当场跟着变；旧卡默认模型不在第一行时显示时挪到最前、不算修改 | 已迁移 |
| `36e2ce2c` | v4.0.9 | refactor(codex): move field explanations into help tips | 5a 供应商与全局 UI | 5a1b：Codex 表单字段说明收进「?」，后果提示留在页面上；UA 与请求覆盖合成一组，开头说一次「只在路由、聚合模式下生效」。上游 Stack 布局与 Anthropic 格式专有字段 Web 的 Codex 表单没有，不适用 | 部分迁移 |
| `84ca4f00` | v4.0.9 | refactor(stack): move aggregation layout explanations into help tips | 4 模式/路由 | 4b：上游聚合表单布局说明改为帮助提示；Web 的供应商表单没有聚合布局 | 不适用 |
| `5b78fc62` | v4.0.9 | docs(flatpak): explain skipping updater artifacts without a signing key | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `e615a6f4` | v4.0.9 | refactor(forms): make provider form hints follow the app's actual mode | 5a 供应商与全局 UI | 5a1b：表单按应用实际模式提示（新增不轮询的 useAppModeView）：直连时选了要转换的格式就在格式下提示后果（正在直连用的卡：保存后请求会失败；其他卡：要先切到路由或聚合）；Codex 的 Copilot 卡单独说明恒需路由。上游聚合布局 / ModeTabs 相关部分 Web 没有，不适用 | 部分迁移 |
| `29998ed9` | v4.0.9 | fix(i18n): apply the saved language on cold start | 1d 资源/设置/工具 | 1d：拿到后端设置后用保存的语言校正首屏语言（Web 在 App 读取设置时同步，覆盖访问密钥门之后的首次加载） | 已迁移 |
| `6e7811e5` | v4.0.9 | fix(proxy): send Bearer to OpenAI-format Claude upstreams and merge stack switches | 1b 代理协议 | 1b：OpenAI 格式 Claude 上游一律 Bearer、聚合成员兼容开关按性质合并、表单仅 Anthropic/Copilot 显示认证字段；Codex 主推理强度选择器依赖 Web 尚无的子代理表单字段，转入 5a | 部分迁移 |
| `f59bba54` | v4.0.9 | refactor(forms): move Claude form explanations into help tips | 5a 供应商与全局 UI | 5a1b：Claude 表单的地址、上游格式、认证字段、模型映射、默认兜底模型说明收进「?」；后果只在适用时显示（第三方端点直连时 Haiku 档没填、路由时兜底模型没填）；UA 与请求覆盖共用一组说明，Copilot 卡不显示 | 已迁移 |
| `56731456` | v4.0.9 | refactor(forms): shorten the legacy provider fields notice | 5a 供应商与全局 UI | 5a1：缩短「旧字段不随切换生效」文案；Web 的旧字段面板本来就是一句话、不带计数 | 不适用 |
| `1e045d2e` | v4.0.9 | refactor(forms): move the full URL toggle into advanced options | 5a 供应商与全局 UI | 5a1b：完整 URL 开关从地址栏旁移到 Claude / Codex 的高级选项（共用 FullUrlToggle），开着时高级区自动展开；托管账号卡没有这个开关 | 已迁移 |
| `28ee933c` | v4.0.9 | refactor(claude-desktop): explain the model mode in plain words | 5a 供应商与全局 UI | 5a2：Claude Desktop 接入方式说明改成一句白话（modelModeHint 取代 On/Off 两条提示） | 已迁移 |
| `ac2eebc0` | v4.0.9 | revert(forms): drop the Codex main reasoning effort picker | 5a 供应商与全局 UI | 5a1：撤掉 Codex 主推理强度选择器；该选择器（6e7811e5）在 Web 从未迁入，一增一删相抵 | 不适用 |
| `1afa90af` | v4.0.9 | fix(forms): align the thinking level picker with the model list row | 5a 供应商与全局 UI | 5a1：档位触发器与同行输入框同一套外观和行高 | 已迁移 |
| `f7244745` | v4.0.9 | feat(forms): pick fetched models in a dialog that can also remove them | 5a 供应商与全局 UI | 5a1b：取模型改为弹窗选择：拉取成功自动打开，拉过后按钮变「选择模型」、弹窗内可刷新；勾选即加入、取消勾选即移除，点「应用」才生效；配置里有、供应商没返回的模型单独列在最前。Codex、Claude 聚合模型（ClaudeAggregationModels，对应上游 ClaudeStackModelsField）、OpenCode / MiniMax Code、Kimi 全部改用；Web 没有 V7Dialog，用现有 Dialog 实现同样外壳 | 已迁移 |
| `8347e1ab` | v4.0.9 | refactor(forms): drop the fetch-count toast when the model picker opens | 5a 供应商与全局 UI | 5a1b：会打开选择弹窗的拉取不再提示「已获取 N 个模型」，Claude 模型映射与 Codex 无列表时的拉取照旧提示 | 已迁移 |
| `644b7d5c` | v4.0.9 | feat(forms): show model parameters in the picker and fill picks quietly | 5a 供应商与全局 UI | 5a1b：弹窗每行按同地址预设 + models.dev 显示窗口 · 推理 · 图片；从弹窗加入的模型补参数时不再弹补全提示 | 已迁移 |
| `2b0ec81b` | v4.0.9 | fix(codex): rewrite call_id-less tool outputs for xAI native Responses | 1b 代理协议 | 1b：xAI 原生 Responses 改写缺 call_id 的工具输出 | 已迁移 |
| `b17250a3` | v4.0.9 | feat(presets): add TokenFlux presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5e57b1ec` | v4.0.9 | chore(release): v4.0.9 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `8845b1ef` | v4.0.9 | docs(release): add v4.0.9 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `3302cc2d` | v4.0.10 | feat(presets): add NekoCode presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `04bd15c9` | v4.0.10 | fix(i18n): use 詳細オプション for the advanced options toggle in Japanese | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `28dc5198` | v4.0.10 | fix(providers): disable fade for add and edit pages (#8159) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `68122bc4` | v4.0.10 | fix(usage): honor Codex thread model settings (#8176) | 1c 会话/用量导入 | 1c：Codex 用量导入遵循线程级模型设置 | 已迁移 |
| `96d636ca` | v4.0.10 | fix(usage): stop treating empty OpenRouter credits as expired (#8175) | 1c 会话/用量导入 | 1c：OpenRouter 余额为空不再判为过期；解析拆为 parse_openrouter_balance 并校验金额 | 已迁移 |
| `99277921` | v4.0.10 | fix(settings): use confirmed directories for unrelated autosaves (#8023) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `fac8bfd8` | v4.0.10 | fix(installer): don't recreate a deleted desktop shortcut on MSI upgrade | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `98222d19` | v4.0.10 | fix(deeplink): stop losing links on cold start and tighten import checks | 1d 资源/设置/工具 | 1d：深链导入检查收紧（解析阶段拒绝 configUrl，Web 不再拉取远程配置；提示词接受 mcode；MCP apps 接受 grokbuild/hermes/mcode，Web 的 McpApps 无 pi 未加；立即切换时提示供应商启用；按解析序号丢弃过期合并结果）；冷启动暂存、系统协议投递、托盘刷新不适用 | 部分迁移 |
| `450bc039` | v4.0.10 | feat(deeplink): enable imported usage scripts by default | 1d 资源/设置/工具 | 1d：深链带用量脚本时默认启用用量查询，usageEnabled=false 仍生效 | 已迁移 |
| `11e1326b` | v4.0.10 | fix(deeplink): keep a Codex link's provider config instead of rebuilding a fixed template | 1d 资源/设置/工具 | 1d：Codex 深链配置按白名单保留（tomlLink.ts），路由统一为 custom，model_catalog_url 须与 endpoint 同源，拒绝 auth/aws/gateway_oauth/env_http_headers | 已迁移 |
| `c63c702c` | v4.0.10 | fix(proxy): bump the Claude Code haiku alias to claude-haiku-5-5 | 1b 代理协议 | 1b：Claude Code haiku 别名升级为 claude-haiku-5-5 | 已迁移 |
| `db93ac20` | v4.0.10 | fix(grokbuild): point session_summary at the active provider and keep a link's model profile | 1d 资源/设置/工具 | 1d：Grok Build 深链只保留默认模型表并拒绝敏感字段；live/project/grok.rs 的 session_summary 跟随目标表 | 已迁移 |
| `e0a03184` | v4.0.10 | chore(presets): point OpenModel sign-up links at the cc-switch referral URL | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `85e574b4` | v4.0.10 | chore(presets): show YYLX as 鱼鱼连线 in Chinese | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `16e7ff1c` | v4.0.10 | feat(deeplink): let links declare the API format, import Pi providers, and leave activation to the user | 1d 资源/设置/工具 | 1d：深链供应商支持 grokbuild/hermes/pi，apiFormat 按应用换算，拒绝累加式应用的展开写法；确认框三个开关；新增 add_without_switching 与 POST /api/providers/:app 的 withoutSwitching | 已迁移 |
| `6af00ecb` | v4.0.10 | docs(deeplink): add a Chinese integration guide for site owners | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `21203803` | v4.0.10 | feat(providers): upload a custom provider icon | 5a 供应商与全局 UI | 自定义供应商图标上传与“我的图标”库；浏览器上传，存储走 Web 数据目录与备份；需新建或映射：`deeplink/mod.rs`、`deeplink/parser.rs`等 6 个 | 待迁移 |
| `23c0a63f` | v4.0.10 | fix(usage): stop treating an empty Novita balance as an expired plan | 1c 会话/用量导入 | 1c：Novita 余额为空不再判为套餐过期 | 已迁移 |
| `bee47fdf` | v4.0.10 | feat(deeplink): let provider links bring their own icon via iconUrl | 1d 资源/设置/工具 | 依赖上游 21203803 自定义图标上传（data URI 渲染/校验/备份清洗），Web 无此功能；服务端代下载另增 SSRF 面，Web 忽略 iconUrl 退回内置图标 | 不适用 |
| `7577ca95` | v4.0.10 | docs(deeplink): rework the link generator and document iconUrl | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `382c0e96` | v4.0.10 | feat(usage): add a Sub2API usage query template | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `fb719d99` | v4.0.10 | docs(usage): document the Sub2API template and add it to the link generator | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `ea1ab809` | v4.0.10 | docs(deeplink): show site owners how to wire the import button | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `502d681b` | v4.0.10 | docs: point the deep link generator to ccswitch.io and link the site owner guide | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `1a8c1ea3` | v4.0.10 | feat(i18n): lead the connection mode help with each mode's strengths | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `a0dd3b39` | v4.0.10 | feat(usage): show first-token time in stats and estimate it without routing | 5b 用量/额度 UI | 需新建或映射：`components/usage/statsColumns.tsx` | 待迁移 |
| `3d5f8471` | v4.0.10 | docs(deeplink): note that New API and Sub2API ship an import button | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `9d4aff88` | v4.0.10 | fix(codex): move sessions from the retired cc-switch-official bucket back to openai | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `0962337b` | v4.0.10 | docs(deeplink): add English and Japanese site owner guides | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `cb3c9fef` | v4.0.10 | fix(usage): left-align every usage table column and rebalance request log widths | 5b 用量/额度 UI | 需新建或映射：`components/usage/statsColumns.tsx`、`components/usage/usageTable.ts` | 待迁移 |
| `68411d82` | v4.0.10 | feat(providers): keep uploaded icons in a named "My Icons" library | 5a 供应商与全局 UI | 自定义供应商图标上传与“我的图标”库；浏览器上传，存储走 Web 数据目录与备份；需新建或映射：`commands/custom_icon.rs`、`database/dao/custom_icons.rs`等 6 个 | 待迁移 |
| `4c263a85` | v4.0.10 | docs(manual): describe My Icons in the add-provider icon section | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `db29caef` | v4.0.10 | chore(release): v4.0.10 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `90fb37ff` | v4.0.10 | docs(release): add v4.0.10 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `d9a62313` | v4.0.11 | fix(ui): panel flicker (#8201) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `dbb81ea2` | v4.0.11 | feat(apps): add tool uninstall with a confirmed plan and manual commands (#8165) | 1d 资源/设置/工具 | 1d：工具卸载（确认计划 + 手动命令）；后端 tool_uninstall 子模块与 /api/tools/uninstall-plan，生命周期 action 支持 uninstall；前端确认框/手动卸载框按 Web 现有样式改写；手动命令的宿主平台取服务端探测结果而非浏览器 UA；DeepLinkImportDialog 的激活开关初始化部分 Web 无对应状态，不适用 | 已迁移 |
| `479964f2` | v4.0.11 | fix(windows): restore user PATH for CLI lifecycle commands (#8173) | 1d 资源/设置/工具 | 1d：Windows 工具生命周期命令恢复用户 PATH（Web 位于 tool_management.rs） | 已迁移 |
| `9719b7b3` | v4.0.11 | fix(usage): skip unchanged deferred Codex rollouts (#8218) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `1ef555df` | v4.0.11 | fix(skills): show error and warning toasts for bulk failures (#8137) | 5a 供应商与全局 UI | 需新建或映射：`components/mcp/AppMatrix.tsx` | 待迁移 |
| `84464e7e` | v4.0.11 | feat(presets): add StreamLake China (Vanchin) presets and fix the intl OpenAI endpoint | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3c918cd0` | v4.0.11 | feat(presets): add AIComing presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c859026d` | v4.0.11 | feat(usage): enable coding-plan usage by default for every app | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `b13797e3` | v4.0.11 | feat(deeplink): enable coding-plan usage by default on import | 1d 资源/设置/工具 | 1d：套餐地址且无脚本时默认启用 token_plan 额度查询；适用范围沿用 Web 新建供应商规则（detectCodingPlanProviderForApp），不采用上游“所有应用”规则 | 部分迁移 |
| `3700af35` | v4.0.11 | feat(presets): add SoruxGPT Coding Plan for Claude Code and Codex | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e48b84d6` | v4.0.11 | chore(presets): move AIGoCode to the .net site and .dev API host | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6b4c09ac` | v4.0.11 | fix(mcp): show error and warning toasts for bulk failures | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c05906bb` | v4.0.11 | fix(usage): merge paginated Codex rollout pages when resolving fork parents (#8213) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `438834fe` | v4.0.11 | feat(presets): add GrooRoute Pro sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3b3c3f0b` | v4.0.11 | chore(release): v4.0.11 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `2635dfff` | v4.0.11 | docs(release): add v4.0.11 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `061d24c8` | v4.0.12 | fix(ui): keep the unsaved-changes guard when re-clicking the current page (#7900) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `866b93b4` | v4.0.12 | fix(proxy): 防止终止响应后再次发出流错误 (#8138) | 1b 代理协议 | 1b：终止响应后不再发出流错误 | 已迁移 |
| `74d43799` | v4.0.12 | fix(sync): preserve skills recovery snapshots after restore failures (#8155) | 1d 资源/设置/工具 | 1d：同步恢复失败时保留 Skills 恢复快照（archive.rs 同步到上游版本；Web 无 sync_protocol，调用点位于 webdav_sync.rs） | 已迁移 |
| `49d529fb` | v4.0.12 | fix(providers): prevent search panel from covering card actions (#8151) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c11c7cf1` | v4.0.12 | fix(proxy): say so when the upstream error body is empty (#6910) | 1b 代理协议 | 1b：上游错误体为空时明确说明 | 已迁移 |
| `b1941307` | v4.0.12 | fix(wsl): skip syscalls 9P rejects when piConfigDir targets WSL (#8249) | 1d 资源/设置/工具 | 1d：piConfigDir 指向 WSL 时跳过 9P 不支持的系统调用；config.rs 新增 is_wsl_path | 已迁移 |
| `4958863a` | v4.0.12 | fix(usage): restore speed estimates for Pi session history (#8278) | 1c 会话/用量导入 | 1c：Pi 会话历史恢复速度估算（按时间戳估算耗时）；上游请求日志表组件测试 Web 无对应文件 | 已迁移 |
| `74b98ca9` | v4.0.12 | fix(apps): follow up uninstall feedback and Windows CLI PATH (#8262) | 1d 资源/设置/工具 | 1d：卸载反馈跟进与 Windows CLI PATH（canonical 批处理路径）；Web 的 run_detected_tool_command_with_timeout 换成上游实现（补 WSL 运行与批处理路径处理） | 已迁移 |
| `c21106ff` | v4.0.12 | feat(i18n): add Turkish interface and tray localization (#8208) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `30fcd90a` | v4.0.12 | fix(apps): keep columns aligned when upgrade actions disappear (#8293) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `6a232cab` | v4.0.12 | feat(apps): choose which installation to uninstall and support current Grok layout | 1d 资源/设置/工具 | 1d：卸载时选择具体安装位置、Grok 新布局；Hermes Windows 残留提示按服务端卸载路径判断平台 | 已迁移 |
| `ae778b4f` | v4.0.12 | feat(apps): check the Node version before updating npm tools | 1d 资源/设置/工具 | 1d：升级 npm 工具前检查 Node 版本（tool_node_requirement 子模块 + 行内提示，阻止的工具不进“全部升级”） | 已迁移 |
| `31c6f574` | v4.0.12 | feat(providers): place provider search at the end of the first list row | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeTabs.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `dea297ce` | v4.0.12 | fix(i18n): use English for unsupported system languages | 1d 资源/设置/工具 | 1d：浏览器语言不在 zh/en/ja 中时使用英文 | 已迁移 |
| `d1592fb1` | v4.0.12 | feat(presets): add StreamLake for Codex and use the public KAT-Coder endpoint | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `ff443477` | v4.0.12 | feat(presets): add Ollama Cloud provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `7adbc51d` | v4.0.12 | feat(presets): add Baseten provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c85f8782` | v4.0.12 | feat(presets): add Meta Model API provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `73e07a1e` | v4.0.12 | feat(presets): add DeepInfra provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e779974c` | v4.0.12 | feat(presets): add Vercel AI Gateway provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `627e89c0` | v4.0.12 | feat(presets): add Nebius Token Factory provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `2cde53dd` | v4.0.12 | feat(presets): add Groq provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `b76b22c8` | v4.0.12 | feat(presets): add SambaNova provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `18935228` | v4.0.12 | feat(presets): add DigitalOcean provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `cc43c8ba` | v4.0.12 | feat(presets): add Hugging Face provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `ae111a4b` | v4.0.12 | feat(presets): add Microsoft Foundry provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `0a129e94` | v4.0.12 | feat(presets): add Fireworks AI provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3c2a72ca` | v4.0.12 | feat(presets): add Mistral AI provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `4bc74d02` | v4.0.12 | feat(presets): add Cloudflare AI Gateway provider presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c760c8cb` | v4.0.12 | docs(readme): remove ClaudeAPI and code0.ai sponsor entries | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `d6d46c35` | v4.0.12 | chore(presets): drop ClaudeAPI and Code0 partner flags and promotion copy | 1a 预设/定价/图标 | 1a：移除 ClaudeAPI/Code0 合作标记，同步删除三语 code0/claudeapi 推广文案 | 已迁移 |
| `c83cd728` | v4.0.12 | fix(presets): drop OpenCode presets for providers OpenCode ships built in | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3069b556` | v4.0.12 | fix(presets): hide Mistral AI routed presets and keep preset ids stable | 1a 预设/定价/图标 | 1a：Claude/Codex/Desktop 表单先编号再过滤 hidden，避免回查错位；上游 presetRows 金样测试依赖桌面分组布局，不迁移 | 已迁移 |
| `68cb364a` | v4.0.12 | test(uninstall): widen windows path resolution timeout to avoid ci flakes (#8295) | 1d 资源/设置/工具 | 1d：卸载测试放宽 Windows 路径解析超时（随测试最终版本） | 已迁移 |
| `cc81627a` | v4.0.12 | fix(usage): sync session usage at the selected auto-refresh interval (#8301) | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsagePage.tsx`、`hooks/useUsageAutoRefresh.ts`等 3 个 | 待迁移 |
| `23dc945e` | v4.0.12 | fix(opencode): add SiliconFlow provider presets (#4878) | 5a 供应商与全局 UI | 5a2：OpenCode SiliconFlow 预设此前已是上游最终版本；本批补上游 limit 完整性与 SiliconFlow 预设用例，「两个区域合成一行」用例依赖 Web 尚无的预设分组选择器（presetGroups），随 5a3 | 已迁移 |
| `f7696fa8` | v4.0.12 | feat(apps): move uninstall into a per-row overflow menu | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `e5eeb166` | v4.0.12 | fix(i18n): clarify what hiding an app in the Apps page does | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `5b6d317f` | v4.0.12 | fix(i18n): drop the community translation suffix from the Turkish option | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `453cdaf9` | v4.0.12 | chore(presets): point GrooRoute invite link to grooroute.pro | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `7a8087f6` | v4.0.12 | feat(usage): scan session logs at the selected interval while the usage page is open | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsagePage.tsx`、`hooks/useUsageAutoRefresh.ts`等 3 个 | 待迁移 |
| `e380588a` | v4.0.12 | feat(presets): add icons for Baseten, DeepInfra, DigitalOcean, Fireworks, Groq, Nebius and SambaNova | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8686c165` | v4.0.12 | feat(providers): add a Local group for local inference presets | 1b 代理协议 | 1b：本机地址（localhost/127.0.0.0/8/::1）绕过全局代理，转发、测速、流检测、模型拉取均直连；供应商单独代理仍优先。分组式预设选择器的「本地」分组依赖 5a 的 presetGroups，类别标签已随 1a 加入 | 部分迁移 |
| `d5b729a5` | v4.0.12 | feat(presets): add Ollama local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `16964d7c` | v4.0.12 | feat(presets): add LM Studio local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `936aec4a` | v4.0.12 | feat(presets): add llama.cpp local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c6263cc9` | v4.0.12 | feat(presets): add vLLM local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8b7d71c1` | v4.0.12 | feat(presets): add icons for LM Studio, llama.cpp and vLLM | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `06805090` | v4.0.12 | fix(apps): stop the Apps page layout from shifting when buttons appear | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `edf32204` | v4.0.12 | chore(release): v4.0.12 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `51ac86f1` | v4.0.12 | docs(release): add v4.0.12 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c1051f8e` | v4.0.13 | fix(codex): match quoted provider table headers when writing base_url (#8276) | 5a 供应商与全局 UI | 5a1：带引号 / 带空格的 provider 表头按规范表名比较；多行字符串里像表头或赋值的行不算；上游改 bearer token 的用例改为只核对读取（Web 表单不往 TOML 写 bearer token） | 已迁移 |
| `f318e65e` | v4.0.13 | fix(proxy): stop Chat stream converters at the DONE boundary (#8281) | 1b 代理协议 | 1b：Chat 流转换在 [DONE] 边界停止 | 已迁移 |
| `81bc1bce` | v4.0.13 | fix(usage): derive opencode session request latency from message times (#8309) | 1c 会话/用量导入 | 1c：OpenCode 会话请求耗时按消息时间推算 | 已迁移 |
| `76f99d41` | v4.0.13 | fix(cli): avoid quadratic search path deduplication (#8322) | 1d 资源/设置/工具 | 1d：工具搜索路径改用 IndexSet 去重（随 tool_management 同步到上游最终版本） | 已迁移 |
| `67d63e3e` | v4.0.13 | fix(usage): resolve paginated continuation pages for forked branch threads (#8290) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `16537fd3` | v4.0.13 | fix(codex): preserve compaction preferences in proxy config (#8339) | 4 模式/路由 | 4b：代理路由表保留路由那家的 remote_compaction 能力与「OpenAI」名字开关 | 已迁移 |
| `09237ebd` | v4.0.13 | fix(windows): avoid native CSS drag regions (#8327) | — | 桌面窗口拖拽区域；浏览器页面无窗口拖拽 | 不适用 |
| `be0a9cf0` | v4.0.13 | fix(presets): cap GPT context windows at the 272K subscription window | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6aeaeb17` | v4.0.13 | feat(codex): pick the aggregation sub-agent model and default classic tools on | 4 模式/路由 | 4b：设备级聚合设置：子代理模型与推理强度（按合并目录校验后写 [agents]）、codexStackClassicTools 默认开；Stack 视图给出 subagentModels；设置变了立即重写、失败回滚。Web 在模式面板的聚合设置区编辑；上游「切换到聚合」确认框里的子代理选择与 ModeTabs / StackSettingsSheet 外壳不迁移；docs/ 用户手册不适用 | 部分迁移 |
| `e70e844c` | v4.0.13 | feat(codex): let Auto Review use another model | 4 模式/路由 | 4b：自动审批模型：卡上 modelCatalog.autoReviewModel（只能选映射里的，写进目录行 auto_review_model_override，读回时还原）；聚合下用设备级 codexStackAutoReviewModel（按合并目录校验） | 已迁移 |
| `f9e0d537` | v4.0.13 | feat(mode): confirm before going back to direct | 4 模式/路由 | 4d：回到直连先确认：模式面板确认框写明直连那家、改写的客户端文件（Claude Desktop 为网关配置）、路由目标与队列保留 / 聚合模型消失；错误在确认框里就地显示；聚合切到路由也提示聚合模型会撤下 | 已迁移 |
| `3e9eede4` | v4.0.13 | feat(claude-desktop): move Desktop into the device-level direct/route mode | 4 模式/路由 | 4c：Claude Desktop 并入设备级直连 / 路由模式：路由模式写指向本地路由 /claude-desktop 的网关 profile，直连模式写直连那家，要经路由的卡（模型映射、托管 OAuth）在直连下拒绝（switch.desktop_needs_routing），退出路由写不进去时退回官方；退出 CC Switch 不分离 Desktop；去掉按卡片启停映射服务；接管状态带 claude-desktop；Web 模式面板对 Desktop 开放。托盘、项目 Profile 命令（Web 无 commands/profile.rs）不适用 | 部分迁移 |
| `19a3e8d4` | v4.0.13 | feat(claude-desktop): show Desktop with the shared direct/route mode panel | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/mode/SwitchModePanel.tsx`等 9 个 | 待迁移 |
| `b93bf12d` | v4.0.13 | feat(claude-desktop): support aggregation (stack) mode on the backend | 4 模式/路由 | 4c：Desktop 聚合：成员发布 claude-fable-ccs-<数字> 模型（标签「供应商 / 模型」，最多 200 条），聚合请求跳过映射表只做上游整形，解不出用 Anthropic 错误信封；/claude-desktop/v1/models 补上聚合模型；成员须可路由且映射表完整；托盘部分不适用 | 已迁移 |
| `e5508224` | v4.0.13 | feat(claude-desktop): offer aggregation mode in the Desktop panel | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/presentation.ts`等 3 个 | 待迁移 |
| `e4367db5` | v4.0.13 | fix(claude-desktop): resolve colliding aggregation ids to the listed provider | 4 模式/路由 | 4c：Desktop 聚合 id 撞号时解析到名单里列出的那一家 | 已迁移 |
| `58354f91` | v4.0.13 | fix(claude-desktop): split a legacy mapping card into route and official direct | 4 模式/路由 | 4c：启动时旧版映射卡拆成路由模式（路由到这张卡）＋直连指针改官方卡，先落定模式再改指针；Web 不预置官方卡，迁移时没有就补一行 claude-desktop-official | 已迁移 |
| `78d2517a` | v4.0.13 | fix(mode): preview the old default's models and fill in Desktop's app name | 4 模式/路由 | 4c：Stack 成员视图带 memberModels（换默认预览用）；上游 ModeDialog 的换默认预览与 {{app}} 文案修正不适用（Web 确认框只选默认供应商） | 部分迁移 |
| `7c763cf3` | v4.0.13 | fix(claude-desktop): give the back-to-direct confirmation Desktop's own notes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx` | 待迁移 |
| `35423712` | v4.0.13 | test(uninstall): borrow single paths as slices for clippy | 1d 资源/设置/工具 | 1d：卸载测试 clippy 修正（随测试最终版本） | 已迁移 |
| `eb2b0d36` | v4.0.13 | test(apps): wait for re-probed rows before Update all after a remount | 1d 资源/设置/工具 | 1d：应用页测试等待重新探测后再全部更新 | 已迁移 |
| `4214ac40` | v4.0.13 | test(usage): skip Codex parse-cache counts where files have no identity | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `ae8646c6` | v4.0.13 | test(windows): run the lifecycle failure test outside the WSL temp dir | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `b391565f` | v4.0.13 | feat(update): download the portable zip directly from the update button | — | 便携版 zip 下载更新；Web 无桌面更新器 | 不适用 |
| `894cce82` | v4.0.13 | chore(release): v4.0.13 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `4ec75e71` | v4.0.13 | docs(release): add v4.0.13 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `e7a76adc` | v4.0.13 | feat(presets): add TokenFactory sponsor presets across seven apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3d46e06c` | v4.0.13 | feat(claude): allow declaring 1M context on the Haiku tier | 4 模式/路由 | 4c：Haiku 档也能声明 1M：表单每行都有 1M 勾选、一键设置保留标记；聚合模式 Haiku 别名带 [1M] | 已迁移 |
| `31038e68` | v4.0.13 | fix(presets): pre-check 1M for presets whose models have a 1M window | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5fd57811` | v4.0.13 | fix(presets): declare 1M on Claude Desktop presets that relay Claude 5 | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `0a6eb00e` | v4.0.13 | feat(presets): add Modelflare sponsor presets across nine apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6f6eee0c` | v4.0.13 | fix(presets): restore sponsor promo copy for four sponsors | — | 赞助商推广文案/排位；Web 不展示赞助身份且按名称 A–Z 排序 | 不适用 |
| `0a8d0645` | v4.0.13 | docs(release): update v4.0.13 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `d4f2d4e4` | v4.0.14 | fix(claude-desktop): show one picker row per 1M model | 4 模式/路由 | 4c：Desktop 每个 1M 模型在选择器里只显示一行（prefer1m） | 已迁移 |
| `a756a1aa` | v4.0.14 | docs(readme): remove TokenFactory sponsor entry | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `a96e2fcc` | v4.0.14 | fix(presets): drop TokenFactory sponsor status and localize its name | 1a 预设/定价/图标 | 1a：补齐 `providerForm.presets.tokenfactory` 三语名称；赞助身份字段仅兼容不展示 | 已迁移 |
| `8c2c89e0` | v4.0.14 | feat(providers): explain and remember the folder for Open Terminal | 5a 供应商与全局 UI | 需新建或映射：`components/providers/OpenTerminalDialog.tsx` | 待迁移 |
| `e97fc33d` | v4.0.14 | fix(misc): only treat shell command-missing output as not installed in WSL probe (#8167) | 1d 资源/设置/工具 | 1d：WSL 探测只把 shell 的命令缺失输出视为未安装（tool_management.rs） | 已迁移 |
| `09bce301` | v4.0.14 | feat(pricing): seed Gemini 4 Argon (#8356) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e1864ac1` | v4.0.14 | fix(usage): make exact model pricing lookup case-insensitive (#8414) | 1c 会话/用量导入 | 1c：精确定价查询大小写不敏感 | 已迁移 |
| `8d643bde` | v4.0.14 | fix(deeplink): refresh OpenCode live state after provider import (#8382) | 1d 资源/设置/工具 | 1d：OpenCode 导入后刷新 live 供应商 ID 与 runtime-models 缓存（Pi 同步刷新） | 已迁移 |
| `c8dc9206` | v4.0.14 | fix(usage): prefer opencode streamed time for session latency (#8410) | 1c 会话/用量导入 | 1c：OpenCode 会话耗时优先用流式时间 | 已迁移 |
| `b542627c` | v4.0.14 | fix(usage): skip malformed UTF-8 parent records without hiding read errors (#8360) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `e8880e6f` | v4.0.14 | fix(version): stop false "update available" for dev-build local versions (#8398) | 5a 供应商与全局 UI | 开发版本误报更新；Web 更新提示同样基于版本比较；需新建或映射：`lib/version.test.ts` | 待迁移 |
| `daf442e5` | v4.0.14 | fix(opencode): keep Unicode-named deep-link imports editable (#8381) | 1d 资源/设置/工具 | 1d：OpenCode 导入生成 ASCII slug + 随机后缀 ID；编辑时保留旧 ID 不报不合法 | 已迁移 |
| `85ae0c7b` | v4.0.14 | refactor(usage): route usage amounts through one money formatter | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageHero.tsx`等 3 个 | 待迁移 |
| `4e20fad5` | v4.0.14 | feat(usage): show usage amounts in a chosen currency | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 5 个 | 待迁移 |
| `8f3337d9` | v4.0.14 | feat(usage): choose what the sidebar Today label shows | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 3 个 | 待迁移 |
| `0cfea5e3` | v4.0.14 | feat(usage): pick which request log columns to show | 5b 用量/额度 UI | 需新建或映射：`components/usage/requestLogColumns.ts` | 待迁移 |
| `c6daf78c` | v4.0.14 | feat(usage): remember the last view and move display choices into settings | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx`、`components/usage/rememberedChoice.ts` | 待迁移 |
| `9d83b2e8` | v4.0.14 | fix(usage): drop the ≈ mark and cap decimals on converted amounts | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `b194cc09` | v4.0.14 | feat(usage): show requests or cache hit rate in the sidebar Today label | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 4 个 | 待迁移 |
| `722042ad` | v4.0.14 | fix(presets): move SiliconFlow CN presets off the retired MiniMax M2.5 | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `25310890` | v4.0.14 | feat(icons): switch Pi to the three-color pi.dev mark | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f2906db6` | v4.0.14 | fix(proxy): round-trip Gemini thought signatures on Codex chat tool calls | 1b 代理协议 | 1b：Gemini thought signature（extra_content）在 Chat 工具调用与 Responses 调用条目间往返；Web 无 CodexChatHistoryStore，靠调用条目随历史回放携带 | 已迁移 |
| `0d326a4c` | v4.0.14 | fix(proxy): keep the underlying cause in upstream connection errors | 1b 代理协议 | 1b：上游连接错误保留原因链；Web reqwest 路径同时去掉错误文本中的 URL | 已迁移 |
| `122423ca` | v4.0.14 | fix(providers): explain why the direct provider can't be deleted while routing | 5a 供应商与全局 UI | 需新建或映射：`components/providers/presentation.ts` | 待迁移 |
| `8b4b92c6` | v4.0.14 | fix(failover): keep queue positions distinct when reordering | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `2e03d8ce` | v4.0.14 | fix(sessions): merge Windows project groups that differ only in path case | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `07a9c459` | v4.0.14 | fix(openclaw): keep the User-Agent switch in sync with JSON header edits | 5a 供应商与全局 UI | 5a2：直接编辑 OpenClaw 的 JSON 请求头时 UA 开关随之同步（接在 Web 的 handleSettingsConfigChange 之后） | 已迁移 |
| `898dd002` | v4.0.14 | fix(codex): keep retry and stream timeout keys in the proxy route table | 4 模式/路由 | 4b：代理路由表照搬路由那家的 request_max_retries、stream_max_retries、stream_idle_timeout_ms | 已迁移 |
| `83f0155f` | v4.0.14 | fix(skills): spool repo archives to disk and lift the 128 MiB download cap | 1d 资源/设置/工具 | 1d：Skill 仓库归档流式落临时文件，下载上限对齐解压预算并单列 ARCHIVE_DOWNLOAD_TOO_LARGE；前端补齐归档类错误码映射与三语文案 | 已迁移 |
| `5089eb69` | v4.0.14 | fix(proxy): fall back to Gemini's skip signature when a cached one is lost | 1b 代理协议 | 1b：Codex Chat 请求缺 Gemini thought signature 时填 skip 占位 | 已迁移 |
| `d858ab4c` | v4.0.14 | chore(release): v4.0.14 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `5de6feb4` | v4.0.14 | docs(release): add v4.0.14 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `797e0276` | v4.0.15 | fix(proxy): preserve Claude JSON session identity (#8236) | 1b 代理协议 | 1b：会话提取识别 Claude metadata.user_id 中的 JSON session_id；Web 的 Codex OAuth prompt_cache_key 仍按供应商固定，上游缓存键断言不适用 | 已迁移 |
| `7344cc37` | v4.0.15 | fix(claude-desktop): allow native providers to bootstrap local routing (#8444) | 4 模式/路由 | 4c：没存模型列表的原生直连卡可按默认档位进路由（不把默认目录存进行）；聚合成员仍要求显式映射表 | 已迁移 |
| `caf70b52` | v4.0.15 | fix(i18n): translate new Turkish uninstall strings (#8291) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `6fcbb054` | v4.0.15 | fix(sidebar): show only the numbers in the usage Today badge | — | 侧栏今日用量徽标改动已被上游撤销，净效果为空 | 不适用 |
| `24d87028` | v4.0.15 | fix(skills): stop branch fallback from masking non-404 download errors | 1d 资源/设置/工具 | 1d：Skill 下载只在 404 时换分支，其他错误直接返回并补上仓库坐标 | 已迁移 |
| `2bcf953b` | v4.0.15 | fix(tools): only reinstall Codex when --version actually exits with an error | 1d 资源/设置/工具 | 1d：仅在 --version 真正以错误退出时重装 Codex（ToolInstallation.exited_with_error） | 已迁移 |
| `8a06838d` | v4.0.15 | fix(settings): never overwrite settings.json with defaults after a failed load | 1d 资源/设置/工具 | 1d：设置文件读取失败时不再用默认值覆盖：重试读取、去 BOM、逐字段保留有效项、先备份原文件，备份失败拒绝保存；保存改为原子写 | 已迁移 |
| `dd24b1ed` | v4.0.15 | fix(icons): give the macOS app icon a white rounded-square background | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `a94b592a` | v4.0.15 | fix(usage): hide empty DeepSeek wallets when another currency has funds | 1c 会话/用量导入 | 1c：DeepSeek 有币种有余额时隐藏空钱包 | 已迁移 |
| `b570f137` | v4.0.15 | fix(forms): keep the Codex thinking level picker inside short windows | 5a 供应商与全局 UI | 5a1：档位弹层按可用高度封顶、列表内滚动 | 已迁移 |
| `5d04c12d` | v4.0.15 | fix(claude-desktop): fetch models for managed OAuth providers | 5a 供应商与全局 UI | 5a2：Claude Desktop 托管 OAuth 卡（Codex / Copilot / xAI）也能取模型并在映射行里选；未登录时提示先登录；用例按 Web 的 useManagedAuth 夹具改写 | 已迁移 |
| `c696c68f` | v4.0.15 | fix(sync): stop cutting off slow WebDAV/S3 transfers at a fixed 300s | 1d 资源/设置/工具 | 1d：WebDAV 大文件传输超时按体积放宽并增加空闲超时；Web 无 S3 传输与 sync_protocol，辅助函数放在 webdav_sync.rs | 已迁移 |
| `97daccb6` | v4.0.15 | fix(settings): keep settings when an old save left a trailing tail | 1d 资源/设置/工具 | 1d：旧版保存残留尾巴时只取开头完整对象（随 8a06838d 的最终实现一并移植） | 已迁移 |
| `ecb449f4` | v4.0.15 | fix(terminal): give Windows provider terminals the restored user PATH | 1d 资源/设置/工具 | 1d：Windows 供应商终端使用补全后的用户 PATH | 已迁移 |
| `eb09fbb1` | v4.0.15 | fix(tools): add missing exited_with_error to the Windows WSL uninstall candidate | 1d 资源/设置/工具 | 1d：Windows WSL 卸载候选补 exited_with_error（随最终版本） | 已迁移 |
| `415e8994` | v4.0.15 | fix(failover): refresh the routing marker after the proxy fails over | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `ff3e33a8` | v4.0.15 | feat(hermes): declare image input per model | 5a 供应商与全局 UI | 5a2：Hermes 每个模型可声明支持图片输入（supports_vision，关掉时删键交回 Hermes 判断）；预设与元数据填充此前已迁入 | 已迁移 |
| `93f1688a` | v4.0.15 | chore(providers): follow up on panel transition cleanup (#8260) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `afbf073b` | v4.0.15 | fix(provider): prevent card stretching and overlap during drag sorting (#8315) | 5a 供应商与全局 UI | 卡片拖拽排序防拉伸重叠，属列表 UI，转入 5a | 待迁移 |
| `ad9f0f20` | v4.0.15 | perf(usage): cache Claude pricing within each import transaction (#8226) | 1c 会话/用量导入 | 1c：Claude 会话导入在每个事务内缓存模型定价（含流式补全） | 已迁移 |
| `2bc380b2` | v4.0.15 | fix(proxy): keep Codex Responses beta marker in stack mode (#8437) | 1b 代理协议 | 1b：聚合模式发往原生 Responses 第三方时保留 x-codex-beta-features，其余身份头仍剥离 | 已迁移 |
| `d1856448` | v4.0.15 | fix(usage): count Pi subagent usage from the child session files (#8318) | 1c 会话/用量导入 | 1c：Pi 子 agent 用量从子会话文件计入；测试夹具补 TestAgentDir::at | 已迁移 |
| `d23cee4c` | v4.0.15 | fix(hermes): read live WSL databases inside their distribution (#8254) | 1c 会话/用量导入 | 1c：Windows 上 Hermes 位于 WSL 时在发行版内读取实时数据库（cfg(windows)），只读连接可见已提交 WAL | 已迁移 |
| `5cc94b8d` | v4.0.15 | fix(proxy): report routed switches without unconditional restart prompts (#8378) | 4 模式/路由 | 4d：路由下的切换返回实际生效的结果（RouteSwitchResult：remembered / route / stack 与 clientConfigChanged），POST /api/proxy/apps/:app/providers/:id/switch 返回它；只有客户端文件改写了才提示重启，路由下切换 Gemini 不再无条件提示重启；docs/ 不适用 | 已迁移 |
| `f9bc9a4f` | v4.0.15 | fix(codex): recover malformed tool-call history for Chat upstreams (#8241) | 1b 代理协议 | 1b：Codex Chat 上游的残缺工具调用历史改写为文本，避免 400 | 已迁移 |
| `2a7080f1` | v4.0.15 | fix(proxy): normalize DeepSeek tool replay in Codex Chat requests (#8351) | 1b 代理协议 | 1b：Codex Chat 请求规范化 DeepSeek 工具回放 | 已迁移 |
| `73f37c4b` | v4.0.15 | feat(usage): add bar and area chart toggle (#8439) | 5b 用量/额度 UI | 需新建或映射：`components/usage/rememberedChoice.ts` | 待迁移 |
| `17960423` | v4.0.15 | feat(usage): move the trend chart style into usage display settings | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx`、`components/usage/rememberedChoice.ts` | 待迁移 |
| `61fee943` | v4.0.15 | style(usage): lay out the Display settings as an aligned grid | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx` | 待迁移 |
| `5a3330c5` | v4.0.15 | feat(presets): add EveryAPI sponsor presets | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `0a5a2ed6` | v4.0.15 | feat(presets): add AllTokens sponsor presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8e42cb75` | v4.0.15 | chore(release): v4.0.15 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `79e754ab` | v4.0.15 | docs(release): add v4.0.15 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `73cdfbb7` | v4.0.16 | fix(i18n): improve Turkish UI wording (#8481) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `77c6dc79` | v4.0.16 | feat(tray): replace the tray menu with a glass panel (#8432) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `75e93281` | v4.0.16 | fix(proxy): allow unforced Claude WebSearch through Codex OAuth (#7936) | 1b 代理协议 | 1b：未强制的 Claude WebSearch 可经 Codex OAuth | 已迁移 |
| `adc223af` | v4.0.16 | fix(claude): use catalog ids for 5.5 upstreams in routing takeover (#8450) | 4 模式/路由 | 4c：路由接管时 5.5 上游用目录 id（live/project/claude.rs、model_mapper） | 已迁移 |
| `8d8dc456` | v4.0.16 | fix(proxy): keep Chat tool outputs contiguous across hoisted developer notices (#8445) | 1b 代理协议 | 1b：开发者提示上移后 Chat 工具输出保持连续；历史仓库补回部分 Web 无对应模块（无 CodexChatHistoryStore） | 已迁移 |
| `a94f997f` | v4.0.16 | fix(codex): honor configured GPT context windows (#8385) | 4 模式/路由 | 4a/4d：第三方镜像官方 GPT 的目录行接受显式上下文窗口等（4a）；4d 补上 handlers 层：Codex 流式 /responses 遇到上游 HTTP 400 输入超限（规整后为 context_length_exceeded）时改回 response.failed 流，Codex 能压缩历史后重试；其他错误照旧透传，没有引入通用错误规整层 | 已迁移 |
| `734c4831` | v4.0.16 | feat(minimax): add MiniMax-M3.1-Flash to the official MiniMax presets (#8518) | 1a 预设/定价/图标 | 1a：七类预设默认 M3.1-Flash 与定价已同步；Hermes 标题模型钉选（`hermes_config.rs`）转入 1d | 部分迁移 |
| `0bbbb534` | v4.0.16 | fix(hermes): prefill MiniMax provider keys that don't collide with Hermes built-ins (#8538) | 5a 供应商与全局 UI | 5a2：Hermes 选 MiniMax 预设时预填不与 Hermes 内置供应商撞名的标识（resetHermesState 带上预设 providerKey） | 已迁移 |
| `bbcf0aea` | v4.0.16 | fix(usage): show account balance when a Zhipu account has no coding plan | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `e02f3a33` | v4.0.16 | chore(presets): drop invite codes from Zhipu API key links | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `68b52851` | v4.0.16 | style(providers): restore the light-blue "Get API Key" link | 5a 供应商与全局 UI | 5a1：上游把「获取 API Key」链接改成带下划线正文后又改回浅蓝；Web 的链接一直是主色、无下划线 | 不适用 |
| `b92de269` | v4.0.16 | fix(providers): show the "Get API Key" link when editing a provider | 5a 供应商与全局 UI | 5a1：编辑已有供应商时按当前请求地址反查预设，显示其「获取 API Key」链接（链接不一致时退回官网） | 已迁移 |
| `752998a6` | v4.0.16 | feat(tray): add a setting to switch between the tray panel and the native menu | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `940f9f93` | v4.0.16 | fix(tray): follow the usage display currency and chart style in the panel | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `e003829b` | v4.0.16 | feat(tray): default the tray style to the native menu | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `e2af66ca` | v4.0.16 | feat(tray): color the mode name in the panel with its theme color | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `cd449274` | v4.0.16 | fix(env): stop reporting inherited process env vars as conflicts on Unix | 1d 资源/设置/工具 | 1d：Unix 上不再把继承的进程环境变量报为冲突（容器、终端注入的变量在应用内删不掉） | 已迁移 |
| `a8e17dd6` | v4.0.16 | perf(tray): make the panel respond instantly on hover and app switching | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `27c42fd1` | v4.0.16 | feat(tray): fade in sub panel content on app switch and close it on other items | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `b76e83c3` | v4.0.16 | fix(usage): shorten CJK four-digit axis ticks and size the Y axis to its labels | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `273d166b` | v4.0.16 | fix(tray): make the macOS panel readable over dark windows | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `8a0eddb0` | v4.0.16 | fix(codex): stop aggregated sessions from compacting on the previous provider | 4 模式/路由 | 4b：第三方路由那家的行在合并目录里也加入 Stack 的 comp_hash（按工具协议分组，补上 91fc2fcb 的路由行部分），官方路由的原生行不改 | 已迁移 |
| `3168b00f` | v4.0.16 | Revert "fix(sidebar): show only the numbers in the usage Today badge" | — | 侧栏今日用量徽标改动已被上游撤销，净效果为空 | 不适用 |
| `bb05f9d6` | v4.0.16 | fix(pricing): correct Kimi K3 and Step 5 Preview prices and seed new Qwen models | 1a 预设/定价/图标 | 1a：修正 Kimi K3、Step 5 Preview 价格并新增 Qwen；仅修复仍为旧内置值的行，Web 定价断言随之更新 | 已迁移 |
| `1e36b107` | v4.0.16 | fix(usage): recover the model name for MiniMax Code usage rows that lack one | 1c 会话/用量导入 | 1c：MiniMax Code 用量行缺模型名时从会话恢复 | 已迁移 |
| `2c2d6c43` | v4.0.16 | fix(codex): show the on-disk login in the official card's auth.json editor | 4 模式/路由 | 4a：没绑托管账号的 Codex 官方卡，编辑器 auth.json 框显示切换后盘上的登录（只读预测 predicted_auth_file）；不改直接保存则保留行里原来的 auth；上游集成测试改写为 codex_runtime_tests | 已迁移 |
| `8e51101e` | v4.0.16 | fix(claude-desktop): publish catalog ids for 5.5 targets in route mode | 4 模式/路由 | 4c：Desktop 路由模式为 5.5 目标发布目录 id | 已迁移 |
| `6c36d68a` | v4.0.16 | fix(codex): keep the ChatGPT login when CC Switch detaches from routing | 4 模式/路由 | 4a：退出时的分离（op::DETACH）不按「保留官方登录」开关删 auth.json；进入或接上代理且第三方路由旁没有登录时，把最近暂存的登录还回去，只还一次（登出不复活） | 已迁移 |
| `8b09732a` | v4.0.16 | fix(usage): don't auto-enable Volcengine plan quota without AccessKey | 1d 资源/设置/工具 | Web 套餐列表无 Volcengine/ZenMux，codingPlanEnabledByDefault 无需排除对象 | 不适用 |
| `5fa00079` | v4.0.16 | fix(icons): soften the macOS app icon tile to light grey | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `f3d9e8c6` | v4.0.16 | fix(settings): render the About card logo from the vector mark | 5a 供应商与全局 UI | 关于页 logo 改矢量；上游删除 app-icon.png，Web 仍引用 | 待迁移 |
| `3b1f11b6` | v4.0.16 | fix(detect): find fnm-managed Node CLIs on Windows | 1d 资源/设置/工具 | 1d：Windows 有效 PATH 末尾追加 fnm 默认 Node 别名目录（misc.rs 与 tool_management.rs 两处） | 已迁移 |
| `56ac4f9a` | v4.0.16 | fix(providers): let an idle card be deleted when only the stale DB current flag points at it | 1d 资源/设置/工具 | 1d：删除检查只看直连指针与代理路由，不再单独看 DB 的 is_current；上游的 Desktop 旧映射卡迁移用例依赖桌面启动迁移，未迁移 | 已迁移 |
| `eadfc151` | v4.0.16 | feat(opencode): set the default model from an added provider card | 5a 供应商与全局 UI | 从卡片设为 OpenCode 默认模型依赖 presentation.ts 与 ProviderList 结构，随 5a 处理 | 待迁移 |
| `a9a93f06` | v4.0.16 | test(skill): isolate HOME before touching the skill storage location | 1d 资源/设置/工具 | 仅调整上游 Skill 测试的 HOME 隔离顺序；对应用例 Web 没有，Web 测试已在设置存储位置前隔离 HOME | 不适用 |
| `8d7a7415` | v4.0.16 | fix(models): cap only borrowed GPT windows and warn on oversized entries | 1a 预设/定价/图标 | 1a：`lib/modelMetadata.ts` 的 GPT 窗口上限已同步；各表单的超大窗口提示组件转入 5a | 部分迁移 |
| `f3d4fe53` | v4.0.16 | fix(presets): restore 1.05M GPT windows on API-billed platforms | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `b89cccf9` | v4.0.16 | feat(presets): add AllTokens SI sponsor presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e33a0f35` | v4.0.16 | test(tray): match the opaque macOS panel fill in the style test | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `01bc780f` | v4.0.16 | feat(tray): make the tray panel the default again | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `855a2eb8` | v4.0.16 | chore(release): v4.0.16 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `f92ff0b0` | v4.0.16 | docs(release): add v4.0.16 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `91ab270e` | v4.0.17 | fix(tray): keep tray panel rows stable and fit scaled displays (#8572) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `74cf8e6f` | v4.0.17 | fix(tray): refresh DPI coordinates after cross-monitor show (#8595) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `4ea66d88` | v4.0.17 | fix(windows): remove stale portable marker during MSI installation (#8529) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `8cfe5644` | v4.0.17 | fix(usage): count Codex compaction usage from token_usage_record (#8479) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `9be88e3e` | v4.0.17 | fix(provider-form): stop macOS from capitalizing typed API keys | 5a 供应商与全局 UI | 5a1：API Key 输入框关闭自动纠错、自动大写与拼写检查 | 已迁移 |
| `099c9761` | v4.0.17 | fix(tray): align quota bars and show time until reset | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `7e97b44f` | v4.0.17 | feat(tray): mark the balance amount in panel quota lines | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `c42e3067` | v4.0.17 | feat(tray): show remaining balances in green in the tray panel | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `2dfc848f` | v4.0.17 | fix(proxy): stop child processes from inheriting the listener socket on Windows | 1b 代理协议 | 1b：mio 升级到 1.2.1，Windows 监听 socket 不被子进程继承；新增 Windows 回归 | 已迁移 |
| `5cbe6700` | v4.0.17 | fix(webdav): upload the sync manifest as application/octet-stream | 1d 资源/设置/工具 | 1d：WebDAV 同步清单以 application/octet-stream 上传 | 已迁移 |
| `1f1becfb` | v4.0.17 | fix(toml): only normalize smart quotes used as string delimiters | 5a 供应商与全局 UI | 5a1：只把作为字符串定界符的弯引号 / 全角引号规整成 ASCII | 已迁移 |
| `95693d6c` | v4.0.17 | fix(codex): don't give an expired stashed login back to the proxy | 4 模式/路由 | 4a：进入/接上代理时不还 access_token 已过期的暂存登录，它留在暂存里，切回官方卡时照常还 | 已迁移 |
| `52e87344` | v4.0.17 | fix(mcp): project url-only servers without a type to Hermes and OpenCode | 1d 资源/设置/工具 | 1d：无 type 但有 url 的 MCP 服务器按 http 投影到 OpenCode（与 Codex 共用 spec_transport_type）；Web 不写 Hermes MCP | 已迁移 |
| `cf312f6a` | v4.0.17 | fix(mcp): take the app's switch lock before toggling a server | 1d 资源/设置/工具 | 1d：切换 MCP 应用启用前先拿该应用的切换锁，避免并发写丢条目 | 已迁移 |
| `73adfaf0` | v4.0.17 | fix(tray): release the tray panel WebView in lightweight mode | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `f460410f` | v4.0.17 | feat(hermes): warn when a provider key is a Hermes built-in provider id | 5a 供应商与全局 UI | 5a2：Hermes 供应商标识是内置供应商 ID 时在字段下警告（标识已锁定的旧卡提示重新添加）；新增 hermesBuiltinProviderIds 与用例 | 已迁移 |
| `e172f37d` | v4.0.17 | chore(release): v4.0.17 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `19798e2f` | v4.0.17 | docs(release): add v4.0.17 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c7dceb80` | v4.0.18 | feat(agy): integrate Antigravity CLI management (#8268) | 2c Antigravity | 2c：Antigravity CLI 管理（agy_config、AppType::Agy、MCP/技能/提示词、供应商只存库不写 live、会话与用量；Web schema v19 enabled_agy）；#8268 旧启动器清理函数 Web 从未安装，保留为 dead_code | 已迁移 |
| `3854c613` | v4.0.18 | refactor(agy): launch API-key providers from the terminal instead of a shell wrapper | 2c Antigravity | 2c：API Key 供应商经终端启动（Unix 环境变量写 0600 临时文件 source 后删除；Windows set 行），复用 Web 的 launch_terminal_command | 已迁移 |
| `b667b00a` | v4.0.18 | feat(agy): show the model on cards and attribute session usage to it | 2c Antigravity | 2c：卡片显示模型（extractAgyModel），会话用量按模型归属 | 已迁移 |
| `dfe10081` | v4.0.18 | feat(agy): share prompts with key profiles, resume key sessions, price usage | 2c Antigravity | 2c：Key 配置共享提示词、Key 会话恢复（agy_direct::key_resume_target）、用量计价；Web 原本只精确匹配定价，一并移植上游的候选匹配（去命名空间、日期/版本/推理档后缀、前缀匹配） | 已迁移 |
| `1b4cd547` | v4.0.18 | feat(agy): show the signed-in quota on the official card | 2c Antigravity | 2c：官方卡显示登录账号额度（订阅额度 tool=agy） | 已迁移 |
| `94126795` | v4.0.18 | fix(agy): show only the typed prompt in sessions and describe the quota check | 2c Antigravity | 2c：会话只显示用户输入的提示词；用量脚本弹窗按 Gemini 读 agy 凭据 | 已迁移 |
| `2e22ca20` | v4.0.18 | feat(agy): give Antigravity its own icon and manage the CLI on the Apps page | 2c Antigravity | 2c：Antigravity 图标（内联 SVG）与 Apps 页 CLI 安装/升级/卸载（后端生命周期已在 1d 随上游最终版就位） | 已迁移 |
| `fb91155a` | v4.0.18 | fix(agy): accept the empty mcp_config.json agy creates on first run | 2c Antigravity | 2c：接受 agy 首次运行生成的空 mcp_config.json（mcp/agy.rs 上游最终版） | 已迁移 |
| `9a10e4f7` | v4.0.18 | feat(agy): replace the enable button with Open Terminal | 2c Antigravity | 2c：卡片主按钮由「启用」改为「打开终端」；上游的 OpenTerminalDialog（选终端/目录）随 5a 处理，Web 直接调用服务端打开终端 | 部分迁移 |
| `c776fd0e` | v4.0.18 | feat(agy): trim the form hint and require a key on custom cards | 2c Antigravity | 2c：表单提示精简，自定义卡要求 Key（EndpointField 增加 required/help） | 已迁移 |
| `1ef08d5e` | v4.0.18 | fix(windows): stop in-app updates from rebooting the machine (#8628) | — | MSI 应用内更新重启；Web 无安装器 | 不适用 |
| `c1fd26bd` | v4.0.18 | fix(ui): show compact mode-colored connection badge in header (#8634) | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeTabs.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `ab5d4a12` | v4.0.18 | fix(ui): trim redundant provider and settings helper copy (#8633) | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/StructuredOptionsEditor.tsx` | 待迁移 |
| `cdfdff5e` | v4.0.18 | fix(installer): make Windows desktop shortcut optional (#8601) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `92ec18d7` | v4.0.18 | docs(aggregation): correct the workaround for the exhausted-quota lock | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `711a4127` | v4.0.18 | fix(usage): only list apps shown on the Apps page in the app filter | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `fdbac61c` | v4.0.18 | feat(agy): manage Antigravity official accounts in the Auth Center backend | 2c Antigravity | 2c：授权中心 Antigravity 官方账号后端（Web 单例管理器 + /api/auth 统一接口）；切号依赖 macOS 钥匙串，浏览器登录回调落在服务端本机，仅服务端为 macOS 且浏览器在同机时可用，其他平台前端隐藏该分组 | 部分迁移 |
| `86271879` | v4.0.18 | feat(agy): add an Antigravity group to the Auth Center | 2c Antigravity | 2c：授权中心 Antigravity 分组（无用户码的浏览器登录，显示提示与「重新打开登录页」） | 已迁移 |
| `0af8b772` | v4.0.18 | feat(agy): bind official cards to an Antigravity account | 2c Antigravity | 2c：官方卡绑定 Antigravity 账号（AgyAccountSelect，authBinding agy_oauth） | 已迁移 |
| `81634602` | v4.0.18 | fix(pricing): price deepseek-v4.1-flash as V4.1 Flash | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5a08e230` | v4.0.18 | feat(agy): query each Antigravity account's quota directly | 2c Antigravity | 2c：按账号直接查询额度（/api/auth/agy/quota?accountId=） | 已迁移 |
| `8f9525b0` | v4.0.18 | fix(agy): explain why an account is not eligible for Antigravity | 2c Antigravity | 2c：说明账号不具备 Antigravity 资格的原因（quota.rs 上游最终版） | 已迁移 |
| `c0490b05` | v4.0.18 | feat(agy): show each account's quota in the Auth Center | 2c Antigravity | 2c：授权中心每个账号显示额度 | 已迁移 |
| `2c63012b` | v4.0.18 | perf(agy): query the signed-in account's quota without starting agy | 2c Antigravity | 2c：不启动 agy 查询登录账号额度 | 已迁移 |
| `997e78b5` | v4.0.18 | feat(agy): show the bound account's quota on official cards | 2c Antigravity | 2c：官方卡显示绑定账号额度（AgyOfficialQuotaFooter，仅 agy 官方卡需要 QueryClient） | 已迁移 |
| `276eff8d` | v4.0.18 | feat(agy): open all four quota windows from the card's quota column | 2c Antigravity | 2c：卡片额度列合并成组时整列做成下拉列出四档（Web 无「剩余/已用」显示切换，tierBreakdown 去掉 display 参数；Web 无 emphasis 着色，整段按档上色） | 已迁移 |
| `e91689f2` | v4.0.18 | fix(agy): drop the Antigravity-only note on the usage page | 2c Antigravity | 2c：用量页不显示 Antigravity 专属说明（Web 从未加入该说明与键，无需改动） | 已迁移 |
| `6fabe63a` | v4.0.18 | fix(agy): show Antigravity session-log rows as "Session log" | 2c Antigravity | 2c 顺延 5b：Antigravity 会话日志行显示为「会话日志」依赖 components/usage/providerLabel.ts，随 dd07b8f4/6f4d365b 一并迁移 | 待迁移 |
| `e59252ee` | v4.0.18 | feat(presets): promote EveryAPI to a full sponsor | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `8d4ec90f` | v4.0.18 | chore(presets): remove ZetaAPI sponsor and presets | 1a 预设/定价/图标 | 1a：九类预设移除 ZetaAPI，删除三语推广文案；Web 原本未登记其图标 | 已迁移 |
| `0a41250d` | v4.0.18 | feat(presets): add DIT.ai sponsor presets across nine apps | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `132ab9ce` | v4.0.18 | feat(presets): add hao.ai sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e1821b5e` | v4.0.18 | fix(codex): hide reset countdown for unused quota windows (#8631) | 4 模式/路由 | 4a：Codex 额度窗口已用为 0 时不显示重置倒计时 | 已迁移 |
| `ea8bc2c3` | v4.0.18 | fix(sessions): group a Claude session by its last /cd location (#8643) | 1c 会话/用量导入 | 1c：Claude 会话按最后一次 /cd 位置分组 | 已迁移 |
| `6226f5c4` | v4.0.18 | fix(terminal): stop waiting for the launched console to close on Windows | 1d 资源/设置/工具 | 1d：Windows 启动终端后不再等待控制台关闭 | 已迁移 |
| `47ffdff8` | v4.0.18 | fix(apps): give runtime CLI commands the login-shell PATH on Unix | 1d 资源/设置/工具 | 1d：Unix 上运行时 CLI 命令补上登录 shell 的 PATH（tool_management 的 login_shell_path 供 misc.rs 复用） | 已迁移 |
| `04d0ebf5` | v4.0.18 | fix(app): raise the open-file soft limit at startup on Unix | 1d 资源/设置/工具 | 1d：Unix 上服务启动时把打开文件软上限提到硬上限（封顶 10240），放在 run_web_server_with_options | 已迁移 |
| `4aec1aec` | v4.0.18 | chore(release): v4.0.18 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `cb90a244` | v4.0.18 | docs(release): add v4.0.18 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `e4873bc8` | v4.0.19 | feat(kimi): add Kimi Code support (#8687) | 2b Kimi Code | 2b：Kimi Code 应用（AppType::Kimi、kimi_config/kimi_session、MCP/Skills/提示词/会话/用量导入、供应商服务、工具生命周期）；Web schema v17→v18 增加 enabled_kimi；Kimi 不支持连通性测试；深链只在 MCP 中接受 kimi（同上游） | 已迁移 |
| `7da25538` | v4.0.19 | feat(kimi): add official OAuth login and provider switching (#8710) | 2b Kimi Code | 2b：Kimi 官方设备登录与切换；Web 以 /api/auth/kimi/* 路由代替 Tauri 命令，管理器为进程级单例 | 已迁移 |
| `07265bc9` | v4.0.19 | feat(kimi): support multiple official accounts in Auth Center (#8726) | 2b Kimi Code | 2b：授权中心多个 Kimi 官方账号；Web 授权中心加入 Kimi 组 | 已迁移 |
| `79ba7982` | v4.0.19 | feat(usage): restructure the usage page layout (#8711) | 5b 用量/额度 UI | 需新建或映射：`components/usage/ChecklistMenu.tsx`、`components/usage/RequestLogColumnsMenu.tsx`等 10 个 | 待迁移 |
| `91fc2fcb` | v4.0.19 | fix(codex): split the stack comp_hash by tool protocol | 4 模式/路由 | 4a：合并目录里 Stack 成员行的 comp_hash 按工具协议分组（code_mode_only 镜像行为 cc-switch-code_mode_only，direct 行仍为 cc-switch）；路由行统一 comp_hash 属 8a0eddb0，随 4b | 部分迁移 |
| `ce098caf` | v4.0.19 | fix(about): detach the shell version probe from the controlling terminal | 1d 资源/设置/工具 | 1d：shell 版本探测脱离控制终端（tool_management.rs） | 已迁移 |
| `0640c6fc` | v4.0.19 | fix(codex): never turn image input off when filling fetched model metadata | 5a 供应商与全局 UI | 5a1：填取到模型元数据时不把图片输入关掉（modelMetadataFill 此前批次已是上游最终版本） | 已迁移 |
| `e88ff540` | v4.0.19 | test(usage): scope Codex parent-cache count assertions to each test's dir | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `cdd2190d` | v4.0.19 | feat(kimi): identify, remove and show quota for official accounts | 2b Kimi Code | 2b：识别、移除、显示官方账号额度；账号组支持逐行删除文案与不可删原因 | 已迁移 |
| `e12415b5` | v4.0.19 | refactor(providers): move OpenCode/OpenClaw set-default into the more menu | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `c49c2be9` | v4.0.19 | refactor(kimi): render Auth Center accounts with the shared account group | 2b Kimi Code | 2b：Kimi 账号用共享账号组渲染（Web 账号组新增 defaultLabel/setDefaultLabel） | 已迁移 |
| `44e0fc96` | v4.0.19 | feat(kimi): name separate official accounts "Kimi 订阅 <nickname>" | 2b Kimi Code | 2b：独立官方账号命名为“Kimi 订阅 <昵称>”；Web 无托盘，按设置里的界面语言取文案 | 已迁移 |
| `d6a23241` | v4.0.19 | feat(kimi): give provider cards real add/remove actions | 2b Kimi Code | 2b：卡片“添加/移除”真实动作；Web 沿用 OpenClaw 式卡片：添加只写 config.toml，设为默认走切换，仍在 Kimi 中的官方卡不能直接删除、不能复制 | 已迁移 |
| `7cc3141c` | v4.0.19 | style(providers): mark additive default providers in blue | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `f4e9211a` | v4.0.19 | fix(panel): let Escape close only the topmost full-screen panel | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `29f8bef3` | v4.0.19 | fix(usage): clamp the request log page when the total shrinks | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `c6f85464` | v4.0.19 | style(usage): restore the original trend chart and heatmap colors | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `1c52fa91` | v4.0.19 | fix(providers): reread additive client state when a removal is refused | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `93e33d11` | v4.0.19 | fix(apps): drop the redundant not-installed error line under uninstalled tools | 1d 资源/设置/工具 | 1d：未安装工具下方不再重复显示未安装错误行（tool_management.rs） | 已迁移 |
| `b61e2767` | v4.0.19 | feat(kimi): fetch the model list and fill parameters from models.dev | 2b Kimi Code | 2b：拉取模型列表并按 models.dev 补参数（fillKimiModel、useModelMetadataFill silent 选项）；上游的弹出式选择器（带参数预览）随 5a，Web 用“获取模型”按钮 + 内联勾选 | 部分迁移 |
| `535d1283` | v4.0.19 | fix(models): match old OpenCode Zen/Go addresses to the moved models.dev entries | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8969264b` | v4.0.19 | feat(kimi): explain the less obvious model capabilities | 2b Kimi Code | 2b：模型能力说明（表单最终版本） | 已迁移 |
| `b96ff618` | v4.0.19 | feat(kimi): move request headers into collapsible advanced options | 2b Kimi Code | 2b：请求头收进可折叠高级选项（表单最终版本） | 已迁移 |
| `d6db0c75` | v4.0.19 | fix(providers): stop the advanced options toggle from jumping when pressed | 2b Kimi Code | 高级选项按钮按下时的缩放跳动：Web 的 Button 无按压缩放，Kimi 表单取最终版本 | 不适用 |
| `0f768290` | v4.0.19 | feat(kimi): lay out the provider editor like Pi and OpenCode | 2b Kimi Code | 2b：Kimi 编辑器布局同 Pi/OpenCode（表单最终版本） | 已迁移 |
| `1e2559ef` | v4.0.19 | feat(pi): always show the provider key and flag duplicates | 5a 供应商与全局 UI | 5a2：Pi / omp 新增时标识与已有卡重复即在字段下提示并拦住保存；Web 的 Pi 表单本来就总显示标识（预设填好可改），「预设也显示标识」无需改动 | 部分迁移 |
| `03707c40` | v4.0.19 | style(pi): use the shared required-field asterisk | 5a 供应商与全局 UI | 5a2：Pi 表单的标识、名称与模型的 ID / 显示名称 / 上下文窗口 / 最大输出改用共用的 REQUIRED_LABEL 星号 | 已迁移 |
| `717172bd` | v4.0.19 | chore(presets): point DIT.ai links at the ccswitch referral URL | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `069c7fac` | v4.0.19 | feat(presets): add BuyToken sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `91d3ed10` | v4.0.19 | feat(presets): add V-API sponsor presets across nine apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e85ade71` | v4.0.19 | chore(presets): swap the FluxA TokenPlan and Shengsuanyun sponsor positions | — | 赞助商推广文案/排位；Web 不展示赞助身份且按名称 A–Z 排序 | 不适用 |
| `c8f85674` | v4.0.19 | fix(mcp): render server display name in unified MCP panel (#8692) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `52652a02` | v4.0.19 | fix(sessions): make the project group header clickable across the row (#8709) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `2e1e2979` | v4.0.19 | fix(proxy): recognize Codex session header aliases (#8718) | 1b 代理协议 | 1b：识别 Codex 会话头别名 session-id/thread-id | 已迁移 |
| `c3ad9bb0` | v4.0.19 | fix(model-fetch): try compatible-mode models endpoint for /apps/anthropic base URLs (#8755) | 1d 资源/设置/工具 | 1d：/apps/anthropic 地址拉取模型时追加 compatible-mode 端点候选 | 已迁移 |
| `e5b04221` | v4.0.19 | fix(subscription): select Claude Keychain credentials by account (#8764) | 1c 会话/用量导入 | Web 只从 ~/.claude/.credentials.json 读取 Claude 订阅凭据，不读 macOS Keychain | 不适用 |
| `3494d0d1` | v4.0.19 | chore(presets): add V-API backup endpoints | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `b5aa7fbb` | v4.0.19 | fix(agy): show Gemini quota when querying Google directly | 2c Antigravity | 2c：直接查 Google 时显示 Gemini 额度 | 已迁移 |
| `2fbd9c70` | v4.0.19 | fix(hermes): launch the dashboard inside WSL when Hermes lives there | 1d 资源/设置/工具 | 1d：Hermes 位于 WSL 时在对应发行版的登录 shell 里启动 dashboard | 已迁移 |
| `7ecce7c7` | v4.0.19 | fix(proxy): carry encrypted-only reasoning as empty thinking for Claude clients | 1b 代理协议 | 1b：只有密文的推理以空 thinking 交给 Claude 客户端 | 已迁移 |
| `10e0aa23` | v4.0.19 | fix(deeplink): don't let a finished import close a newer link's confirmation | 1d 资源/设置/工具 | 1d：导入完成只关闭仍在显示的请求，不误关新到链接的确认框 | 已迁移 |
| `9cb6b6d7` | v4.0.19 | fix(agy): run background agy commands without a console window on Windows | 2c Antigravity | 2c：Windows 下后台 agy 命令不弹控制台窗口 | 已迁移 |
| `50e091b0` | v4.0.19 | fix(usage): step 7/14/30-day presets back by calendar days across DST | 5b 用量/额度 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `e53ca7e8` | v4.0.19 | fix(usage): tighten request log column spacing | 5b 用量/额度 UI | 需新建或映射：`components/usage/usageTable.ts` | 待迁移 |
| `bada9a4b` | v4.0.19 | fix(models): don't borrow a vendor-hosted entry that points at another vendor | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `a043b1f8` | v4.0.19 | chore(release): v4.0.19 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `d8983bb1` | v4.0.19 | docs(release): add v4.0.19 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c8945d2d` | v4.0.20 | feat(omp): add Oh My Pi support | 2d Oh My Pi | 2d：Oh My Pi 支持（omp_config、AppType::Omp 累加式、MCP 开关/导入、Skills 按原生目录、提示词 AGENTS.md、会话浏览、目录覆盖、工具安装卸载、图标；Web schema v20 mcp_servers.enabled_omp）；托盘不适用，启动时导入改由列表读取时同步 | 已迁移 |
| `2afe8cdb` | v4.0.20 | refactor(omp): rename the internal app id from ohmypi to omp | 2d Oh My Pi | 2d：直接采用最终的 omp 命名（未经过 ohmypi 中间态） | 已迁移 |
| `3d7cf6aa` | v4.0.20 | refactor(omp): port #8308's text-level models.yml editor and share Pi plumbing | 2d Oh My Pi | 2d：models.yml 文本级编辑与共享 Pi 接口（GET /api/omp/state 同 Pi 状态；Pi/Omp 用量脚本只改数据库 PUT /api/providers/:app/:id/usage-script）；Web 的 Pi 供应商服务保留自有实现，仅增加 Pi/Omp 共用的用量脚本更新 | 已迁移 |
| `a03c6c7a` | v4.0.20 | refactor(omp): reuse the Pi provider form and plumbing for Oh My Pi | 2d Oh My Pi | 2d：omp 复用 Web 的 PiProviderForm（预设、YAML 编辑框、模型自动发现）；Web 的 Pi 表单为自写简化版，上游完整表单细节未照搬；AddProvider/EditProvider 的 onSubmitReadyChange 用例因 Web 无该机制未迁移 | 部分迁移 |
| `e88a9fa4` | v4.0.20 | refactor(omp): read Oh My Pi sessions through the Pi session reader | 2d Oh My Pi | 2d：omp 会话经 Pi 会话读取器（session_manager/providers/pi.rs 取上游最终版本，shell_escape 用 Web 的 utils） | 已迁移 |
| `b34753b8` | v4.0.20 | feat(omp): manage Oh My Pi global prompts | 2d Oh My Pi | 2d：Oh My Pi 全局提示词写 agent 目录的 AGENTS.md；深链提示词不接受 omp（与上游一致） | 已迁移 |
| `f1d43eba` | v4.0.20 | docs(readme): list Oh My Pi among the managed tools | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `9bacd1d1` | v4.0.20 | fix(omp): allow project images in Oh My Pi session previews | 2d Oh My Pi | 2d：omp 会话预览允许项目内图片（content.rs 加入 omp） | 已迁移 |
| `d9422e7d` | v4.0.20 | fix(omp): install and update Oh My Pi without assuming Bun | 2d Oh My Pi | 2d：不假设 Bun 的安装/升级（后端生命周期在 1d 已是最终版本；前端安装提示改为官方脚本，并补上 installHint.agy） | 已迁移 |
| `d01daa0d` | v4.0.20 | fix(omp): hide the Oh My Pi choice when importing skills | 2d Oh My Pi | 2d：导入技能时隐藏 Oh My Pi | 已迁移 |
| `c3e54a4e` | v4.0.20 | feat(pricing): seed Kimi K3.1 Pro and HighSpeed prices | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `62652945` | v4.0.20 | feat(kimi): edit official account models and remove them from Kimi | 2b Kimi Code | 2b：编辑官方账号模型、从 Kimi 移出官方账号（kimi_official_connection/ensure_kimi_provider_editable） | 已迁移 |
| `c91aa774` | v4.0.20 | feat(kimi): show "No subscription" for accounts without a Kimi Code plan | 2b Kimi Code | 2b：无订阅账号显示“未订阅”（额度视图 emptyText、账号行 note 状态） | 已迁移 |
| `cae7c375` | v4.0.20 | chore(presets): remove EveryAPI sponsor and presets | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `1a3057dc` | v4.0.20 | fix(sessions): skip local command output when titling Claude sessions (#8799) | 1c 会话/用量导入 | 1c：Claude 会话标题跳过本地命令输出 | 已迁移 |
| `e8ae28b6` | v4.0.20 | fix(linux): restore window dragging and resize feedback (#8092) | — | 桌面窗口拖拽区域；浏览器页面无窗口拖拽 | 不适用 |
| `7f9cd9e9` | v4.0.20 | fix(proxy): use the attached marker for orphan tool result media (#8157) | 1b 代理协议 | 1b：孤立工具结果中的媒体使用附件标记 | 已迁移 |
| `9decd60e` | v4.0.20 | feat(i18n): complete Turkish catalog (#8616) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `bd50984e` | v4.0.20 | fix(forms): reflect automatic Copilot protocol routing (#8196) | 5a 供应商与全局 UI | 5a1：Claude Code / Claude Desktop 的 Copilot 卡上游格式显示「由路由按模型自动选择」并禁用手选 | 已迁移 |
| `c72c82cf` | v4.0.20 | feat(auth): support browser login for managed ChatGPT accounts (#8288) | 3 官方账号 | 3a：托管 ChatGPT 账号的浏览器登录（授权码 + PKCE，codex_oauth_auth/browser.rs 上游最终版本；/api/auth/start-login 接受 loginMethod）；回调监听服务端本机 1455 端口，只有浏览器与服务端同机时才能完成，Web 因此默认设备码登录（上游默认浏览器），标题行仍可切换 | 已迁移 |
| `309c9c51` | v4.0.20 | fix(agy): recover subagent usage models from native generations (#8693) | 2c Antigravity | 2c：从原生 generations 恢复子代理用量模型（native_models.rs） | 已迁移 |
| `5bc562ce` | v4.0.20 | feat(apps): group the apps page into installed and not installed sections | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `72b056f6` | v4.0.20 | fix(usage): show the balance amount even when it is used up | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `e68e6943` | v4.0.20 | fix(i18n): reword the failed quota line in Chinese as "query failed" | 1d 资源/设置/工具 | 1d：额度失败文案改为“额度查询失败”；托盘部分不适用 | 已迁移 |
| `b71141a8` | v4.0.20 | feat(apps): drag to reorder installed apps, sidebar follows the order | 5a 供应商与全局 UI | 应用排序依赖 Sidebar 与 appConfig 的 orderAppIds，随 5a 处理 | 待迁移 |
| `ba6a8a55` | v4.0.20 | fix(apps): group Claude Desktop by whether it is installed | 1d 资源/设置/工具 | 1d：Claude Desktop 状态新增 installed（按数据目录/应用包推断）；Web 应用页尚无按安装分组，界面分组随 5a | 已迁移 |
| `c6617bc2` | v4.0.20 | fix(omp): move the discovery note from the apps page to the MCP and Skills columns | 2d Oh My Pi | 2d：发现说明从应用页移到 MCP/Skills；Web 无矩阵列头，改为计数条下方的一行说明与文档链接（OmpDiscoveryNote） | 部分迁移 |
| `6c2fc74e` | v4.0.20 | feat(pi): pick fetched models in a dialog for Pi and omp | 5a 供应商与全局 UI | 5a2：Pi / omp 的取模型改用共用的 FetchedModelPicker 弹窗：勾上的模型按行加入并静默补参数（思考映射只给 Pi），取消勾选移除对应行，拉到的 ID 去重；行内下拉保留 | 已迁移 |
| `f395cd6b` | v4.0.20 | fix(kimi): import subagent usage from their own wire logs | 2b Kimi Code | 2b：子代理用量从各自的 wire 日志导入 | 已迁移 |
| `b9f317af` | v4.0.20 | fix(usage): stop treating an empty DeepSeek balance as an expired plan | 1c 会话/用量导入 | 1c：DeepSeek 余额为空不再判为套餐过期 | 已迁移 |
| `442df1db` | v4.0.20 | fix(skills): send a User-Agent when downloading skill archives | 1d 资源/设置/工具 | 1d：下载 Skill 归档时带 User-Agent（CC-Switch-Web/版本） | 已迁移 |
| `dcdcbcb4` | v4.0.20 | fix(pi): resolve $NAME references in apiKey for usage queries | 1d 资源/设置/工具 | 1d：Pi 用量查询解析 apiKey 中的 $NAME 引用，!command 与未设置变量不当 Key 发送 | 已迁移 |
| `6e040f4c` | v4.0.20 | fix(omp): check provider keys against omp's own providers | 2d Oh My Pi | 2d：供应商键按 omp 自己的供应商校验（omp_config 最终版本） | 已迁移 |
| `f67cb33d` | v4.0.20 | fix(omp): match omp's apiKey, models.json and schema rules | 2d Oh My Pi | 2d：apiKey、models.json 与 schema 规则对齐 omp（omp_config 最终版本；表单切换自动发现类型时丢弃 injectV1） | 已迁移 |
| `5f642640` | v4.0.20 | feat(pi): move rarely used provider settings into a collapsed advanced section | 5a 供应商与全局 UI | 5a2：Pi / omp 的请求头与模型自动发现收进模型列表下方默认收起的「高级选项」；发现类型的白话标签与说明此前已迁入。兼容项（compat）编辑器不适用：Web 的 Pi 表单在完整 JSON 里改 compat | 部分迁移 |
| `28a2ebc0` | v4.0.20 | fix(usage): show every tab count and keep counts steady across filter changes | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `50a9d103` | v4.0.20 | chore(presets): refresh preset models to the latest vendor lineups | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c9e059a4` | v4.0.20 | chore(release): v4.0.20 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `85ad4969` | v4.0.20 | docs(release): add v4.0.20 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `de0a235a` | v4.0.21 | fix(proxy): send Codex requests to the provider table that model_provider selects (#8849) | 1b 代理协议 | 1b：Codex 请求发往 model_provider 选中的供应商表地址 | 已迁移 |
| `e8e1cfbf` | v4.0.21 | fix(usage): keep Codex remote-compaction usage billable across sync passes (#8879) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `93a3e8ec` | v4.0.21 | feat(auth-center): always show Add account in the header | 2b Kimi Code | 2b：授权中心标题行始终显示“添加账号”，空状态只留说明；Web 的 Codex 组没有登录方式选择，未引入 loginControl 用法；删除三语孤立键 | 已迁移 |
| `ee83fd89` | v4.0.21 | refactor(auth-center): drop the header "Delete all accounts" menu | 2c Antigravity | 2c：授权中心标题行去掉「删除全部账号」菜单（ManagedAccountsGroup 移除 onRemoveAll，Codex/Copilot/xAI 同步；xAI 表单内「删除全部 xAI 账号」保留），删除 groupMenu/removeAll 键 | 已迁移 |
| `882e7a6a` | v4.0.21 | fix(profile): capture "no active prompt" so applying a project disables the current prompt | 1d 资源/设置/工具 | 1d：项目快照记录“没有启用的提示词”，应用项目时停用当前启用项 | 已迁移 |
| `56fa007f` | v4.0.21 | feat(presets): use DeepSeek Flash instead of Pro everywhere | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `da0c84e4` | v4.0.21 | fix(tray): keep lightweight mode across restarts | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `4dc05a9a` | v4.0.21 | feat(claude): switch between multiple official subscription accounts | 3 官方账号 | 3b：Claude 官方订阅多账号（services/claude_account、claude_official 上游最终版本；授权中心 Claude 账号组、官方卡绑定账号、卡片副标题）；Web 账号管理器为进程单例，登录在服务端跑 claude auth login 且从不在服务端开浏览器，授权页地址交给前端，回调回不到服务端本机时把落地页地址或代码贴回（/api/auth/claude/paste）；Web 无表单跳授权中心入口 | 已迁移 |
| `58fee0db` | v4.0.21 | fix(claude): close gaps in official account switching | 3 官方账号 | 3b：账号切换的遗漏修补（编辑器保存后同步各账号目录；上游集成用例改写为 claude_runtime_tests） | 已迁移 |
| `62324686` | v4.0.21 | feat(providers): move Open Terminal out of the more menu | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `1409bad9` | v4.0.21 | feat(claude): switch Claude Code's sign-in when switching official cards | 3 官方账号 | 3b：切官方卡时切换 Claude Code 登录（claude_direct/claude_editor/模式退出写 live 前后 with_login_switch；GET /api/auth/claude/login-switch，WSL/覆盖目录时提示不切） | 已迁移 |
| `e550adcf` | v4.0.21 | feat(claude): switch the sign-in whenever an official card has an account | 3 官方账号 | 3b：官方卡带账号时总是切换登录（claude_direct 上游最终版本） | 已迁移 |
| `1ddb14e1` | v4.0.21 | fix(claude): keep account profiles consistent when recovering or parking | 3 官方账号 | 3b：恢复或暂存时保持账号资料一致（snapshot 上游最终版本） | 已迁移 |
| `3837f460` | v4.0.21 | feat(claude): show the bound account in the card subtitle | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `0d6386ed` | v4.0.21 | feat(claude): show each bound account's quota on its card | 3 官方账号 | 3b：绑号卡按账号查额度（GET /api/auth/claude/quota，令牌过期时借 Claude Code 的 /usage 缓存）；Web 无托盘额度缓存，不写缓存 | 已迁移 |
| `b3eb2ad1` | v4.0.21 | feat(claude): show each account's quota in the auth center | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `e29968f5` | v4.0.21 | fix(claude): don't show a stale quota when the account's login has lapsed | 3 官方账号 | 3b：登录失效时不显示过期额度 | 已迁移 |
| `50395742` | v4.0.21 | refactor(claude): match the auth center header changes on main | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `0c07d509` | v4.0.21 | fix(providers): keep the usage column aligned when a card's status changes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `ee2ef72f` | v4.0.21 | fix(hermes): move set-default into the more menu like other additive apps | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `03337b7e` | v4.0.21 | feat(presets): allow max reasoning effort for MiniMax Flash in OpenClaw | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `88c878ac` | v4.0.21 | feat(claude): show the subscription plan on official cards | 3 官方账号 | 3b：官方卡显示订阅套餐（GET /api/auth/claude/default-plan；默认登录在 macOS 先读钥匙串再读 .credentials.json） | 已迁移 |
| `6837f361` | v4.0.21 | fix(claude-desktop): use the documented OpenCode Go base URL (#8720) | 5a 供应商与全局 UI | 5a2：OpenCode Go 的用量检测（后端 coding_plan 与前端 codingPlanProviders）同时认现行的 /inference/go 入口；Claude Desktop 预设此前已是 /inference/go/anthropic，补预设用例 | 已迁移 |
| `9c30cde4` | v4.0.21 | chore(templates): add a required Human Note to issue and PR templates (#8905) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `a56dddb9` | v4.0.21 | feat(presets): add TeamoRouter Claude presets and update promotion text (#8266) | 1a 预设/定价/图标 | 1a：TeamoRouter Claude 预设已同步；推广文案不迁移 | 已迁移 |
| `f20a2b29` | v4.0.21 | fix(windows): gate Unix-only Claude login opener constant (#8898) | 3 官方账号 | 3b：Windows 下仅 Unix 的登录打开器常量加 cfg（login.rs 上游最终版本） | 已迁移 |
| `74a98fdd` | v4.0.21 | fix(gemini): read export KEY=value lines in ~/.gemini/.env (#8862) | 1d 资源/设置/工具 | 1d：读取 ~/.gemini/.env 时识别 export KEY=value 行 | 已迁移 |
| `66510775` | v4.0.21 | fix(opencode): hide connectivity check for OMO profiles (#8842) | 5a 供应商与全局 UI | 需新建或映射：`utils/providerCapabilities.test.ts` | 待迁移 |
| `ec5c5f8a` | v4.0.21 | fix(forms): align Claude Desktop Copilot URL detection and sync zh/en/ja manuals (#8838) | 5a 供应商与全局 UI | 5a2：Claude Desktop 手填 Copilot 地址时也按 Copilot 自动选格式，Codex / xAI OAuth 卡忽略 Copilot 地址；用例按 Web 的必填标签与 OAuth 区块替身改写；docs/ 不适用 | 已迁移 |
| `d2008fdb` | v4.0.21 | fix(i18n): complete Turkish catalog follow-ups (#8836) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `238d8a71` | v4.0.21 | test(proxy): add end-to-end regression tests for inline <think> block conversion (#8835) | 1b 代理协议 | 1b：内联 <think> 转换端到端回归（适配 Web 代理构造参数） | 已迁移 |
| `fe08e10a` | v4.0.21 | feat(claude): match the Codex sign-in picker on official cards | 5a 供应商与全局 UI | 5a1：Claude 官方卡账号选择器已随 3b 取上游最终版本；「添加或管理 Claude 账号」从表单跳授权中心的入口 Web 基线前就没有（Codex / Copilot 选择器同样没有），账号在设置 → 授权中心添加 | 部分迁移 |
| `ea1645f9` | v4.0.21 | fix(auth): align quota bars across accounts in the auth center | 3 官方账号 | 3a：授权中心各账号的额度列定宽对齐（.auth-quota-col 与分组卡片 container query） | 已迁移 |
| `45155e9d` | v4.0.21 | feat(terminal): say on the card when a terminal is isolated | 5a 供应商与全局 UI | 需新建或映射：`components/providers/OpenTerminalDialog.tsx`、`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `5f0fc253` | v4.0.21 | fix(apps): count Hermes's leftover hermes.cmd beside hermes.exe as one install | 1d 资源/设置/工具 | 1d：Hermes 的 hermes.exe 旁残留 hermes.cmd 按一处安装计（tool_management.rs） | 已迁移 |
| `cfc64971` | v4.0.21 | fix(mcp): drop timeout/autoApprove from Codex MCP entries | 1d 资源/设置/工具 | 1d：写入 Codex MCP 条目时去掉 timeout/autoApprove（Web 只有单服务器写入路径） | 已迁移 |
| `618af9d9` | v4.0.21 | fix(apps): allow OpenCode's postinstall under npm 12 | 1d 资源/设置/工具 | 1d：npm 12 下允许 OpenCode postinstall（后端安装命令与前端一键命令） | 已迁移 |
| `ff31d840` | v4.0.21 | fix(apps): allow Grok Build's postinstall under npm 12 | 1d 资源/设置/工具 | 1d：npm 12 下允许 Grok Build postinstall | 已迁移 |
| `d564adc3` | v4.0.21 | feat(presets): add Kimi K3.1 Pro and HighSpeed to the official Kimi presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `05034a4e` | v4.0.21 | feat(codex): drag to reorder rows in the provider model list | 5a 供应商与全局 UI | 5a1/5a1b：Codex 模型列表行首拖动手柄换行序（只有一行时隐藏，可键盘操作）；第一行即默认模型，拖到最前的那一行当场成为新的 model | 已迁移 |
| `71524045` | v4.0.21 | fix(stack): keep the aggregation member order in step with drag sorting | 4 模式/路由 | 4d：排序只改 sort_index（update_provider_sort_indexes，一个事务、不存在的行跳过），不会复活并发删掉的行或盖掉刚存的字段。聚合名单随拖动重排不适用：Web 聚合成员按名称 A–Z 排，与 sort_index 无关 | 部分迁移 |
| `96f01af0` | v4.0.21 | fix(proxy): retry Codex requests rejected for a foreign Azure resource | 1b 代理协议 | 1b：Codex 请求因外部 Azure 资源 item id 被拒时整流重试 | 已迁移 |
| `c2110ebb` | v4.0.21 | fix(mcp): warn when an SSE server is written to apps without SSE support | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `80640b52` | v4.0.21 | fix(proxy): read Chat completions wrapped in a data envelope | 1b 代理协议 | 1b：读取包在 data 信封里的 Chat completions（转换与用量解析） | 已迁移 |
| `e332cfdb` | v4.0.21 | fix(omp): stop refusing models.yml values that contain &, * or ! | 2d Oh My Pi | 2d：models.yml 中含 &、*、! 的值不再被拒绝（omp_config 最终版本） | 已迁移 |
| `644f5664` | v4.0.21 | fix(kimi): date session usage by each request, not the turn commit | 2b Kimi Code | 2b：会话用量按每个请求完成时间记日期 | 已迁移 |
| `0820ff73` | v4.0.21 | fix(codex-oauth): stop reporting transient refresh failures as an expired login | 1b 代理协议 | 1b：Codex OAuth 刷新暂时失败不再显示登录过期；Web 无托盘事件，改在切换供应商成功后重查失败的额度 | 已迁移 |
| `fec3629a` | v4.0.21 | docs(readme): move TeamoRouter ahead of AICoding in the sponsor table | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `9f5adaac` | v4.0.21 | ci: auto-close outside PRs that change SCHEMA_VERSION (#8903) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `42ef6347` | v4.0.21 | fix(usage): prevent dashboard jumps when toggling the sidebar (#8548) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `95e29485` | v4.0.21 | feat(presets): add ClinePass presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5cc6c47f` | v4.0.21 | fix(auth-center): refetch Claude accounts after switching Claude cards | 3 官方账号 | 3b：切换 Claude 卡后重读 Claude 账号列表；托盘切卡事件 Web 无，不适用 | 部分迁移 |
| `cb50e600` | v4.0.21 | chore(release): v4.0.21 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `c4db63c6` | v4.0.21 | docs(release): add v4.0.21 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `df511e82` | v4.0.22 | docs(contributing): require a self-written Human Note in PRs | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `e55d8a21` | v4.0.22 | fix(tray): handle clicks from third-party Windows tray hosts (#8729) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `0133facc` | v4.0.22 | fix(claude): say Claude accounts aren't supported when the config dir is in WSL | 3 官方账号 | 3b：Claude 配置目录在 WSL 时说明账号不可用（tool_runs_in_wsl、登录置灰与提示） | 已迁移 |
| `d288057f` | v4.0.22 | docs(guides): add a guide to switching Claude subscription accounts | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `dd81bc95` | v4.0.22 | docs(release): link the Claude accounts guide from v4.0.21 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `3fc8794c` | v4.0.22 | feat(apps): integrate DeepSeek Harness (#8795) | 2e DeepSeek Harness | 2e：DeepSeek Harness 应用（dsh_config、AppType::Dsh 累加式、原生 profile 的 cordis.patch.yml 与数据库一起提交、MCP/Skills 开关、提示词 $DSH_HOME/AGENTS.md、会话浏览（不可删除）、工具安装卸载、表单走 McodeProviderForm）；Web schema v21 enabled_dsh；不做连通检测（上游同样无适配器）；托盘与 docs/ 文档不适用 | 已迁移 |
| `03e19fe7` | v4.0.22 | docs(sponsors): update DIT.ai promotion copy and welcome offer | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `ee8ee25e` | v4.0.22 | docs(readme): move DIT.ai ahead of OpenModel in the sponsor table | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `33833a6a` | v4.0.22 | fix(proxy): accept x-api-key in Claude Desktop gateway auth (#5123) | 1b 代理协议 | 1b：Claude Desktop 网关认证接受 x-api-key | 已迁移 |
| `1718a261` | v4.0.22 | fix(proxy): use constant-time Claude Desktop token check (#7488) | 1b 代理协议 | 1b：Claude Desktop 网关令牌常量时间比较，统一 401 响应；新增 subtle 依赖 | 已迁移 |
| `983113a1` | v4.0.22 | fix(claude-desktop): write inferenceModels in the UI tier order (#7491) | 4 模式/路由 | 4c：Desktop inferenceModels 按界面档位顺序（Sonnet / Opus / Fable / Haiku）写入 | 已迁移 |
| `32db0e57` | v4.0.22 | fix(minimax): keep the weekly window visible after its quota runs out (#8124) | 1a 预设/定价/图标 | Web 的 MiniMax 解析按周总量判断，不依赖 `current_weekly_status`；额度耗尽时周桶照常显示，无需迁移 | 不适用 |
| `6d6b7162` | v4.0.22 | feat(skills): add functionality to open installed skill directory and copy skill name (#8993) | 1d 资源/设置/工具 | 1d：点击 Skill 名称复制名称；“打开目录”按用户决定改为复制主副本目录路径（新增 /api/skills/installed-dir），三语文案 | 已迁移 |
| `9077b432` | v4.0.22 | perf(skills): discover only the changed repo instead of every repo (#8907) | 5a 供应商与全局 UI | 按仓库增量发现 Skill 依赖 useSkills.helpers 与 SkillsPage 的缓存结构，随 5a 的 Skills 页面处理 | 待迁移 |
| `869c0b27` | v4.0.22 | fix(usage): refresh balances for inactive providers (#8342) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `a62203bb` | v4.0.22 | fix(ui): prevent duplicate tooltips and constrain help cards (#8593) | 5a 供应商与全局 UI | 需新建或映射：`components/mcp/AppMatrix.tsx` | 待迁移 |
| `cd9c7210` | v4.0.22 | fix(proxy): reject upstream URLs that loop back to the proxy itself (#8598) | 1b 代理协议 | 1b：拒绝回环到代理自身监听地址的上游 URL | 已迁移 |
| `144c41b9` | v4.0.22 | fix(auth-center): scroll only the panel body when jumping to an auth section (#8964) | 3 官方账号 | 3a：跳到某个授权分组时只滚动面板正文（新增 AuthCenterPanel 测试） | 已迁移 |
| `67cce7ad` | v4.0.22 | fix(usage): show bound Claude official account quota in tray and usage settings | 3 官方账号 | 3b：用量脚本弹窗按绑定账号测试；托盘与用量缓存不适用 | 部分迁移 |
| `e78f641c` | v4.0.22 | fix(apps): report a CLI that is present but yields no version as not runnable | 1d 资源/设置/工具 | 1d：存在但不输出版本的 CLI 报告为不可运行 | 已迁移 |
| `03b475fb` | v4.0.22 | feat(terminal): add an option to skip permission prompts when opening a terminal | 5a 供应商与全局 UI | 终端选项依赖上游 OpenTerminalDialog（Web 尚无），随 5a 的供应商卡片与终端对话框处理 | 待迁移 |
| `6776bc06` | v4.0.22 | feat(terminal): open a Codex terminal from a provider card | 5a 供应商与全局 UI | 终端选项依赖上游 OpenTerminalDialog（Web 尚无），随 5a 的供应商卡片与终端对话框处理 | 待迁移 |
| `7f82b85b` | v4.0.22 | fix(sidebar): inset today's usage text to align with mode badge text | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `9403960f` | v4.0.22 | fix(copilot): pass Claude models through to native /v1/messages so prompt caching works (#8908) | 3 官方账号 | 3c：Anthropic 模型声明 /v1/messages 时原生透传、响应转换按每次请求解析的格式、Copilot 纳入 thinking 签名 / budget 整流；Claude 路径未接优化器，“只在 OpenAI 桥接上剥离 thinking”不适用 | 部分迁移 |
| `ddcb1117` | v4.0.22 | fix(config): recognize TOML array-of-tables headers in section detection (#9029) | 5a 供应商与全局 UI | 5a1：数组表头 [[...]] 也算表头，base_url 不会写进 [[skills.config]]，已误写的移回 custom 表 | 已迁移 |
| `6fa328f3` | v4.0.22 | feat(dsh): manage DeepSeek Harness Web and Desktop together, with account login and usage import (#8986) | 2e DeepSeek Harness | 2e：Web 与 Desktop 共用管理、DeepSeek 账号登录（/api/dsh/account*，回调落在服务端本机，仅浏览器与服务端同机时可完成）、用量导入（session_log_sync.parser_state、zstd 会话按解压后偏移读取）；Web 请求日志无 pricing_model/input_token_semantics 列：前缀模型仍按裸名计价，但导入时无定价、之后补价的前缀模型无法回填（对应上游用例未迁移）；用量页 providerLabel 与筛选随 5b | 部分迁移 |
| `03ec9dbb` | v4.0.22 | fix(ci): make WSL2 checks manual and guard SQLite tests | 2c Antigravity | 2c：SQLite 测试在不支持的临时目录下跳过（config::sqlite_unsupported_in_temp_dir）；WSL2 nightly 工作流为桌面端 CI，不适用 | 部分迁移 |
| `16b6575d` | v4.0.22 | fix(quota): point expired managed accounts to Accounts, not a command | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `115677a1` | v4.0.22 | fix(agy): let a transcript win over another root's index-only entry | 2c Antigravity | 2c：会话 transcript 优先于其他根目录仅有索引的条目 | 已迁移 |
| `11485ee7` | v4.0.22 | fix(codex): log the underlying cause when the official model list fetch fails | 4 模式/路由 | 4a：拉取 Codex 官方模型列表失败时日志带上底层原因 | 已迁移 |
| `ed494fbc` | v4.0.22 | fix(opencode): read the V2 settings.baseURL in the connectivity check | 1d 资源/设置/工具 | 1d：OpenCode 连通性检查识别 V2 原生格式（settings.baseURL/apiKey、package、顶层 headers），Web 版按包名归一到对应 AI SDK 协议 | 已迁移 |
| `7201d81b` | v4.0.22 | feat(sync): let users clear the saved WebDAV config | 1d 资源/设置/工具 | 1d：可清除本机保存的 WebDAV 配置（新增 /api/webdav/settings/clear）；自动上传在同步锁内重新读取设置 | 已迁移 |
| `326b394b` | v4.0.22 | fix(proxy): map Claude WebSearch blocked_domains to Responses filters | 1b 代理协议 | 1b：Claude WebSearch blocked_domains 映射为 Responses 过滤 | 已迁移 |
| `064ae422` | v4.0.22 | fix(proxy): split trailing text out of Gemini function-response turns | 1b 代理协议 | 1b：Gemini 函数响应回合拆出尾随文本 | 已迁移 |
| `6c998b4d` | v4.0.22 | fix(claude-account): write oversized credentials to the keychain via argv | 3 官方账号 | 3b：超长凭据经 argv 写入钥匙串（keychain.rs 上游最终版本） | 已迁移 |
| `ebb00da1` | v4.0.22 | feat(terminal): let users append extra arguments when opening a terminal | 5a 供应商与全局 UI | 终端选项依赖上游 OpenTerminalDialog（Web 尚无），随 5a 的供应商卡片与终端对话框处理 | 待迁移 |
| `6282108e` | v4.0.22 | fix(proxy): mount thoughtSignature at Part level instead of inside functionCall (#6690) | 1b 代理协议 | 1b：thoughtSignature 挂在 Part 层 | 已迁移 |
| `df753b5e` | v4.0.22 | fix(proxy): fall back to Gemini's skip signature on the Gemini Native path | 1b 代理协议 | 1b：Gemini Native 路径缺签名时回退 skip 签名 | 已迁移 |
| `8355f1f1` | v4.0.22 | fix(proxy): filter unsupported xAI Responses include marker (#8997) | 1b 代理协议 | 1b：过滤 xAI Responses 不支持的 include 标记 | 已迁移 |
| `accc4489` | v4.0.22 | feat(usage): import Oh My Pi session usage (#9046) | 2d Oh My Pi | 2d：导入 Oh My Pi 会话用量（session_usage_omp、Pi 用量导入取上游最终版本；Web 无 input_token_semantics/pricing_model 列，插入时去掉）；providerLabel 与用量页筛选随 5b | 部分迁移 |
| `efb955bd` | v4.0.22 | fix(dsh): drop the account banner and note the shared list in the section title | 2e DeepSeek Harness | 2e：去掉账号横幅；Web 无分区标题，列表上方写明 Web 与 Desktop 共用 | 已迁移 |
| `2baa6862` | v4.0.22 | feat(dsh): add DeepSeek official account sign-in like Kimi Code | 2e DeepSeek Harness | 2e：DeepSeek 官方登录预设、官方账号卡与授权中心分组；Web 无从表单跳到授权中心的入口，选中预设时账号组直接显示在表单里（同 Kimi） | 已迁移 |
| `dfa29123` | v4.0.22 | feat(providers): align the shared model editor with Pi and Kimi | 5a 供应商与全局 UI | 5a2：OpenCode / MiniMax Code / DeepSeek Harness 共用的模型编辑器按 Pi / Kimi 的行布局：推理与图片输入开关、上下文与最大输出字段；DSH 增加结构化思考档位与逐模型兼容项（新增上游 StructuredOptionsEditor）；去掉不再使用的 Token 限制文案 | 已迁移 |
| `f283a55f` | v4.0.22 | fix(shell): show DeepSeek Harness by its full name in the sidebar | 5a 供应商与全局 UI | 需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `4ed07150` | v4.0.22 | test(agy): compare transcript paths as Path so Windows separators match | 2c Antigravity | 2c：测试按 Path 比较 transcript 路径，兼容 Windows 分隔符 | 已迁移 |
| `f19b3898` | v4.0.22 | fix(usage): cap stored proxy_request_logs.error_message on write (#9010) | 1c 会话/用量导入 | 1c：写入 proxy_request_logs.error_message 时截断到 4096 字符 | 已迁移 |
| `c2aa4e0b` | v4.0.22 | docs(sponsors): update PatewayAI promotion copy | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `3e75b96e` | v4.0.22 | docs(sponsors): refresh AIGoCode copy and add theme-aware banner | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `da263511` | v4.0.22 | fix(apps): rerun the Kimi installer when the installed CLI predates upgrade --yes | 1d 资源/设置/工具 | 1d：已安装 Kimi 早于 upgrade --yes 时重跑官方安装器（生命周期后端已含 Kimi，应用层接入随 2b） | 已迁移 |
| `12e9fe53` | v4.0.22 | feat(presets): add Astron Coding Plan preset for Claude Code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `33aaf8e7` | v4.0.22 | fix(claude-account): pass the global proxy to Claude Code subprocesses | 3 官方账号 | 3b：Claude Code 子进程带上全局代理（login.rs/usage.rs 上游最终版本） | 已迁移 |
| `0b8a53e3` | v4.0.22 | feat(skills): open a discovered skill's docs from the Discover list | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c1933fd0` | v4.0.22 | fix(providers): warn when an additive app's live config cannot be read | 1d 资源/设置/工具 | 1d：后端在累加式应用写 live 失败时撤回新增行并报错；供应商列表的“live 配置读取失败”提示随 5a 的 ProviderList 处理 | 部分迁移 |
| `ebdedbee` | v4.0.22 | feat(presets): add ccswitch channel tracking to StreamLake API key links | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `839efbe2` | v4.0.22 | feat(presets): move TokenFlux to tokenflux.com with tokenflux.dev as fallback | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `9433caab` | v4.0.22 | feat(presets): add OspreyAI as a sponsor | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `84d4ce32` | v4.0.22 | chore(release): v4.0.22 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `b7642674` | v4.0.22 | docs(release): add v4.0.22 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `9941a645` | v4.0.23 | fix: classify 400 invalid_grant as permanent, honor export lines when cleaning .env, complete Turkish catalog (#9049) | 1d 资源/设置/工具 | 1d：Codex OAuth 刷新 400 invalid_grant 视为永久失效；清理 .env 时识别 export 行；土耳其语部分不迁移 | 已迁移 |
| `779063c1` | v4.0.23 | fix(usage): record Antigravity latency and first-token time | 2c Antigravity | 2c：记录 Antigravity 延迟与首 token 时间 | 已迁移 |
| `46ea443d` | v4.0.23 | fix(usage): record MiniMax Code latency and first-token time | 1c 会话/用量导入 | 1c：MiniMax Code 用量记录耗时与首字时间 | 已迁移 |
| `645f8fa1` | v4.0.23 | feat(presets): add Astron MaaS pay-as-you-go preset for Claude Code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `fcd8f3bd` | v4.0.23 | fix(claude-account): resolve mise shims when locating the claude CLI | 3 官方账号 | 3b：定位 claude CLI 时解析 mise shim（补上 1d 迁移漏掉的 mise_shim_target 定义，此前只在 Linux/macOS 编译时缺失） | 已迁移 |
| `12078d5b` | v4.0.23 | feat(auth): add refresh-all button to the Accounts page header (#9073) | 3 官方账号 | 3a/3b：授权中心页头“全部刷新”（含 Claude 官方账号） | 已迁移 |
| `6d6ee68f` | v4.0.23 | fix(providers): stop IME composition from duplicating letters in provider key inputs (#9069) | 2b Kimi Code | 2b：供应商键输入框的输入法组合不再重复字母（Kimi 与 MiniMax Code 表单） | 已迁移 |
| `7569b27a` | v4.0.23 | fix(providers): keep fetched model list when the form re-renders (#9068) | 5a 供应商与全局 UI | 5a2：OpenCode 表单重新渲染时保留已拉取的模型列表 | 已迁移 |
| `d8339d6a` | v4.0.23 | fix(icon-picker): keep picker clear of macOS traffic lights (#9076) | — | 图标选择器避让 macOS 红绿灯；Web 无原生窗口按钮 | 不适用 |
| `ba3d80d8` | v4.0.23 | fix(tray): show the bound Claude account instead of the website for official cards (#9071) | — | 托盘官方卡片显示绑定账号；Web 无托盘（共享账号读取随批次 3 核对） | 不适用 |
| `258c367f` | v4.0.23 | fix(grokbuild): stream large session logs and support byte offset cursor (#9026) | 1c 会话/用量导入 | 1c：Grok Build 会话日志逐行流式读取并按字节游标续读；导入器整体同步到上游最终版本（去掉 input_token_semantics），补 grok-4.6/4.7 Build 定价 | 已迁移 |
| `300453be` | v4.0.23 | fix(codex): handle text-only DeepSeek V4 Flash 0731 on OpenRouter (#6194) | 4 模式/路由 | 4a：deepseek-v4-flash-0731 列为文本模型，发送前去图；OpenRouter 404「No endpoints found that support image input」算作不支持图片、触发去图重试；forwarder 层用例依赖 Web 没有的夹具，改在 media_sanitizer 里覆盖 | 部分迁移 |
| `3817c2b2` | v4.0.23 | fix(provider-form): prevent config editors from overwriting each other (#6777) | 5a 供应商与全局 UI | 5a1：JSON 编辑器外部同步不回吐成 onChange、监听器经 ref 调最新 onChange；表单各 hook 改 Key / 地址 / 模型 / 模板变量时现读当前配置，不按渲染期快照覆盖编辑器里的改动；提交校验按编辑器当前内容 | 已迁移 |
| `e49d12a5` | v4.0.23 | fix(settings): avoid launching OpenCode Desktop during env check (#7027) | 1d 资源/设置/工具 | 1d：环境检查不再拉起 OpenCode Desktop（桌面版无 CLI sidecar 时跳过） | 已迁移 |
| `c7188667` | v4.0.23 | fix(usage): recover bounded Codex forks after parent idle gaps (#9093) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `91a76cfd` | v4.0.23 | fix(startup): keep database lock waits off the UI thread (#9098) | 1d 资源/设置/工具 | 解决 Tauri 命令在 UI 线程上等数据库锁；Web 没有 UI 线程，HTTP 处理不会冻结界面。MiniMax Code/Kimi/DSH 列表刷新与供应商改动串行化随 2b/2e 的对应应用一并评估 | 不适用 |
| `a77417da` | v4.0.23 | fix(proxy): return JSON for non-streaming Claude model validation (#9097) | 1b 代理协议 | 1b：非流式 Claude 请求遇 Chat/Responses SSE 时聚合为 JSON（模型验证要求）；补齐 Web 缺失的 Responses/Chat SSE 聚合器与嗅探，Codex OAuth 非流不再强制流式 | 已迁移 |
| `c3adab30` | v4.0.23 | fix(dsh): dedupe profile paths that alias the same file (#9101) | 2e DeepSeek Harness | 2e：别名到同一文件的 profile 路径去重（dsh_config 最终版本） | 已迁移 |
| `e35eef5d` | v4.0.23 | test(usage): assert bounded fork token totals (#9105) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `4e31203c` | v4.0.23 | refactor(usage): return bool from bounded fork validation (#9106) | 1c 会话/用量导入 | 1c：Codex 会话导入整体同步到上游最终版本（Web 此前与基线一致），去掉 Web 没有的 input_token_semantics 列 | 已迁移 |
| `a9ec21a9` | v4.0.23 | fix(usage): read DeepSeek Harness credentials for official balance queries (#9108) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `43a06937` | v4.0.23 | feat(skills): unify discover/installed rows and flash the row after jumping (#9081) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `3d4a3da3` | v4.0.23 | feat(providers): edit Kimi, MiniMax Code and omp configs in their native format | 2b Kimi Code | 2b/2d/2e：Kimi 原生 TOML 编辑框（2b）；MiniMax Code 与 Oh My Pi 的 YAML 编辑框（2d，依赖 yaml 2.8.1）；DSH 保留 JSON 编辑框（2e，与上游一致），其模型方言（reasoningEfforts/compat）专用控件依赖 5a 的表单部件，暂作普通额外字段显示 | 部分迁移 |
| `5c8f4e2e` | v4.0.23 | feat(presets): add OpenAI API key presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `2122f7da` | v4.0.23 | fix(proxy): send reasoning effort to non-whitelisted models on Claude OpenAI routes | 1b 代理协议 | 1b：Claude 路由经 OpenAI Chat/Responses 时按模型能力补发思考档位（claude_reasoning），表单与 Desktop 表单新增思考档位选项（自动/原样/不发） | 已迁移 |
| `93d0bf18` | v4.0.23 | feat(proxy): map Claude thinking settings to Gemini thinkingConfig | 1b 代理协议 | 1b：Claude thinking 设置映射到 Gemini thinkingConfig | 已迁移 |
| `bd89109e` | v4.0.23 | feat(presets): add Gemini CLI presets for providers that serve Gemini | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f75cb1b6` | v4.0.23 | fix(tray): restore the main window from a second launch in lightweight mode | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `54115a8c` | v4.0.23 | fix(claude-desktop): publish claude-haiku-5-5 for the Haiku tier in route mode | 4 模式/路由 | 4c：Desktop 路由模式 Haiku 档发布 claude-haiku-5-5（目标是旧 Haiku 时除外） | 已迁移 |
| `959e4a95` | v4.0.23 | fix(usage): read MiniMax Code and Kimi credentials for native usage queries | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `1ddacbd8` | v4.0.23 | docs(sponsors): refresh pinned Kimi banner and copy for K3.1 Pro | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `57169e4b` | v4.0.23 | chore(release): v4.0.23 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `66d530d6` | v4.0.23 | docs(release): add v4.0.23 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `8be84055` | v4.0.23 | ci(release): move macOS builds to macos-15 | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `1f21c289` | v4.0.24 | fix(dsh): show DeepSeek account in official sign-in subtitle (#9058) | 2e DeepSeek Harness | 2e：官方登录副标题显示 DeepSeek 账号已迁移；预设副行“用 DeepSeek 账号登录”依赖 presetGroups（loginWith），随 5a | 部分迁移 |
| `7e02e494` | v4.0.24 | fix(codex): restore reasoning effort after re-enabling (#8998) | 1b 代理协议 | 1b：重新启用 Codex Chat 思考等级时恢复默认参数名，后端修复已启用但参数为 none 的旧配置；组件交互测试依赖 Web 不同的测试夹具未迁移 | 已迁移 |
| `c1fb9eec` | v4.0.24 | fix(tray): store Linux tray icons in app cache directory (#9021) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `734ed4a1` | v4.0.24 | feat(auth): let sign-in copy the login link instead of opening the browser | 3 官方账号 | 3b：授权中心“登录时自动打开浏览器”开关与复制登录链接；Claude 不另传 copy_link（Web 服务端从不开浏览器，始终由前端在用户浏览器打开） | 已迁移 |
| `832fbe65` | v4.0.24 | test(codex-oauth): retry the stale keep-alive request in the replacement test | 3 官方账号 | 3a：替换测试中重试过期的 keep-alive 请求（browser.rs 上游最终版本） | 已迁移 |
| `14ddd7b5` | v4.0.24 | fix(dsh): keep only text/image in exported model input | 2e DeepSeek Harness | 2e：导出的模型输入只保留 text/image（dsh_config 最终版本） | 已迁移 |
| `39183b59` | v4.0.24 | fix(proxy): keep max effort for every GPT 5.6+ Sol/Terra/Luna/Astra model | 1b 代理协议 | 1b：GPT 5.6+ Sol/Terra/Luna/Astra 全系保留 max 档 | 已迁移 |
| `6532c5a9` | v4.0.24 | chore(release): v4.0.24 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `1f12a3d4` | v4.0.24 | docs(release): add v4.0.24 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `889e50ac` | v4.0.24 | chore(presets): move A6API to the a6api.vip domain | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c0189078` | v4.0.24 | docs(release): update v4.0.24 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `9119deca` | v4.0.25 | chore(ci): remove Dependabot version update config | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `686ba51e` | v4.0.25 | fix(claude): keep the route-mode placeholder out of ANTHROPIC_API_KEY (#8111) | 4 模式/路由 | 4c：路由模式本地跳只写 ANTHROPIC_AUTH_TOKEN 占位符，行里只有 ANTHROPIC_API_KEY 时本地也不出现该键 | 已迁移 |
| `a9e607c3` | v4.0.25 | feat(codex): add sub-agent concurrency limit field to the provider form (#9056) | 5a 供应商与全局 UI | 5a1：Codex 表单新增子代理并发上限（[agents] max_threads，旧名改新名、留空删键、官方卡也显示），multi_agent_v2 写了总数时提示以它为准 | 已迁移 |
| `9bd8fe51` | v4.0.25 | fix(terminal): prefer PowerShell 7 (pwsh) when PowerShell is the preferred Windows terminal (#8992) | 1d 资源/设置/工具 | 1d：首选终端为 PowerShell 时，PATH 上有 pwsh.exe 就用 PowerShell 7 | 已迁移 |
| `b8112ca5` | v4.0.25 | feat(mcp): check MCP server connectivity on demand (#8348) | 1d 资源/设置/工具 | 1d：MCP 按需连通性检查（stdio/Streamable HTTP/旧版 SSE 握手，最多 3 并发、每项 30 秒，进程树回收）；Web 无 IPC 通道，改为 /api/mcp/connectivity 启动 + 轮询取结果 + 取消；页面按钮与行内测试、状态点 | 已迁移 |
| `5c14e917` | v4.0.25 | fix: fetch models.dev through the backend proxy-aware client, fixing sync failures in proxy-only environments (#8739) | 2b Kimi Code | 2b：models.dev 经后端代理感知客户端拉取（Web 路由 /api/usage/models-dev，浏览器不再直连 models.dev） | 已迁移 |
| `4a0baf69` | v4.0.25 | fix(proxy): strip non-text media (file/audio) for text-only upstreams (#6274) | 1b 代理协议 | 1b：纯文本上游剥离 file/audio 等非文本媒体 | 已迁移 |
| `153db16e` | v4.0.25 | fix(windows): prevent provider form values from flickering (#6420) | — | WebView2 自动填充覆盖受控输入；Web 运行于普通浏览器，不注入 WebView 钩子 | 不适用 |
| `b696f890` | v4.0.25 | fix(minimax): declare M3.1-Flash native thinking levels in Pi (#8540) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `1cc2c732` | v4.0.25 | fix(mcp): follow up on Pi MCP sync review notes (#7888) | 2a Pi MCP/迁移基线 | 2a：Pi MCP 审查跟进（重名检查与提交同锁、导入按 Pi 规则校验、未装 Pi 时只入库）；Pi 拒绝原因本地化；深链 MCP 的 apps 接受 pi，合并已有服务器时保留 Pi 勾选；上游集成测试改写为 services::mcp 单元测试；用户手册不适用 | 已迁移 |
| `69b41cdb` | v4.0.25 | fix(usage): import Pi official subagent usage (#8386) | 2d Oh My Pi | 2d：导入 Pi 官方子代理用量（session_usage_pi 上游最终版本） | 已迁移 |
| `c17de413` | v4.0.25 | feat(usage): fetch exchange rates automatically (#8716) | 5b 用量/额度 UI | 汇率自动获取（联网），与自选货币配套；保留手动汇率回退；需新建或映射：`services/exchange_rates.rs`、`components/usage/UsageDisplaySection.tsx`等 4 个 | 待迁移 |
| `5ba95160` | v4.0.25 | fix(proxy): send a supported tool_choice for forced web search to xAI (#8664) | 1b 代理协议 | 1b：强制 WebSearch 发往 xAI 时使用其支持的 tool_choice | 已迁移 |
| `42f7d0e0` | v4.0.25 | feat(skills): align the Discover toolbar with Installed (#9125) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `4cf15aea` | v4.0.25 | feat(session): implement Kimi session deletion and update related hints (#9157) | 2b Kimi Code | 2b：Kimi 会话删除（后端 session_manager 最终版本；Web 会话列表原本只禁止 MiniMax Code 删除，前端无需改动） | 已迁移 |
| `0103f4c8` | v4.0.25 | chore(presets): move Qwen pay-as-you-go and Token Plan to the new MaaS domains | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `9267ec8b` | v4.0.25 | feat(claude-desktop): describe routed models with provider and upstream model | 4 模式/路由 | 4c：Desktop 路由 / 聚合模型带「供应商 · 上游模型 · 窗口」说明（/v1/models 返回 description，profile 打开 modelDiscoveryEnabled） | 已迁移 |
| `e6d0bf61` | v4.0.25 | fix(proxy): reject browser-originated requests to the local router | 1b 代理协议 | 1b：本地路由拒绝带 Origin 的网页请求（/claude-desktop/* 仍靠网关令牌），回环监听只接受不可被公网 DNS 指向的 Host；同时移除 Web 遗留的宽松 CORS 层（上游 2937eb67）。监听 0.0.0.0（Docker/局域网）时不校验 Host；独立客户端地址随 f88068b9（批次 4）接入 | 已迁移 |
| `2e2a59cc` | v4.0.25 | feat(claude-code): describe routed and stacked models with provider and upstream model | 4 模式/路由 | 4c：Claude Code 路由档位与聚合模型的说明带供应商名与上游模型；上游托盘 / SwitchModePanel 展示部分不适用 | 部分迁移 |
| `3071cae9` | v4.0.25 | fix(terminal): keep proxy and stack settings out of provider terminals | 4 模式/路由 | 4c：打开终端的临时 settings 写卡自己的 modelPicker，并把切换会清掉、卡上没有的键写成空值挡住（claude_editor::switch_drops）；上游 claude_terminal_launch 结构不同，用例改为直接测 write_claude_config | 部分迁移 |
| `aa379e09` | v4.0.25 | chore(presets): remove DIT.ai sponsor and presets | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `aa42a93d` | v4.0.25 | feat(codex): add configurable pre-exhaustion quota protection (#8395) | 4 模式/路由 | 4d：Codex 官方额度保护（默认关，阈值 95% / 98%）：官方请求经本地路由时按账号读响应头 x-codex-* 用量（缓存 5 分钟），没有读数时查 wham/usage（5 秒超时），查不到一律放行；达到阈值返回本地 403（cc_switch_codex_quota_protection），不故障转移；设置页「认证」里编辑；docs/ 不适用 | 已迁移 |
| `eb6ba268` | v4.0.25 | fix(mcp): release cancelled connectivity checks and share the probe limit (#9149) | 1d 资源/设置/工具 | 1d：取消的连通性检查释放许可，并发上限跨批次共享（随服务最终版本） | 已迁移 |
| `f0252817` | v4.0.25 | feat(pricing): add GPT-6.1 Terra to the built-in pricing table (#9151) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f8f487b1` | v4.0.25 | fix(tray): show the tray panel without waiting for its data (#9154) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `ef7b77de` | v4.0.25 | fix(deps): update smol-toml to 1.9.1 (#9155) | 1d 资源/设置/工具 | 1d：smol-toml 升级到 1.9.1 | 已迁移 |
| `0b274ec3` | v4.0.25 | fix(usage): dedupe Codex request model aliases (#7643) | 1c 会话/用量导入 | 1c：Codex 会话按代理行 request_model 匹配客户端别名去重（导入跳过、逐行过滤、区间 JOIN 三处），DedupKey 增加 data_source | 已迁移 |
| `f332b472` | v4.0.25 | fix(codex): hide the forced-v2 warning as soon as classic tools turn off | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/StackSubagentFields.tsx` | 待迁移 |
| `fb241637` | v4.0.25 | test(mcp): run the login PATH fixture through a wrapper script | 1d 资源/设置/工具 | 1d：登录 PATH 夹具改经包装脚本运行（随测试最终版本） | 已迁移 |
| `05824df3` | v4.0.25 | chore(release): v4.0.25 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `a3eafa40` | v4.0.25 | docs(release): add v4.0.25 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |

## 8. 执行记录

- 2026-11-02：添加只读远端 `upstream`（push URL 置为 `DISABLED_READ_ONLY`），完成三方差异盘点与 758 项逐项处置；用户决定不新增土耳其语、“打开目录”改为显示/复制路径。
- 2026-11-03：完成批次 1a。
  - 预设：Claude/Codex/Desktop/Gemini/Grok/Hermes/OpenCode/OpenClaw/Pi/MCode 预设按上游最终状态三方合并；保留 Web 的“统一按显示名称 A–Z 排序”注释，丢弃上游赞助/非赞助分段注释；移除 ZetaAPI，删除三语 `code0`/`claudeapi`/`zetaapi` 推广文案。新增 `kimiProviderPresets.ts` 数据（Kimi 应用本身待 2b）。
  - 类型：`ProviderCategory` 增加 `local`，三类表单补“本地”分类标签；OpenCode 模型 `compat` 增加工具/effort 字段；`IconMetadata` 增加 `shape`；同步 `lib/modelMetadata.ts`（GPT 窗口上限）。
  - 图标：保持 Web 布局（内嵌 SVG 在 `extracted/index.ts`，图片在 `local.ts`），补齐预设已引用但 Web 未登记的 20 个 SVG 与 25 个图片图标及其检索元数据；同步上游更新的 5 个 SVG 与 4 个图片 logo。
  - 表单：Claude/Codex/Desktop 预设列表先编号再过滤 `hidden`（`3069b556`），避免隐藏项之后的预设回查错位。
  - 定价：`schema.rs` 依序应用 7 项上游定价提交；修复只作用于仍为旧内置值的行，Web 的 Kimi K3 缓存写入断言随 `bb05f9d6` 更新为 3.00。
  - 暂缓：Codex 预设中的 GitHub Copilot 托管账号条目及其测试依赖批次 3，未引入；`appConfig.tsx`（新应用、模式应用、应用排序）随 2/4/5a 处理；`codingPlanProviders.ts` 的 ZenMux/火山检测与“所有应用注入”随 1c/1d 处理，Web 前后端目前均无 ZenMux/火山额度查询。
  - 测试：上游重写的 Claude/xAI 预设测试改用上游版本；Web 自有目录快照测试（当前预设、Hermes、Desktop 数量与名单）按新数据更新，Hermes i18n 断言只校验名称键（Web 不展示推广文案）。
  - 验证：`tsc --noEmit` 通过；Vitest `tests/config`、`src/config` 及 11 个供应商表单/预设组件测试文件全部通过（28 + 11 个文件）；`cargo test --lib database::` 82 项通过、2 项忽略。改动文件的 Prettier 检查在 LF 规范下通过；`cargo fmt --check` 的差异均位于本轮未改动的既有文件。未运行构建、全量测试与浏览器验收。
- 2026-11-03：批次 1a 提交后完成批次 1b（代理协议）。
  - 应用方式：上游补丁按 `src-tauri/src` → `backend/src` 映射逐个应用，冲突 hunk 按 Web 结构手工改写；Web 的代理与上游早已分叉（转发重试循环、超时链路、无 `CodexChatHistoryStore`/`copilot_optimizer`），所以多数提交都是语义适配，而不是原样套用。
  - 补齐 Web 缺失的底座：`ProxyResponse::Streamed`（子 agent 加密任务流暂存需要）；Responses/Chat SSE 聚合器与无标记 SSE 嗅探（非流式 Claude 请求遇 SSE 时聚合为 JSON，Codex OAuth 非流请求不再强制走流式）；`is_codex_responses_endpoint`；中性失败收尾 `finish_neutral_failure`。
  - 安全：Desktop 网关接受 `x-api-key` 并改为常量时间比较（新增 `subtle` 依赖）；拒绝回环到代理自身的上游地址；本地路由拒绝带 Origin 的网页请求并校验回环监听的 Host，同时移除 Web 遗留的宽松 CORS 层（上游早已移除，前端不直接访问代理端口）。Docker/局域网监听 0.0.0.0 时不校验 Host。
  - 本机推理：localhost/127.0.0.0/8/::1 上游绕过全局代理（转发、测速、流检测、模型拉取）；供应商单独代理仍优先。
  - 依赖：`mio` 锁定升级到 1.2.1（Windows 监听 socket 不被子进程继承），新增 Windows 回归。
  - 表单：Claude/Desktop 表单新增“思考档位”（自动/原样发送/不发送，三语）；OpenAI 格式上游隐藏认证字段（Copilot 除外）；Codex Chat 思考等级重新启用时恢复默认参数名。切换供应商成功后重查失败的 Codex OAuth 额度（Web 无托盘事件）。
  - 转出：`5cc94b8d`（路由切换结果提示，依赖 SwitchModePanel）转入 4；`9403960f`（Copilot 原生 Messages 透传，依赖 supported_endpoints）与 `832fbe65`（浏览器登录测试）转入 3。部分迁移：`6e7811e5` 的 Codex 主推理强度选择器转入 5a；`8686c165` 的“本地”预设分组随 5a 的分组选择器。
  - 测试调整：Codex 压缩 HTTP 回归改为原生 Responses 保留工具定义并断言 `tool_choice: none`；上游依赖 `codex_stack` 测试模块、`CodexChatHistoryStore` 的用例改写为 Web 可运行的单元测试；`tests/config/claudeKeyFields.json` 暂去掉 `modelPicker`，随 `9ec89fe8`（批次 4）恢复；`cf567ca6`（AUTO_MODE_SERVER 投影）提前迁移。
  - 验证：`cargo test --lib` 全量 2718 项通过、5 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 146 个文件 1577 项通过（2 项跳过）；改动的 Rust 文件已 rustfmt，改动的前端文件 Prettier 检查通过。未运行构建与浏览器验收。
- 2026-11-03：完成批次 1c（会话/用量导入）。
  - 整体同步：Codex 会话导入（Web 此前与基线逐字一致）与 Grok Build 会话导入改用上游最终版本，覆盖分页续页、fork 父线程、压缩用量、远端压缩计费、有界 fork 恢复、按字节游标流式读取等 13 项提交；同时带入 `codex_rollout_file`（读取 `.jsonl.zst`，属 5a 的 `8641cd1d`）和 Codex 首字时间估算（属 5b 的 `a0dd3b39`），两者在对应批次再补其余部分。
  - Web 没有上游的 `input_token_semantics` 列与 `sql_helpers`：导入器不写该列；Codex 缓存写入去重对“写入量为 0 的 Codex 代理行”一律按早期代理放行；统计侧的缓存归一随 5b 的 `bc4d1a50` 一并评估。
  - 去重：Codex 会话按代理行 `request_model` 匹配客户端模型别名（导入跳过、逐行过滤、区间 JOIN 三处），`DedupKey` 增加 `data_source`。
  - 计费：Claude 1 小时缓存写入按 1h 价；Codex rollout 缓存写入入库计费；OpenAI 缓存字段显式 0 视为未上报；精确定价查询大小写不敏感；Claude 导入在事务内缓存定价；补 Grok 4.6/4.7 Build 定价。
  - 余额：OpenRouter/Novita/DeepSeek 余额为空不再判为过期，DeepSeek 有币种有余额时隐藏空钱包（解析函数按上游最终版本移植）。
  - 其他：代理用量与错误日志写入移到阻塞线程池；错误信息入库截断到 4096 字符；Gemini CLI JSONL 会话；Grok 用量沉降 60s；Pi 速度估算与子 agent 用量；OpenCode/MiniMax Code 耗时与首字；MiniMax Code 缺模型名恢复；Hermes 在 WSL 时于发行版内读库（仅 Windows）；Claude 会话按 /cd 分组、标题跳过本地命令输出。
  - 不适用：`e5b04221`（Web 不读 macOS Keychain 的 Claude 凭据）。转出：`779063c1` 转入 2c，`4cf15aea` 转入 2b。
  - 验证：`cargo test --lib` 2824 项通过、6 项忽略；`tsc --noEmit` 通过。本机缺少 Linux 交叉 C 工具链，`--target x86_64-unknown-linux-gnu` 检查在 zstd-sys 构建脚本处中止，Windows 专属代码均有 `cfg(windows)` 门控；未运行 Docker 严格验证与浏览器验收。
- 2026-11-03：批次 1d 第一部分（资源/设置/工具，除深链导入与工具卸载两组外）。
  - 设置与同步：设置文件读取失败不再用默认值覆盖（重试、去 BOM、逐字段保留、先备份、原子写，含旧版残留尾巴）；项目切换器默认隐藏；首屏语言按后端设置校正，浏览器语言不在 zh/en/ja 时用英文；WebDAV 可清除本机配置、清单以 octet-stream 上传、大文件传输超时按体积放宽，Skills 恢复失败保留快照。
  - 备份：设置页列出全部备份位置与大小并可删除，路径按 Web 数据目录映射；“打开目录”按用户决定改为复制路径（Skill 主副本目录同样提供复制路径，点击名称复制名称）。诊断日志在 Web 中写到进程标准错误、没有日志文件，`4215f7ee` 判为不适用。
  - Skills：导入时投影到勾选的应用、归档流式落盘并单列下载上限错误、只在 404 时换分支、下载带 User-Agent。
  - MCP：按需连通性检查（新增 rmcp、process-wrap 依赖），Web 用“启动 + 轮询 + 取消”的 HTTP 接口代替桌面的 IPC 通道；url-only 服务器按 http 投影到 OpenCode；Codex 条目去掉 timeout/autoApprove；切换应用启用前拿切换锁。
  - OpenCode 2.0 原生 providers 读写与 JSON 编辑、连通性检查识别 V2 字段；累加式应用写 live 失败时撤回新增行。
  - 终端与环境：Windows 批处理避开非 ASCII 路径、终端使用补全后的用户 PATH 与 fnm 默认 Node、优先 pwsh；Unix 运行时命令补登录 shell PATH、服务启动提高打开文件上限；Unix 不再把继承的进程环境变量报为冲突；Hermes 位于 WSL 时在发行版内启动 dashboard；Pi 用量查询解析 apiKey 的 $NAME 引用；Gemini .env 识别 export 行。
  - 其他：Claude Desktop 状态新增 installed；删除检查不再单看 DB 的 is_current；项目快照记录“没有启用的提示词”；/apps/anthropic 地址追加 compatible-mode 模型端点；smol-toml 升级到 1.9.1。
  - 转出：供应商页头搜索、卡片设 OpenCode 默认模型、应用排序、Skills 增量发现、终端对话框选项（3 项）、应用页开关配色测试转入 5a；切换/模式日志、终端剔除代理设置转入 4。不适用：土耳其语 6 项、测试 HOME 覆盖、Skill 测试 HOME 隔离、搜索路径去重复杂度、UI 线程等锁。
  - 验证：`cargo test --lib` 2893 项通过、6 项忽略；前端全量 Vitest 149 个文件 1606 项通过；`tsc --noEmit` 通过。
- 2026-11-03：批次 1d 第二部分（工具生命周期与卸载）。
  - 应用方式：`commands/tool_management.rs` 的同名函数、结构、常量整体同步到上游最终 `misc.rs`，补齐缺失条目；卸载与 Node 版本要求拆为 `tool_uninstall.rs`、`tool_node_requirement.rs` 子模块（与上游同源）。上游 misc 测试模块中与工具生命周期相关的部分整体并入（终端启动类测试留在 Web 的 `misc.rs` 范围外），测试中的子进程模块路径改为 `commands::tool_management`。
  - 卸载：新增 `/api/tools/uninstall-plan` 返回每处安装的卸载计划或需手动卸载的原因，`/api/tools/action` 支持 `uninstall` 并在生命周期锁内重新生成计划比对；应用页增加卸载按钮、选择安装位置的确认框与手动卸载命令框。Web 浏览器与服务端可能不在同一平台：手动命令的宿主平台取服务端探测结果，Hermes Windows 残留提示按卸载路径判断，均不读浏览器 UA。新组件按 Web 现有样式改写（上游新设计令牌随 5a）。
  - 其他：升级 npm 工具前检查 Node 版本；npm 12 下允许 OpenCode/Grok Build 的 postinstall；只在 `--version` 真正报错时重装 Codex；存在但不输出版本的 CLI 报告为不可运行；环境检查不拉起 OpenCode Desktop；搜索路径改用 IndexSet 去重（`76f99d41` 由不适用改为已迁移）。Web 的 `run_detected_tool_command_with_timeout` 换成上游实现，补上 WSL 内执行与批处理 canonical 路径处理。
  - 生命周期后端随最终版本已包含 Kimi/Antigravity/Oh My Pi/DeepSeek Harness，前端工具列表在 2b–2e 接入。
  - 验证：`cargo test --lib` 3031 项通过、6 项忽略（`omp_search_paths_include_the_bun_global_bin` 在 PATH 含 `~/.bun/bin` 的机器上属环境性失败，去掉该 PATH 项后通过）；前端全量 Vitest 149 个文件 1631 项通过、2 项跳过；`tsc --noEmit` 通过。
- 2026-11-04：批次 1d 第三部分（深链导入，12 项）。
  - 解析阶段直接拒绝 `configUrl`：Web 不再在浏览器内拉取远程配置，与上游收紧后的行为一致（Web 原有行为变化）。
  - Codex/Grok Build 链接配置按白名单保留（新增 `src/lib/deeplink/tomlLink.ts`、`linkRules.ts`），拒绝鉴权/网关/环境头等敏感字段；供应商链接新增 grokbuild/hermes/pi，`apiFormat` 按应用换算，拒绝累加式应用的环境/文件展开写法。
  - 确认框新增“导入后立即切换 / 添加到应用 / 启用提示词”；后端新增 `ProviderService::add_without_switching`，`POST /api/providers/:app` 支持 `withoutSwitching`。
  - 用量：带脚本时默认启用用量查询；套餐地址无脚本时默认启用 token_plan 额度（适用范围沿用 Web 新建供应商规则）；额度失败文案统一为“额度查询失败”。
  - OpenCode：导入 ID 改为 ASCII slug + 随机后缀，编辑时保留旧 ID（与 1d 第一部分的 V2 原生 ID 豁免合并为上游最终条件）；导入后刷新 live ID 与运行时模型缓存。
  - 不适用：`bee47fdf`（依赖自定义图标上传，且服务端代下载增加 SSRF 面）、`8b09732a`（Web 套餐列表无对应项）。
  - 验证：`cargo test --lib` 3033 项通过、6 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 150 个文件中 1673 项通过、2 项跳过，1 项失败为 `SessionManagerPage` “今天”分组在 0–2 点运行时的既有时间相关问题（夹具用 `now - 1h`），与本次改动无关。
- 2026-11-04：完成批次 2a（Pi 内置 MCP）。
  - 后端：新增 `mcp/pi.rs`（与上游同源），`McpApps.pi` 与 DAO 的 `enabled_pi` 列；同步、删除、开关、全量导入接入 Pi，Pi 与 MiniMax Code 一样先写 `~/.pi/agent/mcp.json` 再提交数据库，失败时恢复文件。
  - 数据库：Web 自有版本链 v16 → v17 增加 `mcp_servers.enabled_pi`（对应上游 v19 → v20）。从桌面端迁入时，v17–v19 的库版本号不低于 Web 当前版本、不会再跑这条迁移，但还缺该列，因此在建表阶段兜底补列，并补了对应回归；“未来版本”迁入用例改用 v18。
  - 前端：MCP 面板和表单加入 Pi 列（`MCP_APP_IDS` 与 `SKILLS_APP_IDS` 拆开，Skills 列顺序不变）；开关失败的 Pi 规则错误（SSE、名称、仅 `-`/`_` 不同的重名）按三语提示。深链 MCP 的 `apps` 接受 `pi`，并修正合并已有服务器时丢失 Pi 勾选的问题（批次 1d 深链迁移时 Web 尚无 Pi MCP）。
  - 测试：上游 `tests/mcp_commands.rs` 的 6 个 Pi 用例改写为 `services::mcp` 单元测试；Web 资源重同步测试中“Pi 不支持”的断言改为 Claude Desktop。
  - 验证：`cargo test --lib` 3046 项通过、6 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 151 个文件 1676 项通过、2 项跳过。
- 2026-11-04：完成批次 2b（Kimi Code，21 项）。
  - 后端：Kimi 专属模块（`kimi_config`、`kimi_session`、`mcp/kimi`、`services/kimi_oauth`、`session_usage_kimi`、`session_manager/providers/kimi`）取上游最终版本；`AppType::Kimi` 接入应用配置、MCP（先写文件后提交）、Skills（同 MiniMax Code 的部署方式）、提示词、会话浏览与删除、用量导入、供应商服务（列表合并原生节点、官方卡只可改模型、“添加”不改默认模型、切换改 default_model）。Web 无 `input_token_semantics` 列，Kimi 用量导入不写该列；无托盘，官方账号命名按设置里的界面语言。
  - 数据库：Web 版本链 v17 → v18 为 `mcp_servers`、`skills` 增加 `enabled_kimi`（对应上游 v21 → v22）；建表阶段的桌面端快照兜底补列改为按列清单处理（`enabled_pi`、`enabled_kimi`）。
  - 接口：Kimi 官方登录走 `/api/auth/kimi/{status,start,poll,cancel,remove,quota,models,use-account}`，管理器为进程级单例；`POST /api/providers/:app/live-config/:id` 为 Kimi 的“添加”；models.dev 改由后端代理拉取（`GET /api/usage/models-dev`，上游 5c14e917）。
  - 前端：Kimi 表单、官方账号组、额度页脚取上游最终版本并按 Web 样式改写；Web 没有从表单跳到授权中心的入口，账号登录预设直接在表单里显示 Kimi 账号组；卡片沿用 OpenClaw 式“添加/移除 + 设为默认”，仍在 Kimi 中的官方卡不能删除和复制；模型拉取用 Web 的“获取模型”按钮与内联勾选（上游的弹出式选择器随 5a）。授权中心账号组按 93a3e8ec 始终在标题行显示“添加账号”。应用页工具列表加入 Kimi Code（安装/升级/卸载）。
  - 提前落地：`modelMetadataFill.ts` 取上游最终版本，Hermes `supports_vision`、Codex 不关图片输入、OpenCode `reasoning` 的补全逻辑已在，对应 5a 提交只需补表单部分。
  - 转出：`3d4a3da3` 的 MiniMax Code / Oh My Pi YAML 编辑框随 2d；`b61e2767` 的弹出式模型选择器随 5a。不适用：`d6db0c75`（Web 按钮无按压缩放）。
  - 测试：上游 `tests/kimi_commands.rs` 8 个用例改写为 `services/provider/kimi_tests.rs`；前端 Kimi 测试按 Web 的平铺预设选择器、内联登录与 `runtime.local` 调整；`session_usage_kimi` 的速度统计断言按 Web 现状改写，5b 迁移 a0dd3b39 时恢复上游断言。
  - 验证：`cargo test --lib` 3112 项通过、6 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 156 个文件 1740 项通过、2 项跳过。
- 2026-11-04：完成批次 2c（Antigravity，29 项）。
  - 后端：Antigravity 专属模块（`agy_config`、`mcp/agy`、`services/agy_account`、`services/provider/agy_direct`、`session_usage_agy`、`subscription_agy`、`session_manager/providers/agy`）取上游最终版本；`AppType::Agy` 接入应用配置、MCP（先写 `mcp_config.json` 后提交）、Skills（`~/.gemini/config/skills`）、提示词（`AGENTS.md`）、会话浏览（不支持删除）、用量导入。供应商只存数据库、不写 live，不支持“切换”，卡片主按钮为“打开终端”：官方卡先切到绑定账号，API Key 卡经临时环境文件（Unix 0600，用后删除）或 `set` 行（Windows）注入 Key 与地址。新增依赖 `prost 0.14`（与上游一致）。
  - 数据库：Web 版本链 v18 → v19 为 `mcp_servers`、`skills` 增加 `enabled_agy`（对应上游 v20 → v21），建表兜底补列清单同步加入。
  - 接口：官方账号走统一的 `/api/auth/*`（`agy_oauth`，浏览器登录，`device_code` 即登录流程 ID）；另有 `/api/auth/agy/{quota,running,supported}` 与 `POST /api/providers/agy/models`。切号依赖 macOS 钥匙串，登录回调落在服务端本机：服务端不是 macOS 时前端隐藏授权中心分组和表单账号选择，官方卡按 agy 当前登录查额度。
  - 用量计价：Web 原先只按模型 ID 精确匹配定价，随本批移植上游的候选匹配（去命名空间、日期/版本/推理档后缀、前缀匹配），agy 的模型名才能计价。Web 无 `input_token_semantics` 列，agy 用量导入不写该列。
  - 前端：Gemini 风格表单经 `usesGeminiStyleForm` 复用给 agy（地址可选、模型优先读配置）；卡片显示模型、按绑定账号显示额度，合并成组的额度列整列做成下拉列出四档（276eff8d）；授权中心无用户码登录显示说明与“重新打开登录页”；按 ee83fd89 去掉账号组标题行的“删除全部账号”（xAI 表单内的按钮保留）；Apps 页加入 Antigravity CLI；深链接受 agy 的供应商/MCP/提示词。
  - 转出：`9a10e4f7` 的 OpenTerminalDialog 随 5a；`6fabe63a` 的会话日志标签随 5b（`providerLabel.ts`）。不适用：#8268 旧启动器清理（Web 从未安装，函数保留为 dead_code）、`03ec9dbb` 的 WSL2 工作流。
  - 验证：`cargo test --lib` 3168 项通过、6 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 160 个文件 1761 项通过、2 项跳过；改动的 Rust 文件逐个 rustfmt 检查通过。
- 2026-11-04：完成批次 2d（Oh My Pi，15 项，另含 `3d4a3da3` 的 YAML 编辑框）。
  - 后端：Oh My Pi 专属模块（`omp_config`、`mcp/omp`、`services/provider/omp`、`session_usage_omp`、`session_manager/providers/omp`）取上游最终版本；`AppType::Omp`（累加式）接入应用配置、MCP（`mcp.json` 与数据库一起提交，取消勾选时保留禁用条目并写入 `disabledServers`）、Skills（同 Pi，以 `agent/skills` 原生目录存在性为准、不存库）、提示词（agent 目录的 `AGENTS.md`）、会话浏览与删除、用量导入、目录覆盖（`ompConfigDir`）、流式检查（同 Pi）。omp 共用的 Pi 会话读取器与 Pi 用量导入取上游最终版本（含子代理用量 #8318/#8386）；Web 的 `proxy_request_logs` 没有 `input_token_semantics`、`pricing_model` 列，插入时去掉。
  - 数据库：Web 版本链 v19 → v20 为 `mcp_servers` 增加 `enabled_omp`（对应上游 v22 → v23），Skills 不加列；建表兜底补列清单同步加入。
  - 接口：`GET /api/omp/state`（同 Pi 状态的形状）；`PUT /api/providers/:app/:id/usage-script`：Pi 与 Oh My Pi 的用量脚本只更新数据库，不用旧快照覆盖外部改过的原生配置（Pi 原先走整条供应商更新）；`POST /api/providers/omp/import-live`。
  - 前端：omp 复用 Web 的 PiProviderForm（预设 `ompProviderPresets.ts`、models.yml YAML 编辑框、模型自动发现）；MiniMax Code 表单增加 `custom_provider.<key>` YAML 编辑框；新增依赖 `yaml 2.8.1`（与上游一致）与 `helpers/yamlNode.ts`。MCP/Skills 计数条下方显示 omp 自动发现说明；导入技能时隐藏 omp；深链 MCP 接受 omp，供应商与提示词链接不接受（与上游一致）。
  - 测试：上游 `tests/mcp_commands.rs` 3 个、`tests/provider_service.rs` 1 个、`tests/prompt_live_sync.rs` 1 个 omp 用例改写为 Web 单元测试，另补 v19 → v20 迁移用例。
  - 转出：`providerLabel` 与用量页筛选随 5b（accc4489）；`3d4a3da3` 的 DSH 部分随 2e。上游 AddProvider/EditProvider 的“可提交”用例因 Web 无 `onSubmitReadyChange` 未迁移。
  - 验证：`cargo test --lib` 3205 项通过、6 项忽略；`tsc --noEmit` 通过；前端全量 Vitest 163 个文件 1776 项通过、2 项跳过（中途一次全量运行中 `modelsDevAutoSync` 偶发超时，单独与再次全量运行均通过）；改动的 Rust 文件逐个 rustfmt 检查通过。
- 2026-11-04：完成批次 2e（DeepSeek Harness，7 项，另含 `3d4a3da3` 的 DSH 部分）。
  - 后端：DSH 专属模块（`dsh_config`、`mcp/dsh`、`services/dsh_account`、`session_usage_dsh`、`session_manager/providers/dsh`）取上游最终版本；`AppType::Dsh`（累加式，同 Kimi / MiniMax Code 的原生节点：供应商与 MCP 写各 profile 的 `cordis.patch.yml` 并与数据库一起提交；列表读取与全量同步时给新出现的 profile 补上已管理的供应商与 MCP）接入应用配置、MCP、Skills（`$DSH_HOME/skills`，存开关）、提示词（`$DSH_HOME/AGENTS.md`）、会话浏览（不可删除；zstd 会话的内容块按解压后的偏移读取）、用量导入。DSH 没有代理适配器，连通检测直接拒绝（上游同样）。DSH 的增删改与列表只给 DSH 加按应用的锁，不改动 Kimi 既有的锁。`proxy/http_client` 增加不跟随重定向的 `no_redirect`（带自定义凭据头的账号请求用），`mcp::validation` 改为 crate 内可见。
  - 数据库：Web 版本链 v20 → v21 为 `mcp_servers`、`skills` 增加 `enabled_dsh`，为 `session_log_sync` 增加 `parser_state`（对应上游 v23 → v24）；`SyncCursor` 带上 `parser_state`。Web 请求日志没有 `pricing_model`、`input_token_semantics` 列：DSH 的 `<路由>:<模型>` 仍按裸名计价，但导入时没有定价、之后才补价的前缀模型无法回填费用，对应上游用例未迁移。
  - 接口：DeepSeek 账号 `GET/DELETE /api/dsh/account`、`POST /api/dsh/account/login`、`GET/DELETE /api/dsh/account/login/:flowId`。浏览器登录的回调监听在服务端本机回环地址，只有浏览器与服务端在同一台机器时才能完成。
  - 前端：dsh 接入各处应用清单，表单走 McodeProviderForm（保留 JSON 编辑框，与上游一致），DeepSeek 官方登录预设与账号组（余额、浏览器登录轮询）、授权中心分组；`App.tsx` 恢复上次应用时按 `APP_IDS` 校验（此前清单漏了 kimi/agy/omp，刷新后不会恢复到这三个应用）；用量脚本弹窗对 mcode/dsh 读 `options.{baseURL, apiKey}`（同上游）。
  - 格式：发现此前各批次用 stdin 管道跑的 `rustfmt --check` 即使有差异也返回 0，此前记录的“rustfmt 检查通过”不成立；本批改为按输出判断，重新检查迁移开始以来改动的全部 Rust 文件，格式化了 11 个此前未格式化的文件（各批次遗留，非本批内容）。
  - 测试：上游 `tests/dsh_commands.rs` 3 个用例改写为 `services/provider/dsh_tests.rs`，另补 v20 → v21 迁移用例。
  - 转出：用量页 `providerLabel` 与筛选随 5b（6fa328f3）；预设副行“用 DeepSeek 账号登录”随 5a（1f21c289）；DSH 模型方言专用控件随 5a（3d4a3da3）。
  - 验证：`cargo test --lib` 3269 项通过、6 项忽略（一次全量运行中 `services::proxy::tests::codex_takeover_without_provider_selects_a_local_authenticated_route` 偶发失败，单独运行 3 次与再次全量运行 2 次均通过；该用例读全局设置且未串行化）；`tsc --noEmit` 通过；前端全量 Vitest 166 个文件 1788 项通过、2 项跳过。
- 2026-11-04：完成批次 3a（ChatGPT 浏览器登录与授权中心修复，5 项）。
  - 后端：`codex_oauth_auth.rs` 按上游差异更新（换 refresh token 的永久失败判定此前批次已在），新增 `codex_oauth_auth/browser.rs`（上游最终版本）；`auth_start_login_internal` 与 `POST /api/auth/start-login` 接受 `loginMethod`（`device_code` / `browser`，浏览器登录只给 Codex OAuth）。
  - 浏览器登录的回调监听在服务端本机的 1455 端口，浏览器与服务端不在同一台机器时完成不了：Web 默认设备码登录（上游默认浏览器），部分禁用设备码的工作区可在账号组标题行改为浏览器登录。
  - 前端：登录方式选择、轮询防重叠、额度列定宽对齐、跳转分组只滚面板正文、页头“全部刷新”（Claude 官方账号随 3b 接入）。
  - 验证：Codex OAuth 后端用例 64 项通过；`tsc --noEmit` 通过；前端全量 Vitest 167 个文件 1805 项通过、2 项跳过。
- 2026-11-04：完成批次 3b（Claude 官方订阅账号，16 项，另含 12078d5b 的 Claude 部分）。
  - 后端：`services/claude_account`（账号目录、快照与切换日志、钥匙串/凭据文件、`claude auth login` 登录与 `/usage` 刷新）与 `services/provider/claude_official` 取上游最终版本；`commands/claude_account.rs` 改为 Web 的进程单例管理器，服务启动后补完上次中断的登录切换并同步各账号目录。切官方卡、编辑器保存、退出代理写 live 时先切 Claude Code 登录、写失败换回（`with_login_switch`），并清掉以前开发版写进 settings.json 的账号目录（`JsonPatch::remove_when`）；MCP 增删与编辑器保存后同步各账号目录；绑号卡打开终端时以 `CLAUDE_CONFIG_DIR` 启动（agy 的环境变量启动命令泛化为 `env_launch_command`）。`mode::controller` 增加 `lock_settled`。
  - 授权中心：`claude_official` 接入通用 `/api/auth/*`（没有默认账号，`set-default` 拒绝）；Web 一律不在服务端开浏览器（等同上游 `copy_link`），授权页地址交给前端，浏览器回不到服务端本机时把落地页地址或代码贴回 `POST /api/auth/claude/paste`，因此浏览器与服务端不在同一台机器时也能完成登录。另有 `GET /api/auth/claude/{quota,default-plan,login-switch}`。增删账号、重新登录后按新账号表重写直连官方卡的 live。
  - 额度：绑号卡按账号查（令牌过期时在账号目录跑 `claude -p /usage` 借 Claude Code 的缓存）；默认登录的套餐在 macOS 先读钥匙串。Web 没有托盘与额度缓存，相关部分不适用。
  - 跨平台：用 Docker（rust:1-bookworm）补跑 Linux `cargo check --lib --tests`，发现此前批次在非 Windows 下才编译的代码有缺失：`mise_shim_target`、`npm_scripts_env_prefix` 未迁移，`PathBuf` 只在 Windows 引入，Kimi 会话恢复命令引用了 Web 没有的 `session_manager::terminal`，agy 测试引用了 Web 没有的 `services::{ProviderService, SkillService}` 重导出；均已修正，Linux 检查通过（只剩 Web 不用的 Unix 终端辅助函数 dead_code 警告）。macOS 专属代码仍无法在本机编译验证。
  - 测试：上游 `tests/provider_service.rs` 的账号目录同步用例改写为 `claude_runtime_tests`；订阅额度补套餐与缓存用例。
  - 转出/不适用：托盘切卡事件与托盘额度缓存（5cc6c47f、67cce7ad 的托盘部分）。
  - 验证：`cargo test --lib` 3351 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 173 个文件 1836 项通过、2 项跳过。
- 2026-11-04：完成批次 3c（Copilot 托管账号路由，2 项，均为部分迁移）。
  - 后端：Codex 卡按 `providerType = github_copilot` 识别 Copilot（自建中转保留自己的 key 与地址），固定走 `api.githubcopilot.com`，令牌取托管账号；代理按账号 `/models` 的 `supported_endpoints` 为每个模型选 Responses 或 Chat，可用 `meta.codexCopilotApiFormat`（`auto` / `openai_responses` / `openai_chat`）显式覆盖。Web 的 `forward()` 结构与上游不同，本次请求实际使用的上游格式记在每请求的 `RequestForwarder` 上，opaque state 重试与 Codex 响应转换据此进行。`proxy/copilot_optimizer.rs` 取上游最终版本（内联 Web 没有的 `codex_chat_history` 辅助函数），Codex 路径按上游默认只做请求分类与 interaction ID。Anthropic 模型声明 `/v1/messages` 时原生透传，Copilot 纳入 thinking 签名 / budget 整流。Codex 模型目录新增 Copilot 档（关闭 Codex 托管的 web_search）。
  - 接口：无新增路由；`POST /api/providers/codex/editor/view` 可选带 `meta`（编辑已存卡片时沿用其 meta）；Copilot 模型接口补 `context_window`、`supported_endpoints`、`supports_parallel_tool_calls`、`reasoning_effort`。
  - 前端：Codex 预设新增 GitHub Copilot；表单选择账号、不显示 key 与地址、协议选择（含自动）、拉取模型填目录；三种语言文案。
  - 不适用：Claude 路径的 Copilot 优化器与企业版动态端点（基线前 Web 已移除，含 9403960f 只在优化器里做的 thinking 剥离）；新增卡片的草稿投影 meta。
  - 验证：`cargo test --lib` 3453 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 176 个文件 1859 项通过、2 项跳过。
- 2026-11-04：批次 4 规划。上游 54 项以 3-way 方式试应用，只有 4 项能直接合入：Web 的 `mode/controller.rs` 是独立的精简实现，上游的 SwitchModePanel / ModeDialog / CodexStaleClientsNotice 等模式界面在 Web 里对应 `ProviderList` 内的模式面板（`AppModePanel` / `useAppMode`）。因此按行为手工迁移，并按共享文件顺序拆为 4a（Codex 登录、官方卡与配置）、4b（Codex 聚合 / Stack）、4c（Claude 与 Claude Desktop 路由）、4d（通用模式与代理：切换日志、独立连接地址、回直连确认、路由切换提示、拖拽排序、额度保护）。
- 2026-11-04：完成批次 4a（Codex 登录、官方卡与配置，14 项：10 项已迁移、4 项部分迁移）。
  - 登录：按「用户 + ChatGPT workspace」区分登录（暂存加版本号并迁移旧暂存）；分离时不删官方登录，进入代理时还回最近暂存且未过期的登录；官方卡编辑器显示切换后盘上的 auth.json。
  - 配置与目录：顶层 `base_url` 归一为 `[model_providers.custom]`；显式配置的模型在目录里可见；第三方镜像 GPT 行接受显式上下文窗口；Stack 成员行 comp_hash 按工具协议分组；模型列表取不到 codex 时兜底桌面版自带 CLI；官方模型列表取不到时给出原因（`noticeReasons`，模式面板逐条显示），恢复后自动重写客户端。
  - 其他：Codex 状态库在 WSL 路径上跳过；额度未使用时不显示重置倒计时；OpenRouter 上 DeepSeek V4 Flash 0731 的文本模型去图。
  - 未迁移：a94f997f 在 handlers 层把输入超限改写为 `response.failed` 流（Web 的 Codex 代理原样透传上游错误，没有错误规整层）；依赖 dc93c496 的 Outdated 判断与路由行 comp_hash（8a0eddb0）随 4b。
  - 验证：`cargo test --lib` 3485 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 176 个文件 1865 项通过、2 项跳过。
- 2026-11-04：完成批次 4b（Codex 聚合 / Stack，16 项：12 项已迁移、2 项部分迁移、2 项不适用）。
  - 目录：`model_catalog_json` 当普通关键字段跟目标供应商走，被行里指针挡住时可一键改用 CC Switch 的目录；第三方条目一律用内置经典工具模板；官方列表按本机在用的最新 Codex 版本取、不合格时提示 `officialModelsOutdated`；路由行与成员行的 comp_hash 按工具协议分组；代理路由表保留压缩能力、重试与流超时键。
  - 设置（设备级，新增）：`codexStackClassicTools`（默认开）、`codexStackSubagentModel`、`codexStackSubagentReasoningEffort`、`codexStackAutoReviewModel`，在模式面板的聚合设置区（`CodexStackSettings`）编辑；保存设置时聚合设置变了立即重写 Codex，失败回滚并报错。Codex 卡新增子代理模型 / 推理强度与自动审批模型。
  - 旧客户端提示：账号与目录检测不再限于聚合模式；Windows 按 `daemon.pid` 判断守护进程，看不到的客户端退化为「上次关掉提示后变了」，可关掉提示。
  - 接口：`POST /api/proxy/codex/adopt-catalog`、`POST /api/proxy/codex/stale-clients/acknowledge`、`GET /api/settings/codex-forces-multi-agent-v2`。
  - 不适用：Stack 表单布局的帮助提示（4f08989a、84ca4f00，Web 无该布局）；上游 ModeTabs / StackSettingsSheet 外壳与 docs/ 用户手册。
  - 验证：`cargo test --lib` 3500 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 178 个文件 1878 项通过、2 项跳过。
- 2026-11-04：完成批次 4c（Claude 与 Claude Desktop 路由 / 聚合，17 项：13 项已迁移、4 项部分迁移）。
  - Claude Desktop 并入设备级直连 / 路由 / 聚合模式（模式记在 `live-state.json`，不再由卡片决定）：路由模式写指向本地 `/claude-desktop` 的网关 profile；直连模式拒绝要经路由的卡；聚合成员发布 `claude-fable-ccs-<数字>` 模型并带「供应商 · 上游模型」说明；启动时把旧版映射卡迁成路由模式、直连指针改为官方卡（Web 不预置官方卡，迁移时没有就补一行 `claude-desktop-official`）。模式面板对 Desktop 开放，`/api/proxy/apps/:app/mode` 与聚合成员接口接受 `claude-desktop`。
  - 基线缺口：Web 的 `claude_desktop_config.rs` 比 a189980f 基线还旧（缺 Opus 5 / Fable / 4.8 别名路由、严格模型 id 校验、[1M] 后缀剥离、角色关键词兜底、MiMo thinking 规整、`coworkEgressAllowedHosts` 等），本批取上游最终版本，只有网关地址仍按 Web 的同步配置（独立连接地址随 4d）。
  - Claude Code：聚合模式用 `modelPicker` 列出聚合模型；路由占位只写 `ANTHROPIC_AUTH_TOKEN`；5.5 上游用目录 id；Haiku 档可声明 1M；供应商终端的临时 settings 挡住代理与聚合留下的键。
  - 修正：Desktop 加入 `PROXY_APPS` 后 `ProviderService::switch` 已持有服务锁，直连切换里再次加锁会死锁，已去掉重复加锁。
  - 不适用：托盘、项目 Profile 命令、上游 ModeDialog 换默认预览；“需要路由”标签随 5a。
  - 验证：`cargo test --lib` 3539 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 178 个文件 1880 项通过、2 项跳过。
- 2026-11-04：完成批次 4d（通用模式与代理，7 项：5 项已迁移、2 项部分迁移），并按用户认可补两项。
  - 连接地址：设备级 `proxyClientHost`（存本机 settings.json，不进同步库），写进客户端的路由地址优先用它；保存后重写各接上路由的应用；`GET/PUT /api/proxy/client-host`，在代理面板编辑；浏览器防护按它放行。
  - 模式：回直连前确认（列出直连那家与要改写的客户端文件）；路由下的切换返回实际结果（`RouteSwitchResult`），只有客户端文件改写了才提示重启；切换与模式变化写 `[SWITCH]` / `[MODE]` 日志；排序只改 `sort_index`。
  - Codex 官方额度保护（默认关，阈值 95% / 98%），在设置页「认证」里编辑；达到阈值返回本地 403、不故障转移。
  - 补充一：a94f997f 的 handlers 部分，Codex 流式请求遇到上游输入超限时改回 `response.failed`（`context_length_exceeded`），Codex 可自动压缩；不引入通用错误规整层。
  - 补充二：旧客户端检测的进程表读数缓存 5 秒（模式面板每 3 秒轮询不再每次跑 `ps`），重启守护进程后清缓存。
  - 不适用：前端确认框日志（Web 无前端日志通道）、聚合名单随拖动重排（Web 聚合成员按名称排序）、docs/ 用户手册。
  - 验证：`cargo test --lib` 3563 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 181 个文件 1908 项通过、2 项跳过。
- 2026-11-04：批次 5a 规划。137 项按界面区域拆为 5a1（Codex / Claude 表单与模型选择器，39）、5a2（其他应用表单与预设，19）、5a3（供应商列表、卡片、终端与图标，40）、5a4（外壳、设置、应用页、Skills、MCP，39），顺序执行。
- 2026-11-04：完成批次 5a1（29 项：23 项已迁移、2 项部分迁移、4 项不适用（含 fe831f0a）；其余 10 项转入 5a1b）。
  - Claude 表单：快捷开关逐项带帮助提示，去掉 Teammates 与思考强度开关，新增「关闭 auto mode 服务端检查」并为新增的第三方卡默认写上；Copilot 卡上游格式显示为按模型自动选择。
  - Codex 表单：模型目录行加思考档位列与拖动换序；子代理并发上限；托管 Copilot 不再存 `apiFormat` 代表值；删除 ChatGPT 托管账号时解绑绑着它的 Codex 卡。
  - 通用：取模型带上配置的请求头 / Header 覆盖；JSON 编辑器与表单字段互不覆盖；TOML 表头识别带引号与数组表头；只规整作定界符的弯引号；编辑时也显示「获取 API Key」链接；API Key 输入框关闭自动大写。
  - 转入 5a1b：取模型对话框（91765357、f7244745、8347e1ab、644b7d5c）、表单布局向上游收敛（0dae89e2、9f7ac1fa、36e2ce2c、f59bba54、1e045d2e）、协议提示跟随实际模式（e615a6f4）。这些是上游后来的表单设计，不是 Web 的取舍，按上游收敛。
  - 验证：`cargo test --lib` 3564 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 190 个文件 1998 项通过、2 项跳过。
- 2026-11-04：完成批次 5a1b（10 项：8 项已迁移、2 项部分迁移；05034a4e 改为已迁移）。这些是上游后来的表单设计，按上游收敛。
  - 取模型改为选择弹窗（勾选加入、取消移除，显示窗口 / 推理 / 图片），Codex、Claude 聚合模型、OpenCode / MiniMax Code、Kimi 统一使用。
  - Codex 表单：「模型列表」常驻于连接信息之后，第一行即默认模型，列表为空时才显示默认模型框；去掉 Web 为 #6 加的「自定义模型目录」开关——列表留空即不生成目录，目录仍不决定是否需要路由，#6 的回归用例保留；`docs/claude-codex-routing-guide-zh.md` 同步。
  - 说明文字收进帮助提示；完整 URL 开关移入高级选项；直连模式下选了要转换的格式时按卡片是否在用给出后果提示。
  - 验证：仅前端改动；`tsc --noEmit` 通过；前端全量 Vitest 191 个文件 2016 项通过、2 项跳过。
- 2026-11-04：完成批次 5a2（19 项：17 项已迁移、2 项部分迁移）。
  - OpenCode / MiniMax Code / DeepSeek Harness：额外选项按行合并进已存选项，没改的行保留原值与类型；模型编辑器改为 Pi / Kimi 的行布局（推理、图片输入、上下文与最大输出），DSH 增加结构化思考档位与逐模型兼容项；重新渲染时保留已拉取的模型。
  - OpenClaw：开关 User-Agent 时保留自定义请求头，直接改 JSON 请求头时开关随之同步。
  - Hermes：逐模型声明图片输入；标识是 Hermes 内置供应商 ID 时警告；MiniMax 预设预填不撞名的标识。
  - Pi / omp：标识重复时提示并拦住保存；取模型改用共用弹窗；请求头与模型自动发现收进默认收起的「高级选项」，兼容项仍在完整 JSON 里改。
  - Claude Desktop：接入方式说明改为一句白话；托管 OAuth 卡也能取模型；手填 Copilot 地址时按 Copilot 自动选格式。
  - 预设与检测：OpenCode Go 用量检测同时认 `/inference/go` 入口；MCP time 预设补三语文案。SiliconFlow 两个区域合成一行的用例依赖预设分组选择器，随 5a3。
  - 验证：`cargo test --lib` 3564 项通过、6 项忽略；`cargo check --locked --bin cc-switch-web` 通过；Linux `cargo check --lib --tests` 通过；`tsc --noEmit` 通过；前端全量 Vitest 198 个文件 2136 项通过、2 项跳过。
