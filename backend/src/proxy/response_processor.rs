//! 响应处理器模块
//!
//! 统一处理流式和非流式 API 响应

use super::{
    content_encoding::{decompress_body_with_limit, get_content_encoding, DecompressError},
    handler_config::{StreamUsageEventFilter, UsageParserConfig},
    handler_context::{RequestContext, StreamingTimeoutConfig},
    hyper_client::{ProxyResponse, MAX_RESPONSE_BODY_BYTES},
    server::ProxyState,
    sse::{strip_sse_field, SseBuffer},
    usage::parser::TokenUsage,
    ProxyError,
};
use axum::http::header::HeaderMap;
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures::stream::{Stream, StreamExt};
use serde_json::Value;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
use tokio::sync::Mutex;

/// 移除在重建响应体后会失真的实体头。
pub(crate) fn strip_entity_headers_for_rebuilt_body(headers: &mut HeaderMap) {
    headers.remove(axum::http::header::CONTENT_ENCODING);
    headers.remove(axum::http::header::CONTENT_LENGTH);
    headers.remove(axum::http::header::TRANSFER_ENCODING);
}

/// 读取响应体并在需要时解压，确保 headers 与返回 body 一致。
///
/// `body_timeout`: 整包超时。当非零时用 `tokio::time::timeout` 包住 `.bytes()` 调用，
/// 防止上游发完响应头后卡住 body 导致请求永远挂住。
/// 传入 `Duration::ZERO` 表示不启用超时（故障转移关闭时）。
pub(crate) async fn read_decoded_body(
    response: ProxyResponse,
    tag: &str,
    body_timeout: Duration,
) -> Result<(HeaderMap, http::StatusCode, Bytes), ProxyError> {
    let mut headers = response.headers().clone();
    let status = response.status();
    let bytes_future = response.bytes_with_limit(MAX_RESPONSE_BODY_BYTES);
    let raw_bytes = if body_timeout.is_zero() {
        bytes_future.await?
    } else {
        tokio::time::timeout(body_timeout, bytes_future)
            .await
            .map_err(|_| {
                ProxyError::Timeout(format!(
                    "响应体读取超时: {}s（上游发完响应头后 body 未到达）",
                    body_timeout.as_secs()
                ))
            })??
    };

    log::debug!(
        "[{tag}] 已接收上游响应体: status={}, bytes={}, headers={}",
        status.as_u16(),
        raw_bytes.len(),
        format_headers(&headers)
    );

    let mut body_bytes = raw_bytes.clone();
    let mut decoded = false;

    if let Some(encoding) = get_content_encoding(&headers) {
        log::debug!("[{tag}] 解压非流式响应: content-encoding={encoding}");
        match decompress_body_with_limit(&encoding, &raw_bytes, MAX_RESPONSE_BODY_BYTES) {
            Ok(Some(decompressed)) => {
                body_bytes = Bytes::from(decompressed);
                decoded = true;
            }
            Ok(None) => {}
            Err(DecompressError::TooLarge { .. }) => {
                return Err(ProxyError::ResponseBodyTooLarge(MAX_RESPONSE_BODY_BYTES));
            }
            Err(DecompressError::Io(e)) => {
                log::warn!("[{tag}] 解压失败 ({encoding}): {e}，使用原始数据");
            }
        }
    }

    if decoded {
        strip_entity_headers_for_rebuilt_body(&mut headers);
    }

    Ok((headers, status, body_bytes))
}

// ============================================================================
// 公共接口
// ============================================================================

/// 优先尊重上游声明的类型；仅对成功且缺类型头的流式请求补判为 SSE。
#[inline]
pub fn is_sse_response(response: &ProxyResponse, request_is_stream: bool) -> bool {
    response.is_sse()
        || (request_is_stream
            && response.status().is_success()
            && response.content_type().is_none())
}

