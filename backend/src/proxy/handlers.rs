//! 请求处理器
//!
//! 处理各种API端点的HTTP请求
//!
//! 重构后的结构：
//! - 通用逻辑提取到 `handler_context` 和 `response_processor` 模块
//! - 各 handler 只保留独特的业务逻辑
//! - Claude 的格式转换逻辑保留在此文件（用于 OpenRouter 旧接口回退）

use super::{
    error_mapper::{get_error_message, map_proxy_error_to_status},
    forwarder::CodexUpstreamFormat,
    handler_config::{
        CLAUDE_PARSER_CONFIG, CODEX_PARSER_CONFIG, GEMINI_PARSER_CONFIG, OPENAI_PARSER_CONFIG,
    },
    handler_context::RequestContext,
    providers::{
        get_adapter, get_claude_api_format,
        streaming::create_anthropic_sse_stream,
        streaming_codex_anthropic::{
            create_responses_sse_stream_from_anthropic_with_context,
            responses_sse_events_from_anthropic_message,
        },
        streaming_codex_chat::create_responses_sse_stream_from_chat_with_context,
        streaming_gemini::create_anthropic_sse_stream_from_gemini,
        streaming_responses::{
            create_anthropic_sse_stream_from_responses,
            create_anthropic_sse_stream_from_responses_with_web_search_options,
        },
        transform, transform_codex_anthropic, transform_codex_chat,
        transform_codex_responses_namespace, transform_codex_responses_xai_sanitize,
        transform_gemini, transform_responses,
    },
    response_processor::{
        create_logged_passthrough_stream, create_usage_collector, process_response,
        read_decoded_body, strip_entity_headers_for_rebuilt_body, SseUsageCollector,
    },
    server::ProxyState,
    types::*,
    usage::parser::TokenUsage,
    ProxyError,
};
use crate::app_config::AppType;
use crate::proxy::providers::codex_chat_common::extract_reasoning_field_text;
use crate::proxy::sse::{strip_sse_field, SseBlocks};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use bytes::Bytes;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;

// ============================================================================
// 健康检查和状态查询（简单端点）
// ============================================================================

