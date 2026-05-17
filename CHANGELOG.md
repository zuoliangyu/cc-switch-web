# Changelog

本仓库从 Web 分支独立维护开始，重新以 `0.1.0` 作为初始版本。

## [0.6.1] - 2026-05-17

热修：0.6.0 推送后 Web CI 的 ubuntu job 在 `docker build` 阶段失败（仅工程，无业务改动）。

### 修复

- **Docker 构建 pnpm 版本漂移**：Dockerfile `corepack enable` 后无 `packageManager` 锁定，corepack 拉取最新 pnpm 11.x，其依赖 Node 22 才有的 `node:sqlite`，而 `frontend-builder` 基于 `node:20-bookworm`，导致 `pnpm install --frozen-lockfile` 报 `ERR_UNKNOWN_BUILTIN_MODULE`。`package.json` 增加 `"packageManager": "pnpm@10.20.0"` 锁定（与本地一致、兼容 Node 20）。windows/macos job 不跑 docker 故未受影响。
- 本地完整 CI 模拟（`scripts/ci-check.ps1`：静态检查 + `docker build` + 容器 + `/api/health`）验证通过。

### 工程约定

- 新增项目 `CLAUDE.md`：确立铁律——**每次 `git push` 前必须本地跑一遍 Docker CI 模拟**（本地单测覆盖不到 ubuntu 的 docker 链路），并锁定 pnpm/Node 工具链三处同步。

## [0.6.0] - 2026-05-17

同步上游 cc-switch `2026-04-24 .. 2026-05-16` 积压的 preset 改动（A 类纯预设、B 类需判断项），按"对 Web 后端有直接价值且 runtime 适用"筛过后落地；不含 claude-desktop 整子系统（C 类，另见计划文档）。

### A 类 — 上游预设同步

- **域名/链接迁移**：Micu/米醋 全面迁到 `www.micuapi.ai`（websiteUrl/apiKeyUrl/baseUrl/endpointCandidates，对应上游 `cb45c22b`），openclaw/opencode 模型同步升 `claude-opus-4-7`；邀请链接 `aff` 参数按运营要求改为 `cODn`（Web 专属，上游仍 `aOYQ`）
- **endpoint/链接更新**：Kimi 官网 `/coding/docs/` → `/code/docs/`（`bcf8434c`）；CrazyRouter API 切 `cn.` 子域名（`8dabb9fa`）；DouBaoSeed 改 console 直达链接 + `api/compatible` + 设为合作方（`a0131c9a`）
- **DeepSeek 切 V4**：`deepseek-chat`/`deepseek-reasoner` → `deepseek-v4-pro`/`deepseek-v4-flash`，含 1M 上下文与新定价（`b1f9ce46`）
- **移除 DDSHub 合作方**：claude/codex 预设块整体移除（`99304ffc`），i18n/图标孤儿项保留与上游该提交一致
- **新增预设**：PatewayAI / ClaudeAPI / ClaudeCN / RunAPI / RelaxyCode / 火山Agentplan / BytePlus，按上游各提交触及的文件落到 claude/codex/openclaw/opencode（`08cd5ab5` `df11df4d` `d6bbbf72` `18ffddbf` `3fd38b0a` `58cd5302` `d94eb672` `9050442b`）；web 无 claudeDesktop/hermes preset 文件，相应部分跳过
- **i18n**：新增 7 个合作方促销文案 × zh/en/ja

### B 类 — 需判断项

- **compshare Coding Plan**：claude/codex/openclaw 新增独立预设（`cp.compshare.cn`，与既有 Compshare `api.modelverse.cn` 区分），复用 ucloud 图标/促销 key，新增 `providerForm.presets.ucloudCoding` i18n（`08e2b29b`）
- **百度千帆 Coding Plan**：claude 新增预设；`useStreamCheck` 与后端 `stream_check.rs` 新增千帆 Coding Plan 额度超额（5h/周/月）检测与 `quotaExceeded` 提示 + 单测；i18n × zh/en/ja（`db66348f`）
- **预设按数组顺序渲染**：`ProviderPresetSelector`/`ProviderForm` 去掉 category 分组，数组位置成为展示顺序唯一来源；PatewayAI/火山Agentplan/BytePlus/DouBaoSeed 移到 Shengsuanyun 之后（claude/codex/openclaw/opencode）（`ec8afd63`）
- **图标资源**：7 个 raster 图标接入 web 自有 `src/icons/local.ts` 机制（`src/assets/icons/`），非上游 extracted/iconUrls 体系

### 文档

- README（zh/en/ja）重构：用户使用在前、开发在后；顶部逐版 changelog 折叠为指向 `CHANGELOG.md` 的一行
- 新增 `docs-dev/web-parity-claude-desktop-plan-2026-05.md`：C 类（claude-desktop 整子系统，~8500 行 Tauri→Axum）分阶段实施计划

### 验证

`pnpm tsc` 0 错误；vitest 184 passed + 2 skipped（31 文件全过）；`vite build` 通过；后端新增 `stream_check` 千帆单测。

## [0.5.1] - 2026-05-07

仅工程侧补丁，无业务行为改动：vitest 测试矩阵从 0.4.0 基线 26 fail 收敛到 0 fail。

### 测试夹具与 mock 修齐

**类型 / 形状滞后**：

- `tests/components/McpFormModal.test.tsx` apps 形状期望补 `hermes: false`（v0.3.0 引入第 6 个应用 hermes 时未同步）
- `tests/hooks/useDirectorySettings.test.tsx` `resolvedDirs` 期望补 `openclaw` / `hermes` 两个 key
- `tests/hooks/useSettings.test.tsx` `resetAllDirectories` 调用断言补 `openclawConfigDir` / `hermesConfigDir` 两个参数

**API 改名 / 协议改动**：

- `tests/components/UnifiedSkillsPanel.test.tsx` mock 把 `useInstallSkillsFromZip` 改成现行的 `useInstallSkillArchives`，并补 `useCheckSkillUpdates` / `useUpdateSkill` 两个组件用到但本测试不关心的 hook 最小返回值
- `tests/hooks/useImportExport.test.tsx` + `useImportExport.extra.test.tsx` 整套按 Web hook 新 API 重写：`selectImportUpload(File)` 替代旧的 `openFileDialog`、`importConfigFromUpload(file)` 替代 `importConfigFromFile`、`downloadConfigExport(name)` 返回 `{blob, fileName}` 替代 `saveFileDialog + exportConfigToFile`，并加 `URL.createObjectURL` / `revokeObjectURL` stub 让 jsdom 25 能跑下载流程
- `tests/hooks/useProviderActions.test.tsx` 断言 `updateProvider` mutation 透传 payload 改为 `{ provider, originalId }`，与 OpenCode/OpenClaw additive rename 链路一致
- `tests/utils/webRuntimeClient.skills.test.ts` 端口 `8788` → `8890`

