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
| A | 预设/定价/图标 | 11 | 待迁移 |
| B | 代理 | 22 | 待迁移 |
| C | 后端杂项 | 27 | 待迁移 |
| D | Codex | 13 | 待迁移 |
| E | 界面 | 11 | 待迁移 |
| F | 会话全文搜索 | 1 | 待迁移 |
| G | Copilot CLI | 1 | 待迁移 |
| — | 不适用 | 22 | — |

| 处置 | 数量 |
| --- | --- |
| 已迁移 | 0 |
| 部分迁移 | 0 |
| 待迁移 | 86 |
| 不适用 | 22 |

执行顺序：A → B → C → D → E → F → G。各批共享文件多，顺序执行、逐批提交。

## 4. 决策记录

- 沿用前一轮：不新增语言（只 zh/en/ja）；“打开目录”类功能改为显示 / 复制路径；预设按上游分组、组内 A–Z，不展示赞助 / 合作标识与置顶；主题保留 Web 的 CSS 变量；故障转移队列与卡片不做拖动排名。

## 5. 提交矩阵

| 提交 | 版本 | 标题 | 批次 | 说明 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `7afceec1` | v4.0.26 | ci(release): retry xcrun stapler when CloudKit drops the connection | — | 上游发布 CI；Web 维护自有工作流 | 不适用 |
| `51fce968` | v4.0.26 | fix(presets): refresh stale default models (grok-4.7, kimi-k3.1-pro, qwen3.7-plus) (#9193) | A 预设/定价/图标 |  | 待迁移 |
| `b8fa4199` | v4.0.26 | fix(codex): follow up on sub-agent concurrency limit review notes (#9148) | D Codex |  | 待迁移 |
| `e217bfcb` | v4.0.26 | perf(proxy): reduce forwarding allocations and failover database reads (#9161) | B 代理 |  | 待迁移 |
| `e7878471` | v4.0.26 | fix(proxy): stop classifier retry loops (#9201) | B 代理 |  | 待迁移 |
| `c70d61de` | v4.0.26 | fix(linux): bump @tauri-apps/cli so the AppImage stops bundling libwayland-client (#9229) | — | Tauri CLI / AppImage 打包；Web 无桌面打包 | 不适用 |
| `d16064bd` | v4.0.26 | fix(sessions): improve reader toolbar layout and metadata wrapping (#9109) | E 界面 |  | 待迁移 |
| `98777515` | v4.0.26 | fix(ui): keep the remaining DB-lock-waiting sync commands off the UI thread (#9178) | C 后端杂项 |  | 待迁移 |
| `fc9b17cb` | v4.0.26 | perf(db): batch provider endpoint reads and skip unchanged saves (#9180) | C 后端杂项 |  | 待迁移 |
| `ca58c031` | v4.0.26 | perf(ui): lazy-load secondary pages and provider editors (#9181) | E 界面 |  | 待迁移 |
| `50a51b86` | v4.0.26 | perf(runtime): defer maintenance and pause hidden-window work (#9182) | C 后端杂项 |  | 待迁移 |
| `2186b305` | v4.0.26 | fix(apps): append actionable hint when npm install hits a bin-path collision (#9196) | C 后端杂项 |  | 待迁移 |
| `cc4ce038` | v4.0.26 | perf(sessions): avoid transcript copies and release lightweight caches (#9183) | C 后端杂项 |  | 待迁移 |
| `1adb3cbc` | v4.0.26 | fix(codex): stop GitHub Copilot Responses replies from showing twice (#8025) | B 代理 |  | 待迁移 |
| `02a13641` | v4.0.26 | fix(codex): reuse the Grok compat layer for GitHub Copilot Responses (#7989) | B 代理 |  | 待迁移 |
| `df3a9072` | v4.0.26 | fix(webdav-sync): preserve file symlink names in skills archives (#9197) | C 后端杂项 |  | 待迁移 |
| `78971d56` | v4.0.26 | feat(copilot): show every capped quota and label premium as Credits | E 界面 |  | 待迁移 |
| `cf3c86fe` | v4.0.26 | feat(auth): show each account's subscription plan in the Auth Center | E 界面 |  | 待迁移 |
| `626f0226` | v4.0.26 | feat(providers): show the plan on official provider cards | E 界面 |  | 待迁移 |
| `3cf79926` | v4.0.26 | fix(claude-desktop): point the official card at claude.com/download | A 预设/定价/图标 |  | 待迁移 |
| `51b464bd` | v4.0.26 | feat(deeplink): import providers for Claude Desktop and the Pi-family apps | C 后端杂项 |  | 待迁移 |
| `420646d8` | v4.0.26 | fix(dsh): let headless profiles read keys CC Switch stores | C 后端杂项 |  | 待迁移 |
| `1c2ed066` | v4.0.26 | fix(apps): explain npm bin collisions instead of echoing --force | C 后端杂项 |  | 待迁移 |
| `65f6e682` | v4.0.26 | fix(mcp): show sign-in required instead of failed for 401 MCP endpoints | C 后端杂项 |  | 待迁移 |
| `e6e7831e` | v4.0.26 | fix(claude-desktop): let auto-filled menu names follow model edits | E 界面 |  | 待迁移 |
| `a990c81a` | v4.0.26 | fix(proxy): race IPv4 when IPv6 upstream addresses are unreachable | B 代理 |  | 待迁移 |
| `7c250c42` | v4.0.26 | feat(proxy): warn when the system proxy hijacks the local route | B 代理 |  | 待迁移 |
| `62688ab3` | v4.0.26 | feat(codex): let a card keep the official Fast speed tier on GPT rows | D Codex |  | 待迁移 |
| `80ad02c5` | v4.0.26 | fix(proxy): log the mapped upstream model on failed requests | B 代理 |  | 待迁移 |
| `38efe109` | v4.0.26 | fix(proxy): scope the Codex chat call_id cache to the client session | B 代理 |  | 待迁移 |
| `abf441fe` | v4.0.26 | fix(proxy): keep turn-start developer messages in place for Codex chat | B 代理 |  | 待迁移 |
| `1d9b448e` | v4.0.26 | fix(subscription): refresh expired Claude login for follow-login cards | C 后端杂项 |  | 待迁移 |
| `7a0718e1` | v4.0.26 | fix(ui): stop macOS from capitalizing text typed into raw inputs | E 界面 |  | 待迁移 |
| `0f06fed2` | v4.0.26 | fix(ui): center dialogs without translate so they stay sharp on 1x displays | E 界面 |  | 待迁移 |
| `81a9fa79` | v4.0.26 | feat(dsh): allow overriding the DeepSeek Harness home directory | C 后端杂项 |  | 待迁移 |
| `a5100e0e` | v4.0.26 | chore(presets): switch TeamoRouter domain from .cn to .com | A 预设/定价/图标 |  | 待迁移 |
| `44c7fa9b` | v4.0.26 | fix(proxy): fill outbound_model on the classifier-loop early return | B 代理 |  | 待迁移 |
| `8c05b622` | v4.0.26 | chore(release): v4.0.26 | — | 上游版本号与 whats-new | 不适用 |
| `f621d421` | v4.0.26 | docs(release): add v4.0.26 release notes | — | 上游发行说明 | 不适用 |
| `4e13413f` | v4.0.26 | docs(manual): add the Japanese FAQ for Copilot replies showing twice | — | 上游用户手册 | 不适用 |
| `1d6efa64` | v4.0.27 | fix(stream_check): don't follow redirects in reachability checks (#9253) | B 代理 |  | 待迁移 |
| `cb2f2389` | v4.0.27 | fix(tray): stabilize Linux quick panel rendering in lightweight mode (#9233) | — | 系统托盘 | 不适用 |
| `158b2ba3` | v4.0.27 | feat(pricing): add search to the model pricing table (#9205) | A 预设/定价/图标 |  | 待迁移 |
| `e66441d8` | v4.0.27 | fix(ui): make provider icons follow the theme (#8438) | A 预设/定价/图标 |  | 待迁移 |
| `89409412` | v4.0.27 | feat(terminal): open a Grok Build terminal for the current provider (#9234) | E 界面 |  | 待迁移 |
| `6a3a7a44` | v4.0.27 | docs(tray): update outdated comments about the Linux panel background (#9279) | — | 系统托盘 | 不适用 |
| `566448f0` | v4.0.27 | fix(ui): keep the window draggable and its controls clickable while a dialog is open (#9140) | — | 桌面窗口拖动与标题栏控件 | 不适用 |
| `65106ce6` | v4.0.27 | feat(skills): tidy the installed Skills layout (#9210) | E 界面 |  | 待迁移 |
| `4e7413c5` | v4.0.27 | feat(ui): add interface density and zoom settings (#9209) | E 界面 |  | 待迁移 |
| `cd15a164` | v4.0.27 | feat(provider): add Genesis presets for compatible clients (#9269) | A 预设/定价/图标 |  | 待迁移 |
| `b9fd5d99` | v4.0.27 | feat(presets): move Mistral AI to Large 4 and unhide it | A 预设/定价/图标 |  | 待迁移 |
| `2360631f` | v4.0.27 | chore(presets): align Genesis presets with the inline preset style | A 预设/定价/图标 |  | 待迁移 |
| `deb6d5a1` | v4.0.27 | feat(sessions): search message text across sessions with a local FTS5 index (#7896) | F 会话全文搜索 |  | 待迁移 |
| `c88d7cc1` | v4.0.27 | fix(tray): convert Linux panel coordinates across display and DPR scale (#9287) | — | 系统托盘 | 不适用 |
| `c39db7df` | v4.0.27 | fix(ui): handle surrogate pairs and whitespace in provider icon initials fallback (#8139) | A 预设/定价/图标 |  | 待迁移 |
| `44e7d3ef` | v4.0.27 | fix(security): detect IPv4-compatible, SIIT, and NAT64 addresses in deep link risk classifier (#8127) | C 后端杂项 |  | 待迁移 |
| `13af7fc9` | v4.0.27 | fix(codex): write an absolute model_catalog_json pointer for native config dirs | D Codex |  | 待迁移 |
| `7d10364b` | v4.0.27 | test(codex): expect the absolute catalog pointer in tests added since the PR | D Codex |  | 待迁移 |
| `5bfca714` | v4.0.27 | fix(skill): ignore Python bytecode in directory hash | C 后端杂项 |  | 待迁移 |
| `747b1327` | v4.0.27 | fix(skill): migrate legacy cached hashes when upstream ships bytecode | C 后端杂项 |  | 待迁移 |
| `66e4362b` | v4.0.27 | fix(skill): keep updated_at when migrating a legacy cached hash | C 后端杂项 |  | 待迁移 |
| `05218b11` | v4.0.27 | fix(ui): disable WebView default context menu | — | WebView 默认右键菜单；Web 运行在普通浏览器里，保留浏览器菜单 | 不适用 |
| `f3c88da9` | v4.0.27 | fix(pricing): give the models.dev fetch time to finish reading the body | A 预设/定价/图标 |  | 待迁移 |
| `8dab4ed4` | v4.0.27 | fix(apps): stop treating Python's pi.exe as the Pi coding agent on Windows | C 后端杂项 |  | 待迁移 |
| `a94226b1` | v4.0.27 | fix(skills): stop showing 0 skills for repos discovery actually read | C 后端杂项 |  | 待迁移 |
| `92ca821e` | v4.0.27 | fix(config): write through symlinked live config files | C 后端杂项 |  | 待迁移 |
| `883382f1` | v4.0.27 | fix(proxy): name the provider in circuit breaker and skip logs | B 代理 |  | 待迁移 |
| `4a8f113f` | v4.0.27 | fix(proxy): return the half-open probe permit when an attempt is dropped | B 代理 |  | 待迁移 |
| `07798d56` | v4.0.27 | fix(ci): keep the WSL2 suite on a stable test root and match UNC catalog pointers | — | 上游 WSL2 CI | 不适用 |
| `4ed410ad` | v4.0.27 | feat(providers): add TokenPlus presets (#9296) | A 预设/定价/图标 |  | 待迁移 |
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
| `40b602a3` | v4.0.28 | docs(proxy): clarify supported SSE delimiter combinations (#7904) | B 代理 |  | 待迁移 |
| `2c5e5d2c` | v4.0.28 | feat(codex): keep moving official sessions into the shared bucket while opted in | D Codex |  | 待迁移 |
| `c7f7caf2` | v4.0.28 | feat(codex): warn when a switch splits Codex session history | D Codex |  | 待迁移 |
| `97e6d82a` | v4.0.28 | perf(codex): back up the state DB in a single step | D Codex |  | 待迁移 |
| `6a0acf07` | v4.0.28 | feat(codex): notify when the background unify migration finishes | D Codex |  | 待迁移 |
| `0e49c881` | v4.0.28 | fix(proxy): retry Codex compaction without tool_choice when rejected | B 代理 |  | 待迁移 |
| `49f2882e` | v4.0.28 | fix(proxy): repair Kimi tool-call history on native Responses | B 代理 |  | 待迁移 |
| `8ff9e3b5` | v4.0.28 | fix(proxy): strip ChatGPT identity headers for unmanaged Codex upstreams | B 代理 |  | 待迁移 |
| `905c9148` | v4.0.28 | feat(codex): write third-party routes as the built-in openai provider | D Codex |  | 待迁移 |
| `e9285cf1` | v4.0.28 | fix(proxy): map the model per target when Codex fails over across vendors | B 代理 |  | 待迁移 |
| `71dbcfa2` | v4.0.28 | fix(proxy): repair tool-call history for DeepSeek native Responses too | B 代理 |  | 待迁移 |
| `5f2f527d` | v4.0.28 | fix(codex): stop writing disable_response_storage | D Codex |  | 待迁移 |
| `e499d1f0` | v4.0.28 | refactor(codex): fold the history-split hint into the switch toast | D Codex |  | 待迁移 |
| `b0e452ff` | v4.0.28 | feat(codex): turn quota protection on by default and add a pause for the official login | D Codex |  | 待迁移 |
| `e6256c50` | v4.0.28 | feat(codex): move the official-login pause into the route and aggregation settings | D Codex |  | 待迁移 |
| `cac921f5` | v4.0.28 | fix(proxy): keep image and search models when Codex fails over | B 代理 |  | 待迁移 |
| `3321cb9e` | v4.0.28 | chore(release): v4.0.28 | — | 上游版本号与 whats-new | 不适用 |
| `8656ebd9` | v4.0.28 | docs(release): add v4.0.28 release notes | — | 上游发行说明 | 不适用 |
| `5a3d7f92` | 未发布 | feat(i18n): add Korean community localization (#8794) | — | 用户决定不新增语言（Web 保持 zh/en/ja）；提交内与语言无关的改动随 E 复核 | 不适用 |
| `cdca0984` | 未发布 | feat(i18n): add Russian community localization (#7788) | — | 用户决定不新增语言（Web 保持 zh/en/ja）；提交内与语言无关的改动随 E 复核 | 不适用 |
| `bd487e83` | 未发布 | feat(copilot): add GitHub Copilot CLI support (#8753) | G Copilot CLI |  | 待迁移 |
| `76e19b47` | 未发布 | fix(agy): align account quota endpoint with agy CLI and distinguish Ultra 5x/20x plans (#9319) | C 后端杂项 |  | 待迁移 |
| `72e826ed` | 未发布 | fix(proxy): normalize call-less outputs for native Responses providers (#9328) | B 代理 |  | 待迁移 |
| `5e9812e0` | 未发布 | fix(claude): omit reasoning_content for Mistral tool history (#9388) | B 代理 |  | 待迁移 |

## 6. 执行记录

- 2026-11-10：`git fetch upstream --no-tags` 取到 `5e9812e0`，建立本台账；108 项初判为待迁移 86、不适用 22。