/// 健康检查
pub async fn health_check(headers: axum::http::HeaderMap) -> axum::response::Response {
    let mut response = (
        StatusCode::OK,
        Json(json!({
            "status": "healthy",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
        .into_response();
    // 环回自检带的随机值原样写回，证明请求回到了本地路由（见 loopback_probe）
    if let Some(nonce) = headers.get(super::loopback_probe::PROBE_HEADER) {
        response
            .headers_mut()
            .insert(super::loopback_probe::PROBE_HEADER, nonce.clone());
    }
    response
}

/// 获取服务状态
pub async fn get_status(State(state): State<ProxyState>) -> Result<Json<ProxyStatus>, ProxyError> {
    let status = state.status.read().await.clone();
    Ok(Json(status))
}

// ============================================================================
// Claude API 处理器（包含格式转换逻辑）
// ============================================================================

/// 处理 /v1/messages 请求（Claude API）—— 薄包装，复用通用实现
///
/// Claude 处理器包含独特的格式转换逻辑：
/// - 过去用于 OpenRouter 的 OpenAI Chat Completions 兼容接口（Anthropic ↔ OpenAI 转换）
/// - 现在 OpenRouter 已推出 Claude Code 兼容接口，默认不再启用该转换（逻辑保留以备回退）
pub async fn handle_messages(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_messages_for_app(state, request, AppType::Claude, "Claude", "claude", None).await
}

/// Claude Desktop 3P 本地 gateway：`POST /claude-desktop/v1/messages`
pub async fn handle_claude_desktop_messages(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    validate_claude_desktop_gateway_auth(&state, request.headers())?;
    handle_messages_for_app(
        state,
        request,
        AppType::ClaudeDesktop,
        "Claude Desktop",
        "claude-desktop",
        Some("/claude-desktop"),
    )
    .await
}

/// Claude Desktop 3P 本地 gateway：`GET /claude-desktop/v1/models`
pub async fn handle_claude_desktop_models(
    State(state): State<ProxyState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, ProxyError> {
    validate_claude_desktop_gateway_auth(&state, &headers)?;
    let providers = state
        .provider_router
        .select_providers("claude-desktop")
        .await
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?;
    let provider = providers.first().ok_or(ProxyError::NoAvailableProvider)?;
    let mut response = crate::claude_desktop_config::model_list_response(provider)
        .map_err(|e| ProxyError::ConfigError(e.to_string()))?;
    // 聚合的模型 Desktop 只从 profile 里拿，这里补上是为了带上说明，两边也一致
    let stacked = crate::mode::stack::desktop_published_now(&state.db).unwrap_or_else(|error| {
        log::warn!("[Claude Desktop] 读取聚合模型失败，只返回路由那家的: {error}");
        Vec::new()
    });
    if let Some(data) = response.get_mut("data").and_then(Value::as_array_mut) {
        data.extend(stacked.into_iter().map(|model| {
            let mut item = json!({
                "type": "model",
                "id": model.id,
                "display_name": model.label,
                "created_at": crate::claude_desktop_config::DEFAULT_CREATED_AT,
            });
            if model.supports_1m {
                item["supports1m"] = json!(true);
            }
            item["description"] =
                json!(crate::claude_desktop_config::discovered_model_description(
                    &model.provider_name,
                    &model.upstream,
                    model.supports_1m,
                ));
            item
        }));
        let last_id = data.last().and_then(|item| item.get("id")).cloned();
        if let Some(last_id) = last_id {
            response["last_id"] = last_id;
        }
    }
    Ok(Json(response))
}

/// 校验 Claude Desktop 本地 gateway 的 Bearer token（每请求验证）。
fn validate_claude_desktop_gateway_auth(
    state: &ProxyState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ProxyError> {
    validate_claude_desktop_gateway_auth_for_db(state.db.as_ref(), headers)
}

fn validate_claude_desktop_gateway_auth_for_db(
    db: &crate::database::Database,
    headers: &axum::http::HeaderMap,
) -> Result<(), ProxyError> {
    let expected = crate::claude_desktop_config::get_or_create_gateway_token(db)
        .map_err(|e| ProxyError::AuthError(e.to_string()))?;

    validate_claude_desktop_gateway_token(headers, &expected)
}

fn validate_claude_desktop_gateway_token(
    headers: &axum::http::HeaderMap,
    expected: &str,
) -> Result<(), ProxyError> {
    let auth_error =
        || ProxyError::AuthError("Claude Desktop gateway authentication failed".to_string());
    let token = extract_gateway_token(headers).ok_or_else(auth_error)?;

    // The token length is not secret; `ct_eq` hides where the contents differ.
    if token.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1 {
        return Err(auth_error());
    }

    Ok(())
}

/// Extract the Claude Desktop gateway token from request headers.
///
/// The Claude desktop app sends the token as `x-api-key` (per Anthropic's
/// published auth header convention). Other clients — and the desktop app's
/// own explicit setting — may send `Authorization: Bearer <token>`. This
/// helper accepts either and returns the raw token bytes, with no validity
/// check; the caller is responsible for comparing to the expected token.
fn extract_gateway_token(headers: &axum::http::HeaderMap) -> Option<String> {
    // Prefer `Authorization` if present (more specific).
    if let Some(value) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(s) = value.to_str() {
            // Accept either "Bearer " or "bearer " prefix; if neither is
            // present, treat the whole value as the token (lenient parsing).
            let token = s
                .strip_prefix("Bearer ")
                .or_else(|| s.strip_prefix("bearer "))
                .unwrap_or(s)
                .trim();
            return Some(token.to_string());
        }
    }
    if let Some(value) = headers.get("x-api-key") {
        if let Ok(s) = value.to_str() {
            return Some(s.trim().to_string());
        }
    }
    None
}

/// Whether a Claude upstream response must be converted back to Anthropic Messages.
///
/// The forwarder resolves the wire format per request (GitHub Copilot picks native
/// Messages for Anthropic models that advertise it), so that decision wins over the
/// provider-level default, which always converts for Copilot.
fn claude_response_needs_transform(
    resolved_api_format: Option<&str>,
    provider_default: bool,
) -> bool {
    resolved_api_format.map_or(
        provider_default,
        super::providers::claude_api_format_needs_transform,
    )
}

/// `/v1/messages` 通用实现（Claude 与 Claude Desktop 共用）
async fn handle_messages_for_app(
    state: ProxyState,
    request: axum::extract::Request,
    app_type: AppType,
    tag: &'static str,
    app_type_str: &'static str,
    strip_prefix: Option<&'static str>,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut body = body;
    let stack = match resolve_stack_target(&state, &app_type, &mut body) {
        Ok(stack) => stack,
        Err(response) => return Ok(*response),
    };
    let mut ctx = RequestContext::new_with_stack(
        &state,
        &body,
        &headers,
        app_type.clone(),
        tag,
        app_type_str,
        stack,
    )
    .await?;

    let raw_endpoint = uri
        .path_and_query()
        .map(|path_and_query| path_and_query.as_str())
        .unwrap_or(uri.path());
    // Claude Desktop gateway 走 /claude-desktop 前缀，转发到上游前需剥离。
    let endpoint = strip_prefix
        .and_then(|prefix| raw_endpoint.strip_prefix(prefix))
        .unwrap_or(raw_endpoint);

    let is_stream = body
        .get("stream")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);
    // 转发请求
    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &app_type,
            endpoint,
            body.clone(),
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, is_stream, &err.error).await;
            return Err(err.error);
        }
    };

    let resolved_api_format = result.claude_api_format.is_some();
    ctx.provider = result.provider;
    let api_format = result
        .claude_api_format
        .as_deref()
        .unwrap_or_else(|| get_claude_api_format(&ctx.provider))
        .to_string();
    let response = result.response;

    // 检查是否需要格式转换（OpenRouter 等中转服务）
    let adapter = get_adapter(&app_type);
    let needs_transform = claude_response_needs_transform(
        resolved_api_format.then_some(api_format.as_str()),
        adapter.needs_transform(&ctx.provider),
    );

    // Claude 特有：格式转换处理
    if needs_transform {
        return handle_claude_transform(response, &ctx, &state, &body, is_stream, &api_format)
            .await;
    }

    // 通用响应处理（透传模式）
    process_response(response, &ctx, &state, &CLAUDE_PARSER_CONFIG, is_stream).await
}

/// Claude 格式转换处理（独有逻辑）
///
/// 支持 OpenAI Chat Completions 和 Responses API 两种格式的转换
async fn handle_claude_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    original_body: &Value,
    is_stream: bool,
    api_format: &str,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    let is_codex_oauth = ctx
        .provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        == Some("codex_oauth");
    // Claude 的模型验证要求非流式 JSON，并直接读取 usage.input_tokens。
    // Chat/Responses 上游即使强制返回 SSE，也必须聚合后再交给非流客户端。
    // Codex OAuth 强制 SSE，但可能不标 Content-Type，保留这个额外识别条件。
    let aggregate_responses_sse =
        !is_stream && api_format == "openai_responses" && (is_codex_oauth || response.is_sse());
    let use_streaming =
        should_use_claude_transform_streaming(is_stream, response.is_sse(), api_format);
    let tool_schema_hints = transform_gemini::extract_anthropic_tool_schema_hints(original_body);
    let tool_schema_hints = (!tool_schema_hints.is_empty()).then_some(tool_schema_hints);
    let hosted_web_search_name =
        transform_responses::anthropic_web_search_tool_name(original_body).map(ToString::to_string);
    let hosted_web_search_max_uses =
        transform_responses::anthropic_web_search_max_uses(original_body);

    if use_streaming {
        // 根据 api_format 选择流式转换器
        let stream = response.bytes_stream();
        let sse_stream: Box<
            dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send + Unpin,
        > = if api_format == "openai_responses" {
            if hosted_web_search_name.is_none() && hosted_web_search_max_uses.is_none() {
                Box::new(Box::pin(create_anthropic_sse_stream_from_responses(stream)))
            } else {
                Box::new(Box::pin(
                    create_anthropic_sse_stream_from_responses_with_web_search_options(
                        stream,
                        hosted_web_search_name.clone(),
                        hosted_web_search_max_uses,
                    ),
                ))
            }
        } else if api_format == "gemini_native" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_gemini(
                stream,
                Some(state.gemini_shadow.clone()),
                Some(ctx.provider.id.clone()),
                Some(ctx.session_id.clone()),
                tool_schema_hints.clone(),
            )))
        } else {
            Box::new(Box::pin(create_anthropic_sse_stream(stream)))
        };

        // 创建使用量收集器
        let usage_collector = {
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = ctx.request_model.clone();
            let status_code = status.as_u16();
            let start_time = ctx.start_time;

            SseUsageCollector::new(
                start_time,
                CLAUDE_PARSER_CONFIG.stream_event_filter,
                move |events, first_token_ms| {
                    if let Some(usage) = TokenUsage::from_claude_stream_events(&events) {
                        let latency_ms = start_time.elapsed().as_millis() as u64;
                        let state = state.clone();
                        let provider_id = provider_id.clone();
                        let model = model.clone();

                        tokio::spawn(async move {
                            log_usage(
                                &state,
                                &provider_id,
                                "claude",
                                &model,
                                &model,
                                usage,
                                latency_ms,
                                first_token_ms,
                                true,
                                status_code,
                            )
                            .await;
                        });
                    } else {
                        log::debug!("[Claude] OpenRouter 流式响应缺少 usage 统计，跳过消费记录");
                    }
                },
            )
        };

        // 获取流式超时配置
        let timeout_config = ctx.streaming_timeout_config();

        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            "Claude/OpenRouter",
            Some(usage_collector),
            timeout_config,
        );

        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "Content-Type",
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            "Cache-Control",
            axum::http::HeaderValue::from_static("no-cache"),
        );
        headers.insert(
            "Connection",
            axum::http::HeaderValue::from_static("keep-alive"),
        );

        let body = axum::body::Body::from_stream(logged_stream);
        return Ok((headers, body).into_response());
    }

    // 非流式响应转换 (OpenAI/Responses → Anthropic)
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, _status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    let body_str = String::from_utf8_lossy(&body_bytes);

    let upstream_response: Value = if aggregate_responses_sse {
        responses_sse_to_response_value(&body_str)?
    } else {
        match serde_json::from_slice(&body_bytes) {
            Ok(value) => value,
            // 部分网关对 stream:false 强制返回 SSE，Content-Type 也可能错标。
            // 按内容嗅探并聚合为 JSON，保持客户端请求的非流语义。
            // gemini_native 暂无聚合器，按解析失败处理。
            Err(_) if body_looks_like_sse(&body_str) && api_format != "gemini_native" => {
                log::warn!(
                    "[Claude] 上游对非流请求返回 SSE 体（api_format={api_format}），聚合为 JSON"
                );
                if api_format == "openai_responses" {
                    responses_sse_to_response_value(&body_str)?
                } else {
                    chat_sse_to_response_value(&body_str)?
                }
            }
            Err(e) => {
                log::error!(
                    "[Claude] 解析上游响应失败: {e}, body_bytes={}",
                    body_bytes.len()
                );
                return Err(ProxyError::TransformError(format!(
                    "Failed to parse upstream response: {e}"
                )));
            }
        }
    };

    // 根据 api_format 选择非流式转换器
    let anthropic_response = if api_format == "openai_responses" {
        transform_responses::responses_to_anthropic_with_web_search_options(
            upstream_response,
            hosted_web_search_name.as_deref(),
            hosted_web_search_max_uses,
        )
    } else if api_format == "gemini_native" {
        transform_gemini::gemini_to_anthropic_with_shadow_and_hints(
            upstream_response,
            Some(state.gemini_shadow.as_ref()),
            Some(&ctx.provider.id),
            Some(&ctx.session_id),
            tool_schema_hints.as_ref(),
        )
    } else {
        transform::openai_to_anthropic(upstream_response)
    }
    .map_err(|e| {
        log::error!("[Claude] 转换响应失败: {e}");
        e
    })?;

    // 记录使用量
    if let Some(usage) = TokenUsage::from_claude_response(&anthropic_response) {
        let model = anthropic_response
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        let latency_ms = ctx.latency_ms();

        let request_model = ctx.request_model.clone();
        tokio::spawn({
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = model.to_string();
            async move {
                log_usage(
                    &state,
                    &provider_id,
                    "claude",
                    &model,
                    &request_model,
                    usage,
                    latency_ms,
                    None,
                    false,
                    status.as_u16(),
                )
                .await;
            }
        });
    }

    // 构建响应
    let mut builder = axum::response::Response::builder().status(status);
    strip_entity_headers_for_rebuilt_body(&mut response_headers);

    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }

    builder = builder.header("content-type", "application/json");

    let response_body = serde_json::to_vec(&anthropic_response).map_err(|e| {
        log::error!("[Claude] 序列化响应失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize response: {e}"))
    })?;

    let body = axum::body::Body::from(response_body);
    builder.body(body).map_err(|e| {
        log::error!("[Claude] 构建响应失败: {e}");
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
}

/// 客户端要流式才走流式转换；Chat/Responses 上游对非流请求强制返回 SSE 时聚合成 JSON
/// （Claude 的模型验证要求非流式 JSON），其余格式上游是 SSE 时仍按流式转换。
fn should_use_claude_transform_streaming(
    requested_streaming: bool,
    upstream_is_sse: bool,
    api_format: &str,
) -> bool {
    requested_streaming
        || (upstream_is_sse && !matches!(api_format, "openai_chat" | "openai_responses"))
}

/// 把 OpenAI Responses SSE 流聚合成一个完整的 Responses JSON 对象，供下游转成 Anthropic
/// 非流响应。用于上游把 `stream:false` 强制升级为 SSE 的场景。
///
/// 复用 `proxy::sse` 的 `SseBlocks`/`strip_sse_field`：`SseBlocks` 支持
/// `\n\n`、`\r\n\r\n`、`\n\r\n` 和 `\r\n\n` 四种分隔符；
/// `strip_sse_field` 兼容带/不带空格的字段写法。
fn responses_sse_to_response_value(body: &str) -> Result<Value, ProxyError> {
    let mut sse_blocks = SseBlocks::new(body.trim_start_matches('\u{feff}'));
    let mut completed_response: Option<Value> = None;
    let mut output_items = Vec::new();

    // strict=false 用于残余尾块：截断的半截 JSON 忽略而非报错，避免破坏
    // 已聚合好的完整响应（codex_oauth 聚合路径也复用本函数）
    let mut process_block = |block: &str, strict: bool| -> Result<(), ProxyError> {
        // 残余尾块（strict=false）在已拿到 completed 后整体跳过——codex_oauth 聚合
        // 路径也复用本函数，已完成后再执行残余里的完整 response.failed/杂事件会把
        // 成功响应翻成 422（C8）。
        if !strict && completed_response.is_some() {
            return Ok(());
        }
        let mut event_name = "";
        let mut data_lines: Vec<&str> = Vec::new();

        for line in block.lines() {
            let line = line.trim_start();
            if let Some(evt) = strip_sse_field(line, "event") {
                event_name = evt.trim();
            } else if let Some(d) = strip_sse_field(line, "data") {
                data_lines.push(d);
            }
        }

        if data_lines.is_empty() {
            return Ok(());
        }

        let data_str = data_lines.join("\n");
        if data_str.trim() == "[DONE]" {
            return Ok(());
        }

        let data: Value = match serde_json::from_str(&data_str) {
            Ok(v) => v,
            Err(_) if !strict => return Ok(()),
            Err(e) => {
                return Err(ProxyError::TransformError(format!(
                    "Failed to parse upstream SSE event: {e}"
                )))
            }
        };

        // Compatible gateways may identify events only through the JSON payload.
        let event_name = if event_name.is_empty() {
            data.get("type").and_then(Value::as_str).unwrap_or("")
        } else {
            event_name
        };

        match event_name {
            "response.output_item.done" => {
                if let Some(item) = data.get("item") {
                    output_items.push(item.clone());
                }
            }
            "response.completed" | "response.incomplete" => {
                completed_response = Some(data.get("response").cloned().unwrap_or(data));
            }
            "response.failed" => {
                let message = data
                    .pointer("/response/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("response.failed event received");
                return Err(ProxyError::TransformError(message.to_string()));
            }
            _ => {}
        }
        Ok(())
    };

    for block in sse_blocks.by_ref() {
        process_block(block, true)?;
    }
    // 最后一个事件后可能没有空行分隔（错标 SSE 兜底/非规范上游常见）：
    // 残余 buffer 当最后一块处理，否则尾部的 response.completed 会被丢掉。
    // 已完成时的跳过判定在闭包内（C8）。
    process_block(sse_blocks.remainder(), false)?;

    let mut response = completed_response.ok_or_else(|| {
        ProxyError::TransformError(
            "No response.completed or response.incomplete event in upstream SSE".to_string(),
        )
    })?;

    if !output_items.is_empty() {
        if let Some(obj) = response.as_object_mut() {
            obj.insert("output".to_string(), Value::Array(output_items));
        } else {
            return Err(ProxyError::TransformError(
                "Terminal Responses SSE payload is not an object".to_string(),
            ));
        }
    }

    Ok(response)
}

/// 判断响应体是否"看起来像" SSE 文本（#2234 兜底嗅探）。
///
/// 仅在 JSON 解析已失败后调用：合法 JSON 不可能以这些前缀开头，误判面为零。
/// 覆盖 SSE 规范的全部四种字段行；包含 ":" 是因为 OpenRouter 等会在流前发
/// `: PROCESSING` 注释行。
fn body_looks_like_sse(body: &str) -> bool {
    let trimmed = body.trim_start_matches('\u{feff}').trim_start();
    ["data:", "event:", "id:", "retry:", ":"]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
}

/// 从 SSE chunk 的 error 字段提取可报告的错误消息。占位形状（空对象、空消息、
/// false、空字符串等，常见于 OpenAI 兼容网关每 chunk 附带的 error 字段）返回
/// None——不应据此判定整条流失败（否则会把成功流误杀成 422，C12/C2234 目标人群）。
fn error_event_message(error: &Value) -> Option<String> {
    if let Some(msg) = error.get("message").and_then(|m| m.as_str()) {
        return (!msg.is_empty()).then(|| msg.to_string());
    }
    if let Some(s) = error.as_str() {
        return (!s.is_empty()).then(|| s.to_string());
    }
    None
}

/// 解析单个 SSE 块的 event 名与 data 负载（多行 data 按规范以 \n 连接）。
/// 行首允许前导空白后再匹配字段名——与 body_looks_like_sse 的 trim 宽容度对齐，
/// 否则缩进的 `  data:` 行被嗅探接受却在此静默丢失（C4）。返回 None 表示无 data 行。
fn sse_block_parts(block: &str) -> Option<(String, String)> {
    let mut event_name = String::new();
    let mut data_lines: Vec<&str> = Vec::new();
    for line in block.lines() {
        let line = line.trim_start();
        if let Some(evt) = strip_sse_field(line, "event") {
            event_name = evt.trim().to_string();
        } else if let Some(d) = strip_sse_field(line, "data") {
            data_lines.push(d);
        }
    }
    (!data_lines.is_empty()).then(|| (event_name, data_lines.join("\n")))
}

/// 把 Chat Completions 流式 SSE 聚合为单个 chat.completion JSON（#2234 兜底）。
///
/// 专供非流式分支使用：上游对 stream:false 返回了 SSE 体但 Content-Type 没标
/// text/event-stream，header 检查（is_sse）失效。聚合后喂给既有非流转换器
/// （Claude 侧 openai_to_anthropic、Codex 侧 chat_completion_to_response_with_context），
/// 客户端拿到的仍是合法 JSON，非流语义不变。
/// 增量合并语义与 providers/streaming.rs 对齐：tool_calls 按 delta.index 定位，
/// id/name 出现即覆盖、arguments 字符串拼接；reasoning 各形态（reasoning_content /
/// reasoning / reasoning_details）经 codex_chat_common 公共提取器并入同一累加器；
/// finish_reason 首个非 null 即锁定（kimi-k2.6 会在 tool_use 后再发带
/// finish_reason 的尾块，见 streaming.rs）。
fn chat_sse_to_response_value(body: &str) -> Result<Value, ProxyError> {
    // 剥 BOM：嗅探器接受 BOM 开头，但 strip_sse_field 按行首精确匹配，
    // 不剥会让首个 data 行静默丢失
    let mut sse_blocks = SseBlocks::new(body.trim_start_matches('\u{feff}'));

    let mut id = Value::Null;
    let mut created = Value::Null;
    let mut model = Value::Null;
    let mut content = String::new();
    let mut reasoning_content = String::new();
    // tool_calls 以 BTreeMap 按 index 聚合：上游可控的 index（u64）不会 densify
    // 数组——旧的 `while len() <= index { push }` 写法遇到 index=4e9 会 OOM 整个
    // 进程（C1）。BTreeMap 既免去无界分配，又天然保持 index 有序输出。
    let mut tool_calls: std::collections::BTreeMap<usize, Value> =
        std::collections::BTreeMap::new();
    let mut finish_reason = Value::Null;
    let mut usage = Value::Null;
    let mut saw_choice = false;
    let mut saw_done = false;

    // strict=false 用于残余尾块：截断的半截 JSON 忽略而非报错，与
    // responses_sse_to_response_value 的残余处理对称（C2），否则一个被掐断的
    // 尾块会把已聚合完整的响应误杀成 422。
    let mut process_event =
        |event_name: &str, data_str: &str, strict: bool| -> Result<(), ProxyError> {
            let trimmed = data_str.trim();
            if trimmed == "[DONE]" {
                saw_done = true;
                return Ok(());
            }
            if trimmed.is_empty() {
                return Ok(());
            }
            let chunk: Value = match serde_json::from_str(data_str) {
                Ok(v) => v,
                Err(_) if !strict => return Ok(()),
                Err(e) => {
                    return Err(ProxyError::TransformError(format!(
                        "Failed to parse upstream SSE chunk: {e}"
                    )))
                }
            };

            // `event: error` 事件：错误由事件名标记，data 体未必有 error 键（直接是
            // 错误对象）。即便此前已聚合完整 choice 也要据此判失败，否则会把网关的
            // 配额/限流错误伪装成成功（C18）。
            if event_name.eq_ignore_ascii_case("error") {
                let message = chunk
                    .get("error")
                    .and_then(error_event_message)
                    .or_else(|| error_event_message(&chunk))
                    .unwrap_or_else(|| "upstream error event in SSE stream".to_string());
                return Err(ProxyError::TransformError(message));
            }
            // 网关把错误作为普通 data chunk 下发（{"error":{...}}）：仅在 error 含
            // 可报告消息时判失败。空对象 / 空消息 / null / false 等占位形状（部分
            // OpenAI 兼容网关每 chunk 都带）不能据此误杀成功流（C12）。
            if let Some(message) = chunk
                .get("error")
                .filter(|e| !e.is_null())
                .and_then(error_event_message)
            {
                return Err(ProxyError::TransformError(message));
            }

            // 首个"有意义"的值锁定 envelope。Azure 的 content-filter 前置块带
            // ""/0 占位（streaming.rs 有同款空串守卫），不能让占位值冻结字段
            for (slot, key) in [
                (&mut id, "id"),
                (&mut created, "created"),
                (&mut model, "model"),
            ] {
                if slot.is_null() {
                    if let Some(v) = chunk.get(key).filter(|v| envelope_value_meaningful(v)) {
                        *slot = v.clone();
                    }
                }
            }
            // OpenAI 语义：usage 只在最终 chunk 非 null
            if let Some(u) = chunk.get("usage").filter(|u| !u.is_null()) {
                usage = u.clone();
            }

            // 代理上下文只存在单选择（n=1），仅聚合 index==0 的 choice
            let Some(choice) = chunk
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|ch| ch.get("index").and_then(|i| i.as_u64()).unwrap_or(0) == 0)
                })
            else {
                return Ok(());
            };

            // "见过响应"的证据必须是 choice payload：metadata/usage-only chunk +
            // [DONE] 的流（全程无 choice）若也算数，会绕过下方两道守卫、
            // 包装出空内容假成功
            saw_choice = true;

            // finish_reason 首个非 null 即锁定（对齐 streaming.rs 的 first-wins：
            // 多 finish_reason 上游的尾块 "stop" 不能覆盖先到的 "tool_calls"）
            if finish_reason.is_null() {
                if let Some(fr) = choice.get("finish_reason").filter(|v| !v.is_null()) {
                    finish_reason = fr.clone();
                }
            }
            // payload 选择：正常增量走 delta；但假流式中转会把完整 chat.completion
            // 包成单事件（message 而非 delta），有的还附带空 delta:{}。delta 为空对象
            // 且存在 message 时改用 message 快照（覆盖此前累计的增量，防混合形态双计），
            // 否则内容被静默丢弃、完成性守卫又被其 finish_reason 击穿 → 空内容假成功（C3）。
            let delta_nonempty = choice
                .get("delta")
                .and_then(|d| d.as_object())
                .is_some_and(|o| !o.is_empty());
            let (payload, is_full_message) = if delta_nonempty {
                (choice.get("delta").unwrap(), false)
            } else if let Some(message) = choice.get("message") {
                (message, true)
            } else if let Some(delta) = choice.get("delta") {
                // 空 delta 且无 message：正常的纯 finish_reason 收尾块
                (delta, false)
            } else {
                return Ok(());
            };
            if is_full_message {
                content.clear();
                reasoning_content.clear();
                tool_calls.clear();
            }
            match payload.get("content") {
                Some(Value::String(text)) => content.push_str(text),
                Some(Value::Array(parts)) => {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            content.push_str(text);
                        } else if let Some(refusal) = part.get("refusal").and_then(|r| r.as_str()) {
                            content.push_str(refusal);
                        }
                    }
                }
                _ => {}
            }
            // refusal：OpenAI 官方拒绝形态（delta.refusal / message.refusal 字符串）。
            // 两个下游转换器都把 refusal 当可见内容，漏读会让拒绝响应变空消息假成功（C15）。
            if let Some(refusal) = payload.get("refusal").and_then(|r| r.as_str()) {
                content.push_str(refusal);
            }
            // reasoning 字段穷举提取直接复用 codex_chat_common（reasoning_content >
            // reasoning 字符串/对象 > reasoning_details），避免第三份手写实现漏档：
            // MiMo/OpenRouter 等只发 reasoning_details 的 provider 否则会丢思考内容
            if let Some(text) = extract_reasoning_field_text(payload) {
                reasoning_content.push_str(&text);
            }
            if let Some(deltas) = payload.get("tool_calls").and_then(|t| t.as_array()) {
                for (pos, tc) in deltas.iter().enumerate() {
                    merge_tool_call_delta(&mut tool_calls, tc, pos);
                }
            } else if let Some(fc) = payload.get("function_call").filter(|v| !v.is_null()) {
                // legacy function_call（2023 弃用但仍有中转回传）→ 当单个 tool_call。
                // 两个下游转换器都支持 function_call，漏读会让 finish_reason
                // "function_call"→stop_reason "tool_use" 却零工具块、卡死 agent 循环（C17）。
                let synthetic = json!({
                    "index": 0,
                    "id": fc.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "type": "function",
                    "function": fc,
                });
                merge_tool_call_delta(&mut tool_calls, &synthetic, 0);
            }
            Ok(())
        };

    for block in sse_blocks.by_ref() {
        if let Some((event, data)) = sse_block_parts(block) {
            process_event(&event, &data, true)?;
        }
    }
    // 最后一个事件后可能没有空行分隔（半截流/非规范上游）：残余 buffer 当最后一块
    // 处理，strict=false 容忍被掐断的尾块（C2）。
    if let Some((event, data)) = sse_block_parts(sse_blocks.remainder()) {
        process_event(&event, &data, false)?;
    }

    if !saw_choice {
        return Err(ProxyError::TransformError(
            "No chat completion choices in upstream SSE".to_string(),
        ));
    }
    // 完成性守卫：close-delimited 响应的中途截断在字节层不可检测，缺少
    // finish_reason 与 [DONE] 两个完成证据时按截断处理，避免把半截内容
    // 包装成"看起来成功"的响应静默返回（比 422 更难诊断的失败形态）。
    if finish_reason.is_null() && !saw_done {
        return Err(ProxyError::TransformError(
            "Upstream SSE stream appears truncated (no finish_reason or [DONE] marker)".to_string(),
        ));
    }

    // tool_calls 终结化：全空壳（index 空洞或未收到任何字段）直接丢弃（避免幽灵
    // tool_use）；缺 id/name 的按原始 index 回填合成值（对齐 streaming.rs 的
    // tool_call_{idx}/unknown_tool）——空 id 会破坏 Claude 的 tool_use_id ↔
    // tool_result 回程
    let tool_calls: Vec<Value> = tool_calls
        .into_iter()
        .filter(|(_, tc)| {
            tc["id"].as_str().is_some_and(|s| !s.is_empty())
                || tc["function"]["name"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
                || tc["function"]["arguments"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
        })
        .map(|(index, mut tc)| {
            if tc["id"].as_str().is_none_or(str::is_empty) {
                tc["id"] = json!(format!("tool_call_{index}"));
            }
            if tc["function"]["name"].as_str().is_none_or(str::is_empty) {
                tc["function"]["name"] = json!("unknown_tool");
            }
            tc
        })
        .collect();

    let mut message = serde_json::Map::new();
    message.insert("role".to_string(), json!("assistant"));
    message.insert("content".to_string(), json!(content));
    if !reasoning_content.is_empty() {
        message.insert("reasoning_content".to_string(), json!(reasoning_content));
    }
    if !tool_calls.is_empty() {
        message.insert("tool_calls".to_string(), Value::Array(tool_calls));
    }

    // 上游未回传有效 id 时合成 UUID：留 null/"" 会让下游 dedup_request_id 退化为
    // 常量 "session:" 全局碰撞，INSERT OR REPLACE 静默覆盖前序 usage 行、少计成本（C9）。
    let id = if envelope_value_meaningful(&id) {
        id
    } else {
        json!(uuid::Uuid::new_v4().to_string())
    };

    let mut response = json!({
        "id": id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "message": Value::Object(message),
            "finish_reason": finish_reason,
        }],
    });
    if !usage.is_null() {
        response["usage"] = usage;
    }
    Ok(response)
}