**UI / 行为差异**：

- `tests/components/SessionManagerPage.test.tsx` 删除会话搜索结果用 `getByRole heading` 替代 `getAllByText length === 2`（虚拟化列表在 jsdom 下不渲染行内文字）；「已选 N 项」改 `getAllByText`（toolbar + batch toolbar 两处都展示）
- `tests/integration/App.test.tsx` 中 `EditProviderDialog` 的 `onSubmit` mock 与真实组件对齐成 `{ provider, originalId }` 形态，并加 `retry: 2` 容忍全套并发跑时 MSW 偶发抢占
- `tests/hooks/useSettingsForm.test.tsx` mock `react-i18next.useTranslation` 锁定 `i18n` 引用，避免 hook re-render 时 `useTranslation` 返回新 i18n 引用导致初始化 useEffect 反复跑覆盖 `resetSettings` 的状态

**Web 模式下已不适用（标记 `it.skip` 留 TODO 注释）**：

- `tests/integration/SettingsDialog.test.tsx` 的 `imports configuration and triggers success callback` 端到端流：Web 端没有原生 file dialog，`selectImportFile()` 只 toast 提示，真实导入要走 `selectImportUpload(File)`，`useImportExport` 已经有等价单元覆盖
- 同文件 `allows browsing and resetting directories`：`DirectorySettings` 的"浏览目录"按钮被 `allowBrowse` 守卫隐藏（Web 没有原生目录选择器），reset 行为有 `useDirectorySettings` 单元覆盖
- 同文件 `loads default settings from MSW` 路径期望改为 msw 实际返回的 `/default/app`，不再是早期 Tauri 测试假定的 `/home/mock/.cc-switch`

### 验证

- 后端 `cargo test --lib --test-threads=1` 仍然 **775/775 全过**
- 前端 `pnpm vitest run` **184 passed + 2 skipped = 186/186（0 fail）**，前后两次连跑稳定
- 前端 `pnpm tsc --noEmit` 0 错误

### 文档与版本

- 仓库版本提升到 `0.5.1`
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.5.1` 版本说明

## [0.5.0] - 2026-05-07

例行依赖升级 + 测试夹具修复版。

### 测试夹具修复

- `backend/src/session_manager/providers/openclaw.rs::tests::delete_session_updates_index_and_removes_jsonl` 测试 fixture 改用 `serde_json::json!` 构造索引数据后再 `to_string_pretty`，让 serde 自己处理路径中反斜杠的 JSON 转义，修复 Windows 临时路径含反斜杠时 `serde_json::from_str` 把 `\T` / `\U` 等当成非法 escape 失败的问题。`cargo test --lib --test-threads=1` 现在 **775/775 全过**，零 pre-existing 后端失败。

### 前端依赖升级（pnpm update，仅 minor / patch 范围内升级）

后端 Rust 依赖本轮不变。

- `@codemirror/lang-javascript` `6.2.4 → 6.2.5`
- `@codemirror/lint` `6.8.5 → 6.9.6`
- `@codemirror/state` `6.5.2 → 6.6.0`
- `@codemirror/view` `6.38.2 → 6.42.0`
- `@radix-ui/react-label` `2.1.7 → 2.1.8`
- `@testing-library/jest-dom` `→ 6.9.1` / `@testing-library/react` `16.3.0 → 16.3.2`
- `@lobehub/icons-static-svg` `1.73.0 → 1.90.0`
- `@tanstack/react-query` `5.90.3 → 5.100.9`
- `autoprefixer` `10.4.22 → 10.5.0`
- `code-inspector-plugin` `1.3.3 → 1.5.1`
- `framer-motion` `12.23.25 → 12.38.0`
- `i18next` `25.5.2 → 25.10.10` / `react-i18next` `16.0.0 → 16.6.6`
- `msw` `2.11.6 → 2.14.3`
- `postcss` `8.5.6 → 8.5.14`
- `prettier` `3.6.2 → 3.8.3`
- `react-hook-form` `7.65.0 → 7.75.0`
- `recharts` `3.5.1 → 3.8.1`
- `smol-toml` `1.4.2 → 1.6.1`
- `tailwind-merge` `3.3.1 → 3.5.0`
- `tailwindcss` `3.4.18 → 3.4.19`
- `typescript` `5.9.2 → 5.9.3`
- `vite` `7.3.0 → 7.3.3`
- `zod` `4.1.12 → 4.4.3`

### 显式跳过的 major 升级（评估后留待后续单独迭代）

- `react` / `react-dom` 18→19、`@types/react` / `@types/react-dom` 18→19：跨大版本含 `useEffect` 行为微调与并发渲染差异，需对所有 hook / portal / suspense 链路做完整回归
- `tailwindcss` 3→4：CSS 编译方式重写（Lightning CSS、新 `@import` 语义），影响所有样式
- `vite` 7→8、`@vitejs/plugin-react` 4→6：构建链路与 HMR 行为变化
- `vitest` 2→4：跨大版本 worker / mock API 行为差异
- `typescript` 5→6：编译器选项与 lib types 兼容性
- `i18next` 25→26、`react-i18next` 16→17：API surface 变化
- `jsdom` 25→29：DOM API 兼容性
- `lucide-react` 0.x→1.0：icon API 变化（虽是 0→1 不严格 SemVer，但 changelog 明确包含 breaking changes）

### 验证

- 后端 `cargo check`、`cargo test --lib --test-threads=1` **775/775 全过**
- 前端 `pnpm tsc --noEmit` 0 错误
- 前端 `pnpm vitest run` 159 / 186 通过；27 失败属于跨版本 pre-existing 测试夹具滞后问题（如 `McpFormModal` apps 形状缺 `hermes`、`SessionManagerPage` snapshot 与 `useImportExport` 测试 mock 不一致），与本轮依赖升级无直接因果（v0.4.0 基线已 26 失败），不阻塞发布；后续会专门起一笔修测试 fixture 任务

### 文档与版本

- 仓库版本提升到 `0.5.0`（minor bump）
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.5.0` 版本说明

## [0.4.0] - 2026-05-07

