# Web 端跟进上游 `40cac1a6` 后续迁移计划（2026-08-18）

> 状态：批次 1 已完成，批次 2 迁移中  
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
| `a2e22f33` | 托管 OAuth 账号选择与原生认证生命周期   | 适配迁移，复用 Web 多账号 UI，重构 Codex 认证持久化 | 2    | 待迁移   |
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
| `bdeaac75` | Alpha Search 与 Hosted WebSearch        | 独立迁移完整请求、响应及 SSE 语义                   | 3    | 待迁移   |
| `de9af49a` | Windows CLI 检测                        | 迁移安全 PATH、注册表和独立安装目录检测             | 4    | 待迁移   |
| `d4fefefc` | Windows Tauri FOUC                      | Tauri 窗口专属                                      | 排除 | 不适用   |
| `b109dcd3` | Grok Build 表单文案                     | 迁移表单分流                                        | 4    | 待迁移   |
| `3d126f45` | 跨年 Usage 趋势图 key                   | 迁移 RFC3339 xKey                                   | 4    | 待迁移   |
| `f62c854a` | 清理认证后取消旧 device flow            | 纳入 OAuth 生命周期迁移                             | 2    | 已迁移   |
| `a98829ba` | Provider 字段 IME 加固                  | 迁移组合输入和 blur 提交修复                        | 4    | 待迁移   |
| `897ca892` | Codex OAuth 用量查询可配置              | 适配 Web usage 配置与轮询                           | 2    | 待迁移   |
| `0455a92c` | 多个 Follow Login Provider              | 与托管 OAuth 生命周期一起迁移                       | 2    | 待迁移   |
| `52745efe` | OpenCode Go Anthropic 回归测试          | 行为已存在，补等价回归测试                          | 4    | 待补测试 |
| `6e424fd3` | 恢复 Codex 1M 开关                      | Web 已存在                                          | 已有 | 已处置   |
| `d1c550ba` | 删除 Goal mode 开关                     | Web 当前无该开关                                    | 已有 | 已处置   |
| `fd14f9c4` | 环境/升级预检超时                       | 仅迁移通用命令探测 timeout；批量升级 UI 不适用      | 4    | 待迁移   |

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
- 多个 Follow Login Provider 按 Provider ID 隔离 live auth 快照。

验收标准：代理托管账号和裸 Codex CLI 都能持续刷新；切换、清理、失败回滚不会覆盖其他账号或 Provider 的认证。

### 3.3 批次 3：Hosted WebSearch

- 完整转换 Anthropic `web_search_*` 与 Responses `web_search`。
- 支持 `server_tool_use`、`web_search_tool_result`、citation/source 和 `max_uses`。
- 流式与非流式响应保持同一语义。

验收标准：不再过滤受支持的 hosted tool，工具结果和引用可被 Codex/Claude 双向回放。

### 3.4 批次 4：交互与环境检测

- IME 输入不丢最终组合文本。
- Usage 跨年同日的数据点和 tooltip 不冲突。
- Grok Build 不显示 Codex 专属模型映射文案。
- CLI 检测具备明确超时，Windows 检测不启动命令 shim 或协议 handler。

## 4. 风险与回滚边界

- OAuth 和 Hosted WebSearch 都会改变跨请求状态或协议事件，不与预设数据更新混合提交。
- reasoning 档位必须以逐模型目录为准；未知档位不应盲目下发给严格校验网关。
- DeepSeek cache-hit 字段只作标准字段之后的末位 fallback，避免覆盖中转明确给出的标准统计。
- Windows CLI 检测只执行只读路径解析和受限版本探测，不引入桌面升级动作。

## 5. 执行记录

- 2026-08-18：刷新 `upstream/main` 到 `fd14f9c4`，确认相对冻结基线新增 24 个提交。
- 2026-08-18：完成缺口审计并建立本迁移台账。
- 2026-08-18：完成批次 1。Provider 预设测试 50 项、Rust 定向测试 7 项和 TypeScript 类型检查通过；未运行全量测试或 build。
- 2026-08-18：开始批次 2，完成旧 device flow 登录世代保护；对应 Rust 定向测试 1 项通过。