/// 处理流式响应
pub async fn handle_streaming(
    response: ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    parser_config: &UsageParserConfig,
) -> Response {
    let status = response.status();
    log::debug!(
        "[{}] 已接收上游流式响应: status={}, headers={}",
        ctx.tag,
        status.as_u16(),
        format_headers(response.headers())
    );
    // 检查流式响应是否被压缩（SSE 通常不压缩，如果压缩则 SSE 解析会失败）
    if let Some(encoding) = get_content_encoding(response.headers()) {
        log::warn!(
            "[{}] 流式响应含 content-encoding={encoding}，SSE 解析可能失败。\
             上游在 accept-encoding 透传后压缩了 SSE 流。",
            ctx.tag
        );
    }

    let mut builder = axum::response::Response::builder().status(status);

    // 复制响应头
    for (key, value) in response.headers() {
        builder = builder.header(key, value);
    }

    // 创建字节流
    let stream = response.bytes_stream();

    // 创建使用量收集器
    let usage_collector = create_usage_collector(ctx, state, status.as_u16(), parser_config);

    // 获取流式超时配置
    let timeout_config = ctx.streaming_timeout_config();

    // 创建带日志和超时的透传流
    let logged_stream =
        create_logged_passthrough_stream(stream, ctx.tag, Some(usage_collector), timeout_config);

    let body = axum::body::Body::from_stream(logged_stream);
    match builder.body(body) {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("[{}] 构建流式响应失败: {e}", ctx.tag);
            ProxyError::Internal(format!("Failed to build streaming response: {e}")).into_response()
        }
    }
}

