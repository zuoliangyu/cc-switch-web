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
    handler_config::{
        CLAUDE_PARSER_CONFIG, CODEX_PARSER_CONFIG, GEMINI_PARSER_CONFIG, OPENAI_PARSER_CONFIG,
    },
    handler_context::RequestContext,
    providers::{
        codex_chat_history::record_responses_sse_stream, get_adapter, get_claude_api_format,
        streaming::create_anthropic_sse_stream,
        streaming_codex_chat::create_responses_sse_stream_from_chat_with_context,
        streaming_gemini::create_anthropic_sse_stream_from_gemini,
        streaming_responses::create_anthropic_sse_stream_from_responses, transform,
        transform_codex_chat, transform_gemini, transform_responses,
    },
    response_processor::{
        create_logged_passthrough_stream, process_response, read_decoded_body,
        strip_entity_headers_for_rebuilt_body, SseUsageCollector,
    },
    server::ProxyState,
    types::*,
    usage::parser::TokenUsage,
    ProxyError,
};
use crate::app_config::AppType;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use bytes::Bytes;
use http_body_util::BodyExt;
use serde_json::{json, Value};

// ============================================================================
// 健康检查和状态查询（简单端点）
// ============================================================================

/// 健康检查
pub async fn health_check() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "healthy",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
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
    let response = crate::claude_desktop_config::model_list_response(provider)
        .map_err(|e| ProxyError::ConfigError(e.to_string()))?;
    Ok(Json(response))
}

/// 校验 Claude Desktop 本地 gateway 的 Bearer token（每请求验证）。
fn validate_claude_desktop_gateway_auth(
    state: &ProxyState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ProxyError> {
    let expected = crate::claude_desktop_config::get_or_create_gateway_token(state.db.as_ref())
        .map_err(|e| ProxyError::AuthError(e.to_string()))?;
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION) else {
        return Err(ProxyError::AuthError(
            "Claude Desktop gateway 缺少 Authorization 头".to_string(),
        ));
    };
    let value = value
        .to_str()
        .map_err(|_| ProxyError::AuthError("Authorization 头格式无效".to_string()))?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .unwrap_or("")
        .trim();
    if token != expected {
        return Err(ProxyError::AuthError(
            "Claude Desktop gateway token 无效".to_string(),
        ));
    }
    Ok(())
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, app_type.clone(), tag, app_type_str).await?;

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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let api_format = result
        .claude_api_format
        .as_deref()
        .unwrap_or_else(|| get_claude_api_format(&ctx.provider))
        .to_string();
    let response = result.response;

    // 检查是否需要格式转换（OpenRouter 等中转服务）
    let adapter = get_adapter(&app_type);
    let needs_transform = adapter.needs_transform(&ctx.provider);

    // Claude 特有：格式转换处理
    if needs_transform {
        return handle_claude_transform(response, &ctx, &state, &body, is_stream, &api_format)
            .await;
    }

    // 通用响应处理（透传模式）
    process_response(response, &ctx, &state, &CLAUDE_PARSER_CONFIG).await
}