落地 0.3.x 系列中跨度最大的延后项 B1：跨源 usage 去重重构。涉及 `TokenUsage` 类型扩展与 `proxy_request_logs` 查询/写入/rollup 三层 SQL 改造，因为是类型层的架构变化，bump 到 minor 版本。完整跟进计划见 `docs-dev/web-parity-post-3.14-2026-05.md`。

### 7 维指纹 usage 跨源去重（上游 `8669b408` + `2ee7cb41`）

**问题背景**：proxy 实时写入与 session-log 同步使用不同的 `request_id` 生成规则——只有 Claude 走原生 Anthropic 后端时才共享 `session:{message_id}` key；Codex / Gemini / Claude-through-OpenAI compat 路径产生的 `request_id` 总是不同，主键去重根本不起作用，每笔真实请求被记录两次，dashboard 用量翻倍。

**解决方案**：

- `proxy/usage/parser.rs` 扩展 `TokenUsage`：新增 `pub message_id: Option<String>`（`#[serde(skip)]`），新增 `pub fn dedup_request_id() -> String` 方法（有 `message_id` 返回 `session:{id}`、否则随机 UUID），新增 `pub const SESSION_REQUEST_ID_PREFIX = "session:"` 常量。`from_claude_response` / `from_claude_stream_events` 现在会从 `body.id` / `message_start.message.id` 提取 message_id，让 Claude API 直连和 OpenRouter Claude-Anthropic 转换路径都能命中
- `proxy/handlers.rs` 与 `proxy/response_processor.rs` 的 `request_id` 生成从 `Uuid::new_v4()` 改为 `usage.dedup_request_id()`
- `proxy/usage/logger.rs` 的 INSERT 改为 INSERT OR REPLACE：当 proxy 与 session-log 撞上同一 `session:msg_xxx` 主键时，后到的更完整数据会替代前者
- `services/session_usage.rs` 拼 request_id 改用 `SESSION_REQUEST_ID_PREFIX` 常量，避免硬编码

**SQL 层 7 维指纹去重**：

- `services/usage_stats.rs` 新增 `effective_usage_log_filter(log_alias)` SQL 片段生成器：在每个聚合查询的 WHERE 子句插入 `NOT (data_source IN ('session_log','codex_session','gemini_session') AND EXISTS (...))`，子查询用 `(app_type, input/output/cache_read/cache_creation_tokens, status_code∈[200,300), model 大小写不敏感, created_at±10min 窗口)` 7 维匹配排除已被 proxy 行覆盖的 session 行
- 新增 `pub(crate) const SESSION_PROXY_DEDUP_WINDOW_SECONDS = 10*60`、`pub(crate) struct DedupKey`、`pub(crate) fn should_skip_session_insert(conn, request_id, &DedupKey)`、`pub(crate) fn has_matching_proxy_usage_log(conn, &DedupKey)`、`fn proxy_request_id_exists`
- Codex/Gemini session 不暴露 `cache_creation_tokens`，传 0 时匹配器放行 proxy 任意值（避免误把不同请求当重复）
- 三个聚合查询全部接入 filter：`get_usage_summary` / `get_provider_stats` / `get_model_stats` / `get_request_logs` / `check_provider_limits`（今日 + 本月）
- 三个 session 写入路径在 INSERT 前调用 `should_skip_session_insert`：`session_usage.rs::insert_session_log_entry`、`session_usage_codex.rs::insert_codex_session_entry`、`session_usage_gemini.rs::insert_gemini_session_entry`（Gemini 走 UPSERT，调用 `has_matching_proxy_usage_log` 仅在指纹与 proxy 撞上时跳过，不影响同 request_id 的合法更新）
- `database/dao/usage_rollup.rs::do_rollup_and_prune` 的聚合 SQL 同样应用 filter，确保 `usage_daily_rollups` 不会再吸收 session_log 的重复数据

**配套 schema 与 transform 改动**：

- `database/schema.rs` 的 `proxy_request_logs` CREATE TABLE 现在直接包含 `data_source TEXT NOT NULL DEFAULT 'proxy'`，与 migration 路径对齐，避免 memory db 测试缺列
- `proxy/providers/transform.rs::openai_to_anthropic` 行为不变，但新增回归测试 `test_openai_to_anthropic_preserves_id_for_usage_dedup` 钉死它必须把 OpenAI `id` 透传到 Anthropic `body.id` —— 这是 Claude 走 OpenAI compat 路径能复用 `session:` 主键去重的前提

**测试**：

- 新增 `dedup_filter_excludes_session_rows_already_covered_by_proxy`：插入 codex/gemini 的 proxy + session 各一对、再加一条 session-only，验证 logs/summary 都正确排除被覆盖的 session 行
- 新增 `dedup_filter_keeps_session_rows_outside_window_or_with_mismatched_tokens`：session 在时间窗口外或 token 不一致时正确保留
- 新增 `should_skip_session_insert_returns_true_for_matching_proxy_row`：直接调用 helper 函数验证写入路径短路逻辑
- 同步把所有 `TokenUsage { ... }` 构造点（10 处：parser 内部 + response_processor / calculator / logger / session_usage*.rs 的测试）补上 `message_id: None` 字段

### B1 收口

- 0.3.1 已落地的 schema 索引 `idx_request_logs_dedup_lookup` 与 0.3.2 已落地的 dashboard 覆盖索引 `idx_request_logs_app_created_at` 现在都被 B1 实际使用：filter 子查询走前者保持 index-only scan；按 app_type + 时间倒序的 dashboard 查询走后者
- F1-rest 中 `find_model_pricing_row` 的大小写不敏感（0.3.1 已落地）+ 启动时懒 backfill `maybe_backfill_log_costs`（Web 既有）+ B1 的指纹去重，三者共同消除 dashboard 的"幽灵 zero-cost"行 + 双计行

### 文档与版本