/// 处理非流式响应
pub async fn handle_non_streaming(
    response: ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    parser_config: &UsageParserConfig,
) -> Result<Response, ProxyError> {
    // 整包超时：仅在故障转移开启且配置值非零时生效
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            Duration::ZERO
        };
    let (response_headers, status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    log::debug!(
        "[{}] 上游响应体内容: {}",
        ctx.tag,
        String::from_utf8_lossy(&body_bytes)
    );

    // 解析并记录使用量
    if let Ok(json_value) = serde_json::from_slice::<Value>(&body_bytes) {
        // 解析使用量
        if let Some(usage) = (parser_config.response_parser)(&json_value) {
            // 优先使用 usage 中解析出的模型名称，其次使用响应中的 model 字段，最后回退到请求模型
            let model = if let Some(ref m) = usage.model {
                m.clone()
            } else if let Some(m) = json_value.get("model").and_then(|m| m.as_str()) {
                m.to_string()
            } else {
                ctx.request_model.clone()
            };

            spawn_log_usage(
                state,
                ctx,
                usage,
                &model,
                &ctx.request_model,
                status.as_u16(),
                false,
            );
        } else {
            let model = json_value
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or(&ctx.request_model)
                .to_string();
            spawn_log_usage(
                state,
                ctx,
                TokenUsage::default(),
                &model,
                &ctx.request_model,
                status.as_u16(),
                false,
            );
            log::debug!(
                "[{}] 未能解析 usage 信息，跳过记录",
                parser_config.app_type_str
            );
        }
    } else {
        log::debug!(
            "[{}] <<< 响应 (非 JSON): {} bytes",
            ctx.tag,
            body_bytes.len()
        );
        spawn_log_usage(
            state,
            ctx,
            TokenUsage::default(),
            &ctx.request_model,
            &ctx.request_model,
            status.as_u16(),
            false,
        );
    }

    // 构建响应
    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }

    let body = axum::body::Body::from(body_bytes);
    builder.body(body).map_err(|e| {
        log::error!("[{}] 构建响应失败: {e}", ctx.tag);
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
}

/// 通用响应处理入口
///
/// 根据响应类型自动选择流式或非流式处理
pub async fn process_response(
    response: ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    parser_config: &UsageParserConfig,
    request_is_stream: bool,
) -> Result<Response, ProxyError> {
    if is_sse_response(&response, request_is_stream) {
        Ok(handle_streaming(response, ctx, state, parser_config).await)
    } else {
        handle_non_streaming(response, ctx, state, parser_config).await
    }
}

// ============================================================================
// SSE 使用量收集器
// ============================================================================

type UsageCallbackWithTiming = Arc<dyn Fn(Vec<Value>, Option<u64>) + Send + Sync + 'static>;

/// SSE 使用量收集器
#[derive(Clone)]
pub struct SseUsageCollector {
    inner: Arc<SseUsageCollectorInner>,
}

struct SseUsageCollectorInner {
    events: Mutex<Vec<Value>>,
    first_output_time: OnceLock<std::time::Instant>,
    start_time: std::time::Instant,
    on_complete: UsageCallbackWithTiming,
    should_collect: Option<StreamUsageEventFilter>,
    finished: AtomicBool,
}

impl SseUsageCollector {
    /// 创建使用量收集器；`should_collect` 用来在 hot path 跳过与 usage 无关的事件。
    pub fn new(
        start_time: std::time::Instant,
        should_collect: Option<StreamUsageEventFilter>,
        callback: impl Fn(Vec<Value>, Option<u64>) + Send + Sync + 'static,
    ) -> Self {
        let on_complete: UsageCallbackWithTiming = Arc::new(callback);
        Self {
            inner: Arc::new(SseUsageCollectorInner {
                events: Mutex::new(Vec::new()),
                first_output_time: OnceLock::new(),
                start_time,
                on_complete,
                should_collect,
                finished: AtomicBool::new(false),
            }),
        }
    }

    pub fn should_collect(&self, data: &str) -> bool {
        self.inner
            .should_collect
            .map(|filter| filter(data))
            .unwrap_or(true)
    }

    /// 观察一行 SSE data，记下首个输出事件的时间（`first_token_ms`）。
    ///
    /// 必须对每一行 data 调用，不能只看 usage 过滤器收下的事件：过滤器只挑带
    /// usage 的事件，上游的开头事件不带 usage 时，首个被收下的就是结尾的
    /// completed，生成时长被压到几毫秒，TPS 随之虚高。
    pub fn observe_data(&self, event_name: Option<&str>, data: &str) {
        if self.inner.first_output_time.get().is_some() {
            return;
        }
        if sse_data_starts_output(event_name, data) {
            let _ = self.inner.first_output_time.set(std::time::Instant::now());
        }
    }

    /// 推送 SSE 事件
    pub async fn push(&self, event: Value) {
        let mut events = self.inner.events.lock().await;
        events.push(event);
    }

    /// 完成收集并触发回调
    pub async fn finish(&self) {
        if self.inner.finished.swap(true, Ordering::SeqCst) {
            return;
        }

        let events = {
            let mut guard = self.inner.events.lock().await;
            std::mem::take(&mut *guard)
        };

        let first_token_ms = self
            .inner
            .first_output_time
            .get()
            .map(|t| (*t - self.inner.start_time).as_millis() as u64);

        (self.inner.on_complete)(events, first_token_ms);
    }
}

/// 判断一行 SSE data 是否标志着模型开始输出（口径同 Sub2API 的 semantic TTFT）：
/// 跳过只宣告响应开始或保活的元数据事件，其余非空事件都算。Chat Completions /
/// Gemini 的分块没有事件类型，一律算。
fn sse_data_starts_output(event_name: Option<&str>, data: &str) -> bool {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return false;
    }
    let event_type = match event_name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.to_string(),
        None => serde_json::from_str::<Value>(data)
            .ok()
            .and_then(|value| value.get("type")?.as_str().map(str::to_string))
            .unwrap_or_default(),
    };
    !matches!(
        event_type.as_str(),
        "response.created" | "response.in_progress" | "ping" | "keepalive"
    )
}

struct SseUsageFinishGuard {
    collector: Option<SseUsageCollector>,
}

impl SseUsageFinishGuard {
    fn new(collector: SseUsageCollector) -> Self {
        Self {
            collector: Some(collector),
        }
    }

    fn disarm(&mut self) {
        self.collector = None;
    }
}

