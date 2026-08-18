# Web 端跟进上游 `40cac1a6` 后续迁移计划（2026-08-18）

> 状态：批次 1 至批次 4 已完成
> 上游仓库：`E:\zuolan_lib\AI_Hub\cc-switch`  
> 冻结基线：`40cac1a6`  
> 当前审计点：`fd14f9c4`  
> 增量：24 个提交

## 1. 目标与原则

本轮吸收 `cc-switch` 在既有 Web 对齐基线之后新增、且适用于浏览器 UI 与本地服务端运行时的功能和修复。Tauri 窗口、桌面安装器和 Web 端不存在的批量升级生命周期不机械复制。

迁移按风险拆包：

1. Provider 模型目录、reasoning 方言与 DeepSeek 用量计费。
2. Codex OAuth 生命周期、多个 Follow Login Provider 与可配置用量查询。
3. Codex Alpha Search、Claude Hosted WebSearch 和流式协议转换。
4. IME、Usage 趋势图、Grok Build 文案与命令探测超时。

每个迁移包独立补测试并完成局部验证。全量测试与 build 在全部迁移包收口后统一执行。

## 2. 提交处置矩阵

| 上游提交   | 内容                                    | Web 处置                                            | 批次 | 状态     |
| ---------- | --------------------------------------- | --------------------------------------------------- | ---- | -------- |
| `a2e22f33` | 托管 OAuth 账号选择与原生认证生命周期   | 适配迁移，复用 Web 多账号 UI，重构 Codex 认证持久化 | 2    | 已迁移   |
| `e163a671` | 预填官方 Codex reasoning 档位           | 直接迁移预设语义                                    | 1    | 已迁移   |
| `c6247d13` | 补齐其余 Codex reasoning 档位           | 直接迁移预设语义                                    | 1    | 已迁移   |
| `1435223b` | 修正 SiliconFlow、ModelScope 不可用模型 | 同步六类应用预设                                    | 1    | 已迁移   |
| `3f75bbdf` | StepFun step-3.7 effort 推断            | 适配到 Web 代理                                     | 1    | 已迁移   |
| `e12fc623` | 聚合平台 thinking 方言修正              | 适配到 Web 代理与预设                               | 1    | 已迁移   |
| `9dcd3486` | 千帆、BytePlus Codex thinking 开关      | 迁移预设和协议声明                                  | 1    | 已迁移   |
| `af06356d` | Kimi reasoning effort                   | 迁移逐模型档位与参数声明                            | 1    | 已迁移   |
| `4080a8e9` | 千帆 Token Plan 六应用预设              | 同步 Web 已支持应用                                 | 1    | 已迁移   |
| `46f19a15` | DeepSeek cache-hit token                | 迁移解析与 Responses usage 转换                     | 1    | 已迁移   |
| `d01eab97` | OpenCode Zen effort 方言                | 迁移逐模型钳制逻辑                                  | 1    | 已迁移   |
| `bdeaac75` | Alpha Search 与 Hosted WebSearch        | 独立迁移完整请求、响应及 SSE 语义                   | 3    | 已迁移   |
| `de9af49a` | Windows CLI 检测                        | 迁移安全 PATH、注册表和独立安装目录检测             | 4    | 已迁移   |
| `d4fefefc` | Windows Tauri FOUC                      | Tauri 窗口专属                                      | 排除 | 不适用   |
| `b109dcd3` | Grok Build 表单文案                     | 迁移表单分流                                        | 4    | 已迁移   |
| `3d126f45` | 跨年 Usage 趋势图 key                   | 迁移 RFC3339 xKey                                   | 4    | 已迁移   |
| `f62c854a` | 清理认证后取消旧 device flow            | 纳入 OAuth 生命周期迁移                             | 2    | 已迁移   |
| `a98829ba` | Provider 字段 IME 加固                  | 迁移组合输入和 blur 提交修复                        | 4    | 已迁移   |
| `897ca892` | Codex OAuth 用量查询可配置              | 适配 Web usage 配置与轮询                           | 2    | 已迁移   |
| `0455a92c` | 多个 Follow Login Provider              | 按配置内容识别任意别名，不依赖固定 Provider ID      | 2    | 已迁移   |
| `52745efe` | OpenCode Go Anthropic 回归测试          | 行为已存在，补等价回归测试                          | 4    | 已补测试 |
| `6e424fd3` | 恢复 Codex 1M 开关                      | Web 已存在                                          | 已有 | 已处置   |
| `d1c550ba` | 删除 Goal mode 开关                     | Web 当前无该开关                                    | 已有 | 已处置   |
| `fd14f9c4` | 环境/升级预检超时                       | 迁移通用命令探测 timeout；批量升级 UI 不适用        | 4    | 已迁移   |