- 仓库版本提升到 `0.4.0`（minor bump，因为 `TokenUsage` 是 `pub` 类型，新增 `message_id` 字段属于 ABI 变化）
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.4.0` 版本说明

## [0.3.2] - 2026-05-07

继续推进 0.3.1 中标记为延后的两项：上游 `a1e6c3b6` 的 Codex 切换历史稳定，以及 `f061b777` 中未被 `518d945e` 撤销的 usage perf 余项。完整跟进计划见 `docs-dev/web-parity-post-3.14-2026-05.md`。

### Codex 切换供应商历史稳定

- `backend/src/codex_config.rs` 新增 stable provider id 归一化机制：常量 `CC_SWITCH_CODEX_MODEL_PROVIDER_ID = "ccswitch"` + 内置 `CODEX_RESERVED_MODEL_PROVIDER_IDS` 白名单（`amazon-bedrock` / `openai` / `ollama` / `lmstudio` / `oss` / `ollama-chat`），辅以 `active_codex_model_provider_id`、`is_custom_codex_model_provider_id`、`stable_codex_model_provider_id_from_config`、`codex_model_provider_id_with_table_from_config` 四个 helper 与核心 `normalize_codex_live_config_model_provider_with_anchors` / `rewrite_codex_profile_model_provider_refs`。所有改动严格保留 `[mcp_servers]` / `[profiles]` 等其他段不被破坏（上游 `a1e6c3b6`）
- `backend/src/codex_config.rs` 暴露三个公共入口：
  - `normalize_codex_settings_config_model_provider(settings, anchor)` —— 在 provider 主导的写入边界把 `model_provider` 归一化到稳定 id（优先复用 anchor / 当前 live 中已有的自定义 id；都不可用时回退 `ccswitch`），同步重写匹配的 `[profiles.*]` `model_provider` 引用
  - `restore_codex_settings_config_model_provider_for_backfill(settings, template_settings)` —— backfill 路径反归一化：把 live config 的稳定 id 还原回 stored provider 模板原始 id 与对应 profile 引用
  - `write_codex_live_atomic_with_stable_provider(auth, config_text)` —— 在 `write_codex_live_atomic` 之外多一步归一化的 provider-driven 写入入口，restore-from-backup 路径仍走老的 `write_codex_live_atomic` 保留逐字节备份
- `backend/src/services/provider/live.rs::strip_common_config_from_live_settings` 重构：在 strip common config 之后调用新增的 `restore_live_settings_for_provider_backfill`，让 backfill 链路最终把 live 中的稳定 id 还原回模板原始 id；`write_live_snapshot` 的 Codex 分支改走 `write_codex_live_atomic_with_stable_provider`，写下去之前自动归一化
- `backend/src/services/proxy.rs` 在更新 Codex backup 前，从 existing backup 读 `config` 作为 anchor，调用 `normalize_codex_settings_config_model_provider` 归一化 effective settings；这样 backup 与 live 共享同一稳定 id，后续 takeover restore 不会让 `model_provider` 漂移
- 修复用户感知问题：CC Switch 切换 Codex provider 后，`codex resume` 历史看起来"换了一个"——根因是 Codex 按 `model_provider` 字段过滤 resume 历史，旧 CC Switch 在 `rightcode` / `aihubmix` 这类自定义 id 之间漂移。本次修复保证切换前后 live config 中始终是同一个稳定 id（典型场景：第一次切换从 `rightcode` → 复用为稳定 id；后续切换无论 source 是 `vendor_alpha` / `vendor_beta`，最终落到 live 的都是 `rightcode`）
- 新增 8 条 cargo 单测覆盖：归一化保留当前自定义 id、reserved id 时使用 target、空 config no-op、profile 引用同步重写、不相关 profile 引用保留、连续多次切换稳定性、backfill 反向还原、template 用 reserved id 时 backfill no-op

### Usage perf

- `backend/src/database/schema.rs::create_request_logs_dedup_index_if_supported` 在去重索引之前新增 `(app_type, created_at DESC)` 覆盖索引（`idx_request_logs_app_created_at`），让 dashboard 按 app 类型 + 时间倒序聚合 / 翻页时走 index-only scan，长期累积请求日志的查询性能显著提升（上游 `f061b777`）
- `backend/src/database/schema.rs::seed_model_pricing` 补齐 GPT-5.4（`gpt-5.4` / `gpt-5.4-mini` / `gpt-5.4-nano`，3 条）与 GPT-5.5 系列（`gpt-5.5` / `-low` / `-medium` / `-high` / `-xhigh` / `-minimal`，6 条）的默认定价；现有用户启动时通过 `ensure_model_pricing_seeded` 的 `INSERT OR IGNORE` 自动补齐，配合 0.3.1 已落地的 `find_model_pricing_row` 大小写不敏感修复，`OpenAI/GPT-5.5@HIGH` 等大小写或前缀变形的 model id 现在能直接命中 seed 并被懒 backfill 重算成本，进一步消除 dashboard 的 ghost-zero-cost 行（上游 `f061b777`）

### 维持延后

- B1 完整 7 维指纹去重需要先扩 Web 端 `TokenUsage` 加 `message_id` / `dedup_request_id`，再重写 `usage_stats.rs` 与 `session_usage_*.rs` 的写入 / 读取 / rollup 三层 filter，跨 7 文件的架构改动，留独立任务；`COALESCE(data_source)` 表达式索引与 `idx_request_logs_dedup_lookup` 的 drop 也跟着 B1 一起做
- F1 的 `lib.rs run_step` refactor 与 `maybe_backfill_log_costs` 启动期 spawn 不再独立做：Web 已经采用查询时懒 backfill 策略，等价于上游修复且更稳健；`run_step` 是纯 refactor 不影响行为

### 文档与版本

- 仓库版本提升到 `0.3.2`
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.3.2` 版本说明

## [0.3.1] - 2026-05-07

跟进 0.3.0 发布之后上游 `cc-switch` 累计的一批修复，按"对 Web 后端有直接价值"筛过后落地。完整跟进计划见 `docs-dev/web-parity-post-3.14-2026-05.md`。

### 代理与流式