impl Drop for SseUsageFinishGuard {
    fn drop(&mut self) {
        if let Some(collector) = self.collector.take() {
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    collector.finish().await;
                });
            } else {
                log::warn!("SSE 用量收尾保护触发时 Tokio runtime 不可用，跳过异步 finish");
            }
        }
    }
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/// 创建使用量收集器
pub(crate) fn create_usage_collector(
    ctx: &RequestContext,
    state: &ProxyState,
    status_code: u16,
    parser_config: &UsageParserConfig,
) -> SseUsageCollector {
    let logging_enabled = state
        .config
        .try_read()
        .map(|c| c.enable_logging)
        .unwrap_or(true);
    let state = state.clone();
    let provider_id = ctx.provider.id.clone();
    let request_model = ctx.request_model.clone();
    let app_type_str = parser_config.app_type_str;
    let tag = ctx.tag;
    let start_time = ctx.start_time;
    let stream_parser = parser_config.stream_parser;
    let model_extractor = parser_config.model_extractor;
    let session_id = ctx.session_id.clone();

    SseUsageCollector::new(
        start_time,
        parser_config.stream_event_filter,
        move |events, first_token_ms| {
            if !logging_enabled {
                return;
            }
            if let Some(usage) = stream_parser(&events) {
                let model = model_extractor(&events, &request_model);
                let latency_ms = start_time.elapsed().as_millis() as u64;

                let state = state.clone();
                let provider_id = provider_id.clone();
                let session_id = session_id.clone();
                let request_model = request_model.clone();

                tokio::spawn(async move {
                    log_usage_internal(
                        &state,
                        &provider_id,
                        app_type_str,
                        &model,
                        &request_model,
                        usage,
                        latency_ms,
                        first_token_ms,
                        true, // is_streaming
                        status_code,
                        Some(session_id),
                    )
                    .await;
                });
            } else {
                let model = model_extractor(&events, &request_model);
                let latency_ms = start_time.elapsed().as_millis() as u64;
                let state = state.clone();
                let provider_id = provider_id.clone();
                let session_id = session_id.clone();
                let request_model = request_model.clone();

                tokio::spawn(async move {
                    log_usage_internal(
                        &state,
                        &provider_id,
                        app_type_str,
                        &model,
                        &request_model,
                        TokenUsage::default(),
                        latency_ms,
                        first_token_ms,
                        true, // is_streaming
                        status_code,
                        Some(session_id),
                    )
                    .await;
                });
                log::debug!("[{tag}] 流式响应缺少 usage 统计，跳过消费记录");
            }
        },
    )
}

/// 异步记录使用量
fn spawn_log_usage(
    state: &ProxyState,
    ctx: &RequestContext,
    usage: TokenUsage,
    model: &str,
    request_model: &str,
    status_code: u16,
    is_streaming: bool,
) {
    // Check enable_logging before spawning the log task
    if let Ok(config) = state.config.try_read() {
        if !config.enable_logging {
            return;
        }
    }

    let state = state.clone();
    let provider_id = ctx.provider.id.clone();
    let app_type_str = ctx.app_type_str.to_string();
    let model = model.to_string();
    let request_model = request_model.to_string();
    let latency_ms = ctx.latency_ms();
    let session_id = ctx.session_id.clone();

    tokio::spawn(async move {
        log_usage_internal(
            &state,
            &provider_id,
            &app_type_str,
            &model,
            &request_model,
            usage,
            latency_ms,
            None,
            is_streaming,
            status_code,
            Some(session_id),
        )
        .await;
    });
}

