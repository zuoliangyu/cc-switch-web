# 本地路由、聚合与联网搜索

## 模式与服务

供应商页支持直连和路由；Claude Code、Claude Desktop、Codex 另支持聚合。模式行的「直连 / 路由 / 聚合」页签只用来查看，生效的那格带模式色圆点；查看的不是生效模式时，页面顶部的通知条提供「开始路由 / 切换到聚合模式 / 回到直连」，在确认框里选好路由目标或默认供应商并确认后才会修改客户端配置。供应商列表按查看的模式分组：路由开着故障转移时分「队列 · 按优先级 / 不在队列」，聚合分「默认供应商 / 已添加 / 可添加」，组内按显示名称 A–Z。退出路由或聚合时恢复之前的直连供应商，路由选择不会覆盖直连选择。

聚合模式中，卡片上的「添加 / 移除」按钮管理成员，「⋯」菜单设置默认供应商，默认那家显示「当前默认」且不能移除。全部供应商在各组内仍按显示名称 A–Z 排列；没有赞助／合作标签、星标或身份优先级。在聚合页签添加或编辑 Claude Code / Codex 第三方卡时打开简化表单（连接、模型列表、高级），从直连或路由页签打开的是完整表单。Claude 简化表单的模型列表可手填或批选远端模型；没存过列表时从模型映射生成，显示的就是实际发布的模型；第一行是默认模型并同步写入 `ANTHROPIC_MODEL`；清空列表表示这家不发布模型，保存时只提醒。路由生效时，故障转移开关与「路由设置」在模式行；Codex 聚合的子代理、经典工具与自动审批在模式行的「聚合设置」里，切换到聚合的确认框也可选子代理。Codex 合并各成员的模型目录，按供应商保留上下文窗口；未知或已删除的聚合模型 ID 会被拒绝，不回退到其他供应商。

模式保存和供应商编辑仅更新关键字段，并保留客户端全局设置。全局编辑发生并发冲突时可选择保留客户端或自己的值。Codex 模型目录／登录暂存与模式随同一份操作日志恢复。不要手工修改 Web 数据目录内的 `live-state.json` 或 pending 文件。

设置页可保存监听地址并重启服务；端口绑定失败时恢复原监听和客户端地址，不改每应用的重试和超时。正常关闭 Web 服务会先排空 HTTP 请求，再撤回四类 CLI 的代理地址，并保留模式供下次启动恢复。撤回失败时取消退出、恢复 Web 入口，修正配置后可重试。强制终止进程不能执行正常退出逻辑。

Claude Desktop 使用独立 profile。进入模型映射卡启动路由服务，切离映射卡且没有其他应用接管时停止。Codex、Gemini、Grok 客户端需要重新启动以读取新配置；Codex 的目录提示会说明自定义目录覆盖、官方列表暂不可用或客户端仍持有旧列表等状态。

Codex 跨供应商续聊支持 V2 远程压缩：第三方生成的摘要包装后交还客户端，下次请求解回文字；截断或没有摘要时不替换历史。原生上游签发的未知密文先原样发送，仅在明确拒绝后对同一家清理重试一次；第三方原生 Responses 携带未知压缩条目且返回 400/422 时允许仅压缩条目回退。工具调用的 `call_id` 保持不变。

Codex 旧目录提示中可确认重启托管守护进程，等待任务收尾可能需要数分钟；桌面版和编辑器插件需手动退出重开。Windows 沿用上游限制，不提供进程表探测。模式启动恢复失败或没有接上时，页面顶部的通知条显示原因，可「重试」或「回到直连」；成功后通知消失。

### Codex 直连模型目录

Codex 的自定义模型目录可在直连模式使用。编辑第三方供应商，在连接信息下方的“模型列表”里点“获取模型列表”勾选模型，或“手动添加”，填写菜单显示名、实际请求模型和可选的上下文窗口；列表第一行就是默认模型，可拖动行首手柄换序，列表留空则不生成目录。保存并切换到该供应商后，重启 Codex 以刷新 `/model` 列表。

例如，菜单显示名填写 `MiMo`、实际请求模型填写 `mimo-v2.5-pro`，Codex 会在菜单中显示 `MiMo`，并向上游请求 `mimo-v2.5-pro`。目录不执行任意请求模型名的重写，也不会启动本地路由；原生 Responses 供应商的地址保持为上游地址。

是否需要路由取决于协议和连接方式，不取决于模型是否属于 GPT 或是否启用目录。原生 Responses + 普通 API Key 可直连；Chat Completions／Anthropic 格式转换、由代理注入托管账号凭据或使用完整请求 URL 等情况仍需路由。表单中的 Chat 思考与缓存参数独立于目录开关，关闭目录不会清除这些参数。

### Codex 官方会话与模型

官方路由使用与直连相同的会话桶：关闭统一历史时保留内置 `openai`，通过顶层 `openai_base_url` 指向本地代理；开启时使用 `custom` 官方镜像表。切换统一历史设置会重写当前契约，不再创建 `cc-switch-official` 历史桶。GET `/responses`、`/v1/responses`、`/v1/v1/responses`、`/codex/v1/responses` 返回 426，让 Codex 立即回退 HTTP/SSE。发往第三方的请求移除 Codex `version` 指纹头。