## 3. 分批影响范围

### 3.1 批次 1：模型、reasoning 与计费

- 前端：`src/types.ts`、各应用 Provider 预设、Provider 表单投影。
- 后端：`backend/src/provider.rs`、Codex Chat reasoning 推断与协议转换、usage parser。
- 测试：Provider 预设、逐模型 reasoning 档位、DeepSeek usage 转换。

验收标准：

- 表单能看到并保存供应商真实支持的 reasoning 档位。
- Kimi、StepFun、千帆、BytePlus、SiliconFlow、OpenCode Zen 使用各自正确的参数方言。
- 千帆 Token Plan 在 Web 已支持的应用中可创建。
- 仅返回 `prompt_cache_hit_tokens` 的 DeepSeek 兼容端点能正确统计缓存命中。

### 3.2 批次 2：Codex OAuth

- 保留 Web 现有多账号数据与 `authBinding` 交互。
- 补齐 `id_token`、token 获取时间、`reauth_required`、请求 timeout 和持久化锁。
- 生成可由裸 Codex CLI 自刷新的原生 `auth.json`，并防止清理前发起的旧登录流程复活。
- 多个 Follow Login Provider 按配置内容识别；`e-flowcode`、自定义别名等都不依赖固定 ID。
- 绑定托管账号的 Follow Login Provider 默认展示官方额度，可独立关闭查询或配置自动轮询间隔；`0` 表示关闭自动轮询。
- Provider 切换、编辑、Routing 启停按应用串行；托管切换使用 auth/config/catalog/marker 四文件快照回滚。
- Routing 备份不固化托管 token，停止 Routing 时从认证管理器动态注入最新凭据。

验收标准：代理托管账号和裸 Codex CLI 都能持续刷新；切换、编辑、清理、Routing 恢复和失败回滚不会覆盖其他账号或 Provider 的认证；任意 Follow Login 别名均可按绑定账号查询额度并配置轮询。

### 3.3 批次 3：Hosted WebSearch

- 完整转换 Anthropic `web_search_*` 与 Responses `web_search`。
- 支持 `server_tool_use`、`web_search_tool_result`、citation/source 和 `max_uses`。
- 流式与非流式响应保持同一语义。

验收标准：不再过滤受支持的 hosted tool，工具结果和引用可被 Codex/Claude 双向回放。

### 3.4 批次 4：交互与环境检测

- IME 输入不丢最终组合文本。
- Usage 跨年同日的数据点和 tooltip 不冲突。
- Grok Build 不显示 Codex 专属模型映射文案。
- Windows 仅检测原生 CLI，不读取 WSL 偏好；按进程、用户注册表、机器注册表的优先级合并 PATH，并补扫 Codex、Claude 独立安装目录及常见包管理器目录。
- PATH 默认项由系统 `where.exe` 在合并后的 PATH 中解析，过滤 `Microsoft\WindowsApps` App Execution Alias 后才按真实绝对路径执行 `--version`，不会按裸命令启动协议 handler。
- Windows 命令输出兼容 UTF-8、OEM 和 ANSI code page，含中文用户名的安装路径可被正确解析。
- CLI 定位和版本探测具备 10 秒超时；Windows 超时后使用 `taskkill /T /F` 终止进程树，非 Windows 探测使用独立会话并终止整个进程组。
- Web 后端在 blocking 线程中执行 Windows 子进程探测，避免设置页刷新阻塞 Tokio 请求线程。

## 4. 风险与回滚边界

- OAuth 和 Hosted WebSearch 都会改变跨请求状态或协议事件，不与预设数据更新混合提交。
- reasoning 档位必须以逐模型目录为准；未知档位不应盲目下发给严格校验网关。
- DeepSeek cache-hit 字段只作标准字段之后的末位 fallback，避免覆盖中转明确给出的标准统计。
- Windows CLI 检测只执行只读路径解析和受限版本探测，不引入桌面升级动作。
- Windows 检测仅接受固定工具白名单，并只执行解析出的文件或已知候选文件；保留旧 API 中的 WSL 字段仅为兼容，不在 Windows 检测链路中消费。