/// envelope 字段是否"有意义"：过滤 null、空串与数值 0（含浮点 0.0——Azure
/// content-filter 前置块的占位值），避免占位值抢先冻结 id/model/created。
fn envelope_value_meaningful(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        _ => true,
    }
}

/// 合并单条 tool_calls 增量到按 index 聚合的 BTreeMap：OpenAI 流式把 id/name 放
/// 首个增量、arguments 分片下发，按 delta.index 定位目标；缺 index 时退到所在数组
/// 中的位置（message 形态的完整 tool_calls 常不带 index，按 0 会互相覆盖）。
fn merge_tool_call_delta(
    tool_calls: &mut std::collections::BTreeMap<usize, Value>,
    delta: &Value,
    fallback_index: usize,
) {
    let index = delta
        .get("index")
        .and_then(|i| i.as_u64())
        .map(|i| i as usize)
        .unwrap_or(fallback_index);
    let target = tool_calls.entry(index).or_insert_with(|| {
        json!({
            "id": "",
            "type": "function",
            "function": {"name": "", "arguments": ""}
        })
    });
    if let Some(v) = delta
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        target["id"] = json!(v);
    }
    if let Some(func) = delta.get("function") {
        if let Some(name) = func
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            target["function"]["name"] = json!(name);
        }
        // arguments：string 直接拼接；object/array 序列化后拼接——非流 message
        // 快照常把 arguments 作对象回传（OpenAI 兼容偏差），只认 string 会丢参数
        // 致工具空输入执行（C16）
        match func.get("arguments") {
            Some(Value::String(args)) => {
                if let Some(existing) = target["function"]["arguments"].as_str() {
                    target["function"]["arguments"] = json!(format!("{existing}{args}"));
                }
            }
            Some(v @ (Value::Object(_) | Value::Array(_))) => {
                let serialized = serde_json::to_string(v).unwrap_or_default();
                if let Some(existing) = target["function"]["arguments"].as_str() {
                    target["function"]["arguments"] = json!(format!("{existing}{serialized}"));
                }
            }
            _ => {}
        }
    }
}

fn endpoint_with_query(uri: &axum::http::Uri, endpoint: &str) -> String {
    match uri.query() {
        Some(query) => format!("{endpoint}?{query}"),
        None => endpoint.to_string(),
    }
}

// ============================================================================
// Codex API 处理器
// ============================================================================

/// 处理 /v1/chat/completions 请求（OpenAI Chat Completions API - Codex CLI）
pub async fn handle_chat_completions(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut body = body;
    let stack = match resolve_stack_target(&state, &AppType::Codex, &mut body) {
        Ok(stack) => stack,
        Err(response) => return Ok(*response),
    };
    let mut ctx = RequestContext::new_with_stack(
        &state,
        &body,
        &headers,
        AppType::Codex,
        "Codex",
        "codex",
        stack,
    )
    .await?;
    let endpoint = endpoint_with_query(&uri, "/chat/completions");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, is_stream, &err.error).await;
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &OPENAI_PARSER_CONFIG, is_stream).await
}

/// Responses 的 WebSocket 握手（GET 升级请求）：本地代理只讲 HTTP/SSE，回 426。Codex 内置
/// 的 openai 默认先连 WebSocket，握手拿到 426 就在本会话里改走 HTTP，其它失败要把重试
/// 用完才回退。
pub async fn handle_responses_websocket() -> (StatusCode, Json<Value>) {
    (
        StatusCode::UPGRADE_REQUIRED,
        Json(json!({
            "error": {
                "type": "invalid_request_error",
                "code": "websocket_not_supported",
                "message": "CC Switch local routing does not support Responses over WebSocket; use HTTP",
            }
        })),
    )
}

/// 处理 /v1/responses 请求（OpenAI Responses API - Codex CLI 透传）
pub async fn handle_responses(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_responses_for_app(state, request, AppType::Codex, "Codex", "codex").await
}

pub async fn handle_grokbuild_responses(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_responses_for_app(
        state,
        request,
        AppType::GrokBuild,
        "Grok Build",
        "grokbuild",
    )
    .await
}

async fn handle_responses_for_app(
    state: ProxyState,
    request: axum::extract::Request,
    app_type: AppType,
    tag: &'static str,
    app_type_str: &'static str,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut body = body;
    let stack = match resolve_stack_target(&state, &app_type, &mut body) {
        Ok(stack) => stack,
        Err(response) => return Ok(*response),
    };
    let mut ctx = RequestContext::new_with_stack(
        &state,
        &body,
        &headers,
        app_type.clone(),
        tag,
        app_type_str,
        stack,
    )
    .await?;
    let endpoint = endpoint_with_query(&uri, "/responses");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let codex_tool_context = transform_codex_chat::build_codex_tool_context_from_request(&body);
    let compaction_request = codex_tool_context.is_compaction_request();
    let namespace_restore_map = transform_codex_responses_namespace::namespace_restore_map(&body);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &app_type,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, is_stream, &err.error).await;
            if app_type == AppType::Codex {
                if let Some(response) = codex_context_overflow_response(
                    &ctx.request_model,
                    &endpoint,
                    &err.error,
                    is_stream,
                ) {
                    return Ok(response);
                }
            }
            return Err(err.error);
        }
    };

    let codex_upstream_format = result.codex_upstream_format;
    ctx.outbound_model = result.outbound_model.take();
    ctx.provider = result.provider;
    let response = result.response;

    // 跟随上游 cc-switch 1c82b8a3：如果该 Codex provider 的真实上游走 OpenAI
    // Chat Completions，把上游回来的 Chat 响应/SSE 翻译回 Responses 格式再返给客户端。
    // 按这次请求实际用的上游格式（托管 Copilot 按模型选），不按静态 apiFormat 推断。
    if codex_upstream_format == Some(CodexUpstreamFormat::ChatCompletions) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    if codex_upstream_format == Some(CodexUpstreamFormat::Anthropic) {
        return handle_codex_anthropic_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    if compaction_request
        && matches!(app_type, AppType::Codex)
        && !super::providers::is_codex_official_provider(&ctx.provider)
    {
        return handle_codex_native_compaction_response(response, &ctx, &state).await;
    }
    // 原生 Responses 直连严格网关（xAI）：还原展开的 function-call 名称，并改写
    // 整数值浮点工具参数；后者在请求没有 namespace 工具时同样需要执行。
    if super::providers::provider_needs_responses_namespace_flatten(
        &ctx.provider,
        ctx.outbound_model.as_deref(),
    ) {
        return handle_codex_xai_native_responses_rewrite(
            response,
            &ctx,
            &state,
            namespace_restore_map,
        )
        .await;
    }

    if super::providers::provider_needs_responses_late_arguments_repair(&ctx.provider) {
        return handle_codex_late_arguments_repair(response, &ctx, &state, is_stream).await;
    }

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG, is_stream).await
}

/// 处理 /v1/responses/compact 请求（OpenAI Responses Compact API - Codex CLI 透传）
pub async fn handle_responses_compact(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_responses_compact_for_app(state, request, AppType::Codex, "Codex", "codex").await
}

/// Codex 独立 Alpha Search 协议透传。
///
/// 该请求不能转换为 Chat Completions 或 Anthropic Messages，因此只复用
/// Provider 选择、模型映射、认证、故障转移和用量日志链路。
pub async fn handle_alpha_search(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_codex_standalone_passthrough(state, request, "/alpha/search").await
}

/// Handle Codex's legacy Images API endpoint for built-in ImageGen.
pub async fn handle_images_generations(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_codex_standalone_passthrough(state, request, "/images/generations").await
}

/// Codex 内置 ImageGen 的 Images API 编辑端点。
///
/// ImageGen 引用已有图片（显式文件路径或最近生成的 N 张）时改走 `/images/edits`，
/// 请求体同样是带 data-URL 图片的普通 JSON，因此复用独立透传链路，仅上游路径不同。
pub async fn handle_images_edits(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_codex_standalone_passthrough(state, request, "/images/edits").await
}

async fn handle_codex_standalone_passthrough(
    state: ProxyState,
    request: axum::extract::Request,
    canonical_endpoint: &'static str,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::InvalidRequest(format!("Failed to parse request body: {e}")))?;

    let mut body = body;
    let stack = match resolve_stack_target(&state, &AppType::Codex, &mut body) {
        Ok(stack) => stack,
        Err(response) => return Ok(*response),
    };
    let mut ctx = RequestContext::new_with_stack(
        &state,
        &body,
        &headers,
        AppType::Codex,
        "Codex",
        "codex",
        stack,
    )
    .await?;
    let endpoint = endpoint_with_query(&uri, canonical_endpoint);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, false, &err.error).await;
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    process_response(result.response, &ctx, &state, &CODEX_PARSER_CONFIG, false).await
}

pub async fn handle_grokbuild_responses_compact(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_responses_compact_for_app(
        state,
        request,
        AppType::GrokBuild,
        "Grok Build",
        "grokbuild",
    )
    .await
}

async fn handle_responses_compact_for_app(
    state: ProxyState,
    request: axum::extract::Request,
    app_type: AppType,
    tag: &'static str,
    app_type_str: &'static str,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut body = body;
    let stack = match resolve_stack_target(&state, &app_type, &mut body) {
        Ok(stack) => stack,
        Err(response) => return Ok(*response),
    };
    let mut ctx = RequestContext::new_with_stack(
        &state,
        &body,
        &headers,
        app_type.clone(),
        tag,
        app_type_str,
        stack,
    )
    .await?;
    let endpoint = endpoint_with_query(&uri, "/responses/compact");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let codex_tool_context = transform_codex_chat::build_codex_tool_context_from_request(&body);
    let namespace_restore_map = transform_codex_responses_namespace::namespace_restore_map(&body);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &app_type,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, is_stream, &err.error).await;
            return Err(err.error);
        }
    };

    let codex_upstream_format = result.codex_upstream_format;
    ctx.outbound_model = result.outbound_model.take();
    ctx.provider = result.provider;
    let response = result.response;

    if codex_upstream_format == Some(CodexUpstreamFormat::ChatCompletions) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    if codex_upstream_format == Some(CodexUpstreamFormat::Anthropic) {
        return handle_codex_anthropic_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    // 原生 Responses 直连严格网关（xAI）：还原展开的 function-call 名称，并改写
    // 整数值浮点工具参数；后者在请求没有 namespace 工具时同样需要执行。
    if super::providers::provider_needs_responses_namespace_flatten(
        &ctx.provider,
        ctx.outbound_model.as_deref(),
    ) {
        return handle_codex_xai_native_responses_rewrite(
            response,
            &ctx,
            &state,
            namespace_restore_map,
        )
        .await;
    }

    if super::providers::provider_needs_responses_late_arguments_repair(&ctx.provider) {
        return handle_codex_late_arguments_repair(response, &ctx, &state, is_stream).await;
    }

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG, is_stream).await
}

/// Copilot 原生 Responses 流会给同一 output_index 换不同 item ID，Codex 会把流式文本和
/// 完成项当成两条消息；只对 Copilot 卡按 output_index 固定首个 ID（见 #7977）。
fn codex_native_responses_stream(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
) -> std::pin::Pin<Box<dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send>> {
    let stream = response.bytes_stream();
    if ctx.app_type_str == "codex"
        && ctx
            .provider
            .meta
            .as_ref()
            .and_then(|meta| meta.provider_type.as_deref())
            == Some("github_copilot")
    {
        Box::pin(super::providers::copilot_responses::create_stable_item_id_stream(stream))
    } else {
        Box::pin(stream)
    }
}

async fn handle_codex_native_compaction_response(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    // 错误体和非流式响应照常透传：Codex 的压缩请求总是流式，错误交给它按原样重试。
    if !status.is_success() || !response.is_sse() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG, false).await;
    }

    let mut headers = response.headers().clone();
    strip_entity_headers_for_rebuilt_body(&mut headers);
    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in &headers {
        builder = builder.header(key, value);
    }
    let builder = builder.header(axum::http::header::CONTENT_TYPE, "text/event-stream");

    let compaction_stream = super::providers::codex_compaction::create_native_compaction_sse_stream(
        codex_native_responses_stream(response, ctx),
    );
    let usage_collector = create_usage_collector(ctx, state, status.as_u16(), &CODEX_PARSER_CONFIG);
    let logged_stream = create_logged_passthrough_stream(
        compaction_stream,
        ctx.tag,
        Some(usage_collector),
        ctx.streaming_timeout_config(),
    );

    builder
        .body(axum::body::Body::from_stream(logged_stream))
        .map_err(|e| {
            log::error!("[{}] 构建压缩回合流式响应失败: {e}", ctx.tag);
            ProxyError::Internal(format!("Failed to build streaming response: {e}"))
        })
}