/// Claude 格式转换处理（独有逻辑）
///
/// 支持 OpenAI Chat Completions 和 Responses API 两种格式的转换
async fn handle_claude_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    _original_body: &Value,
    is_stream: bool,
    api_format: &str,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    let use_streaming = should_use_claude_transform_streaming(
        is_stream,
        response.is_sse(),
        api_format,
        ctx.provider
            .meta
            .as_ref()
            .and_then(|meta| meta.provider_type.as_deref())
            == Some("codex_oauth"),
    );
    let tool_schema_hints = transform_gemini::extract_anthropic_tool_schema_hints(_original_body);
    let tool_schema_hints = (!tool_schema_hints.is_empty()).then_some(tool_schema_hints);

    if use_streaming {
        // 根据 api_format 选择流式转换器
        let stream = response.bytes_stream();
        let sse_stream: Box<
            dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send + Unpin,
        > = if api_format == "openai_responses" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_responses(stream)))
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

            SseUsageCollector::new(start_time, move |events, first_token_ms| {
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
            })
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

    let upstream_response: Value = serde_json::from_slice(&body_bytes).map_err(|e| {
        log::error!("[Claude] 解析上游响应失败: {e}, body: {body_str}");
        ProxyError::TransformError(format!("Failed to parse upstream response: {e}"))
    })?;

    // 根据 api_format 选择非流式转换器
    let anthropic_response = if api_format == "openai_responses" {
        transform_responses::responses_to_anthropic(upstream_response)
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

fn should_use_claude_transform_streaming(
    requested_stream: bool,
    upstream_is_sse: bool,
    api_format: &str,
    is_codex_oauth: bool,
) -> bool {
    if api_format == "gemini_native" {
        return requested_stream || upstream_is_sse;
    }

    if api_format == "openai_responses" && is_codex_oauth {
        // Codex OAuth 的 Responses 即使客户端没请求流式、上游也不是 SSE，
        // 仍需要走流式转换路径：Responses 协议下非流响应需要经过 transform
        // 才能被 Claude 客户端消费。
        return true;
    }

    requested_stream
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return build_codex_proxy_error_response(&ctx, &endpoint, &err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &OPENAI_PARSER_CONFIG).await
}

/// 处理 /v1/responses 请求（OpenAI Responses API - Codex CLI 透传）
pub async fn handle_responses(
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // 在 body 被 forward 移动前，从原始 Responses 请求抓取工具上下文（自定义工具名 /
    // namespace 映射），供 Chat→Responses 响应转换还原（跟随上游 2a4651a2）。
    let codex_tool_context = transform_codex_chat::build_codex_tool_context_from_request(&body);

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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return build_codex_proxy_error_response(&ctx, &endpoint, &err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    // 跟随上游 cc-switch 1c82b8a3：如果该 Codex provider 的真实上游走 OpenAI
    // Chat Completions，把上游回来的 Chat 响应/SSE 翻译回 Responses 格式再返给客户端。
    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG).await
}

/// 处理 /v1/responses/compact 请求（OpenAI Responses Compact API - Codex CLI 透传）
pub async fn handle_responses_compact(
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses/compact");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let codex_tool_context = transform_codex_chat::build_codex_tool_context_from_request(&body);

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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return build_codex_proxy_error_response(&ctx, &endpoint, &err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG).await
}

// ---------------------------------------------------------------------------
// Codex Chat Completions ↔ Responses 翻译（跟随上游 cc-switch 1c82b8a3 + 79d6486e + 09f67c1b）
//
// 触发条件：Codex provider 配置为 `apiFormat=openai_chat` 或 base_url 直接是
// /chat/completions，并且客户端访问的是 Responses 端点。forwarder 已经在出站
// 时把请求 body 从 Responses 转成 Chat、把 endpoint 改写到 /chat/completions；
// 这里负责把上游回来的 Chat 响应（JSON 或 SSE）再翻译成 Responses 格式给客户端。
//
// 与上游 src-tauri 的差异：cc-switch-web 没有 ActiveConnectionGuard 概念（不传 guard）；
// SseUsageCollector 是 2 参签名，上游的 codex_stream_usage_event_filter 仅做事件预筛，
// 这里 passthrough 本就只收集可解析的 data JSON，再用 from_codex_stream_events_auto 解析，
// 功能等价。tool_context 来自原始 Responses 请求，用于响应转换还原自定义工具名 / namespace。
// ---------------------------------------------------------------------------
async fn handle_codex_chat_to_responses_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
    tool_context: transform_codex_chat::CodexToolContext,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();

    // 上游 Chat 错误体形状与 Responses 不一致（如 MiniMax 的 base_resp、自定义 detail）；
    // 直接透传会让 Codex 客户端无法识别错误码。统一转换为 Responses 风格错误体，
    // 保留原始 HTTP 状态码（跟随上游 ead9e22b）。
    if !status.is_success() {
        return handle_codex_chat_error_response(response, ctx, status).await;
    }

    if is_stream || response.is_sse() {
        let stream = response.bytes_stream();
        let sse_stream = create_responses_sse_stream_from_chat_with_context(stream, tool_context);
        // 记录翻译后的 Responses SSE 历史，稳定后续请求的 cache/session 身份（跟随上游 22fbe6f1）
        let sse_stream = record_responses_sse_stream(sse_stream, state.codex_chat_history.clone());

        // Codex SSE usage 收集（补 0.8.0 遗留 TODO，跟随上游 5048ed63）。
        let logging_enabled = state
            .config
            .try_read()
            .map(|c| c.enable_logging)
            .unwrap_or(true);
        let usage_collector = if logging_enabled {
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let request_model = ctx.request_model.clone();
            let start_time = ctx.start_time;
            let status_code = status.as_u16();
            Some(SseUsageCollector::new(
                start_time,
                move |events, first_token_ms| {
                    let usage =
                        TokenUsage::from_codex_stream_events_auto(&events).unwrap_or_default();
                    let model = usage.model.clone().unwrap_or_else(|| request_model.clone());
                    let latency_ms = start_time.elapsed().as_millis() as u64;

                    let state = state.clone();
                    let provider_id = provider_id.clone();
                    let request_model = request_model.clone();

                    tokio::spawn(async move {
                        log_usage(
                            &state,
                            &provider_id,
                            "codex",
                            &model,
                            &request_model,
                            usage,
                            latency_ms,
                            first_token_ms,
                            true,
                            status_code,
                        )
                        .await;
                    });
                },
            ))
        } else {
            None
        };

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

    // 非流式：读 body → 解析 Chat JSON → 转 Responses JSON（带工具上下文）→ 记录历史 → 记 usage
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
        &tool_context,
    )
    .map_err(|e| {
        log::error!("[Codex] Chat → Responses 响应转换失败: {e}");
        e
    })?;
    state
        .codex_chat_history
        .record_response(&responses_response)
        .await;

    let logging_enabled = state
        .config
        .try_read()
        .map(|c| c.enable_logging)
        .unwrap_or(true);
    if logging_enabled {
        if let Some(usage) = TokenUsage::from_codex_response_auto(&responses_response) {
            let model = responses_response
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or(&ctx.request_model)
                .to_string();
            let request_model = ctx.request_model.clone();
            let latency_ms = ctx.start_time.elapsed().as_millis() as u64;
            let status_code = status.as_u16();
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            tokio::spawn(async move {
                log_usage(
                    &state,
                    &provider_id,
                    "codex",
                    &model,
                    &request_model,
                    usage,
                    latency_ms,
                    None,
                    false,
                    status_code,
                )
                .await;
            });
        }
    }

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

/// 把上游 Chat Completions 的错误响应转换为 Responses API 错误形状（跟随上游 ead9e22b）。
///
/// 正常响应已被改写成 Responses 形式；错误响应若仍保留 Chat 错误体（如 MiniMax 的
/// `{"base_resp": {"status_code": 2013}}`），Codex 客户端的错误处理就无法对齐字段。
/// 这里读取上游 body、规整成 `{"error": {message, type, code, param}}` 并保留原始状态码。
async fn handle_codex_chat_error_response(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    status: axum::http::StatusCode,
) -> Result<axum::response::Response, ProxyError> {
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, _status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    // 非 JSON 上游错误体（Cloudflare HTML、纯文本 "Unauthorized" 等）若丢成 None，
    // 客户端就看不到原始诊断信息；包成 Value::String 走转换函数的字符串分支。
    let parsed_value: Value = match serde_json::from_slice::<Value>(&body_bytes) {
        Ok(value) => value,
        Err(_) => {
            const MAX_RAW_ERROR_BYTES: usize = 1024;
            let lossy = String::from_utf8_lossy(&body_bytes);
            let truncated = if lossy.len() > MAX_RAW_ERROR_BYTES {
                let mut end = MAX_RAW_ERROR_BYTES;
                while end > 0 && !lossy.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}…(truncated)", &lossy[..end])
            } else {
                lossy.into_owned()
            };
            log::warn!("[Codex] Chat 错误响应不是合法 JSON，按文本透传: {truncated}");
            Value::String(truncated)
        }
    };

    let responses_error = transform_codex_chat::chat_error_to_response_error(Some(&parsed_value));

    strip_entity_headers_for_rebuilt_body(&mut response_headers);
    // Builder::header 是 append 语义；不先 remove 会和上游 Content-Type 双发。
    response_headers.remove(axum::http::header::CONTENT_TYPE);

    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }
    builder = builder.header(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );

    let body = serde_json::to_vec(&responses_error).map_err(|e| {
        log::error!("[Codex] 序列化 Responses 错误体失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize responses error: {e}"))
    })?;

    builder.body(axum::body::Body::from(body)).map_err(|e| {
        log::error!("[Codex] 构建 Responses 错误响应失败: {e}");
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &GEMINI_PARSER_CONFIG).await
}