## 5. 执行记录

- 2026-08-18：刷新 `upstream/main` 到 `fd14f9c4`，确认相对冻结基线新增 24 个提交。
- 2026-08-18：完成缺口审计并建立本迁移台账。
- 2026-08-18：完成批次 1。Provider 预设测试 50 项、Rust 定向测试 7 项和 TypeScript 类型检查通过；未运行全量测试或 build。
- 2026-08-18：开始批次 2，完成旧 device flow 登录世代保护；对应 Rust 定向测试 1 项通过。
- 2026-08-18：完成 Codex OAuth 核心生命周期迁移：旧账号重登提示、`id_token`/token 世代持久化、CLI refresh token 采纳、CAS 同步与清理、四文件事务回滚。
- 2026-08-18：完成任意 Follow Login 别名识别及误判保护；固定 `codex-official` 继续兼容，明确第三方 URL、API Key、bearer token 或非 OpenAI model provider 不会被接管。
- 2026-08-18：补齐 Routing per-app 串行锁、暂停状态热切换与托管账号动态恢复测试；批次 2 仅剩 `897ca892` 可配置用量查询。
- 2026-08-18：完成 `897ca892` Web 适配。绑定账号默认展示 OAuth quota，可关闭查询、配置轮询间隔并使用绑定账号执行测试查询；批次 2 完成。
- 2026-08-18：完成 `bdeaac75` Web 适配。补齐 Alpha Search 端点透传、full-URL 安全改写，以及 Hosted WebSearch 的请求、响应、SSE、citation、多轮回放和 `max_uses` 语义；批次 3 完成。
- 2026-08-18：批次 3 通过 `cargo check`，以及 Responses 请求转换 115 项、Responses SSE 85 项、Codex-Anthropic 72 项、WebSearch 37 项和 Alpha Search 2 项定向测试。
- 2026-08-18：完成批次 4 前端交互项。IME 输入在 composition 未正常结束时仍会于 blur 提交最终值；Usage 趋势图使用完整日期作为唯一 key 并在跨年时显示年份；Grok Build 使用独立模型提示；OpenCode Go Anthropic 预设补齐回归测试。
- 2026-08-18：批次 4 前端交互项通过 TypeScript 类型检查，以及 IME、Provider 表单、Usage 趋势图、Grok Build、OpenCode Go 和 Provider 能力共 70 项定向测试。
- 2026-08-18：完成 `de9af49a` Web 适配。恢复 Windows 原生 CLI 检测，合并 HKCU/HKLM PATH，补齐 Codex、Claude 独立安装目录和常见包管理器目录；PATH 默认项优先且过滤 WindowsApps alias，`.cmd` canonical path 与非 UTF-8 控制台输出均可安全处理。未新增 Windows WSL 探测。
- 2026-08-18：完成 `fd14f9c4` Web 适配。定位和版本探测统一限制为 10 秒，超时终止进程树或进程组；Windows 探测通过 blocking 线程执行。桌面端批量升级 UI 与升级预检不适用于 Web，未迁移。
- 2026-08-18：批次 4 后端通过 `cargo check` 和 `commands::misc::tests` 25 项定向测试；未运行全量测试或 build。
- 2026-08-18：重新逐项核对 `40cac1a6..fd14f9c4` 的 24 个上游提交，迁移台账 hash 覆盖 24/24，无未列提交；本地缓存的最新上游引用仍为 `fd14f9c4`。
- 2026-08-18：修复全量测试基线漂移：同步 Provider 预设数量、Bedrock 模型目录、Web 相对 API 地址、代理应用 seed 与当前模型定价；补齐 App 集成测试所需的 Profile、环境冲突和 Skill MSW 响应，并为完整交互流设置单次集成测试超时。
- 2026-08-18：修复 Windows 无符号链接权限时的测试兼容，仅对系统错误码 1314 受控跳过；OpenClaw 临时 HOME 测试接入全局串行锁，避免全量并发时环境变量相互覆盖。
- 2026-08-18：完成全量验证。前端 91 个测试文件共 512 项通过、2 项跳过；Rust 1663 项通过、3 项忽略；TypeScript 类型检查通过，均无失败。