/// Repair empty tool-call end events on native third-party Responses streams.
async fn handle_codex_late_arguments_repair(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    if !status.is_success() || !response.is_sse() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG, is_stream).await;
    }
    let mut headers = response.headers().clone();
    strip_entity_headers_for_rebuilt_body(&mut headers);
    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in &headers {
        builder = builder.header(key, value);
    }
    let stream = super::providers::responses_late_arguments::create_late_arguments_repair_stream(
        codex_native_responses_stream(response, ctx),
    );
    let usage_collector = create_usage_collector(ctx, state, status.as_u16(), &CODEX_PARSER_CONFIG);
    let logged_stream = create_logged_passthrough_stream(
        stream,
        ctx.tag,
        Some(usage_collector),
        ctx.streaming_timeout_config(),
    );
    builder
        .body(axum::body::Body::from_stream(logged_stream))
        .map_err(|e| ProxyError::Internal(format!("Failed to build streaming response: {e}")))
}

/// xAI 原生 Responses（直连或经 Copilot）的响应处理：还原展开的 `function_call` 名称并改写整数值
/// 浮点工具参数；错误响应原样透传，用量统计与 `process_response` 一致。
async fn handle_codex_xai_native_responses_rewrite(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    restore_map: std::collections::HashMap<
        String,
        transform_codex_responses_namespace::NamespacedName,
    >,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    if !status.is_success() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG, false).await;
    }

    if response.is_sse() {
        // 改写后的流长度会变：去掉 content-length 等实体头再转发。
        let mut headers = response.headers().clone();
        strip_entity_headers_for_rebuilt_body(&mut headers);
        let mut builder = axum::response::Response::builder().status(status);
        for (key, value) in &headers {
            builder = builder.header(key, value);
        }

        // Copilot：先固定 item ID，再补迟到的工具参数，最后还原 Grok 工具名；
        // 直连 xAI 保持原有处理链。
        let stream = codex_native_responses_stream(response, ctx);
        let stream: std::pin::Pin<
            Box<dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send>,
        > = if ctx.app_type_str == "codex" && ctx.provider.is_github_copilot() {
            Box::pin(
                super::providers::responses_late_arguments::create_late_arguments_repair_stream(
                    stream,
                ),
            )
        } else {
            stream
        };
        let stream = transform_codex_responses_xai_sanitize::create_xai_native_responses_sse_stream(
            stream,
            restore_map,
        );
        let usage_collector =
            create_usage_collector(ctx, state, status.as_u16(), &CODEX_PARSER_CONFIG);
        let stream = create_logged_passthrough_stream(
            stream,
            ctx.tag,
            Some(usage_collector),
            ctx.streaming_timeout_config(),
        );
        return builder
            .body(axum::body::Body::from_stream(stream))
            .map_err(|e| ProxyError::Internal(format!("Failed to build streaming response: {e}")));
    }

    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut headers, status, body) = read_decoded_body(response, ctx.tag, body_timeout).await?;
    let body = match serde_json::from_slice::<Value>(&body) {
        Ok(mut value) => {
            transform_codex_responses_namespace::restore_response_namespaces(
                &mut value,
                &restore_map,
            );
            transform_codex_responses_xai_sanitize::normalize_xai_function_call_integer_arguments(
                &mut value,
            );
            Bytes::from(serde_json::to_vec(&value).map_err(|e| {
                ProxyError::TransformError(format!("Failed to serialize namespace response: {e}"))
            })?)
        }
        Err(_) => body,
    };
    strip_entity_headers_for_rebuilt_body(&mut headers);
    process_response(
        super::hyper_client::ProxyResponse::buffered(status, headers, body),
        ctx,
        state,
        &CODEX_PARSER_CONFIG,
        false,
    )
    .await
}

// ---------------------------------------------------------------------------
// Codex Chat Completions ↔ Responses 翻译（跟随上游 cc-switch 1c82b8a3 + 79d6486e + 09f67c1b）
//
// 触发条件：Codex provider 配置为 `apiFormat=openai_chat` 或 base_url 直接是
// /chat/completions，并且客户端访问的是 Responses 端点。forwarder 已经在出站
// 时把请求 body 从 Responses 转成 Chat、把 endpoint 改写到 /chat/completions；
// 这里负责把上游回来的 Chat 响应（JSON 或 SSE）再翻译成 Responses 格式给客户端。
//
// 简化点（vs 上游 src-tauri）：
// - 暂不接入 usage 收集（先走透传），待后续在 SseUsageCollector 上补 codex 流
//   事件解析器 + 非流式 TokenUsage 记录
// - 没有 ActiveConnectionGuard 概念（cc-switch-web 当前 handler 不传 guard）
// ---------------------------------------------------------------------------
/// Codex 只把 `response.failed` 流里的上下文超限当成要压缩的信号：光是 HTTP 400，即使错误码
/// 对，在它看来也只是无效请求。上游输入超限（HTTP 400，错误体规整后是
/// `context_length_exceeded`，见 [`transform_codex_chat::chat_error_to_response_error`]）时，
/// 流式的 Responses 请求改回一个失败的流，让 Codex 裁掉历史后重试。别的错误、非流式请求和
/// 其他端点照旧透传上游错误。
fn codex_context_overflow_response(
    model: &str,
    endpoint: &str,
    error: &ProxyError,
    is_stream: bool,
) -> Option<axum::response::Response> {
    let ProxyError::UpstreamError {
        status: 400,
        body: Some(body),
    } = error
    else {
        return None;
    };
    if !is_stream
        || !matches!(
            endpoint.split('?').next(),
            Some("/responses" | "/v1/responses")
        )
    {
        return None;
    }
    let parsed = serde_json::from_str::<Value>(body).unwrap_or_else(|_| json!(body));
    let mut normalized = transform_codex_chat::chat_error_to_response_error(Some(&parsed));
    if normalized.pointer("/error/code").and_then(Value::as_str) != Some("context_length_exceeded")
    {
        return None;
    }
    normalized["error"]["upstream_status"] = json!(400);
    let response = json!({
        "id": format!("resp_{}", uuid::Uuid::new_v4().simple()),
        "object": "response",
        "created_at": chrono::Utc::now().timestamp(),
        "status": "failed",
        "model": model,
        "output": [],
        "error": normalized["error"],
    });
    Some(
        (
            StatusCode::OK,
            [
                (axum::http::header::CONTENT_TYPE, "text/event-stream"),
                (axum::http::header::CACHE_CONTROL, "no-cache"),
            ],
            super::providers::codex_responses_sse::response_failed(&response),
        )
            .into_response(),
    )
}

async fn handle_codex_chat_to_responses_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
    codex_tool_context: transform_codex_chat::CodexToolContext,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();

    // 失败响应原样透传（让客户端看到真实上游错误）
    if !status.is_success() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG, false).await;
    }

    if is_stream || response.is_sse() {
        let stream = response.bytes_stream();
        let sse_stream =
            create_responses_sse_stream_from_chat_with_context(stream, codex_tool_context);

        let usage_collector = Some(create_usage_collector(
            ctx,
            state,
            status.as_u16(),
            &CODEX_PARSER_CONFIG,
        ));

        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            usage_collector,
            ctx.streaming_timeout_config(),
        );

        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "Content-Type",
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            "Cache-Control",
            axum::http::HeaderValue::from_static("no-cache"),
        );

        let body = axum::body::Body::from_stream(logged_stream);
        return Ok((headers, body).into_response());
    }

    // 非流式：读 body → 解析 Chat JSON → 转 Responses JSON → 返回
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);
    let chat_response: Value = serde_json::from_slice(&body_bytes).map_err(|e| {
        log::error!("[Codex] 解析 Chat 上游响应失败: {e}, body: {body_str}");
        ProxyError::TransformError(format!("Failed to parse upstream chat response: {e}"))
    })?;
    let responses_response = transform_codex_chat::chat_completion_to_response_with_context(
        chat_response,
        &codex_tool_context,
    )
    .map_err(|e| {
        log::error!("[Codex] Chat → Responses 响应转换失败: {e}");
        e
    })?;

    strip_entity_headers_for_rebuilt_body(&mut response_headers);

    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }
    builder = builder.header("content-type", "application/json");

    let response_body = serde_json::to_vec(&responses_response).map_err(|e| {
        log::error!("[Codex] 序列化 Responses 响应失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize responses response: {e}"))
    })?;

    builder
        .body(axum::body::Body::from(response_body))
        .map_err(|e| {
            log::error!("[Codex] 构建 Responses 响应失败: {e}");
            ProxyError::Internal(format!("Failed to build response: {e}"))
        })
}

async fn handle_codex_anthropic_to_responses_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
    codex_tool_context: transform_codex_chat::CodexToolContext,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    if !status.is_success() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG, false).await;
    }

    if response.is_sse() || (is_stream && !response.is_json()) {
        let stream = response.bytes_stream();
        let sse_stream =
            create_responses_sse_stream_from_anthropic_with_context(stream, codex_tool_context);
        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            Some(create_usage_collector(
                ctx,
                state,
                status.as_u16(),
                &CODEX_PARSER_CONFIG,
            )),
            ctx.streaming_timeout_config(),
        );
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-cache"),
        );
        return Ok((headers, axum::body::Body::from_stream(logged_stream)).into_response());
    }

    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;
    let body_text = String::from_utf8_lossy(&body_bytes);
    let anthropic_response: Value = match serde_json::from_slice(&body_bytes) {
        Ok(value) => value,
        Err(_)
            if body_text.lines().any(|line| {
                line.trim_start().starts_with("event:") || line.trim_start().starts_with("data:")
            }) =>
        {
            transform_codex_anthropic::anthropic_sse_to_message_value(&body_text)?
        }
        Err(error) => {
            log::error!(
                "[Codex] 解析 Anthropic 上游响应失败: {error}, body_bytes={}",
                body_bytes.len()
            );
            return Err(ProxyError::TransformError(format!(
                "Failed to parse upstream anthropic response: {error}"
            )));
        }
    };

    if is_stream {
        let events =
            responses_sse_events_from_anthropic_message(&anthropic_response, codex_tool_context);
        let sse_stream = futures::stream::iter(events.into_iter().map(Ok::<Bytes, std::io::Error>));
        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            Some(create_usage_collector(
                ctx,
                state,
                status.as_u16(),
                &CODEX_PARSER_CONFIG,
            )),
            ctx.streaming_timeout_config(),
        );
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-cache"),
        );
        return Ok((headers, axum::body::Body::from_stream(logged_stream)).into_response());
    }

    let responses_response =
        transform_codex_anthropic::anthropic_response_to_responses_with_context(
            anthropic_response,
            &codex_tool_context,
        )?;
    strip_entity_headers_for_rebuilt_body(&mut response_headers);

    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }
    builder
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&responses_response).map_err(|error| {
                ProxyError::TransformError(format!(
                    "Failed to serialize responses response: {error}"
                ))
            })?,
        ))
        .map_err(|error| ProxyError::Internal(format!("Failed to build response: {error}")))
}

// ============================================================================
// Gemini API 处理器
// ============================================================================

/// 处理 Gemini API 请求（透传，包括查询参数）
pub async fn handle_gemini(
    State(state): State<ProxyState>,
    uri: axum::http::Uri,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    // Gemini 的模型名称在 URI 中
    let mut ctx = RequestContext::new(&state, &body, &headers, AppType::Gemini, "Gemini", "gemini")
        .await?
        .with_model_from_uri(&uri);

    // 提取完整的路径和查询参数
    let endpoint = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(uri.path());

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Gemini,
            endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            ctx.outbound_model = err.outbound_model.take();
            log_forward_error(&state, &ctx, is_stream, &err.error).await;
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &GEMINI_PARSER_CONFIG, is_stream).await
}

// ============================================================================
// 使用量记录（保留用于 Claude 转换逻辑）
// ============================================================================

async fn log_forward_error(
    state: &ProxyState,
    ctx: &RequestContext,
    is_streaming: bool,
    error: &ProxyError,
) {
    use super::usage::logger::UsageLogger;

    let status_code = map_proxy_error_to_status(error);
    let error_message = get_error_message(error);
    let request_id = uuid::Uuid::new_v4().to_string();

    // #7818：错误行的写入同样要拿 Database 的阻塞锁并做磁盘 IO，
    // 移到阻塞线程池执行，避免卡住 tokio worker。
    let db = state.db.clone();
    let provider_id = ctx.provider.id.clone();
    let app_type = ctx.app_type_str.to_string();
    let request_model = ctx.request_model.clone();
    // 记实际发往上游的模型名（与成功行同口径），映射前就失败的回落到请求名。
    let model = ctx
        .outbound_model
        .clone()
        .unwrap_or_else(|| request_model.clone());
    let session_id = ctx.session_id.clone();
    let latency_ms = ctx.latency_ms();
    let write = tokio::task::spawn_blocking(move || {
        UsageLogger::new(&db).log_error_with_context(
            request_id,
            provider_id,
            app_type,
            model,
            request_model,
            status_code,
            error_message,
            latency_ms,
            is_streaming,
            Some(session_id),
            None,
        )
    });
    if let Err(e) = write.await.unwrap_or_else(|e| {
        Err(crate::error::AppError::Database(format!(
            "usage 记录任务失败: {e}"
        )))
    }) {
        log::warn!("记录失败请求日志失败: {e}");
    }
}

/// 记录请求使用量
#[allow(clippy::too_many_arguments)]
async fn log_usage(
    state: &ProxyState,
    provider_id: &str,
    app_type: &str,
    model: &str,
    request_model: &str,
    usage: TokenUsage,
    latency_ms: u64,
    first_token_ms: Option<u64>,
    is_streaming: bool,
    status_code: u16,
) {
    use super::usage::logger::UsageLogger;

    let dedup_scope = super::usage::parser::dedup_scope_for_app(app_type, provider_id);
    let request_id = usage.dedup_request_id(dedup_scope);

    // #7818：使用量写入要拿 Database 的单把 std::sync::Mutex<Connection> 并做磁盘 IO，
    // 移到阻塞线程池执行；计费模式读取走同一把锁，一并移入。
    let db = state.db.clone();
    let provider_id = provider_id.to_string();
    let app_type = app_type.to_string();
    let model = model.to_string();
    let request_model = request_model.to_string();
    let runtime = tokio::runtime::Handle::current();
    let write = tokio::task::spawn_blocking(move || {
        let logger = UsageLogger::new(&db);
        let pricing_model_source = runtime.block_on(logger.resolve_pricing_config(&app_type));
        let pricing_model = if pricing_model_source == "request" {
            request_model.clone()
        } else {
            model.clone()
        };
        logger.log_with_calculation(
            request_id,
            provider_id,
            app_type,
            model,
            request_model,
            pricing_model,
            usage,
            latency_ms,
            first_token_ms,
            status_code,
            None,
            None, // provider_type
            is_streaming,
        )
    });
    if let Err(e) = write.await.unwrap_or_else(|e| {
        Err(crate::error::AppError::Database(format!(
            "usage 记录任务失败: {e}"
        )))
    }) {
        log::warn!("[USG-001] 记录使用量失败: {e}");
    }
}