// ============================================================================
// Codex 转发错误富化（跟随上游 f4e2c28a）
// ============================================================================

/// 把转发层（非上游响应）的失败构造成富化的 Codex 错误响应。
///
/// 与 `handle_codex_chat_error_response`（处理上游真实错误响应、复制上游头）不同，
/// 这里没有上游响应可参照，只产出一个 `application/json` 错误体。状态码走
/// `map_proxy_error_to_status`，该函数已与 `ProxyError::into_response` 对齐。
///
/// 注意：`endpoint` 经 `endpoint_with_query` 可能携带 query（如 `?beta=true`）并被
/// 原样写入错误体。当前 Codex 端点不在 query 里放凭证，故安全；若将来复用到
/// query 携带密钥的端点（如 Gemini 的 `?key=`），需先脱敏再回显。
fn build_codex_proxy_error_response(
    ctx: &RequestContext,
    endpoint: &str,
    error: &ProxyError,
) -> Result<axum::response::Response, ProxyError> {
    let status = axum::http::StatusCode::from_u16(map_proxy_error_to_status(error))
        .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    let body = codex_proxy_error_json(&ctx.provider.name, &ctx.request_model, endpoint, error);
    let body = serde_json::to_vec(&body).map_err(|e| {
        log::error!("[Codex] 序列化代理错误体失败: {e}");
        ProxyError::Internal(format!("Failed to serialize proxy error: {e}"))
    })?;

    axum::response::Response::builder()
        .status(status)
        .header(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("application/json"),
        )
        .body(axum::body::Body::from(body))
        .map_err(|e| {
            log::error!("[Codex] 构建代理错误响应失败: {e}");
            ProxyError::Internal(format!("Failed to build proxy error response: {e}"))
        })
}

