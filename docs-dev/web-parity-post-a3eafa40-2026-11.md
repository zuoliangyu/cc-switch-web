# Web 跟进 cc-switch v4.0.26–v4.0.28 及其后差异清单

> 状态：进行中（2026-11-10 建立）。
> 上游：`upstream` = `git@github.com:farion1231/cc-switch.git`，只读（push URL 为 `DISABLED_READ_ONLY`）。取上游时用 `git fetch upstream --no-tags`：Web 本地 tag `v3.0.0`、`v3.1.0` 与上游旧 tag 同名，不能强制拉上游 tag。
> 起点：`a3eafa40`（v4.0.25，上一轮冻结目标）；目标：`upstream/main` = `5e9812e0`（v4.0.28 之后，2026-11-10）。
> 范围：108 个提交（无合并提交），434 个文件变化（+34576/−3169）。Web 起点为 `ee20caee`（3.1.0）。
> 前一轮：[v4.0.1–v4.0.25 迁移台账](web-parity-post-a189980f-2026-11.md)。验证命令与流程沿用前一轮第 8 节。

说明：Web 仓库与上游无共同 Git 历史，上游 `src-tauri/src/` 对应 Web `backend/src/`；上游补丁多数无法直接应用，按行为手工迁移。

## 1. 版本分布

| 版本 | 提交数 |
| --- | --- |
| v4.0.26 | 40 |
| v4.0.27 | 34 |
| v4.0.28 | 28 |
| 未发布 | 6 |

## 2. 主要内容

| 领域 | 上游变化 | Web 处理 |
| --- | --- | --- |
| 新应用 | `AppType::Copilot`（GitHub Copilot CLI）：配置、MCP、Skills、提示词、会话、用量、表单与预设；上游 schema 增加 `enabled_copilot` | 批次 G；按 Web 自有版本链新增迁移，不复用上游编号 |
| 会话 | 本地 FTS5 索引的跨会话全文搜索（44 个文件） | 批次 F |
| Codex | 第三方路由写成内置 `openai` 供应商、会话历史分桶提示、官方会话持续并入共享桶、额度保护默认开与官方登录暂停、Fast 档位、绝对路径的目录指针、不再写 `disable_response_storage` | 批次 D |
| 代理 | 转发热路径减分配、分类器重试循环、Copilot Responses 重复回复、IPv6 不通时竞速 IPv4、系统代理劫持本地路由提示、半开探测许可、跨厂商故障转移的模型映射等 | 批次 B |
| 界面 | 界面密度与缩放、已安装 Skills 版式、授权中心与官方卡显示套餐、Copilot 额度、次级页面懒加载、Grok Build 终端、会话阅读页工具栏 | 批次 E |
| 后端杂项 | 工具安装队列与实时进度、npm bin 冲突提示、深链导入 Claude Desktop 与 Pi 系应用、MCP 401 显示需登录、Skill 哈希忽略字节码、写穿符号链接、DSH 目录覆盖、Antigravity 额度 | 批次 C |
| 预设 | Genesis、TokenPlus、Mistral Large 4、TeamoRouter 域名、默认模型刷新；定价表搜索；图标随主题 | 批次 A；赞助 / 合作标识与置顶仍不展示 |
| i18n | 新增韩语 `ko.json`、俄语 `ru.json` | 不适用（用户决定只保留 zh/en/ja） |
| 桌面专属 | 托盘、窗口拖动、WebView 右键菜单、AppImage、发布与 CI | 不适用 |

## 3. 批次与处置统计

| 批次 | 范围 | 提交数 | 状态 |
| --- | --- | --- | --- |
| A | 预设/定价/图标 | 11 | 已完成（11 已迁移） |
| B | 代理 | 22 | 已完成（19 已迁移、1 部分迁移、2 不适用） |
| C | 后端杂项 | 27 | 待迁移 |
| D | Codex | 13 | 已完成（13 已迁移） |
| E | 界面 | 11 | 待迁移 |
| F | 会话全文搜索 | 1 | 待迁移 |
| G | Copilot CLI | 1 | 待迁移 |
| — | 不适用 | 22 | — |

| 处置 | 数量 |
| --- | --- |
| 已迁移 | 43 |
| 部分迁移 | 1 |
| 待迁移 | 40 |
| 不适用 | 24 |

执行顺序：A → B → C → D → E → F → G。各批共享文件多，顺序执行、逐批提交。

## 4. 决策记录

- 2026-11-10：用户决定在本轮批次之前先补两块上一轮因缺底层框架而排除或部分迁移的能力：框架 1，请求日志与日汇总的 `pricing_model`、`input_token_semantics` 列及其写入、计价、统计与各会话用量导入；框架 2，服务端事件推送（替代 `provider-switched`、`usage-log-recorded` 等事件的轮询）。补完后回头把上一轮因此部分迁移或不适用的项改判。
- 沿用前一轮：不新增语言（只 zh/en/ja）；“打开目录”类功能改为显示 / 复制路径；预设按上游分组、组内 A–Z，不展示赞助 / 合作标识与置顶；主题保留 Web 的 CSS 变量；故障转移队列与卡片不做拖动排名。

## 5. 提交矩阵

