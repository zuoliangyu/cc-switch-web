use crate::services::model_fetch::{self, FetchedModel};

pub(crate) async fn fetch_models_for_config_internal(
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    models_url_override: Option<String>,
) -> Result<Vec<FetchedModel>, String> {
    model_fetch::fetch_models(
        &base_url,
        &api_key,
        is_full_url.unwrap_or(false),
        models_url_override.as_deref(),
    )
    .await
}
