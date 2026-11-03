//! Kimi Code 官方账号设备登录（上游 commands/kimi_oauth.rs 的 Web 版）：
//! 不经 Tauri State，由 web_server 的 `/api/auth/kimi/*` 路由传入管理器与应用状态。
use crate::services::kimi_oauth::{
    KimiLoginPoll, KimiLoginStart, KimiOAuthManager, KimiOAuthStatus, KimiRegion,
};
use crate::services::subscription::SubscriptionQuota;
use crate::store::AppState;

pub(crate) async fn kimi_oauth_status_internal(
    manager: &KimiOAuthManager,
) -> Result<KimiOAuthStatus, String> {
    manager.status().await
}

pub(crate) async fn kimi_oauth_start_internal(
    region: KimiRegion,
    account_id: Option<String>,
    manager: &KimiOAuthManager,
) -> Result<KimiLoginStart, String> {
    manager.start(region, account_id).await
}

pub(crate) async fn kimi_oauth_poll_internal(
    flow_id: &str,
    manager: &KimiOAuthManager,
) -> Result<KimiLoginPoll, String> {
    manager.poll(flow_id).await
}

pub(crate) async fn kimi_oauth_cancel_internal(flow_id: &str, manager: &KimiOAuthManager) -> bool {
    manager.cancel(flow_id).await
}

/// Separate accounts are deleted with their saved profile; Kimi's own default
/// login is only removed from the list.
pub(crate) async fn kimi_oauth_remove_internal(
    account_id: &str,
    manager: &KimiOAuthManager,
    app_state: &AppState,
) -> Result<(), String> {
    // Listing Kimi providers writes native entries back to the database too.
    let _guard = app_state.proxy_service.lock_switch_for_app("kimi").await;
    manager
        .remove(account_id, || {
            app_state.db.delete_provider("kimi", account_id)?;
            Ok(())
        })
        .await
}

pub(crate) async fn kimi_oauth_quota_internal(
    account_id: &str,
    manager: &KimiOAuthManager,
) -> Result<SubscriptionQuota, String> {
    manager.quota(account_id).await
}

/// The account's current official model catalog, for editing its card.
pub(crate) async fn kimi_oauth_models_internal(
    account_id: &str,
    manager: &KimiOAuthManager,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    manager.models(account_id).await
}

pub(crate) async fn kimi_oauth_use_account_internal(
    account_id: &str,
    manager: &KimiOAuthManager,
) -> Result<(), String> {
    manager.use_account(account_id).await
}
