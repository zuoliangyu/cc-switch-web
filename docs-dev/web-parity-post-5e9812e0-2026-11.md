# Web 跟进 cc-switch v4.0.29 及其后差异清单

> 状态：已完成（2026-11-11 建立并完成；29 项均已处置：已迁移 22、不适用 7；随 3.3.0 发版）。
> 上游：`upstream` = `git@github.com:farion1231/cc-switch.git`，只读（push URL 为 `DISABLED_READ_ONLY`）。`remote.upstream.tagOpt = --no-tags`：取上游永远不带 tag；2026-11-11 已删掉本地 80 个上游 tag（名单在当时的临时目录），本地只留 Web 自己的 tag。
> 起点：`5e9812e0`（上一轮冻结目标）；目标：`upstream/main` = `abf50589`（v4.0.29 之后，2026-11-11）。
> 范围：29 个提交（无合并提交），113 个文件变化（+14535/−1463）。Web 起点为 `a26a99b8`（3.2.0 之后）。
> 前一轮：[v4.0.26–v4.0.28 迁移台账](web-parity-post-a3eafa40-2026-11.md)。验证命令与流程沿用前一轮；发版前另跑 `pnpm verify:docker -- verify`（CI 与发布镜像用 Rust 1.88，警告即错误）。

说明：Web 仓库与上游无共同 Git 历史，上游 `src-tauri/src/` 对应 Web `backend/src/`；上游补丁多数无法直接应用，按行为手工迁移。

## 1. 版本分布

| 版本 | 提交数 |
| --- | --- |
| v4.0.29 | 20 |
| 未发布 | 9 |

## 2. 主要内容

| 领域 | 上游变化 | Web 处理 |
| --- | --- | --- |
| Copilot CLI | 自带模型（BYOK）卡改为写进 Copilot 原生 `providers.json`（加 / 删、读失败保留、写前校验）、深链导入新形状与 `bearerToken`、会话用量归到所选卡、空模型列表说明 | 批次 B |
| 隐私过滤 | 路由 / 聚合模式下把请求里的个人信息与密钥换成占位符再转发（正则 + gitleaks 规则），默认关，工具结果另有子开关 | 批次 C |
| 代理 / Codex | Codex→Anthropic 默认 `max_tokens` 32000、第三方上游去掉 Codex 私有 include 标记、官方卡经路由透传官方模型列表、WSL 跑 Codex 时目录指针写文件名 | 批次 A |
| 杂项 | 只能走路由的卡禁用「打开终端」、Claude 账号额度先核对默认凭据归属、agy 额度带 cloudaicompanionProject 并提示地区不可用、omo-slim 无限重渲染、更新说明弹窗在 macOS / Linux 塌陷、VS Code copilot-shim、CCSub 推广字段 | 批次 A |
| i18n / 文档 / 发版 | 七种语言一起维护、ko/tr/ru 文案、上游 README 与发行说明 | 不适用（只保留 zh/en/ja） |

## 3. 批次与处置统计

| 批次 | 范围 | 提交数 | 状态 |
| --- | --- | --- | --- |
| A | 代理 / Codex / 杂项 | 13 | 已完成（12 已迁移、1 不适用） |
| B | Copilot 自带模型卡 | 9 | 已完成（9 已迁移） |
| C | 隐私过滤 | 1 | 已完成（1 已迁移） |
| — | 不适用 | 6 | — |

执行顺序：A → B → C，逐批提交。本机内存紧张（2026-11-11 曾因内存不足终止 Docker 验证），各批编译不并行。

## 4. 决策记录

- 沿用前几轮：不新增语言（只 zh/en/ja）；“打开目录”类功能改为显示 / 复制路径；预设按上游分组、组内 A–Z，不展示赞助 / 合作标识与置顶；主题保留 Web 的 CSS 变量；故障转移队列与卡片不做拖动排名。
- 2026-11-11：用户要求不再拉上游 tag（避免推送时带上），已设 `remote.upstream.tagOpt --no-tags` 并删除本地上游 tag。
- 发现的旧缺口（不属本轮）：上游 2026-07 起 Codex 表单有「最大输出 Token」项（`meta.maxOutputTokens`），Web 后端有该字段但表单没有输入项。

## 5. 提交矩阵

