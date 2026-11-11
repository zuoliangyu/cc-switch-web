//! 代理服务器模块
//!
//! 提供本地HTTP代理服务，支持多Provider故障转移和请求透传

pub(crate) mod body_filter;
mod browser_guard;
pub(crate) mod cache_injector;
pub(crate) mod circuit_breaker;
mod classifier_guard;
pub(crate) mod codex_quota_protection;
pub(crate) mod content_encoding;
// Web 只在 Codex → Copilot 路径用请求分类与 interaction ID（Claude 路径没有接优化器）
#[allow(dead_code)]
pub(crate) mod copilot_optimizer;
pub(crate) mod error;
pub(crate) mod error_mapper;
pub(crate) mod failover_switch;
mod forwarder;
pub(crate) mod gemini_url;
pub(crate) mod handler_config;
pub(crate) mod handler_context;
mod handlers;
pub(crate) mod http_client;
pub(crate) mod hyper_client;
pub(crate) mod json_canonical;
pub(crate) mod log_codes;
pub(crate) mod loopback_probe;
pub(crate) mod media_sanitizer;
pub(crate) mod model_mapper;
pub(crate) mod opaque_state_rectifier;
pub(crate) mod provider_router;
pub(crate) mod providers;
pub(crate) mod response_processor;
pub(crate) mod server;
mod session;
pub(crate) mod sse;
pub(crate) mod switch_lock;
pub(crate) mod thinking_budget_rectifier;
pub(crate) mod thinking_optimizer;
pub(crate) mod thinking_rectifier;
pub(crate) mod tool_media;
pub(crate) mod types;
mod upstream_guard;
pub(crate) mod usage;

// 公开导出给外部使用（commands, services等模块需要）
pub(crate) use error::ProxyError;
pub(crate) use session::extract_session_id;

#[cfg(test)]
mod aggregation_tests;
#[cfg(test)]
mod compaction_tests;
#[cfg(test)]
mod tests_issue_7271;