/// 内部使用量记录函数
#[allow(clippy::too_many_arguments)]
async fn log_usage_internal(
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
    session_id: Option<String>,
) {
    use super::usage::logger::UsageLogger;

    let dedup_scope = super::usage::parser::dedup_scope_for_app(app_type, provider_id);
    let request_id = usage.dedup_request_id(dedup_scope);

    log::debug!(
        "[{app_type}] 记录请求日志: id={request_id}, provider={provider_id}, model={model}, streaming={is_streaming}, status={status_code}, latency_ms={latency_ms}, first_token_ms={first_token_ms:?}, session={}, input={}, output={}, cache_read={}, cache_creation={}",
        session_id.as_deref().unwrap_or("none"),
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_tokens,
        usage.cache_creation_tokens
    );

    // #7818：使用量写入要拿 Database 的单把 std::sync::Mutex<Connection> 并做
    // 磁盘 IO，同步执行会卡住 tokio worker，移到阻塞线程池执行。计费模式
    // 读取走同一把锁，一并移入。
    let db = state.db.clone();
    let provider_id = provider_id.to_string();
    let app_type = app_type.to_string();
    let model = model.to_string();
    let request_model = request_model.to_string();
    let runtime = tokio::runtime::Handle::current();
    let write = tokio::task::spawn_blocking(move || {
        let logger = UsageLogger::new(&db);
        // 计费模式读取的 DAO 是伪 async（无真实挂起点、直接取阻塞锁），
        // 在阻塞线程上 block_on 不会停转运行时
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
            session_id,
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

/// 创建带日志记录和超时控制的透传流
pub fn create_logged_passthrough_stream(
    stream: impl Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static,
    tag: &'static str,
    usage_collector: Option<SseUsageCollector>,
    timeout_config: StreamingTimeoutConfig,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send {
    async_stream::stream! {
        let mut sse = SseBuffer::new();
        let mut collector = usage_collector;
        let mut finish_guard = collector.clone().map(SseUsageFinishGuard::new);
        let inspect_sse_events =
            collector.is_some() || log::log_enabled!(log::Level::Debug);
        let mut is_first_chunk = true;

        // 超时配置
        let first_byte_timeout = if timeout_config.first_byte_timeout > 0 {
            Some(Duration::from_secs(timeout_config.first_byte_timeout))
        } else {
            None
        };
        let idle_timeout = if timeout_config.idle_timeout > 0 {
            Some(Duration::from_secs(timeout_config.idle_timeout))
        } else {
            None
        };

        tokio::pin!(stream);

        loop {
            // 选择超时时间：首字节超时或静默期超时
            let timeout_duration = if is_first_chunk {
                first_byte_timeout
            } else {
                idle_timeout
            };

            let chunk_result = match timeout_duration {
                Some(duration) => {
                    match tokio::time::timeout(duration, stream.next()).await {
                        Ok(Some(chunk)) => Some(chunk),
                        Ok(None) => None, // 流结束
                        Err(_) => {
                            // 超时
                            let timeout_type = if is_first_chunk { "首字节" } else { "静默期" };
                            log::error!("[{tag}] 流式响应{}超时 ({}秒)", timeout_type, duration.as_secs());
                            yield Err(std::io::Error::other(format!("流式响应{timeout_type}超时")));
                            break;
                        }
                    }
                }
                None => stream.next().await, // 无超时限制
            };

            match chunk_result {
                Some(Ok(bytes)) => {
                    if is_first_chunk {
                        log::debug!(
                            "[{tag}] 已接收上游流式首包: bytes={}",
                            bytes.len()
                        );
                    }
                    is_first_chunk = false;
                    if inspect_sse_events {
                        sse.push_bytes(&bytes);

                        // 尝试解析并记录完整的 SSE 事件
                        while let Some(event_text) = sse.next_block() {
                            if !event_text.trim().is_empty() {
                                let event_name = event_text
                                    .lines()
                                    .find_map(|line| strip_sse_field(line, "event"));
                                // 提取 data 部分；只有 usage collector 存在时才解析 JSON。
                                for line in event_text.lines() {
                                    if let Some(data) = strip_sse_field(line, "data") {
                                        if let Some(c) = &collector {
                                            c.observe_data(event_name, data);
                                        }
                                        if data.trim() != "[DONE]" {
                                            let collected = match &collector {
                                                Some(c) if c.should_collect(data) => {
                                                    match serde_json::from_str::<Value>(data) {
                                                        Ok(json_value) => {
                                                            c.push(json_value).await;
                                                            true
                                                        }
                                                        Err(_) => false,
                                                    }
                                                }
                                                _ => false,
                                            };
                                            log::trace!(
                                                "[{tag}] <<< SSE data: bytes={}, usage_collected={collected} (content omitted)",
                                                data.len()
                                            );
                                        } else {
                                            log::debug!("[{tag}] <<< SSE: [DONE]");
                                        }
                                    }
                                }
                            }
                        }
                    }

                    yield Ok(bytes);
                }
                Some(Err(e)) => {
                    log::error!("[{tag}] 流错误: {e}");
                    yield Err(std::io::Error::other(e.to_string()));
                    break;
                }
                None => {
                    // 流正常结束
                    break;
                }
            }
        }

        if let Some(c) = collector.take() {
            c.finish().await;
        }
        if let Some(guard) = &mut finish_guard {
            guard.disarm();
        }
    }
}

fn format_headers(headers: &HeaderMap) -> String {
    headers
        .iter()
        .map(|(key, value)| {
            let value_str = value.to_str().unwrap_or("<non-utf8>");
            format!("{key}={value_str}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::error::AppError;
    use crate::provider::ProviderMeta;
    use crate::proxy::failover_switch::FailoverSwitchManager;
    use crate::proxy::provider_router::ProviderRouter;
    use crate::proxy::types::{ProxyConfig, ProxyStatus};
    use rust_decimal::Decimal;
    use std::collections::HashMap;
    use std::str::FromStr;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[test]
    fn sse_data_starts_output_skips_metadata_events() {
        assert!(!sse_data_starts_output(
            Some("response.created"),
            r#"{"type":"response.created"}"#
        ));
        assert!(!sse_data_starts_output(
            None,
            r#"{"type":"response.in_progress","response":{}}"#
        ));
        assert!(!sse_data_starts_output(Some("ping"), r#"{"type":"ping"}"#));
        assert!(!sse_data_starts_output(None, "[DONE]"));
        assert!(!sse_data_starts_output(None, "  "));

        assert!(sse_data_starts_output(
            Some("response.output_text.delta"),
            r#"{"type":"response.output_text.delta","delta":"hi"}"#
        ));
        assert!(sse_data_starts_output(
            Some("message_start"),
            r#"{"type":"message_start"}"#
        ));
        // Chat Completions / Gemini 分块没有事件类型
        assert!(sse_data_starts_output(
            None,
            r#"{"choices":[{"delta":{"content":"hi"}}]}"#
        ));
    }

    /// 回归：上游 response.created 不带 usage 时，首个被 usage 过滤器收下的是
    /// 结尾的 completed；首 token 时间必须仍落在首个输出事件上。
    #[tokio::test]
    async fn first_token_ms_tracks_first_output_not_first_usage_event() {
        let start = std::time::Instant::now();
        let recorded = Arc::new(std::sync::Mutex::new(None));
        let recorded_in_cb = recorded.clone();
        let collector = SseUsageCollector::new(
            start,
            Some(super::super::handler_config::codex_stream_usage_event_filter),
            move |events, first_token_ms| {
                *recorded_in_cb.lock().unwrap() = Some((
                    events.len(),
                    first_token_ms,
                    start.elapsed().as_millis() as u64,
                ));
            },
        );

        let upstream = async_stream::stream! {
            yield Ok::<_, std::io::Error>(Bytes::from(
                "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{}}\n\n",
            ));
            tokio::time::sleep(Duration::from_millis(60)).await;
            yield Ok(Bytes::from(
                "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n",
            ));
            tokio::time::sleep(Duration::from_millis(60)).await;
            yield Ok(Bytes::from(
                "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}}\n\n",
            ));
        };
        let stream = create_logged_passthrough_stream(
            upstream,
            "test",
            Some(collector),
            StreamingTimeoutConfig {
                first_byte_timeout: 0,
                idle_timeout: 0,
            },
        );
        futures::pin_mut!(stream);
        while stream.next().await.is_some() {}

        let (collected, first_token_ms, latency_ms) =
            recorded.lock().unwrap().expect("collector finished");
        assert_eq!(collected, 1, "only the completed event carries usage");
        let first_token_ms = first_token_ms.expect("first output recorded");
        assert!(first_token_ms >= 50, "first_token_ms={first_token_ms}");
        assert!(
            latency_ms >= first_token_ms + 50,
            "first_token_ms={first_token_ms}, latency_ms={latency_ms}"
        );
    }

    fn response_with_content_type(
        status: http::StatusCode,
        content_type: Option<&'static str>,
    ) -> ProxyResponse {
        let mut headers = HeaderMap::new();
        if let Some(content_type) = content_type {
            headers.insert("content-type", content_type.parse().unwrap());
        }
        ProxyResponse::buffered(status, headers, Bytes::new())
    }

    #[test]
    fn stream_request_without_content_type_is_treated_as_sse() {
        // chatgpt.com 的 Codex Responses 回包不带 Content-Type。
        let response = response_with_content_type(http::StatusCode::OK, None);
        assert!(is_sse_response(&response, true));
        assert!(!is_sse_response(&response, false));
    }

    #[test]
    fn declared_content_type_wins_over_stream_flag() {
        let sse = response_with_content_type(
            http::StatusCode::OK,
            Some("text/event-stream;charset=utf-8"),
        );
        assert!(is_sse_response(&sse, false));

        // 网关忽略 stream: true 时回的 JSON（无论标成什么）仍按整包解析用量。
        for content_type in ["application/json", "text/plain"] {
            let response = response_with_content_type(http::StatusCode::OK, Some(content_type));
            assert!(!is_sse_response(&response, true), "{content_type}");
        }
    }

    #[test]
    fn stream_request_error_without_content_type_stays_buffered() {
        let response = response_with_content_type(http::StatusCode::BAD_REQUEST, None);
        assert!(!is_sse_response(&response, true));
    }

    #[test]
    fn test_strip_sse_field_accepts_optional_space() {
        assert_eq!(
            super::strip_sse_field("data: {\"ok\":true}", "data"),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            super::strip_sse_field("data:{\"ok\":true}", "data"),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            super::strip_sse_field("event: message_start", "event"),
            Some("message_start")
        );
        assert_eq!(
            super::strip_sse_field("event:message_start", "event"),
            Some("message_start")
        );
        assert_eq!(super::strip_sse_field("id:1", "data"), None);
    }

    fn build_state(db: Arc<Database>) -> ProxyState {
        ProxyState {
            db: db.clone(),
            config: Arc::new(RwLock::new(ProxyConfig::default())),
            status: Arc::new(RwLock::new(ProxyStatus::default())),
            start_time: Arc::new(RwLock::new(None)),
            current_providers: Arc::new(RwLock::new(HashMap::new())),
            provider_router: Arc::new(ProviderRouter::new(db.clone())),
            copilot_auth_state: Arc::new(RwLock::new(
                crate::proxy::providers::copilot_auth::CopilotAuthManager::new(
                    crate::config::get_app_config_dir(),
                ),
            )),
            codex_oauth_state: Arc::new(RwLock::new(
                crate::proxy::providers::codex_oauth_auth::CodexOAuthManager::new(
                    crate::config::get_app_config_dir(),
                ),
            )),
            xai_oauth_state: Arc::new(RwLock::new(
                crate::proxy::providers::xai_oauth_auth::XaiOAuthManager::new(
                    crate::config::get_app_config_dir(),
                ),
            )),
            failover_manager: Arc::new(FailoverSwitchManager::new(db)),
            gemini_shadow: Arc::new(
                crate::proxy::providers::gemini_shadow::GeminiShadowStore::default(),
            ),
        }
    }

    fn seed_pricing(db: &Database) -> Result<(), AppError> {
        let conn = crate::database::lock_conn!(db.conn);
        conn.execute(
            "INSERT OR REPLACE INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["resp-model", "Resp Model", "1.0", "0"],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["req-model", "Req Model", "2.0", "0"],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    fn insert_provider(
        db: &Database,
        id: &str,
        app_type: &str,
        meta: ProviderMeta,
    ) -> Result<(), AppError> {
        let meta_json =
            serde_json::to_string(&meta).map_err(|e| AppError::Database(e.to_string()))?;
        let conn = crate::database::lock_conn!(db.conn);
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config, meta)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, app_type, "Test Provider", "{}", meta_json],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    #[tokio::test]
    async fn test_log_usage_ignores_legacy_provider_pricing_overrides() -> Result<(), AppError> {
        let db = Arc::new(Database::memory()?);
        let app_type = "claude";

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE proxy_config SET default_cost_multiplier = '1.5' WHERE app_type = ?1",
                [app_type],
            )
            .unwrap();
        }
        db.set_pricing_model_source(app_type, "response").await?;
        seed_pricing(&db)?;

        let mut meta = ProviderMeta::default();
        meta.cost_multiplier = Some("2".to_string());
        meta.pricing_model_source = Some("request".to_string());
        insert_provider(&db, "provider-1", app_type, meta)?;

        let state = build_state(db.clone());
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cache_creation_1h_tokens: 0,
            model: None,
            message_id: None,
        };

        log_usage_internal(
            &state,
            "provider-1",
            app_type,
            "resp-model",
            "req-model",
            usage,
            10,
            None,
            false,
            200,
            None,
        )
        .await;

        let conn = crate::database::lock_conn!(db.conn);
        let (model, request_model, total_cost, cost_multiplier): (String, String, String, String) =
            conn.query_row(
                "SELECT model, request_model, total_cost_usd, cost_multiplier
                 FROM proxy_request_logs WHERE provider_id = ?1",
                ["provider-1"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        assert_eq!(model, "resp-model");
        assert_eq!(request_model, "req-model");
        assert_eq!(Decimal::from_str(&cost_multiplier).unwrap(), Decimal::ONE);
        assert_eq!(Decimal::from_str(&total_cost).unwrap(), Decimal::ONE);
        Ok(())
    }

    #[tokio::test]
    async fn test_log_usage_falls_back_to_global_defaults() -> Result<(), AppError> {
        let db = Arc::new(Database::memory()?);
        let app_type = "claude";

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE proxy_config SET default_cost_multiplier = '1.5' WHERE app_type = ?1",
                [app_type],
            )
            .unwrap();
        }
        db.set_pricing_model_source(app_type, "response").await?;
        seed_pricing(&db)?;

        let meta = ProviderMeta::default();
        insert_provider(&db, "provider-2", app_type, meta)?;

        let state = build_state(db.clone());
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cache_creation_1h_tokens: 0,
            model: None,
            message_id: None,
        };

        log_usage_internal(
            &state,
            "provider-2",
            app_type,
            "resp-model",
            "req-model",
            usage,
            10,
            None,
            false,
            200,
            None,
        )
        .await;

        let conn = crate::database::lock_conn!(db.conn);
        let (total_cost, cost_multiplier): (String, String) = conn
            .query_row(
                "SELECT total_cost_usd, cost_multiplier
                 FROM proxy_request_logs WHERE provider_id = ?1",
                ["provider-2"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        assert_eq!(Decimal::from_str(&cost_multiplier).unwrap(), Decimal::ONE);
        assert_eq!(Decimal::from_str(&total_cost).unwrap(), Decimal::ONE);
        Ok(())
    }

    // #7818 回归闸门：使用量写入必须离开异步执行器线程。
    // Database 全局只有单把 std::sync::Mutex<Connection>，先让专用线程占住
    // 这把锁模拟慢盘/竞争。修复前，log_usage_internal 会在当前 tokio worker
    // 上同步等锁，单线程（current_thread）运行时被整个卡死，下方的心跳
    // sleep 只能在锁释放（约 500ms）后才会醒来；修复后写入走阻塞线程池，
    // sleep 照常在 100ms 触发。
    #[tokio::test]
    async fn log_usage_write_does_not_block_the_async_runtime() -> Result<(), AppError> {
        use std::thread;
        use std::time::{Duration, Instant};

        let db = Arc::new(Database::memory()?);
        let app_type = "claude";

        db.set_pricing_model_source(app_type, "response").await?;
        seed_pricing(&db)?;
        insert_provider(&db, "provider-busy", app_type, ProviderMeta::default())?;

        let state = build_state(db.clone());
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cache_creation_1h_tokens: 0,
            model: None,
            message_id: None,
        };

        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let blocker_db = db.clone();
        let blocker = thread::spawn(move || {
            let _guard = blocker_db.conn.lock().expect("占锁失败");
            locked_tx.send(()).expect("通知占锁失败");
            // 无论被测代码走哪条路径都定时释放，测试不会挂死
            thread::sleep(Duration::from_millis(500));
        });
        locked_rx.recv().expect("接收占锁通知失败");

        let writer = tokio::spawn(async move {
            log_usage_internal(
                &state,
                "provider-busy",
                app_type,
                "resp-model",
                "req-model",
                usage,
                10,
                None,
                false,
                200,
                None,
            )
            .await;
        });

        let start = Instant::now();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let heartbeat = start.elapsed();
        blocker.join().expect("占锁线程 panic");
        writer.await.expect("使用量写入任务 panic");

        assert!(
            heartbeat < Duration::from_millis(300),
            "使用量写入阻塞了异步执行器 {heartbeat:?}（应移到阻塞线程池执行）"
        );

        // 锁释放后记录最终仍要落库
        let conn = crate::database::lock_conn!(db.conn);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM proxy_request_logs WHERE provider_id = ?1",
                ["provider-busy"],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        assert_eq!(count, 1);
        Ok(())
    }
}