第三方预设使用原生 Responses 协议；供应商没有 API Key、却设置 `requires_openai_auth = true` 时会使 Codex 回退到本机登录，因此可以保存为草稿，但不能切换、加入路由或覆盖当前配置。不要为第三方复用官方登录。官方或代理注入 OAuth 的供应商使用各自认证规则。

Claude 表单可拉取托管 ChatGPT 模型，接口为 `GET /api/auth/codex_oauth/models?accountId=...`；账号省略时用默认账号。此接口与生成请求共享 0.159.0 身份。原生官方目录镜像则使用本机 Codex 的实际版本。两套账号与版本来源不可混用。

### Web API

这些接口沿用现有访问密钥保护：

| 接口 | 用途 |
| --- | --- |
| `GET /api/proxy/apps/:app/mode` | 模式、直连选择、路由、可用供应商、聚合成员与 startupError |
| `PUT /api/proxy/apps/:app/mode` | `{mode: "direct" / "routing" / "aggregation", routeProviderId?: string}` |
| `POST /api/proxy/apps/:app/providers/:id/switch` | 预选或切换路由；直连时不启动服务、不改客户端配置 |
| `PUT /api/proxy/apps/:app/aggregation/:id` | `{enabled: boolean}`，增减聚合成员 |
| `POST /api/proxy/codex/daemon/restart` | 确认后重启 Codex 托管守护进程；返回 `restarted` / `notRunning` |
| `POST /api/proxy/restart` | 保存全局监听／日志配置并重启；请求字段与 global-config 相同 |

旧 takeover/start/stop 接口兼容保留，内部调用新模式控制器。模式支持 `claude`、`claude-desktop`、`codex`、`gemini`、`grokbuild`，聚合支持 `claude`、`claude-desktop`、`codex`。

## Claude → Codex 联网搜索

CC Switch Web 的本地路由可以把 Claude Code 的托管 WebSearch 工具转换为 OpenAI Responses API 的托管 `web_search` 工具。该能力适用于 Codex OAuth，以及实现了对应 Responses 工具协议的兼容网关。本地执行的 WebFetch 不受影响。

## 支持范围

- 保留 `allowed_domains` 限制。
- API Key Responses 路由把 `max_uses` 映射为上游的 `max_tool_calls`。
- Codex OAuth 不接受 `max_tool_calls`，路由会把限制加入模型指令，并在额外搜索开始时终止上游流，返回 `max_uses_exceeded`。
- 流式与非流式响应都会生成配对的 `server_tool_use` 和 `web_search_tool_result` 内容块。
- 搜索来源会转换为 citation，并记录 `usage.server_tool_use.web_search_requests`。
- 多轮对话会回放已有的 WebSearch 调用与结果。

## 明确拒绝的请求

以下约束无法无损表示时，路由会直接报错，不会静默放宽限制：

- 非空 `blocked_domains`。
- 非 direct caller 或无法确认 caller 的动态过滤请求。
- 要求 `response_inclusion` 的请求。
- 未验证版本的 WebSearch 工具。
- Codex OAuth 上未强制选择 WebSearch、但设置了逐工具 `max_uses` 的请求。

## Codex Alpha Search

路由同时接受以下本地端点，并统一转发到所选 Codex Provider 的 `/alpha/search`：

- `/alpha/search`
- `/v1/alpha/search`
- `/v1/v1/alpha/search`
- `/codex/v1/alpha/search`

请求复用 Provider 选择、模型映射、认证、重试、故障转移和日志链路，不转换为 Chat Completions 或 Anthropic Messages。

如果 Provider 启用了“完整 URL”，路由只会从以 `/responses` 或 `/responses/compact` 结尾的 URL 推导同级 Alpha Search 端点，并保留原 URL 与请求中的查询参数。其他不透明完整 URL 会直接报配置错误，防止把搜索载荷发送到错误端点。


## 用量与计费

用量默认显示当天，趋势默认显示 Token，可切换请求数或费用。“全部”范围统计所有记录，并以最近 53 周的热力图替换趋势图。四类表格每页 20 条；供应商统计按名称 A–Z，刷新减少记录时页码收回有效范围。点击请求时间打开详情，查询失败会显示错误并提供重试。

代理输出速度按首个有效输出到结束的时间计算，仅计入至少 100 个输出 Token、生成时间至少 100ms 的样本。Claude/Codex 会话日志没有精确首 Token 时间，按事件估算时长；至少 200 个输出 Token、时长至少 1 秒才显示估算速度，请求明细以 `≈` 区分，供应商统计分列展示。没有逐条计时的历史汇总不参与速度计算。

新代理请求不再读取供应商或全局费用倍率；计费模型来源只使用应用级设置，且只影响经本地路由的请求。旧供应商倍率字段仅保留兼容，历史日志保存的倍率与金额不被批量改写。缺失价格补算使用日志记录的倍率。默认开启 models.dev 价格同步，已明确关闭的设置仍然保留。旧 `/api/proxy/apps/:app/default-cost-multiplier` 接口已移除。
