//! Data Access Object layer
//!
//! Database access operations for each domain

mod failover;
mod mcp;
mod profiles;
mod prompts;
mod providers;
mod proxy;
mod settings;
mod skills;
mod stream_check;
mod universal_providers;
mod usage_rollup;

// 所有 DAO 方法都通过 Database impl 提供，无需单独导出
pub(crate) use failover::FailoverQueueItem;
pub(crate) use profiles::Profile;
