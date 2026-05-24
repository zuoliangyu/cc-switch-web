use indexmap::IndexMap;
use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::provider::{ProviderService, ProviderSortUpdate, SwitchResult};
use crate::services::speedtest::{EndpointLatency, SpeedtestService};
use crate::store::AppState;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;

// 常量定义
const TEMPLATE_TYPE_GITHUB_COPILOT: &str = "github_copilot";
const TEMPLATE_TYPE_TOKEN_PLAN: &str = "token_plan";
const TEMPLATE_TYPE_BALANCE: &str = "balance";
const COPILOT_UNIT_PREMIUM: &str = "requests";

pub(crate) fn get_providers_internal(
    state: &AppState,
    app: String,
) -> Result<IndexMap<String, Provider>, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::list(state, app_type).map_err(|e| e.to_string())
}

pub(crate) fn get_current_provider_internal(state: &AppState, app: String) -> Result<String, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::current(state, app_type).map_err(|e| e.to_string())
}

pub(crate) fn add_provider_internal(
    state: &AppState,
    app: String,
    provider: Provider,
    add_to_live: Option<bool>,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::add(state, app_type, provider, add_to_live.unwrap_or(true))
        .map_err(|e| e.to_string())
}

pub(crate) fn update_provider_internal(
    state: &AppState,
    app: String,
    original_id: Option<String>,
    provider: Provider,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::update(state, app_type, original_id.as_deref(), provider)
        .map_err(|e| e.to_string())
}

