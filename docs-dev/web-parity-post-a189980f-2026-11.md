# Web 跟进 cc-switch v4.0.1–v4.0.25 差异清单

> 状态：批次 1a 已完成（已迁移 87、部分迁移 2）；其余待迁移 507 项、不适用 162 项。需决策项已由用户确定。
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
| 1b | 代理协议转换、流式、错误与路由守卫 | — | 56 |
| 1c | 会话读取与用量导入（Codex/Pi/OpenCode/Grok/MiniMax/Hermes） | — | 41 |
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
| `cddb3b68` | v4.0.1 | fix(sessions): read Gemini CLI JSONL chat files (#7866) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `55ef871f` | v4.0.1 | perf(shell): animate the sidebar edge on the compositor instead of width (#7860) | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx`、`hooks/useSidebarCollapsed.ts` | 待迁移 |
| `30318ac7` | v4.0.1 | fix(proxy): report zero-usage response.incomplete as api_error, not max_tokens (#7868) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `a33c156e` | v4.0.1 | fix(shell): match the sidebar's bottom divider to the one above it (#7874) | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `636e1616` | v4.0.1 | feat(opencode): mark reasoning models so OpenCode offers thinking variants | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `df08bb15` | v4.0.1 | fix(grokbuild): use preset apiKeyUrl for the get-API-key link | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f6387b86` | v4.0.1 | style(quota): put the reset-credits chevron in the countdown slot | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `259d807f` | v4.0.1 | feat(settings): add a help tip explaining the Claude Code onboarding skip | 5a 供应商与全局 UI | 需新建或映射：`components/settings/sections/AppConfigSection.tsx` | 待迁移 |
| `43077f55` | v4.0.1 | fix(usage): stop parented Codex sync from deadlocking on a poisoned cache | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `d115fddb` | v4.0.1 | fix(codex): skip Codex state DBs on WSL paths Windows cannot lock | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `e4960bba` | v4.0.1 | test(wsl): run the WSL2 nightly as a lib suite that can pass on 9P | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `f9e2ebbb` | v4.0.1 | ci(release): fail fast on notarization rejections and missing updater signatures | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `f344af02` | v4.0.1 | ci: install the Rust toolchain pinned in rust-toolchain.toml | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `c62eab2b` | v4.0.1 | build(release): compile with 16 codegen units | — | 上游发行构建并行单元参数；Web 构建配置独立维护 | 不适用 |
| `ef633b57` | v4.0.1 | test: fix the two clippy lints in test code | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `b544bc27` | v4.0.1 | ci: run backend tests under cargo-nextest and cache deps with rust-cache | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `e95c5e68` | v4.0.1 | ci: path-filter pushes to main too, with a weekly full run | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `ee66be22` | v4.0.1 | ci(release): build macOS arches in parallel and add manual dry runs | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `d36bb7a9` | v4.0.1 | chore(release): v4.0.1 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `4804b723` | v4.0.1 | docs(release): add v4.0.1 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `92fa72c7` | v4.0.2 | fix(mcp): run the time preset with uvx mcp-server-time (#7863) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c2c24b8c` | v4.0.2 | fix(usage): drop the gray border inside the active range field and space the picker below the presets (#7864) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `7f3fbd06` | v4.0.2 | test(pi): pin image input on official DeepSeek V4.1 Flash preset (#7865) | 1d 资源/设置/工具 | 仅测试/图标变更，随功能迁移 | 待迁移 |
| `5c573f19` | v4.0.2 | fix(proxy): whitelist fields carried by reasoning replay envelopes (#7876) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `d455dd85` | v4.0.2 | feat(mcp): sync MCP servers to Pi 1.0's built-in MCP (#7862) | 2a Pi MCP/迁移基线 | Pi 1.0 内置 MCP 同步；Web 需新增 enabled_pi 列（自有 schema v17）及 Pi MCP 适配；需新建或映射：`deeplink/mcp.rs`、`mcp/hermes.rs`等 3 个 | 待迁移 |
| `2fdcebf1` | v4.0.2 | fix(codex): let users switch back to CC Switch's model catalog when aggregation is blocked | 4 模式/路由 | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `cad592e0` | v4.0.2 | fix(codex): treat model_catalog_json as a plain key field | 4 模式/路由 | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `165622b8` | v4.0.2 | feat: show a short summary of what changed after updating | — | 更新后 whats-new 摘要弹窗依赖桌面更新流程；Web 以 CHANGELOG/Release 说明版本 | 不适用 |
| `f5db60db` | v4.0.2 | feat(ui): fill the icon box with tile-style provider icons | 5a 供应商与全局 UI | 需新建或映射：`components/ProviderIconBox.tsx` | 待迁移 |
| `20222460` | v4.0.2 | docs(whats-new): add the 4.0.2 summary | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `db8069ef` | v4.0.2 | fix(codex): keep the reasoning levels column from stretching the model catalog | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `91765357` | v4.0.2 | feat(ui): pick fetched models into the Codex model mapping table | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx` | 待迁移 |
| `fe831f0a` | v4.0.2 | feat(ui): pick the provider form layout from the tab it was opened in | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `9ec89fe8` | v4.0.2 | feat(claude): list aggregated models through modelPicker instead of gateway discovery | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `600fdb0c` | v4.0.2 | fix(ui): drop the restart hints for Claude Code aggregation changes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx`、`components/providers/mode/ModeDialog.tsx`等 4 个 | 待迁移 |
| `08f789a8` | v4.0.2 | chore(release): v4.0.2 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `bf2fe0d0` | v4.0.2 | docs(release): add v4.0.2 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `cf567ca6` | v4.0.3 | fix(claude): project CLAUDE_CODE_AUTO_MODE_SERVER from provider env into settings.json (#7893) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `a4d07f31` | v4.0.3 | feat(ui): edit MCP and prompts in full pages and confirm before leaving unsaved editors (#7842) | 5a 供应商与全局 UI | 需新建或映射：`components/prompts/PiPromptPanel.tsx`、`components/ui/sheet.tsx`等 3 个 | 待迁移 |
| `f68fe30f` | v4.0.3 | fix(presets): default Hermes and OpenClaw MiMo presets to mimo-v2.6-pro (#7890) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3af74823` | v4.0.3 | feat(opencode): round-trip native v2 providers via JSON editor (#7579) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `d4a24107` | v4.0.3 | feat(provider): add MoArk (模力方舟) provider presets (#7580) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `bc4d1a50` | v4.0.3 | fix(usage): count cache tokens in provider and model stats | 5b 用量/额度 UI | 需新建或映射：`services/sql_helpers.rs` | 待迁移 |
| `fc8d884b` | v4.0.3 | feat(quota): show the Codex Credits balance for ChatGPT subscriptions | 5b 用量/额度 UI | 需新建或映射：`services/usage_cache.rs` | 待迁移 |
| `d7f615f0` | v4.0.3 | fix(skills): deploy imported skills to every app ticked in the import dialog | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `dd07b8f4` | v4.0.3 | fix(usage): show localized names for session-log usage providers | 5b 用量/额度 UI | 需新建或映射：`components/usage/providerLabel.ts` | 待迁移 |
| `14003822` | v4.0.3 | fix(proxy): respect thinking-off and per-model effort floors when mapping Claude effort | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `6f4d365b` | v4.0.3 | fix(usage): use a short session-log label where the app is already shown | 5b 用量/额度 UI | 需新建或映射：`components/usage/providerLabel.ts` | 待迁移 |
| `c615c3ee` | v4.0.3 | feat(usage): show success rate and speed in model stats | 5b 用量/额度 UI | 需新建或映射：`components/usage/statsColumns.tsx` | 待迁移 |
| `beff557e` | v4.0.3 | feat(logging): log provider switches and routing / aggregation mode changes (#7882) | 1d 资源/设置/工具 | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`lib/frontendLogger.ts` | 待迁移 |
| `243cd9a9` | v4.0.3 | fix(proxy): satisfy the OpenCode Go gateway's client identity requirements (#7773) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `34759f69` | v4.0.3 | fix(usage): move usage-stat writes off tokio workers with spawn_blocking (#7822) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `a776a3b1` | v4.0.3 | feat(skills): add a select-all checkbox to the installed list header (#7887) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `edff2d76` | v4.0.3 | fix(proxy): handle mixed LF and CRLF SSE delimiters (#7853) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `04638fd4` | v4.0.3 | fix(ui): stop WebKit layout jitter on the usage page (#7901) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `eef7efdc` | v4.0.3 | fix(config): let the test home override win over the legacy HOME fallback (#7812) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `3c3b9493` | v4.0.3 | docs(contributing): document which services get a built-in provider preset | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `8569ddd7` | v4.0.3 | feat(presets): add OpenCode Zen for Claude Code and Codex | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `d68f008f` | v4.0.3 | docs(contributing): accept large established aggregators as presets | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `58a9e8e2` | v4.0.3 | fix(presets): drop the expired OpenCode Go referral code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3144c820` | v4.0.3 | feat(backup): show all backup locations and their sizes | 1d 资源/设置/工具 | 显示全部备份位置与大小；路径使用 Web 数据目录；需新建或映射：`services/backup_storage.rs`、`components/settings/BackupStorageSection.tsx` | 待迁移 |
| `146f3196` | v4.0.3 | feat(claude): add auto mode server-check toggle and default it off for gateways | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `cac218f3` | v4.0.3 | refactor(claude): drop the Teammates quick toggle | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `997a34fe` | v4.0.3 | refactor(claude): drop the max effort quick toggle | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `65e79de8` | v4.0.3 | feat(claude): explain each quick toggle with a help tip | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f3e3a955` | v4.0.3 | docs(manual): add the auto mode server-check toggle to the Claude quick toggles table | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `014a33a4` | v4.0.3 | chore(release): v4.0.3 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `8596a233` | v4.0.3 | docs(release): add v4.0.3 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `d35726e2` | v4.0.4 | test(hermes): batch the scan-limit fixture inserts in one transaction | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `f61dc5f5` | v4.0.4 | fix(macos): relaunch via LaunchServices so the window comes to the front after restart | — | macOS LaunchServices 重启窗口；Web 无桌面窗口 | 不适用 |
| `e09fdf04` | v4.0.4 | feat(settings): give the About card's star prompt its own dismissible strip | 5a 供应商与全局 UI | 关于页 Star 提示独立可关闭；Web 已有指向 Web 仓库的 Star 提示 | 待迁移 |
| `e0b36500` | v4.0.4 | feat(profiles): hide the project switcher by default | 1d 资源/设置/工具 | 需新建或映射：`components/settings/sections/GeneralSection.tsx` | 待迁移 |
| `5b10d199` | v4.0.4 | fix(usage): keep the speed column visible in a narrow window | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `c2282a10` | v4.0.4 | chore(release): v4.0.4 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `a29a4f38` | v4.0.4 | docs(release): add v4.0.4 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `01ee685d` | v4.0.5 | docs(release): lead with usage stats in the v4.0.4 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `5dd824c7` | v4.0.5 | docs(readme): update all four READMEs for v4.0 | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `a7f66764` | v4.0.5 | chore(github): list all ten apps in issue templates | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `a40adef3` | v4.0.5 | fix(usage): import Grok Build session usage after 60s instead of 10min | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `efd236a4` | v4.0.5 | docs(manual): update the user manual for v4.0 | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `f9db9f70` | v4.0.5 | feat(codex): support GitHub Copilot managed accounts with Responses/Chat routing (#7157) | 3 官方账号 | Codex 使用 GitHub Copilot 托管账号（Responses/Chat 路由）；需新建或映射：`proxy/copilot_optimizer.rs`、`proxy/providers/codex_chat_history.rs`等 3 个 | 待迁移 |
| `c5233fe7` | v4.0.5 | fix(apps): enable native setup for Claude Code npm installs (#7929) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `d90de1ba` | v4.0.5 | fix(updater): support Linux package auto-updates (#7620) | — | Linux 安装包自动更新；Web 无桌面更新器 | 不适用 |
| `faae0e4d` | v4.0.5 | ci(wsl): run the WSL2 nightly from a nextest archive | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `7d8004c4` | v4.0.5 | test(wsl): skip three lib tests the 9P share cannot host | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `5ae6ad38` | v4.0.5 | ci(wsl): retry flaky lib tests in the WSL2 nightly | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `36c8b87e` | v4.0.5 | fix(linux): restore Wayland title-bar controls on first show and tray re-show (#7947) | — | Wayland 标题栏控件；Web 无桌面窗口 | 不适用 |
| `3c9e430f` | v4.0.5 | fix(installer): drop ProductIcon reference from MSI shortcuts (#5952) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `e40ebb6e` | v4.0.5 | fix(codex): list explicitly configured models from hidden templates (#7925) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `b1752e1c` | v4.0.5 | ci(release): require deb and rpm signatures in latest.json check (#7943) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `3af55c39` | v4.0.5 | fix(codex): give the MoArk preset a model catalog and native Responses format (#7940) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `02759c67` | v4.0.5 | fix(proxy): mark converted function tools as non-strict for Responses (#7717) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `5d24fdf9` | v4.0.5 | feat(usage): show all history in the all-time heatmap | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `cf02f670` | v4.0.5 | chore(release): v4.0.5 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `2db86e94` | v4.0.5 | docs(release): add v4.0.5 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `889b797d` | v4.0.6 | fix(claude): allow npm scripts in the primary update path (#7099) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `66144d58` | v4.0.6 | fix(codex): expose cached-account restart notice outside Stack mode (#8006) | 4 模式/路由 | 需新建或映射：`components/providers/CodexStaleClientsNotice.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `86421718` | v4.0.6 | fix(proxy): close open content blocks before terminal events in Anthropic SSE (#7986) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `ffffd43c` | v4.0.6 | fix(codex): keep tools in third-party compaction summary turns (#7991) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `42d47956` | v4.0.6 | ci(release): fail fast when linux deb or rpm package is missing (#7985) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `f025ee05` | v4.0.6 | docs(faq): update window controls setting path for v4 in zh/en/ja manuals (#7983) | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `b4a07943` | v4.0.6 | fix(codex): stop storing representative apiFormat for Copilot (#7972) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `0be33a84` | v4.0.6 | fix(quota): bring back colored quota numbers and warn below 20% | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `18bdea7c` | v4.0.6 | chore(icons): update DMXAPI logo | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6760cfbb` | v4.0.6 | feat(codex): add an opt-in classic sub-agent tools toggle for aggregation | 4 模式/路由 | 需新建或映射：`components/settings/CodexAuthSettings.tsx` | 待迁移 |
| `c37a2625` | v4.0.6 | fix(proxy): explain unreadable sub-agent tasks instead of emptying them | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `4aeaccf1` | v4.0.6 | fix(codex): unbind providers when a managed account is removed | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `449c7e78` | v4.0.6 | docs: add aggregation mode guide and update user manuals | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `1beb8fa8` | v4.0.6 | feat(ui): make the CC Switch update dot green and open About from it | 5a 供应商与全局 UI | 更新点改绿色并跳转关于页；适配 Web UpdateBadge；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `ae934663` | v4.0.6 | fix(codex): build third-party catalog entries from the bundled classic tool template | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `c1cb531f` | v4.0.6 | feat(skills): update all Skills from the check button and list them before confirming | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `033017b0` | v4.0.6 | fix(skills): stop the import dialog from locking while discover refetches | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `8919d05c` | v4.0.6 | fix(ui): use the action color for the apps page visibility switches | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `4629ee2f` | v4.0.6 | fix(tray): show every quota tier in the app row title | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `dc93c496` | v4.0.6 | fix(codex): keep official models visible in the aggregation catalog | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `c5efe0ba` | v4.0.6 | feat(providers): add a search button to the provider page header | 1d 资源/设置/工具 | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx`、`components/settings/sections/GeneralSection.tsx` | 待迁移 |
| `ee50c12b` | v4.0.6 | test(apps): expect the action color on the apps page visibility switches | 1d 资源/设置/工具 | 仅测试/图标变更，随功能迁移 | 待迁移 |
| `314968b6` | v4.0.6 | chore(release): v4.0.6 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `c2611266` | v4.0.6 | docs(release): add v4.0.6 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `ef24a019` | v4.0.7 | test(codex): skip the thread version SQLite fixture on WSL temp dirs | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `3e566a3b` | v4.0.7 | fix(pi): point Volcengine Agent Plan at its own endpoint and add Coding Plan (#8044) | 5a 供应商与全局 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `8641cd1d` | v4.0.7 | feat(codex): read compressed session rollouts and add a compression toggle | 5a 供应商与全局 UI | 需新建或映射：`codex_rollout_file.rs`、`services/backup_storage.rs`等 5 个 | 待迁移 |
| `347c60c3` | v4.0.7 | docs(aggregation): add Codex troubleshooting for sub-agent tasks and the official quota lock | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `f264ce62` | v4.0.7 | fix(codex): run stale-client detection outside the aggregate stack view (#7892) | 4 模式/路由 | 需新建或映射：`components/providers/CodexStaleClientsNotice.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `533055bb` | v4.0.7 | fix(usage): bill Claude 1-hour cache writes at the 1h rate (#7653) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `3da322eb` | v4.0.7 | feat(pricing): seed Claude Sonnet 5.5 and Haiku 5.5 (#8053) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `4bbdbcdd` | v4.0.7 | fix(usage): import Codex cache-write tokens from session rollouts (#7635) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `a0be6456` | v4.0.7 | fix(usage): keep provider stats rows distinct across apps (#8032) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `2625bcf1` | v4.0.7 | fix(opencode): preserve untouched extra-option value types on edit (#7841) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `00db3eef` | v4.0.7 | fix(openclaw): preserve custom headers when toggling User-Agent (#7847) | 5a 供应商与全局 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `5667b287` | v4.0.7 | fix(usage): treat explicit-zero OpenAI cache fields as unreported (#8045) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `eda410e5` | v4.0.7 | feat(settings): scroll to and highlight app configuration entries (#7934) | 5a 供应商与全局 UI | 需新建或映射：`components/settings/SettingsLayout.tsx`、`components/settings/sections/AppConfigSection.tsx` | 待迁移 |
| `84457b51` | v4.0.7 | fix(codex): keep a top-level base_url when saving a provider | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `69dbb307` | v4.0.7 | fix(i18n): scope unified Codex session history copy to the CLI | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `e06ba573` | v4.0.7 | fix(windows): keep non-ASCII paths out of generated batch files | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `e5b1e096` | v4.0.7 | fix(codex): tell ChatGPT workspaces of the same user apart when switching official cards | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `0fc67c3b` | v4.0.7 | fix(codex): warn about stale Codex clients on Windows without a process table | 4 模式/路由 | 需新建或映射：`components/providers/CodexStaleClientsNotice.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `b7d548b6` | v4.0.7 | feat(quota): let quota windows show what is used instead of what is left | 5b 用量/额度 UI | 需新建或映射：`components/quota/useQuotaDisplay.ts`、`components/settings/sections/GeneralSection.tsx` | 待迁移 |
| `e049660a` | v4.0.7 | fix(codex): explain that old third-party sessions cannot continue on the official route | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `fda103e9` | v4.0.7 | chore(release): v4.0.7 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `790ed800` | v4.0.7 | docs(release): add v4.0.7 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `0b8662a4` | v4.0.8 | fix(i18n): align quota help and backup hint wording with UI labels | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `1f786dad` | v4.0.8 | docs(release): expand the Codex session compression section in v4.0.7 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `74b1a98c` | v4.0.8 | fix(models): send the configured request headers when fetching OpenCode model lists (#7759) | 5a 供应商与全局 UI | OpenCode 表单拉取模型时携带请求头，属表单改动，转入 5a | 待迁移 |
| `315aeda7` | v4.0.8 | fix(model-fetch): honor provider header overrides when fetching models (#7760) | 5a 供应商与全局 UI | 需新建或映射：`lib/api/model-fetch.test.ts` | 待迁移 |
| `4215f7ee` | v4.0.8 | feat(settings): add an Open log button to the diagnostic log section | 1d 资源/设置/工具 | 按用户决定改为显示诊断日志路径并一键复制，不调用本机文件管理器 | 待迁移 |
| `3784fd9e` | v4.0.8 | fix(ui): soften dark-mode text colors to reduce glare | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `979ce6a6` | v4.0.8 | fix(codex): find the CLI bundled with the Codex desktop app | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `2e20cdcb` | v4.0.8 | fix(codex): explain why the official model list is unavailable | 4 模式/路由 | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `ed15cd01` | v4.0.8 | chore(release): v4.0.8 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `df40d53c` | v4.0.8 | docs(release): add v4.0.8 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `f88068b9` | v4.0.9 | fix(proxy): let clients reach local routing through a separate connection address (#7878) | 4 模式/路由 | 本地路由独立的客户端连接地址；与 Docker/局域网部署相关，需与 Web 监听配置统一；需新建或映射：`components/settings/sections/RoutingSection.tsx` | 待迁移 |
| `c69679a2` | v4.0.9 | docs(flatpak): pass bundle flags to Tauri (#8132) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `40d19110` | v4.0.9 | fix(macOS): request local network permission (#7213) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `4cde722c` | v4.0.9 | fix(providers): avoid flicker when opening the provider editor (#8145) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `9055dd37` | v4.0.9 | fix(proxy): stop sending unmatched tool results as role=tool to Chat upstreams (#8136) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `5b708ebd` | v4.0.9 | feat(presets): add SoruxGPT presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `fec99c56` | v4.0.9 | feat(presets): add IKunCode presets and SoruxGPT/IKunCode icons | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `d25e8d54` | v4.0.9 | feat(presets): add RunToken presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `2ff37a76` | v4.0.9 | feat(codex): set a default sub-agent model and reasoning effort | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `89add5de` | v4.0.9 | feat(presets): add Grok Build presets for SoruxGPT, IKunCode and RunToken | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `233310d7` | v4.0.9 | feat(presets): add OpenModel sponsor presets across ten apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `886915a7` | v4.0.9 | feat(presets): add BotCF presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c4770472` | v4.0.9 | feat(presets): add YYLX presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `4f08989a` | v4.0.9 | refactor(stack): explain the default model with a help tip instead of stars | 4 模式/路由 | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx` | 待迁移 |
| `0dae89e2` | v4.0.9 | refactor(codex): move the model list out of the advanced options | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `9f7ac1fa` | v4.0.9 | refactor(codex): make the first row of the model list the default model | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `36e2ce2c` | v4.0.9 | refactor(codex): move field explanations into help tips | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `84ca4f00` | v4.0.9 | refactor(stack): move aggregation layout explanations into help tips | 4 模式/路由 | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx` | 待迁移 |
| `5b78fc62` | v4.0.9 | docs(flatpak): explain skipping updater artifacts without a signing key | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `e615a6f4` | v4.0.9 | refactor(forms): make provider form hints follow the app's actual mode | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx`、`components/providers/forms/shared/DirectModeFormatWarning.tsx` | 待迁移 |
| `29998ed9` | v4.0.9 | fix(i18n): apply the saved language on cold start | 1d 资源/设置/工具 | 语言初始化；Web 语言来自 localStorage/浏览器，按 Web 入口适配 | 待迁移 |
| `6e7811e5` | v4.0.9 | fix(proxy): send Bearer to OpenAI-format Claude upstreams and merge stack switches | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `f59bba54` | v4.0.9 | refactor(forms): move Claude form explanations into help tips | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `56731456` | v4.0.9 | refactor(forms): shorten the legacy provider fields notice | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `1e045d2e` | v4.0.9 | refactor(forms): move the full URL toggle into advanced options | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/shared/FullUrlToggle.tsx` | 待迁移 |
| `28ee933c` | v4.0.9 | refactor(claude-desktop): explain the model mode in plain words | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `ac2eebc0` | v4.0.9 | revert(forms): drop the Codex main reasoning effort picker | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `1afa90af` | v4.0.9 | fix(forms): align the thinking level picker with the model list row | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f7244745` | v4.0.9 | feat(forms): pick fetched models in a dialog that can also remove them | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx` | 待迁移 |
| `8347e1ab` | v4.0.9 | refactor(forms): drop the fetch-count toast when the model picker opens | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `644b7d5c` | v4.0.9 | feat(forms): show model parameters in the picker and fill picks quietly | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeStackModelsField.tsx` | 待迁移 |
| `2b0ec81b` | v4.0.9 | fix(codex): rewrite call_id-less tool outputs for xAI native Responses | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `b17250a3` | v4.0.9 | feat(presets): add TokenFlux presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5e57b1ec` | v4.0.9 | chore(release): v4.0.9 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `8845b1ef` | v4.0.9 | docs(release): add v4.0.9 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `3302cc2d` | v4.0.10 | feat(presets): add NekoCode presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `04bd15c9` | v4.0.10 | fix(i18n): use 詳細オプション for the advanced options toggle in Japanese | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `28dc5198` | v4.0.10 | fix(providers): disable fade for add and edit pages (#8159) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `68122bc4` | v4.0.10 | fix(usage): honor Codex thread model settings (#8176) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `96d636ca` | v4.0.10 | fix(usage): stop treating empty OpenRouter credits as expired (#8175) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `99277921` | v4.0.10 | fix(settings): use confirmed directories for unrelated autosaves (#8023) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `fac8bfd8` | v4.0.10 | fix(installer): don't recreate a deleted desktop shortcut on MSI upgrade | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `98222d19` | v4.0.10 | fix(deeplink): stop losing links on cold start and tighten import checks | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`commands/deeplink.rs`、`deeplink/mod.rs`等 6 个 | 待迁移 |
| `450bc039` | v4.0.10 | feat(deeplink): enable imported usage scripts by default | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/mod.rs`、`deeplink/provider.rs`等 4 个 | 待迁移 |
| `11e1326b` | v4.0.10 | fix(deeplink): keep a Codex link's provider config instead of rebuilding a fixed template | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/codex_link.rs`、`deeplink/mod.rs`等 5 个 | 待迁移 |
| `c63c702c` | v4.0.10 | fix(proxy): bump the Claude Code haiku alias to claude-haiku-5-5 | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `db93ac20` | v4.0.10 | fix(grokbuild): point session_summary at the active provider and keep a link's model profile | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/grok_link.rs`、`deeplink/mod.rs`等 5 个 | 待迁移 |
| `e0a03184` | v4.0.10 | chore(presets): point OpenModel sign-up links at the cc-switch referral URL | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `85e574b4` | v4.0.10 | chore(presets): show YYLX as 鱼鱼连线 in Chinese | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `16e7ff1c` | v4.0.10 | feat(deeplink): let links declare the API format, import Pi providers, and leave activation to the user | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/mod.rs`、`deeplink/parser.rs`等 7 个 | 待迁移 |
| `6af00ecb` | v4.0.10 | docs(deeplink): add a Chinese integration guide for site owners | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `21203803` | v4.0.10 | feat(providers): upload a custom provider icon | 5a 供应商与全局 UI | 自定义供应商图标上传与“我的图标”库；浏览器上传，存储走 Web 数据目录与备份；需新建或映射：`deeplink/mod.rs`、`deeplink/parser.rs`等 6 个 | 待迁移 |
| `23c0a63f` | v4.0.10 | fix(usage): stop treating an empty Novita balance as an expired plan | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `bee47fdf` | v4.0.10 | feat(deeplink): let provider links bring their own icon via iconUrl | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`commands/deeplink.rs`、`deeplink/icon_fetch.rs`等 8 个 | 待迁移 |
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
| `dbb81ea2` | v4.0.11 | feat(apps): add tool uninstall with a confirmed plan and manual commands (#8165) | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs`、`components/DeepLinkImportDialog.tsx`等 5 个 | 待迁移 |
| `479964f2` | v4.0.11 | fix(windows): restore user PATH for CLI lifecycle commands (#8173) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `9719b7b3` | v4.0.11 | fix(usage): skip unchanged deferred Codex rollouts (#8218) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `1ef555df` | v4.0.11 | fix(skills): show error and warning toasts for bulk failures (#8137) | 5a 供应商与全局 UI | 需新建或映射：`components/mcp/AppMatrix.tsx` | 待迁移 |
| `84464e7e` | v4.0.11 | feat(presets): add StreamLake China (Vanchin) presets and fix the intl OpenAI endpoint | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3c918cd0` | v4.0.11 | feat(presets): add AIComing presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c859026d` | v4.0.11 | feat(usage): enable coding-plan usage by default for every app | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `b13797e3` | v4.0.11 | feat(deeplink): enable coding-plan usage by default on import | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/provider.rs`、`deeplink/tests.rs`等 3 个 | 待迁移 |
| `3700af35` | v4.0.11 | feat(presets): add SoruxGPT Coding Plan for Claude Code and Codex | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e48b84d6` | v4.0.11 | chore(presets): move AIGoCode to the .net site and .dev API host | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6b4c09ac` | v4.0.11 | fix(mcp): show error and warning toasts for bulk failures | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c05906bb` | v4.0.11 | fix(usage): merge paginated Codex rollout pages when resolving fork parents (#8213) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `438834fe` | v4.0.11 | feat(presets): add GrooRoute Pro sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3b3c3f0b` | v4.0.11 | chore(release): v4.0.11 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `2635dfff` | v4.0.11 | docs(release): add v4.0.11 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `061d24c8` | v4.0.12 | fix(ui): keep the unsaved-changes guard when re-clicking the current page (#7900) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `866b93b4` | v4.0.12 | fix(proxy): 防止终止响应后再次发出流错误 (#8138) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `74d43799` | v4.0.12 | fix(sync): preserve skills recovery snapshots after restore failures (#8155) | 1d 资源/设置/工具 | 需新建或映射：`services/sync_protocol.rs` | 待迁移 |
| `49d529fb` | v4.0.12 | fix(providers): prevent search panel from covering card actions (#8151) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c11c7cf1` | v4.0.12 | fix(proxy): say so when the upstream error body is empty (#6910) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `b1941307` | v4.0.12 | fix(wsl): skip syscalls 9P rejects when piConfigDir targets WSL (#8249) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `4958863a` | v4.0.12 | fix(usage): restore speed estimates for Pi session history (#8278) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `74b98ca9` | v4.0.12 | fix(apps): follow up uninstall feedback and Windows CLI PATH (#8262) | 1d 资源/设置/工具 | 需新建或映射：`components/apps/ToolUninstallConfirmDialog.tsx` | 待迁移 |
| `c21106ff` | v4.0.12 | feat(i18n): add Turkish interface and tray localization (#8208) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `30fcd90a` | v4.0.12 | fix(apps): keep columns aligned when upgrade actions disappear (#8293) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `6a232cab` | v4.0.12 | feat(apps): choose which installation to uninstall and support current Grok layout | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs`、`components/apps/ToolUninstallConfirmDialog.tsx` | 待迁移 |
| `ae778b4f` | v4.0.12 | feat(apps): check the Node version before updating npm tools | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_node_requirement.rs` | 待迁移 |
| `31c6f574` | v4.0.12 | feat(providers): place provider search at the end of the first list row | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeTabs.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `dea297ce` | v4.0.12 | fix(i18n): use English for unsupported system languages | 1d 资源/设置/工具 | 语言初始化；Web 语言来自 localStorage/浏览器，按 Web 入口适配 | 待迁移 |
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
| `68cb364a` | v4.0.12 | test(uninstall): widen windows path resolution timeout to avoid ci flakes (#8295) | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs` | 待迁移 |
| `cc81627a` | v4.0.12 | fix(usage): sync session usage at the selected auto-refresh interval (#8301) | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsagePage.tsx`、`hooks/useUsageAutoRefresh.ts`等 3 个 | 待迁移 |
| `23dc945e` | v4.0.12 | fix(opencode): add SiliconFlow provider presets (#4878) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f7696fa8` | v4.0.12 | feat(apps): move uninstall into a per-row overflow menu | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `e5eeb166` | v4.0.12 | fix(i18n): clarify what hiding an app in the Apps page does | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `5b6d317f` | v4.0.12 | fix(i18n): drop the community translation suffix from the Turkish option | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `453cdaf9` | v4.0.12 | chore(presets): point GrooRoute invite link to grooroute.pro | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `7a8087f6` | v4.0.12 | feat(usage): scan session logs at the selected interval while the usage page is open | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsagePage.tsx`、`hooks/useUsageAutoRefresh.ts`等 3 个 | 待迁移 |
| `e380588a` | v4.0.12 | feat(presets): add icons for Baseten, DeepInfra, DigitalOcean, Fireworks, Groq, Nebius and SambaNova | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8686c165` | v4.0.12 | feat(providers): add a Local group for local inference presets | 1b 代理协议 | 需新建或映射：`components/providers/forms/presetGroups.ts` | 待迁移 |
| `d5b729a5` | v4.0.12 | feat(presets): add Ollama local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `16964d7c` | v4.0.12 | feat(presets): add LM Studio local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `936aec4a` | v4.0.12 | feat(presets): add llama.cpp local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c6263cc9` | v4.0.12 | feat(presets): add vLLM local inference presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8b7d71c1` | v4.0.12 | feat(presets): add icons for LM Studio, llama.cpp and vLLM | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `06805090` | v4.0.12 | fix(apps): stop the Apps page layout from shifting when buttons appear | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `edf32204` | v4.0.12 | chore(release): v4.0.12 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `51ac86f1` | v4.0.12 | docs(release): add v4.0.12 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c1051f8e` | v4.0.13 | fix(codex): match quoted provider table headers when writing base_url (#8276) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f318e65e` | v4.0.13 | fix(proxy): stop Chat stream converters at the DONE boundary (#8281) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `81bc1bce` | v4.0.13 | fix(usage): derive opencode session request latency from message times (#8309) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `76f99d41` | v4.0.13 | fix(cli): avoid quadratic search path deduplication (#8322) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `67d63e3e` | v4.0.13 | fix(usage): resolve paginated continuation pages for forked branch threads (#8290) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `16537fd3` | v4.0.13 | fix(codex): preserve compaction preferences in proxy config (#8339) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `09237ebd` | v4.0.13 | fix(windows): avoid native CSS drag regions (#8327) | — | 桌面窗口拖拽区域；浏览器页面无窗口拖拽 | 不适用 |
| `be0a9cf0` | v4.0.13 | fix(presets): cap GPT context windows at the 272K subscription window | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6aeaeb17` | v4.0.13 | feat(codex): pick the aggregation sub-agent model and default classic tools on | 4 模式/路由 | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/mode/ModeTabs.tsx`等 6 个 | 待迁移 |
| `e70e844c` | v4.0.13 | feat(codex): let Auto Review use another model | 4 模式/路由 | 需新建或映射：`components/providers/mode/StackSettingsSheet.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `f9e0d537` | v4.0.13 | feat(mode): confirm before going back to direct | 4 模式/路由 | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/mode/SwitchModePanel.tsx`等 4 个 | 待迁移 |
| `3e9eede4` | v4.0.13 | feat(claude-desktop): move Desktop into the device-level direct/route mode | 4 模式/路由 | 需新建或映射：`commands/profile.rs` | 待迁移 |
| `19a3e8d4` | v4.0.13 | feat(claude-desktop): show Desktop with the shared direct/route mode panel | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/mode/SwitchModePanel.tsx`等 9 个 | 待迁移 |
| `b93bf12d` | v4.0.13 | feat(claude-desktop): support aggregation (stack) mode on the backend | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `e5508224` | v4.0.13 | feat(claude-desktop): offer aggregation mode in the Desktop panel | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/presentation.ts`等 3 个 | 待迁移 |
| `e4367db5` | v4.0.13 | fix(claude-desktop): resolve colliding aggregation ids to the listed provider | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `58354f91` | v4.0.13 | fix(claude-desktop): split a legacy mapping card into route and official direct | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `78d2517a` | v4.0.13 | fix(mode): preview the old default's models and fill in Desktop's app name | 4 模式/路由 | 需新建或映射：`components/providers/mode/ModeDialog.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `7c763cf3` | v4.0.13 | fix(claude-desktop): give the back-to-direct confirmation Desktop's own notes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeDialog.tsx` | 待迁移 |
| `35423712` | v4.0.13 | test(uninstall): borrow single paths as slices for clippy | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs` | 待迁移 |
| `eb2b0d36` | v4.0.13 | test(apps): wait for re-probed rows before Update all after a remount | 1d 资源/设置/工具 | 仅测试/图标变更，随功能迁移 | 待迁移 |
| `4214ac40` | v4.0.13 | test(usage): skip Codex parse-cache counts where files have no identity | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `ae8646c6` | v4.0.13 | test(windows): run the lifecycle failure test outside the WSL temp dir | — | WSL2 夜间 CI 的 9P 共享兼容调整；Web 不运行该任务 | 不适用 |
| `b391565f` | v4.0.13 | feat(update): download the portable zip directly from the update button | — | 便携版 zip 下载更新；Web 无桌面更新器 | 不适用 |
| `894cce82` | v4.0.13 | chore(release): v4.0.13 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `4ec75e71` | v4.0.13 | docs(release): add v4.0.13 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `e7a76adc` | v4.0.13 | feat(presets): add TokenFactory sponsor presets across seven apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `3d46e06c` | v4.0.13 | feat(claude): allow declaring 1M context on the Haiku tier | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `31038e68` | v4.0.13 | fix(presets): pre-check 1M for presets whose models have a 1M window | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5fd57811` | v4.0.13 | fix(presets): declare 1M on Claude Desktop presets that relay Claude 5 | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `0a6eb00e` | v4.0.13 | feat(presets): add Modelflare sponsor presets across nine apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `6f6eee0c` | v4.0.13 | fix(presets): restore sponsor promo copy for four sponsors | — | 赞助商推广文案/排位；Web 不展示赞助身份且按名称 A–Z 排序 | 不适用 |
| `0a8d0645` | v4.0.13 | docs(release): update v4.0.13 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `d4f2d4e4` | v4.0.14 | fix(claude-desktop): show one picker row per 1M model | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `a756a1aa` | v4.0.14 | docs(readme): remove TokenFactory sponsor entry | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `a96e2fcc` | v4.0.14 | fix(presets): drop TokenFactory sponsor status and localize its name | 1a 预设/定价/图标 | 1a：补齐 `providerForm.presets.tokenfactory` 三语名称；赞助身份字段仅兼容不展示 | 已迁移 |
| `8c2c89e0` | v4.0.14 | feat(providers): explain and remember the folder for Open Terminal | 5a 供应商与全局 UI | 需新建或映射：`components/providers/OpenTerminalDialog.tsx` | 待迁移 |
| `e97fc33d` | v4.0.14 | fix(misc): only treat shell command-missing output as not installed in WSL probe (#8167) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `09bce301` | v4.0.14 | feat(pricing): seed Gemini 4 Argon (#8356) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e1864ac1` | v4.0.14 | fix(usage): make exact model pricing lookup case-insensitive (#8414) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `8d643bde` | v4.0.14 | fix(deeplink): refresh OpenCode live state after provider import (#8382) | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`components/DeepLinkImportDialog.tsx` | 待迁移 |
| `c8dc9206` | v4.0.14 | fix(usage): prefer opencode streamed time for session latency (#8410) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `b542627c` | v4.0.14 | fix(usage): skip malformed UTF-8 parent records without hiding read errors (#8360) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `e8880e6f` | v4.0.14 | fix(version): stop false "update available" for dev-build local versions (#8398) | 5a 供应商与全局 UI | 开发版本误报更新；Web 更新提示同样基于版本比较；需新建或映射：`lib/version.test.ts` | 待迁移 |
| `daf442e5` | v4.0.14 | fix(opencode): keep Unicode-named deep-link imports editable (#8381) | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/provider.rs` | 待迁移 |
| `85ae0c7b` | v4.0.14 | refactor(usage): route usage amounts through one money formatter | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageHero.tsx`等 3 个 | 待迁移 |
| `4e20fad5` | v4.0.14 | feat(usage): show usage amounts in a chosen currency | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 5 个 | 待迁移 |
| `8f3337d9` | v4.0.14 | feat(usage): choose what the sidebar Today label shows | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 3 个 | 待迁移 |
| `0cfea5e3` | v4.0.14 | feat(usage): pick which request log columns to show | 5b 用量/额度 UI | 需新建或映射：`components/usage/requestLogColumns.ts` | 待迁移 |
| `c6daf78c` | v4.0.14 | feat(usage): remember the last view and move display choices into settings | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx`、`components/usage/rememberedChoice.ts` | 待迁移 |
| `9d83b2e8` | v4.0.14 | fix(usage): drop the ≈ mark and cap decimals on converted amounts | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `b194cc09` | v4.0.14 | feat(usage): show requests or cache hit rate in the sidebar Today label | 5b 用量/额度 UI | 需新建或映射：`components/shell/Sidebar.tsx`、`components/usage/UsageDisplaySection.tsx`等 4 个 | 待迁移 |
| `722042ad` | v4.0.14 | fix(presets): move SiliconFlow CN presets off the retired MiniMax M2.5 | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `25310890` | v4.0.14 | feat(icons): switch Pi to the three-color pi.dev mark | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f2906db6` | v4.0.14 | fix(proxy): round-trip Gemini thought signatures on Codex chat tool calls | 1b 代理协议 | 需新建或映射：`proxy/providers/codex_chat_history.rs` | 待迁移 |
| `0d326a4c` | v4.0.14 | fix(proxy): keep the underlying cause in upstream connection errors | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `122423ca` | v4.0.14 | fix(providers): explain why the direct provider can't be deleted while routing | 5a 供应商与全局 UI | 需新建或映射：`components/providers/presentation.ts` | 待迁移 |
| `8b4b92c6` | v4.0.14 | fix(failover): keep queue positions distinct when reordering | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `2e03d8ce` | v4.0.14 | fix(sessions): merge Windows project groups that differ only in path case | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `07a9c459` | v4.0.14 | fix(openclaw): keep the User-Agent switch in sync with JSON header edits | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `898dd002` | v4.0.14 | fix(codex): keep retry and stream timeout keys in the proxy route table | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `83f0155f` | v4.0.14 | fix(skills): spool repo archives to disk and lift the 128 MiB download cap | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `5089eb69` | v4.0.14 | fix(proxy): fall back to Gemini's skip signature when a cached one is lost | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `d858ab4c` | v4.0.14 | chore(release): v4.0.14 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `5de6feb4` | v4.0.14 | docs(release): add v4.0.14 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `797e0276` | v4.0.15 | fix(proxy): preserve Claude JSON session identity (#8236) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `7344cc37` | v4.0.15 | fix(claude-desktop): allow native providers to bootstrap local routing (#8444) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `caf70b52` | v4.0.15 | fix(i18n): translate new Turkish uninstall strings (#8291) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `6fcbb054` | v4.0.15 | fix(sidebar): show only the numbers in the usage Today badge | — | 侧栏今日用量徽标改动已被上游撤销，净效果为空 | 不适用 |
| `24d87028` | v4.0.15 | fix(skills): stop branch fallback from masking non-404 download errors | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `2bcf953b` | v4.0.15 | fix(tools): only reinstall Codex when --version actually exits with an error | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs` | 待迁移 |
| `8a06838d` | v4.0.15 | fix(settings): never overwrite settings.json with defaults after a failed load | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `dd24b1ed` | v4.0.15 | fix(icons): give the macOS app icon a white rounded-square background | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `a94b592a` | v4.0.15 | fix(usage): hide empty DeepSeek wallets when another currency has funds | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `b570f137` | v4.0.15 | fix(forms): keep the Codex thinking level picker inside short windows | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `5d04c12d` | v4.0.15 | fix(claude-desktop): fetch models for managed OAuth providers | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c696c68f` | v4.0.15 | fix(sync): stop cutting off slow WebDAV/S3 transfers at a fixed 300s | 1d 资源/设置/工具 | 需新建或映射：`services/s3.rs`、`services/sync_protocol.rs` | 待迁移 |
| `97daccb6` | v4.0.15 | fix(settings): keep settings when an old save left a trailing tail | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `ecb449f4` | v4.0.15 | fix(terminal): give Windows provider terminals the restored user PATH | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `eb09fbb1` | v4.0.15 | fix(tools): add missing exited_with_error to the Windows WSL uninstall candidate | 1d 资源/设置/工具 | 需新建或映射：`commands/tool_uninstall.rs` | 待迁移 |
| `415e8994` | v4.0.15 | fix(failover): refresh the routing marker after the proxy fails over | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `ff3e33a8` | v4.0.15 | feat(hermes): declare image input per model | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `93f1688a` | v4.0.15 | chore(providers): follow up on panel transition cleanup (#8260) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `afbf073b` | v4.0.15 | fix(provider): prevent card stretching and overlap during drag sorting (#8315) | 5a 供应商与全局 UI | 卡片拖拽排序防拉伸重叠，属列表 UI，转入 5a | 待迁移 |
| `ad9f0f20` | v4.0.15 | perf(usage): cache Claude pricing within each import transaction (#8226) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `2bc380b2` | v4.0.15 | fix(proxy): keep Codex Responses beta marker in stack mode (#8437) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `d1856448` | v4.0.15 | fix(usage): count Pi subagent usage from the child session files (#8318) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `d23cee4c` | v4.0.15 | fix(hermes): read live WSL databases inside their distribution (#8254) | 1c 会话/用量导入 | 需新建或映射：`session_manager/hermes_wsl.rs`、`session_manager/hermes_wsl_reader.py` | 待迁移 |
| `5cc94b8d` | v4.0.15 | fix(proxy): report routed switches without unconditional restart prompts (#8378) | 1b 代理协议 | 需新建或映射：`components/providers/mode/SwitchModePanel.tsx`、`utils/routeSwitchNotification.ts` | 待迁移 |
| `f9bc9a4f` | v4.0.15 | fix(codex): recover malformed tool-call history for Chat upstreams (#8241) | 1b 代理协议 | 需新建或映射：`proxy/providers/codex_chat_tool_history.rs` | 待迁移 |
| `2a7080f1` | v4.0.15 | fix(proxy): normalize DeepSeek tool replay in Codex Chat requests (#8351) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `73f37c4b` | v4.0.15 | feat(usage): add bar and area chart toggle (#8439) | 5b 用量/额度 UI | 需新建或映射：`components/usage/rememberedChoice.ts` | 待迁移 |
| `17960423` | v4.0.15 | feat(usage): move the trend chart style into usage display settings | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx`、`components/usage/rememberedChoice.ts` | 待迁移 |
| `61fee943` | v4.0.15 | style(usage): lay out the Display settings as an aligned grid | 5b 用量/额度 UI | 需新建或映射：`components/usage/UsageDisplaySection.tsx` | 待迁移 |
| `5a3330c5` | v4.0.15 | feat(presets): add EveryAPI sponsor presets | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `0a5a2ed6` | v4.0.15 | feat(presets): add AllTokens sponsor presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8e42cb75` | v4.0.15 | chore(release): v4.0.15 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `79e754ab` | v4.0.15 | docs(release): add v4.0.15 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `73cdfbb7` | v4.0.16 | fix(i18n): improve Turkish UI wording (#8481) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `77c6dc79` | v4.0.16 | feat(tray): replace the tray menu with a glass panel (#8432) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `75e93281` | v4.0.16 | fix(proxy): allow unforced Claude WebSearch through Codex OAuth (#7936) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `adc223af` | v4.0.16 | fix(claude): use catalog ids for 5.5 upstreams in routing takeover (#8450) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `8d8dc456` | v4.0.16 | fix(proxy): keep Chat tool outputs contiguous across hoisted developer notices (#8445) | 1b 代理协议 | 需新建或映射：`proxy/providers/codex_chat_history.rs` | 待迁移 |
| `a94f997f` | v4.0.16 | fix(codex): honor configured GPT context windows (#8385) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `734c4831` | v4.0.16 | feat(minimax): add MiniMax-M3.1-Flash to the official MiniMax presets (#8518) | 1a 预设/定价/图标 | 1a：七类预设默认 M3.1-Flash 与定价已同步；Hermes 标题模型钉选（`hermes_config.rs`）转入 1d | 部分迁移 |
| `0bbbb534` | v4.0.16 | fix(hermes): prefill MiniMax provider keys that don't collide with Hermes built-ins (#8538) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `bbcf0aea` | v4.0.16 | fix(usage): show account balance when a Zhipu account has no coding plan | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `e02f3a33` | v4.0.16 | chore(presets): drop invite codes from Zhipu API key links | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `68b52851` | v4.0.16 | style(providers): restore the light-blue "Get API Key" link | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `b92de269` | v4.0.16 | fix(providers): show the "Get API Key" link when editing a provider | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `752998a6` | v4.0.16 | feat(tray): add a setting to switch between the tray panel and the native menu | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `940f9f93` | v4.0.16 | fix(tray): follow the usage display currency and chart style in the panel | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `e003829b` | v4.0.16 | feat(tray): default the tray style to the native menu | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `e2af66ca` | v4.0.16 | feat(tray): color the mode name in the panel with its theme color | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `cd449274` | v4.0.16 | fix(env): stop reporting inherited process env vars as conflicts on Unix | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `a8e17dd6` | v4.0.16 | perf(tray): make the panel respond instantly on hover and app switching | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `27c42fd1` | v4.0.16 | feat(tray): fade in sub panel content on app switch and close it on other items | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `b76e83c3` | v4.0.16 | fix(usage): shorten CJK four-digit axis ticks and size the Y axis to its labels | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `273d166b` | v4.0.16 | fix(tray): make the macOS panel readable over dark windows | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `8a0eddb0` | v4.0.16 | fix(codex): stop aggregated sessions from compacting on the previous provider | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `3168b00f` | v4.0.16 | Revert "fix(sidebar): show only the numbers in the usage Today badge" | — | 侧栏今日用量徽标改动已被上游撤销，净效果为空 | 不适用 |
| `bb05f9d6` | v4.0.16 | fix(pricing): correct Kimi K3 and Step 5 Preview prices and seed new Qwen models | 1a 预设/定价/图标 | 1a：修正 Kimi K3、Step 5 Preview 价格并新增 Qwen；仅修复仍为旧内置值的行，Web 定价断言随之更新 | 已迁移 |
| `1e36b107` | v4.0.16 | fix(usage): recover the model name for MiniMax Code usage rows that lack one | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `2c2d6c43` | v4.0.16 | fix(codex): show the on-disk login in the official card's auth.json editor | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `8e51101e` | v4.0.16 | fix(claude-desktop): publish catalog ids for 5.5 targets in route mode | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `6c36d68a` | v4.0.16 | fix(codex): keep the ChatGPT login when CC Switch detaches from routing | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `8b09732a` | v4.0.16 | fix(usage): don't auto-enable Volcengine plan quota without AccessKey | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`deeplink/provider.rs`、`deeplink/tests.rs`等 3 个 | 待迁移 |
| `5fa00079` | v4.0.16 | fix(icons): soften the macOS app icon tile to light grey | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `f3d9e8c6` | v4.0.16 | fix(settings): render the About card logo from the vector mark | 5a 供应商与全局 UI | 关于页 logo 改矢量；上游删除 app-icon.png，Web 仍引用 | 待迁移 |
| `3b1f11b6` | v4.0.16 | fix(detect): find fnm-managed Node CLIs on Windows | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `56ac4f9a` | v4.0.16 | fix(providers): let an idle card be deleted when only the stale DB current flag points at it | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `eadfc151` | v4.0.16 | feat(opencode): set the default model from an added provider card | 1d 资源/设置/工具 | 需新建或映射：`components/providers/presentation.ts` | 待迁移 |
| `a9a93f06` | v4.0.16 | test(skill): isolate HOME before touching the skill storage location | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
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
| `8cfe5644` | v4.0.17 | fix(usage): count Codex compaction usage from token_usage_record (#8479) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `9be88e3e` | v4.0.17 | fix(provider-form): stop macOS from capitalizing typed API keys | 5a 供应商与全局 UI | 关闭 API Key 输入自动大写；Safari/移动浏览器同样适用 | 待迁移 |
| `099c9761` | v4.0.17 | fix(tray): align quota bars and show time until reset | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `7e97b44f` | v4.0.17 | feat(tray): mark the balance amount in panel quota lines | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `c42e3067` | v4.0.17 | feat(tray): show remaining balances in green in the tray panel | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `2dfc848f` | v4.0.17 | fix(proxy): stop child processes from inheriting the listener socket on Windows | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `5cbe6700` | v4.0.17 | fix(webdav): upload the sync manifest as application/octet-stream | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `1f1becfb` | v4.0.17 | fix(toml): only normalize smart quotes used as string delimiters | 5a 供应商与全局 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `95693d6c` | v4.0.17 | fix(codex): don't give an expired stashed login back to the proxy | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `52e87344` | v4.0.17 | fix(mcp): project url-only servers without a type to Hermes and OpenCode | 1d 资源/设置/工具 | 需新建或映射：`mcp/hermes.rs` | 待迁移 |
| `cf312f6a` | v4.0.17 | fix(mcp): take the app's switch lock before toggling a server | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `73adfaf0` | v4.0.17 | fix(tray): release the tray panel WebView in lightweight mode | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `f460410f` | v4.0.17 | feat(hermes): warn when a provider key is a Hermes built-in provider id | 5a 供应商与全局 UI | 需新建或映射：`config/hermesBuiltinProviderIds.ts` | 待迁移 |
| `e172f37d` | v4.0.17 | chore(release): v4.0.17 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `19798e2f` | v4.0.17 | docs(release): add v4.0.17 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c7dceb80` | v4.0.18 | feat(agy): integrate Antigravity CLI management (#8268) | 2c Antigravity | Antigravity 应用接入；Web 需新增 AppType::Agy；需新建或映射：`agy_config.rs`、`agy_smoke_tests.rs`等 17 个 | 待迁移 |
| `3854c613` | v4.0.18 | refactor(agy): launch API-key providers from the terminal instead of a shell wrapper | 2c Antigravity | 需新建或映射：`agy_config.rs`、`agy_smoke_tests.rs`等 5 个 | 待迁移 |
| `b667b00a` | v4.0.18 | feat(agy): show the model on cards and attribute session usage to it | 2c Antigravity | 需新建或映射：`agy_config.rs`、`services/session_usage_agy.rs` | 待迁移 |
| `dfe10081` | v4.0.18 | feat(agy): share prompts with key profiles, resume key sessions, price usage | 2c Antigravity | 需新建或映射：`agy_config.rs`、`services/provider/agy_direct.rs`等 5 个 | 待迁移 |
| `1b4cd547` | v4.0.18 | feat(agy): show the signed-in quota on the official card | 2c Antigravity | 需新建或映射：`services/subscription_agy.rs` | 待迁移 |
| `94126795` | v4.0.18 | fix(agy): show only the typed prompt in sessions and describe the quota check | 2c Antigravity | 需新建或映射：`session_manager/providers/agy.rs` | 待迁移 |
| `2e22ca20` | v4.0.18 | feat(agy): give Antigravity its own icon and manage the CLI on the Apps page | 2c Antigravity | 需新建或映射：`agy_config.rs`、`commands/tool_uninstall.rs`等 3 个 | 待迁移 |
| `fb91155a` | v4.0.18 | fix(agy): accept the empty mcp_config.json agy creates on first run | 2c Antigravity | 需新建或映射：`mcp/agy.rs` | 待迁移 |
| `9a10e4f7` | v4.0.18 | feat(agy): replace the enable button with Open Terminal | 2c Antigravity | 需新建或映射：`agy_config.rs`、`agy_smoke_tests.rs`等 9 个 | 待迁移 |
| `c776fd0e` | v4.0.18 | feat(agy): trim the form hint and require a key on custom cards | 2c Antigravity | 需新建或映射：`components/providers/presentation.ts` | 待迁移 |
| `1ef08d5e` | v4.0.18 | fix(windows): stop in-app updates from rebooting the machine (#8628) | — | MSI 应用内更新重启；Web 无安装器 | 不适用 |
| `c1fd26bd` | v4.0.18 | fix(ui): show compact mode-colored connection badge in header (#8634) | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/ModeTabs.tsx`、`components/providers/mode/SwitchModePanel.tsx` | 待迁移 |
| `ab5d4a12` | v4.0.18 | fix(ui): trim redundant provider and settings helper copy (#8633) | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/StructuredOptionsEditor.tsx` | 待迁移 |
| `cdfdff5e` | v4.0.18 | fix(installer): make Windows desktop shortcut optional (#8601) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `92ec18d7` | v4.0.18 | docs(aggregation): correct the workaround for the exhausted-quota lock | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `711a4127` | v4.0.18 | fix(usage): only list apps shown on the Apps page in the app filter | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `fdbac61c` | v4.0.18 | feat(agy): manage Antigravity official accounts in the Auth Center backend | 2c Antigravity | 需新建或映射：`commands/agy_account.rs`、`services/agy_account/keychain.rs`等 5 个 | 待迁移 |
| `86271879` | v4.0.18 | feat(agy): add an Antigravity group to the Auth Center | 2c Antigravity | 需新建或映射：`services/agy_account/mod.rs`、`components/providers/forms/AgyOAuthSection.tsx` | 待迁移 |
| `0af8b772` | v4.0.18 | feat(agy): bind official cards to an Antigravity account | 2c Antigravity | 需新建或映射：`components/providers/OpenTerminalDialog.tsx`、`components/providers/forms/AgyOAuthSection.tsx` | 待迁移 |
| `81634602` | v4.0.18 | fix(pricing): price deepseek-v4.1-flash as V4.1 Flash | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5a08e230` | v4.0.18 | feat(agy): query each Antigravity account's quota directly | 2c Antigravity | 需新建或映射：`commands/agy_account.rs`、`services/agy_account/mod.rs`等 6 个 | 待迁移 |
| `8f9525b0` | v4.0.18 | fix(agy): explain why an account is not eligible for Antigravity | 2c Antigravity | 需新建或映射：`services/agy_account/quota.rs` | 待迁移 |
| `c0490b05` | v4.0.18 | feat(agy): show each account's quota in the Auth Center | 2c Antigravity | 需新建或映射：`components/providers/forms/AgyOAuthSection.tsx` | 待迁移 |
| `2c63012b` | v4.0.18 | perf(agy): query the signed-in account's quota without starting agy | 2c Antigravity | 需新建或映射：`commands/agy_account.rs`、`services/agy_account/mod.rs`等 4 个 | 待迁移 |
| `997e78b5` | v4.0.18 | feat(agy): show the bound account's quota on official cards | 2c Antigravity | 需新建或映射：`components/AgyAccountQuotaFooter.tsx` | 待迁移 |
| `276eff8d` | v4.0.18 | feat(agy): open all four quota windows from the card's quota column | 2c Antigravity | 合并到 Web 已改文件 | 待迁移 |
| `e91689f2` | v4.0.18 | fix(agy): drop the Antigravity-only note on the usage page | 2c Antigravity | 合并到 Web 已改文件 | 待迁移 |
| `6fabe63a` | v4.0.18 | fix(agy): show Antigravity session-log rows as "Session log" | 2c Antigravity | 需新建或映射：`components/usage/providerLabel.ts` | 待迁移 |
| `e59252ee` | v4.0.18 | feat(presets): promote EveryAPI to a full sponsor | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `8d4ec90f` | v4.0.18 | chore(presets): remove ZetaAPI sponsor and presets | 1a 预设/定价/图标 | 1a：九类预设移除 ZetaAPI，删除三语推广文案；Web 原本未登记其图标 | 已迁移 |
| `0a41250d` | v4.0.18 | feat(presets): add DIT.ai sponsor presets across nine apps | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `132ab9ce` | v4.0.18 | feat(presets): add hao.ai sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e1821b5e` | v4.0.18 | fix(codex): hide reset countdown for unused quota windows (#8631) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `ea8bc2c3` | v4.0.18 | fix(sessions): group a Claude session by its last /cd location (#8643) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `6226f5c4` | v4.0.18 | fix(terminal): stop waiting for the launched console to close on Windows | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `47ffdff8` | v4.0.18 | fix(apps): give runtime CLI commands the login-shell PATH on Unix | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `04d0ebf5` | v4.0.18 | fix(app): raise the open-file soft limit at startup on Unix | 1d 资源/设置/工具 | Unix 启动时提高打开文件软限制；Web 服务进程同样受益 | 待迁移 |
| `4aec1aec` | v4.0.18 | chore(release): v4.0.18 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `cb90a244` | v4.0.18 | docs(release): add v4.0.18 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `e4873bc8` | v4.0.19 | feat(kimi): add Kimi Code support (#8687) | 2b Kimi Code | Kimi Code 应用接入；Web 需新增 AppType::Kimi；需新建或映射：`deeplink/mcp.rs`、`deeplink/parser.rs`等 17 个 | 待迁移 |
| `7da25538` | v4.0.19 | feat(kimi): add official OAuth login and provider switching (#8710) | 2b Kimi Code | 需新建或映射：`commands/kimi_oauth.rs`、`kimi_config.rs`等 11 个 | 待迁移 |
| `07265bc9` | v4.0.19 | feat(kimi): support multiple official accounts in Auth Center (#8726) | 2b Kimi Code | 需新建或映射：`commands/kimi_oauth.rs`、`kimi_config.rs`等 10 个 | 待迁移 |
| `79ba7982` | v4.0.19 | feat(usage): restructure the usage page layout (#8711) | 5b 用量/额度 UI | 需新建或映射：`components/usage/ChecklistMenu.tsx`、`components/usage/RequestLogColumnsMenu.tsx`等 10 个 | 待迁移 |
| `91fc2fcb` | v4.0.19 | fix(codex): split the stack comp_hash by tool protocol | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `ce098caf` | v4.0.19 | fix(about): detach the shell version probe from the controlling terminal | 1d 资源/设置/工具 | 版本探测 shell 脱离控制终端；Web 服务从终端启动时同样可能卡住 | 待迁移 |
| `0640c6fc` | v4.0.19 | fix(codex): never turn image input off when filling fetched model metadata | 5a 供应商与全局 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `e88ff540` | v4.0.19 | test(usage): scope Codex parent-cache count assertions to each test's dir | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `cdd2190d` | v4.0.19 | feat(kimi): identify, remove and show quota for official accounts | 2b Kimi Code | 需新建或映射：`commands/kimi_oauth.rs`、`kimi_config.rs`等 9 个 | 待迁移 |
| `e12415b5` | v4.0.19 | refactor(providers): move OpenCode/OpenClaw set-default into the more menu | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `c49c2be9` | v4.0.19 | refactor(kimi): render Auth Center accounts with the shared account group | 2b Kimi Code | 需新建或映射：`components/providers/KimiAccountLogin.tsx`、`components/providers/forms/hooks/useKimiOAuth.ts` | 待迁移 |
| `44e0fc96` | v4.0.19 | feat(kimi): name separate official accounts "Kimi 订阅 <nickname>" | 2b Kimi Code | 需新建或映射：`kimi_config.rs`、`services/kimi_oauth/mod.rs` | 待迁移 |
| `d6a23241` | v4.0.19 | feat(kimi): give provider cards real add/remove actions | 2b Kimi Code | 需新建或映射：`kimi_config.rs`、`components/providers/presentation.ts` | 待迁移 |
| `7cc3141c` | v4.0.19 | style(providers): mark additive default providers in blue | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `f4e9211a` | v4.0.19 | fix(panel): let Escape close only the topmost full-screen panel | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `29f8bef3` | v4.0.19 | fix(usage): clamp the request log page when the total shrinks | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `c6f85464` | v4.0.19 | style(usage): restore the original trend chart and heatmap colors | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `1c52fa91` | v4.0.19 | fix(providers): reread additive client state when a removal is refused | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `93e33d11` | v4.0.19 | fix(apps): drop the redundant not-installed error line under uninstalled tools | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `b61e2767` | v4.0.19 | feat(kimi): fetch the model list and fill parameters from models.dev | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx` | 待迁移 |
| `535d1283` | v4.0.19 | fix(models): match old OpenCode Zen/Go addresses to the moved models.dev entries | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `8969264b` | v4.0.19 | feat(kimi): explain the less obvious model capabilities | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx`、`config/kimiProviderPresets.ts` | 待迁移 |
| `b96ff618` | v4.0.19 | feat(kimi): move request headers into collapsible advanced options | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx` | 待迁移 |
| `d6db0c75` | v4.0.19 | fix(providers): stop the advanced options toggle from jumping when pressed | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx` | 待迁移 |
| `0f768290` | v4.0.19 | feat(kimi): lay out the provider editor like Pi and OpenCode | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx` | 待迁移 |
| `1e2559ef` | v4.0.19 | feat(pi): always show the provider key and flag duplicates | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `03707c40` | v4.0.19 | style(pi): use the shared required-field asterisk | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `717172bd` | v4.0.19 | chore(presets): point DIT.ai links at the ccswitch referral URL | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `069c7fac` | v4.0.19 | feat(presets): add BuyToken sponsor presets across eight apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `91d3ed10` | v4.0.19 | feat(presets): add V-API sponsor presets across nine apps | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `e85ade71` | v4.0.19 | chore(presets): swap the FluxA TokenPlan and Shengsuanyun sponsor positions | — | 赞助商推广文案/排位；Web 不展示赞助身份且按名称 A–Z 排序 | 不适用 |
| `c8f85674` | v4.0.19 | fix(mcp): render server display name in unified MCP panel (#8692) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `52652a02` | v4.0.19 | fix(sessions): make the project group header clickable across the row (#8709) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `2e1e2979` | v4.0.19 | fix(proxy): recognize Codex session header aliases (#8718) | 1b 代理协议 | 需新建或映射：`proxy/session/header_tests.rs` | 待迁移 |
| `c3ad9bb0` | v4.0.19 | fix(model-fetch): try compatible-mode models endpoint for /apps/anthropic base URLs (#8755) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `e5b04221` | v4.0.19 | fix(subscription): select Claude Keychain credentials by account (#8764) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `3494d0d1` | v4.0.19 | chore(presets): add V-API backup endpoints | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `b5aa7fbb` | v4.0.19 | fix(agy): show Gemini quota when querying Google directly | 2c Antigravity | 需新建或映射：`services/agy_account/quota.rs` | 待迁移 |
| `2fbd9c70` | v4.0.19 | fix(hermes): launch the dashboard inside WSL when Hermes lives there | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `7ecce7c7` | v4.0.19 | fix(proxy): carry encrypted-only reasoning as empty thinking for Claude clients | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `10e0aa23` | v4.0.19 | fix(deeplink): don't let a finished import close a newer link's confirmation | 1d 资源/设置/工具 | 深链导入：Web 由前端 deeplink 解析/导入器处理，按 TS 实现适配；协议唤起与冷启动不适用；需新建或映射：`components/DeepLinkImportDialog.tsx` | 待迁移 |
| `9cb6b6d7` | v4.0.19 | fix(agy): run background agy commands without a console window on Windows | 2c Antigravity | 需新建或映射：`agy_config.rs`、`services/subscription_agy.rs` | 待迁移 |
| `50e091b0` | v4.0.19 | fix(usage): step 7/14/30-day presets back by calendar days across DST | 5b 用量/额度 UI | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `e53ca7e8` | v4.0.19 | fix(usage): tighten request log column spacing | 5b 用量/额度 UI | 需新建或映射：`components/usage/usageTable.ts` | 待迁移 |
| `bada9a4b` | v4.0.19 | fix(models): don't borrow a vendor-hosted entry that points at another vendor | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `a043b1f8` | v4.0.19 | chore(release): v4.0.19 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `d8983bb1` | v4.0.19 | docs(release): add v4.0.19 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `c8945d2d` | v4.0.20 | feat(omp): add Oh My Pi support | 2d Oh My Pi | Oh My Pi 应用接入（含 models.yml 文本编辑、复用 Pi 表单）；Web 需新增 AppType::Omp；需新建或映射：`deeplink/mcp.rs`、`deeplink/parser.rs`等 9 个 | 待迁移 |
| `2afe8cdb` | v4.0.20 | refactor(omp): rename the internal app id from ohmypi to omp | 2d Oh My Pi | Oh My Pi 应用接入（含 models.yml 文本编辑、复用 Pi 表单）；Web 需新增 AppType::Omp；需新建或映射：`commands/omp.rs`、`deeplink/mcp.rs`等 13 个 | 待迁移 |
| `3d7cf6aa` | v4.0.20 | refactor(omp): port #8308's text-level models.yml editor and share Pi plumbing | 2d Oh My Pi | Oh My Pi 应用接入（含 models.yml 文本编辑、复用 Pi 表单）；Web 需新增 AppType::Omp；需新建或映射：`commands/omp.rs`、`commands/pi.rs`等 6 个 | 待迁移 |
| `a03c6c7a` | v4.0.20 | refactor(omp): reuse the Pi provider form and plumbing for Oh My Pi | 2d Oh My Pi | Oh My Pi 应用接入（含 models.yml 文本编辑、复用 Pi 表单）；Web 需新增 AppType::Omp；需新建或映射：`components/providers/presentation.ts`、`components/skills/SkillImportDialog.tsx`等 3 个 | 待迁移 |
| `e88a9fa4` | v4.0.20 | refactor(omp): read Oh My Pi sessions through the Pi session reader | 2d Oh My Pi | 需新建或映射：`session_manager/providers/omp.rs` | 待迁移 |
| `b34753b8` | v4.0.20 | feat(omp): manage Oh My Pi global prompts | 2d Oh My Pi | 需新建或映射：`deeplink/parser.rs`、`deeplink/tests.rs`等 4 个 | 待迁移 |
| `f1d43eba` | v4.0.20 | docs(readme): list Oh My Pi among the managed tools | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `9bacd1d1` | v4.0.20 | fix(omp): allow project images in Oh My Pi session previews | 2d Oh My Pi | 合并到 Web 已改文件 | 待迁移 |
| `d9422e7d` | v4.0.20 | fix(omp): install and update Oh My Pi without assuming Bun | 2d Oh My Pi | 需新建或映射：`commands/tool_uninstall.rs` | 待迁移 |
| `d01daa0d` | v4.0.20 | fix(omp): hide the Oh My Pi choice when importing skills | 2d Oh My Pi | 需新建或映射：`components/skills/SkillImportDialog.tsx` | 待迁移 |
| `c3e54a4e` | v4.0.20 | feat(pricing): seed Kimi K3.1 Pro and HighSpeed prices | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `62652945` | v4.0.20 | feat(kimi): edit official account models and remove them from Kimi | 2b Kimi Code | 需新建或映射：`commands/kimi_oauth.rs`、`kimi_config.rs`等 6 个 | 待迁移 |
| `c91aa774` | v4.0.20 | feat(kimi): show "No subscription" for accounts without a Kimi Code plan | 2b Kimi Code | 需新建或映射：`components/KimiAccountQuotaFooter.tsx` | 待迁移 |
| `cae7c375` | v4.0.20 | chore(presets): remove EveryAPI sponsor and presets | — | EveryAPI 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `1a3057dc` | v4.0.20 | fix(sessions): skip local command output when titling Claude sessions (#8799) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `e8ae28b6` | v4.0.20 | fix(linux): restore window dragging and resize feedback (#8092) | — | 桌面窗口拖拽区域；浏览器页面无窗口拖拽 | 不适用 |
| `7f9cd9e9` | v4.0.20 | fix(proxy): use the attached marker for orphan tool result media (#8157) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `9decd60e` | v4.0.20 | feat(i18n): complete Turkish catalog (#8616) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `bd50984e` | v4.0.20 | fix(forms): reflect automatic Copilot protocol routing (#8196) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c72c82cf` | v4.0.20 | feat(auth): support browser login for managed ChatGPT accounts (#8288) | 3 官方账号 | 托管 ChatGPT 账号浏览器登录；回调监听需在 Web 部署下可达；需新建或映射：`proxy/providers/codex_oauth_auth/browser.rs` | 待迁移 |
| `309c9c51` | v4.0.20 | fix(agy): recover subagent usage models from native generations (#8693) | 2c Antigravity | 需新建或映射：`services/session_usage_agy.rs`、`services/session_usage_agy/native_models.rs` | 待迁移 |
| `5bc562ce` | v4.0.20 | feat(apps): group the apps page into installed and not installed sections | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `72b056f6` | v4.0.20 | fix(usage): show the balance amount even when it is used up | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `e68e6943` | v4.0.20 | fix(i18n): reword the failed quota line in Chinese as "query failed" | 1d 资源/设置/工具 | 需新建或映射：`deeplink/provider.rs` | 待迁移 |
| `b71141a8` | v4.0.20 | feat(apps): drag to reorder installed apps, sidebar follows the order | 1d 资源/设置/工具 | 需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `ba6a8a55` | v4.0.20 | fix(apps): group Claude Desktop by whether it is installed | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `c6617bc2` | v4.0.20 | fix(omp): move the discovery note from the apps page to the MCP and Skills columns | 2d Oh My Pi | 需新建或映射：`components/mcp/AppMatrix.tsx` | 待迁移 |
| `6c2fc74e` | v4.0.20 | feat(pi): pick fetched models in a dialog for Pi and omp | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f395cd6b` | v4.0.20 | fix(kimi): import subagent usage from their own wire logs | 2b Kimi Code | 需新建或映射：`kimi_session.rs`、`services/session_usage_kimi.rs` | 待迁移 |
| `b9f317af` | v4.0.20 | fix(usage): stop treating an empty DeepSeek balance as an expired plan | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `442df1db` | v4.0.20 | fix(skills): send a User-Agent when downloading skill archives | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `dcdcbcb4` | v4.0.20 | fix(pi): resolve $NAME references in apiKey for usage queries | 1d 资源/设置/工具 | 需新建或映射：`pi_config/mod.rs` | 待迁移 |
| `6e040f4c` | v4.0.20 | fix(omp): check provider keys against omp's own providers | 2d Oh My Pi | 合并到 Web 已改文件 | 待迁移 |
| `f67cb33d` | v4.0.20 | fix(omp): match omp's apiKey, models.json and schema rules | 2d Oh My Pi | 需新建或映射：`omp_config.rs` | 待迁移 |
| `5f642640` | v4.0.20 | feat(pi): move rarely used provider settings into a collapsed advanced section | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `28a2ebc0` | v4.0.20 | fix(usage): show every tab count and keep counts steady across filter changes | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `50a9d103` | v4.0.20 | chore(presets): refresh preset models to the latest vendor lineups | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c9e059a4` | v4.0.20 | chore(release): v4.0.20 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `85ad4969` | v4.0.20 | docs(release): add v4.0.20 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `de0a235a` | v4.0.21 | fix(proxy): send Codex requests to the provider table that model_provider selects (#8849) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `e8e1cfbf` | v4.0.21 | fix(usage): keep Codex remote-compaction usage billable across sync passes (#8879) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `93a3e8ec` | v4.0.21 | feat(auth-center): always show Add account in the header | 2b Kimi Code | 需新建或映射：`components/providers/KimiAccountLogin.tsx`、`components/providers/forms/AgyOAuthSection.tsx` | 待迁移 |
| `ee83fd89` | v4.0.21 | refactor(auth-center): drop the header "Delete all accounts" menu | 2c Antigravity | 需新建或映射：`components/providers/forms/AgyOAuthSection.tsx` | 待迁移 |
| `882e7a6a` | v4.0.21 | fix(profile): capture "no active prompt" so applying a project disables the current prompt | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `56fa007f` | v4.0.21 | feat(presets): use DeepSeek Flash instead of Pro everywhere | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `da0c84e4` | v4.0.21 | fix(tray): keep lightweight mode across restarts | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `4dc05a9a` | v4.0.21 | feat(claude): switch between multiple official subscription accounts | 3 官方账号 | Claude 多订阅账号切换（services/claude_account 17 个文件）；凭据快照须写 Web 数据目录；需新建或映射：`agy_config.rs`、`commands/claude_account.rs`等 10 个 | 待迁移 |
| `58fee0db` | v4.0.21 | fix(claude): close gaps in official account switching | 3 官方账号 | 需新建或映射：`services/claude_account/login.rs`、`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `62324686` | v4.0.21 | feat(providers): move Open Terminal out of the more menu | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `1409bad9` | v4.0.21 | feat(claude): switch Claude Code's sign-in when switching official cards | 3 官方账号 | 需新建或映射：`commands/claude_account.rs`、`services/claude_account/cc_lock.rs`等 16 个 | 待迁移 |
| `e550adcf` | v4.0.21 | feat(claude): switch the sign-in whenever an official card has an account | 3 官方账号 | 需新建或映射：`commands/claude_account.rs`、`services/claude_account/mod.rs`等 7 个 | 待迁移 |
| `1ddb14e1` | v4.0.21 | fix(claude): keep account profiles consistent when recovering or parking | 3 官方账号 | 需新建或映射：`services/claude_account/snapshot/recover.rs`、`services/claude_account/snapshot/switch.rs`等 3 个 | 待迁移 |
| `3837f460` | v4.0.21 | feat(claude): show the bound account in the card subtitle | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `0d6386ed` | v4.0.21 | feat(claude): show each bound account's quota on its card | 3 官方账号 | 需新建或映射：`commands/claude_account.rs`、`services/claude_account/login.rs`等 7 个 | 待迁移 |
| `b3eb2ad1` | v4.0.21 | feat(claude): show each account's quota in the auth center | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `e29968f5` | v4.0.21 | fix(claude): don't show a stale quota when the account's login has lapsed | 3 官方账号 | 需新建或映射：`services/claude_account/usage.rs` | 待迁移 |
| `50395742` | v4.0.21 | refactor(claude): match the auth center header changes on main | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `0c07d509` | v4.0.21 | fix(providers): keep the usage column aligned when a card's status changes | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `ee2ef72f` | v4.0.21 | fix(hermes): move set-default into the more menu like other additive apps | 5a 供应商与全局 UI | 需新建或映射：`components/providers/ProviderCardActions.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `03337b7e` | v4.0.21 | feat(presets): allow max reasoning effort for MiniMax Flash in OpenClaw | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `88c878ac` | v4.0.21 | feat(claude): show the subscription plan on official cards | 3 官方账号 | 需新建或映射：`commands/claude_account.rs`、`services/claude_account/mod.rs`等 8 个 | 待迁移 |
| `6837f361` | v4.0.21 | fix(claude-desktop): use the documented OpenCode Go base URL (#8720) | 5a 供应商与全局 UI | Desktop OpenCode Go 预设地址已随 1a 同步；`coding_plan.rs` 与用量检测部分待迁移 | 待迁移 |
| `9c30cde4` | v4.0.21 | chore(templates): add a required Human Note to issue and PR templates (#8905) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `a56dddb9` | v4.0.21 | feat(presets): add TeamoRouter Claude presets and update promotion text (#8266) | 1a 预设/定价/图标 | 1a：TeamoRouter Claude 预设已同步；推广文案不迁移 | 已迁移 |
| `f20a2b29` | v4.0.21 | fix(windows): gate Unix-only Claude login opener constant (#8898) | 3 官方账号 | Windows 下 Unix 专用 Claude 登录常量的编译门控，随 Claude 多账号迁移；需新建或映射：`services/claude_account/layout.rs` | 待迁移 |
| `74a98fdd` | v4.0.21 | fix(gemini): read export KEY=value lines in ~/.gemini/.env (#8862) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `66510775` | v4.0.21 | fix(opencode): hide connectivity check for OMO profiles (#8842) | 5a 供应商与全局 UI | 需新建或映射：`utils/providerCapabilities.test.ts` | 待迁移 |
| `ec5c5f8a` | v4.0.21 | fix(forms): align Claude Desktop Copilot URL detection and sync zh/en/ja manuals (#8838) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `d2008fdb` | v4.0.21 | fix(i18n): complete Turkish catalog follow-ups (#8836) | 1d 资源/设置/工具 | 用户决定不新增土耳其语，Web 保持 zh/en/ja | 不适用 |
| `238d8a71` | v4.0.21 | test(proxy): add end-to-end regression tests for inline <think> block conversion (#8835) | 1b 代理协议 | 需新建或映射：`proxy/tests_issue_7271.rs` | 待迁移 |
| `fe08e10a` | v4.0.21 | feat(claude): match the Codex sign-in picker on official cards | 5a 供应商与全局 UI | 需新建或映射：`components/providers/forms/ClaudeOfficialSection.tsx` | 待迁移 |
| `ea1645f9` | v4.0.21 | fix(auth): align quota bars across accounts in the auth center | 3 官方账号 | 合并到 Web 已改文件 | 待迁移 |
| `45155e9d` | v4.0.21 | feat(terminal): say on the card when a terminal is isolated | 5a 供应商与全局 UI | 需新建或映射：`components/providers/OpenTerminalDialog.tsx`、`components/providers/ProviderCardActions.tsx` | 待迁移 |
| `5f0fc253` | v4.0.21 | fix(apps): count Hermes's leftover hermes.cmd beside hermes.exe as one install | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `cfc64971` | v4.0.21 | fix(mcp): drop timeout/autoApprove from Codex MCP entries | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `618af9d9` | v4.0.21 | fix(apps): allow OpenCode's postinstall under npm 12 | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `ff31d840` | v4.0.21 | fix(apps): allow Grok Build's postinstall under npm 12 | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `d564adc3` | v4.0.21 | feat(presets): add Kimi K3.1 Pro and HighSpeed to the official Kimi presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `05034a4e` | v4.0.21 | feat(codex): drag to reorder rows in the provider model list | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `71524045` | v4.0.21 | fix(stack): keep the aggregation member order in step with drag sorting | 4 模式/路由 | 需新建或映射：`hooks/useDragSort.ts` | 待迁移 |
| `96f01af0` | v4.0.21 | fix(proxy): retry Codex requests rejected for a foreign Azure resource | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `c2110ebb` | v4.0.21 | fix(mcp): warn when an SSE server is written to apps without SSE support | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `80640b52` | v4.0.21 | fix(proxy): read Chat completions wrapped in a data envelope | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `e332cfdb` | v4.0.21 | fix(omp): stop refusing models.yml values that contain &, * or ! | 2d Oh My Pi | 需新建或映射：`omp_config.rs` | 待迁移 |
| `644f5664` | v4.0.21 | fix(kimi): date session usage by each request, not the turn commit | 2b Kimi Code | 需新建或映射：`kimi_session.rs`、`services/session_usage_kimi.rs` | 待迁移 |
| `0820ff73` | v4.0.21 | fix(codex-oauth): stop reporting transient refresh failures as an expired login | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `fec3629a` | v4.0.21 | docs(readme): move TeamoRouter ahead of AICoding in the sponsor table | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `9f5adaac` | v4.0.21 | ci: auto-close outside PRs that change SCHEMA_VERSION (#8903) | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `42ef6347` | v4.0.21 | fix(usage): prevent dashboard jumps when toggling the sidebar (#8548) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `95e29485` | v4.0.21 | feat(presets): add ClinePass presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `5cc6c47f` | v4.0.21 | fix(auth-center): refetch Claude accounts after switching Claude cards | 3 官方账号 | 合并到 Web 已改文件 | 待迁移 |
| `cb50e600` | v4.0.21 | chore(release): v4.0.21 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `c4db63c6` | v4.0.21 | docs(release): add v4.0.21 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `df511e82` | v4.0.22 | docs(contributing): require a self-written Human Note in PRs | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `e55d8a21` | v4.0.22 | fix(tray): handle clicks from third-party Windows tray hosts (#8729) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `0133facc` | v4.0.22 | fix(claude): say Claude accounts aren't supported when the config dir is in WSL | 3 官方账号 | 需新建或映射：`commands/claude_account.rs`、`services/claude_account/snapshot/mod.rs`等 3 个 | 待迁移 |
| `d288057f` | v4.0.22 | docs(guides): add a guide to switching Claude subscription accounts | — | 上游用户手册/指南/贡献说明；Web 文档树独立维护 | 不适用 |
| `dd81bc95` | v4.0.22 | docs(release): link the Claude accounts guide from v4.0.21 notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `3fc8794c` | v4.0.22 | feat(apps): integrate DeepSeek Harness (#8795) | 2e DeepSeek Harness | DeepSeek Harness 应用接入；Web 需新增 AppType::Dsh；需新建或映射：`commands/tool_uninstall.rs`、`deeplink/mcp.rs`等 14 个 | 待迁移 |
| `03e19fe7` | v4.0.22 | docs(sponsors): update DIT.ai promotion copy and welcome offer | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `ee8ee25e` | v4.0.22 | docs(readme): move DIT.ai ahead of OpenModel in the sponsor table | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `33833a6a` | v4.0.22 | fix(proxy): accept x-api-key in Claude Desktop gateway auth (#5123) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `1718a261` | v4.0.22 | fix(proxy): use constant-time Claude Desktop token check (#7488) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `983113a1` | v4.0.22 | fix(claude-desktop): write inferenceModels in the UI tier order (#7491) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `32db0e57` | v4.0.22 | fix(minimax): keep the weekly window visible after its quota runs out (#8124) | 1a 预设/定价/图标 | Web 的 MiniMax 解析按周总量判断，不依赖 `current_weekly_status`；额度耗尽时周桶照常显示，无需迁移 | 不适用 |
| `6d6b7162` | v4.0.22 | feat(skills): add functionality to open installed skill directory and copy skill name (#8993) | 1d 资源/设置/工具 | 复制 Skill 名称；“打开目录”按用户决定改为显示/复制已安装路径 | 待迁移 |
| `9077b432` | v4.0.22 | perf(skills): discover only the changed repo instead of every repo (#8907) | 1d 资源/设置/工具 | 需新建或映射：`hooks/useSkills.helpers.ts` | 待迁移 |
| `869c0b27` | v4.0.22 | fix(usage): refresh balances for inactive providers (#8342) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `a62203bb` | v4.0.22 | fix(ui): prevent duplicate tooltips and constrain help cards (#8593) | 5a 供应商与全局 UI | 需新建或映射：`components/mcp/AppMatrix.tsx` | 待迁移 |
| `cd9c7210` | v4.0.22 | fix(proxy): reject upstream URLs that loop back to the proxy itself (#8598) | 1b 代理协议 | 需新建或映射：`proxy/upstream_guard.rs` | 待迁移 |
| `144c41b9` | v4.0.22 | fix(auth-center): scroll only the panel body when jumping to an auth section (#8964) | 3 官方账号 | 合并到 Web 已改文件 | 待迁移 |
| `67cce7ad` | v4.0.22 | fix(usage): show bound Claude official account quota in tray and usage settings | 3 官方账号 | 用量设置显示绑定 Claude 账号额度；托盘部分不适用；需新建或映射：`commands/claude_account.rs`、`services/usage_cache.rs` | 待迁移 |
| `e78f641c` | v4.0.22 | fix(apps): report a CLI that is present but yields no version as not runnable | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `03b475fb` | v4.0.22 | feat(terminal): add an option to skip permission prompts when opening a terminal | 1d 资源/设置/工具 | 需新建或映射：`components/providers/OpenTerminalDialog.tsx` | 待迁移 |
| `6776bc06` | v4.0.22 | feat(terminal): open a Codex terminal from a provider card | 1d 资源/设置/工具 | 需新建或映射：`services/provider/codex_terminal.rs`、`components/providers/OpenTerminalDialog.tsx` | 待迁移 |
| `7f82b85b` | v4.0.22 | fix(sidebar): inset today's usage text to align with mode badge text | 5a 供应商与全局 UI | 侧栏动画/分隔线/今日文本对齐；适配 Web 侧栏 WebSidebar；需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `9403960f` | v4.0.22 | fix(copilot): pass Claude models through to native /v1/messages so prompt caching works (#8908) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `ddcb1117` | v4.0.22 | fix(config): recognize TOML array-of-tables headers in section detection (#9029) | 5a 供应商与全局 UI | 需新建或映射：`utils/providerConfigUtils.test.ts` | 待迁移 |
| `6fa328f3` | v4.0.22 | feat(dsh): manage DeepSeek Harness Web and Desktop together, with account login and usage import (#8986) | 2e DeepSeek Harness | 需新建或映射：`commands/dsh.rs`、`deeplink/mcp.rs`等 11 个 | 待迁移 |
| `03ec9dbb` | v4.0.22 | fix(ci): make WSL2 checks manual and guard SQLite tests | 2c Antigravity | SQLite 测试守卫随 Antigravity 会话用量迁移；WSL2 CI 部分不适用；需新建或映射：`services/session_usage_agy.rs`、`services/session_usage_agy/native_models.rs`等 3 个 | 待迁移 |
| `16b6575d` | v4.0.22 | fix(quota): point expired managed accounts to Accounts, not a command | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `115677a1` | v4.0.22 | fix(agy): let a transcript win over another root's index-only entry | 2c Antigravity | 需新建或映射：`session_manager/providers/agy.rs` | 待迁移 |
| `11485ee7` | v4.0.22 | fix(codex): log the underlying cause when the official model list fetch fails | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `ed494fbc` | v4.0.22 | fix(opencode): read the V2 settings.baseURL in the connectivity check | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `7201d81b` | v4.0.22 | feat(sync): let users clear the saved WebDAV config | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `326b394b` | v4.0.22 | fix(proxy): map Claude WebSearch blocked_domains to Responses filters | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `064ae422` | v4.0.22 | fix(proxy): split trailing text out of Gemini function-response turns | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `6c998b4d` | v4.0.22 | fix(claude-account): write oversized credentials to the keychain via argv | 3 官方账号 | 需新建或映射：`services/claude_account/snapshot/store/keychain.rs` | 待迁移 |
| `ebb00da1` | v4.0.22 | feat(terminal): let users append extra arguments when opening a terminal | 1d 资源/设置/工具 | 需新建或映射：`components/providers/OpenTerminalDialog.tsx` | 待迁移 |
| `6282108e` | v4.0.22 | fix(proxy): mount thoughtSignature at Part level instead of inside functionCall (#6690) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `df753b5e` | v4.0.22 | fix(proxy): fall back to Gemini's skip signature on the Gemini Native path | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `8355f1f1` | v4.0.22 | fix(proxy): filter unsupported xAI Responses include marker (#8997) | 1b 代理协议 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `accc4489` | v4.0.22 | feat(usage): import Oh My Pi session usage (#9046) | 2d Oh My Pi | 需新建或映射：`services/session_usage_omp.rs`、`session_manager/providers/omp.rs`等 4 个 | 待迁移 |
| `efb955bd` | v4.0.22 | fix(dsh): drop the account banner and note the shared list in the section title | 2e DeepSeek Harness | 需新建或映射：`components/providers/DshAccount.tsx`、`components/providers/presentation.ts` | 待迁移 |
| `2baa6862` | v4.0.22 | feat(dsh): add DeepSeek official account sign-in like Kimi Code | 2e DeepSeek Harness | 需新建或映射：`components/providers/DshAccount.tsx`、`components/providers/presentation.ts`等 3 个 | 待迁移 |
| `dfa29123` | v4.0.22 | feat(providers): align the shared model editor with Pi and Kimi | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `f283a55f` | v4.0.22 | fix(shell): show DeepSeek Harness by its full name in the sidebar | 5a 供应商与全局 UI | 需新建或映射：`components/shell/Sidebar.tsx` | 待迁移 |
| `4ed07150` | v4.0.22 | test(agy): compare transcript paths as Path so Windows separators match | 2c Antigravity | 需新建或映射：`session_manager/providers/agy.rs` | 待迁移 |
| `f19b3898` | v4.0.22 | fix(usage): cap stored proxy_request_logs.error_message on write (#9010) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `c2aa4e0b` | v4.0.22 | docs(sponsors): update PatewayAI promotion copy | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `3e75b96e` | v4.0.22 | docs(sponsors): refresh AIGoCode copy and add theme-aware banner | — | 赞助商推广文案（i18n）；Web 不展示赞助合作信息 | 不适用 |
| `da263511` | v4.0.22 | fix(apps): rerun the Kimi installer when the installed CLI predates upgrade --yes | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `12e9fe53` | v4.0.22 | feat(presets): add Astron Coding Plan preset for Claude Code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `33aaf8e7` | v4.0.22 | fix(claude-account): pass the global proxy to Claude Code subprocesses | 3 官方账号 | 需新建或映射：`services/claude_account/login.rs`、`services/claude_account/usage.rs` | 待迁移 |
| `0b8a53e3` | v4.0.22 | feat(skills): open a discovered skill's docs from the Discover list | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `c1933fd0` | v4.0.22 | fix(providers): warn when an additive app's live config cannot be read | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `ebdedbee` | v4.0.22 | feat(presets): add ccswitch channel tracking to StreamLake API key links | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `839efbe2` | v4.0.22 | feat(presets): move TokenFlux to tokenflux.com with tokenflux.dev as fallback | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `9433caab` | v4.0.22 | feat(presets): add OspreyAI as a sponsor | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `84d4ce32` | v4.0.22 | chore(release): v4.0.22 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `b7642674` | v4.0.22 | docs(release): add v4.0.22 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `9941a645` | v4.0.23 | fix: classify 400 invalid_grant as permanent, honor export lines when cleaning .env, complete Turkish catalog (#9049) | 1d 资源/设置/工具 | invalid_grant 永久错误分类、清理 .env 时识别 export 行；土耳其语部分不迁移 | 待迁移 |
| `779063c1` | v4.0.23 | fix(usage): record Antigravity latency and first-token time | 1c 会话/用量导入 | 需新建或映射：`services/session_usage_agy.rs`、`services/session_usage_agy/native_models.rs` | 待迁移 |
| `46ea443d` | v4.0.23 | fix(usage): record MiniMax Code latency and first-token time | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `645f8fa1` | v4.0.23 | feat(presets): add Astron MaaS pay-as-you-go preset for Claude Code | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `fcd8f3bd` | v4.0.23 | fix(claude-account): resolve mise shims when locating the claude CLI | 3 官方账号 | 合并到 Web 已改文件 | 待迁移 |
| `12078d5b` | v4.0.23 | feat(auth): add refresh-all button to the Accounts page header (#9073) | 3 官方账号 | 需新建或映射：`components/settings/auth/RefreshAllQuotaButton.tsx` | 待迁移 |
| `6d6ee68f` | v4.0.23 | fix(providers): stop IME composition from duplicating letters in provider key inputs (#9069) | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx` | 待迁移 |
| `7569b27a` | v4.0.23 | fix(providers): keep fetched model list when the form re-renders (#9068) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `d8339d6a` | v4.0.23 | fix(icon-picker): keep picker clear of macOS traffic lights (#9076) | — | 图标选择器避让 macOS 红绿灯；Web 无原生窗口按钮 | 不适用 |
| `ba3d80d8` | v4.0.23 | fix(tray): show the bound Claude account instead of the website for official cards (#9071) | — | 托盘官方卡片显示绑定账号；Web 无托盘（共享账号读取随批次 3 核对） | 不适用 |
| `258c367f` | v4.0.23 | fix(grokbuild): stream large session logs and support byte offset cursor (#9026) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `300453be` | v4.0.23 | fix(codex): handle text-only DeepSeek V4 Flash 0731 on OpenRouter (#6194) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `3817c2b2` | v4.0.23 | fix(provider-form): prevent config editors from overwriting each other (#6777) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `e49d12a5` | v4.0.23 | fix(settings): avoid launching OpenCode Desktop during env check (#7027) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `c7188667` | v4.0.23 | fix(usage): recover bounded Codex forks after parent idle gaps (#9093) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `91a76cfd` | v4.0.23 | fix(startup): keep database lock waits off the UI thread (#9098) | 1d 资源/设置/工具 | 数据库锁等待移出 UI 线程；核对 Web 处理器是否已 spawn_blocking，仅迁移适用部分；需新建或映射：`commands/kimi_oauth.rs`、`commands/profile.rs`等 4 个 | 待迁移 |
| `a77417da` | v4.0.23 | fix(proxy): return JSON for non-streaming Claude model validation (#9097) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `c3adab30` | v4.0.23 | fix(dsh): dedupe profile paths that alias the same file (#9101) | 2e DeepSeek Harness | 需新建或映射：`dsh_config.rs` | 待迁移 |
| `e35eef5d` | v4.0.23 | test(usage): assert bounded fork token totals (#9105) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `4e31203c` | v4.0.23 | refactor(usage): return bool from bounded fork validation (#9106) | 1c 会话/用量导入 | 目标文件 Web 未改，可按最终状态同步 | 待迁移 |
| `a9ec21a9` | v4.0.23 | fix(usage): read DeepSeek Harness credentials for official balance queries (#9108) | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `43a06937` | v4.0.23 | feat(skills): unify discover/installed rows and flash the row after jumping (#9081) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `3d4a3da3` | v4.0.23 | feat(providers): edit Kimi, MiniMax Code and omp configs in their native format | 2b Kimi Code | 需新建或映射：`components/providers/forms/KimiProviderForm.tsx`、`components/providers/forms/helpers/kimiToml.ts`等 5 个 | 待迁移 |
| `5c8f4e2e` | v4.0.23 | feat(presets): add OpenAI API key presets | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `2122f7da` | v4.0.23 | fix(proxy): send reasoning effort to non-whitelisted models on Claude OpenAI routes | 1b 代理协议 | 需新建或映射：`proxy/providers/claude_reasoning.rs`、`components/providers/forms/ClaudeReasoningEffortField.tsx` | 待迁移 |
| `93d0bf18` | v4.0.23 | feat(proxy): map Claude thinking settings to Gemini thinkingConfig | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `bd89109e` | v4.0.23 | feat(presets): add Gemini CLI presets for providers that serve Gemini | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f75cb1b6` | v4.0.23 | fix(tray): restore the main window from a second launch in lightweight mode | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `54115a8c` | v4.0.23 | fix(claude-desktop): publish claude-haiku-5-5 for the Haiku tier in route mode | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `959e4a95` | v4.0.23 | fix(usage): read MiniMax Code and Kimi credentials for native usage queries | 5b 用量/额度 UI | 合并到 Web 已改文件 | 待迁移 |
| `1ddacbd8` | v4.0.23 | docs(sponsors): refresh pinned Kimi banner and copy for K3.1 Pro | — | 上游 README/赞助商表；Web 三语 README 独立维护 | 不适用 |
| `57169e4b` | v4.0.23 | chore(release): v4.0.23 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `66d530d6` | v4.0.23 | docs(release): add v4.0.23 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `8be84055` | v4.0.23 | ci(release): move macOS builds to macos-15 | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `1f21c289` | v4.0.24 | fix(dsh): show DeepSeek account in official sign-in subtitle (#9058) | 2e DeepSeek Harness | 需新建或映射：`components/providers/forms/presetGroups.ts` | 待迁移 |
| `7e02e494` | v4.0.24 | fix(codex): restore reasoning effort after re-enabling (#8998) | 1b 代理协议 | 需新建或映射：`components/providers/forms/helpers/codexChatReasoning.ts` | 待迁移 |
| `c1fb9eec` | v4.0.24 | fix(tray): store Linux tray icons in app cache directory (#9021) | — | 系统托盘/轻量模式；Web 无托盘 | 不适用 |
| `734ed4a1` | v4.0.24 | feat(auth): let sign-in copy the login link instead of opening the browser | 3 官方账号 | 登录只复制链接不打开浏览器；Web 远程访问场景尤其适用；需新建或映射：`services/claude_account/layout.rs`、`services/claude_account/login.rs`等 6 个 | 待迁移 |
| `832fbe65` | v4.0.24 | test(codex-oauth): retry the stale keep-alive request in the replacement test | 1b 代理协议 | 需新建或映射：`proxy/providers/codex_oauth_auth/browser.rs` | 待迁移 |
| `14ddd7b5` | v4.0.24 | fix(dsh): keep only text/image in exported model input | 2e DeepSeek Harness | 需新建或映射：`dsh_config.rs` | 待迁移 |
| `39183b59` | v4.0.24 | fix(proxy): keep max effort for every GPT 5.6+ Sol/Terra/Luna/Astra model | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `6532c5a9` | v4.0.24 | chore(release): v4.0.24 | — | 上游版本号发布；Web 保留独立版本序列 | 不适用 |
| `1f12a3d4` | v4.0.24 | docs(release): add v4.0.24 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `889e50ac` | v4.0.24 | chore(presets): move A6API to the a6api.vip domain | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `c0189078` | v4.0.24 | docs(release): update v4.0.24 release notes | — | 上游发行说明/whats-new；Web CHANGELOG 按实际迁移维护 | 不适用 |
| `9119deca` | v4.0.25 | chore(ci): remove Dependabot version update config | — | 上游 CI/发布流程/仓库模板；Web 维护自有工作流 | 不适用 |
| `686ba51e` | v4.0.25 | fix(claude): keep the route-mode placeholder out of ANTHROPIC_API_KEY (#8111) | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `a9e607c3` | v4.0.25 | feat(codex): add sub-agent concurrency limit field to the provider form (#9056) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `9bd8fe51` | v4.0.25 | fix(terminal): prefer PowerShell 7 (pwsh) when PowerShell is the preferred Windows terminal (#8992) | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `b8112ca5` | v4.0.25 | feat(mcp): check MCP server connectivity on demand (#8348) | 1d 资源/设置/工具 | MCP 按需连通性检查，引入 rmcp/process-wrap 依赖与 Web API；需新建或映射：`services/mcp_connectivity.rs`、`services/mcp_connectivity/tests.rs`等 3 个 | 待迁移 |
| `5c14e917` | v4.0.25 | fix: fetch models.dev through the backend proxy-aware client, fixing sync failures in proxy-only environments (#8739) | 2b Kimi Code | 合并到 Web 已改文件 | 待迁移 |
| `4a0baf69` | v4.0.25 | fix(proxy): strip non-text media (file/audio) for text-only upstreams (#6274) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `153db16e` | v4.0.25 | fix(windows): prevent provider form values from flickering (#6420) | — | WebView2 自动填充覆盖受控输入；Web 运行于普通浏览器，不注入 WebView 钩子 | 不适用 |
| `b696f890` | v4.0.25 | fix(minimax): declare M3.1-Flash native thinking levels in Pi (#8540) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `1cc2c732` | v4.0.25 | fix(mcp): follow up on Pi MCP sync review notes (#7888) | 2a Pi MCP/迁移基线 | Pi 1.0 内置 MCP 同步；Web 需新增 enabled_pi 列（自有 schema v17）及 Pi MCP 适配；需新建或映射：`deeplink/parser.rs`、`deeplink/tests.rs`等 3 个 | 待迁移 |
| `69b41cdb` | v4.0.25 | fix(usage): import Pi official subagent usage (#8386) | 2d Oh My Pi | 需新建或映射：`services/session_usage_omp.rs` | 待迁移 |
| `c17de413` | v4.0.25 | feat(usage): fetch exchange rates automatically (#8716) | 5b 用量/额度 UI | 汇率自动获取（联网），与自选货币配套；保留手动汇率回退；需新建或映射：`services/exchange_rates.rs`、`components/usage/UsageDisplaySection.tsx`等 4 个 | 待迁移 |
| `5ba95160` | v4.0.25 | fix(proxy): send a supported tool_choice for forced web search to xAI (#8664) | 1b 代理协议 | 合并到 Web 已改文件 | 待迁移 |
| `42f7d0e0` | v4.0.25 | feat(skills): align the Discover toolbar with Installed (#9125) | 5a 供应商与全局 UI | 合并到 Web 已改文件 | 待迁移 |
| `4cf15aea` | v4.0.25 | feat(session): implement Kimi session deletion and update related hints (#9157) | 1c 会话/用量导入 | 需新建或映射：`session_manager/providers/kimi.rs` | 待迁移 |
| `0103f4c8` | v4.0.25 | chore(presets): move Qwen pay-as-you-go and Token Plan to the new MaaS domains | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `9267ec8b` | v4.0.25 | feat(claude-desktop): describe routed models with provider and upstream model | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `e6d0bf61` | v4.0.25 | fix(proxy): reject browser-originated requests to the local router | 1b 代理协议 | 本地路由拒绝带 Origin 的浏览器请求与可疑 Host；只作用于代理监听，须确认不影响 Web UI 服务端口与 Docker 下的客户端地址；需新建或映射：`proxy/browser_guard.rs` | 待迁移 |
| `2e2a59cc` | v4.0.25 | feat(claude-code): describe routed and stacked models with provider and upstream model | 4 模式/路由 | 合并到 Web 已改文件 | 待迁移 |
| `3071cae9` | v4.0.25 | fix(terminal): keep proxy and stack settings out of provider terminals | 1d 资源/设置/工具 | 合并到 Web 已改文件 | 待迁移 |
| `aa379e09` | v4.0.25 | chore(presets): remove DIT.ai sponsor and presets | — | DIT.ai 预设在区间内新增后又移除，净效果为空；Web 无该预设 | 不适用 |
| `aa42a93d` | v4.0.25 | feat(codex): add configurable pre-exhaustion quota protection (#8395) | 4 模式/路由 | Codex 官方额度耗尽前保护（可配置），新增 proxy 模块与设置 API；需新建或映射：`proxy/codex_quota_protection.rs`、`components/settings/CodexAuthSettings.tsx`等 3 个 | 待迁移 |
| `eb6ba268` | v4.0.25 | fix(mcp): release cancelled connectivity checks and share the probe limit (#9149) | 1d 资源/设置/工具 | MCP 按需连通性检查，引入 rmcp/process-wrap 依赖与 Web API；需新建或映射：`services/mcp_connectivity.rs`、`services/mcp_connectivity/tests.rs`等 3 个 | 待迁移 |
| `f0252817` | v4.0.25 | feat(pricing): add GPT-6.1 Terra to the built-in pricing table (#9151) | 1a 预设/定价/图标 | 1a：按上游最终状态合并预设/图标/定价数据；不展示赞助身份，列表按名称 A–Z | 已迁移 |
| `f8f487b1` | v4.0.25 | fix(tray): show the tray panel without waiting for its data (#9154) | — | 托盘/安装器/桌面图标；Web 无对应载体 | 不适用 |
| `ef7b77de` | v4.0.25 | fix(deps): update smol-toml to 1.9.1 (#9155) | 1d 资源/设置/工具 | smol-toml 1.6.1 → 1.9.1 | 待迁移 |
| `0b274ec3` | v4.0.25 | fix(usage): dedupe Codex request model aliases (#7643) | 1c 会话/用量导入 | 合并到 Web 已改文件 | 待迁移 |
| `f332b472` | v4.0.25 | fix(codex): hide the forced-v2 warning as soon as classic tools turn off | 5a 供应商与全局 UI | 需新建或映射：`components/providers/mode/StackSubagentFields.tsx` | 待迁移 |
| `fb241637` | v4.0.25 | test(mcp): run the login PATH fixture through a wrapper script | 1d 资源/设置/工具 | MCP 按需连通性检查，引入 rmcp/process-wrap 依赖与 Web API；需新建或映射：`services/mcp_connectivity/tests.rs` | 待迁移 |
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