fn codex_proxy_error_json(
    provider_name: &str,
    request_model: &str,
    endpoint: &str,
    error: &ProxyError,
) -> Value {
    let (mut body, upstream_status) = match error {
        ProxyError::UpstreamError { status, body } => {
            let parsed_body = body
                .as_deref()
                .map(|body| serde_json::from_str::<Value>(body).unwrap_or_else(|_| json!(body)));
            (
                transform_codex_chat::chat_error_to_response_error(parsed_body.as_ref()),
                Some(*status),
            )
        }
        _ => (
            json!({
                "error": {
                    "message": get_error_message(error),
                    "type": "proxy_error",
                    "code": codex_proxy_error_code(error),
                    "param": Value::Null,
                }
            }),
            None,
        ),
    };

    let Some(error_obj) = body.get_mut("error").and_then(|value| value.as_object_mut()) else {
        return body;
    };

    let cause = error_obj
        .get("message")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| get_error_message(error));

    let status_fragment = upstream_status
        .map(|status| format!("; upstream_status: HTTP {status}"))
        .unwrap_or_default();
    let message = format!(
        "CC Switch local proxy failed while handling Codex endpoint {endpoint}. Provider: {provider_name}; model: {request_model}{status_fragment}; cause: {cause}"
    );

    error_obj.insert(
        "message".to_string(),
        Value::String(compact_error_message(&message, 1800)),
    );

    if error_obj
        .get("type")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        error_obj.insert("type".to_string(), Value::String("proxy_error".to_string()));
    }

    if error_obj.get("code").map(Value::is_null).unwrap_or(true) {
        error_obj.insert(
            "code".to_string(),
            Value::String(codex_proxy_error_code(error).to_string()),
        );
    }

    if !error_obj.contains_key("param") {
        error_obj.insert("param".to_string(), Value::Null);
    }

    error_obj.insert(
        "provider".to_string(),
        Value::String(provider_name.to_string()),
    );
    error_obj.insert("model".to_string(), Value::String(request_model.to_string()));
    // 仅用于 Codex 本地路由；不要复用到 query 可能携带凭证的端点。
    error_obj.insert("endpoint".to_string(), Value::String(endpoint.to_string()));
    if let Some(status) = upstream_status {
        error_obj.insert(
            "upstream_status".to_string(),
            Value::Number(serde_json::Number::from(status)),
        );
    }

    body
}

