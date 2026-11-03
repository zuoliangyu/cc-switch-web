use crate::services::subscription::SubscriptionQuota;

pub(crate) async fn get_subscription_quota_internal(
    tool: String,
) -> Result<SubscriptionQuota, String> {
    // Antigravity 官方登录：用 CC Switch 存的令牌直接问 Google，认不出 agy 的登录时再问 agy
    if tool == "agy" {
        return crate::commands::agy_quota(&crate::commands::agy_account_manager(), None).await;
    }
    crate::services::subscription::get_subscription_quota(&tool).await
}

pub(crate) async fn get_coding_plan_quota_internal(
    base_url: String,
    api_key: String,
) -> Result<SubscriptionQuota, String> {
    crate::services::coding_plan::get_coding_plan_quota(&base_url, &api_key).await
}

pub(crate) async fn get_balance_internal(
    base_url: String,
    api_key: String,
) -> Result<crate::provider::UsageResult, String> {
    crate::services::balance::get_balance(&base_url, &api_key).await
}