| 提交 | 版本 | 标题 | 批次 | 说明 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `7afceec1` | v4.0.26 | ci(release): retry xcrun stapler when CloudKit drops the connection | — | 上游发布 CI；Web 维护自有工作流 | 不适用 |
| `51fce968` | v4.0.26 | fix(presets): refresh stale default models (grok-4.7, kimi-k3.1-pro, qwen3.7-plus) (#9193) | A 预设/定价/图标 | A：Grok Build 默认模型改 grok-4.7（前端常量、三语占位文案、表单用例；Web 的 grok_config.rs 没有 DEFAULT_MODEL 常量，无需改），xAI / Kimi / 千问预设默认模型按上游刷新；上游 PiProviderForm 用例不迁（Web 的 Pi 表单是自写版本） | 已迁移 |
| `b8fa4199` | v4.0.26 | fix(codex): follow up on sub-agent concurrency limit review notes (#9148) | D Codex | D：TOML 表头带行尾注释时也算节的边界（改并发上限不再覆盖 `[features.multi_agent_v2]`），`[agents]` 认带引号的键，不再追加重复键；三语提示改短并说明新对话生效；迁入上游用例 | 已迁移 |
| `e217bfcb` | v4.0.26 | perf(proxy): reduce forwarding allocations and failover database reads (#9161) | B 代理 | SSE 分帧换成 `SseBuffer` / `SseBlocks`（全部 `take_sse_block` 调用方）、故障转移只加载队列内供应商且端点一次批量读、常用查询 `prepare_cached`、私有参数原地过滤（顺带补上 00a789e7 遗漏的 JSON Schema 属性名保留）、规范 JSON 直接序列化；不适用：活跃连接 guard 计数（Web 没有该 guard，计数在每次尝试里累加）、按家复制请求体改 `Cow`（Web 每家都要 `apply_media_prevention`）、forwarder 改借用参数、`codex_chat_history`（Web 无该缓存） | 部分迁移 |
| `e7878471` | v4.0.26 | fix(proxy): stop classifier retry loops (#9201) | B 代理 | 连续三轮工具结果报 auto mode 分类器不可用时 Claude / Claude Desktop 本地回 400、不发往上游，用户发新消息恢复；新增 `classifier_guard` | 已迁移 |
| `c70d61de` | v4.0.26 | fix(linux): bump @tauri-apps/cli so the AppImage stops bundling libwayland-client (#9229) | — | Tauri CLI / AppImage 打包；Web 无桌面打包 | 不适用 |
| `d16064bd` | v4.0.26 | fix(sessions): improve reader toolbar layout and metadata wrapping (#9109) | E 界面 |  | 待迁移 |
| `98777515` | v4.0.26 | fix(ui): keep the remaining DB-lock-waiting sync commands off the UI thread (#9178) | C 后端杂项 |  | 待迁移 |
| `fc9b17cb` | v4.0.26 | perf(db): batch provider endpoint reads and skip unchanged saves (#9180) | C 后端杂项 |  | 待迁移 |
| `ca58c031` | v4.0.26 | perf(ui): lazy-load secondary pages and provider editors (#9181) | E 界面 |  | 待迁移 |
| `50a51b86` | v4.0.26 | perf(runtime): defer maintenance and pause hidden-window work (#9182) | C 后端杂项 |  | 待迁移 |
| `2186b305` | v4.0.26 | fix(apps): append actionable hint when npm install hits a bin-path collision (#9196) | C 后端杂项 |  | 待迁移 |
| `cc4ce038` | v4.0.26 | perf(sessions): avoid transcript copies and release lightweight caches (#9183) | C 后端杂项 |  | 待迁移 |
| `1adb3cbc` | v4.0.26 | fix(codex): stop GitHub Copilot Responses replies from showing twice (#8025) | B 代理 | Copilot 卡的原生 Responses 流按 output_index 固定首个 item ID（压缩与补参数两条流） | 已迁移 |
| `02a13641` | v4.0.26 | fix(codex): reuse the Grok compat layer for GitHub Copilot Responses (#7989) | B 代理 | Copilot 承载 Grok 模型时按实际发出的模型复用 xAI 兼容（请求 namespace 展开与字段清洗、不回落卡片默认模型，响应还原工具名与整数参数）；`ForwardResult` / `RequestContext` 增加 `outbound_model`；xAI 改写流去掉实体头 | 已迁移 |
| `df3a9072` | v4.0.26 | fix(webdav-sync): preserve file symlink names in skills archives (#9197) | C 后端杂项 |  | 待迁移 |
| `78971d56` | v4.0.26 | feat(copilot): show every capped quota and label premium as Credits | E 界面 |  | 待迁移 |
| `cf3c86fe` | v4.0.26 | feat(auth): show each account's subscription plan in the Auth Center | E 界面 |  | 待迁移 |
| `626f0226` | v4.0.26 | feat(providers): show the plan on official provider cards | E 界面 |  | 待迁移 |
| `3cf79926` | v4.0.26 | fix(claude-desktop): point the official card at claude.com/download | A 预设/定价/图标 | A：Claude Desktop 官方卡地址改为 claude.com/download（预设、claude_desktop_config；上游 providers_seed 在 Web 对应 mode/controller 的官方卡补建） | 已迁移 |
| `51b464bd` | v4.0.26 | feat(deeplink): import providers for Claude Desktop and the Pi-family apps | C 后端杂项 |  | 待迁移 |
| `420646d8` | v4.0.26 | fix(dsh): let headless profiles read keys CC Switch stores | C 后端杂项 |  | 待迁移 |
| `1c2ed066` | v4.0.26 | fix(apps): explain npm bin collisions instead of echoing --force | C 后端杂项 |  | 待迁移 |
| `65f6e682` | v4.0.26 | fix(mcp): show sign-in required instead of failed for 401 MCP endpoints | C 后端杂项 |  | 待迁移 |
| `e6e7831e` | v4.0.26 | fix(claude-desktop): let auto-filled menu names follow model edits | E 界面 |  | 待迁移 |
| `a990c81a` | v4.0.26 | fix(proxy): race IPv4 when IPv6 upstream addresses are unreachable | B 代理 | IPv6 上游地址不通时竞速 IPv4 | 已迁移 |
| `7c250c42` | v4.0.26 | feat(proxy): warn when the system proxy hijacks the local route | B 代理 | Codex / Grok Build 手动进入路由后按系统代理自检本地路由（`loopback_probe`，`/health` 回写随机头），回不到 CC Switch 时记日志并经事件推送提示；服务启动时接上的路由不检查 | 已迁移 |
| `62688ab3` | v4.0.26 | feat(codex): let a card keep the official Fast speed tier on GPT rows | D Codex | D：卡上「保留官方 Fast 档」（`modelCatalog.officialSpeedTiers`，默认关）：原生 Responses 下给镜像官方的 GPT 行还原 `service_tiers` / `additional_speed_tiers`，反向解析还原开关；表单高级选项里上游格式下方的开关（只在 Responses、非 Copilot、非聚合布局显示），三语文案；迁入后端用例并补表单用例 | 已迁移 |
| `80ad02c5` | v4.0.26 | fix(proxy): log the mapped upstream model on failed requests | B 代理 | 失败请求日志的 `model` 记映射后实际发往上游的模型，`request_model` 记客户端原名 | 已迁移 |
| `38efe109` | v4.0.26 | fix(proxy): scope the Codex chat call_id cache to the client session | B 代理 | Web 没有 Codex Chat 的 `CodexChatHistoryStore` 内存缓存，不存在跨会话串用 call_id 的问题 | 不适用 |
| `abf441fe` | v4.0.26 | fix(proxy): keep turn-start developer messages in place for Codex chat | B 代理 | Codex Chat 转换保留回合开头的 developer 消息位置 | 已迁移 |
| `1d9b448e` | v4.0.26 | fix(subscription): refresh expired Claude login for follow-login cards | C 后端杂项 |  | 待迁移 |
| `7a0718e1` | v4.0.26 | fix(ui): stop macOS from capitalizing text typed into raw inputs | E 界面 |  | 待迁移 |
| `0f06fed2` | v4.0.26 | fix(ui): center dialogs without translate so they stay sharp on 1x displays | E 界面 |  | 待迁移 |
| `81a9fa79` | v4.0.26 | feat(dsh): allow overriding the DeepSeek Harness home directory | C 后端杂项 |  | 待迁移 |
| `a5100e0e` | v4.0.26 | chore(presets): switch TeamoRouter domain from .cn to .com | A 预设/定价/图标 | A：TeamoRouter 各应用预设域名 .cn → .com；迁入上游 teamorouterClaudePresets 用例；Web 三语 README 无 TeamoRouter，不改 | 已迁移 |
| `44c7fa9b` | v4.0.26 | fix(proxy): fill outbound_model on the classifier-loop early return | B 代理 | 分类器循环的提前返回显式带 `outbound_model: None` | 已迁移 |
| `8c05b622` | v4.0.26 | chore(release): v4.0.26 | — | 上游版本号与 whats-new | 不适用 |
| `f621d421` | v4.0.26 | docs(release): add v4.0.26 release notes | — | 上游发行说明 | 不适用 |
| `4e13413f` | v4.0.26 | docs(manual): add the Japanese FAQ for Copilot replies showing twice | — | 上游用户手册 | 不适用 |
| `1d6efa64` | v4.0.27 | fix(stream_check): don't follow redirects in reachability checks (#9253) | B 代理 | Web 的流检测仍是真实流式请求，没有上游只测可达性的 `probe_reachability` 路径 | 不适用 |
| `cb2f2389` | v4.0.27 | fix(tray): stabilize Linux quick panel rendering in lightweight mode (#9233) | — | 系统托盘 | 不适用 |
| `158b2ba3` | v4.0.27 | feat(pricing): add search to the model pricing table (#9205) | A 预设/定价/图标 | A：定价表搜索（词首前缀匹配、精确 ID 置顶、回车编辑首条或按查询新增），按 Web 保留的定价页布局接入；编辑弹窗自动聚焦；三语文案；迁入上游用例（定价页先有计费默认表，取最后一张表） | 已迁移 |
| `e66441d8` | v4.0.27 | fix(ui): make provider icons follow the theme (#8438) | A 预设/定价/图标 | A：近黑单墨色 SVG 换成 currentColor 跟随主题，近黑色不写死，位图 / 仍带近黑笔画的图标深色下垫白；Web 的位图图标在 @/icons/local，needsLightBacking 按它判断；卡片图标框去掉底色；迁入 themeAdapt 用例 | 已迁移 |
| `89409412` | v4.0.27 | feat(terminal): open a Grok Build terminal for the current provider (#9234) | E 界面 |  | 待迁移 |
| `6a3a7a44` | v4.0.27 | docs(tray): update outdated comments about the Linux panel background (#9279) | — | 系统托盘 | 不适用 |
| `566448f0` | v4.0.27 | fix(ui): keep the window draggable and its controls clickable while a dialog is open (#9140) | — | 桌面窗口拖动与标题栏控件 | 不适用 |
| `65106ce6` | v4.0.27 | feat(skills): tidy the installed Skills layout (#9210) | E 界面 |  | 待迁移 |
| `4e7413c5` | v4.0.27 | feat(ui): add interface density and zoom settings (#9209) | E 界面 |  | 待迁移 |
| `cd15a164` | v4.0.27 | feat(provider): add Genesis presets for compatible clients (#9269) | A 预设/定价/图标 | A：Genesis 预设（Claude / Codex / Pi）、图标（按 Web 布局登记在 @/icons/local）、取模型按地址补 ?type=chat；迁入上游预设与取模型用例（mock 改 Web 的 runtime client），Claude 表单用例按 Web 结构改写 | 已迁移 |
| `b9fd5d99` | v4.0.27 | feat(presets): move Mistral AI to Large 4 and unhide it | A 预设/定价/图标 | A：Mistral AI 改为 Large 4 并取消隐藏；行数断言随 4ed410ad 换成上游最终的「不丢预设」用例 | 已迁移 |
| `2360631f` | v4.0.27 | chore(presets): align Genesis presets with the inline preset style | A 预设/定价/图标 | A：Genesis 预设改为内联写法，删除 genesisModels.ts，取模型常量内联 | 已迁移 |
| `deb6d5a1` | v4.0.27 | feat(sessions): search message text across sessions with a local FTS5 index (#7896) | F 会话全文搜索 |  | 待迁移 |
| `c88d7cc1` | v4.0.27 | fix(tray): convert Linux panel coordinates across display and DPR scale (#9287) | — | 系统托盘 | 不适用 |
| `c39db7df` | v4.0.27 | fix(ui): handle surrogate pairs and whitespace in provider icon initials fallback (#8139) | A 预设/定价/图标 | A：首字母兜底按码位切分、忽略多余空白（getProviderInitials），迁入上游用例 | 已迁移 |
| `44e7d3ef` | v4.0.27 | fix(security): detect IPv4-compatible, SIIT, and NAT64 addresses in deep link risk classifier (#8127) | C 后端杂项 |  | 待迁移 |
| `13af7fc9` | v4.0.27 | fix(codex): write an absolute model_catalog_json pointer for native config dirs | D Codex | D：`model_catalog_json` 在原生绝对目录写绝对路径（新版 Codex 严格重读只认绝对形态），UNC / WSL 形态与相对路径保留裸文件名；Web 另加一条：服务跑在容器里（`/.dockerenv`、`/run/.containerenv`）时也保留裸文件名，挂载目录在容器内外路径不同；迁入上游用例并补容器用例 | 已迁移 |
| `7d10364b` | v4.0.27 | test(codex): expect the absolute catalog pointer in tests added since the PR | D Codex | D：上游补改测试里的指针断言；Web 对应的 `codex_adopting_the_catalog_drops_the_route_rows_own_pointer` 改为断言绝对路径；golden 用例 Web 没有 | 已迁移 |
| `5bfca714` | v4.0.27 | fix(skill): ignore Python bytecode in directory hash | C 后端杂项 |  | 待迁移 |
| `747b1327` | v4.0.27 | fix(skill): migrate legacy cached hashes when upstream ships bytecode | C 后端杂项 |  | 待迁移 |
| `66e4362b` | v4.0.27 | fix(skill): keep updated_at when migrating a legacy cached hash | C 后端杂项 |  | 待迁移 |
| `05218b11` | v4.0.27 | fix(ui): disable WebView default context menu | — | WebView 默认右键菜单；Web 运行在普通浏览器里，保留浏览器菜单 | 不适用 |
| `f3c88da9` | v4.0.27 | fix(pricing): give the models.dev fetch time to finish reading the body | A 预设/定价/图标 | A：models.dev 拉取给读取响应体留足时间 | 已迁移 |
| `8dab4ed4` | v4.0.27 | fix(apps): stop treating Python's pi.exe as the Pi coding agent on Windows | C 后端杂项 |  | 待迁移 |
| `a94226b1` | v4.0.27 | fix(skills): stop showing 0 skills for repos discovery actually read | C 后端杂项 |  | 待迁移 |
| `92ca821e` | v4.0.27 | fix(config): write through symlinked live config files | C 后端杂项 |  | 待迁移 |
| `883382f1` | v4.0.27 | fix(proxy): name the provider in circuit breaker and skip logs | B 代理 | 熔断与跳过日志写明供应商名 | 已迁移 |
| `4a8f113f` | v4.0.27 | fix(proxy): return the half-open probe permit when an attempt is dropped | B 代理 | HalfOpen 探测名额改由 `HalfOpenPermitGuard` 持有，尝试结束或请求被取消都归还，名额按轮次标记；删除 `release_permit_neutral`，记录结果不再还名额 | 已迁移 |
| `07798d56` | v4.0.27 | fix(ci): keep the WSL2 suite on a stable test root and match UNC catalog pointers | — | 上游 WSL2 CI | 不适用 |
| `4ed410ad` | v4.0.27 | feat(providers): add TokenPlus presets (#9296) | A 预设/定价/图标 | A：TokenPlus 预设（Claude / Desktop / Codex / Hermes / OpenClaw / OpenCode / Pi）、图标与 Pi 模型目录；推广文案按既定约束不迁（Web 不展示合作推广，TokenPlusDescription 用例不迁）；分组用例换成上游最终版 | 已迁移 |
| `07a10b9c` | v4.0.27 | fix(dsh): name the profile file when its YAML cannot be parsed | C 后端杂项 |  | 待迁移 |
| `f3c6774c` | v4.0.27 | test: skip WSL-share-only failures in the WSL2 lib suite | — | 上游 WSL2 CI | 不适用 |
| `2aeb27d8` | v4.0.27 | chore(release): v4.0.27 | — | 上游版本号与 whats-new | 不适用 |
| `26629ff4` | v4.0.27 | docs(release): add v4.0.27 release notes | — | 上游发行说明 | 不适用 |
| `506f3cf8` | v4.0.28 | fix(usage): verify Codex forks on file systems without file IDs | C 后端杂项 |  | 待迁移 |
| `4aa554ad` | v4.0.28 | fix(agy): add Weekly Argon quota limit line (#8913) | C 后端杂项 |  | 待迁移 |
| `e1f8acf6` | v4.0.28 | test(usage): skip same-size replacement checks where files have no IDs | C 后端杂项 |  | 待迁移 |
| `810775eb` | v4.0.28 | feat(apps): show queue state and live progress for tool installs | C 后端杂项 |  | 待迁移 |
| `6f9fa06d` | v4.0.28 | perf(db): batch table creation and pricing seed in savepoints | C 后端杂项 |  | 待迁移 |
| `62de0f3e` | v4.0.28 | build: drop unused staticlib/cdylib crate types | — | 上游 crate 类型；Web 后端构建配置独立 | 不适用 |
| `b3594905` | v4.0.28 | ci: cut wall-clock and cache waste | — | 上游 CI | 不适用 |
| `c65a523c` | v4.0.28 | ci: split frontend unit tests into four shards | — | 上游 CI | 不适用 |
| `c6a5a789` | v4.0.28 | test: stop building the shared support module as its own test binary | — | 上游集成测试目录结构；Web 无 src-tauri/tests | 不适用 |
| `b184a88c` | v4.0.28 | fix(apps): drop unused mut in Windows WSL uninstall path | C 后端杂项 |  | 待迁移 |
| `40b602a3` | v4.0.28 | docs(proxy): clarify supported SSE delimiter combinations (#7904) | B 代理 | SSE 四种分隔符组合的注释 | 已迁移 |
| `2c5e5d2c` | v4.0.28 | feat(codex): keep moving official sessions into the shared bucket while opted in | D Codex | D：勾选迁入既有会话后每次服务启动都迁，state DB 里没有 openai 线程就跳过（读不到 state DB 时退回按目录只迁一次），新增 `count_threads_with_model_provider`；开启弹窗默认勾选迁入；三语开关与确认框文案按上游改写（Web 不写备份目录路径）；迁入上游后端与前端用例 | 已迁移 |
| `c7f7caf2` | v4.0.28 | feat(codex): warn when a switch splits Codex session history | D Codex | D：切换 Codex 前后各读一次 live 的会话组，跨 openai ↔ custom、统一关着且旧组有线程时 `SwitchResult.codexHistorySplit` 带锁住的线程数；按上游最终形态（e499d1f0）接入，「不再提示」设置与命令、「开启统一」按钮不迁；迁入上游用例 | 已迁移 |
| `97e6d82a` | v4.0.28 | perf(codex): back up the state DB in a single step | D Codex | D：state DB 备份一步拷完（`c_int::MAX` 页，碰锁歇 50ms 重试） | 已迁移 |
| `6a0acf07` | v4.0.28 | feat(codex): notify when the background unify migration finishes | D Codex | D：开启统一后的后台迁入跑完（或失败）经事件推送发 `codex-unify-migration-finished`（跳过时不发），`useAppServerEvents` 弹成功 / 失败提示；三语文案「下次启动服务时重试」；补后端 payload 用例与前端事件、工具函数用例 | 已迁移 |
| `0e49c881` | v4.0.28 | fix(proxy): retry Codex compaction without tool_choice when rejected | B 代理 | 压缩回合被原生 Responses 第三方以 400 拒绝时去掉 `tool_choice` 对同一家重试一次 | 已迁移 |
| `49f2882e` | v4.0.28 | fix(proxy): repair Kimi tool-call history on native Responses | B 代理 | Kimi / Moonshot 原生 Responses：删空文本 assistant 消息，把调用组内的 assistant 发言移到调用前 | 已迁移 |
| `8ff9e3b5` | v4.0.28 | fix(proxy): strip ChatGPT identity headers for unmanaged Codex upstreams | B 代理 | 非官方、非托管 ChatGPT 账号的 Codex 上游去掉 ChatGPT 身份头（账号、组织 / 项目、x-oai-* 等），会话与客户端头保留 | 已迁移 |
| `905c9148` | v4.0.28 | feat(codex): write third-party routes as the built-in openai provider | D Codex | D：路由 / 聚合下第三方路由在盘上有登录、统一关着、行里没有内置 openai 表达不了的客户端设置（重试、流空闲超时、远程压缩）时写成内置 openai（顶层 `openai_base_url` 指向本地路由），契约加 `openai_route` 标记，接上时重写一次；直连不变；按 Web 的 controller_tests 结构补用例 | 已迁移 |
| `e9285cf1` | v4.0.28 | fix(proxy): map the model per target when Codex fails over across vendors | B 代理 | 故障转移开着时 Codex 换到不发布该模型的那家改用它自己的顶层模型 | 已迁移 |
| `71dbcfa2` | v4.0.28 | fix(proxy): repair tool-call history for DeepSeek native Responses too | B 代理 | DeepSeek 原生 Responses 同样修复工具调用历史 | 已迁移 |
| `5f2f527d` | v4.0.28 | fix(codex): stop writing disable_response_storage | D Codex | D：Codex 预设、模板、统一供应商、深链导入与通用供应商不再写 `disable_response_storage`，行里的不再投影（仍在 `CODEX_FLOOR_TOP`，写入时清掉 live 里的旧行），终端启动把它当遗留键忽略；Web 前端深链白名单同步去掉；用户手册与 golden 行快照不迁 | 已迁移 |
| `e499d1f0` | v4.0.28 | refactor(codex): fold the history-split hint into the switch toast | D Codex | D：会话分组提醒并进「切换成功」提示的一行描述（6 秒），不另弹窗；三语 `notifications.codexHistorySplit` 取上游最终键 | 已迁移 |
| `b0e452ff` | v4.0.28 | feat(codex): turn quota protection on by default and add a pause for the official login | D Codex | D：官方额度保护默认开，旧设置按 `local_migrations.codex_quota_protection_default_on_v1` 打开一次；新增 `codexProxyWithoutOfficialLogin`：路由 / 聚合下官方与第三方路由都写成不要求登录的 custom 表、契约加 `without_login`，代理对官方请求本地 403（`cc_switch_codex_official_login_paused`）；保存设置后 `resync_codex_proxy` 当场重写，失败回滚；设置页开关按 e6256c50 直接放到模式页 | 已迁移 |
| `e6256c50` | v4.0.28 | feat(codex): move the official-login pause into the route and aggregation settings | D Codex | D：「暂停使用官方登录」放在 Codex 路由设置、聚合设置侧边栏最上面，开着时路由 / 聚合页顶部常驻提示带「恢复官方登录」，直连不提示；拒绝与额度保护提示文字指向新位置（额度保护仍写 Web 的「设置 → 认证」）；三语文案；补 SwitchModePanel 用例 | 已迁移 |
| `cac921f5` | v4.0.28 | fix(proxy): keep image and search models when Codex fails over | B 代理 | 故障转移换模型只对对话请求，图片与搜索接口保留客户端模型 | 已迁移 |
| `3321cb9e` | v4.0.28 | chore(release): v4.0.28 | — | 上游版本号与 whats-new | 不适用 |
| `8656ebd9` | v4.0.28 | docs(release): add v4.0.28 release notes | — | 上游发行说明 | 不适用 |
| `5a3d7f92` | 未发布 | feat(i18n): add Korean community localization (#8794) | — | 用户决定不新增语言（Web 保持 zh/en/ja）；提交内与语言无关的改动随 E 复核 | 不适用 |
| `cdca0984` | 未发布 | feat(i18n): add Russian community localization (#7788) | — | 用户决定不新增语言（Web 保持 zh/en/ja）；提交内与语言无关的改动随 E 复核 | 不适用 |
| `bd487e83` | 未发布 | feat(copilot): add GitHub Copilot CLI support (#8753) | G Copilot CLI |  | 待迁移 |
| `76e19b47` | 未发布 | fix(agy): align account quota endpoint with agy CLI and distinguish Ultra 5x/20x plans (#9319) | C 后端杂项 |  | 待迁移 |
| `72e826ed` | 未发布 | fix(proxy): normalize call-less outputs for native Responses providers (#9328) | B 代理 | 非官方原生 Responses 上游把没有 call_id 的 function_call_output 改写成 user 消息 | 已迁移 |
| `5e9812e0` | 未发布 | fix(claude): omit reasoning_content for Mistral tool history (#9388) | B 代理 | 上游为 api.mistral.ai 时不回放 reasoning_content | 已迁移 |

## 6. 执行记录

- 2026-11-10：`git fetch upstream --no-tags` 取到 `5e9812e0`，建立本台账；108 项初判为待迁移 86、不适用 22。
- 2026-11-10：完成框架 1（请求日志与日汇总的计价模型、输入 Token 语义维度）。
  - 数据库：Web 版本链 v21 → v22（对应上游 v10 → v11、v12 → v13）：`proxy_request_logs` 增加 `pricing_model`（NULL = 历史行，'' = 未计价的错误行）与 `input_token_semantics`（0 旧版 / 1 含缓存读写 / 2 新增输入）；`usage_daily_rollups` 重建为主键带 `request_model`、`pricing_model`，并增加 `input_token_semantics`。迁移与建表阶段的桌面端快照兜底共用 `ensure_usage_dimension_columns`（快照版本号会被改写为 Web 当前版本、不再走迁移）。SQL 备份导入与恢复先建表再迁移，按列名恢复，新列随之保留。
  - Web 差异：上游 v13 起旧行一律记为 0（只扣命中）；Web 此前没有语义列，展示用的是「输入够扣读写就扣读写、否则只扣命中」的启发式。迁移时含缓存的应用（Codex / Gemini / Grok Build）中有缓存写入且输入够扣的旧行回填为 1，其余保持 0，迁移前后统计结果一致（有用例）。
  - 写入：代理用量按 `pricing_model_source` 解析出的计价模型写 `pricing_model`，按应用写语义（含缓存的应用为 1，其余为 2）；Claude Desktop 网关的计费模式继承 Claude；只在有用量、计价模型不是占位名时才告警缺价。会话导入（Codex、Grok Build、Kimi、Antigravity、Pi / Oh My Pi、MiniMax Code、DeepSeek Harness）取上游最终版本（Grok Build 保留 Web 的符号链接用例跳过条件），DSH 前缀模型的裸名写进 `pricing_model`。`CostCalculator` 改用 `sql_helpers::is_cache_inclusive_app`。
  - 汇总与统计：`usage_rollup` 取上游实现（按本地零点对齐的截止时间、汇总前先尝试补价、日汇总保留请求模型与计价模型维度并以新增输入入库）；`sql_helpers` 取上游按语义的归一；`usage_stats` 的有效计价模型改为 `pricing_model` 优先，Codex 跨源去重只对旧语义、写入量为 0 的代理行放行，补价改为上游实现（按写入时的计价模型重算、单个事务、精准补价按候选名匹配）。供应商统计仍按显示名 A–Z。上游归档后的 `usage-log-recorded` 通知属框架 2，暂未接入。
  - 前端：请求详情在计价模型与模型不同时单列「计价模型」（文案已有），`RequestLog` 类型加 `pricingModel`。`docs/web-global-resources-guide-zh.md` 同步 Token 口径与模型筛选说明。
  - 用例：迁入上游 `usage_rollup`（语义归一、两个维度、剪枝前补价）、`sql_helpers`、logger（Grok Build 语义）、9 个补价用例、筛选用例（计价模型优先）与各会话导入断言（含 DSH 前缀模型补价）；新增 v21 → v22 迁移、建表兜底与桌面端快照迁入用例、请求详情计价模型用例。
  - 上一轮台账：6fa328f3、accc4489 由部分迁移改为已迁移（已迁移 562、部分迁移 15、不适用 181）；bc4d1a50、4bbdbcdd、a0dd3b39、258c367f 与 1c 的 11 项 Codex 会话导入更新说明。
  - 验证：`cargo test --locked --lib` 3665 项通过、6 项忽略（PATH 去掉 `~/.bun/bin` 后运行；带着它时 `omp_search_paths_include_the_bun_global_bin` 是已知的环境性失败）；`cargo check --locked --bin cc-switch-web` 通过、无警告；Docker（rust:1-bookworm）Linux `cargo check --locked --lib --tests` 通过，警告均在未改动的文件；改动的 Rust 文件 rustfmt 干净；`tsc --noEmit` 通过；前端全量 Vitest 244 个文件 2608 项通过（需排除 `.claude/**`：同时有别的代理的 worktree 在仓库内，默认匹配会把它的用例也跑进来、加载两份 React）。
- 2026-11-10：完成批次 A（预设 / 定价 / 图标，11 项全部已迁移）。
  - 方法：上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --3way`；上游对象在本仓库里，预设文件与上游基线几乎一致，基本直接合入。冲突多为上下文冲突（CodexFormFields、ProviderCard、ProviderIcon、图标索引、定价页、若干用例），恢复 Web 版本后只手工补上真正的改动。
  - 预设：Grok Build 默认 grok-4.7（三语占位文案同步）、xAI / Kimi / 千问默认模型刷新；TeamoRouter 改 .com；Mistral AI 改 Large 4 并取消隐藏；新增 Genesis（Claude / Codex / Pi）与 TokenPlus（Claude / Desktop / Codex / Hermes / OpenClaw / OpenCode / Pi）。Web 自有的排序注释保留，上游「赞助商预设」分段注释与 TokenPlus 推广文案不迁（Web 不展示合作推广）；文件顺序跟上游，Desktop 首项现为 TokenPlus（应用内按分组与名称展示）。Codex 预设与上游的剩余差异来自批次 D 的 `5f2f527d`（`disable_response_storage`）。
  - Claude Desktop 官方卡地址改为 claude.com/download（预设、`claude_desktop_config.rs`、`mode/controller.rs` 的官方卡补建；Web 没有上游的 `providers_seed.rs`）。
  - 定价：models.dev 拉取给读取响应体留足时间；定价表搜索（词首前缀匹配、精确 ID 置顶、回车编辑首条或按查询新增，三语文案）按 Web 保留的定价页布局接入，编辑弹窗自动聚焦。
  - 图标：近黑单墨色 SVG 换成 currentColor 跟随主题、近黑颜色不写死，位图与仍带近黑笔画的图标深色下垫白；Web 的位图 / URL 图标登记在 `@/icons/local`，`needsLightBacking` 按它判断，Genesis、TokenPlus 图标也登记在那里；与 Web 已有的 SVG 内部 id 实例后缀一并保留。卡片图标框去掉底色。首字母兜底按码位切分、忽略多余空白。
  - 用例：迁入上游 `themeAdapt`、`ProviderIcon`、`PricingConfigPanel`（Web 定价页先有计费默认表，取最后一张表）、`genesisProviderPresets`、`teamorouterClaudePresets`、三份 TokenPlus 预设用例与 `model-fetch` 的 Genesis 用例（mock 改为 Web 的 `@/lib/runtime/client/core`）；Claude 表单的 Genesis 取模型用例按 Web 结构改写；`presetGroups` 的 Claude 行数断言换成上游最终的「分组不丢预设」；Genesis 图标断言改查 `@/icons/local`；Web 自有目录用例（Desktop 130、Hermes 122）按新数据更新，Desktop 官方卡按名称查找。不迁：上游 `PiProviderForm` 用例（Web 的 Pi 表单是自写版本）、`TokenPlusDescription`（推广文案）。
  - 验证：`tsc --noEmit` 通过；前端全量 Vitest 251 个文件 2664 项通过；后端 `cargo test --locked --lib` 3643 项通过、6 项忽略，1 项失败为已知的环境性用例 `omp_search_paths_include_the_bun_global_bin`（PATH 含 `~/.bun/bin`），去掉该 PATH 项后单独重跑通过；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 无输出；改动的前端文件 Prettier 检查通过。未做浏览器验收。
- 2026-11-10：完成框架 2（服务端事件推送）。
  - 后端：新增 `events` 模块（全局 `tokio::sync::broadcast` 总线，容量 256；写路径不持有状态，任意线程可调用；无订阅者时直接丢弃），`usage-log-recorded` 照上游 `usage_events` 200ms 防抖合并（同步线程借服务启动时记下的运行时句柄调度）。新增 `GET /api/events`（axum SSE，`event: <名称>`、`data: <JSON>`，每 15 秒保活注释，订阅者落后时补发 `resync`，`Cache-Control: no-cache`、`X-Accel-Buffering: no`），走与其他接口相同的访问密钥校验。
  - 接回的事件：`usage-log-recorded`（代理日志写入新行、日汇总归档删了明细、会话同步导入了新行、Codex 用量重建，即框架 1 去掉的四处上游调用）；`provider-switched`（故障转移切换成功、开启故障转移切到队列第一家、应用项目按分组内各应用各发一条，payload 同上游）；`profile-applied`；`universal-provider-synced`（新增/删除/同步）；`webdav-sync-status-updated`（自动同步成功或失败）。
  - 跳过：`usage-cache-updated`（上游用于把托盘触发的额度查询写回前端缓存，Web 没有托盘，额度都由页面自己查）；`proxy-official-warning`（Web 进入路由时直接拒绝不支持接管的官方卡，没有“仍然进入再提示”的路径）；`s3-sync-status-updated`（Web 没有 S3 同步）；`proxy-loopback-hijacked` 属批次 B（7c250c42），合并时改用 `crate::events::emit`；托盘、窗口、深链等桌面事件不适用。`tool-lifecycle-progress`（批次 C）、`codex-unify-migration-finished`（批次 D）、`session-index-status`（批次 F）可直接发到本总线。
  - 前端：`src/lib/runtime/client/serverEvents.ts`（增量 SSE 解析；全应用共享一条连接，引用计数，最后一个订阅者退订即断开；断线 1→30 秒指数退避重连，重连成功派发 `resync`）；`event.ts` 的 `listen` 由空实现改为订阅这条连接（形状同上游 `@tauri-apps/api/event`，测试里仍由 `tests/msw/runtimeMocks` 替换）；新增 `useServerEvent`（对应上游 `useTauriEvent`）与 `useAppServerEvents`（App 级处理：`provider-switched` 失效 `["providers", app]` 与 Web 的模式视图 `["appMode", app]`、Pi 系缓存、Claude 官方账号与失败的 ChatGPT 额度；`profile-applied`、`universal-provider-synced`、`webdav-sync-status-updated` 同上游 App.tsx；`resync` 失效全部查询）；提示词面板开着时随 `profile-applied` 重读；迁入上游 `useUsageEventBridge` 并挂到用量页。访问密钥失效时 App 随密钥门卸载，连接随之断开。
  - 收敛到上游、去掉的 Web 专用分支：`useUsageAutoRefresh` 取上游最终版本（每轮扫描只刷新「上次同步」时间，新用量靠推送；自动扫描关掉时不再按间隔重读，滚动范围每分钟重算在重建期间暂停）；用量设置抽屉在自动扫描关掉时隐藏间隔，删除三语 `usage.refreshMenu.refreshOnlyLabel`；`useAppMode` 去掉每 3 秒轮询（上游模式视图不轮询）。
  - 上一轮台账：`415e8994` 由不适用改为已迁移，`cc81627a` 更新说明（已迁移 563、部分迁移 15、不适用 180）。`docs/web-global-resources-guide-zh.md` 改写用量刷新说明并新增「服务端事件推送」一节。
  - 用例：后端 `events`（收发、无订阅者不积压、5 次通知合并为 1 次、落后补发 resync）、`/api/events`（无密钥 401、响应头、收到真实 SSE 事件）、应用项目事件顺序与 payload；迁入上游 logger（重放只通知一次、冲突回退通知两次）、会话同步与 Codex 重建的通知用例。前端新增 SSE 解析、共享连接与退订、退避重连与 resync、`useServerEvent`、`useAppServerEvents` 用例；`useUsageAutoRefresh`、`useUsageEventBridge`、`UsageDashboard.smoke` 改回上游版本（smoke 的定价页断言保留 Web 版式），`UsageDashboard` 的扫描关闭用例改回上游。
  - 复核补正：去掉模式面板 3 秒轮询后，Web 的模式视图键 `["appMode", app]` 不在供应商列表前缀下，切换、增删卡片、改故障转移队列只失效 `["providers", app]`，直连那家 / 路由目标 / 聚合成员会停在旧值直到窗口重新聚焦。照上游把键改为 `["providers", app, "mode"]`（`src/lib/query/appModeKeys.ts`），所有失效供应商列表的操作连带重取；服务重启时按谓词失效全部应用的模式视图。新增 `tests/hooks/useAppModeQueryKey.test.tsx`；前端全量 Vitest 256 个文件全部通过。
  - 验证：`cargo test --locked --lib` 3675 项通过、6 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 干净（`commands/usage.rs`、`failover_switch.rs`、`web_session_tests.rs` 里报的差异在 HEAD 就有，未动）；`tsc --noEmit` 通过；前端全量 Vitest 255 个文件 2680 项通过。隔离后端（临时 HOME / USERPROFILE / APPDATA / LOCALAPPDATA，只监听 127.0.0.1:18991）上 curl 连 `/api/events` 收到响应头、一条真实的 `universal-provider-synced` 与 15 秒保活注释，停掉后确认真实 `~/.cc-switch-web` 未变。未做浏览器验收。
- 2026-11-10：完成批次 B（代理，22 项：19 项已迁移、1 项部分迁移、2 项不适用）。
  - 方法：上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --3way`。forwarder / handlers / controller 与上游早已分叉，冲突里「theirs」常常带进整段上游测试或 Web 没有的代码，这些文件一律回到 Web 版本后按行为手工迁移；能干净合入的部分（新模块、`codex.rs`、`model_mapper`、`codex_compaction`、xAI 清洗等）直接合入。
  - SSE 与热路径（e217bfcb，部分迁移）：`sse.rs` 取上游最终版，全部流转换与聚合器改用 `SseBuffer` / `SseBlocks`；故障转移只读队列内供应商、端点一次批量读；`body_filter` 原地过滤并补上 00a789e7 漏迁的 JSON Schema 属性名保留；`json_canonical` 直写序列化。活跃连接 guard、`Cow` 请求体、借用参数与 `codex_chat_history` 部分不适用。
  - 新增：`classifier_guard`（分类器重试循环本地 400）、`copilot_responses`（Copilot 固定 item ID）、`loopback_probe`（系统代理劫持本地路由自检，`/health` 回写随机头）、`transform_codex_responses_kimi_history`（Kimi / DeepSeek 工具调用历史）。
  - 出站模型：Web 的 `RequestForwarder` 按请求记下请求体定稿后的 `model`，放进 `ForwardResult` / `ForwardError`，handlers 写入 `RequestContext.outbound_model`；Copilot Grok 的兼容判断、失败请求日志的 `model` 都按它（上游 02a13641、80ad02c5）。
  - 熔断：HalfOpen 名额改由 guard 持有，请求被取消也归还，按轮次防止晚到的归还放出第二个探测；`record_result` 一律不再还名额，删除 `release_permit_neutral`（4a8f113f）。
  - 与上游不同：Web 的 xAI 改写流原样复制了上游响应头，改写后长度会变，随本批去掉实体头；Copilot 判断用 `app_type_str`（Web 的 `RequestContext` 没有 `app_type`）；压缩回合去 `tool_choice` 重试与故障转移换模型判断按 Web 的 forwarder 结构接入；系统代理自检只在手动进入路由时做（Web 服务启动时接上的路由不检查）。
  - 不适用：38efe109（Web 没有 Codex Chat 历史缓存）、1d6efa64（Web 流检测是真实流式请求，没有可达性探测）。用户手册 docs 不迁。
  - 用例：上游 `classifier_guard`、`loopback_probe`、`copilot_native_responses_tests`（13）、`copilot_grok_responses_tests`、熔断名额取消 / 轮次两条、`codex_failover_*`、`chatgpt_identity_*`、无 call_id 输出三条、Mistral reasoning_content、故障转移 DAO 排序用例迁入；依赖上游 forwarder 测试服务器的用例改写为 `compaction_tests` 里的转发层用例（分类器循环、失败带出映射模型、压缩去 `tool_choice` 重试）。
  - 事件推送（变基到框架 2 之后接入）：`proxy-loopback-hijacked` 由 `mode::controller::spawn_loopback_check` 经 `crate::events::emit` 发出，`useAppServerEvents` 收到后弹 15 秒警告（三语 `notifications.proxyLoopbackHijacked`）；本批其余提交没有前端事件。
  - 验证：`cargo test --locked --lib` 3741 项通过、6 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；Docker（rust:1-bookworm）Linux `cargo check --locked --lib --tests` 通过，警告为新版 Rust 对 `fetch_update` 的弃用提示（`circuit_breaker` 取上游写法，Web 既有的 `webdav_auto_sync` 同样）与既有 Unix 终端辅助函数 dead_code；改动的 Rust 文件 rustfmt 干净；`tsc --noEmit` 通过；前端全量 Vitest 256 个文件 2683 项通过；改动的前端文件 Prettier 通过。未做浏览器验收。
- 2026-11-11：完成批次 D（Codex，13 项全部已迁移）。
  - 方法：上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --3way`；`codex_config`、`CodexFormFields`、`ProviderForm`、`codex_direct`、`codex_history_migration`、`commands/settings` 与 Web 分叉较多，冲突一律回到 Web 版本后按行为手工迁移；5f2f527d 的预设、模板、`floor` / `live::project::codex` / `codex_terminal` / `provider.rs` 与行快照干净合入。c7f7caf2 → e499d1f0、b0e452ff → e6256c50 两组直接迁到上游最终形态，中间的「不再提示」设置与命令、设置页上的暂停开关不迁。
  - `disable_response_storage`（5f2f527d）：查 `git log -S` 与批次 A 记录，Web 的 Codex 预设在 5f2f527d 之前与上游一致，批次 A 记下的「剩余差异」就是这条提交本身留给本批，Web 没有保留该键的自有理由，按上游去掉；合入后 Codex 预设与上游只差 Web 自有的排序注释和 `codex_oauth` 类型。Web 前端深链白名单（`tomlLink.ts`，对应上游 `ROW_TOP_FIELDS`）与深链导入模板同步去掉；`codexEditorOverlay` 对应 `CODEX_FLOOR_TOP`，保留。
  - 与上游不同：目录指针在容器里运行时保留裸文件名（宿主 `~/.codex` 挂到容器 `/data/.codex`，容器内的绝对路径宿主上的 Codex 找不到）；暂停开关的保存走 `PUT /api/settings` 后的 `resync_codex_proxy_settings`（复用 Web 的 `reapply_after_save_locked`，与聚合设置重写同一模式）；`SwitchResult.codexHistorySplit` 由 Web 的 `switch_provider_by_name_internal` 带出，Web 没有托盘切换；额度保护提示里的设置位置保留 Web 的「设置 → 认证」；拒绝请求的错误码在 Web 的 `ProxyError::into_response` 里加（Web 没有 handlers 的 `codex_proxy_error_code`）；迁入失败提示改成「下次启动 CC Switch 服务时重试」。
  - 事件推送：`codex-unify-migration-finished` 由 `commands::settings::run_codex_unify_migration_and_notify` 经 `crate::events::emit` 发出（payload `migratedStateRows` / `migratedJsonlFiles` / `error`，跳过时不发）；`useAppServerEvents` 收到后弹提示（迁了 0 个不提示）。本批其余提交没有前端事件。
  - 用例：迁入上游 `providerConfigUtils.codex`（并发上限）、`card_can_keep_official_speed_tiers_on_native_gpt_rows`、目录指针五条（另补容器一条）、统一迁移三条、分组提示两条、额度保护默认开迁移、`codexHistorySplitHint`（mock 改 `sonner`）、`CodexAuthSettings` 统一开关四条；按 Web 结构新写第三方路由写成内置 openai / 保留 custom 表 / 暂停官方登录三条 controller 用例、暂停错误响应、迁入完成 payload、`useAppServerEvents` 迁入提示、`CodexFormFields` Fast 档开关、`SwitchModePanel.settings` 暂停提示与开关三条；`CodexQuotaProtectionSettings` 默认值用例改为默认开。
  - 验证：`cargo test --locked --lib` 3759 项通过、6 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 干净（`commands/provider.rs`、`web_session_tests.rs` 报的差异在 HEAD 就有，未动）；`tsc --noEmit` 通过；前端全量 Vitest 257 个文件 2701 项通过；改动的前端文件 Prettier 通过。未做浏览器验收与 Docker Linux 检查。