/// 稳定的 cc_switch_* 错误码。web 的 ProxyError 枚举缺上游的 StreamIdleTimeout /
/// ProviderUnhealthy / InvalidRequest，服务状态/绑定类错误统一归 proxy_error。
fn codex_proxy_error_code(error: &ProxyError) -> &'static str {
    match error {
        ProxyError::ForwardFailed(_) => "cc_switch_forward_failed",
        ProxyError::Timeout(_) => "cc_switch_timeout",
        ProxyError::NoAvailableProvider => "cc_switch_no_available_provider",
        ProxyError::AllProvidersCircuitOpen => "cc_switch_all_providers_circuit_open",
        ProxyError::NoProvidersConfigured => "cc_switch_no_providers_configured",
        ProxyError::MaxRetriesExceeded => "cc_switch_max_retries_exceeded",
        ProxyError::ConfigError(_) => "cc_switch_config_error",
        ProxyError::TransformError(_) => "cc_switch_transform_error",
        ProxyError::AuthError(_) => "cc_switch_auth_error",
        ProxyError::UpstreamError { .. } => "cc_switch_upstream_error",
        ProxyError::DatabaseError(_) => "cc_switch_database_error",
        ProxyError::Internal(_) => "cc_switch_internal_error",
        _ => "cc_switch_proxy_error",
    }
}

fn compact_error_message(message: &str, max_chars: usize) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let truncated = normalized
        .chars()
        .take(max_chars)
        .collect::<String>()
        .trim_end()
        .to_string();
    format!("{truncated}…(truncated)")
}

// ============================================================================
// 使用量记录（保留用于 Claude 转换逻辑）
// ============================================================================

fn log_forward_error(
    state: &ProxyState,
    ctx: &RequestContext,
    is_streaming: bool,
    error: &ProxyError,
) {
    use super::usage::logger::UsageLogger;

    let logger = UsageLogger::new(&state.db);
    let status_code = map_proxy_error_to_status(error);
    let error_message = get_error_message(error);
    let request_id = uuid::Uuid::new_v4().to_string();

    if let Err(e) = logger.log_error_with_context(
        request_id,
        ctx.provider.id.clone(),
        ctx.app_type_str.to_string(),
        ctx.request_model.clone(),
        status_code,
        error_message,
        ctx.latency_ms(),
        is_streaming,
        Some(ctx.session_id.clone()),
        None,
    ) {
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

    let logger = UsageLogger::new(&state.db);

    let (multiplier, pricing_model_source) =
        logger.resolve_pricing_config(provider_id, app_type).await;
    let pricing_model = if pricing_model_source == "request" {
        request_model
    } else {
        model
    };

    // 使用 dedup_request_id() 让 proxy 写入与 session-log 同步共享同一 request_id
    // （Claude API 上是 `session:msg_xxx`），主键 INSERT OR REPLACE 自动去重；
    // 没拿到 message_id 时回退随机 UUID（与 session log 不可能撞上）。
    let request_id = usage.dedup_request_id();

    if let Err(e) = logger.log_with_calculation(
        request_id,
        provider_id.to_string(),
        app_type.to_string(),
        model.to_string(),
        request_model.to_string(),
        pricing_model.to_string(),
        usage,
        multiplier,
        latency_ms,
        first_token_ms,
        status_code,
        None,
        None, // provider_type
        is_streaming,
    ) {
        log::warn!("[USG-001] 记录使用量失败: {e}");
    }
}