pub(crate) fn delete_provider_internal(
    state: &AppState,
    app: String,
    id: String,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::delete(state, app_type, &id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

pub(crate) fn remove_provider_from_live_config_internal(
    state: &AppState,
    app: String,
    id: String,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::remove_from_live_config(state, app_type, &id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

fn switch_provider_internal(
    state: &AppState,
    app_type: AppType,
    id: &str,
) -> Result<SwitchResult, AppError> {
    ProviderService::switch(state, app_type, id)
}

pub(crate) fn switch_provider_by_name_internal(
    state: &AppState,
    app: String,
    id: String,
) -> Result<SwitchResult, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    switch_provider_internal(state, app_type, &id).map_err(|e| e.to_string())
}

fn import_default_config_internal(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
    let imported = ProviderService::import_default_config(state, app_type.clone())?;

    if imported {
        // Extract common config snippet (mirrors old startup logic in lib.rs)
        if state
            .db
            .should_auto_extract_config_snippet(app_type.as_str())?
        {
            match ProviderService::extract_common_config_snippet(state, app_type.clone()) {
                Ok(snippet) if !snippet.is_empty() && snippet != "{}" => {
                    let _ = state
                        .db
                        .set_config_snippet(app_type.as_str(), Some(snippet));
                    let _ = state
                        .db
                        .set_config_snippet_cleared(app_type.as_str(), false);
                }
                _ => {}
            }
        }

        ProviderService::migrate_legacy_common_config_usage_if_needed(state, app_type.clone())?;
    }

    Ok(imported)
}

pub(crate) fn import_default_config_for_app_internal(
    state: &AppState,
    app_type: AppType,
) -> Result<bool, AppError> {
    import_default_config_internal(state, app_type)
}

pub(crate) async fn query_provider_usage_internal(
    state: &AppState,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    app_type: AppType,
    provider_id: &str,
) -> Result<crate::provider::UsageResult, AppError> {
    let (
        is_copilot_template,
        copilot_account_id,
        template_type,
        settings_config,
    ) = {
        let providers = state.db.get_all_providers(app_type.as_str())?;

        let provider = providers.get(provider_id);
        let is_copilot = provider
            .and_then(|p| p.meta.as_ref())
            .and_then(|m| m.usage_script.as_ref())
            .and_then(|s| s.template_type.as_ref())
            .map(|t| t == TEMPLATE_TYPE_GITHUB_COPILOT)
            .unwrap_or(false);
        let template_type = provider
            .and_then(|p| p.meta.as_ref())
            .and_then(|m| m.usage_script.as_ref())
            .and_then(|s| s.template_type.clone())
            .unwrap_or_default();
        let account_id = provider
            .and_then(|p| p.meta.as_ref())
            .and_then(|m| m.managed_account_id_for(TEMPLATE_TYPE_GITHUB_COPILOT));
        let settings_config = provider
            .map(|p| p.settings_config.clone())
            .unwrap_or_default();

        (is_copilot, account_id, template_type, settings_config)
    };

    if is_copilot_template {
        // 使用 Copilot 专用 API
        let auth_manager = copilot_state.read().await;
        let usage = match copilot_account_id.as_deref() {
            Some(account_id) => auth_manager
                .fetch_usage_for_account(account_id)
                .await
                .map_err(|e| AppError::Message(format!("Failed to fetch Copilot usage: {e}")))?,
            None => auth_manager
                .fetch_usage()
                .await
                .map_err(|e| AppError::Message(format!("Failed to fetch Copilot usage: {e}")))?,
        };
        let premium = &usage.quota_snapshots.premium_interactions;
        let used = premium.entitlement - premium.remaining;

        return Ok(crate::provider::UsageResult {
            success: true,
            data: Some(vec![crate::provider::UsageData {
                plan_name: Some(usage.copilot_plan),
                remaining: Some(premium.remaining as f64),
                total: Some(premium.entitlement as f64),
                used: Some(used as f64),
                unit: Some(COPILOT_UNIT_PREMIUM.to_string()),
                is_valid: Some(true),
                invalid_message: None,
                extra: Some(format!("Reset: {}", usage.quota_reset_date)),
            }]),
            error: None,
        });
    }

    if template_type == TEMPLATE_TYPE_TOKEN_PLAN {
        let env = settings_config.get("env");
        let base_url = env
            .and_then(|value| value.get("ANTHROPIC_BASE_URL"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let api_key = env
            .and_then(|value| {
                value
                    .get("ANTHROPIC_AUTH_TOKEN")
                    .or_else(|| value.get("ANTHROPIC_API_KEY"))
            })
            .and_then(|value| value.as_str())
            .unwrap_or("");

        let quota = crate::services::coding_plan::get_coding_plan_quota(base_url, api_key)
            .await
            .map_err(|e| AppError::Message(format!("Failed to query coding plan: {e}")))?;

        if !quota.success {
            return Ok(crate::provider::UsageResult {
                success: false,
                data: None,
                error: quota.error,
            });
        }

        let data: Vec<crate::provider::UsageData> = quota
            .tiers
            .iter()
            .map(|tier| crate::provider::UsageData {
                plan_name: Some(tier.name.clone()),
                remaining: Some(100.0 - tier.utilization),
                total: Some(100.0),
                used: Some(tier.utilization),
                unit: Some("%".to_string()),
                is_valid: Some(true),
                invalid_message: None,
                extra: tier.resets_at.clone(),
            })
            .collect();

        return Ok(crate::provider::UsageResult {
            success: true,
            data: if data.is_empty() { None } else { Some(data) },
            error: None,
        });
    }

    if template_type == TEMPLATE_TYPE_BALANCE {
        let env = settings_config.get("env");
        let base_url = env
            .and_then(|value| value.get("ANTHROPIC_BASE_URL"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let api_key = env
            .and_then(|value| {
                value
                    .get("ANTHROPIC_AUTH_TOKEN")
                    .or_else(|| value.get("ANTHROPIC_API_KEY"))
            })
            .and_then(|value| value.as_str())
            .unwrap_or("");

        return crate::services::balance::get_balance(base_url, api_key)
            .await
            .map_err(|e| AppError::Message(format!("Failed to query balance: {e}")));
    }

    ProviderService::query_usage(state, app_type, provider_id).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn test_usage_script_internal(
    state: &AppState,
    app_type: AppType,
    provider_id: &str,
    script_code: &str,
    timeout: Option<u64>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    access_token: Option<&str>,
    user_id: Option<&str>,
    template_type: Option<&str>,
) -> Result<crate::provider::UsageResult, AppError> {
    ProviderService::test_usage_script(
        state,
        app_type,
        provider_id,
        script_code,
        timeout.unwrap_or(10),
        api_key,
        base_url,
        access_token,
        user_id,
        template_type,
    )
    .await
}

pub(crate) fn read_live_provider_settings_internal(app: String) -> Result<serde_json::Value, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::read_live_settings(app_type).map_err(|e| e.to_string())
}

pub(crate) async fn test_api_endpoints_internal(
    urls: Vec<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<EndpointLatency>, String> {
    SpeedtestService::test_endpoints(urls, timeout_secs)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn get_custom_endpoints_internal(
    state: &AppState,
    app: String,
    provider_id: String,
) -> Result<Vec<crate::settings::CustomEndpoint>, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::get_custom_endpoints(state, app_type, &provider_id)
        .map_err(|e| e.to_string())
}

pub(crate) fn add_custom_endpoint_internal(
    state: &AppState,
    app: String,
    provider_id: String,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::add_custom_endpoint(state, app_type, &provider_id, url)
        .map_err(|e| e.to_string())
}

pub(crate) fn remove_custom_endpoint_internal(
    state: &AppState,
    app: String,
    provider_id: String,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::remove_custom_endpoint(state, app_type, &provider_id, url)
        .map_err(|e| e.to_string())
}

pub(crate) fn update_endpoint_last_used_internal(
    state: &AppState,
    app: String,
    provider_id: String,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::update_endpoint_last_used(state, app_type, &provider_id, url)
        .map_err(|e| e.to_string())
}

pub(crate) fn update_providers_sort_order_internal(
    state: &AppState,
    app: String,
    updates: Vec<ProviderSortUpdate>,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    ProviderService::update_sort_order(state, app_type, updates).map_err(|e| e.to_string())
}

use crate::provider::UniversalProvider;
use std::collections::HashMap;

pub(crate) fn get_universal_providers_internal(
    state: &AppState,
) -> Result<HashMap<String, UniversalProvider>, String> {
    ProviderService::list_universal(state).map_err(|e| e.to_string())
}

pub(crate) fn get_universal_provider_internal(
    state: &AppState,
    id: String,
) -> Result<Option<UniversalProvider>, String> {
    ProviderService::get_universal(state, &id).map_err(|e| e.to_string())
}

pub(crate) fn upsert_universal_provider_internal(
    state: &AppState,
    provider: UniversalProvider,
) -> Result<bool, String> {
    ProviderService::upsert_universal(state, provider).map_err(|e| e.to_string())
}

pub(crate) fn delete_universal_provider_internal(
    state: &AppState,
    id: String,
) -> Result<bool, String> {
    ProviderService::delete_universal(state, &id).map_err(|e| e.to_string())
}

pub(crate) fn sync_universal_provider_internal(
    state: &AppState,
    id: String,
) -> Result<bool, String> {
    ProviderService::sync_universal_to_apps(state, &id).map_err(|e| e.to_string())
}

pub(crate) fn import_opencode_providers_from_live_internal(
    state: &AppState,
) -> Result<usize, crate::error::AppError> {
    crate::services::provider::import_opencode_providers_from_live(state)
}

// ============================================================================
// Claude Desktop 3P 命令（C-Phase3）
// ============================================================================

/// 获取 Claude Desktop 3P 状态（漂移信号：stale models / missing routes /
/// proxy stopped / base url mismatch / missing token）。
pub(crate) async fn get_claude_desktop_status_internal(
    state: &AppState,
) -> Result<crate::claude_desktop_config::ClaudeDesktopStatus, String> {
    let proxy_running = state.proxy_service.is_running().await;
    crate::claude_desktop_config::get_status(state.db.as_ref(), proxy_running)
        .map_err(|e| e.to_string())
}

/// 获取 Claude Desktop proxy 模式的默认模型路由（唯一来源）。
pub(crate) fn get_claude_desktop_default_routes_internal(
) -> Vec<crate::claude_desktop_config::ClaudeDesktopDefaultRoute> {
    crate::claude_desktop_config::default_proxy_routes()
}

// ============================================================================
// OpenClaw 专属命令 → 已迁移至 commands/openclaw.rs
// ============================================================================
