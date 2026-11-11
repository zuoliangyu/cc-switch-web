# Web 跟进 cc-switch v4.0.26–v4.0.28 及其后差异清单

> 状态：已完成（2026-11-10 建立，2026-11-11 完成；108 项均已处置；随 3.2.0 发版准备，发布包未发布）。
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
| C | 后端杂项 | 27 | 已完成（25 已迁移、2 部分迁移） |
| D | Codex | 13 | 已完成（13 已迁移） |
| E | 界面 | 11 | 已完成（10 已迁移、1 部分迁移） |
| F | 会话全文搜索 | 1 | 已完成（1 已迁移） |
| G | Copilot CLI | 1 | 已完成（1 已迁移） |
| — | 不适用 | 22 | — |

| 处置 | 数量 |
| --- | --- |
| 已迁移 | 80 |
| 部分迁移 | 4 |
| 待迁移 | 0 |
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
| `d16064bd` | v4.0.26 | fix(sessions): improve reader toolbar layout and metadata wrapping (#9109) | E 界面 | E：会话阅读页工具栏：项目路径独占第一行（不再和日期挤在一行被截断），时间范围、加载进度、问答 / 工具数、模型、用量放到第二行，各段整体换行、长文本可断行，去掉分隔点；Token 数改用 `realTotalTokens`（与用量统计同口径）；颜色沿用 Web 的 muted-foreground | 已迁移 |
| `98777515` | v4.0.26 | fix(ui): keep the remaining DB-lock-waiting sync commands off the UI thread (#9178) | C 后端杂项 | C：项目写入（新建 / 改 / 删 / 清除当前 / 应用）与统一供应商增删同步各用一把模块级锁串行（`PROFILE_LOCK` / `UNIVERSAL_LOCK`），连同项目列表放到阻塞线程池，参数先解析、非法输入不等锁；不迁：其余约 40 个命令改 async（Web 是 axum 多线程运行时，没有会被冻结的 UI 主线程），托盘的两个项目入口（Web 无托盘） | 部分迁移 |
| `fc9b17cb` | v4.0.26 | perf(db): batch provider endpoint reads and skip unchanged saves (#9180) | C 后端杂项 | C：保存供应商时内容没变不发 UPDATE（不弄脏库、不触发 WebDAV 自动同步），meta 键序不同但等价时沿用库里的 JSON；端点批量读取 Web 已随 e217bfcb 做过；迁入上游 `providers_tests` | 已迁移 |
| `ca58c031` | v4.0.26 | perf(ui): lazy-load secondary pages and provider editors (#9181) | E 界面 | E：Web 此前已把次级页面、弹窗按需加载；按上游补上新增 / 编辑供应商面板第一次打开才挂载（此前一渲染就拉表单代码）、页面加载时显示「加载中」状态；迁入 `scripts/measure-renderer.mjs`（注释改为 `vite build --manifest`）；上游 App 用例的 findBy 改动 Web 已有，另补「未打开不挂载」用例 | 已迁移 |
| `50a51b86` | v4.0.26 | perf(runtime): defer maintenance and pause hidden-window work (#9182) | C 后端杂项 | C：打开数据库不再做日志归档 / 清理 / 回收空间，统一由维护任务在启动恢复之后、阻塞线程池里做，备份失败也照常清理；Web 此前只在启动时同步维护一次，按上游补上每日维护定时器（`spawn_periodic_maintenance`，休眠不补跑）；窗口活跃状态不变时不重启心跳；用量页的推送失效与滚动范围暂停已在框架 2 取上游版本；Tauri 窗口显隐事件不适用（浏览器按 visibilitychange，React Query 默认按页面可见性） | 已迁移 |
| `2186b305` | v4.0.26 | fix(apps): append actionable hint when npm install hits a bin-path collision (#9196) | C 后端杂项 | C：npm 全局安装撞上 bin 路径冲突（EEXIST + File exists）时在错误详情后追加可操作提示 | 已迁移 |
| `cc4ce038` | v4.0.26 | perf(sessions): avoid transcript copies and release lightweight caches (#9183) | C 后端杂项 | C：消息字节数改为计数写入、问题预览只看需要的前缀、整份消息与流式分包按借用序列化不复制（`/api/sessions/messages` 直接返回序列化字节）；不迁：轻量模式释放会话缓存（Web 没有轻量模式） | 部分迁移 |
| `1adb3cbc` | v4.0.26 | fix(codex): stop GitHub Copilot Responses replies from showing twice (#8025) | B 代理 | Copilot 卡的原生 Responses 流按 output_index 固定首个 item ID（压缩与补参数两条流） | 已迁移 |
| `02a13641` | v4.0.26 | fix(codex): reuse the Grok compat layer for GitHub Copilot Responses (#7989) | B 代理 | Copilot 承载 Grok 模型时按实际发出的模型复用 xAI 兼容（请求 namespace 展开与字段清洗、不回落卡片默认模型，响应还原工具名与整数参数）；`ForwardResult` / `RequestContext` 增加 `outbound_model`；xAI 改写流去掉实体头 | 已迁移 |
| `df3a9072` | v4.0.26 | fix(webdav-sync): preserve file symlink names in skills archives (#9197) | C 后端杂项 | C：WebDAV 同步打包 Skills 时文件符号链接保留原名（按原路径命名、读取解析后的目标） | 已迁移 |
| `78971d56` | v4.0.26 | feat(copilot): show every capped quota and label premium as Credits | E 界面 | E：Copilot 每项有上限的额度各一行（Credits / 代码补全 / 聊天），悬停写「剩余 / 共」；Free 不含 Credits 时账号行写「当前计划不含」、卡片上不占行；后端 `QuotaDetail` 透传 `has_quota`；「高级请求」改名 Credits（三语，含 `subscription.short` 与用量脚本）；托盘部分不适用；迁入 `copilotQuota` 用例 | 已迁移 |
| `cf3c86fe` | v4.0.26 | feat(auth): show each account's subscription plan in the Auth Center | E 界面 | E：账号额度查询带回套餐名 `planName`：Copilot（先 SKU 再 `copilot_plan`，按 VS Code 的认法）、ChatGPT（`plan_type`，照 Codex `/status` 的叫法）、Kimi（`/me` 的 `user_level_name`）、Antigravity（`loadCodeAssist` 的 `paidTier`）、xAI（Grok CLI 设置接口）；授权中心账号行第二行打头显示，额度刷新失败时沿用上次；Web 的 xAI 额度只有前端一处调用，总是带上套餐（上游托盘轮询不问）；上游 `usage_cache`、`ManagedAuthStatusError` 用例 Web 无对应；迁入 `accountPlans`、各授权区块与后端套餐解析用例 | 已迁移 |
| `626f0226` | v4.0.26 | feat(providers): show the plan on official provider cards | E 界面 | E：官方卡副标题末尾「· 套餐」，读卡片右侧额度查询的缓存（Copilot、Codex OAuth / 绑定账号、xAI、Antigravity 绑定账号或官方订阅、Kimi、其余官方订阅额度），不另发请求；Gemini CLI 额度用 `code_assist_plan` 读 `paidTier`；Web 卡片没有上游的 Codex 官方身份行，套餐接在地址或 agy 模型后面，写法同 Claude 默认登录的套餐；按 Web 结构补 `ProviderCard.xaiQuota` 用例（测试补上 QueryClientProvider） | 已迁移 |
| `3cf79926` | v4.0.26 | fix(claude-desktop): point the official card at claude.com/download | A 预设/定价/图标 | A：Claude Desktop 官方卡地址改为 claude.com/download（预设、claude_desktop_config；上游 providers_seed 在 Web 对应 mode/controller 的官方卡补建） | 已迁移 |
| `51b464bd` | v4.0.26 | feat(deeplink): import providers for Claude Desktop and the Pi-family apps | C 后端杂项 | C：Web 的深链接在前端解析导入，照上游放开 Claude Desktop 与 MiniMax Code / Kimi Code / DeepSeek Harness / Oh My Pi：Desktop 按模型名导成直连卡或占满四档的映射卡，Pi 系四家要求 `model` 并生成各自的最小节点（Kimi 带 128K 窗口、模型键加供应商 id 前缀），ID 用 ASCII slug，内联 config 补 `options.apiKey` 与 Kimi 的 `provider.*`；omp 的 `!` / 变量名形状前端拒绝，「此刻能解析成别的值」那条经新增的 `POST /api/omp/api-key-reference` 问服务端 | 已迁移 |
| `420646d8` | v4.0.26 | fix(dsh): let headless profiles read keys CC Switch stores | C 后端杂项 | C：写进 headless 配置档的供应商有存储的 Key 时补上 `- id: credentials` / `disabled: false`，用户自己写过的不动 | 已迁移 |
| `1c2ed066` | v4.0.26 | fix(apps): explain npm bin collisions instead of echoing --force | C 后端杂项 | C：截尾前保留 EEXIST 与 File exists 两行，前端换成三语的冲突提示（不建议 `--force`） | 已迁移 |
| `65f6e682` | v4.0.26 | fix(mcp): show sign-in required instead of failed for 401 MCP endpoints | C 后端杂项 | C：MCP 端点回 401 时显示「需要登录」而不是失败；状态灯用 Web 现有色板（amber），三语文案；Web 轮询结果类型同步改为 `status` | 已迁移 |
| `e6e7831e` | v4.0.26 | fix(claude-desktop): let auto-filled menu names follow model edits | E 界面 | E：Claude Desktop 映射行的菜单名还等于旧模型时随模型改动，自定义名称保留；补丁直接合入并迁入用例 | 已迁移 |
| `a990c81a` | v4.0.26 | fix(proxy): race IPv4 when IPv6 upstream addresses are unreachable | B 代理 | IPv6 上游地址不通时竞速 IPv4 | 已迁移 |
| `7c250c42` | v4.0.26 | feat(proxy): warn when the system proxy hijacks the local route | B 代理 | Codex / Grok Build 手动进入路由后按系统代理自检本地路由（`loopback_probe`，`/health` 回写随机头），回不到 CC Switch 时记日志并经事件推送提示；服务启动时接上的路由不检查 | 已迁移 |
| `62688ab3` | v4.0.26 | feat(codex): let a card keep the official Fast speed tier on GPT rows | D Codex | D：卡上「保留官方 Fast 档」（`modelCatalog.officialSpeedTiers`，默认关）：原生 Responses 下给镜像官方的 GPT 行还原 `service_tiers` / `additional_speed_tiers`，反向解析还原开关；表单高级选项里上游格式下方的开关（只在 Responses、非 Copilot、非聚合布局显示），三语文案；迁入后端用例并补表单用例 | 已迁移 |
| `80ad02c5` | v4.0.26 | fix(proxy): log the mapped upstream model on failed requests | B 代理 | 失败请求日志的 `model` 记映射后实际发往上游的模型，`request_model` 记客户端原名 | 已迁移 |
| `38efe109` | v4.0.26 | fix(proxy): scope the Codex chat call_id cache to the client session | B 代理 | Web 没有 Codex Chat 的 `CodexChatHistoryStore` 内存缓存，不存在跨会话串用 call_id 的问题 | 不适用 |
| `abf441fe` | v4.0.26 | fix(proxy): keep turn-start developer messages in place for Codex chat | B 代理 | Codex Chat 转换保留回合开头的 developer 消息位置 | 已迁移 |
| `1d9b448e` | v4.0.26 | fix(subscription): refresh expired Claude login for follow-login cards | C 后端杂项 | C：跟随本地登录的 Claude 官方卡令牌过期时在默认槽位跑 `claude -p /usage` 读缓存额度，改了配置目录时不跑 | 已迁移 |
| `7a0718e1` | v4.0.26 | fix(ui): stop macOS from capitalizing text typed into raw inputs | E 界面 | E：MCP 表单、提示词、Pi 提示词资源、Skill 仓库管理、会话查找、Hermes 记忆里的输入框加 `autoCorrect` / `autoCapitalize` off；Web 的共用 `Input` 没有上游那组默认属性，这几处用到它的也一并加上；托盘面板不适用 | 已迁移 |
| `0f06fed2` | v4.0.26 | fix(ui): center dialogs without translate so they stay sharp on 1x displays | E 界面 | E：弹窗改用 `inset-0 + m-auto + h-fit` 居中，去掉 translate 与 slide 动画类（1x 屏不再发虚）；会话图片灯箱改 `w-fit` | 已迁移 |
| `81a9fa79` | v4.0.26 | feat(dsh): allow overriding the DeepSeek Harness home directory | C 后端杂项 | C：设备级 `dsh_config_dir`（优先于 `DSH_HOME`），WSL 路径让 DSH 的检测与安装走那个发行版；应用配置页加 DSH 目录，保存后刷新 DSH 供应商、Skills、会话与官方账号；Web 的「恢复默认」取后端默认目录，新增 `native_data_dir` 让它不含设置覆盖 | 已迁移 |
| `a5100e0e` | v4.0.26 | chore(presets): switch TeamoRouter domain from .cn to .com | A 预设/定价/图标 | A：TeamoRouter 各应用预设域名 .cn → .com；迁入上游 teamorouterClaudePresets 用例；Web 三语 README 无 TeamoRouter，不改 | 已迁移 |
| `44c7fa9b` | v4.0.26 | fix(proxy): fill outbound_model on the classifier-loop early return | B 代理 | 分类器循环的提前返回显式带 `outbound_model: None` | 已迁移 |
| `8c05b622` | v4.0.26 | chore(release): v4.0.26 | — | 上游版本号与 whats-new | 不适用 |
| `f621d421` | v4.0.26 | docs(release): add v4.0.26 release notes | — | 上游发行说明 | 不适用 |
| `4e13413f` | v4.0.26 | docs(manual): add the Japanese FAQ for Copilot replies showing twice | — | 上游用户手册 | 不适用 |
| `1d6efa64` | v4.0.27 | fix(stream_check): don't follow redirects in reachability checks (#9253) | B 代理 | Web 的流检测仍是真实流式请求，没有上游只测可达性的 `probe_reachability` 路径 | 不适用 |
| `cb2f2389` | v4.0.27 | fix(tray): stabilize Linux quick panel rendering in lightweight mode (#9233) | — | 系统托盘 | 不适用 |
| `158b2ba3` | v4.0.27 | feat(pricing): add search to the model pricing table (#9205) | A 预设/定价/图标 | A：定价表搜索（词首前缀匹配、精确 ID 置顶、回车编辑首条或按查询新增），按 Web 保留的定价页布局接入；编辑弹窗自动聚焦；三语文案；迁入上游用例（定价页先有计费默认表，取最后一张表） | 已迁移 |
| `e66441d8` | v4.0.27 | fix(ui): make provider icons follow the theme (#8438) | A 预设/定价/图标 | A：近黑单墨色 SVG 换成 currentColor 跟随主题，近黑色不写死，位图 / 仍带近黑笔画的图标深色下垫白；Web 的位图图标在 @/icons/local，needsLightBacking 按它判断；卡片图标框去掉底色；迁入 themeAdapt 用例 | 已迁移 |
| `89409412` | v4.0.27 | feat(terminal): open a Grok Build terminal for the current provider (#9234) | E 界面 | E：Grok Build 当前供应商可「打开终端」：后端核对是当前在用的那家，`GROK_HOME` 指向 CC Switch 管的目录跑 `grok`，跳过确认用 `--always-approve`，Windows 用 `call grok`；按 Web 的 `env_launch_command` 接入；迁入前端用例，后端用例按 Web 结构改写 | 已迁移 |
| `6a3a7a44` | v4.0.27 | docs(tray): update outdated comments about the Linux panel background (#9279) | — | 系统托盘 | 不适用 |
| `566448f0` | v4.0.27 | fix(ui): keep the window draggable and its controls clickable while a dialog is open (#9140) | — | 桌面窗口拖动与标题栏控件 | 不适用 |
| `65106ce6` | v4.0.27 | feat(skills): tidy the installed Skills layout (#9210) | E 界面 | E：已安装 Skills 版式：横向滚动时名称栏钉在左边、表宽按可见应用数算；状态 / 来源筛选移到页签下的工具栏行（右侧「全部更新」，勾选后换成批量操作，窄窗口换行）；去掉页头的更新数链接，行上「可更新」徽标直接更新该 Skill；写入失败替换描述显示；行尾列收窄；三语加 `rowUpdateAria`、删 `headerUpdates*`。与上游不同：「打开目录」仍是复制路径；钉住的表头与名称栏用不透明底色（Web 的 muted 底色半透明）；迁入用例并改为复制路径 | 已迁移 |
| `4e7413c5` | v4.0.27 | feat(ui): add interface density and zoom settings (#9209) | E 界面 | E：界面密度（紧凑默认 / 舒适）：`<html data-density>` 切换 CSS 变量，Web 的 `text-xs/sm/base/lg` 与按钮、输入框、下拉框、侧栏行、供应商卡高度随之变，tailwind-merge 登记新尺寸；设置 › 通用 › 外观加一行（三语），存 localStorage，`main.tsx` 渲染前应用。不迁：缩放档位与 Ctrl/⌘ + − 0（浏览器自带同样的缩放并按站点记住，不拦截浏览器快捷键）、Tauri webview 权限；上游 v7 字号角色 Web 没有，按 Web 的 Tailwind 字号做；用例按 Web 改写并补设置页用例 | 部分迁移 |
| `cd15a164` | v4.0.27 | feat(provider): add Genesis presets for compatible clients (#9269) | A 预设/定价/图标 | A：Genesis 预设（Claude / Codex / Pi）、图标（按 Web 布局登记在 @/icons/local）、取模型按地址补 ?type=chat；迁入上游预设与取模型用例（mock 改 Web 的 runtime client），Claude 表单用例按 Web 结构改写 | 已迁移 |
| `b9fd5d99` | v4.0.27 | feat(presets): move Mistral AI to Large 4 and unhide it | A 预设/定价/图标 | A：Mistral AI 改为 Large 4 并取消隐藏；行数断言随 4ed410ad 换成上游最终的「不丢预设」用例 | 已迁移 |
| `2360631f` | v4.0.27 | chore(presets): align Genesis presets with the inline preset style | A 预设/定价/图标 | A：Genesis 预设改为内联写法，删除 genesisModels.ts，取模型常量内联 | 已迁移 |
| `deb6d5a1` | v4.0.27 | feat(sessions): search message text across sessions with a local FTS5 index (#7896) | F 会话全文搜索 | F：会话页「搜索消息正文」（设备级 `sessionContentSearchEnabled`，默认关）：独立的 SQLite FTS5 trigram 索引放在 Web 数据目录 `session-index.db`（不进主库、不备份不同步，关闭时删除），列表每次读取成功后台增量同步，进度经服务端推送 `session-index-status`；各会话扫描报告读取失败（`ScanStatus`），扫描不完整的应用不清理旧行；Tauri 命令改为 `POST /api/sessions/content-index/sync`、`POST /api/sessions/content-search`、`DELETE /api/sessions/content-index`；命中按读取会话内容的同一条校验过滤，只回会话根目录内的来源；三语文案（提示改为「CC Switch 服务的数据目录」），样式用 Web 的 CSS 变量；ko / ru / tr / zh-TW 与上游用户手册不迁 | 已迁移 |
| `c88d7cc1` | v4.0.27 | fix(tray): convert Linux panel coordinates across display and DPR scale (#9287) | — | 系统托盘 | 不适用 |
| `c39db7df` | v4.0.27 | fix(ui): handle surrogate pairs and whitespace in provider icon initials fallback (#8139) | A 预设/定价/图标 | A：首字母兜底按码位切分、忽略多余空白（getProviderInitials），迁入上游用例 | 已迁移 |
| `44e7d3ef` | v4.0.27 | fix(security): detect IPv4-compatible, SIIT, and NAT64 addresses in deep link risk classifier (#8127) | C 后端杂项 | C：深链接风险判断识别 IPv4-compatible、SIIT 与 NAT64 形式的内网地址 | 已迁移 |
| `13af7fc9` | v4.0.27 | fix(codex): write an absolute model_catalog_json pointer for native config dirs | D Codex | D：`model_catalog_json` 在原生绝对目录写绝对路径（新版 Codex 严格重读只认绝对形态），UNC / WSL 形态与相对路径保留裸文件名；Web 另加一条：服务跑在容器里（`/.dockerenv`、`/run/.containerenv`）时也保留裸文件名，挂载目录在容器内外路径不同；迁入上游用例并补容器用例 | 已迁移 |
| `7d10364b` | v4.0.27 | test(codex): expect the absolute catalog pointer in tests added since the PR | D Codex | D：上游补改测试里的指针断言；Web 对应的 `codex_adopting_the_catalog_drops_the_route_rows_own_pointer` 改为断言绝对路径；golden 用例 Web 没有 | 已迁移 |
| `5bfca714` | v4.0.27 | fix(skill): ignore Python bytecode in directory hash | C 后端杂项 | C：目录哈希忽略 `__pycache__/` 与 `*.pyc` | 已迁移 |
| `747b1327` | v4.0.27 | fix(skill): migrate legacy cached hashes when upstream ships bytecode | C 后端杂项 | C：上游仓库自带字节码时识别按旧算法缓存的哈希并迁移，不误报有更新 | 已迁移 |
| `66e4362b` | v4.0.27 | fix(skill): keep updated_at when migrating a legacy cached hash | C 后端杂项 | C：迁移旧缓存哈希时保留 `updated_at` | 已迁移 |
| `05218b11` | v4.0.27 | fix(ui): disable WebView default context menu | — | WebView 默认右键菜单；Web 运行在普通浏览器里，保留浏览器菜单 | 不适用 |
| `f3c88da9` | v4.0.27 | fix(pricing): give the models.dev fetch time to finish reading the body | A 预设/定价/图标 | A：models.dev 拉取给读取响应体留足时间 | 已迁移 |
| `8dab4ed4` | v4.0.27 | fix(apps): stop treating Python's pi.exe as the Pi coding agent on Windows | C 后端杂项 | C：Windows 上 Python `Scripts` 目录里的 `pi.exe` 不当作 Pi | 已迁移 |
| `a94226b1` | v4.0.27 | fix(skills): stop showing 0 skills for repos discovery actually read | C 后端杂项 | C：仓库管理按「配置分支 → main → master」候选表计数，发现失败的仓库显示「读取失败」及原因；上游 `useImportSkillsFromApps` 清缓存标记那部分 Web 无对应（发现查询没有本地已验证标记，失效后下次挂载照常重取） | 已迁移 |
| `92ca821e` | v4.0.27 | fix(config): write through symlinked live config files | C 后端杂项 | C：原子写入先解析符号链接链，写穿到真实目标、保留链接 | 已迁移 |
| `883382f1` | v4.0.27 | fix(proxy): name the provider in circuit breaker and skip logs | B 代理 | 熔断与跳过日志写明供应商名 | 已迁移 |
| `4a8f113f` | v4.0.27 | fix(proxy): return the half-open probe permit when an attempt is dropped | B 代理 | HalfOpen 探测名额改由 `HalfOpenPermitGuard` 持有，尝试结束或请求被取消都归还，名额按轮次标记；删除 `release_permit_neutral`，记录结果不再还名额 | 已迁移 |
| `07798d56` | v4.0.27 | fix(ci): keep the WSL2 suite on a stable test root and match UNC catalog pointers | — | 上游 WSL2 CI | 不适用 |
| `4ed410ad` | v4.0.27 | feat(providers): add TokenPlus presets (#9296) | A 预设/定价/图标 | A：TokenPlus 预设（Claude / Desktop / Codex / Hermes / OpenClaw / OpenCode / Pi）、图标与 Pi 模型目录；推广文案按既定约束不迁（Web 不展示合作推广，TokenPlusDescription 用例不迁）；分组用例换成上游最终版 | 已迁移 |
| `07a10b9c` | v4.0.27 | fix(dsh): name the profile file when its YAML cannot be parsed | C 后端杂项 | C：DSH 配置档 YAML 解析失败时报出文件路径与原因 | 已迁移 |
| `f3c6774c` | v4.0.27 | test: skip WSL-share-only failures in the WSL2 lib suite | — | 上游 WSL2 CI | 不适用 |
| `2aeb27d8` | v4.0.27 | chore(release): v4.0.27 | — | 上游版本号与 whats-new | 不适用 |
| `26629ff4` | v4.0.27 | docs(release): add v4.0.27 release notes | — | 上游发行说明 | 不适用 |
| `506f3cf8` | v4.0.28 | fix(usage): verify Codex forks on file systems without file IDs | C 后端杂项 | C：没有文件 ID 的文件系统（如 `\\wsl.localhost`）上 Codex 分叉校验退回比较修改时间与大小 | 已迁移 |
| `4aa554ad` | v4.0.28 | fix(agy): add Weekly Argon quota limit line (#8913) | C 后端杂项 | C：Antigravity 识别 Argon 每周额度（卡片并入 Gemini 组，下拉与账号页单列），三语文案；Web 的 `subscription.short` 没有 agy 各档短名（卡片按组合并），不加 | 已迁移 |
| `e1f8acf6` | v4.0.28 | test(usage): skip same-size replacement checks where files have no IDs | C 后端杂项 | C：同大小替换的用例在没有文件 ID 的文件系统上跳过 | 已迁移 |
| `810775eb` | v4.0.28 | feat(apps): show queue state and live progress for tool installs | C 后端杂项 | C：安装 / 升级 / 卸载上报排队、开始与命令最新一行输出（`tool_lifecycle_progress`，按行读取、去控制序列、150ms 节流），经服务端事件推送 `tool-lifecycle-progress`；应用页忙碌行显示「排队中」或已用时间与最新输出 | 已迁移 |
| `6f9fa06d` | v4.0.28 | perf(db): batch table creation and pricing seed in savepoints | C 后端杂项 | C：建表与内置定价写入放进 SAVEPOINT，一次提交 | 已迁移 |
| `62de0f3e` | v4.0.28 | build: drop unused staticlib/cdylib crate types | — | 上游 crate 类型；Web 后端构建配置独立 | 不适用 |
| `b3594905` | v4.0.28 | ci: cut wall-clock and cache waste | — | 上游 CI | 不适用 |
| `c65a523c` | v4.0.28 | ci: split frontend unit tests into four shards | — | 上游 CI | 不适用 |
| `c6a5a789` | v4.0.28 | test: stop building the shared support module as its own test binary | — | 上游集成测试目录结构；Web 无 src-tauri/tests | 不适用 |
| `b184a88c` | v4.0.28 | fix(apps): drop unused mut in Windows WSL uninstall path | C 后端杂项 | C：WSL 卸载路径去掉多余的 `mut` | 已迁移 |
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
| `bd487e83` | 未发布 | feat(copilot): add GitHub Copilot CLI support (#8753) | G Copilot CLI | G：新增受管应用 `copilot`（AppType、侧栏 / 应用页 / 路由、图标 githubcopilot）；卡片只有「打开终端」（官方卡跑 `copilot --model`，可绑授权中心 GitHub 账号经 `COPILOT_GITHUB_TOKEN` 只给这个进程；自带模型卡的 `COPILOT_PROVIDER_*` 只经进程环境传入，按 Web 的 `env_launch_command`），推理强度 `--reasoning-effort`、跳过确认 `--allow-all`；MCP（`mcp-config.json`，停用时记下 tools / timeout）、Skills、提示词 `copilot-instructions.md`、会话（登记会话根目录）、用量导入、深链接（前端解析器）、工具安装 / 卸载、额度（`GET /api/copilot/cli-signed-in-account`）、连通性检查（Web 为真实流式请求）；schema v22 → v23 加 `enabled_copilot`（含建表补列）；表单与预设取上游，三语文案；托盘、ko / ru / tr / zh-TW 不迁 | 已迁移 |
| `76e19b47` | 未发布 | fix(agy): align account quota endpoint with agy CLI and distinguish Ultra 5x/20x plans (#9319) | C 后端杂项 | C：账号额度接口改用 agy 自己的 `daily-cloudcode-pa`；Ultra 5x / 20x 套餐名区分（按 `paidTier.id` 补档位，名字里已带时不重复）依赖套餐显示，随批次 E（cf3c86fe / 626f0226）补上，迁入上游用例 | 已迁移 |
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
- 2026-11-11：完成批次 C（后端杂项，27 项：24 项已迁移、3 项部分迁移）。
  - 方法：上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --3way`；上游 `commands/misc.rs` 的工具安装部分在 Web 是 `commands/tool_management.rs`，再映射一次后大多能带上下文合入（`--reject` 后手工补被拒的块）。`skill.rs`、`subscription.rs`、`agy_account/quota.rs`、三语 locale 与若干前端文件冲突时回到 Web 版本按行为手工迁移；`webdav_sync/archive.rs`、`dsh_config.rs`、`config.rs`、`session_usage_codex.rs`、`schema.rs`、`mcp_connectivity` 干净合入。
  - 并发与维护（98777515、50a51b86、fc9b17cb、6f9fa06d）：Web 新增 `run_db_task`（阻塞线程池）与 `PROFILE_LOCK` / `UNIVERSAL_LOCK`，项目与统一供应商的写入串行，桌面端靠主线程排队，Web 的请求本来就并发，这两把锁补上的是同一类读-改-写竞态；其余命令仍在 axum 工作线程上执行（部分迁移）。打开数据库不再做日志维护，改由 `web_server::spawn_periodic_maintenance` 在启动恢复之后执行，之后每天一次（Web 此前没有每日定时器）；供应商保存无变化不发 UPDATE，WebDAV 自动同步不会被列表刷新触发；建表与定价写入各包一个 SAVEPOINT。
  - 工具安装（2186b305、1c2ed066、8dab4ed4、810775eb、b184a88c）：bin 冲突提示（后端追加英文提示、保留关键两行，前端换成三语文案）、Python `Scripts\pi.exe` 不算 Pi、排队与实时进度。进度模块 `tool_lifecycle_progress.rs` 取上游实现，`from_app` 换成 `for_events`。
  - 会话（cc4ce038）：字节数计数、问题预览、借用序列化取上游；`/api/sessions/messages` 改为直接回序列化好的字节，流式分包借用缓存里的消息。轻量模式释放缓存不迁（部分迁移）。
  - 深链接（51b464bd、44e7d3ef）：Web 的深链接在前端（`src/lib/deeplink`），按上游 Rust 逻辑改写：可导入应用加 Claude Desktop 与 mcode / kimi / dsh / omp，Desktop 直连卡 / 映射卡判定、Pi 系四家最小节点、Kimi 模型键前缀与上下文窗口、slug ID、内联 config 字段、omp Key 形状检查；上游用 omp 自己的解析规则判断「此刻能解析成别的值」，浏览器看不到服务端环境，新增 `POST /api/omp/api-key-reference`（`omp_config::resolve_usage_api_key`）在导入前询问。前端 `ADDITIVE_APPS` 补上 kimi / dsh / omp，与后端 `is_additive_mode` 一致。风险判断识别 IPv4-compatible、SIIT 与 NAT64。
  - DSH（420646d8、81a9fa79、07a10b9c）：headless 配置档补 credentials 行、YAML 解析失败报路径、设备级 `dsh_config_dir`。与上游不同：Web 的目录设置「恢复默认」显示后端给的默认目录，上游的默认值同样走 `data_dir()`（含覆盖），Web 新增 `dsh_config::native_data_dir` 给默认目录用；Web 的 `wsl_distro_for_tool` 里 omp 仍是 `None`（沿用原注释，不在本批）。
  - 其余：MCP 401 显示需要登录（状态灯用 Web 色板 amber，Web 轮询结果类型同步改 `status`）；跟随本地登录的 Claude 官方卡过期时跑 `claude -p /usage`（Web 的 `claude_quota_from` 不返回 `Result`，`spawn_blocking` 失败时退回直接查询结果）；Skill 目录哈希忽略字节码并迁移旧缓存、保留 `updated_at`；仓库管理计数按候选分支、显示读取失败（上游清缓存标记那部分 Web 无对应）；写穿符号链接；DSH YAML 报错；Codex 分叉在无文件 ID 的文件系统上校验；Antigravity 的 Argon 每周档与 `daily-cloudcode-pa` 地址（Ultra 5x / 20x 依赖批次 E 的套餐显示，部分迁移）；窗口活跃状态不变时不重启心跳。
  - 事件推送：`tool-lifecycle-progress` 由 `ToolLifecycleProgress::for_events` 经 `crate::events::emit` 发出（payload `tools` / `stage` / `line`，与上游一致）；`useToolManagement` 用 `@/lib/runtime/client/event` 的 `listen` 订阅（模块级，一次订阅跟随页面会话，只记给忙碌中的工具）。本批其余提交没有前端事件。
  - 用例：迁入上游 `providers_tests`（3 + 1 忽略）、维护推迟两条（另 1 条忽略的基准）、npm 冲突四条、pip `pi.exe` 两条（一条仅 Windows）、排队通知、进度模块（序列化、清洗、节流、Unix 管道；mock_app 用例改为服务端事件）、Skill 哈希两条、`account_uuid_of`、agy 地址、MCP 401、DSH headless / YAML 用例、符号链接写穿、Argon 档前端用例、`RepoManagerPanelCount`、`npmBinCollision`、AppsPage 进度、`useMcpConnectivity` / `UnifiedMcpPanel` 需要登录；按 Web 结构新写：`/api/sessions/messages` 与流式接口的借用序列化、DSH 目录设置优先于 `DSH_HOME`（含默认目录）、项目与统一供应商写入等锁、omp Key 服务端检查、`useSettings` 换 DSH 目录后的失效、`useDirectorySettings` 的 DSH 目录、深链接 Claude Desktop / Pi 系八条、IPv6 嵌入地址、窗口活跃心跳。
  - 变基：先基于批次 B 完成并提交，再变基到批次 D（`ea3c128e3`）之后，无冲突；变基后重跑全部验证。
  - 验证：`cargo test --locked --lib` 3790 项通过、9 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 干净（`commands/config.rs`、`commands/session_manager.rs`、`database/backup.rs`、`database/dao/skills.rs`、`web_session_tests.rs` 报的差异在 HEAD 就有，不在本批改动的行上，未动）；`tsc --noEmit` 通过；前端全量 Vitest 259 个文件 2723 项通过；改动的前端文件 Prettier 通过（`AppsPage.tsx`、`web.ts`、`useSettings.test.tsx`、`deeplinkSecurity.test.ts` 报的差异在 HEAD 就有，未动）。未做浏览器验收与 Docker Linux 检查。
- 2026-11-11：完成批次 F（会话全文搜索，1 项已迁移）。
  - 方法：上游 `session_manager`（`search.rs`、`search_revision.rs`、各会话扫描的 `ScanStatus`、`scan_sessions_with_status` / `scan_for_index`、删除会话时 `forget_source`）与 `settings.rs` 按 `src-tauri/src` → `backend/src` 映射后 `git apply --3way`，`providers/*` 与新模块干净合入，`mod.rs` 只冲突在 Web 没有的 `terminal` 模块声明，`settings.rs` 冲突处按 Web 结构手工补字段（Web 用 `#[serde(default)]`，不加上游的默认函数）。前端 `SessionItem`、阅读页、`turns.ts`、新 hook 与用例干净合入；`utils.ts`、`search-field.tsx`、`SessionManagerPage.tsx`、`types.ts` 冲突处保留 Web 的样式类与 `sonner`，取上游逻辑。
  - 索引存储：上游 `~/.cc-switch/session-index.db` 换成 Web 数据目录 `config::get_app_config_dir()`（默认 `~/.cc-switch-web/session-index.db`）。表结构、trigram 分词、`user_version` 自带的格式版本都取上游；它是独立的缓存文件，不动主库 schema（仍为 v22），不进 SQL 备份、WebDAV 同步。FTS5、trigram 与 `json_each` 由现有 `rusqlite` 0.31 `bundled`（SQLite 3.45）提供，`sha2` 已有，未新增 crate，`Cargo.lock` 不变。
  - 更新时机：同上游。设置默认关；会话列表每次读取成功（含内容没变的刷新）前端调用一次同步，后端只重建指纹变了的会话（文件按 mtime + 长度，OpenCode / Hermes / MiniMax Code 的 SQLite 来源按该会话原始行散列），已在跑时只排一次重跑；首次批量建库后整理（optimize + VACUUM）；扫描报告读取失败的应用不清理旧行；删除会话同步移除索引行；关闭开关时前端在保存成功后调清理，删除索引及 `-wal` / `-shm`。
  - API：上游三个 Tauri 命令改为 `POST /api/sessions/content-index/sync`（立即返回进度）、`POST /api/sessions/content-search`（`{query, providerIds?, limit?}`）、`DELETE /api/sessions/content-index`，走现有访问密钥校验；前端 `sessionsApi.syncContentIndex` / `searchContent` / `clearContentIndex` 经 `core.ts` 的 invoke 分派到 `web.ts`。
  - 与上游不同：搜索命中按 `content::validate_source`（`/api/sessions/stream`、内容分页、图片接口用的同一条校验）过滤后再截到 `limit`，根目录改了还没同步掉的旧行、被改过的索引都不会把根目录外的路径和摘录回给浏览器；`limit` 上限 200（HTTP 接口不信任调用方）；数据目录变了（测试夹具、目录覆盖）时关掉旧连接再按新路径打开；空搜索提示改为「在 CC Switch 服务的数据目录里」建索引（索引建在服务主机上，不在浏览器所在的机器）；上游借托盘菜单更新拖住开关的两个用例，Web 没有托盘，改为拖住清理索引；`SessionManagerPage` 用例把系统时间固定在正午，「刷新后再同步」那条先往前拨一秒；搜索框转圈、正文摘录、空搜索按钮、索引进度行用 Web 的 CSS 变量与按钮变体。上游用户手册、ko / ru / tr / zh-TW 文案不迁；`docs/web-global-resources-guide-zh.md` 补功能说明、三个接口与事件。
  - 事件推送：`session-index-status` 由 `commands::sync_session_index_internal` 的回调经 `crate::events::emit` 发出（payload `running` / `processed` / `total`，开始、每 25 个会话、结束各一次）；`useSessionContentSearch` 用 `useServerEvent` 订阅，开关开着时更新进度并让搜索重查（边建边能搜到），关着时忽略。
  - 用例：迁入上游 `search`（28，其中目录不可读那条仅 Unix）、`search_revision`（2）、`ScanStatus` 与首尾行读取（3）、Codex 压缩会话读失败、扫描复用、设置默认值，前端 `SessionContentSearchToggle`（7）、`sessionSearchUnicode`（5）、`useSessionContentSearch`（6）、`SessionManagerPage` / `SessionReader` / `turns` 新增用例与 msw 模拟；新增后端 HTTP 用例：同步经事件推送收尾、命中只有根目录内的会话、索引里塞进根目录外来源的行也不返回、关掉后搜索为空、清理删掉文件（去掉根目录过滤时该用例失败）；前端新增 `session-index-status` 推送更新进度、关着时忽略两条。
  - 验证：`cargo test --locked --lib` 3826 项通过、9 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 干净（`commands/session_manager.rs` 的 `delete_session_internal`、`providers/opencode.rs` 的 `get_opencode_db_path`、`web_session_tests.rs` 第一条用例报的差异在 HEAD 就有，未动）；`tsc --noEmit` 通过；前端全量 Vitest 262 个文件 2786 项通过；改动的前端文件 Prettier 通过（`SessionFinalReply.tsx`、`search-field.tsx`、`sessions.ts`、`web.ts`、`SessionManagerPage.test.tsx`、`msw/state.ts` 报的差异在 HEAD 就有，不在本批改动的行上，未动）。未做浏览器验收与 Docker Linux 检查。
- 2026-11-11：完成批次 E（界面，11 项：10 项已迁移、1 项部分迁移），并补齐 C 批 `76e19b47` 的 Ultra 5x / 20x（改为已迁移）。
  - 方法：上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --3way`（缺失文件 `--exclude`）。`ClaudeDesktopProviderForm`、`OpenTerminalDialog`、`CopilotQuotaFooter`、各授权区块、`accountPlans`、`kimi_oauth/account.rs`、`agy_account` 干净合入；`App.tsx`、`ProviderCard`、`subscription*.rs`、`coding_plan.rs`、`xai_oauth.rs`、`misc.rs`（终端）与 Web 分叉，回到 Web 版本按行为手工迁移；`UnifiedSkillsPanel` 先把上游基线与目标版本的 v7 设计 token 换成 Web 的写法再三方合并，只剩两处冲突（表宽、搜索框宽度），取上游版式、保留 Web 的窄屏宽度。
  - 套餐显示（cf3c86fe、626f0226、76e19b47）：`SubscriptionQuota.plan_name` 与前端 `planName`；Web 的 xAI 额度只有 `/api` 前端一处调用，总是并行问套餐；Gemini CLI 额度读 `loadCodeAssist` 原始响应后用 `code_assist_plan` 取套餐；卡片副标题按 Web 的额度 footer 选择顺序算缓存键（Antigravity 绑定账号按服务端是否支持切号判断，与 `AgyOfficialQuotaFooter` 一致）。
  - 与上游不同：会话工具栏颜色、Skills 版式按 Web 的 CSS 变量（钉住的表头与名称栏改用不透明底色叠半透明 muted，避免滚过去的列透出来）；Skills「打开目录」仍是复制路径；`7a0718e1` 额外覆盖 Web 共用 `Input`（Web 的 `Input` 没有上游默认的 `autoCorrect` / `autoCapitalize`）；界面密度按 Web 的 Tailwind 字号（xs / sm / base / lg）与控件高度（36 / 32 / 28，舒适各 +4）做变量，侧栏行改 `WebSidebar`；缩放不迁，浏览器自带缩放，不拦截 Ctrl/⌘ + − 0；Grok Build 终端经 Web 的 `env_launch_command` 启动（Windows `call grok`）。托盘相关改动（78971d56、cf3c86fe、7a0718e1）不适用。
  - 事件推送：本批没有新增服务端事件，上游这些提交也没有 `app.emit` / `listen`。
  - 用例：迁入上游 `copilotQuota`、`accountPlans`、`ClaudeDesktopProviderForm`、`OpenTerminalDialog`、`UnifiedSkillsPanel`（「打开目录」一条改为复制路径）、各授权区块的套餐 mock、后端 `codex_plan_label`、`grok_plan`、`plan_prefers_the_paid_tier_name`、`ultra_plans_show_their_5x_or_20x_variant`；按 Web 结构新写 Grok 终端启动命令与 `--always-approve`、`ProviderCard` 副标题套餐三条、App「编辑器未打开不挂载」、`interfacePrefs`（密度与 tailwind-merge 覆盖）、设置页密度切换。
  - 变基：先基于批次 D 之后的 main（`3a6d7e310`）完成并提交，再变基到批次 F（`c4af3ccda`）之后；三语 locale 自动合并（F 的 `sessionManager` 十个正文搜索键与本批的键都在），只有本台账第 3、6 节冲突，统计按两批合计重算；变基后重跑全部验证。
  - 验证（变基后）：`cargo test --locked --lib` 3831 项通过、9 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；改动的 Rust 文件 rustfmt 干净（`commands/xai_oauth.rs` 报的差异在 HEAD 就有，不在本批改动的行上，未动）；`tsc --noEmit` 通过；前端全量 Vitest 266 个文件 2811 项通过；改动的前端文件 Prettier 通过（`SessionReaderHeader.tsx`、`button.tsx`、`input.tsx`、`index.css`、`lib/api/copilot.ts`、`tailwind.config.cjs`、`App.test.tsx` 报的差异在 HEAD 就有，未动）。未做浏览器验收与 Docker Linux 检查。
- 2026-11-11：完成批次 G（GitHub Copilot CLI，1 项已迁移）。
  - 方法：先快进到 `b6b6fa66b`。上游补丁按 `src-tauri/src` → `backend/src` 映射后逐个 `git apply --check`，新文件（`copilot_config.rs`、`mcp/copilot.rs`、`copilot_direct.rs`、`session_usage_copilot.rs`、`session_manager/providers/copilot.rs`、`CopilotProviderForm`、`CopilotCliQuotaFooter`、`copilotProviderPresets` 及用例）与 `OpenTerminalDialog`、`CopilotQuotaFooter`、`UnifiedMcpPanel`、`SessionItem`、`AppGlyph` 等小改动干净合入；`app_config`、`schema`、`dao`、`services/mcp`、`provider/live`、`provider/mod`、`skill`、`session_manager` 与 Web 分叉，三方合并冲突太大，回到 Web 版本后加上 `AppType::Copilot` 由编译器逐处列出未覆盖的分支，照上游行为手工补；上游 `commands/misc.rs` 的工具安装部分在 Web 的 `commands/tool_management.rs`，终端部分照 Web 的 `env_launch_command` 重写。
  - 接入面：AppId 与 `AppType`（别名 `copilot-cli`、`github-copilot`、`github-copilot-cli`）、应用配置 / 侧栏 / 应用页 / 可见性（图标 githubcopilot，配色用 Web 的 `theme-chip-neutral`）；MCP（`~/.copilot/mcp-config.json`，stdio 写 `local`，停用记下 `tools` / `timeout` 到 Web 数据目录的 `copilot-mcp-options.json`，与数据库同提交、失败回滚；导入按 `disabledMcpServers` 记未启用）；Skills（`~/.copilot/skills`，同 Kimi / agy 的原生目录保护）；提示词 `copilot-instructions.md`；会话（扫描、阅读、恢复 `copilot --resume=<id>`，删除拒绝）；用量导入 `session.usage_record`（用量页显示「Copilot CLI (Session)」）；工具安装 / 升级 / 卸载（npm `@github/copilot`，macOS 的 Homebrew cask `copilot-cli`）；深链接（Web 的前端解析器：供应商 `apiFormat` 换算、`config` 只取地址 / Key / 模型、只导入不启用、确认框隐藏启用开关；提示词与 MCP 的 `apps=copilot`）；额度（官方卡 Credits，没绑账号时按服务主机上 Copilot CLI 当前登录的账号在授权中心找，新增 `GET /api/copilot/cli-signed-in-account`）；连通性检查。卡片没有「启用」，只有「打开终端」（`buildLaunchSections`，同 Antigravity），官方卡可在「配置用量查询」里开关 Copilot 额度。
  - 终端与密钥：浏览器只发应用、卡片 ID、目录、是否跳过确认与附加参数，服务端从库里读卡片，不接受浏览器传来的配置。Copilot 没有「当前供应商」（与上游一致，每张卡都能打开），因此不做 Grok Build 那样的「必须是当前在用的那家」检查；绑定的授权中心账号必须还在，否则报错，不退回 Copilot 自己的登录。官方卡跑 `copilot`（`--model` / `--reasoning-effort`），清掉全部 `COPILOT_PROVIDER_*`，绑了账号时 `COPILOT_GITHUB_TOKEN` / `COPILOT_GH_HOST` 只给这个进程（新增 `CopilotAuthManager::github_credentials_for_account`，Web 授权中心只有 github.com）；自带模型卡的地址、Key、模型只经环境传入，没填的同名变量清掉，绑定账号不生效。macOS / Linux 写进 0600 临时文件、读入即删，Windows 写进自删的启动 `.bat` 的 `set` 行并用 `call copilot`；令牌与 Key 不进命令行参数、不写常驻文件、不进日志、不回传浏览器。跳过确认 `--allow-all`。模型名含 `"`、`%`、`^` 时 Windows 上拒绝启动。
  - 数据库：Web 版本链 v22 → v23（对应上游 v24 → v25），`mcp_servers`、`skills` 加 `enabled_copilot`（默认 0），建表语句、桌面端快照的建表阶段补列表、`dao/mcp.rs`、`dao/skills.rs` 读写同步更新；Web 的 skills 表没有 pi / omp 列，以 Web 为准。
  - 与上游不同：会话根目录登记进 `provider_roots`，读取、正文搜索、删除走同一条 `content::validate_source`；连通性检查是 Web 的真实流式请求（按 `COPILOT_PROVIDER_TYPE` / `WIRE_API` 选 Chat / Responses / Anthropic，带 `COPILOT_PROVIDER_HEADERS`，Azure OpenAI 不检测），上游是只测可达性的 `resolve_base_url`；`COPILOT_GH_HOST` 固定 github.com；Windows 启动 `.bat` 没有上游的 `setlocal` 段（沿用 Web 的 `env_launch_command`，变量只在那个终端的 cmd 会话里），模型名不经批处理变量转交，含 cmd 特殊字符直接拒绝；没有目录覆盖，「应用配置」不列 Copilot（目录跟随服务进程的 `COPILOT_HOME`）；官方卡判定在 `isOfficialAccount` 里补上「没有自带模型地址即官方」；额度未登录提示改为「CC Switch 服务所在电脑上的 Copilot CLI」；`docs/copilot-cli-integration-zh.md` 按 Web 改写。不迁：托盘、ko / ru / tr / zh-TW 文案、README（主线程统一处理）。
  - 事件推送：本批没有新增服务端事件，上游提交也没有 `app.emit` / `listen`。
  - 用例：迁入上游 `copilot_config`（6）与 `commands/copilot.rs` 的账号匹配（1，并入 `copilot_config`，另补当前登录读取 1）、`mcp/copilot`（6）、`copilot_direct`（2）、`session_manager/providers/copilot`（3）、`session_usage_copilot`（2 + 1 忽略的真实目录冒烟）、`tests/copilot_commands.rs` 三条改写为 `services/provider/copilot_tests.rs`、数据库迁移 / 全新安装 / 双开关独立保存，前端 `copilotProviderPresets`（4）、`CopilotProviderForm`（8）、`CopilotCliQuotaFooter`（4）；按 Web 结构新写：v22 → v23 迁移、建表阶段补 `enabled_copilot`、终端启动（Unix / Windows 各两条：Key 与令牌只在环境文件或 `set` 行、不进命令行文本，自带模型卡不带令牌，官方卡清 BYOK 变量，Windows 拒绝 `%`）、绑定账号已删时报错、Copilot 会话不越出 `session-state`（直接给根目录外路径、`..` 跳出都拒绝，删除接口拒绝）、Copilot 连通性检查（官方卡拒绝、模型与请求头解析）、深链接四条、`OpenTerminalDialog` 一条；`AppsPage` 的版本探测次数随工具数改为 14。
  - 验证：`cargo test --locked --lib` 3864 项通过、10 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告（`--lib --tests` 的两条 dead_code 警告在 HEAD 就有）；改动的 Rust 文件 rustfmt 干净（`lib.rs`、`services/mod.rs` 的模块顺序，`commands/config.rs` 的 Agy / Omp 两行，`dao/skills.rs`、`mcp/mod.rs`、`web_session_tests.rs` 第一条用例报的差异在 HEAD 就有，未动）；`tsc --noEmit` 通过；前端全量 Vitest 269 个文件 2832 项通过；改动的前端文件 Prettier 通过（`AppSwitcher.tsx`、`UsageScriptModal.tsx`、`EditProviderDialog.tsx`、`ProviderList.tsx`、`SessionReaderHeader.tsx`、`appConfig.tsx`、`lib/api/copilot.ts`、`managedAccountUsage.ts`、`web.ts`、`SessionManagerPage.test.tsx`、`msw/state.ts` 报的差异在 HEAD 就有，不在本批改动的行上，未动）。未做浏览器验收、真实 Copilot CLI 冒烟与 Docker Linux 检查。
- 2026-11-11：收尾。
  - 合入后复验（main，Windows）：`cargo test --locked --lib` 3865 项通过、10 项忽略（PATH 去掉 `~/.bun/bin`）；`cargo check --locked --bin cc-switch-web` 通过、无警告；`tsc --noEmit` 通过；前端全量 Vitest 269 个文件 2833 项通过。
  - Docker Linux（`rust:1-bookworm`，`cargo test --locked --lib`）首轮暴露 3 项失败，修复后 3894 项通过、1 项失败：
    - `env_launch_command`（Claude / Grok / Copilot 在 Unix 下打开终端共用）的临时环境文件名只有进程号加毫秒，同一毫秒两次启动会因 `create_new` 失败；文件名加进程内序号（`9bbba12c1`）。
    - `codex_adopting_the_catalog_drops_the_route_rows_own_pointer` 写死绝对路径，容器内按批次 D 的规则写裸文件名；期望值改走 `catalog_pointer_value`（`9bbba12c1`）。
    - `unreadable_session_directory_preserves_index_until_successful_scan`（上游原样迁入）要求非 root 进程，容器里默认 root；以 `nobody` 单独运行通过，用例不改。
    - `cargo check --locked --lib --tests` 的警告均为既有的 Unix 下未用辅助函数与 dead_code。
  - 浏览器验收：调试后端加 Vite，隔离 HOME / USERPROFILE / APPDATA / LOCALAPPDATA / `CC_SWITCH_TEST_HOME`，Playwright 驱动 Chromium，宽度 1440 与 390，覆盖事件推送、Codex 暂停官方登录 / 额度保护 / Fast 档、界面密度、Skills 钉住列、会话阅读页、弹窗居中、会话全文搜索、Copilot CLI 全部入口、定价搜索与图标主题。修正 5 项并复验通过（`88921191c`）：
    - 手动切换供应商与故障转移队列增删不推送事件，别的标签页 / 客户端不刷新：后端补发 `provider-switched`，前端同时失效 `failoverQueue`。
    - 页头应用切换缺 Kimi Code、DeepSeek Harness、Antigravity、Oh My Pi、Copilot CLI（前四项为上一轮遗留）：改用 `APP_IDS`。
    - 会话阅读页查找框盖住计数；390px 下会话列表工具栏挤压重叠；请求日志表头说明把 390px 用量页撑宽；窄屏导航按钮压在弹窗与侧边栏上面。
  - 未修：390px 下全文搜索结果跳转后关键词在阅读区上方（窄屏阅读页头部占半屏）；`/favicon.ico` 404 与 GitHub 限流时检查更新返回 500 为既有问题。未验证：授权中心套餐名（无真实账号）、真实 Copilot CLI 冒烟。
  - 文档：三语 README 补 Copilot CLI 与会话全文搜索，「当前版本」说明 main 在 3.1.0 之后的跟进；CHANGELOG 新增 Unreleased。版本号未改（仍为 3.1.0）。
- 2026-11-11 发版准备（按用户要求）：
  - 修复遗留小问题：390px 下全文搜索跳转后关键词在可视区外（命中行比可视区高时，等行渲染稳定后把当前高亮滚到中间）；直接 PUT 设置关闭「搜索消息正文」时服务端删除索引文件（新增 `saving_settings_with_content_search_off_removes_the_index_file`）；页面补图标，不再请求 `/favicon.ico`。均在隔离数据目录下用浏览器 / 接口复验。检查更新遇 GitHub 限流返回 500 仍未处理。
  - 版本升至 `3.2.0`：package.json、Cargo.toml、Cargo.lock，CHANGELOG 的 Unreleased 定为 `[3.2.0] - 2026-11-11`，三语 README「当前版本」改为 3.2.0、3.1.0 改为上一版本。`/api/copilot/token` 按用户决定不收紧。未打 tag：本地已有从上游取来的同名 `v3.2.0`。