pub async fn handle_models(
    State(state): State<ProxyState>,
    uri: axum::http::Uri,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, ProxyError> {
    if is_claude_model_discovery(&uri, &headers) {
        return Ok(Json(claude_model_discovery(&state)));
    }
    let config_dir = crate::codex_config::get_codex_config_dir();
    let active_catalog_path = match crate::codex_config::read_codex_config_text() {
        Ok(config_text) => {
            crate::codex_config::resolve_cc_switch_catalog_path(&config_text, &config_dir)
        }
        Err(_) => None,
    };

    let catalog = if let Some(catalog_path) =
        active_catalog_path.as_ref().filter(|path| path.exists())
    {
        match crate::codex_config::read_codex_model_catalog_text(catalog_path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or(json!({"models": []})),
            Err(error) => {
                log::warn!("[models] 拒绝读取越界或过大的目录文件: {error}");
                json!({"models": []})
            }
        }
    } else {
        if active_catalog_path.is_none() {
            log::debug!(
                "[models] stale guard: catalog not served (model_catalog_json not set to cc-switch catalog)"
            );
        }
        json!({"models": []})
    };
    Ok(Json(catalog))
}

// ============================================================================
// Stack 模型
// ============================================================================

/// Claude Code 的模型发现请求：`GET /v1/models?limit=1000`，经 Anthropic SDK 发出，带
/// `anthropic-version`。Codex 取目录时两者都没有（它带的是 `client_version`）。
fn is_claude_model_discovery(uri: &axum::http::Uri, headers: &axum::http::HeaderMap) -> bool {
    if headers.contains_key("anthropic-version") {
        return true;
    }
    let query = uri.query().unwrap_or_default();
    let has = |name: &str| {
        query
            .split('&')
            .any(|pair| pair.split('=').next() == Some(name))
    };
    has("limit") && !has("client_version")
}

/// Claude Code 的 Stack 模型列表（Anthropic 形状）。只读数据库和 `live-state.json`，不做网络
/// 请求：客户端只等 3 秒。不在代理模式、名单为空时返回空列表。
fn claude_model_discovery(state: &ProxyState) -> Value {
    let models = crate::mode::stack::claude_published_now(&state.db).unwrap_or_else(|error| {
        log::warn!("[Claude] 读取 Stack 模型失败，返回空列表: {error}");
        Vec::new()
    });
    let data: Vec<Value> = models
        .into_iter()
        .map(|model| {
            json!({
                "type": "model",
                "id": model.id,
                "display_name": model.display_name,
                "description": model.description,
            })
        })
        .collect();
    json!({
        "data": data,
        "has_more": false,
    })
}

/// Stack 模型（`mode::stack`）：请求带保留前缀的模型 id 时，查出 Stack 里的那一家，把请求体的
/// `model` 换成上游名。解不出来（成员已移除、供应商已删除、key 没登记）就按客户端的协议
/// 直接返回错误，不回落到默认路由。
///
/// 只对 Claude Code 和 Codex 生效：同一个 handler 也服务 Claude Desktop、Grok Build，
/// 它们的模型名不解码。普通模型名不读任何状态，路由请求的路径不变。
///
/// `Err` 是在进入路由之前就拒绝的请求，直接返回给客户端（装箱：`Response` 太大）。
fn resolve_stack_target(
    state: &ProxyState,
    app_type: &AppType,
    body: &mut Value,
) -> Result<Option<crate::mode::stack::StackTarget>, Box<axum::response::Response>> {
    use crate::mode::stack::{self, Decoded, Resolved};

    let Some(model) = body.get("model").and_then(Value::as_str) else {
        return Ok(None);
    };
    if matches!(stack::decode(app_type, model), Decoded::Plain) {
        return Ok(None);
    }
    let model = model.to_string();
    let resolved = stack::resolve(
        &state.db,
        &crate::live::engine::DeviceStore::for_device(),
        app_type,
        &model,
    )
    .map_err(|error| Box::new(ProxyError::DatabaseError(error.to_string()).into_response()))?;
    match resolved {
        Resolved::Plain => Ok(None),
        Resolved::Hit(target) => {
            body["model"] = Value::String(target.upstream_model.clone());
            Ok(Some(*target))
        }
        Resolved::Miss(miss) => {
            let message = miss.message(&model);
            log::warn!("[{}] {message}", app_type.as_str());
            let body = stack_miss_body(app_type, &message);
            Err(Box::new(
                (StatusCode::BAD_REQUEST, Json(body)).into_response(),
            ))
        }
    }
}

/// Stack 模型解不出来时的错误体：Claude Code、Claude Desktop 用 Anthropic 的错误信封，Codex 用
/// OpenAI 的。
fn stack_miss_body(app_type: &AppType, message: &str) -> Value {
    match app_type {
        AppType::Claude | AppType::ClaudeDesktop => json!({
            "type": "error",
            "error": { "type": "invalid_request_error", "message": message },
        }),
        _ => json!({
            "error": {
                "message": message,
                "type": "invalid_request_error",
                "param": "model",
                "code": "model_not_found",
            }
        }),
    }
}

#[cfg(test)]
mod stack_tests {
    //! Stack 模型的入口：解不出来的带前缀 id 按客户端协议报错，不回落到默认路由；
    //! `/v1/models` 按请求方返回各自的形状。
    use super::*;
    use crate::database::Database;
    use std::sync::Arc;

    fn proxy_state() -> ProxyState {
        ProxyState::for_test(Arc::new(Database::memory().expect("memory db")))
    }

    fn post(path: &str, model: &str) -> axum::extract::Request {
        axum::http::Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(
                json!({ "model": model, "messages": [], "input": [] }).to_string(),
            ))
            .unwrap()
    }

    async fn json_of(response: axum::response::Response) -> (StatusCode, Value) {
        let _home = crate::mode::controller::tests::Fixture::new();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    /// 上游输入超限：流式 Responses 请求拿到 `response.failed`，Codex 才会压缩历史后重试
    /// （上游 a94f997f）。非流式、别的端点和别的 400 照旧透传。
    #[tokio::test]
    async fn gemini_http_overflow_reaches_codex_as_a_failed_stream() {
        let model = "ccs-gemini/gemini-3.8-flash-high";
        let error = ProxyError::UpstreamError {
            status: 400,
            body: Some(json!({ "error": {
                "code": 400, "status": "INVALID_ARGUMENT",
                "message": "The input token count exceeds the maximum number of tokens allowed 1048576."
            } }).to_string()),
        };
        for endpoint in ["/responses", "/v1/responses?beta=true"] {
            let response = codex_context_overflow_response(model, endpoint, &error, true).unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["content-type"], "text/event-stream");
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            let sse = String::from_utf8(bytes.to_vec()).unwrap();
            assert!(sse.starts_with("event: response.failed\n"), "{sse}");
            let data = sse
                .lines()
                .find_map(|line| line.strip_prefix("data: "))
                .unwrap();
            let event: Value = serde_json::from_str(data).unwrap();
            assert_eq!(event["type"], "response.failed");
            assert_eq!(event["response"]["status"], "failed");
            assert_eq!(event["response"]["model"], model);
            assert_eq!(
                event["response"]["error"]["code"],
                "context_length_exceeded"
            );
            assert_eq!(event["response"]["error"]["upstream_status"], 400);
            assert!(!sse.contains("response.completed"));
        }
        for (endpoint, stream) in [
            ("/responses", false),
            ("/responses/compact", true),
            ("/chat/completions", true),
        ] {
            assert!(codex_context_overflow_response(model, endpoint, &error, stream).is_none());
        }
        let unrelated = ProxyError::UpstreamError {
            status: 400,
            body: Some(
                json!({ "error": { "code": 400, "message": "Invalid API key" } }).to_string(),
            ),
        };
        assert!(codex_context_overflow_response(model, "/responses", &unrelated, true).is_none());
        // OpenAI 原生的超限错误码同样转成失败的流。
        let native = ProxyError::UpstreamError {
            status: 400,
            body: Some(
                json!({ "error": {
                    "code": "context_length_exceeded",
                    "type": "invalid_request_error",
                    "message": "Your input exceeds the context window of this model."
                } })
                .to_string(),
            ),
        };
        assert!(codex_context_overflow_response(model, "/responses", &native, true).is_some());
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn unresolvable_stacked_ids_are_rejected_in_the_clients_protocol() {
        let _home = crate::mode::controller::tests::Fixture::new();
        // 名单为空、没有任何供应商：回落到默认路由的话会报「没有供应商」，而不是 400。
        let _home = crate::mode::controller::tests::Fixture::new();
        let state = proxy_state();

        let response = handle_messages(
            State(state.clone()),
            post("/v1/messages", "ccs-claude-kimi--kimi-k3"),
        )
        .await
        .expect("response");
        let (status, body) = json_of(response).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["type"], "error");
        assert_eq!(body["error"]["type"], "invalid_request_error");
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("ccs-claude-kimi--kimi-k3"));

        for response in [
            handle_responses(
                State(state.clone()),
                post("/v1/responses", "ccs-kimi/kimi-k3"),
            )
            .await
            .expect("responses"),
            handle_responses_compact(
                State(state.clone()),
                post("/v1/responses/compact", "ccs-kimi/kimi-k3"),
            )
            .await
            .expect("compact"),
            handle_chat_completions(
                State(state.clone()),
                post("/v1/chat/completions", "ccs-kimi/kimi-k3"),
            )
            .await
            .expect("chat"),
        ] {
            let (status, body) = json_of(response).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert_eq!(body["error"]["type"], "invalid_request_error");
            assert_eq!(body["error"]["code"], "model_not_found");
        }

        // 普通模型名照旧走代理路由（这里没有供应商，所以是路由那边的错误）。
        let routed = handle_messages(
            State(state.clone()),
            post("/v1/messages", "claude-sonnet-5"),
        )
        .await;
        assert!(routed.is_err());
        let routed = handle_grokbuild_responses(
            State(state),
            post("/grokbuild/v1/responses", "ccs-kimi/kimi-k3"),
        )
        .await;
        assert!(routed.is_err(), "Grok Build model ids are not decoded");
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn stacked_requests_go_to_one_provider_without_failover_timeouts() {
        let _home = crate::mode::controller::tests::Fixture::new();
        let state = proxy_state();
        // 应用开了故障转移、配了很短的超时，队列里还有别家。
        let mut config = state.db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        config.max_retries = 3;
        config.non_streaming_timeout = 1;
        config.streaming_first_byte_timeout = 1;
        config.streaming_idle_timeout = 1;
        state.db.update_proxy_config_for_app(config).await.unwrap();
        let kimi = crate::provider::Provider::with_id(
            "kimi".to_string(),
            "Kimi".to_string(),
            json!({ "env": { "ANTHROPIC_MODEL": "kimi-k3" } }),
            None,
        );
        let target = crate::mode::stack::StackTarget {
            provider: kimi,
            upstream_model: "kimi-k3".to_string(),
            original_model: "ccs-claude-kimi--kimi-k3".to_string(),
        };
        let body = json!({ "model": "kimi-k3", "messages": [] });

        let ctx = RequestContext::new_with_stack(
            &state,
            &body,
            &axum::http::HeaderMap::new(),
            AppType::Claude,
            "Claude",
            "claude",
            Some(target),
        )
        .await
        .expect("context");

        assert!(ctx.is_stack);
        assert_eq!(
            ctx.get_providers()
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            vec!["kimi"]
        );
        assert_eq!(ctx.request_model, "ccs-claude-kimi--kimi-k3");
        assert!(!ctx.app_config.auto_failover_enabled);
        let streaming = ctx.streaming_timeout_config();
        assert_eq!(
            (streaming.first_byte_timeout, streaming.idle_timeout),
            (0, 0)
        );
    }

    #[test]
    fn claude_model_discovery_is_told_apart_from_the_codex_catalog_probe() {
        let uri = |text: &str| text.parse::<axum::http::Uri>().unwrap();
        let mut anthropic = axum::http::HeaderMap::new();
        anthropic.insert("anthropic-version", "2023-06-01".parse().unwrap());
        let none = axum::http::HeaderMap::new();

        assert!(is_claude_model_discovery(
            &uri("/v1/models?limit=1000"),
            &anthropic
        ));
        assert!(is_claude_model_discovery(&uri("/v1/models"), &anthropic));
        assert!(is_claude_model_discovery(
            &uri("/v1/models?limit=1000"),
            &none
        ));
        assert!(!is_claude_model_discovery(
            &uri("/v1/models?client_version=0.158.0"),
            &none
        ));
        assert!(!is_claude_model_discovery(&uri("/v1/models"), &none));
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn claude_model_discovery_lists_nothing_outside_proxy_mode() {
        let _home = crate::mode::controller::tests::Fixture::new();
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        let Json(body) = handle_models(
            State(proxy_state()),
            "/v1/models?limit=1000".parse().unwrap(),
            headers,
        )
        .await
        .expect("models");
        assert_eq!(body, json!({ "data": [], "has_more": false }));
    }
}

#[cfg(test)]
mod gateway_token_tests {
    use super::{
        extract_gateway_token, validate_claude_desktop_gateway_auth_for_db,
        validate_claude_desktop_gateway_token,
    };
    use crate::database::Database;
    use crate::proxy::ProxyError;
    use axum::{
        http::{header::AUTHORIZATION, HeaderMap, HeaderValue, StatusCode},
        response::IntoResponse,
    };
    use http_body_util::BodyExt;

    #[test]
    fn extract_gateway_token_accepts_authorization_bearer() {
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer ccs-test-token-123".parse().unwrap(),
        );
        assert_eq!(
            extract_gateway_token(&h).as_deref(),
            Some("ccs-test-token-123")
        );
    }

    #[test]
    fn extract_gateway_token_accepts_lowercase_bearer() {
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "bearer ccs-test-token-123".parse().unwrap(),
        );
        assert_eq!(
            extract_gateway_token(&h).as_deref(),
            Some("ccs-test-token-123")
        );
    }

    #[test]
    fn extract_gateway_token_accepts_authorization_without_prefix() {
        // Lenient parsing: if the client doesn't include the Bearer prefix,
        // treat the whole value as the token.
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "ccs-test-token-123".parse().unwrap(),
        );
        assert_eq!(
            extract_gateway_token(&h).as_deref(),
            Some("ccs-test-token-123")
        );
    }

    #[test]
    fn extract_gateway_token_accepts_x_api_key() {
        // This is what the Claude desktop app actually sends.
        let mut h = axum::http::HeaderMap::new();
        h.insert("x-api-key", "ccs-test-token-123".parse().unwrap());
        assert_eq!(
            extract_gateway_token(&h).as_deref(),
            Some("ccs-test-token-123")
        );
    }

    #[test]
    fn extract_gateway_token_prefers_authorization_over_x_api_key() {
        // If both are present, Authorization wins. The desktop app only
        // sends one or the other; a client that sends both is checked
        // against Authorization only, and x-api-key is ignored.
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer ccs-from-auth".parse().unwrap(),
        );
        h.insert("x-api-key", "ccs-from-x-api-key".parse().unwrap());
        assert_eq!(extract_gateway_token(&h).as_deref(), Some("ccs-from-auth"));
    }

    #[test]
    fn extract_gateway_token_trims_whitespace() {
        let mut h = axum::http::HeaderMap::new();
        h.insert("x-api-key", "  ccs-test-token-123  ".parse().unwrap());
        assert_eq!(
            extract_gateway_token(&h).as_deref(),
            Some("ccs-test-token-123")
        );
    }

    #[test]
    fn extract_gateway_token_returns_none_when_no_auth_header() {
        let h = axum::http::HeaderMap::new();
        assert_eq!(extract_gateway_token(&h), None);
    }

    const TEST_GATEWAY_TOKEN: &str = "ccs-0123456789abcdef0123456789abcdef";

    fn authorization_headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_str(value).unwrap());
        headers
    }

    fn assert_gateway_auth_rejected(result: Result<(), ProxyError>) {
        assert!(
            matches!(result, Err(ProxyError::AuthError(message)) if message == "Claude Desktop gateway authentication failed")
        );
    }

    #[test]
    fn claude_desktop_gateway_auth_accepts_exact_token() {
        let headers = authorization_headers(&format!("Bearer {TEST_GATEWAY_TOKEN}"));
        assert!(validate_claude_desktop_gateway_token(&headers, TEST_GATEWAY_TOKEN).is_ok());

        let mut api_key = HeaderMap::new();
        api_key.insert("x-api-key", HeaderValue::from_static(TEST_GATEWAY_TOKEN));
        assert!(validate_claude_desktop_gateway_token(&api_key, TEST_GATEWAY_TOKEN).is_ok());
        api_key.insert("x-api-key", HeaderValue::from_static("wrong-token"));
        assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
            &api_key,
            TEST_GATEWAY_TOKEN,
        ));
    }

    #[test]
    fn claude_desktop_gateway_auth_rejects_wrong_prefix_and_length() {
        let prefix = &TEST_GATEWAY_TOKEN[..TEST_GATEWAY_TOKEN.len() / 2];
        let shorter = &TEST_GATEWAY_TOKEN[..TEST_GATEWAY_TOKEN.len() - 1];
        let longer = format!("{TEST_GATEWAY_TOKEN}0");

        for token in ["wrong-token", prefix, shorter, longer.as_str()] {
            let headers = authorization_headers(&format!("Bearer {token}"));
            assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
                &headers,
                TEST_GATEWAY_TOKEN,
            ));
        }
    }

    #[test]
    fn claude_desktop_gateway_auth_rejects_missing_malformed_and_non_utf8_headers() {
        assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
            &HeaderMap::new(),
            TEST_GATEWAY_TOKEN,
        ));

        for value in ["", "Basic abc", "Bearer", "Bearer wrong-token"] {
            assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
                &authorization_headers(value),
                TEST_GATEWAY_TOKEN,
            ));
        }

        let mut non_utf8 = HeaderMap::new();
        non_utf8.insert(AUTHORIZATION, HeaderValue::from_bytes(b"\xff").unwrap());
        assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
            &non_utf8,
            TEST_GATEWAY_TOKEN,
        ));
    }

    #[test]
    fn claude_desktop_gateway_auth_preserves_bearer_case_and_whitespace_behavior() {
        for value in [
            format!("bearer {TEST_GATEWAY_TOKEN}"),
            format!("Bearer   {TEST_GATEWAY_TOKEN}  "),
        ] {
            assert!(validate_claude_desktop_gateway_token(
                &authorization_headers(&value),
                TEST_GATEWAY_TOKEN
            )
            .is_ok());
        }

        assert_gateway_auth_rejected(validate_claude_desktop_gateway_token(
            &authorization_headers(&format!("BEARER {TEST_GATEWAY_TOKEN}")),
            TEST_GATEWAY_TOKEN,
        ));
    }

    #[tokio::test]
    async fn claude_desktop_gateway_auth_entry_uses_uniform_401_response() {
        let db = Database::memory().expect("in-memory database");
        db.set_setting("claude_desktop_gateway_token", TEST_GATEWAY_TOKEN)
            .expect("seed gateway token");

        assert!(validate_claude_desktop_gateway_auth_for_db(
            &db,
            &authorization_headers(&format!("Bearer {TEST_GATEWAY_TOKEN}"))
        )
        .is_ok());

        let mut non_utf8 = HeaderMap::new();
        non_utf8.insert(AUTHORIZATION, HeaderValue::from_bytes(b"\xff").unwrap());

        let invalid_headers = [
            HeaderMap::new(),
            authorization_headers(""),
            authorization_headers("Basic abc"),
            authorization_headers("Bearer wrong-token"),
            authorization_headers(&format!("Bearer {}", &TEST_GATEWAY_TOKEN[..4])),
            non_utf8,
        ];

        let mut expected_body = None;
        for headers in invalid_headers {
            let response = validate_claude_desktop_gateway_auth_for_db(&db, &headers)
                .expect_err("invalid authentication must fail")
                .into_response();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

            let body = response
                .into_body()
                .collect()
                .await
                .expect("collect error response body")
                .to_bytes();
            let body: serde_json::Value =
                serde_json::from_slice(&body).expect("parse error response body");
            assert!(!body.to_string().contains(TEST_GATEWAY_TOKEN));
            if let Some(expected_body) = &expected_body {
                assert_eq!(&body, expected_body);
            } else {
                expected_body = Some(body);
            }
        }
    }
}

