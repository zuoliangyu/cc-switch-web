use std::collections::HashMap;

use crate::openclaw_config;
use crate::store::AppState;

// ============================================================================
// OpenClaw Provider Commands (migrated from provider.rs)
// ============================================================================

pub(crate) fn import_openclaw_providers_from_live_internal(
    state: &AppState,
) -> Result<usize, crate::error::AppError> {
    crate::services::provider::import_openclaw_providers_from_live(state)
}

// ============================================================================
// Agents Configuration Commands
// ============================================================================

// ============================================================================
// Env Configuration Commands
// ============================================================================

// ============================================================================
// Tools Configuration Commands
// ============================================================================

pub(crate) fn get_openclaw_live_provider_internal(
    provider_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    openclaw_config::get_provider(provider_id).map_err(|e| e.to_string())
}

pub(crate) fn scan_openclaw_config_health_internal(
) -> Result<Vec<openclaw_config::OpenClawHealthWarning>, String> {
    openclaw_config::scan_openclaw_config_health().map_err(|e| e.to_string())
}

pub(crate) fn get_openclaw_default_model_internal(
) -> Result<Option<openclaw_config::OpenClawDefaultModel>, String> {
    openclaw_config::get_default_model().map_err(|e| e.to_string())
}

pub(crate) fn set_openclaw_default_model_internal(
    model: openclaw_config::OpenClawDefaultModel,
) -> Result<openclaw_config::OpenClawWriteOutcome, String> {
    openclaw_config::set_default_model(&model).map_err(|e| e.to_string())
}

pub(crate) fn get_openclaw_model_catalog_internal(
) -> Result<Option<HashMap<String, openclaw_config::OpenClawModelCatalogEntry>>, String> {
    openclaw_config::get_model_catalog().map_err(|e| e.to_string())
}

pub(crate) fn set_openclaw_model_catalog_internal(
    catalog: HashMap<String, openclaw_config::OpenClawModelCatalogEntry>,
) -> Result<openclaw_config::OpenClawWriteOutcome, String> {
    openclaw_config::set_model_catalog(&catalog).map_err(|e| e.to_string())
}

pub(crate) fn get_openclaw_agents_defaults_internal(
) -> Result<Option<openclaw_config::OpenClawAgentsDefaults>, String> {
    openclaw_config::get_agents_defaults().map_err(|e| e.to_string())
}

pub(crate) fn set_openclaw_agents_defaults_internal(
    defaults: openclaw_config::OpenClawAgentsDefaults,
) -> Result<openclaw_config::OpenClawWriteOutcome, String> {
    openclaw_config::set_agents_defaults(&defaults).map_err(|e| e.to_string())
}

pub(crate) fn get_openclaw_env_internal() -> Result<openclaw_config::OpenClawEnvConfig, String> {
    openclaw_config::get_env_config().map_err(|e| e.to_string())
}

pub(crate) fn set_openclaw_env_internal(
    env: openclaw_config::OpenClawEnvConfig,
) -> Result<openclaw_config::OpenClawWriteOutcome, String> {
    openclaw_config::set_env_config(&env).map_err(|e| e.to_string())
}

pub(crate) fn get_openclaw_tools_internal() -> Result<openclaw_config::OpenClawToolsConfig, String>
{
    openclaw_config::get_tools_config().map_err(|e| e.to_string())
}

pub(crate) fn set_openclaw_tools_internal(
    tools: openclaw_config::OpenClawToolsConfig,
) -> Result<openclaw_config::OpenClawWriteOutcome, String> {
    openclaw_config::set_tools_config(&tools).map_err(|e| e.to_string())
}
