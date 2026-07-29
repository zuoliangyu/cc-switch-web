//! 代理服务器模块
//!
//! 提供本地HTTP代理服务，支持多Provider故障转移和请求透传

pub(crate) mod body_filter;
pub(crate) mod cache_injector;
pub(crate) mod circuit_breaker;
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
pub(crate) mod media_sanitizer;
pub(crate) mod model_mapper;
pub(crate) mod provider_router;
pub(crate) mod providers;
pub(crate) mod response_processor;
pub(crate) mod server;
mod session;
pub(crate) mod sse;
pub(crate) mod thinking_budget_rectifier;
pub(crate) mod thinking_optimizer;
pub(crate) mod thinking_rectifier;
pub(crate) mod tool_media;
pub(crate) mod types;
pub(crate) mod usage;

// 公开导出给外部使用（commands, services等模块需要）
pub(crate) use error::ProxyError;
pub(crate) use session::extract_session_id;