#[cfg(test)]
mod sse_aggregation_tests {
    use super::{body_looks_like_sse, chat_sse_to_response_value, responses_sse_to_response_value};
    use crate::proxy::ProxyError;

    #[test]
    fn body_looks_like_sse_detects_unlabeled_sse_prefixes() {
        assert!(body_looks_like_sse("data: {\"id\":\"1\"}\n\n"));
        assert!(body_looks_like_sse("event: message\ndata: {}\n\n"));
        // SSE 规范的另两种字段行也可能打头
        assert!(body_looks_like_sse("id: 1\ndata: {}\n\n"));
        assert!(body_looks_like_sse("retry: 3000\ndata: {}\n\n"));
        // OpenRouter 会在流前发注释行
        assert!(body_looks_like_sse(
            ": OPENROUTER PROCESSING\n\ndata: {}\n\n"
        ));
        // BOM + 前导空白
        assert!(body_looks_like_sse("\u{feff}\n  data: {}\n\n"));
        // HTML 拦截页与普通文本不应误判为 SSE
        assert!(!body_looks_like_sse("<html><body>blocked</body></html>"));
        assert!(!body_looks_like_sse("Bad Gateway"));
        assert!(!body_looks_like_sse(""));
    }

    #[test]
    fn chat_sse_to_response_value_collects_reasoning_alias() {
        // OpenRouter/Kimi 用 reasoning（字符串），部分网关用对象形态
        let sse = "data: {\"id\":\"c1\",\"model\":\"kimi-k2.6\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":\"think\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":{\"content\":\"ing\"},\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "thinking"
        );
        assert_eq!(response["choices"][0]["message"]["content"], "ok");
    }

