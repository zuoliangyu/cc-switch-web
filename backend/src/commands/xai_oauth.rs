use crate::proxy::providers::xai_oauth_auth::XaiOAuthManager;
use crate::services::subscription::{CredentialStatus, SubscriptionQuota};
use std::sync::Arc;
use tokio::sync::RwLock;

pub(crate) async fn get_xai_oauth_quota_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<XaiOAuthManager>>,
) -> Result<SubscriptionQuota, String> {
    let manager = state.read().await;
    let account_id = match account_id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => id.to_string(),
        None => match manager.default_account_id().await {
            Some(id) => id,
            None => return Ok(SubscriptionQuota::not_found("xai_oauth")),
        },
    };
    let token = match manager.get_valid_token_for_account(&account_id).await {
        Ok(token) => token,
        Err(error) => {
            return Ok(SubscriptionQuota::error(
                "xai_oauth",
                CredentialStatus::Expired,
                format!("xAI OAuth token unavailable: {error}"),
            ));
        }
    };

    crate::services::subscription_grok::query_grok_quota(
        &token,
        "xai_oauth",
        "Please re-login via cc-switch.",
    )
    .await
}
