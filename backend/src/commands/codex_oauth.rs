use crate::proxy::providers::codex_oauth_auth::{CodexOAuthError, CodexOAuthManager};
use crate::services::subscription::{query_codex_quota, CredentialStatus, SubscriptionQuota};
use std::sync::Arc;
use tokio::sync::RwLock;

fn is_transient_token_error(error: &CodexOAuthError) -> bool {
    matches!(
        error,
        CodexOAuthError::NetworkError(_)
            | CodexOAuthError::TokenFetchFailed(_)
            | CodexOAuthError::IoError(_)
    )
}

pub(crate) async fn get_codex_oauth_quota_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<CodexOAuthManager>>,
) -> Result<SubscriptionQuota, String> {
    let manager = state.read().await;

    let resolved = match account_id {
        Some(id) => Some(id),
        None => manager.default_account_id().await,
    };
    let Some(id) = resolved else {
        return Ok(SubscriptionQuota::not_found("codex_oauth"));
    };

    let token = match manager.get_valid_token_for_account(&id).await {
        Ok(token) => token,
        // 网络 / 刷新端点暂时失败不代表登录失效：以 Err 传播，前端 retry 并保留
        // 上次成功值；只有确定的凭据问题才标成过期。
        Err(error) if is_transient_token_error(&error) => {
            return Err(format!("Codex OAuth token unavailable: {error}"));
        }
        Err(error) => {
            return Ok(SubscriptionQuota::error(
                "codex_oauth",
                CredentialStatus::Expired,
                format!("Codex OAuth token unavailable: {error}"),
            ));
        }
    };

    Ok(query_codex_quota(
        &token,
        Some(&id),
        "codex_oauth",
        "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
    )
    .await)
}
