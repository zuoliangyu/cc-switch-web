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
        get_adapter, get_claude_api_format,
        streaming::create_anthropic_sse_stream,
        streaming_codex_anthropic::{
            create_responses_sse_stream_from_anthropic_with_context,
            responses_sse_events_from_anthropic_message,
        },
        streaming_codex_chat::create_responses_sse_stream_from_chat,
        streaming_gemini::create_anthropic_sse_stream_from_gemini,
        streaming_responses::{
            create_anthropic_sse_stream_from_responses,
            create_anthropic_sse_stream_from_responses_with_web_search_options,
        },
        transform, transform_codex_anthropic, transform_codex_chat,
        transform_codex_responses_namespace, transform_gemini, transform_responses,
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
    original_body: &Value,
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
            return Err(err.error);
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, app_type.clone(), tag, app_type_str).await?;
    let endpoint = endpoint_with_query(&uri, "/responses");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let codex_tool_context =
        transform_codex_chat::build_codex_tool_context_from_request(&body);
    let namespace_restore_map = transform_codex_responses_namespace::namespace_restore_map(&body);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    // 跟随上游 cc-switch 1c82b8a3：如果该 Codex provider 的真实上游走 OpenAI
    // Chat Completions，把上游回来的 Chat 响应/SSE 翻译回 Responses 格式再返给客户端。
    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(response, &ctx, &state, is_stream).await;
    }
    if super::providers::should_convert_codex_responses_to_anthropic(&ctx.provider, &endpoint) {
        return handle_codex_anthropic_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    if super::providers::provider_needs_responses_namespace_flatten(&ctx.provider)
        && !namespace_restore_map.is_empty()
    {
        return handle_codex_responses_namespace_restore(
            response,
            &ctx,
            &state,
            namespace_restore_map,
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/alpha/search");

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
            log_forward_error(&state, &ctx, false, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    process_response(result.response, &ctx, &state, &CODEX_PARSER_CONFIG).await
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

    let mut ctx =
        RequestContext::new(&state, &body, &headers, app_type.clone(), tag, app_type_str).await?;
    let endpoint = endpoint_with_query(&uri, "/responses/compact");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let codex_tool_context =
        transform_codex_chat::build_codex_tool_context_from_request(&body);
    let namespace_restore_map = transform_codex_responses_namespace::namespace_restore_map(&body);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(response, &ctx, &state, is_stream).await;
    }
    if super::providers::should_convert_codex_responses_to_anthropic(&ctx.provider, &endpoint) {
        return handle_codex_anthropic_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            codex_tool_context,
        )
        .await;
    }
    if super::providers::provider_needs_responses_namespace_flatten(&ctx.provider)
        && !namespace_restore_map.is_empty()
    {
        return handle_codex_responses_namespace_restore(
            response,
            &ctx,
            &state,
            namespace_restore_map,
        )
        .await;
    }

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG).await
}

async fn handle_codex_responses_namespace_restore(
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
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG).await;
    }

    if response.is_sse() {
        let mut builder = axum::response::Response::builder().status(status);
        for (key, value) in response.headers() {
            builder = builder.header(key, value);
        }

        let stream = transform_codex_responses_namespace::create_namespace_restore_sse_stream(
            response.bytes_stream(),
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
async fn handle_codex_chat_to_responses_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();

    // 失败响应原样透传（让客户端看到真实上游错误）
    if !status.is_success() {
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG).await;
    }

    if is_stream || response.is_sse() {
        let stream = response.bytes_stream();
        let sse_stream = create_responses_sse_stream_from_chat(stream);

        // TODO: 待补 Codex SSE usage 收集（需要在 SseUsageCollector 上加流事件过滤路径）
        let usage_collector: Option<SseUsageCollector> = None;

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
    let responses_response =
        transform_codex_chat::chat_completion_to_response(chat_response).map_err(|e| {
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
        return process_response(response, ctx, state, &CODEX_PARSER_CONFIG).await;
    }

    if response.is_sse() || (is_stream && !response.is_json()) {
        let stream = response.bytes_stream();
        let sse_stream =
            create_responses_sse_stream_from_anthropic_with_context(stream, codex_tool_context);
        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            None,
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
        Err(_) if body_text.lines().any(|line| {
            line.trim_start().starts_with("event:") || line.trim_start().starts_with("data:")
        }) => transform_codex_anthropic::anthropic_sse_to_message_value(&body_text)?,
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
        let events = responses_sse_events_from_anthropic_message(
            &anthropic_response,
            codex_tool_context,
        );
        let sse_stream =
            futures::stream::iter(events.into_iter().map(Ok::<Bytes, std::io::Error>));
        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            None,
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
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &GEMINI_PARSER_CONFIG).await
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

    let dedup_scope = super::usage::parser::dedup_scope_for_app(app_type, provider_id);
    let request_id = usage.dedup_request_id(dedup_scope);

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
