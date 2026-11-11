//! Antigravity 官方账号的专用操作（加号、切号走授权中心的通用 `auth_*` 接口）。
//! Web 版不经 Tauri State：管理器是进程级单例（[`agy_account_manager`]），由 web_server 路由调用。

use std::sync::{Arc, LazyLock};

use crate::services::agy_account::{AccountQuotaError, AgyAccountManager};
use crate::services::subscription::{CredentialStatus, SubscriptionQuota};

const TOOL: &str = "agy";

static AGY_ACCOUNT_MANAGER: LazyLock<Arc<AgyAccountManager>> =
    LazyLock::new(|| Arc::new(AgyAccountManager::new(crate::config::get_app_config_dir())));

/// Antigravity 官方账号管理器（与桌面端一样全进程一份）。
pub(crate) fn agy_account_manager() -> Arc<AgyAccountManager> {
    AGY_ACCOUNT_MANAGER.clone()
}

/// 切号后提醒用：在跑的 agy 还用旧账号，续期时可能把旧登录写回钥匙串。
pub(crate) async fn agy_account_is_running_internal() -> Result<bool, String> {
    tokio::task::spawn_blocking(crate::services::agy_account::agy_running)
        .await
        .map_err(|error| error.to_string())
}

/// 授权中心逐个账号、以及绑了账号的官方卡显示的剩余额度：用该账号自己的令牌直接查，不用先切号。
pub(crate) async fn agy_account_quota_internal(
    account_id: &str,
) -> Result<SubscriptionQuota, String> {
    agy_quota(&agy_account_manager(), Some(account_id)).await
}

/// 服务端能不能管理 Antigravity 官方账号（只实现了 macOS 钥匙串；登录回调监听本机 127.0.0.1，
/// 浏览器也要在服务端这台机器上）。前端据此决定显示授权中心里的 Antigravity 组。
pub(crate) fn agy_account_supported() -> bool {
    crate::services::agy_account::keychain::supported()
}

/// Antigravity 官方登录的额度。指定账号就查它；不指定就查 agy 现在登着的号。都用 CC Switch
/// 存的令牌直接问 Google（约 1 秒），认不出 agy 的登录、或这个平台不能切号时，改问 agy 的
/// `/usage`（要先启动 agy，七八秒）。不能切号的平台忽略绑定，和打开终端一致。
pub(crate) async fn agy_quota(
    manager: &AgyAccountManager,
    account_id: Option<&str>,
) -> Result<SubscriptionQuota, String> {
    if !crate::services::agy_account::keychain::supported() {
        return crate::services::subscription_agy::get_agy_subscription_quota().await;
    }
    let result = match account_id {
        Some(account_id) => manager.quota(account_id).await,
        None => match manager.live_quota().await {
            Some(result) => result,
            None => return crate::services::subscription_agy::get_agy_subscription_quota().await,
        },
    };
    Ok(match result {
        Ok(quota) => SubscriptionQuota {
            tool: TOOL.to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: quota.tiers,
            extra_usage: None,
            reset_credits: None,
            credits_balance: None,
            plan_name: quota.plan,
            error: None,
            queried_at: Some(chrono::Utc::now().timestamp_millis()),
        },
        Err(AccountQuotaError::NotFound) => SubscriptionQuota::not_found(TOOL),
        Err(AccountQuotaError::NeedsReauth) => SubscriptionQuota::error(
            TOOL,
            CredentialStatus::Expired,
            "Antigravity sign-in expired".to_string(),
        ),
        Err(AccountQuotaError::Failed(message)) => {
            SubscriptionQuota::error(TOOL, CredentialStatus::Valid, message)
        }
    })
}