- `backend/src/proxy/providers/streaming.rs` 重写 finish_reason 处理：去重重复 finish chunk + `pending_message_delta` 缓存延后到 `[DONE]` 发送，避免 OpenRouter / Kimi-K2.6 这类多次 finish 触发 Anthropic 客户端 abort（上游 `6441bc5c`）。同时在末端 message_delta 没有 usage 时兜底 `{input_tokens:0, output_tokens:0}`，避免下游解析 `output_tokens` 拿到 null（上游 `72ab8a5c`）
- `backend/src/proxy/providers/claude.rs` 中 `extract_auth` 现在按 env 变量名推断鉴权策略：`ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`、`ANTHROPIC_API_KEY` → `x-api-key`，与 Anthropic SDK 原生语义对齐；`get_auth_headers` 拆分 `Anthropic` 分支发 `x-api-key`；`stream_check.rs` 改为复用 `ClaudeAdapter::get_auth_headers`，去掉之前"无条件 Bearer + 条件 x-api-key 双发"导致的健康检查假阴性（上游 `bdc4c1e8`）
- `backend/src/proxy/providers/transform.rs` / `transform_responses.rs` 在 `anthropic_to_openai` / `anthropic_to_responses` 入口剥离 system 内容首次出现的 `x-anthropic-billing-header` 行，避免每次轮换的 `cch=` token 让上游 prefix prompt cache 失效（上游 `35bce246`）
- `backend/src/proxy/gemini_url.rs` 新增 `matches_vertex_ai_publisher_model_path` 判定，命中 `/projects/.../locations/.../publishers/google/models/...` 时跳过归一化，保留 Cloudflare AI Gateway 的 Vertex AI 完整 URL 不被压回 `/v1beta/models/*`（上游 `295dd9a9`）
- `backend/src/proxy/providers/transform.rs` 新增 `anthropic_to_openai_with_reasoning_content` 变体，对 Kimi/Moonshot 路径保留 thinking → `reasoning_content`，通用 OpenAI compat 路径仍不带该非标准字段；`claude.rs::transform_claude_request_for_api_format` 通过 model id / `ANTHROPIC_BASE_URL` / `base_url` / `apiEndpoint` 多源识别 Moonshot/Kimi 后启用（上游 `21e2d68d`）
- `backend/src/proxy/providers/transform_responses.rs::build_anthropic_usage_from_responses` 全面加强对 null / 缺失 / 空对象 / 部分字段的 usage 处理，新增 OpenAI 字段名 fallback（`prompt_tokens` / `completion_tokens`），保留 cache token 字段；`streaming_responses.rs` 两处调用点改为始终传入 Some+空对象兜底，修复 DashScope / 部分 Codex OAuth 场景下 VSCode 扩展崩 `Cannot read properties of null` 的问题（上游 `693c36a1`）

### Provider 与会话

- `backend/src/services/balance.rs::query_siliconflow` 的 `unit` 与 `plan_name` 跟随 `is_cn` 切换，`api.siliconflow.com` 国际站显示 USD / `SiliconFlow (EN)`，不再被强制标 CNY（上游 `d2556be5`）
- `backend/src/services/coding_plan.rs` 新增 `parse_zhipu_token_tiers`，把 `data.limits[]` 按 `nextResetTime` 升序后第 0 条标 `five_hour`、第 1 条标 `weekly_limit`，老套餐自然降级到单 `five_hour`；同时把 `TOKENS_LIMIT` 类型匹配改为大小写不敏感（上游 `fafc122d`）
- `backend/src/services/model_fetch.rs` 重写为候选 URL 列表机制：`baseURL/v1/models` → 剥离已知 Anthropic 兼容子路径（`/anthropic`、`/api/anthropic`、`/apps/anthropic`、`/step_plan` 等）后再拼 `/v1/models` / `/models`，遇 404/405 继续，遇其它非成功状态立即停止；新增 `models_url` 覆盖入口；前端 `lib/api/model-fetch.ts` 透传该字段，`lib/runtime/client/web.ts::fetchWebProviderModels` 同步加 `modelsUrl` 形参；新增三语 `providerForm.fetchModelsEndpointNotFound` 文案。修复 DeepSeek / Kimi / Zhipu GLM / MiniMax 这类把 Anthropic 协议挂在子路径而 `/models` 在根路径的供应商上模型拉取直接 404 的问题（上游 `67dbfc0a`）
- `backend/src/proxy/providers/copilot_model_map.rs` 新增（374 行）：把客户端 dash 形式的 Claude 4.x model id（`claude-sonnet-4-6`、`claude-sonnet-4-6[1m]`）归一化为 Copilot upstream 接受的 dot 形式（`claude-sonnet-4.6`、`-1m` 后缀），对 live `/models` 列表做 exact match，找不到时按 family（haiku / sonnet / opus）+ 最高版本号 fallback；`forwarder.rs` 在 Copilot 链路上、`anthropic_to_openai` 转换前先调用 `apply_copilot_model_normalization` 与 `apply_copilot_live_model_resolution`（上游 `fcd83ee3`）
- `backend/src/session_manager/providers/codex.rs::parse_session` 在 `session_meta` 阶段检测 `payload.source.subagent`，命中直接返回 `None`，让 Codex explorer / 子代理产生的会话不再出现在主会话列表（上游 `15497b0e`）；同时在 summary 提取阶段跳过 `<environment_context>` 开头的内容，避免工作目录路径被当成"上次会话最后一条消息"（上游 `1c692694`）
- `src/components/providers/forms/CommonConfigEditor.tsx` 的 `effortHigh` 开关从写顶层 `effortLevel = "high"` 改为写 `env.CLAUDE_CODE_EFFORT_LEVEL = "high"`（顶层字段在 Claude Code 实际不生效）；读取阶段同时认旧顶层字段以兼容历史数据，写入时仅写 env 并清掉旧字段（参考上游 `064b339b`）

### 配置写出与导入

- `backend/src/config.rs::write_json_file` 现在先把数据序列化成 `Value`、递归按字母序排键、再 pretty print，确保配置切换时 `settings.json` 输出确定性，消除 HashMap 插入顺序导致的噪声 git diff（上游 `8084bfaf`）
- `backend/src/services/mcp.rs` 五处 `persist_imported_servers` 路径不再触发 `sync_server_to_apps` 反向写回 live 配置，导入操作改为只写数据库（上游 `7965862e`）

### Windows 适配

- `backend/src/commands/misc.rs` 新增 `get_windows_env_paths_internal` 与 HTTP `GET /api/settings/windows-env-paths`，返回当前后端进程能读到的、白名单内（`USERPROFILE` / `APPDATA` / `LOCALAPPDATA` / `PROGRAMFILES(X86)` 等共 14 项）Windows 环境变量；前端新增 `src/lib/windowsEnvPaths.ts` 实现占位符检测与展开，`CommonConfigEditor` 在 Windows 下检测到 JSON 中含 `%USERPROFILE%` 这类占位符时弹黄色提示条，提供"转为绝对路径"一键展开按钮；三语补 `claudeConfig.winEnv*` 文案。修复 Claude Code 不会自动展开 Windows 占位符、原样落到 `settings.json` 后静默加载失败的问题（上游 `68f1f8d3`）
- `backend/src/commands/misc.rs::try_get_version` 在非 Windows 平台优先读 `$SHELL` 并校验白名单（`sh` / `bash` / `zsh` / `fish` / `dash`），命中则用对应 shell 与 `default_flag_for_shell`，否则回退 `sh -c`；`is_valid_shell` / `default_flag_for_shell` 不再仅 Windows test 下编译，让用户在 zsh / fish 下的 PATH 与 alias 能被 `which claude` 检测到（上游 `4536b95a`）