    #[test]
    fn chat_sse_to_response_value_collects_reasoning_details() {
        // MiMo/OpenRouter 等只发 reasoning_details（数组形态）的 provider，
        // 经公共提取器兜底，不能丢思考内容
        let sse = "data: {\"id\":\"c1\",\"model\":\"mimo\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_details\":[{\"type\":\"reasoning.text\",\"text\":\"think\"}]},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_details\":[{\"type\":\"reasoning.text\",\"text\":\"ing\"}],\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "thinking"
        );
        assert_eq!(response["choices"][0]["message"]["content"], "ok");
    }

    #[test]
    fn responses_sse_to_response_value_handles_missing_trailing_blank_line() {
        // 错标 SSE 兜底/非规范上游：最后的 response.completed 后没有空行分隔
        let sse = "event: response.completed\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_tail\",\"status\":\"completed\",\"model\":\"gpt-5.4\",\"output\":[],\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n";

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_tail");
    }

    #[test]
    fn responses_sse_to_response_value_ignores_truncated_trailing_block() {
        // 截断的残余尾块不能破坏已聚合好的完整响应（codex_oauth 路径复用本函数）
        let sse = "event: response.completed\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_ok\",\"status\":\"completed\",\"model\":\"gpt-5.4\",\"output\":[],\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n\
\n\
event: response.extra\n\
data: {\"type\":\"resp";

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_ok");
    }

    #[test]
    fn chat_sse_to_response_value_skips_azure_placeholder_envelope() {
        // Azure content-filter 前置块带 ""/0 占位，不能冻结 envelope 字段
        let sse = "data: {\"id\":\"\",\"model\":\"\",\"created\":0,\"object\":\"\",\"choices\":[],\"prompt_filter_results\":[]}\n\n\
data: {\"id\":\"chatcmpl-real\",\"model\":\"gpt-5.4\",\"created\":42,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "chatcmpl-real");
        assert_eq!(response["model"], "gpt-5.4");
        assert_eq!(response["created"], 42);
    }

    #[test]
    fn chat_sse_to_response_value_tolerates_null_error_field() {
        // one-api 系网关每个 chunk 都带 "error": null，不能误判为上游错误
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"error\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn chat_sse_to_response_value_first_finish_reason_wins() {
        // kimi-k2.6 等会在 tool_use 后再发带 finish_reason 的尾块，
        // 尾块 "stop" 不能覆盖先到的 "tool_calls"（对齐 streaming.rs first-wins）
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"f\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
    }

    #[test]
    fn chat_sse_to_response_value_unwraps_message_shaped_fake_stream() {
        // 假流式中转把完整 chat.completion 包成单个 SSE 事件（message 而非 delta）
        let sse = "data: {\"id\":\"c1\",\"object\":\"chat.completion\",\"model\":\"m\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"full answer\"},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "full answer");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
    }

    #[test]
    fn chat_sse_to_response_value_message_snapshot_overrides_deltas() {
        // 混合形态：先发增量再发完整 message 快照时，快照覆盖增量（防双计）
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"par\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"full\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "full");
    }

    #[test]
    fn chat_sse_to_response_value_backfills_sparse_tool_call_ids() {
        // index 空洞的空壳被丢弃；缺 id 的按原始 index 回填 tool_call_{idx}
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"name\":\"f2\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        let tool_calls = response["choices"][0]["message"]["tool_calls"]
            .as_array()
            .unwrap();
        assert_eq!(tool_calls.len(), 1, "index 0 的空壳应被丢弃");
        assert_eq!(tool_calls[0]["id"], "tool_call_1");
        assert_eq!(tool_calls[0]["function"]["name"], "f2");
    }

    #[test]
    fn chat_sse_to_response_value_strips_bom_before_parsing() {
        // 嗅探器接受 BOM，块解析也必须剥掉它，否则首个 data 行静默丢失
        let sse = "\u{feff}data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn chat_sse_to_response_value_aggregates_text_finish_reason_and_usage() {
        let sse = "data: {\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-5.4\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\n\
data: [DONE]\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "chatcmpl-1");
        assert_eq!(response["object"], "chat.completion");
        assert_eq!(response["model"], "gpt-5.4");
        assert_eq!(response["choices"][0]["message"]["role"], "assistant");
        assert_eq!(response["choices"][0]["message"]["content"], "Hello");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
        assert_eq!(response["usage"]["prompt_tokens"], 10);
    }

    #[test]
    fn chat_sse_to_response_value_merges_tool_call_argument_fragments() {
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"city\\\":\"}}]},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"SF\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n\
data: [DONE]\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        let tool_call = &response["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tool_call["id"], "call_1");
        assert_eq!(tool_call["function"]["name"], "get_weather");
        assert_eq!(tool_call["function"]["arguments"], "{\"city\":\"SF\"}");
        assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
    }

    #[test]
    fn chat_sse_to_response_value_collects_reasoning_content() {
        let sse = "data: {\"id\":\"c1\",\"model\":\"deepseek-r2\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"think\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"ing\",\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "thinking"
        );
        assert_eq!(response["choices"][0]["message"]["content"], "ok");
    }

    #[test]
    fn chat_sse_to_response_value_handles_missing_trailing_blank_line() {
        // 非规范上游/半截流：最后一个事件后没有空行分隔
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn chat_sse_to_response_value_handles_crlf_delimiters() {
        // 真实 HTTP SSE 按规范使用 \r\n\r\n 分隔事件
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\r\n\
\r\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\r\n\
\r\n\
data: [DONE]\r\n\
\r\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "hi");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
    }

    #[test]
    fn chat_sse_to_response_value_propagates_upstream_error_event() {
        let sse = "data: {\"error\":{\"message\":\"rate limited by gateway\",\"code\":429}}\n\n";

        let err = chat_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => assert!(msg.contains("rate limited by gateway")),
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn chat_sse_to_response_value_rejects_truncated_stream() {
        // 只有内容增量、无 finish_reason 也无 [DONE]：close-delimited 截断不可
        // 在字节层检测，必须按截断报错而非静默返回半截内容
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"par\"},\"finish_reason\":null}]}\n\n";

        let err = chat_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => assert!(msg.contains("truncated")),
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn chat_sse_to_response_value_accepts_done_marker_without_finish_reason() {
        // 非规范上游可能不发 finish_reason 但正常收尾 [DONE]：视为完成
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n\
data: [DONE]\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();

        assert_eq!(response["choices"][0]["message"]["content"], "hi");
        assert_eq!(
            response["choices"][0]["finish_reason"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn chat_sse_to_response_value_rejects_stream_without_chunks() {
        let err = chat_sse_to_response_value(": keepalive\n\ndata: [DONE]\n\n").unwrap_err();
        match err {
            ProxyError::TransformError(msg) => {
                assert!(msg.contains("No chat completion choices"))
            }
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn chat_sse_to_response_value_rejects_choiceless_stream_despite_done() {
        // metadata/usage-only chunk + [DONE]、全程无 choice payload：
        // 不能凭 [DONE] 包装成空内容假成功（saw_choice 必须以 choice 为证据）
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":0,\"total_tokens\":1}}\n\n\
data: [DONE]\n\n";

        let err = chat_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => {
                assert!(msg.contains("No chat completion choices"), "{msg}")
            }
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn chat_sse_to_response_value_huge_tool_call_index_does_not_oom() {
        // C1：上游可控的巨大 index 不得 densify 数组（旧实现会 OOM 整个进程）；
        // BTreeMap 只占一个槽，且原始 index 用于回填合成 id
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":4000000000,\"function\":{\"name\":\"f\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        let tool_calls = response["choices"][0]["message"]["tool_calls"]
            .as_array()
            .unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0]["id"], "tool_call_4000000000");
        assert_eq!(tool_calls[0]["function"]["name"], "f");
    }

    #[test]
    fn chat_sse_to_response_value_empty_delta_falls_back_to_message_snapshot() {
        // C3：同一 choice 同时带空 delta:{} 与完整 message 快照——不能因 delta 键
        // 存在就短路到空 delta、丢掉 message 内容（finish_reason 还会击穿守卫）
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{},\"message\":{\"role\":\"assistant\",\"content\":\"full answer\"},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "full answer");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
    }

    #[test]
    fn chat_sse_to_response_value_empty_delta_scaffold_does_not_wipe_real_content() {
        // C3 反向陷阱：每个 chunk 都带真内容 delta + 空 message 壳时，不能让空
        // message 触发 clear 抹掉累计内容（delta 非空则优先 delta，不走快照覆盖）
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"message\":{},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" there\"},\"message\":{},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "hi there");
    }

    #[test]
    fn chat_sse_to_response_value_object_form_tool_arguments_preserved() {
        // C16：message 快照里 arguments 作对象回传时序列化保留，不能丢成空输入
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":{\"city\":\"SF\"}}}]},\"finish_reason\":\"tool_calls\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        let args = response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(args).unwrap();
        assert_eq!(parsed["city"], "SF");
    }

    #[test]
    fn chat_sse_to_response_value_collects_refusal() {
        // C15：delta.refusal 字符串并入可见内容，避免拒绝响应变空消息假成功
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"refusal\":\"I can't help with that.\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(
            response["choices"][0]["message"]["content"],
            "I can't help with that."
        );
    }

    #[test]
    fn chat_sse_to_response_value_maps_legacy_function_call() {
        // C17：legacy function_call → 单个 tool_call，避免 finish_reason
        // function_call 映射成 tool_use 却零工具块卡死 agent
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":null,\"function_call\":{\"name\":\"get_weather\",\"arguments\":\"{\\\"city\\\":\\\"SF\\\"}\"}},\"finish_reason\":\"function_call\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        let tc = &response["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tc["function"]["name"], "get_weather");
        assert_eq!(tc["function"]["arguments"], "{\"city\":\"SF\"}");
    }

    #[test]
    fn chat_sse_to_response_value_event_error_fails_even_after_complete_choice() {
        // C18：event:error（data 无 error 键）即便跟在完整 choice 后也判失败，
        // 不能伪装成成功
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"stop\"}]}\n\n\
event: error\n\
data: {\"message\":\"insufficient_user_quota\",\"code\":429}\n\n";

        let err = chat_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => {
                assert!(msg.contains("insufficient_user_quota"), "{msg}")
            }
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn chat_sse_to_response_value_tolerates_empty_error_placeholder() {
        // C12：error 为空对象 / 空消息等占位形状不得误杀成功流
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"error\":{},\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn chat_sse_to_response_value_tolerates_truncated_residual_after_complete() {
        // C2：完整 finish_reason 块后尾块被掐断（半截 JSON），不能误杀已完整的聚合
        let sse = "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n\
data: {\"usage\":{\"prompt_to";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn chat_sse_to_response_value_float_zero_does_not_freeze_envelope() {
        // C14：浮点 0.0 占位的 created 不得冻结 envelope，真值应能覆盖
        let sse = "data: {\"id\":\"\",\"model\":\"\",\"created\":0.0,\"choices\":[]}\n\n\
data: {\"id\":\"chatcmpl-real\",\"model\":\"m\",\"created\":42,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["created"], 42);
        assert_eq!(response["id"], "chatcmpl-real");
    }

    #[test]
    fn chat_sse_to_response_value_synthesizes_id_when_absent() {
        // C9：上游无 id 时合成非空唯一 id，避免下游 dedup 退化成常量碰撞覆盖
        let sse = "data: {\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let r1 = chat_sse_to_response_value(sse).unwrap();
        let r2 = chat_sse_to_response_value(sse).unwrap();
        let id1 = r1["id"].as_str().unwrap();
        let id2 = r2["id"].as_str().unwrap();
        assert!(!id1.is_empty());
        assert_ne!(id1, id2, "两次无 id 聚合应产出不同 id 以避免 dedup 碰撞");
    }

    #[test]
    fn chat_sse_to_response_value_accepts_indented_data_lines() {
        // C4：行首缩进的 data 行（嗅探器宽容接受）也应能被聚合，不静默丢失
        let sse = "  data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n";

        let response = chat_sse_to_response_value(sse).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "hi");
    }

    #[test]
    fn responses_sse_to_response_value_collects_output_items() {
        let sse = r#"event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_1");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hello");
    }

    #[test]
    fn responses_sse_to_response_value_handles_crlf_delimiters() {
        // SseBlocks 支持 LF/CRLF 任意组合形成的四种事件分隔符；
        // 此处覆盖 \r\n\r\n，避免 CRLF 上游响应触发 TransformError。
        let sse = "event: response.output_item.done\r\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hi\"}]}}\r\n\
\r\n\
event: response.completed\r\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_crlf\",\"status\":\"completed\",\"model\":\"gpt-5.4\",\"output\":[],\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}\r\n\
\r\n";

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_crlf");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hi");
    }

    #[test]
    fn responses_sse_to_response_value_returns_err_on_response_failed() {
        let sse = "event: response.failed\n\
data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"upstream blew up\"}}}\n\n";

        let err = responses_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => assert!(msg.contains("upstream blew up")),
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn responses_sse_to_response_value_errors_when_no_terminal_event() {
        let sse = "event: response.output_item.done\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\"}}\n\n";

        assert!(responses_sse_to_response_value(sse).is_err());
    }

    #[test]
    fn responses_sse_to_response_value_accepts_incomplete_terminal_event() {
        let sse = concat!(
            "event: response.incomplete\n",
            "data: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_incomplete\",\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"output\":[],\"usage\":{\"input_tokens\":7,\"output_tokens\":16}}}\n"
        );

        let response = responses_sse_to_response_value(sse).unwrap();
        assert_eq!(response["id"], "resp_incomplete");
        assert_eq!(response["status"], "incomplete");
        assert_eq!(
            response["incomplete_details"]["reason"],
            "max_output_tokens"
        );
        assert_eq!(response["usage"]["input_tokens"], 7);
        assert_eq!(response["usage"]["output_tokens"], 16);
    }

    #[test]
    fn responses_sse_to_response_value_uses_payload_type_without_event_names() {
        let sse = concat!(
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hi\"}]}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_data_only\",\"status\":\"completed\",\"output\":[]}}\n\n"
        );

        let response = responses_sse_to_response_value(sse).unwrap();
        assert_eq!(response["id"], "resp_data_only");
        assert_eq!(response["output"][0]["content"][0]["text"], "Hi");
    }

    #[test]
    fn responses_sse_to_response_value_preserves_data_only_failure() {
        let sse = "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"upstream failed\"}}}\n\n";

        let err = responses_sse_to_response_value(sse).unwrap_err();
        assert!(matches!(err, ProxyError::TransformError(message) if message == "upstream failed"));
    }

    #[test]
    fn responses_sse_to_response_value_prefers_explicit_event_name() {
        let sse = concat!(
            "event: response.failed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"error\":{\"message\":\"upstream failed\"}}}\n\n"
        );

        let err = responses_sse_to_response_value(sse).unwrap_err();
        assert!(matches!(err, ProxyError::TransformError(message) if message == "upstream failed"));
    }

    /// 上游 9403960f：响应转换按这次请求解析出的格式，不按供应商级默认
    #[test]
    fn claude_response_transform_follows_the_resolved_format() {
        use super::claude_response_needs_transform;

        // Copilot defaults to converting, but a request resolved to native Messages
        // gets an Anthropic response back and must pass through untouched.
        assert!(!claude_response_needs_transform(Some("anthropic"), true));
        assert!(claude_response_needs_transform(Some("openai_chat"), true));
        assert!(claude_response_needs_transform(
            Some("openai_responses"),
            false
        ));
        assert!(claude_response_needs_transform(None, true));
        assert!(!claude_response_needs_transform(None, false));
    }
}

#[cfg(test)]
mod copilot_native_responses_tests {
    use super::*;
    use crate::{
        database::Database,
        mode::stack::StackTarget,
        provider::{Provider, ProviderMeta},
        proxy::hyper_client::ProxyResponse,
    };
    use futures::StreamExt;
    use std::sync::Arc;

    async fn context(copilot: bool) -> (ProxyState, RequestContext) {
        let state = ProxyState::for_test(Arc::new(Database::memory().unwrap()));
        let mut provider = Provider::with_id(
            "native".to_string(),
            "Native Responses".to_string(),
            json!({}),
            None,
        );
        if copilot {
            provider.meta = Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                ..Default::default()
            });
        }
        let ctx = RequestContext::new_with_stack(
            &state,
            &json!({ "model": "gpt-test", "stream": true }),
            &axum::http::HeaderMap::new(),
            AppType::Codex,
            "Codex",
            "codex",
            Some(StackTarget {
                provider,
                upstream_model: "gpt-test".to_string(),
                original_model: "gpt-test".to_string(),
            }),
        )
        .await
        .unwrap();
        (state, ctx)
    }

    fn changing_message_ids() -> String {
        [
            json!({ "type": "response.created", "response": { "id": "resp_1" } }),
            json!({ "type": "response.output_item.added", "output_index": 0,
                "item": { "type": "message", "id": "copilot_added", "role": "assistant",
                    "phase": "commentary", "status": "in_progress", "content": [] } }),
            json!({ "type": "response.content_part.added", "output_index": 0,
                "content_index": 0, "item_id": "copilot_part",
                "part": { "type": "output_text", "text": "" } }),
            json!({ "type": "response.output_text.delta", "output_index": 0,
                "content_index": 0, "item_id": "copilot_delta", "delta": "Hello" }),
            json!({ "type": "response.output_text.done", "output_index": 0,
                "content_index": 0, "item_id": "copilot_text_done", "text": "Hello" }),
            json!({ "type": "response.content_part.done", "output_index": 0,
                "content_index": 0, "item_id": "copilot_part_done",
                "part": { "type": "output_text", "text": "Hello" } }),
            json!({ "type": "response.output_item.done", "output_index": 0,
                "item": { "type": "message", "id": "copilot_done", "role": "assistant",
                    "phase": "commentary", "status": "completed",
                    "content": [{ "type": "output_text", "text": "Hello" }] } }),
            json!({ "type": "response.completed", "response": {
                "id": "resp_1", "status": "completed", "model": "gpt-test",
                "output": [{ "type": "message", "id": "copilot_done", "role": "assistant",
                    "phase": "commentary", "status": "completed",
                    "content": [{ "type": "output_text", "text": "Hello" }] }],
                "usage": { "input_tokens": 3, "output_tokens": 1 } } }),
        ]
        .into_iter()
        .map(|event| {
            format!(
                "event: {}\ndata: {event}\n\n",
                event["type"].as_str().unwrap()
            )
        })
        .collect()
    }

    fn upstream(body: &str) -> ProxyResponse {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "text/event-stream".parse().unwrap());
        headers.insert("content-length", body.len().to_string().parse().unwrap());
        ProxyResponse::buffered(
            StatusCode::OK,
            headers,
            Bytes::copy_from_slice(body.as_bytes()),
        )
    }

    async fn body_and_events(response: axum::response::Response) -> (Bytes, Vec<Value>) {
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("content-length").is_none());
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let mut events = Vec::new();
        for block in SseBlocks::new(std::str::from_utf8(&body).unwrap()) {
            let data = block
                .lines()
                .filter_map(|line| strip_sse_field(line, "data"))
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() && data.trim() != "[DONE]" {
                events.push(serde_json::from_str(&data).unwrap());
            }
        }
        (body, events)
    }

    #[tokio::test]
    async fn copilot_messages_keep_the_original_id_until_completion() {
        let (state, ctx) = context(true).await;
        let response = handle_codex_late_arguments_repair(
            upstream(&changing_message_ids()),
            &ctx,
            &state,
            true,
        )
        .await
        .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 8);
        assert_eq!(events[1]["item"]["id"], "copilot_added");
        assert_eq!(events[2]["item_id"], "copilot_added");
        assert_eq!(events[3]["item_id"], "copilot_added");
        assert_eq!(events[3]["delta"], "Hello");
        assert_eq!(events[4]["item_id"], "copilot_added");
        assert_eq!(events[5]["item_id"], "copilot_added");
        assert_eq!(events[6]["item"]["id"], "copilot_added");
        assert_eq!(events[6]["item"]["phase"], "commentary");
        assert_eq!(events[6]["item"]["content"][0]["text"], "Hello");
        assert_eq!(events[7]["response"]["output"][0]["id"], "copilot_added");
        assert_eq!(events[7]["response"]["id"], "resp_1");
        assert_eq!(events[7]["response"]["usage"]["output_tokens"], 1);
    }

    #[tokio::test]
    async fn other_native_providers_keep_their_original_events() {
        let (state, ctx) = context(false).await;
        let input = changing_message_ids();
        let response = handle_codex_late_arguments_repair(upstream(&input), &ctx, &state, true)
            .await
            .unwrap();
        let (body, _) = body_and_events(response).await;

        assert_eq!(body.as_ref(), input.as_bytes());
    }

    #[tokio::test]
    async fn copilot_compaction_also_keeps_message_ids_stable() {
        let (state, ctx) = context(true).await;
        let response = handle_codex_native_compaction_response(
            upstream(&changing_message_ids()),
            &ctx,
            &state,
        )
        .await
        .unwrap();
        let (_, events) = body_and_events(response).await;
        let message = events
            .iter()
            .find(|event| {
                event["type"] == "response.output_item.done" && event["item"]["type"] == "message"
            })
            .unwrap();

        assert_eq!(message["item"]["id"], "copilot_added");
        assert_eq!(
            events
                .iter()
                .filter(|event| event["type"] == "response.output_item.done"
                    && event["item"]["type"] == "compaction")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn interleaved_items_keep_separate_ids_without_changing_tool_call_ids() {
        let (state, ctx) = context(true).await;
        let input: String = [
            json!({ "type": "response.output_item.added", "output_index": 0,
                "item": { "type": "message", "id": "message_start", "role": "assistant", "content": [] } }),
            json!({ "type": "response.output_item.added", "output_index": 1,
                "item": { "type": "reasoning", "id": "reasoning_start", "summary": [] } }),
            json!({ "type": "response.output_item.added", "output_index": 2,
                "item": { "type": "function_call", "id": "tool_start", "call_id": "call_1",
                    "name": "read_file", "arguments": "" } }),
            json!({ "type": "response.output_text.delta", "output_index": 0,
                "item_id": "message_delta", "content_index": 0, "delta": "Checking." }),
            json!({ "type": "response.reasoning_summary_text.delta", "output_index": 1,
                "item_id": "reasoning_delta", "summary_index": 0, "delta": "Need a file." }),
            json!({ "type": "response.function_call_arguments.delta", "output_index": 2,
                "item_id": "tool_delta", "delta": "{}" }),
            json!({ "type": "response.output_item.done", "output_index": 2,
                "item": { "type": "function_call", "id": "tool_done", "call_id": "call_1",
                    "name": "read_file", "arguments": "{}" } }),
            json!({ "type": "response.output_item.done", "output_index": 1,
                "item": { "type": "reasoning", "id": "reasoning_done",
                    "summary": [{ "type": "summary_text", "text": "Need a file." }],
                    "encrypted_content": "upstream-signed-reasoning" } }),
            json!({ "type": "response.output_item.done", "output_index": 0,
                "item": { "type": "message", "id": "message_done", "role": "assistant",
                    "content": [{ "type": "output_text", "text": "Checking." }] } }),
            json!({ "type": "response.completed", "response": { "id": "resp_1", "output": [
                { "type": "message", "id": "message_snapshot" },
                { "type": "reasoning", "id": "reasoning_snapshot", "encrypted_content": "upstream-signed-reasoning" },
                { "type": "function_call", "id": "tool_snapshot", "call_id": "call_1", "arguments": "{}" }
            ] } }),
        ]
        .into_iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect();
        let response = handle_codex_late_arguments_repair(upstream(&input), &ctx, &state, true)
            .await
            .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 10);
        assert_eq!(events[3]["item_id"], "message_start");
        assert_eq!(events[4]["item_id"], "reasoning_start");
        assert_eq!(events[5]["item_id"], "tool_start");
        assert_eq!(events[6]["item"]["id"], "tool_start");
        assert_eq!(events[6]["item"]["call_id"], "call_1");
        assert_eq!(events[6]["item"]["arguments"], "{}");
        assert_eq!(events[7]["item"]["id"], "reasoning_start");
        assert_eq!(
            events[7]["item"]["encrypted_content"],
            "upstream-signed-reasoning"
        );
        assert_eq!(events[8]["item"]["id"], "message_start");
        assert_eq!(events[9]["response"]["output"][0]["id"], "message_start");
        assert_eq!(events[9]["response"]["output"][1]["id"], "reasoning_start");
        assert_eq!(events[9]["response"]["output"][2]["id"], "tool_start");
        assert_eq!(events[9]["response"]["output"][2]["call_id"], "call_1");
    }

    #[tokio::test]
    async fn fragmented_utf8_and_unterminated_final_events_keep_stable_ids() {
        let (state, ctx) = context(true).await;
        let input = concat!(
            "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"start\",\"role\":\"assistant\",\"content\":[]}}\r\n\r\n",
            "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"item_id\":\"delta\",\"delta\":\"你好\"}\r\n\r\n",
            "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"done\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"你好\"}]}}"
        );
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "text/event-stream".parse().unwrap());
        let chunks: Vec<_> = input
            .as_bytes()
            .chunks(1)
            .map(|chunk| Ok::<_, std::io::Error>(Bytes::copy_from_slice(chunk)))
            .collect();
        let response = handle_codex_late_arguments_repair(
            ProxyResponse::streamed(StatusCode::OK, headers, futures::stream::iter(chunks)),
            &ctx,
            &state,
            true,
        )
        .await
        .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 3);
        assert_eq!(events[1]["item_id"], "start");
        assert_eq!(events[1]["delta"], "你好");
        assert_eq!(events[2]["item"]["id"], "start");
        assert_eq!(events[2]["item"]["content"][0]["text"], "你好");
    }

    #[tokio::test]
    async fn copilot_stable_ids_and_sse_metadata_are_preserved() {
        let (state, ctx) = context(true).await;
        let input = concat!(
            ": keepalive\n\n",
            "id: upstream-event-1\nretry: 1000\nevent: response.output_item.added\n",
            "data: { \"type\": \"response.output_item.added\", \"output_index\": 0, \"item\": { \"type\": \"message\", \"id\": \"stable\" } }\n\n",
            "event: response.output_item.done\n",
            "data: { \"type\": \"response.output_item.done\", \"output_index\": 0, \"item\": { \"type\": \"message\", \"id\": \"stable\" } }\n\n",
            "data: [DONE]\n\n"
        );
        let response = handle_codex_late_arguments_repair(upstream(input), &ctx, &state, true)
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();

        assert_eq!(body.as_ref(), input.as_bytes());
    }

    #[tokio::test]
    async fn copilot_text_is_streamed_before_the_item_finishes() {
        let (state, ctx) = context(true).await;
        let added = "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"start\"}}\n\n";
        let delta = "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"item_id\":\"delta\",\"delta\":\"Hello\"}\n\n";
        let stream = futures::stream::iter([
            Ok::<_, std::io::Error>(Bytes::from_static(added.as_bytes())),
            Ok(Bytes::from_static(delta.as_bytes())),
        ])
        .chain(futures::stream::pending());
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "text/event-stream".parse().unwrap());
        let response = handle_codex_late_arguments_repair(
            ProxyResponse::streamed(StatusCode::OK, headers, stream),
            &ctx,
            &state,
            true,
        )
        .await
        .unwrap();
        let mut body = response.into_body();

        for expected in ["response.output_item.added", "response.output_text.delta"] {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(1), body.frame())
                .await
                .expect("must not wait for the completed item")
                .unwrap()
                .unwrap()
                .into_data()
                .unwrap();
            let text = std::str::from_utf8(&frame).unwrap();
            let data = text
                .lines()
                .find_map(|line| strip_sse_field(line, "data"))
                .unwrap();
            let event: Value = serde_json::from_str(data).unwrap();
            assert_eq!(event["type"], expected);
        }
    }

    #[tokio::test]
    async fn copilot_stream_errors_are_not_converted_to_completion() {
        let (state, ctx) = context(true).await;
        let added = "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"start\"}}\n\n";
        let stream = futures::stream::iter([
            Ok(Bytes::from_static(added.as_bytes())),
            Err(std::io::Error::other("upstream disconnected")),
        ]);
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "text/event-stream".parse().unwrap());
        let response = handle_codex_late_arguments_repair(
            ProxyResponse::streamed(StatusCode::OK, headers, stream),
            &ctx,
            &state,
            true,
        )
        .await
        .unwrap();
        let mut body = response.into_body();

        assert!(body.frame().await.unwrap().is_ok());
        let error = body.frame().await.unwrap().unwrap_err();
        assert!(error.to_string().contains("upstream disconnected"));
        assert!(body.frame().await.is_none());
    }

    #[tokio::test]
    async fn identical_text_in_distinct_message_items_is_not_deduplicated() {
        let (state, ctx) = context(true).await;
        let input: String = [
            json!({ "type": "response.output_item.added", "output_index": 0,
                "item": { "type": "message", "id": "commentary_start", "phase": "commentary" } }),
            json!({ "type": "response.output_text.delta", "output_index": 0,
                "item_id": "commentary_delta", "delta": "Hello" }),
            json!({ "type": "response.output_item.done", "output_index": 0,
                "item": { "type": "message", "id": "commentary_done", "phase": "commentary",
                    "content": [{ "type": "output_text", "text": "Hello" }] } }),
            json!({ "type": "response.output_item.added", "output_index": 1,
                "item": { "type": "message", "id": "final_start", "phase": "final_answer" } }),
            json!({ "type": "response.output_text.delta", "output_index": 1,
                "item_id": "final_delta", "delta": "Hello" }),
            json!({ "type": "response.output_item.done", "output_index": 1,
                "item": { "type": "message", "id": "final_done", "phase": "final_answer",
                    "content": [{ "type": "output_text", "text": "Hello" }] } }),
        ]
        .into_iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect();
        let response = handle_codex_late_arguments_repair(upstream(&input), &ctx, &state, true)
            .await
            .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 6);
        assert_eq!(events[2]["item"]["id"], "commentary_start");
        assert_eq!(events[2]["item"]["phase"], "commentary");
        assert_eq!(events[2]["item"]["content"][0]["text"], "Hello");
        assert_eq!(events[5]["item"]["id"], "final_start");
        assert_eq!(events[5]["item"]["phase"], "final_answer");
        assert_eq!(events[5]["item"]["content"][0]["text"], "Hello");
    }

    #[tokio::test]
    async fn changed_tool_ids_are_stabilized_before_late_arguments_are_repaired() {
        let (state, ctx) = context(true).await;
        let input: String = [
            json!({ "type": "response.output_item.added", "output_index": 0,
                "item": { "type": "function_call", "id": "tool_start", "call_id": "call_1",
                    "name": "read_file", "arguments": "" } }),
            json!({ "type": "response.function_call_arguments.done", "output_index": 0,
                "item_id": "arguments_done", "arguments": "" }),
            json!({ "type": "response.output_item.done", "output_index": 0,
                "item": { "type": "function_call", "id": "tool_done", "call_id": "call_1",
                    "name": "read_file", "arguments": "" } }),
            json!({ "type": "response.function_call_arguments.delta", "output_index": 0,
                "item_id": "arguments_delta", "delta": "{\"path\":\"README.md\"}" }),
            json!({ "type": "response.completed", "response": { "id": "resp_1", "output": [] } }),
        ]
        .into_iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect();
        let response = handle_codex_late_arguments_repair(upstream(&input), &ctx, &state, true)
            .await
            .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 5);
        assert_eq!(events[1]["type"], "response.function_call_arguments.delta");
        assert_eq!(events[1]["item_id"], "tool_start");
        assert_eq!(events[2]["type"], "response.function_call_arguments.done");
        assert_eq!(events[2]["item_id"], "tool_start");
        assert_eq!(events[2]["arguments"], "{\"path\":\"README.md\"}");
        assert_eq!(events[3]["item"]["id"], "tool_start");
        assert_eq!(events[3]["item"]["call_id"], "call_1");
        assert_eq!(events[3]["item"]["arguments"], "{\"path\":\"README.md\"}");
    }

    #[tokio::test]
    async fn rewritten_events_preserve_sse_metadata_and_sequence_numbers() {
        let (state, ctx) = context(true).await;
        let input = concat!(
            "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"start\"}}\n\n",
            "id: upstream-event-2\nretry: 1000\n: heartbeat\nevent: response.output_item.done\n",
            "data: {\"type\":\"response.output_item.done\",\"sequence_number\":7,\n",
            "data: \"output_index\":0,\"item\":{\"type\":\"message\",\"id\":\"done\"}}\n\n"
        );
        let response = handle_codex_late_arguments_repair(upstream(input), &ctx, &state, true)
            .await
            .unwrap();
        let (body, events) = body_and_events(response).await;
        let text = std::str::from_utf8(&body).unwrap();

        assert!(text.contains("id: upstream-event-2\nretry: 1000\n: heartbeat\n"));
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["item"]["id"], "start");
        assert_eq!(events[1]["sequence_number"], 7);
    }
}

