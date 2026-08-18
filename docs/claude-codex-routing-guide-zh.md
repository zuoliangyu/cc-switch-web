# Claude → Codex 路由的联网搜索说明

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
