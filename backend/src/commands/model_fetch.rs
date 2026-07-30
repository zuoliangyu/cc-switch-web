use crate::services::model_fetch::{self, FetchedModel};
use std::sync::Arc;
use tokio::sync::RwLock;

pub(crate) async fn fetch_models_for_config_internal(
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    models_url_override: Option<String>,
    custom_user_agent: Option<String>,
) -> Result<Vec<FetchedModel>, String> {
    let user_agent = crate::provider::parse_custom_user_agent(custom_user_agent.as_deref())
        .ok()
        .flatten();
    model_fetch::fetch_models(
        &base_url,
        &api_key,
        is_full_url.unwrap_or(false),
        models_url_override.as_deref(),
        user_agent,
    )
    .await
}

pub(crate) async fn fetch_xai_oauth_models_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<Vec<FetchedModel>, String> {
    let manager = state.read().await;
    let account_id = match account_id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => id.to_string(),
        None => manager
            .default_account_id()
            .await
            .ok_or_else(|| "No usable xAI account available".to_string())?,
    };
    let token = manager
        .get_valid_token_for_account(&account_id)
        .await
        .map_err(|error| format!("xAI OAuth token unavailable: {error}"))?;

    model_fetch::fetch_models(
        crate::proxy::providers::XAI_API_BASE_URL,
        &token,
        false,
        None,
        None,
    )
    .await
}