#[cfg(test)]
mod copilot_grok_responses_tests {
    use super::*;
    use crate::{
        database::Database,
        mode::stack::StackTarget,
        provider::{Provider, ProviderMeta},
        proxy::hyper_client::ProxyResponse,
    };
    use std::sync::Arc;

    async fn context(copilot: bool) -> (ProxyState, RequestContext) {
        let state = ProxyState::for_test(Arc::new(Database::memory().unwrap()));
        let mut provider = Provider::with_id(
            "native".to_string(),
            "Native Responses".to_string(),
            json!({}),
            None,
        );
        if copilot {
            provider.meta = Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                ..Default::default()
            });
        }
        let ctx = RequestContext::new_with_stack(
            &state,
            &json!({ "model": "gpt-test", "stream": true }),
            &axum::http::HeaderMap::new(),
            AppType::Codex,
            "Codex",
            "codex",
            Some(StackTarget {
                provider,
                upstream_model: "gpt-test".to_string(),
                original_model: "gpt-test".to_string(),
            }),
        )
        .await
        .unwrap();
        (state, ctx)
    }

    fn upstream(body: &str) -> ProxyResponse {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "text/event-stream".parse().unwrap());
        headers.insert("content-length", body.len().to_string().parse().unwrap());
        ProxyResponse::buffered(
            StatusCode::OK,
            headers,
            Bytes::copy_from_slice(body.as_bytes()),
        )
    }

    async fn body_and_events(response: axum::response::Response) -> (Bytes, Vec<Value>) {
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("content-length").is_none());
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let mut events = Vec::new();
        for block in SseBlocks::new(std::str::from_utf8(&body).unwrap()) {
            let data = block
                .lines()
                .filter_map(|line| strip_sse_field(line, "data"))
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() && data.trim() != "[DONE]" {
                events.push(serde_json::from_str(&data).unwrap());
            }
        }
        (body, events)
    }

    #[tokio::test]
    async fn copilot_grok_rewrite_restores_late_tool_arguments() {
        let (state, mut ctx) = context(true).await;
        // The client-facing route can have a different name from the resolved model.
        ctx.outbound_model = Some("grok-4.7".to_string());
        assert!(
            super::super::providers::provider_needs_responses_namespace_flatten(
                &ctx.provider,
                ctx.outbound_model.as_deref(),
            )
        );
        let restore_map = grok_namespace_restore_map();
        let call = |id: &str, arguments: &str| {
            json!({
                "type": "function_call", "id": id, "call_id": "call_1",
                "name": "diagnostic__ping", "arguments": arguments
            })
        };
        let input: String = [
            json!({"type": "response.output_item.added", "output_index": 0,
                "item": call("start", "")}),
            json!({"type": "response.function_call_arguments.done", "output_index": 0,
                "item_id": "start", "arguments": ""}),
            json!({"type": "response.output_item.done", "output_index": 0,
                "item": call("start", "")}),
            json!({"type": "response.function_call_arguments.delta", "output_index": 0,
                "item_id": "start", "delta": "{\"count\":2.0,\"ratio\":0.5}"}),
            json!({"type": "response.completed", "response": {
                "id": "resp_1", "status": "completed", "model": "grok-4.7",
                "output": [call("start", "{\"count\":2.0,\"ratio\":0.5}")],
                "usage": {"input_tokens": 3, "output_tokens": 1}
            }}),
        ]
        .into_iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect();
        let response =
            handle_codex_xai_native_responses_rewrite(upstream(&input), &ctx, &state, restore_map)
                .await
                .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 5);
        assert_eq!(events[0]["item"]["name"], "ping");
        assert_eq!(events[0]["item"]["namespace"], "diagnostic");
        assert_eq!(events[1]["type"], "response.function_call_arguments.delta");
        assert_eq!(events[1]["item_id"], "start");
        assert_eq!(events[1]["delta"], "{\"count\":2.0,\"ratio\":0.5}");
        assert_eq!(events[2]["arguments"], "{\"count\":2,\"ratio\":0.5}");
        assert_eq!(events[2]["item_id"], "start");
        for item in [&events[3]["item"], &events[4]["response"]["output"][0]] {
            assert_eq!(item["id"], "start");
            assert_eq!(item["call_id"], "call_1");
            assert_eq!(item["name"], "ping");
            assert_eq!(item["namespace"], "diagnostic");
            assert_eq!(item["arguments"], "{\"count\":2,\"ratio\":0.5}");
        }
        assert_eq!(events[4]["response"]["usage"]["input_tokens"], 3);
    }

    #[tokio::test]
    async fn copilot_grok_rewrite_stabilizes_item_ids_before_restoring_names() {
        let (state, mut ctx) = context(true).await;
        ctx.outbound_model = Some("grok-4.7".to_string());
        let call = |id: &str, arguments: &str| {
            json!({
                "type": "function_call", "id": id, "call_id": "call_1",
                "name": "diagnostic__ping", "arguments": arguments
            })
        };
        // Copilot reissues the item ID on every lifecycle event.
        let input: String = [
            json!({"type": "response.output_item.added", "output_index": 0,
                "item": call("fc_a", "")}),
            json!({"type": "response.function_call_arguments.delta", "output_index": 0,
                "item_id": "fc_b", "delta": "{\"count\":2.0}"}),
            json!({"type": "response.function_call_arguments.done", "output_index": 0,
                "item_id": "fc_c", "arguments": "{\"count\":2.0}"}),
            json!({"type": "response.output_item.done", "output_index": 0,
                "item": call("fc_d", "{\"count\":2.0}")}),
            json!({"type": "response.completed", "response": {
                "id": "resp_1", "status": "completed", "model": "grok-4.7",
                "output": [call("fc_e", "{\"count\":2.0}")],
                "usage": {"input_tokens": 3, "output_tokens": 1}
            }}),
        ]
        .into_iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect();
        let response = handle_codex_xai_native_responses_rewrite(
            upstream(&input),
            &ctx,
            &state,
            grok_namespace_restore_map(),
        )
        .await
        .unwrap();
        let (_, events) = body_and_events(response).await;

        assert_eq!(events.len(), 5);
        assert_eq!(events[1]["item_id"], "fc_a");
        assert_eq!(events[2]["item_id"], "fc_a");
        assert_eq!(events[2]["arguments"], "{\"count\":2}");
        for item in [
            &events[0]["item"],
            &events[3]["item"],
            &events[4]["response"]["output"][0],
        ] {
            assert_eq!(item["id"], "fc_a");
            assert_eq!(item["name"], "ping");
            assert_eq!(item["namespace"], "diagnostic");
        }
    }

    fn grok_namespace_restore_map(
    ) -> std::collections::HashMap<String, transform_codex_responses_namespace::NamespacedName>
    {
        transform_codex_responses_namespace::namespace_restore_map(&json!({
            "tools": [{"type": "namespace", "name": "diagnostic", "tools": [
                {"type": "function", "name": "ping",
                 "parameters": {"type": "object", "properties": {"count": {"type": "integer"}}}}
            ]}]
        }))
    }

    #[tokio::test]
    async fn copilot_grok_nonstream_restores_names_and_preserves_usage() {
        let (state, mut ctx) = context(true).await;
        ctx.outbound_model = Some("grok-4.7".to_string());
        let input = json!({
            "model": "grok-4.7", "status": "completed",
            "output": [{"type": "function_call", "id": "upstream",
                "call_id": "call_1", "name": "diagnostic__ping", "arguments": "{\"count\":2.0}"}],
            "usage": {"input_tokens": 3, "output_tokens": 1}
        });
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        headers.insert("content-length", input.to_string().len().into());
        headers.insert("x-request-id", "upstream-request".parse().unwrap());
        let response = handle_codex_xai_native_responses_rewrite(
            ProxyResponse::buffered(StatusCode::OK, headers, Bytes::from(input.to_string())),
            &ctx,
            &state,
            grok_namespace_restore_map(),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-request-id"], "upstream-request");
        assert!(response.headers().get("content-length").is_none());
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let output: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(output["output"][0]["name"], "ping");
        assert_eq!(output["output"][0]["namespace"], "diagnostic");
        assert_eq!(output["output"][0]["arguments"], "{\"count\":2}");
        assert_eq!(output["output"][0]["call_id"], "call_1");
        assert_eq!(output["usage"], input["usage"]);
    }

    #[tokio::test]
    async fn copilot_grok_rewrite_passes_error_bodies_through() {
        let (state, ctx) = context(true).await;
        let input = Bytes::from_static(br#"{"error":{"message":"upstream rejected request"}}"#);
        let response = handle_codex_xai_native_responses_rewrite(
            ProxyResponse::buffered(
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::http::HeaderMap::new(),
                input.clone(),
            ),
            &ctx,
            &state,
            grok_namespace_restore_map(),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            input
        );
    }
}