### Usage 鲁棒性

- `backend/src/services/usage_stats.rs::find_model_pricing_row` 在清洗模型名后追加 `.to_ascii_lowercase()`，让 `OpenAI/GPT-5.2-Codex@LOW` 这类大小写不一致的模型 id 能命中 seed 中小写的定价记录，避免 dashboard 出现 `total_cost = 0` 的"幽灵零成本"行（提取自上游 `f061b777` 中未被 `518d945e` 撤销的非 Hermes 部分）
- `backend/src/database/schema.rs` 新增 `idx_request_logs_dedup_lookup` 7 列覆盖索引（`app_type` / `data_source` / 4 个 token 计数 / `created_at` / `cache_creation_tokens`），由 `create_request_logs_dedup_index_if_supported` 在列就绪后自动创建，为后续完整的 7 维指纹去重重写打基础（上游 `2ee7cb41` schema 部分）

### 测试

- 本轮新增 ~50 条 cargo 单测覆盖以上修复，包括 SSE message_delta 去重 / 重复 finish_reason / 中途 usage-only chunk / 流截断错误路径、ANTHROPIC env 变量推断、Vertex AI URL 保留、Kimi reasoning_content 保留、DashScope usage 鲁棒性 9 例、smiconflow 国际站币种、zhipu tier 8 例、Codex `<environment_context>` 与 subagent session 跳过、`sort_json_keys` 7 例、Anthropic compat 子路径候选 URL 10 例、copilot model id 归一化与 family fallback 19 例

### 延后到独立任务

- B1 完整 7 维指纹去重需要先扩 Web 端 `TokenUsage` 加 `message_id` / `dedup_request_id`，再重写 `usage_stats.rs` 与 `session_usage_*.rs` 的写入 / 读取 / rollup 三层 filter，跨 7 文件的架构改动不在 0.3.1 补丁批次范围
- C7 Codex 切换供应商历史稳定（上游 `a1e6c3b6`）涉及上游 270+ 行 `codex_config.rs` 新函数 + `provider/live.rs` + `proxy.rs` 联动 + 322 行集成测试，且 Web 端 `codex_config.rs` 已有自身实现路径，需要单独立项
- F1 中的 perf / refactor 部分（lib.rs `run_step` helper、启动期 `maybe_backfill_log_costs` 异步 backfill、(app_type, created_at DESC) 覆盖索引、`COALESCE(data_source)` 表达式索引）跨度较大，本轮仅落了核心 zero-cost 修复

### 文档与版本