| 提交 | 版本 | 标题 | 批次 | 说明 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `3bde8262` | v4.0.29 | fix(proxy): raise the Codex to Anthropic default max_tokens to 32000 | A | A：Codex→Anthropic 默认 `max_tokens` 从 8192 提到 32000（`transform_codex_anthropic::DEFAULT_CODEX_ANTHROPIC_MAX_TOKENS`，forwarder 改用它），迁入上游用例；上游表单提示与占位文案不适用（Web 的 Codex 表单没有「最大输出 Token」项，旧缺口见第 4 节） | 已迁移 |
| `aab0ea57` | v4.0.29 | fix(copilot): explain empty model lists and log both model counts | B | B：后端日志记 /models 原始数量与可在模型选择器用的数量（缓存命中也记）；Codex / Claude Code / Claude Desktop 表单拉到 0 个 Copilot 模型时说明多半是 Copilot Free，Codex 另区分「有模型但都不支持所选上游格式」。Web 的 Claude Code 表单是选中账号后自动加载模型（上游是手动拉取），空列表时同样提示一次；三语文案；迁入上游 Codex 用例 | 已迁移 |
| `17e20a59` | v4.0.29 | fix(copilot): only suggest gpt-4.1/gpt-4o as a fallback on Claude forms | B | B：空列表提示拆成两条，Claude Code / Claude Desktop 保留「可手填 gpt-4.1 / gpt-4o」，Codex 只说明套餐（Codex 路由只转发声明过的端点） | 已迁移 |
| `3561af53` | v4.0.29 | feat(i18n): maintain all seven UI languages together | — | 托盘、ru/tr/zh-TW 文案与七语言一致性测试；Web 只保留 zh/en/ja、无托盘 | 不适用 |
| `3dfc92c6` | v4.0.29 | fix(i18n): add ko, tr and ru strings for recent Copilot and max_tokens changes | — | 只改 ko/tr/ru | 不适用 |
| `9c0ab57f` | v4.0.29 | test(grok): expect the 32000 default in the max output tokens hint | A | 只改 Grok Build 表单「最大输出 Token」提示的用例；Web 没有该表单项与文案 | 不适用 |
| `5d961a3a` | v4.0.29 | fix(terminal): disable the provider terminal for route-only cards | A | A：只能走路由的卡（托管账号卡、非原生格式，`providerNeedsRouting`）的「打开终端」按钮保留但置灰并说明原因（`terminalNeedsRoute`，Claude Code 与 Codex）；Codex 这类卡此前隐藏，改为同样置灰；Web 的卡片按钮用 `IconAction` / `DisabledReason`；三语文案；迁入上游用例 | 已迁移 |
| `7b657e02` | v4.0.29 | feat(copilot): keep BYOK cards in Copilot's native providers.json | B | B：Copilot CLI 变成混合应用（`is_additive_mode` 含 Copilot）：官方卡只开终端、从不写文件；自带模型卡改为 `{provider, models, reasoningEffort?}`，「添加」写进 `$COPILOT_HOME/providers.json`（或 `COPILOT_PROVIDERS_CONFIG`），只动这张卡自己的条目、整份先按 Copilot 规则校验、事务式写入。`copilot_config.rs` / `copilot_direct.rs` 与上游同源，补丁直接合入（保留 Web 自加的 Copilot 登录账号匹配）；`services/provider/mod.rs` 结构与上游不同，按 Web 写法新增 `list_copilot` / `add_copilot` / `update_copilot` / `save_copilot_provider` / `add_copilot_to_live`，接到列表、当前项（拥有 Copilot 默认模型的那家）、新增、编辑（未添加时可改 id）、删除、加入 / 移出、切换（=添加）各处；`live.rs` 的手动导入改用 `imports_default_config`（Copilot 官方卡仍从 settings.json 导入），不迁上游 `should_import_default_config_on_startup`（Web 没有启动时自动导入）。打开终端：自带模型卡要先添加，启动时 `--model=<卡 id>/<第一个模型>`、清掉全部 `COPILOT_PROVIDER_*` 与 `COPILOT_MODEL`，控制字符的模型名各平台都拒绝（Web 原有的 Windows `" % ^` 拒绝保留）。Web 自有的 Copilot 流式检测改读 `provider` 节点（旧形状先转换，测试模型取第一个模型的 wireModel / id）；凭据提取同上 | 已迁移 |
| `9bd9c516` | v4.0.29 | feat(copilot): attribute session usage to the selected BYOK card | B | B：Copilot 会话用量跟着 session.start / model_change / resume 里选中的 `<id>/<模型>` 记到对应的自带模型卡（库里有这张卡时），否则仍记 `_copilot_session`；去重键不变。补丁直接合入 | 已迁移 |
| `65720291` | v4.0.29 | feat(copilot): import deep links as providers.json cards | B | B：Web 的深链在前端解析：Copilot 链接构建成新卡片形状，卡片 id 取名字的 ASCII slug、和库里或 providers.json 里已有的撞了加 `-2`…（导入时查一次列表）；Copilot 算累加式，确认框给「添加到应用」开关（默认开），不再按只能开终端处理；确认框的配置预览认新旧两种形状 | 已迁移 |
| `8d866cef` | v4.0.29 | feat(copilot): manage BYOK cards with add/remove in the provider list | B | B：前端：`CopilotProviderForm`、`copilotProviderPresets`、新 `copilotConfig.ts` 与 Web 原版同源，直接取上游最终版（toast 改回 Web 的 sonner）；`presentation.ts`、`OpenTerminalDialog` 补丁合入（保留批次 A 的「只能走路由的卡置灰」）；`App`、`ProviderList`、`ProviderCard`、`AddProviderDialog`、`mutations`、`providerCapabilities`、`providerConfigUtils` 按 Web 结构手工接：Kimi 的「添加」泛化到 Copilot、移出 / 复制副本（官方卡随机 id、自带模型卡 `<id>-copy` 且不超过 64 字符）、已添加状态看 `liveConfigManaged`、官方卡分组与默认那家不能移除、自带模型卡没添加时「打开终端」置灰并说明；三语文案按上游 key 合并 | 已迁移 |
| `83d744b9` | v4.0.29 | fix(claude-account): verify the default credential owner before reading quota | A | A：查 Claude 账号额度前核对默认槽位的凭据确实是这个号（`default_login_is`），对不上就读它自己的账号目录 | 已迁移 |
| `81fd9c25` | v4.0.29 | test(claude-account): cover which slot the quota is read from | A | A：判断抽成 `resolve_slot`（槽位、凭据存储、账号目录由调用方给），迁入上游四个用例 | 已迁移 |
| `0d69dd06` | v4.0.29 | feat(copilot): accept bearerToken and keep every model ID in deep links | B | B：链接 config 认原生 `{provider, models}` 与旧 env 形状，`bearerToken` 也算凭据（URL 的 apiKey 优先），原生形状里的其余模型 ID 保留、链接模型排第一，模型 ID 必须是字面量；Copilot 的模型在合并 config 后构建时要求（不在解析阶段要求，模型可来自 config）。迁入上游用例语义 | 已迁移 |
| `4d68975b` | v4.0.29 | fix(copilot): keep saved cards when providers.json cannot be read | B | B：读不了 providers.json 时列表照旧返回已存的卡（记警告），不当成被移除；补丁直接合入 | 已迁移 |
| `cf12f010` | v4.0.29 | fix(copilot): validate output limits and systemMessage before writing a card | B | B：写卡片前校验 `maxOutputTokens` 要给 `maxContextWindowTokens` 留出余量、`systemMessage` 形状；前端表单与 copilotConfig 同步（随上游最终版带入）；后端补丁直接合入 | 已迁移 |
| `5c462269` | v4.0.29 | fix(codex): keep a bare model_catalog_json pointer when the desktop app runs Codex in WSL | A | A：Codex 桌面端开了「在 WSL 中运行 Codex」（`[desktop] runCodexInWindowsSubsystemForLinux`）时目录指针写裸文件名，只在 Windows 宿主上看这个开关；Web 的容器内规则不变；迁入上游用例（非 Windows 那条期望值按 `catalog_pointer_value` 算，容器里也成立） | 已迁移 |
| `e38a4fd1` | v4.0.29 | fix(codex): pass the official model list through the route for official cards | A | A：官方卡走路由、没有 CC Switch 目录时，Codex 的 `GET /models` 带着 Codex 自己的登录转给官方上游并原样交回（含 304/401），Codex 没要压缩时这边要 gzip 再解开；新增 `codex_models_passthrough`，Web 缺的 `strip_hop_by_ 一并补到 `response_processor`；迁入上游用例 | 已迁移 |
| `cb187a11` | v4.0.29 | chore(release): v4.0.29 | — | 上游版本号与 whats-new | 不适用 |
| `efbec38f` | v4.0.29 | docs(release): add v4.0.29 release notes | — | 上游发行说明 | 不适用 |
| `af791fd0` | 未发布 | fix(omo-slim): prevent infinite re-render when categories prop is undefined (#3905) | A | A：omo-slim 下 `categories` 默认值改为模块级常量，避免无限重渲染 | 已迁移 |
| `3f15f878` | 未发布 | docs(readme): move RunAPI below SubRouter and remove CCSub from sponsors | — | 上游 README 赞助位 | 不适用 |
| `242abf78` | 未发布 | chore(presets): remove the CCSub promotion copy | A | A：删掉 9 个预设文件里的 `partnerPromotionKey: "ccsub"` 与三语 `partnerPromotion.ccsub` 文案（Web 本来就不展示推广）；Web 自有的预设用例改为断言该文案已去掉 | 已迁移 |
| `f57e24ce` | 未发布 | docs(readme): add Trendshift daily/weekly/monthly Rust badges | — | 上游 README 徽章 | 不适用 |
| `f38a612c` | 未发布 | fix(tools): skip VS Code copilot-shim when detecting Copilot CLI on Windows | A | A：Web 此前已自行修过（`is_vscode_copilot_shim`，PATH 解析与目录扫描都跳过）；按上游改为按路径里的 `/copilot-shim/` 认（反斜杠先换斜杠，Windows 形态的路径在任何宿主上都认得出），并加到 `windows_preferred_tool_executable`；迁入上游用例 | 已迁移 |
| `32365a54` | 未发布 | feat: add privacy filter for PII and secrets detection (#8951) | C | C：`proxy/privacy_filter`（PII 正则、gitleaks 规则集 + 上下文口令 + 熵兜底、四种请求格式的文本改写）与上游用例原样迁入；配置存 settings 表 `privacy_filter_config`（默认关，工具结果子开关默认关），新增 `GET/PUT /api/settings/privacy-filter`，打开时后台预热规则；Claude / Claude Desktop、Codex Chat / Responses / compact / 图片与独立透传、Gemini 六个入口在建好请求上下文后过滤（Session ID 与模型名仍按原始请求体提取），只在路由与聚合模式经过代理时生效；设置 › 数据里云同步之后加「隐私过滤器」（三语）。与上游不同：占位符语言取设置里的界面语言，没保存过时按服务进程的 `LC_ALL` / `LC_MESSAGES` / `LANG`，再没有用英文（上游按托盘语言 / 系统区域；Web 没有托盘，浏览器语言服务端拿不到）；补面板用例与区域名映射用例 | 已迁移 |
| `f16a9d74` | 未发布 | fix(ui): stop the what's-new dialog from collapsing on macOS and Linux (#9401) | A | A：Web 没有更新说明弹窗；同一个 WebKit 问题（`h-fit` 弹窗里 `flex-1` 的滚动正文被压成 0 高，Safari 下出现）在 Web 的 MCP 向导与 Skill 压缩包安装弹窗里存在，正文改为 `min-h-0 flex-auto`，`dialog.tsx` 记下这条约定 | 已迁移 |
| `a6200c1e` | 未发布 | fix(proxy): drop Codex-private include markers for third-party upstreams (#9077) | A | A：发往第三方与本地原生 Responses 上游的 Codex 请求去掉私有 `include` 标记 `output.encrypted_content`（去空则删键），官方与转 Chat / Anthropic 的路径不动；迁入上游 `strip_codex_private_include_markers` 用例与门控用例；上游经假上游的端到端用例未迁（Web 的 forwarder 测试没有这套假上游） | 已迁移 |
| `abf50589` | 未发布 | fix(agy): pass cloudaicompanionProject in quota lookup and surface region ineligibility (#9414) | A | A：agy 额度查询先 `loadCodeAssist` 拿 `cloudaicompanionProject` 再带着查额度，地区不可用时显示 Google 给的原因；上游补丁直接合入；顺带补上上一轮 `4aa554ad` 在 `agy_account/quota.rs` 漏掉的 Argon 周额度测试样本（新用例依赖它） | 已迁移 |

## 6. 执行记录

- 2026-11-11：建立台账。
- 2026-11-11 批次 C（隐私过滤）：见第 5 节 `32365a54`。验证：Rust 3901 项通过、10 项忽略（新增 30 项隐私过滤用例），`cargo check --bin cc-switch-web` 零警告；前端 270 个文件 2835 项通过，tsc 通过。上游对请求体大小没有单独上限（靠关键词预筛与线性正则，在请求任务里同步执行），Web 照搬。
- 2026-11-11：批次 A 完成（12 已迁移、1 不适用）。另查出上一轮 `4aa554ad`（Argon 周额度）只迁了 `subscription_agy.rs`，`agy_account/quota.rs` 的测试样本漏了 Argon 一档，本批补上。Windows 验证：Rust 3901 项通过、10 项忽略，`cargo check --bin cc-switch-web` 零警告；前端 269 个文件 2835 项通过；tsc 通过。
- 2026-11-11：批次 B 完成（9 已迁移）。旧数据升级：库里旧版环境变量形状的自带模型卡在列表时就地转成新形状并写回（`convert_legacy_settings`，标为未添加），点「添加」后写进 providers.json；转换前流式检测、凭据提取、打开终端都兜底转换；官方卡不转换。Windows 验证：Rust 3951 项通过、10 项忽略，`cargo check --bin cc-switch-web` 零警告；前端 270 个文件 2856 项通过；tsc 通过。
- 2026-11-11：整仓 Prettier（`fdc8cf91e`）与 rustfmt（`bfbbf4717`）统一格式；版本升至 `3.3.0`（package.json、Cargo.toml、Cargo.lock），CHANGELOG 的 Unreleased 定为 `[3.3.0] - 2026-11-11`，三语 README「当前版本」改为 3.3.0、能力清单补隐私过滤并更正 Copilot 一条；打 tag `v3.3.0` 并推送（触发 Web Package 工作流）。