- 仓库版本提升到 `0.3.1`
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.3.1` 版本说明
- 新增 `docs-dev/web-parity-post-3.14-2026-05.md` 记录本轮跟进上游 0.3.0 发布之后改动的筛选与落地计划

## [0.3.0] - 2026-04-24

### 数据库 schema

- schema 版本从 `v8` 升到 `v10`，与上游 `cc-switch` 3.14 系列对齐；新增 `v8 -> v9` 模型定价种子刷新迁移与 `v9 -> v10` Hermes 支持列迁移，解决共享 `~/.cc-switch/cc-switch.db` 时被上游升到 `v10` 后 Web 端启动报 `数据库版本过新（10），当前应用仅支持 8` 的问题
- `mcp_servers` / `skills` 两表新增 `enabled_hermes` 列；后端 `McpApps` / `SkillApps` 同步补 `hermes` 字段，DAO 的 SELECT / INSERT / UPDATE 全部读写新列，从数据库起到前后端类型完全对齐 `hermes`
- 迁移回归测试由 `schema_migration_v7_to_v8_compatibility_version_only` 改写为 `schema_migration_from_v7_preserves_skills_columns`，校验从 `v7` 起一路迁移到当前 `SCHEMA_VERSION` 时既保留既有列也正确落下 `enabled_hermes`

### Provider、预设与界面对齐

- Claude / OpenClaw / OpenCode 三端直连 Moonshot 的预设从 `kimi-k2.5` 升到 `kimi-k2.6`
- Codex 预设新增 DDSHub 条目，与上游合作伙伴布局一致
- `ProviderIcon` 在图标、回退首字母以及远端图片三种渲染路径上都补上 `title={name}`，悬停始终能看到供应商名称
- `useAutoCompact` 的 `normalWidthRef` 写入移入 overflow 分支，修复最大化后还原窗口无法重新进入紧凑模式的粘死问题
- 工具栏里所有 ghost 图标按钮统一加 `w-8 px-2`，多 App 切换时宽度不再跳动
- `ScrollArea` 视口追加 `[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full`，根布局加 `pb-4`，改善会话列表在滚动容器内的对齐与底部留白
- `UsageScriptModal` 的 `getProviderCredentials` 识别 Hermes（snake_case）与 OpenClaw（camelCase）两种扁平 `settingsConfig`，BALANCE / TOKEN_PLAN 分支改为复用 `providerCredentials`

### 代理与会话

- 后端 `session_manager/providers/gemini.rs` 读取每个会话目录下的 `.project_root`，把项目路径回填到 `SessionMeta.project_dir`，与上游 `gemini cli resume` 行为对齐
- `proxy/handlers.rs` 的 `should_use_claude_transform_streaming` 在 `codex_oauth + openai_responses` 组合下强制返回 `true`，即便客户端未请求流式、上游非 SSE 也会走 Claude 流式转换路径

### 类型与面板

- `AppId` 体系内 `hermes` 覆盖更完整：`APP_IDS`/`MCP_SKILLS_APP_IDS` 相关记录值、`McpApps`/`SkillApps`/`ProvidersByApp`/`CurrentProviderState` 等类型，以及 `McpFormModal`、`UnifiedMcpPanel`、`UnifiedSkillsPanel`、`deeplink/importer.ts`、`tests/msw/state.ts` 中的硬编码构造点，全部补齐 `hermes` 分支
- `HermesPlaceholderPanel` 的 `providerId` 补上 `string` 类型
- 前端 `providersApi` 新增 `getHermesLiveProviderIds`，与 `useHermes` hook 对接

### 构建与工程化

- `backend/src/proxy/sse.rs` 补齐 `take_sse_block` 与 `append_utf8_safe`（此前 `streaming_gemini.rs` 有 import 但没有实现），解决 `cargo check` 的 `E0432` 报错
- `backend/Cargo.toml` 在 `reqwest` feature 列表里加上 `blocking`，修复 `commands/hermes.rs` 中 `reqwest::blocking::Client` 的 `E0433`
- `backend/src/proxy/response_processor.rs` 的 `build_state` 测试辅助补齐 `gemini_shadow` 字段，解决 `E0063`
- `backend/src/proxy/providers/claude.rs` 去掉 `AuthStrategy` 下已被前面分支完全覆盖的 `_ => vec![]` 分支，清除 `unreachable_pattern` 警告
- `backend/src/proxy/providers/gemini.rs` 的 `parse_oauth_access_token` 被测试引用，改为 `#[allow(dead_code)] pub fn` 留存，既消除 `dead_code` 警告也不破坏测试
- `scripts/dev.ps1` 把 `-Arguments @($Mode) + $ExtraArgs` 改成表达式形式 `(@($Mode) + $extras)`，并在无额外参数时 fallback 到空数组，避免 PowerShell 把 `+` 当位置参数、以及 `Start-Process` 拒收含 `$null` 的 `-ArgumentList`
- `package.json` 加 `pnpm.overrides.baseline-browser-mapping: ^2.10.21`，解决每次 `vite` 启动打印的 `data in this module is over two months old` 警告
- 更新检测入口 `WEB_GITHUB_REPO` 由 `zuoliangyu/zuoliangyu-cc-switch-web` 更正为 `zuoliangyu/cc-switch-web`，不再依赖 GitHub 301 重定向

### 文档与版本

- 仓库版本提升到 `0.3.0`
- 默认 README 改为中文：`README.md` 现在是中文版本，英文内容迁移到 `README_EN.md`，同时删除旧的 `README_ZH.md`；三份 README 的语言切换行、`AGENTS.md` 与 `docs-dev/web-parity-v3.14.0-plan-2026-04.md` 中的命名描述一并更新
- `README.md` / `README_EN.md` / `README_JA.md` 同步更新 `0.3.0` 版本说明

## [0.2.2] - 2026-04-19

### 修复

- 将当前 schema 版本正式提升到 `v8`，补齐缺失的 `v7 -> v8` 兼容迁移，避免 `v0.2.0` 这一线发布包在数据库启动时卡在 `未知的数据库版本 7，无法迁移到 8`
- 补充 `v7 -> v8` 兼容迁移回归测试，确保数据库能从上一版本平滑升级到当前 schema

### 文档与版本

- 仓库版本提升到 `0.2.2`
- README、README_ZH、README_JA 同步更新 `0.2.2` 版本说明与 schema `v8` 兼容迁移说明

## [0.2.1] - 2026-04-19

### 修复

- 修复 `v0.2.0` 发布包误将数据库 schema 版本提升到 `v8`、但未补齐最后一步迁移的问题，避免已有数据库或新数据库在启动时卡在 `未知的数据库版本 7，无法迁移到 8`
- 为数据库迁移补充回归测试，覆盖“当前 schema 从上一版本升级到最新版本”这条链路，防止再次出现仅提升版本号却遗漏最后一步迁移的发布事故

### 文档与版本

- 仓库版本提升到 `0.2.1`
- README、README_ZH、README_JA 同步更新 `0.2.1` 版本说明与本次发布修复内容

## [0.2.0] - 2026-04-11

### Provider、认证与预设能力对齐

- 补齐 Codex OAuth 托管认证闭环、多账号文案与 Responses 协议约束
- 补齐 Gemini 官方 OAuth 判断、Claude 预设隐藏支持、Claude Thinking 回退展示与 adaptive thinking 到 `xhigh` 的映射修正
- 补齐 Web 版 Provider Key 锁定逻辑、Key 编辑重命名闭环、按供应商打开终端，以及 OpenCode / OpenClaw 健康检查与测试入口
- 补齐 additive provider live 管理标记、累加模式复制仅落库行为、Provider 卡片状态展示与动作限制
- 补齐 OMO 提示文案、OMO Slim 高级字段提示与 OMO Slim Council agent
- 补齐 DDSHub、LionCCAPI、Shengsuanyun、TheRouter、PIPELLM 等预设、预设图标资源与合作伙伴标识/促销链路
- 对齐 Oh My OpenCode 预设地址、E-FlowCode 预设默认密钥、Provider 预设展示顺序与 X-Code 预设图标键
- 修正 Anthropic 转 OpenAI 的 system 消息归一化逻辑，并恢复 OpenCode 模型拉取与通用配置迁移兼容

### 用量、设置与工作流补全

- 恢复用量页会话同步与数据来源概览，补齐请求日志来源列、应用过滤联动与用量页应用类型过滤
- 补齐原生余额与 Token Plan 模板、Token Plan 内联徽章、官方额度当前态语义，以及 GitHub Copilot 额度展示
- 补齐本地服务开机自启、首选终端设置、Claude Code 插件自动同步、首次安装确认跳过与首次使用提示
- 补齐更新检查与版本提示、认证中心/设置页/用量页三语文案，以及模型拉取、认证标签等多语言补全

### Skills、Session 与 Deep Link 对齐

- 补齐 skills.sh 搜索能力、Skills 更新能力与 Skill 存储位置切换
- 补齐会话搜索高亮、会话恢复终端，以及验证码复制兼容性
- 补齐 Deep Link 远程配置合并、Provider 预览细节、配置预览语义化、用量配置预览与确认提醒
- 补齐 Deep Link skill 导入提醒、mcp 预览摘要、解析失败提示、子资源标题展示，以及配置合并失败时的降级导入行为

### 资源、图标与辅助体验

- 补齐本地图标元数据搜索与 Web 版预设图标资源
- 补齐通用配置编辑引导、通用配置弹窗引导与 OMO Slim 相关提示文案

### Web 界面升级

- Provider 与 Settings 页面升级为工作台式信息层级，重构顶部引导区、分区卡片与粘性操作区
- Skills 与 Sessions 页面升级为统一的玻璃卡片工作台风格，补强筛选区、空状态、列表卡片和详情区层次
- Skills 仓库管理面板、会话目录面板与通用全屏面板同步切换到新的 Web 视觉语言

### 文档与版本

- 仓库版本提升到 `0.2.0`
- README、README_ZH、README_JA 同步更新当前版本与最近完成的 Web 能力/UI 升级说明
- 补充 `0.2.0` 发布说明，归档 `0.1.3` 之后到当前版本之间的全部提交范围

## [0.1.3] - 2026-04-05

### Web 能力对齐

- 为 Claude、Codex、Gemini、OpenClaw 的供应商表单补齐模型拉取能力
- 补齐 Claude、Codex、Gemini 的官方订阅额度展示与查询链路
- 为 Web 本地服务补齐环境变量冲突检测、删除与恢复接口，并在前端增加冲突提醒条
- 为 Web 端增加 Deep Link 导入能力，支持 `?deeplink=...` 自动导入与手动粘贴 `ccswitch://...`
- About 页面增加“检查新版本”入口，直接跳转到 GitHub 最新发布页

### 文档

- README 中补充本轮已对齐的 Web 能力说明
- 新增 `docs-dev/web-parity-2026-04.md` 记录本轮对齐范围与约束

## [0.1.2] - 2026-04-05

### 界面视觉

- 将全站基础主题切换为 Material Monet 风格配色，重写 light / dark 下的核心主题变量
- 调整全局玻璃卡片、页面背景层次和焦点高亮，统一为更柔和的 Monet 视觉语言
- 替换按钮、标签页、输入框、开关、首页应用标签、供应商卡片与设置页关键状态的硬编码蓝色主色，避免旧主题残留
- 设置页新增 Material Monet 主题方案选择，支持多套预置配色卡片并与浅色 / 深色 / 跟随系统组合使用

### 运行时与端口

- 为本地 Web 服务增加 `--host`、`--backend-port` 与 `--port-scan-count` 启动参数，环境变量 `CC_SWITCH_WEB_HOST / PORT / PORT_SCAN_COUNT` 继续兼容
- 发布态服务默认首选端口调整为 `8890`，当端口被占用、被系统排除或无权限绑定时，会自动向后尝试可用端口
- 修复启动日志先打印 `listening` 再实际绑定端口的误导行为，改为绑定成功后再输出最终监听地址
- 为 `pnpm dev` 增加 `-f/--frontend-port`、`-b/--backend-port` 与 `--host` 参数，前端与后端端口选择逻辑统一
- 更新 Docker 默认端口与 compose 映射方式，支持通过 `CC_SWITCH_WEB_PORT` 统一指定容器内外监听端口，并默认关闭容器内自动换端口以避免端口映射漂移

## [0.1.1] - 2026-04-03

### 修复

- 修复 Web 模式下 Skills 卸载与应用开关在 repo 型 skill id 含 `/` 时的请求链路问题
- 为 Skills 相关 Web 请求补充回归测试，覆盖 repo 型 skill id 的卸载与开关场景
- 修复本地开发模式可能误命中旧 `dist` 静态资源的问题，默认禁用后端静态前端托管，避免 `3000` 与 `8788` 混用导致排查失真

### 开发体验

- 为本地 `pnpm dev` 增加前端请求/响应调试日志
- 为本地 Rust Web API 增加 method/path/status/耗时日志，便于定位请求链路问题
- 更新中英日 README，本地开发文档同步补充调试日志与访问入口说明

### 兼容性与运行时

- 引入 `env_logger` 初始化后端日志输出，便于本地开发和问题定位
- 保持发布版默认不启用本地开发注入的请求调试开关

## [0.1.0] - 2026-04-02

### 首次发布

这是 `CC Switch Web` 仓库独立维护后的首个正式版本。

当前版本不再延续旧桌面端发布线，而是以 Web-only 形态重新建立 `0.1.0` 基线，定位为：

- 前端：浏览器 Web UI
- 后端：本地 Rust 服务
- 访问方式：浏览器打开本地地址
- 支持场景：Windows、macOS、Linux、无桌面的 Linux 服务器、Docker

### 仓库定位与版本基线

- 正式建立 `cc-switch` 的 Web 分支仓库定位
- 仓库包名、项目名称、作者信息、仓库地址与说明文档统一切换到 `cc-switch-web`
- 清理继承自旧桌面分支的历史发布语义，以 `0.1.0` 作为当前仓库首发版本
- README、CHANGELOG 与仓库元信息同步收敛到 Web-only 口径

### 架构调整

- 完成从桌面壳架构向「Web 前端 + 本地 Rust 服务」架构的主线收敛
- Rust 服务支持直接托管前端静态资源，发布产物可作为单文件嵌入式 Web 服务运行
- 前端主流程不再以桌面运行时为前提，核心交互统一面向本地服务 API
- 默认数据路径保持与 CC Switch 本地端一致，继续使用 `~/.cc-switch`

### 核心功能迁移

本版本已将当前 Web 端可用主流程整理为正式发布基线，涵盖：

- Provider 配置管理、切换、导入、健康检查、排序与通用配置能力
- MCP 配置管理、导入、编辑、删除、启用切换与同步相关能力
- Prompt 管理、读取、编辑、删除与启用能力
- Skills 的扫描、导入、安装、卸载、仓库管理、备份恢复与统一管理能力
- Workspace、Session、Usage 统计等核心页面能力
- Proxy、Failover、WebDAV Sync、数据库导入导出、备份等本地服务能力
- OpenCode、OpenClaw、Claude、Codex、Gemini 等当前 Web 主路径下的配置接入能力

### 运行与分发

- 提供统一的开发、构建、检查入口：
  - `pnpm dev`
  - `pnpm build`
  - `pnpm check`
- 提供 Windows PowerShell 对应入口：
  - `scripts/dev.ps1`
  - `scripts/build.ps1`
  - `scripts/check.ps1`
- 新增 Windows 本地导出脚本 `scripts/package-artifacts.ps1`
  - 可一次生成 Windows 可执行文件、Linux 发布包、Docker 镜像包
- Linux 发布链调整为 `x86_64-unknown-linux-musl`，尽量减少宿主机运行库差异导致的问题
- Docker 运行模式与 Linux 发布包导出链路已纳入正式支持范围
- 提供 Linux `systemd` 示例，便于无桌面服务器长期托管

### 工程化与 CI/CD

- 新增并收敛脚本体系，仅保留 `dev / build / check` 为主入口
- 脚本输出与错误提示统一为英文，降低跨平台使用和日志排查成本
- GitHub Actions 已覆盖：
  - Web 检查
  - 平台包构建
  - Docker 镜像构建
- Linux 打包链统一通过 Docker 多阶段构建导出
- 增加本地与 CI 复用的检查脚本，统一前端与 Rust 静态检查流程

### 清理与收口

- 删除旧桌面端相关的无效脚本、发布口径和残留说明
- 清理与 Tauri / 桌面壳强耦合的仓库结构、文案与部分旧兼容逻辑
- 将当前仓库明确收敛为 Web-only 维护方向，不再以桌面 GUI 发布为目标
