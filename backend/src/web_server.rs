use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, get_service, post, put};
use axum::{Json, Router};
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::app_config::{AppType, McpServer};
use crate::database::Database;
use crate::database::FailoverQueueItem;
use crate::prompt::Prompt;
use crate::provider::Provider;
use crate::proxy::circuit_breaker::CircuitBreakerConfig;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use crate::proxy::types::{
    AppProxyConfig, GlobalProxyConfig, LogConfig, OptimizerConfig, ProviderHealth, ProxyConfig,
    ProxyServerInfo, ProxyStatus, ProxyTakeoverStatus, RectifierConfig,
};
use crate::services::omo::OmoLocalFileData;
use crate::services::provider::{ProviderSortUpdate, SwitchResult};
use crate::services::skill::{
    DiscoverableSkill, ImportSkillSelection, MigrationResult, SkillBackupEntry, SkillRepo,
    SkillStorageLocation, SkillUninstallResult, SkillUpdateInfo, SkillsShSearchResult,
};
use crate::services::speedtest::EndpointLatency;
use crate::settings::WebDavSyncSettings;
use crate::store::AppState;
use tokio::sync::RwLock;

static EMBEDDED_FRONTEND_DIST: Dir<'static> = include_dir!("$CC_SWITCH_WEB_EMBED_DIST_DIR");

#[derive(Clone)]
struct WebApiState {
    app_state: Arc<AppState>,
    copilot_auth_state: Arc<RwLock<CopilotAuthManager>>,
    codex_oauth_state: Arc<RwLock<CodexOAuthManager>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootResponse {
    name: &'static str,
    mode: &'static str,
    api_base: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvidersResponse {
    providers: indexmap::IndexMap<String, Provider>,
    current_provider_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnabledRequest {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValueRequest {
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddProviderRequest {
    provider: Provider,
    add_to_live: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPathRequest {
    backup_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalPathRequest {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialRequest {
    official: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippetRequest {
    snippet: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractCommonConfigSnippetRequest {
    settings_config: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderIdRequest {
    provider_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvConflictListRequest {
    conflicts: Vec<crate::services::env_checker::EnvConflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestUsageScriptRequest {
    script_code: String,
    timeout: Option<u64>,
    api_key: Option<String>,
    base_url: Option<String>,
    access_token: Option<String>,
    user_id: Option<String>,
    template_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointTestRequest {
    urls: Vec<String>,
    timeout_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchModelsRequest {
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    /// 预设级别的 `/models` 端点覆盖。命中时跳过 baseURL 推导直接使用此 URL。
    /// 用于 DeepSeek 这类把 Anthropic 协议挂在子路径，但 `/models` 在根上的供应商。
    models_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamCheckAllProvidersRequest {
    proxy_targets_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomEndpointUrlRequest {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenProviderTerminalRequest {
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchSessionTerminalRequest {
    command: String,
    cwd: Option<String>,
    custom_config: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialQueryRequest {
    base_url: String,
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleMcpAppRequest {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleSkillAppRequest {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillIdRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrateSkillStorageRequest {
    target: SkillStorageLocation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleSkillAppByBodyRequest {
    id: String,
    app: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallSkillRequest {
    skill: DiscoverableSkill,
    current_app: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentAppRequest {
    current_app: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchSkillsShQuery {
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentRequest {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBackupRequest {
    old_filename: String,
    new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportConfigQuery {
    filename: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebdavTestRequest {
    settings: WebDavSyncSettings,
    preserve_empty_password: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebdavSaveSettingsRequest {
    settings: WebDavSyncSettings,
    password_touched: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyMemorySearchQuery {
    query: String,
}

const DEFAULT_WEB_HOST: &str = "127.0.0.1";
const DEFAULT_WEB_PORT: u16 = 8890;
const DEFAULT_PORT_SCAN_COUNT: usize = 32;

#[derive(Debug, Clone)]
pub struct WebServerOptions {
    pub host: String,
    pub preferred_port: u16,
    pub port_scan_count: usize,
}

impl Default for WebServerOptions {
    fn default() -> Self {
        Self {
            host: DEFAULT_WEB_HOST.to_string(),
            preferred_port: DEFAULT_WEB_PORT,
            port_scan_count: DEFAULT_PORT_SCAN_COUNT,
        }
    }
}

impl WebServerOptions {
    pub fn from_env() -> Self {
        let mut options = Self::default();

        if let Ok(host) = std::env::var("CC_SWITCH_WEB_HOST") {
            let trimmed = host.trim();
            if !trimmed.is_empty() {
                options.host = trimmed.to_string();
            }
        }

        if let Ok(port) = std::env::var("CC_SWITCH_WEB_PORT") {
            if let Ok(parsed) = port.trim().parse::<u16>() {
                options.preferred_port = parsed;
            }
        }

        if let Ok(count) = std::env::var("CC_SWITCH_WEB_PORT_SCAN_COUNT") {
            if let Ok(parsed) = count.trim().parse::<usize>() {
                options.port_scan_count = parsed.max(1);
            }
        }

        options
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMessagesQuery {
    provider_id: String,
    source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageRangeQuery {
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestLogsPayload {
    filters: crate::services::usage_stats::LogFilters,
    page: Option<u32>,
    page_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolVersionsRequest {
    tools: Option<Vec<String>>,
    wsl_shell_by_tool: Option<HashMap<String, crate::commands::WslShellPreferenceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatestReleaseQuery {
    current_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStartLoginRequest {
    auth_provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthPollForAccountRequest {
    auth_provider: String,
    device_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthAccountRequest {
    auth_provider: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexOauthQuotaQuery {
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateModelPricingPayload {
    display_name: String,
    input_cost: String,
    output_cost: String,
    cache_read_cost: String,
    cache_creation_cost: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageModelPricingInfo {
    model_id: String,
    display_name: String,
    input_cost_per_million: String,
    output_cost_per_million: String,
    cache_read_cost_per_million: String,
    cache_creation_cost_per_million: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillArchiveInstallResult {
    file_name: String,
    installed: Vec<crate::app_config::InstalledSkill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn sanitize_export_sql_filename(filename: Option<String>) -> String {
    let fallback = "cc-switch-export.sql".to_string();
    let mut sanitized = filename
        .unwrap_or_else(|| fallback.clone())
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect::<String>();

    if sanitized.trim().is_empty() {
        sanitized = fallback;
    }

    if !sanitized.to_ascii_lowercase().ends_with(".sql") {
        sanitized.push_str(".sql");
    }

    sanitized
}

fn is_api_debug_logging_enabled() -> bool {
    std::env::var("CC_SWITCH_WEB_DEBUG_API")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

async fn api_request_logger(request: axum::extract::Request, next: Next) -> Response {
    let debug_enabled = is_api_debug_logging_enabled();
    let method = request.method().clone();
    let uri = request.uri().clone();
    let start = Instant::now();

    if debug_enabled {
        log::info!("[web-api] --> {} {}", method, uri);
    }

    let response = next.run(request).await;

    if debug_enabled {
        log::info!(
            "[web-api] <-- {} {} {} ({} ms)",
            method,
            uri,
            response.status().as_u16(),
            start.elapsed().as_millis()
        );
    }

    response
}

async fn get_mcp_servers(
    State(state): State<WebApiState>,
) -> Result<Json<indexmap::IndexMap<String, McpServer>>, ApiError> {
    let servers = crate::commands::get_mcp_servers_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load mcp servers: {e}")))?;
    Ok(Json(servers))
}

async fn upsert_mcp_server(
    State(state): State<WebApiState>,
    Json(server): Json<McpServer>,
) -> Result<StatusCode, ApiError> {
    crate::commands::upsert_mcp_server_internal(state.app_state.as_ref(), server)
        .await
        .map_err(|e| ApiError::internal(format!("failed to save mcp server: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_mcp_server(
    State(state): State<WebApiState>,
    Path(id): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let deleted = crate::commands::delete_mcp_server_internal(state.app_state.as_ref(), id)
        .await
        .map_err(|e| ApiError::internal(format!("failed to delete mcp server: {e}")))?;
    Ok(Json(deleted))
}

async fn toggle_mcp_app(
    State(state): State<WebApiState>,
    Path((id, app)): Path<(String, String)>,
    Json(payload): Json<ToggleMcpAppRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::toggle_mcp_app_internal(state.app_state.as_ref(), id, app, payload.enabled)
        .await
        .map_err(|e| ApiError::internal(format!("failed to toggle mcp app: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn import_mcp_from_apps(State(state): State<WebApiState>) -> Result<Json<usize>, ApiError> {
    let total = crate::commands::import_mcp_from_apps_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to import mcp servers: {e}")))?;
    Ok(Json(total))
}

async fn get_prompts(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<indexmap::IndexMap<String, Prompt>>, ApiError> {
    let prompts = crate::commands::get_prompts_internal(state.app_state.as_ref(), app)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load prompts: {e}")))?;
    Ok(Json(prompts))
}

async fn upsert_prompt(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(prompt): Json<Prompt>,
) -> Result<StatusCode, ApiError> {
    crate::commands::upsert_prompt_internal(state.app_state.as_ref(), app, id, prompt)
        .await
        .map_err(|e| ApiError::internal(format!("failed to save prompt: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_prompt(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    crate::commands::delete_prompt_internal(state.app_state.as_ref(), app, id)
        .await
        .map_err(|e| ApiError::internal(format!("failed to delete prompt: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enable_prompt(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    crate::commands::enable_prompt_internal(state.app_state.as_ref(), app, id)
        .await
        .map_err(|e| ApiError::internal(format!("failed to enable prompt: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn import_prompt_from_file(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<String>, ApiError> {
    let id = crate::commands::import_prompt_from_file_internal(state.app_state.as_ref(), app)
        .await
        .map_err(|e| ApiError::internal(format!("failed to import prompt from file: {e}")))?;
    Ok(Json(id))
}

async fn get_current_prompt_file_content(
    Path(app): Path<String>,
) -> Result<Json<Option<String>>, ApiError> {
    let content = crate::commands::get_current_prompt_file_content_internal(app)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load current prompt file: {e}")))?;
    Ok(Json(content))
}

async fn get_live_provider_ids(Path(app): Path<String>) -> Result<Json<Vec<String>>, ApiError> {
    let provider_ids = match AppType::from_str(&app) {
        Ok(AppType::OpenCode) => crate::opencode_config::get_providers()
            .map(|providers| providers.keys().cloned().collect()),
        Ok(AppType::OpenClaw) => crate::openclaw_config::get_providers()
            .map(|providers| providers.keys().cloned().collect()),
        Ok(app_type) => {
            return Err(ApiError::bad_request(format!(
                "{} does not support live provider ids",
                app_type.as_str()
            )));
        }
        Err(err) => return Err(ApiError::bad_request(err.to_string())),
    }
    .map_err(|e| ApiError::internal(format!("failed to load live provider ids: {e}")))?;

    Ok(Json(provider_ids))
}

async fn import_providers_from_live(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<usize>, ApiError> {
    let imported = match AppType::from_str(&app) {
        Ok(AppType::OpenCode) => {
            crate::commands::import_opencode_providers_from_live_internal(state.app_state.as_ref())
        }
        Ok(AppType::OpenClaw) => {
            crate::commands::import_openclaw_providers_from_live_internal(state.app_state.as_ref())
        }
        Ok(app_type) => {
            return Err(ApiError::bad_request(format!(
                "{} does not support importing providers from live config",
                app_type.as_str()
            )));
        }
        Err(err) => return Err(ApiError::bad_request(err.to_string())),
    }
    .map_err(|e| ApiError::internal(format!("failed to import live providers: {e}")))?;

    Ok(Json(imported))
}

async fn remove_provider_from_live_config(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<bool>, ApiError> {
    let removed = crate::commands::remove_provider_from_live_config_internal(
        state.app_state.as_ref(),
        app,
        id,
    )
    .map_err(|e| ApiError::internal(format!("failed to remove provider from live config: {e}")))?;
    Ok(Json(removed))
}

async fn import_default_provider_config(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let imported =
        crate::commands::import_default_config_for_app_internal(state.app_state.as_ref(), app_type)
            .map_err(|e| ApiError::internal(format!("failed to import default config: {e}")))?;
    Ok(Json(imported))
}

async fn stream_check_provider(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<crate::services::stream_check::StreamCheckResult>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let result = crate::commands::stream_check_provider_internal(
        state.app_state.as_ref(),
        &state.copilot_auth_state,
        app_type,
        &id,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to stream check provider: {e}")))?;
    Ok(Json(result))
}

async fn stream_check_all_providers(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<StreamCheckAllProvidersRequest>,
) -> Result<Json<Vec<(String, crate::services::stream_check::StreamCheckResult)>>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let result = crate::commands::stream_check_all_providers_internal(
        state.app_state.as_ref(),
        &state.copilot_auth_state,
        app_type,
        payload.proxy_targets_only,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to stream check all providers: {e}")))?;
    Ok(Json(result))
}

async fn read_live_provider_settings(
    Path(app): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let settings = crate::commands::read_live_provider_settings_internal(app)
        .map_err(|e| ApiError::internal(format!("failed to read live provider settings: {e}")))?;
    Ok(Json(settings))
}

async fn query_provider_usage(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<crate::provider::UsageResult>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let result = crate::commands::query_provider_usage_internal(
        state.app_state.as_ref(),
        &state.copilot_auth_state,
        app_type,
        &id,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to query provider usage: {e}")))?;
    Ok(Json(result))
}

async fn test_usage_script(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(payload): Json<TestUsageScriptRequest>,
) -> Result<Json<crate::provider::UsageResult>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let result = crate::commands::test_usage_script_internal(
        state.app_state.as_ref(),
        app_type,
        &id,
        &payload.script_code,
        payload.timeout,
        payload.api_key.as_deref(),
        payload.base_url.as_deref(),
        payload.access_token.as_deref(),
        payload.user_id.as_deref(),
        payload.template_type.as_deref(),
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to test usage script: {e}")))?;
    Ok(Json(result))
}

async fn test_api_endpoints(
    Json(payload): Json<EndpointTestRequest>,
) -> Result<Json<Vec<EndpointLatency>>, ApiError> {
    let results = crate::commands::test_api_endpoints_internal(payload.urls, payload.timeout_secs)
        .await
        .map_err(|e| ApiError::internal(format!("failed to test api endpoints: {e}")))?;
    Ok(Json(results))
}

async fn fetch_provider_models(
    Json(payload): Json<FetchModelsRequest>,
) -> Result<Json<Vec<crate::services::model_fetch::FetchedModel>>, ApiError> {
    let models = crate::commands::fetch_models_for_config_internal(
        payload.base_url,
        payload.api_key,
        payload.is_full_url,
        payload.models_url,
    )
    .await
    .map_err(ApiError::bad_request)?;
    Ok(Json(models))
}

async fn get_windows_env_paths(
) -> Result<Json<std::collections::HashMap<String, String>>, ApiError> {
    Ok(Json(crate::commands::get_windows_env_paths_internal()))
}

async fn get_custom_endpoints(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<Vec<crate::settings::CustomEndpoint>>, ApiError> {
    let endpoints =
        crate::commands::get_custom_endpoints_internal(state.app_state.as_ref(), app, id)
            .map_err(|e| ApiError::internal(format!("failed to load custom endpoints: {e}")))?;
    Ok(Json(endpoints))
}

async fn add_custom_endpoint(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(payload): Json<CustomEndpointUrlRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::add_custom_endpoint_internal(state.app_state.as_ref(), app, id, payload.url)
        .map_err(|e| ApiError::internal(format!("failed to add custom endpoint: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_custom_endpoint(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(payload): Json<CustomEndpointUrlRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::remove_custom_endpoint_internal(
        state.app_state.as_ref(),
        app,
        id,
        payload.url,
    )
    .map_err(|e| ApiError::internal(format!("failed to remove custom endpoint: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_endpoint_last_used(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(payload): Json<CustomEndpointUrlRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::update_endpoint_last_used_internal(
        state.app_state.as_ref(),
        app,
        id,
        payload.url,
    )
    .map_err(|e| ApiError::internal(format!("failed to update endpoint last used: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_universal_providers(
    State(state): State<WebApiState>,
) -> Result<Json<HashMap<String, crate::provider::UniversalProvider>>, ApiError> {
    let providers = crate::commands::get_universal_providers_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load universal providers: {e}")))?;
    Ok(Json(providers))
}

async fn get_universal_provider(
    State(state): State<WebApiState>,
    Path(id): Path<String>,
) -> Result<Json<Option<crate::provider::UniversalProvider>>, ApiError> {
    let provider =
        crate::commands::get_universal_provider_internal(state.app_state.as_ref(), id)
            .map_err(|e| ApiError::internal(format!("failed to load universal provider: {e}")))?;
    Ok(Json(provider))
}

async fn upsert_universal_provider(
    State(state): State<WebApiState>,
    Json(provider): Json<crate::provider::UniversalProvider>,
) -> Result<Json<bool>, ApiError> {
    let result =
        crate::commands::upsert_universal_provider_internal(state.app_state.as_ref(), provider)
            .map_err(|e| ApiError::internal(format!("failed to save universal provider: {e}")))?;
    Ok(Json(result))
}

async fn delete_universal_provider(
    State(state): State<WebApiState>,
    Path(id): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let result = crate::commands::delete_universal_provider_internal(state.app_state.as_ref(), id)
        .map_err(|e| ApiError::internal(format!("failed to delete universal provider: {e}")))?;
    Ok(Json(result))
}

async fn sync_universal_provider(
    State(state): State<WebApiState>,
    Path(id): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let result = crate::commands::sync_universal_provider_internal(state.app_state.as_ref(), id)
        .map_err(|e| ApiError::internal(format!("failed to sync universal provider: {e}")))?;
    Ok(Json(result))
}

async fn get_installed_skills(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<crate::app_config::InstalledSkill>>, ApiError> {
    let skills = crate::commands::get_installed_skills_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load installed skills: {e}")))?;
    Ok(Json(skills))
}

async fn get_skill_backups() -> Result<Json<Vec<SkillBackupEntry>>, ApiError> {
    let backups = crate::commands::get_skill_backups_internal()
        .map_err(|e| ApiError::internal(format!("failed to load skill backups: {e}")))?;
    Ok(Json(backups))
}

async fn uninstall_skill_unified(
    State(state): State<WebApiState>,
    Path(id): Path<String>,
) -> Result<Json<SkillUninstallResult>, ApiError> {
    let result = crate::commands::uninstall_skill_unified_internal(state.app_state.as_ref(), id)
        .map_err(|e| ApiError::internal(format!("failed to uninstall skill: {e}")))?;
    Ok(Json(result))
}

async fn uninstall_skill_unified_by_body(
    State(state): State<WebApiState>,
    Json(payload): Json<SkillIdRequest>,
) -> Result<Json<SkillUninstallResult>, ApiError> {
    let result =
        crate::commands::uninstall_skill_unified_internal(state.app_state.as_ref(), payload.id)
            .map_err(|e| ApiError::internal(format!("failed to uninstall skill: {e}")))?;
    Ok(Json(result))
}

async fn toggle_skill_app(
    State(state): State<WebApiState>,
    Path((id, app)): Path<(String, String)>,
    Json(payload): Json<ToggleSkillAppRequest>,
) -> Result<Json<bool>, ApiError> {
    let result = crate::commands::toggle_skill_app_internal(
        state.app_state.as_ref(),
        id,
        app,
        payload.enabled,
    )
    .map_err(|e| ApiError::internal(format!("failed to toggle skill app: {e}")))?;
    Ok(Json(result))
}

async fn toggle_skill_app_by_body(
    State(state): State<WebApiState>,
    Json(payload): Json<ToggleSkillAppByBodyRequest>,
) -> Result<Json<bool>, ApiError> {
    let result = crate::commands::toggle_skill_app_internal(
        state.app_state.as_ref(),
        payload.id,
        payload.app,
        payload.enabled,
    )
    .map_err(|e| ApiError::internal(format!("failed to toggle skill app: {e}")))?;
    Ok(Json(result))
}

async fn scan_unmanaged_skills(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<crate::app_config::UnmanagedSkill>>, ApiError> {
    let skills = crate::commands::scan_unmanaged_skills_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to scan unmanaged skills: {e}")))?;
    Ok(Json(skills))
}

async fn import_skills_from_apps(
    State(state): State<WebApiState>,
    Json(imports): Json<Vec<ImportSkillSelection>>,
) -> Result<Json<Vec<crate::app_config::InstalledSkill>>, ApiError> {
    let skills =
        crate::commands::import_skills_from_apps_internal(state.app_state.as_ref(), imports)
            .map_err(|e| ApiError::internal(format!("failed to import skills from apps: {e}")))?;
    Ok(Json(skills))
}

async fn get_skill_repos(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<SkillRepo>>, ApiError> {
    let repos = crate::commands::get_skill_repos_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load skill repos: {e}")))?;
    Ok(Json(repos))
}

async fn add_skill_repo(
    State(state): State<WebApiState>,
    Json(repo): Json<SkillRepo>,
) -> Result<Json<bool>, ApiError> {
    let added = crate::commands::add_skill_repo_internal(state.app_state.as_ref(), repo)
        .map_err(|e| ApiError::internal(format!("failed to save skill repo: {e}")))?;
    Ok(Json(added))
}

async fn remove_skill_repo(
    State(state): State<WebApiState>,
    Path((owner, name)): Path<(String, String)>,
) -> Result<Json<bool>, ApiError> {
    let removed =
        crate::commands::remove_skill_repo_internal(state.app_state.as_ref(), owner, name)
            .map_err(|e| ApiError::internal(format!("failed to remove skill repo: {e}")))?;
    Ok(Json(removed))
}

async fn discover_available_skills(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<DiscoverableSkill>>, ApiError> {
    let skills = crate::commands::discover_available_skills_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to discover skills: {e}")))?;
    Ok(Json(skills))
}

async fn check_skill_updates(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<SkillUpdateInfo>>, ApiError> {
    let updates = crate::commands::check_skill_updates_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to check skill updates: {e}")))?;
    Ok(Json(updates))
}

async fn install_skill_unified(
    State(state): State<WebApiState>,
    Json(payload): Json<InstallSkillRequest>,
) -> Result<Json<crate::app_config::InstalledSkill>, ApiError> {
    let installed = crate::commands::install_skill_unified_internal(
        state.app_state.as_ref(),
        payload.skill,
        payload.current_app,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to install skill: {e}")))?;
    Ok(Json(installed))
}

async fn update_skill(
    State(state): State<WebApiState>,
    Json(payload): Json<SkillIdRequest>,
) -> Result<Json<crate::app_config::InstalledSkill>, ApiError> {
    let updated = crate::commands::update_skill_internal(state.app_state.as_ref(), payload.id)
        .await
        .map_err(|e| ApiError::internal(format!("failed to update skill: {e}")))?;
    Ok(Json(updated))
}

async fn migrate_skill_storage(
    State(state): State<WebApiState>,
    Json(payload): Json<MigrateSkillStorageRequest>,
) -> Result<Json<MigrationResult>, ApiError> {
    let result =
        crate::commands::migrate_skill_storage_internal(state.app_state.as_ref(), payload.target)
            .map_err(|e| ApiError::internal(format!("failed to migrate skill storage: {e}")))?;
    Ok(Json(result))
}

async fn search_skills_sh(
    Query(query): Query<SearchSkillsShQuery>,
) -> Result<Json<SkillsShSearchResult>, ApiError> {
    let result = crate::commands::search_skills_sh_internal(
        query.query,
        query.limit.unwrap_or(20),
        query.offset.unwrap_or(0),
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to search skills.sh: {e}")))?;
    Ok(Json(result))
}

async fn delete_skill_backup(Path(backup_id): Path<String>) -> Result<Json<bool>, ApiError> {
    let deleted = crate::commands::delete_skill_backup_internal(backup_id)
        .map_err(|e| ApiError::internal(format!("failed to delete skill backup: {e}")))?;
    Ok(Json(deleted))
}

async fn restore_skill_backup(
    State(state): State<WebApiState>,
    Path(backup_id): Path<String>,
    Json(payload): Json<CurrentAppRequest>,
) -> Result<Json<crate::app_config::InstalledSkill>, ApiError> {
    let restored = crate::commands::restore_skill_backup_internal(
        state.app_state.as_ref(),
        backup_id,
        payload.current_app,
    )
    .map_err(|e| ApiError::internal(format!("failed to restore skill backup: {e}")))?;
    Ok(Json(restored))
}

fn resolve_workspace_directory_path(subdir: &str) -> PathBuf {
    match subdir {
        "memory" => crate::openclaw_config::get_openclaw_dir()
            .join("workspace")
            .join("memory"),
        _ => crate::openclaw_config::get_openclaw_dir().join("workspace"),
    }
}

async fn get_workspace_file(
    Path(filename): Path<String>,
) -> Result<Json<Option<String>>, ApiError> {
    let content = crate::commands::read_workspace_file(filename)
        .await
        .map_err(|e| ApiError::internal(format!("failed to read workspace file: {e}")))?;
    Ok(Json(content))
}

async fn save_workspace_file(
    Path(filename): Path<String>,
    Json(payload): Json<ContentRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::write_workspace_file(filename, payload.content)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write workspace file: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_workspace_daily_memory_files(
) -> Result<Json<Vec<crate::DailyMemoryFileInfo>>, ApiError> {
    let files = crate::commands::list_daily_memory_files()
        .await
        .map_err(|e| ApiError::internal(format!("failed to list daily memory files: {e}")))?;
    Ok(Json(files))
}

async fn search_workspace_daily_memory_files(
    Query(query): Query<DailyMemorySearchQuery>,
) -> Result<Json<Vec<crate::DailyMemorySearchResult>>, ApiError> {
    let results = crate::commands::search_daily_memory_files(query.query)
        .await
        .map_err(|e| ApiError::internal(format!("failed to search daily memory files: {e}")))?;
    Ok(Json(results))
}

async fn get_workspace_daily_memory_file(
    Path(filename): Path<String>,
) -> Result<Json<Option<String>>, ApiError> {
    let content = crate::commands::read_daily_memory_file(filename)
        .await
        .map_err(|e| ApiError::internal(format!("failed to read daily memory file: {e}")))?;
    Ok(Json(content))
}

async fn save_workspace_daily_memory_file(
    Path(filename): Path<String>,
    Json(payload): Json<ContentRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::write_daily_memory_file(filename, payload.content)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write daily memory file: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_workspace_daily_memory_file(
    Path(filename): Path<String>,
) -> Result<StatusCode, ApiError> {
    crate::commands::delete_daily_memory_file(filename)
        .await
        .map_err(|e| ApiError::internal(format!("failed to delete daily memory file: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_workspace_directory_path(
    Path(subdir): Path<String>,
) -> Result<Json<String>, ApiError> {
    let path = resolve_workspace_directory_path(&subdir);
    std::fs::create_dir_all(&path)
        .map_err(|e| ApiError::internal(format!("failed to prepare workspace directory: {e}")))?;
    Ok(Json(path.to_string_lossy().to_string()))
}

async fn get_openclaw_default_model(
) -> Result<Json<Option<crate::openclaw_config::OpenClawDefaultModel>>, ApiError> {
    let model = crate::commands::get_openclaw_default_model_internal()
        .map_err(|e| ApiError::internal(format!("failed to load openclaw default model: {e}")))?;
    Ok(Json(model))
}

async fn set_openclaw_default_model(
    Json(model): Json<crate::openclaw_config::OpenClawDefaultModel>,
) -> Result<Json<crate::openclaw_config::OpenClawWriteOutcome>, ApiError> {
    let outcome = crate::commands::set_openclaw_default_model_internal(model)
        .map_err(|e| ApiError::internal(format!("failed to save openclaw default model: {e}")))?;
    Ok(Json(outcome))
}

async fn get_openclaw_model_catalog() -> Result<
    Json<Option<HashMap<String, crate::openclaw_config::OpenClawModelCatalogEntry>>>,
    ApiError,
> {
    let catalog = crate::commands::get_openclaw_model_catalog_internal()
        .map_err(|e| ApiError::internal(format!("failed to load openclaw model catalog: {e}")))?;
    Ok(Json(catalog))
}

async fn set_openclaw_model_catalog(
    Json(catalog): Json<HashMap<String, crate::openclaw_config::OpenClawModelCatalogEntry>>,
) -> Result<Json<crate::openclaw_config::OpenClawWriteOutcome>, ApiError> {
    let outcome = crate::commands::set_openclaw_model_catalog_internal(catalog)
        .map_err(|e| ApiError::internal(format!("failed to save openclaw model catalog: {e}")))?;
    Ok(Json(outcome))
}

async fn get_openclaw_agents_defaults(
) -> Result<Json<Option<crate::openclaw_config::OpenClawAgentsDefaults>>, ApiError> {
    let defaults = crate::commands::get_openclaw_agents_defaults_internal()
        .map_err(|e| ApiError::internal(format!("failed to load openclaw agents defaults: {e}")))?;
    Ok(Json(defaults))
}

async fn set_openclaw_agents_defaults(
    Json(defaults): Json<crate::openclaw_config::OpenClawAgentsDefaults>,
) -> Result<Json<crate::openclaw_config::OpenClawWriteOutcome>, ApiError> {
    let outcome = crate::commands::set_openclaw_agents_defaults_internal(defaults)
        .map_err(|e| ApiError::internal(format!("failed to save openclaw agents defaults: {e}")))?;
    Ok(Json(outcome))
}

async fn get_openclaw_env() -> Result<Json<crate::openclaw_config::OpenClawEnvConfig>, ApiError> {
    let env = crate::commands::get_openclaw_env_internal()
        .map_err(|e| ApiError::internal(format!("failed to load openclaw env config: {e}")))?;
    Ok(Json(env))
}

async fn set_openclaw_env(
    Json(env): Json<crate::openclaw_config::OpenClawEnvConfig>,
) -> Result<Json<crate::openclaw_config::OpenClawWriteOutcome>, ApiError> {
    let outcome = crate::commands::set_openclaw_env_internal(env)
        .map_err(|e| ApiError::internal(format!("failed to save openclaw env config: {e}")))?;
    Ok(Json(outcome))
}

async fn get_openclaw_tools() -> Result<Json<crate::openclaw_config::OpenClawToolsConfig>, ApiError>
{
    let tools = crate::commands::get_openclaw_tools_internal()
        .map_err(|e| ApiError::internal(format!("failed to load openclaw tools config: {e}")))?;
    Ok(Json(tools))
}

async fn set_openclaw_tools(
    Json(tools): Json<crate::openclaw_config::OpenClawToolsConfig>,
) -> Result<Json<crate::openclaw_config::OpenClawWriteOutcome>, ApiError> {
    let outcome = crate::commands::set_openclaw_tools_internal(tools)
        .map_err(|e| ApiError::internal(format!("failed to save openclaw tools config: {e}")))?;
    Ok(Json(outcome))
}

async fn scan_openclaw_config_health(
) -> Result<Json<Vec<crate::openclaw_config::OpenClawHealthWarning>>, ApiError> {
    let warnings = crate::commands::scan_openclaw_config_health_internal()
        .map_err(|e| ApiError::internal(format!("failed to scan openclaw config health: {e}")))?;
    Ok(Json(warnings))
}

async fn get_openclaw_live_provider(
    Path(provider_id): Path<String>,
) -> Result<Json<Option<serde_json::Value>>, ApiError> {
    let provider = crate::commands::get_openclaw_live_provider_internal(&provider_id)
        .map_err(|e| ApiError::internal(format!("failed to load openclaw live provider: {e}")))?;
    Ok(Json(provider))
}

#[derive(Debug, Deserialize)]
struct HermesMemoryUpdatePayload {
    content: String,
}

#[derive(Debug, Deserialize)]
struct HermesMemoryEnabledPayload {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct HermesWebUiQuery {
    path: Option<String>,
}

async fn get_hermes_web_ui_url(
    Query(query): Query<HermesWebUiQuery>,
) -> Result<Json<String>, ApiError> {
    let url = crate::commands::get_hermes_web_ui_url_internal(query.path)
        .map_err(|e| ApiError::bad_request(e))?;
    Ok(Json(url))
}

async fn launch_hermes_dashboard() -> Result<Json<bool>, ApiError> {
    let opened = crate::commands::launch_hermes_dashboard_internal()
        .map_err(|e| ApiError::internal(format!("failed to launch hermes dashboard: {e}")))?;
    Ok(Json(opened))
}

async fn get_hermes_model_config(
) -> Result<Json<Option<crate::hermes_config::HermesModelConfig>>, ApiError> {
    let model = crate::commands::get_hermes_model_config_internal()
        .map_err(|e| ApiError::internal(format!("failed to load hermes model config: {e}")))?;
    Ok(Json(model))
}

async fn get_hermes_live_provider_ids() -> Result<Json<Vec<String>>, ApiError> {
    let ids = crate::commands::get_hermes_live_provider_ids_internal()
        .map_err(|e| ApiError::internal(format!("failed to load hermes live provider ids: {e}")))?;
    Ok(Json(ids))
}

async fn scan_hermes_config_health(
) -> Result<Json<Vec<crate::hermes_config::HermesHealthWarning>>, ApiError> {
    let warnings = crate::commands::scan_hermes_config_health_internal()
        .map_err(|e| ApiError::internal(format!("failed to scan hermes config health: {e}")))?;
    Ok(Json(warnings))
}

async fn get_hermes_memory(
    Path(kind): Path<crate::hermes_config::MemoryKind>,
) -> Result<Json<String>, ApiError> {
    let content = crate::commands::get_hermes_memory_internal(kind)
        .map_err(|e| ApiError::internal(format!("failed to load hermes memory: {e}")))?;
    Ok(Json(content))
}

async fn set_hermes_memory(
    Path(kind): Path<crate::hermes_config::MemoryKind>,
    Json(payload): Json<HermesMemoryUpdatePayload>,
) -> Result<StatusCode, ApiError> {
    crate::commands::set_hermes_memory_internal(kind, payload.content)
        .map_err(|e| ApiError::internal(format!("failed to save hermes memory: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_hermes_memory_limits(
) -> Result<Json<crate::hermes_config::HermesMemoryLimits>, ApiError> {
    let limits = crate::commands::get_hermes_memory_limits_internal()
        .map_err(|e| ApiError::internal(format!("failed to load hermes memory limits: {e}")))?;
    Ok(Json(limits))
}

async fn set_hermes_memory_enabled(
    Path(kind): Path<crate::hermes_config::MemoryKind>,
    Json(payload): Json<HermesMemoryEnabledPayload>,
) -> Result<StatusCode, ApiError> {
    crate::commands::set_hermes_memory_enabled_internal(kind, payload.enabled)
        .map_err(|e| ApiError::internal(format!("failed to update hermes memory toggle: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_sessions() -> Result<Json<Vec<crate::session_manager::SessionMeta>>, ApiError> {
    let sessions = crate::commands::list_sessions_internal()
        .await
        .map_err(|e| ApiError::internal(format!("failed to list sessions: {e}")))?;
    Ok(Json(sessions))
}

async fn get_session_messages(
    Query(query): Query<SessionMessagesQuery>,
) -> Result<Json<Vec<crate::session_manager::SessionMessage>>, ApiError> {
    let messages =
        crate::commands::get_session_messages_internal(query.provider_id, query.source_path)
            .await
            .map_err(|e| ApiError::internal(format!("failed to load session messages: {e}")))?;
    Ok(Json(messages))
}

async fn launch_session_terminal(
    Json(payload): Json<LaunchSessionTerminalRequest>,
) -> Result<Json<bool>, ApiError> {
    let opened = crate::commands::launch_session_terminal_internal(
        payload.command,
        payload.cwd,
        payload.custom_config,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to launch session terminal: {e}")))?;
    Ok(Json(opened))
}

async fn delete_session(
    Json(payload): Json<crate::session_manager::DeleteSessionRequest>,
) -> Result<Json<bool>, ApiError> {
    let deleted = crate::commands::delete_session_internal(
        payload.provider_id,
        payload.session_id,
        payload.source_path,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to delete session: {e}")))?;
    Ok(Json(deleted))
}

async fn delete_sessions(
    Json(items): Json<Vec<crate::session_manager::DeleteSessionRequest>>,
) -> Result<Json<Vec<crate::session_manager::DeleteSessionOutcome>>, ApiError> {
    let results = crate::commands::delete_sessions_internal(items)
        .await
        .map_err(|e| ApiError::internal(format!("failed to delete sessions: {e}")))?;
    Ok(Json(results))
}

async fn get_usage_summary(
    State(state): State<WebApiState>,
    Query(query): Query<UsageRangeQuery>,
) -> Result<Json<crate::services::usage_stats::UsageSummary>, ApiError> {
    let summary = crate::commands::get_usage_summary_internal(
        state.app_state.as_ref(),
        query.start_date,
        query.end_date,
        query.app_type.clone(),
    )
    .map_err(|e| ApiError::internal(format!("failed to load usage summary: {e}")))?;
    Ok(Json(summary))
}

async fn get_usage_trends(
    State(state): State<WebApiState>,
    Query(query): Query<UsageRangeQuery>,
) -> Result<Json<Vec<crate::services::usage_stats::DailyStats>>, ApiError> {
    let trends = crate::commands::get_usage_trends_internal(
        state.app_state.as_ref(),
        query.start_date,
        query.end_date,
        query.app_type.clone(),
    )
    .map_err(|e| ApiError::internal(format!("failed to load usage trends: {e}")))?;
    Ok(Json(trends))
}

async fn get_usage_provider_stats(
    State(state): State<WebApiState>,
    Query(query): Query<UsageRangeQuery>,
) -> Result<Json<Vec<crate::services::usage_stats::ProviderStats>>, ApiError> {
    let stats = crate::commands::get_provider_stats_internal(
        state.app_state.as_ref(),
        query.start_date,
        query.end_date,
        query.app_type.clone(),
    )
        .map_err(|e| ApiError::internal(format!("failed to load provider stats: {e}")))?;
    Ok(Json(stats))
}

async fn get_usage_model_stats(
    State(state): State<WebApiState>,
    Query(query): Query<UsageRangeQuery>,
) -> Result<Json<Vec<crate::services::usage_stats::ModelStats>>, ApiError> {
    let stats = crate::commands::get_model_stats_internal(
        state.app_state.as_ref(),
        query.start_date,
        query.end_date,
        query.app_type.clone(),
    )
        .map_err(|e| ApiError::internal(format!("failed to load model stats: {e}")))?;
    Ok(Json(stats))
}

async fn get_usage_request_logs(
    State(state): State<WebApiState>,
    Json(payload): Json<RequestLogsPayload>,
) -> Result<Json<crate::services::usage_stats::PaginatedLogs>, ApiError> {
    let logs = crate::commands::get_request_logs_internal(
        state.app_state.as_ref(),
        payload.filters,
        payload.page.unwrap_or(0),
        payload.page_size.unwrap_or(20),
    )
    .map_err(|e| ApiError::internal(format!("failed to load request logs: {e}")))?;
    Ok(Json(logs))
}

async fn get_usage_request_detail(
    State(state): State<WebApiState>,
    Path(request_id): Path<String>,
) -> Result<Json<Option<crate::services::usage_stats::RequestLogDetail>>, ApiError> {
    let detail = crate::commands::get_request_detail_internal(state.app_state.as_ref(), request_id)
        .map_err(|e| ApiError::internal(format!("failed to load request detail: {e}")))?;
    Ok(Json(detail))
}

async fn sync_usage_session_logs(
    State(state): State<WebApiState>,
) -> Result<Json<crate::services::session_usage::SessionSyncResult>, ApiError> {
    let result = crate::commands::sync_session_usage_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to sync session usage: {e}")))?;
    Ok(Json(result))
}

async fn get_usage_data_sources(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<crate::services::session_usage::DataSourceSummary>>, ApiError> {
    let sources = crate::commands::get_usage_data_sources_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load usage data sources: {e}")))?;
    Ok(Json(sources))
}

async fn get_usage_model_pricing(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<UsageModelPricingInfo>>, ApiError> {
    let pricing = crate::commands::get_model_pricing_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load model pricing: {e}")))?;
    Ok(Json(
        pricing
            .into_iter()
            .map(|item| UsageModelPricingInfo {
                model_id: item.model_id,
                display_name: item.display_name,
                input_cost_per_million: item.input_cost_per_million,
                output_cost_per_million: item.output_cost_per_million,
                cache_read_cost_per_million: item.cache_read_cost_per_million,
                cache_creation_cost_per_million: item.cache_creation_cost_per_million,
            })
            .collect(),
    ))
}

async fn update_usage_model_pricing(
    State(state): State<WebApiState>,
    Path(model_id): Path<String>,
    Json(payload): Json<UpdateModelPricingPayload>,
) -> Result<StatusCode, ApiError> {
    crate::commands::update_model_pricing_internal(
        state.app_state.as_ref(),
        model_id,
        payload.display_name,
        payload.input_cost,
        payload.output_cost,
        payload.cache_read_cost,
        payload.cache_creation_cost,
    )
    .map_err(|e| ApiError::internal(format!("failed to update model pricing: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_usage_model_pricing(
    State(state): State<WebApiState>,
    Path(model_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    crate::commands::delete_model_pricing_internal(state.app_state.as_ref(), model_id)
        .map_err(|e| ApiError::internal(format!("failed to delete model pricing: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_usage_provider_limits(
    State(state): State<WebApiState>,
    Path((app_type, provider_id)): Path<(String, String)>,
) -> Result<Json<crate::services::usage_stats::ProviderLimitStatus>, ApiError> {
    let limits = crate::commands::check_provider_limits_internal(
        state.app_state.as_ref(),
        provider_id,
        app_type,
    )
    .map_err(|e| ApiError::internal(format!("failed to load provider limits: {e}")))?;
    Ok(Json(limits))
}

fn sanitize_uploaded_archive_name(file_name: &str, index: usize) -> String {
    let fallback = format!("skill-archive-{}.zip", index + 1);
    let candidate = std::path::Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&fallback);

    let mut sanitized = candidate
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();

    if sanitized.trim().is_empty() {
        sanitized = fallback;
    }

    if !sanitized.to_ascii_lowercase().ends_with(".zip") {
        sanitized.push_str(".zip");
    }

    sanitized
}

async fn install_skill_archives(
    State(state): State<WebApiState>,
    mut multipart: Multipart,
) -> Result<Json<Vec<SkillArchiveInstallResult>>, ApiError> {
    let mut current_app: Option<String> = None;
    let mut uploads: Vec<(String, bytes::Bytes)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad_request(format!("failed to read upload field: {e}")))?
    {
        match field.name() {
            Some("currentApp") => {
                current_app = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            ApiError::bad_request(format!(
                                "failed to read currentApp from upload payload: {e}"
                            ))
                        })?
                        .trim()
                        .to_string(),
                );
            }
            Some("archives") => {
                let file_name = field.file_name().unwrap_or("skill-archive.zip").to_string();
                let bytes = field.bytes().await.map_err(|e| {
                    ApiError::bad_request(format!(
                        "failed to read uploaded archive {file_name}: {e}"
                    ))
                })?;
                uploads.push((file_name, bytes));
            }
            _ => {}
        }
    }

    let current_app = current_app
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("missing currentApp in upload payload"))?;
    AppType::from_str(&current_app).map_err(|e| ApiError::bad_request(e.to_string()))?;

    if uploads.is_empty() {
        return Err(ApiError::bad_request("missing archives in upload payload"));
    }

    let temp_dir = tempfile::tempdir()
        .map_err(|e| ApiError::internal(format!("failed to prepare upload temp dir: {e}")))?;
    let mut results = Vec::with_capacity(uploads.len());

    for (index, (original_name, bytes)) in uploads.into_iter().enumerate() {
        let is_zip = std::path::Path::new(&original_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("zip"))
            .unwrap_or(false);
        let file_name = sanitize_uploaded_archive_name(&original_name, index);
        if !is_zip {
            results.push(SkillArchiveInstallResult {
                file_name,
                installed: Vec::new(),
                error: Some("only .zip archives are supported".to_string()),
            });
            continue;
        }

        let archive_path = temp_dir.path().join(&file_name);
        std::fs::write(&archive_path, &bytes).map_err(|e| {
            ApiError::internal(format!(
                "failed to persist uploaded archive {}: {e}",
                archive_path.display()
            ))
        })?;

        let install_result = crate::commands::install_skills_from_zip_internal(
            state.app_state.as_ref(),
            &archive_path,
            current_app.clone(),
        );

        let _ = std::fs::remove_file(&archive_path);

        match install_result {
            Ok(installed) => results.push(SkillArchiveInstallResult {
                file_name,
                installed,
                error: None,
            }),
            Err(error) => results.push(SkillArchiveInstallResult {
                file_name,
                installed: Vec::new(),
                error: Some(error.to_string()),
            }),
        }
    }

    Ok(Json(results))
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

async fn root() -> Json<RootResponse> {
    Json(RootResponse {
        name: "cc-switch-web",
        mode: "local-rust-service",
        api_base: "/api",
    })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        mode: "local-rust-service",
    })
}

async fn get_settings() -> Json<crate::settings::AppSettings> {
    Json(crate::commands::get_settings_internal())
}

async fn export_config_download(
    State(state): State<WebApiState>,
    Query(query): Query<ExportConfigQuery>,
) -> Result<Response, ApiError> {
    let sql = state
        .app_state
        .db
        .export_sql_string()
        .map_err(|e| ApiError::internal(format!("failed to export config: {e}")))?;
    let filename = sanitize_export_sql_filename(query.filename);
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
        .map_err(|e| ApiError::internal(format!("failed to encode download filename: {e}")))?;

    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/sql; charset=utf-8"),
            ),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Body::from(sql.into_bytes()),
    )
        .into_response())
}

async fn import_config_upload(
    State(state): State<WebApiState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut file_name: Option<String> = None;
    let mut sql_raw: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad_request(format!("failed to read upload field: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let current_file_name = field
            .file_name()
            .unwrap_or("cc-switch-import.sql")
            .to_string();
        let bytes = field.bytes().await.map_err(|e| {
            ApiError::bad_request(format!(
                "failed to read uploaded config file {current_file_name}: {e}"
            ))
        })?;

        let sql = String::from_utf8(bytes.to_vec()).map_err(|e| {
            ApiError::bad_request(format!(
                "uploaded config file must be valid UTF-8 SQL text: {e}"
            ))
        })?;

        file_name = Some(current_file_name);
        sql_raw = Some(sql);
        break;
    }

    let file_name = file_name.unwrap_or_else(|| "cc-switch-import.sql".to_string());
    if !file_name.to_ascii_lowercase().ends_with(".sql") {
        return Err(ApiError::bad_request("only .sql files are supported"));
    }

    let backup_id = state
        .app_state
        .db
        .import_sql_string(
            sql_raw
                .as_deref()
                .ok_or_else(|| ApiError::bad_request("missing uploaded config file"))?,
        )
        .map_err(|e| ApiError::internal(format!("failed to import config: {e}")))?;

    let warning = crate::commands::post_import_sync_warning_for_state(state.app_state.as_ref());
    if let Some(message) = warning.as_ref() {
        log::warn!("[Import] post-import sync warning: {message}");
    }

    let mut payload = json!({
        "success": true,
        "message": "SQL imported successfully",
        "backupId": backup_id,
    });
    if let Some(message) = warning {
        if let Some(object) = payload.as_object_mut() {
            object.insert("warning".to_string(), Value::String(message));
        }
    }

    Ok(Json(payload))
}

async fn webdav_test_connection(
    Json(payload): Json<WebdavTestRequest>,
) -> Result<Json<Value>, ApiError> {
    crate::commands::webdav_test_connection_internal(
        payload.settings,
        payload.preserve_empty_password,
    )
    .await
    .map(Json)
    .map_err(|e| ApiError::bad_request(e.to_string()))
}

async fn webdav_sync_upload(State(state): State<WebApiState>) -> Result<Json<Value>, ApiError> {
    crate::commands::webdav_sync_upload_internal(state.app_state.db.clone())
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to upload webdav snapshot: {e}")))
}

async fn webdav_sync_download(State(state): State<WebApiState>) -> Result<Json<Value>, ApiError> {
    crate::commands::webdav_sync_download_internal(state.app_state.db.clone())
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to download webdav snapshot: {e}")))
}

async fn webdav_sync_save_settings(
    Json(payload): Json<WebdavSaveSettingsRequest>,
) -> Result<Json<Value>, ApiError> {
    crate::commands::webdav_sync_save_settings_internal(payload.settings, payload.password_touched)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save webdav sync settings: {e}")))
}

async fn webdav_sync_fetch_remote_info() -> Result<Json<Value>, ApiError> {
    crate::commands::webdav_sync_fetch_remote_info_internal()
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to fetch webdav remote info: {e}")))
}

async fn save_settings(
    Json(settings): Json<crate::settings::AppSettings>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::save_settings_internal(settings)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save settings: {e}")))
}

async fn get_auto_launch_status() -> Result<Json<bool>, ApiError> {
    crate::commands::get_auto_launch_status_internal()
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to get auto launch status: {e}")))
}

async fn set_auto_launch(Json(payload): Json<EnabledRequest>) -> Result<Json<bool>, ApiError> {
    crate::commands::set_auto_launch_internal(payload.enabled)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to set auto launch: {e}")))
}

async fn apply_claude_plugin_config(
    Json(payload): Json<OfficialRequest>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::apply_claude_plugin_config_internal(payload.official)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to apply claude plugin config: {e}")))
}

async fn apply_claude_onboarding_skip() -> Result<Json<bool>, ApiError> {
    crate::commands::apply_claude_onboarding_skip_internal()
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to apply claude onboarding skip: {e}")))
}

async fn clear_claude_onboarding_skip() -> Result<Json<bool>, ApiError> {
    crate::commands::clear_claude_onboarding_skip_internal()
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to clear claude onboarding skip: {e}")))
}

async fn get_app_config_dir_override() -> Json<Option<String>> {
    Json(crate::commands::get_app_config_dir_override_internal().unwrap_or(None))
}

async fn get_app_config_dir() -> Result<Json<String>, ApiError> {
    crate::commands::get_app_config_dir_internal()
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load app config dir: {e}")))
}

async fn get_default_app_config_dir() -> Result<Json<String>, ApiError> {
    crate::commands::get_default_app_config_dir_internal()
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load default app config dir: {e}")))
}

async fn set_app_config_dir_override(
    Json(payload): Json<OptionalPathRequest>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::set_app_config_dir_override_internal(payload.path)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save app config dir override: {e}")))
}

async fn get_common_config_snippet(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<Option<String>>, ApiError> {
    crate::commands::get_common_config_snippet_internal(state.app_state.as_ref(), &app)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load common config snippet: {e}")))
}

async fn set_common_config_snippet(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<SnippetRequest>,
) -> Result<StatusCode, ApiError> {
    match crate::commands::set_common_config_snippet_internal(
        state.app_state.as_ref(),
        &app,
        payload.snippet,
    ) {
        Ok(()) => {}
        Err(crate::commands::ConfigCommandError::BadRequest(message)) => {
            return Err(ApiError::bad_request(message));
        }
        Err(crate::commands::ConfigCommandError::Internal(message)) => {
            return Err(ApiError::internal(format!(
                "failed to save common config snippet: {message}"
            )));
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn extract_common_config_snippet(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<ExtractCommonConfigSnippetRequest>,
) -> Result<Json<String>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;

    let settings =
        if let Some(settings_config) = payload
            .settings_config
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            Some(serde_json::from_str(settings_config).map_err(|e| {
                ApiError::bad_request(crate::commands::invalid_json_format_error(e))
            })?)
        } else {
            None
        };

    match crate::commands::extract_common_config_snippet_internal(
        state.app_state.as_ref(),
        app_type,
        settings,
    ) {
        Ok(snippet) => Ok(Json(snippet)),
        Err(crate::commands::ConfigCommandError::BadRequest(message)) => {
            Err(ApiError::bad_request(message))
        }
        Err(crate::commands::ConfigCommandError::Internal(message)) => Err(ApiError::internal(
            format!("failed to extract common config snippet: {message}"),
        )),
    }
}

async fn sync_current_providers_live(
    State(state): State<WebApiState>,
) -> Result<Json<Value>, ApiError> {
    crate::commands::sync_current_providers_live_internal(state.app_state.db.clone())
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to sync current providers to live: {e}")))
}

async fn get_rectifier_config(
    State(state): State<WebApiState>,
) -> Result<Json<RectifierConfig>, ApiError> {
    crate::commands::get_rectifier_config_internal(state.app_state.as_ref())
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load rectifier config: {e}")))
}

async fn set_rectifier_config(
    State(state): State<WebApiState>,
    Json(config): Json<RectifierConfig>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::set_rectifier_config_internal(state.app_state.as_ref(), config)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save rectifier config: {e}")))
}

async fn get_optimizer_config(
    State(state): State<WebApiState>,
) -> Result<Json<OptimizerConfig>, ApiError> {
    crate::commands::get_optimizer_config_internal(state.app_state.as_ref())
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load optimizer config: {e}")))
}

async fn set_optimizer_config(
    State(state): State<WebApiState>,
    Json(config): Json<OptimizerConfig>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::set_optimizer_config_internal(state.app_state.as_ref(), config)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save optimizer config: {e}")))
}

async fn get_log_config(State(state): State<WebApiState>) -> Result<Json<LogConfig>, ApiError> {
    crate::commands::get_log_config_internal(state.app_state.as_ref())
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to load log config: {e}")))
}

async fn set_log_config(
    State(state): State<WebApiState>,
    Json(config): Json<LogConfig>,
) -> Result<Json<bool>, ApiError> {
    crate::commands::set_log_config_internal(state.app_state.as_ref(), config)
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to save log config: {e}")))
}

async fn get_stream_check_config(
    State(state): State<WebApiState>,
) -> Result<Json<crate::services::stream_check::StreamCheckConfig>, ApiError> {
    let config = crate::commands::get_stream_check_config_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load stream check config: {e}")))?;
    Ok(Json(config))
}

async fn set_stream_check_config(
    State(state): State<WebApiState>,
    Json(config): Json<crate::services::stream_check::StreamCheckConfig>,
) -> Result<StatusCode, ApiError> {
    crate::commands::save_stream_check_config_internal(state.app_state.as_ref(), config)
        .map_err(|e| ApiError::internal(format!("failed to save stream check config: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_tool_versions(
    Json(payload): Json<ToolVersionsRequest>,
) -> Result<Json<Vec<crate::commands::ToolVersion>>, ApiError> {
    let versions = crate::commands::get_tool_versions(payload.tools, payload.wsl_shell_by_tool)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load tool versions: {e}")))?;
    Ok(Json(versions))
}

async fn get_latest_release(
    Query(query): Query<LatestReleaseQuery>,
) -> Result<Json<crate::commands::LatestReleaseInfo>, ApiError> {
    let release = crate::commands::get_latest_release_info(query.current_version)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load latest release info: {e}")))?;
    Ok(Json(release))
}

async fn auth_start_login(
    State(state): State<WebApiState>,
    Json(payload): Json<AuthStartLoginRequest>,
) -> Result<Json<crate::commands::ManagedAuthDeviceCodeResponse>, ApiError> {
    let response = crate::commands::auth_start_login_internal(
        &payload.auth_provider,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to start auth login: {e}")))?;
    Ok(Json(response))
}

async fn auth_poll_for_account(
    State(state): State<WebApiState>,
    Json(payload): Json<AuthPollForAccountRequest>,
) -> Result<Json<Option<crate::commands::ManagedAuthAccount>>, ApiError> {
    let account = crate::commands::auth_poll_for_account_internal(
        &payload.auth_provider,
        &payload.device_code,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to poll auth account: {e}")))?;
    Ok(Json(account))
}

async fn auth_list_accounts(
    State(state): State<WebApiState>,
    Path(auth_provider): Path<String>,
) -> Result<Json<Vec<crate::commands::ManagedAuthAccount>>, ApiError> {
    let accounts = crate::commands::auth_list_accounts_internal(
        &auth_provider,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to list auth accounts: {e}")))?;
    Ok(Json(accounts))
}

async fn auth_get_status(
    State(state): State<WebApiState>,
    Path(auth_provider): Path<String>,
) -> Result<Json<crate::commands::ManagedAuthStatus>, ApiError> {
    let status = crate::commands::auth_get_status_internal(
        &auth_provider,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to load auth status: {e}")))?;
    Ok(Json(status))
}

async fn auth_remove_account(
    State(state): State<WebApiState>,
    Json(payload): Json<AuthAccountRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::auth_remove_account_internal(
        &payload.auth_provider,
        &payload.account_id,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to remove auth account: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn auth_set_default_account(
    State(state): State<WebApiState>,
    Json(payload): Json<AuthAccountRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::auth_set_default_account_internal(
        &payload.auth_provider,
        &payload.account_id,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to set default auth account: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn auth_logout(
    State(state): State<WebApiState>,
    Json(payload): Json<AuthStartLoginRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::auth_logout_internal(
        &payload.auth_provider,
        &state.copilot_auth_state,
        &state.codex_oauth_state,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to logout auth provider: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_copilot_token(State(state): State<WebApiState>) -> Result<Json<String>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let token = auth_manager
        .get_valid_token()
        .await
        .map_err(|e| ApiError::internal(format!("failed to load copilot token: {e}")))?;
    Ok(Json(token))
}

async fn get_copilot_token_for_account(
    State(state): State<WebApiState>,
    Path(account_id): Path<String>,
) -> Result<Json<String>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let token = auth_manager
        .get_valid_token_for_account(&account_id)
        .await
        .map_err(|e| {
            ApiError::internal(format!(
                "failed to load copilot token for account {account_id}: {e}"
            ))
        })?;
    Ok(Json(token))
}

async fn get_copilot_models(
    State(state): State<WebApiState>,
) -> Result<Json<Vec<crate::proxy::providers::copilot_auth::CopilotModel>>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let models = auth_manager
        .fetch_models()
        .await
        .map_err(|e| ApiError::internal(format!("failed to load copilot models: {e}")))?;
    Ok(Json(models))
}

async fn get_copilot_models_for_account(
    State(state): State<WebApiState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<crate::proxy::providers::copilot_auth::CopilotModel>>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let models = auth_manager
        .fetch_models_for_account(&account_id)
        .await
        .map_err(|e| {
            ApiError::internal(format!(
                "failed to load copilot models for account {account_id}: {e}"
            ))
        })?;
    Ok(Json(models))
}

async fn get_copilot_usage(
    State(state): State<WebApiState>,
) -> Result<Json<crate::proxy::providers::copilot_auth::CopilotUsageResponse>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let usage = auth_manager
        .fetch_usage()
        .await
        .map_err(|e| ApiError::internal(format!("failed to load copilot usage: {e}")))?;
    Ok(Json(usage))
}

async fn get_copilot_usage_for_account(
    State(state): State<WebApiState>,
    Path(account_id): Path<String>,
) -> Result<Json<crate::proxy::providers::copilot_auth::CopilotUsageResponse>, ApiError> {
    let auth_manager = state.copilot_auth_state.read().await;
    let usage = auth_manager
        .fetch_usage_for_account(&account_id)
        .await
        .map_err(|e| {
            ApiError::internal(format!(
                "failed to load copilot usage for account {account_id}: {e}"
            ))
        })?;
    Ok(Json(usage))
}

async fn get_subscription_quota(
    Path(tool): Path<String>,
) -> Result<Json<crate::services::subscription::SubscriptionQuota>, ApiError> {
    let quota = crate::commands::get_subscription_quota_internal(tool)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load subscription quota: {e}")))?;
    Ok(Json(quota))
}

async fn get_codex_oauth_quota(
    State(state): State<WebApiState>,
    Query(query): Query<CodexOauthQuotaQuery>,
) -> Result<Json<crate::services::subscription::SubscriptionQuota>, ApiError> {
    let quota =
        crate::commands::get_codex_oauth_quota_internal(query.account_id, &state.codex_oauth_state)
            .await
            .map_err(|e| ApiError::internal(format!("failed to load codex oauth quota: {e}")))?;
    Ok(Json(quota))
}

async fn get_coding_plan_quota(
    Json(payload): Json<CredentialQueryRequest>,
) -> Result<Json<crate::services::subscription::SubscriptionQuota>, ApiError> {
    let quota = crate::commands::get_coding_plan_quota_internal(payload.base_url, payload.api_key)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load coding plan quota: {e}")))?;
    Ok(Json(quota))
}

async fn get_balance(
    Json(payload): Json<CredentialQueryRequest>,
) -> Result<Json<crate::provider::UsageResult>, ApiError> {
    let result = crate::commands::get_balance_internal(payload.base_url, payload.api_key)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load balance: {e}")))?;
    Ok(Json(result))
}

async fn get_env_conflicts(
    Path(app): Path<String>,
) -> Result<Json<Vec<crate::services::env_checker::EnvConflict>>, ApiError> {
    let conflicts = crate::commands::check_env_conflicts_internal(app)
        .map_err(|e| ApiError::internal(format!("failed to check env conflicts: {e}")))?;
    Ok(Json(conflicts))
}

async fn delete_env_conflicts(
    Json(payload): Json<EnvConflictListRequest>,
) -> Result<Json<crate::services::env_manager::BackupInfo>, ApiError> {
    let backup = crate::commands::delete_env_vars_internal(payload.conflicts)
        .map_err(|e| ApiError::internal(format!("failed to delete env vars: {e}")))?;
    Ok(Json(backup))
}

async fn restore_env_conflicts(
    Json(payload): Json<BackupPathRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::restore_env_backup_internal(payload.backup_path)
        .map_err(|e| ApiError::internal(format!("failed to restore env backup: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_db_backup(State(state): State<WebApiState>) -> Result<Json<String>, ApiError> {
    crate::commands::create_db_backup_internal(state.app_state.db.clone())
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to create database backup: {e}")))
}

async fn list_db_backups() -> Result<Json<Vec<crate::database::backup::BackupEntry>>, ApiError> {
    let backups = crate::database::Database::list_backups()
        .map_err(|e| ApiError::internal(format!("failed to list database backups: {e}")))?;
    Ok(Json(backups))
}

async fn restore_db_backup(
    State(state): State<WebApiState>,
    Path(filename): Path<String>,
) -> Result<Json<String>, ApiError> {
    crate::commands::restore_db_backup_internal(state.app_state.db.clone(), filename)
        .await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("failed to restore database backup: {e}")))
}

async fn rename_db_backup(
    Json(payload): Json<RenameBackupRequest>,
) -> Result<Json<String>, ApiError> {
    let filename =
        crate::database::Database::rename_backup(&payload.old_filename, &payload.new_name)
            .map_err(|e| ApiError::internal(format!("failed to rename database backup: {e}")))?;
    Ok(Json(filename))
}

async fn delete_db_backup(Path(filename): Path<String>) -> Result<StatusCode, ApiError> {
    crate::database::Database::delete_backup(&filename)
        .map_err(|e| ApiError::internal(format!("failed to delete database backup: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_providers(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<ProvidersResponse>, ApiError> {
    let providers = crate::commands::get_providers_internal(state.app_state.as_ref(), app.clone())
        .map_err(|e| ApiError::internal(format!("failed to load providers: {e}")))?;
    let current_provider_id =
        crate::commands::get_current_provider_internal(state.app_state.as_ref(), app)
            .map_err(|e| ApiError::internal(format!("failed to load current provider: {e}")))?;

    Ok(Json(ProvidersResponse {
        providers,
        current_provider_id,
    }))
}

async fn get_current_provider(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<String>, ApiError> {
    let current_provider_id =
        crate::commands::get_current_provider_internal(state.app_state.as_ref(), app)
            .map_err(|e| ApiError::internal(format!("failed to load current provider: {e}")))?;

    Ok(Json(current_provider_id))
}

async fn get_config_dir(Path(app): Path<String>) -> Result<Json<String>, ApiError> {
    let dir = crate::commands::get_config_dir_internal(app)
        .map_err(|e| ApiError::internal(format!("failed to load config dir: {e}")))?;
    Ok(Json(dir))
}

async fn get_default_config_dir(Path(app): Path<String>) -> Result<Json<String>, ApiError> {
    let dir = crate::commands::get_default_config_dir_internal(app)
        .map_err(|e| ApiError::internal(format!("failed to load default config dir: {e}")))?;
    Ok(Json(dir))
}

async fn get_omo_local_file() -> Result<Json<OmoLocalFileData>, ApiError> {
    let data = crate::commands::read_omo_local_file_internal()
        .await
        .map_err(|e| ApiError::internal(format!("failed to read OMO local file: {e}")))?;
    Ok(Json(data))
}

async fn get_current_omo_provider_id(
    State(state): State<WebApiState>,
) -> Result<Json<String>, ApiError> {
    let provider_id =
        crate::commands::get_current_omo_provider_id_internal(state.app_state.as_ref())
            .await
            .map_err(|e| ApiError::internal(format!("failed to load current OMO provider: {e}")))?;
    Ok(Json(provider_id))
}

async fn disable_current_omo(State(state): State<WebApiState>) -> Result<StatusCode, ApiError> {
    crate::commands::disable_current_omo_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to disable OMO provider: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_omo_slim_local_file() -> Result<Json<OmoLocalFileData>, ApiError> {
    let data = crate::commands::read_omo_slim_local_file_internal()
        .await
        .map_err(|e| ApiError::internal(format!("failed to read OMO Slim local file: {e}")))?;
    Ok(Json(data))
}

async fn get_current_omo_slim_provider_id(
    State(state): State<WebApiState>,
) -> Result<Json<String>, ApiError> {
    let provider_id =
        crate::commands::get_current_omo_slim_provider_id_internal(state.app_state.as_ref())
            .await
            .map_err(|e| {
                ApiError::internal(format!("failed to load current OMO Slim provider: {e}"))
            })?;
    Ok(Json(provider_id))
}

async fn disable_current_omo_slim(
    State(state): State<WebApiState>,
) -> Result<StatusCode, ApiError> {
    crate::commands::disable_current_omo_slim_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to disable OMO Slim provider: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn add_provider(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<AddProviderRequest>,
) -> Result<Json<bool>, ApiError> {
    let added = crate::commands::add_provider_internal(
        state.app_state.as_ref(),
        app,
        payload.provider,
        payload.add_to_live,
    )
    .map_err(|e| ApiError::internal(format!("failed to add provider: {e}")))?;
    Ok(Json(added))
}

async fn update_provider(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(provider): Json<Provider>,
) -> Result<Json<bool>, ApiError> {
    let updated = crate::commands::update_provider_internal(
        state.app_state.as_ref(),
        app,
        Some(id),
        provider,
    )
    .map_err(|e| ApiError::internal(format!("failed to update provider: {e}")))?;
    Ok(Json(updated))
}

async fn delete_provider(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<bool>, ApiError> {
    let deleted = crate::commands::delete_provider_internal(state.app_state.as_ref(), app, id)
        .map_err(|e| ApiError::internal(format!("failed to delete provider: {e}")))?;
    Ok(Json(deleted))
}

async fn update_providers_sort_order(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(updates): Json<Vec<ProviderSortUpdate>>,
) -> Result<Json<bool>, ApiError> {
    let updated = crate::commands::update_providers_sort_order_internal(
        state.app_state.as_ref(),
        app,
        updates,
    )
    .map_err(|e| ApiError::internal(format!("failed to update provider sort order: {e}")))?;
    Ok(Json(updated))
}

async fn switch_provider(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<Json<SwitchResult>, ApiError> {
    let result =
        crate::commands::switch_provider_by_name_internal(state.app_state.as_ref(), app, id)
            .map_err(|e| ApiError::internal(format!("failed to switch provider: {e}")))?;
    Ok(Json(result))
}

async fn open_provider_terminal(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
    Json(payload): Json<OpenProviderTerminalRequest>,
) -> Result<Json<bool>, ApiError> {
    let opened = crate::commands::open_provider_terminal_internal(
        state.app_state.as_ref(),
        app,
        id,
        payload.cwd,
    )
    .map_err(|e| ApiError::internal(format!("failed to open provider terminal: {e}")))?;
    Ok(Json(opened))
}

async fn get_proxy_status(State(state): State<WebApiState>) -> Result<Json<ProxyStatus>, ApiError> {
    let status = crate::commands::get_proxy_status_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load proxy status: {e}")))?;
    Ok(Json(status))
}

async fn get_proxy_takeover_status(
    State(state): State<WebApiState>,
) -> Result<Json<ProxyTakeoverStatus>, ApiError> {
    let status = crate::commands::get_proxy_takeover_status_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load proxy takeover status: {e}")))?;
    Ok(Json(status))
}

async fn get_proxy_config(State(state): State<WebApiState>) -> Result<Json<ProxyConfig>, ApiError> {
    let config = crate::commands::get_proxy_config_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load proxy config: {e}")))?;
    Ok(Json(config))
}

async fn get_global_proxy_config(
    State(state): State<WebApiState>,
) -> Result<Json<GlobalProxyConfig>, ApiError> {
    let config = crate::commands::get_global_proxy_config_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load global proxy config: {e}")))?;
    Ok(Json(config))
}

async fn get_proxy_config_for_app(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<AppProxyConfig>, ApiError> {
    let config = crate::commands::get_proxy_config_for_app_internal(state.app_state.as_ref(), app)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load app proxy config: {e}")))?;
    Ok(Json(config))
}

async fn is_proxy_running(State(state): State<WebApiState>) -> Json<bool> {
    Json(
        crate::commands::is_proxy_running_internal(state.app_state.as_ref())
            .await
            .unwrap_or(false),
    )
}

async fn get_claude_desktop_status(
    State(state): State<WebApiState>,
) -> Result<Json<crate::claude_desktop_config::ClaudeDesktopStatus>, ApiError> {
    let status =
        crate::commands::get_claude_desktop_status_internal(state.app_state.as_ref())
            .await
            .map_err(|e| {
                ApiError::internal(format!("failed to load claude-desktop status: {e}"))
            })?;
    Ok(Json(status))
}

async fn get_claude_desktop_default_routes(
) -> Json<Vec<crate::claude_desktop_config::ClaudeDesktopDefaultRoute>> {
    Json(crate::commands::get_claude_desktop_default_routes_internal())
}

async fn is_live_takeover_active(State(state): State<WebApiState>) -> Result<Json<bool>, ApiError> {
    let active = crate::commands::is_live_takeover_active_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load proxy takeover state: {e}")))?;
    Ok(Json(active))
}

async fn start_proxy_server(
    State(state): State<WebApiState>,
) -> Result<Json<ProxyServerInfo>, ApiError> {
    let info = crate::commands::start_proxy_server_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to start proxy server: {e}")))?;
    Ok(Json(info))
}

async fn stop_proxy_with_restore(State(state): State<WebApiState>) -> Result<StatusCode, ApiError> {
    crate::commands::stop_proxy_with_restore_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to stop proxy server: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_proxy_config(
    State(state): State<WebApiState>,
    Json(config): Json<ProxyConfig>,
) -> Result<StatusCode, ApiError> {
    crate::commands::update_proxy_config_internal(state.app_state.as_ref(), config)
        .await
        .map_err(|e| ApiError::internal(format!("failed to update proxy config: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_global_proxy_config(
    State(state): State<WebApiState>,
    Json(config): Json<GlobalProxyConfig>,
) -> Result<StatusCode, ApiError> {
    crate::commands::update_global_proxy_config_internal(state.app_state.as_ref(), config)
        .await
        .map_err(|e| ApiError::internal(format!("failed to update global proxy config: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_global_proxy_url(
    State(state): State<WebApiState>,
) -> Result<Json<Option<String>>, ApiError> {
    let url = crate::commands::get_global_proxy_url_internal(state.app_state.as_ref())
        .map_err(|e| ApiError::internal(format!("failed to load global proxy url: {e}")))?;
    Ok(Json(url))
}

async fn set_global_proxy_url(
    State(state): State<WebApiState>,
    Json(payload): Json<ValueRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::set_global_proxy_url_internal(state.app_state.as_ref(), payload.value)
        .map_err(ApiError::bad_request)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn test_proxy_url(
    Json(payload): Json<ValueRequest>,
) -> Result<Json<crate::commands::ProxyTestResult>, ApiError> {
    let result = crate::commands::test_proxy_url_internal(payload.value)
        .await
        .map_err(ApiError::bad_request)?;
    Ok(Json(result))
}

async fn get_upstream_proxy_status() -> Json<crate::commands::UpstreamProxyStatus> {
    Json(crate::commands::get_upstream_proxy_status_internal())
}

async fn scan_local_proxies() -> Json<Vec<crate::commands::DetectedProxy>> {
    Json(crate::commands::scan_local_proxies_internal().await)
}

async fn update_proxy_config_for_app(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(mut config): Json<AppProxyConfig>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    config.app_type = app_type.as_str().to_string();
    crate::commands::update_proxy_config_for_app_internal(state.app_state.as_ref(), config)
        .await
        .map_err(|e| ApiError::internal(format!("failed to update app proxy config: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_proxy_takeover_for_app(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<EnabledRequest>,
) -> Result<StatusCode, ApiError> {
    crate::commands::set_proxy_takeover_for_app_internal(
        state.app_state.as_ref(),
        app,
        payload.enabled,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to update proxy takeover: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn switch_proxy_provider(
    State(state): State<WebApiState>,
    Path((app, id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    crate::commands::switch_proxy_provider_internal(state.app_state.as_ref(), app, id)
        .await
        .map_err(|e| ApiError::internal(format!("failed to switch proxy provider: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_default_cost_multiplier(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<String>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let value = crate::commands::get_default_cost_multiplier_internal(
        state.app_state.as_ref(),
        app_type.as_str(),
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to load default cost multiplier: {e}")))?;
    Ok(Json(value))
}

async fn set_default_cost_multiplier(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<ValueRequest>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    crate::commands::set_default_cost_multiplier_internal(
        state.app_state.as_ref(),
        app_type.as_str(),
        &payload.value,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to update default cost multiplier: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_pricing_model_source(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<String>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let value = crate::commands::get_pricing_model_source_internal(
        state.app_state.as_ref(),
        app_type.as_str(),
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to load pricing model source: {e}")))?;
    Ok(Json(value))
}

async fn set_pricing_model_source(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<ValueRequest>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    crate::commands::set_pricing_model_source_internal(
        state.app_state.as_ref(),
        app_type.as_str(),
        &payload.value,
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to update pricing model source: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_provider_health(
    State(state): State<WebApiState>,
    Path((app, provider_id)): Path<(String, String)>,
) -> Result<Json<ProviderHealth>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let value = crate::commands::get_provider_health_internal(
        state.app_state.as_ref(),
        provider_id,
        app_type.as_str().to_string(),
    )
    .await
    .map_err(|e| ApiError::internal(format!("failed to load provider health: {e}")))?;
    Ok(Json(value))
}

async fn reset_circuit_breaker(
    State(state): State<WebApiState>,
    Path((app, provider_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    crate::commands::reset_circuit_breaker_internal(state.app_state.as_ref(), provider_id, app)
        .await
        .map_err(|e| ApiError::internal(format!("failed to reset circuit breaker: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_circuit_breaker_config(
    State(state): State<WebApiState>,
) -> Result<Json<CircuitBreakerConfig>, ApiError> {
    let value = crate::commands::get_circuit_breaker_config_internal(state.app_state.as_ref())
        .await
        .map_err(|e| ApiError::internal(format!("failed to load circuit breaker config: {e}")))?;
    Ok(Json(value))
}

async fn update_circuit_breaker_config(
    State(state): State<WebApiState>,
    Json(config): Json<CircuitBreakerConfig>,
) -> Result<StatusCode, ApiError> {
    crate::commands::update_circuit_breaker_config_internal(state.app_state.as_ref(), config)
        .await
        .map_err(|e| {
            ApiError::internal(format!("failed to hot reload circuit breaker config: {e}"))
        })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn get_failover_queue(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<Vec<FailoverQueueItem>>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let queue = state
        .app_state
        .db
        .get_failover_queue(app_type.as_str())
        .map_err(|e| ApiError::internal(format!("failed to load failover queue: {e}")))?;
    Ok(Json(queue))
}

async fn get_available_providers_for_failover(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<Vec<Provider>>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let providers = state
        .app_state
        .db
        .get_available_providers_for_failover(app_type.as_str())
        .map_err(|e| {
            ApiError::internal(format!(
                "failed to load available providers for failover: {e}"
            ))
        })?;
    Ok(Json(providers))
}

async fn add_to_failover_queue(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<ProviderIdRequest>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    state
        .app_state
        .db
        .add_to_failover_queue(app_type.as_str(), &payload.provider_id)
        .map_err(|e| {
            ApiError::internal(format!("failed to add provider to failover queue: {e}"))
        })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_from_failover_queue(
    State(state): State<WebApiState>,
    Path((app, provider_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    state
        .app_state
        .db
        .remove_from_failover_queue(app_type.as_str(), &provider_id)
        .map_err(|e| {
            ApiError::internal(format!(
                "failed to remove provider from failover queue: {e}"
            ))
        })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_auto_failover_enabled(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let enabled = state
        .app_state
        .db
        .get_proxy_config_for_app(app_type.as_str())
        .await
        .map(|config| config.auto_failover_enabled)
        .map_err(|e| ApiError::internal(format!("failed to load auto failover status: {e}")))?;
    Ok(Json(enabled))
}

async fn set_auto_failover_enabled(
    State(state): State<WebApiState>,
    Path(app): Path<String>,
    Json(payload): Json<EnabledRequest>,
) -> Result<StatusCode, ApiError> {
    let app_type = AppType::from_str(&app).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let app_type_str = app_type.as_str();

    let p1_provider_id = if payload.enabled {
        let mut queue = state
            .app_state
            .db
            .get_failover_queue(app_type_str)
            .map_err(|e| ApiError::internal(format!("failed to load failover queue: {e}")))?;

        if queue.is_empty() {
            let current_id = crate::settings::get_effective_current_provider(
                state.app_state.db.as_ref(),
                &app_type,
            )
            .map_err(|e| {
                ApiError::internal(format!("failed to get current provider for failover: {e}"))
            })?;

            let Some(current_id) = current_id else {
                return Err(ApiError::bad_request(
                    "故障转移队列为空，且未设置当前供应商，无法开启故障转移",
                ));
            };

            state
                .app_state
                .db
                .add_to_failover_queue(app_type_str, &current_id)
                .map_err(|e| {
                    ApiError::internal(format!(
                        "failed to add current provider into failover queue: {e}"
                    ))
                })?;

            queue = state
                .app_state
                .db
                .get_failover_queue(app_type_str)
                .map_err(|e| ApiError::internal(format!("failed to reload failover queue: {e}")))?;
        }

        Some(
            queue
                .first()
                .map(|item| item.provider_id.clone())
                .ok_or_else(|| ApiError::bad_request("故障转移队列为空，无法开启故障转移"))?,
        )
    } else {
        None
    };

    let mut config = state
        .app_state
        .db
        .get_proxy_config_for_app(app_type_str)
        .await
        .map_err(|e| ApiError::internal(format!("failed to load app proxy config: {e}")))?;
    config.auto_failover_enabled = payload.enabled;
    state
        .app_state
        .db
        .update_proxy_config_for_app(config)
        .await
        .map_err(|e| ApiError::internal(format!("failed to update auto failover config: {e}")))?;

    if let Some(provider_id) = p1_provider_id {
        state
            .app_state
            .proxy_service
            .switch_proxy_target(app_type_str, &provider_id)
            .await
            .map_err(|e| {
                ApiError::internal(format!("failed to switch proxy target for failover: {e}"))
            })?;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Clone)]
struct ResolvedBindOptions {
    ip: IpAddr,
    preferred_port: u16,
    port_scan_count: usize,
}

fn resolve_bind_options(options: &WebServerOptions) -> Result<ResolvedBindOptions, String> {
    let host = options.host.trim();
    if host.is_empty() {
        return Err("bind host cannot be empty".to_string());
    }

    let ip = if host.eq_ignore_ascii_case("localhost") {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    } else {
        host.parse::<IpAddr>()
            .map_err(|e| format!("invalid bind host '{host}': {e}"))?
    };

    Ok(ResolvedBindOptions {
        ip,
        preferred_port: options.preferred_port,
        port_scan_count: options.port_scan_count.max(1),
    })
}

async fn bind_listener(
    options: &ResolvedBindOptions,
) -> Result<(tokio::net::TcpListener, SocketAddr), String> {
    let max_port = u16::MAX as usize;
    let available_slots = max_port.saturating_sub(options.preferred_port as usize) + 1;
    let attempt_count = options.port_scan_count.max(1).min(available_slots);
    let mut last_error = None;
    let mut last_addr = None;

    for offset in 0..attempt_count {
        let port = options.preferred_port + offset as u16;
        let addr = SocketAddr::new(options.ip, port);
        last_addr = Some(addr);

        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => return Ok((listener, addr)),
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
    }

    let end_port = options.preferred_port + (attempt_count.saturating_sub(1)) as u16;
    let last_addr =
        last_addr.unwrap_or_else(|| SocketAddr::new(options.ip, options.preferred_port));
    let last_error = last_error.unwrap_or_else(|| "unknown bind error".to_string());

    Err(format!(
        "bind failed for {}:{}-{} after {attempt_count} attempts; last error on {last_addr}: {last_error}",
        options.ip, options.preferred_port, end_port
    ))
}

fn resolve_frontend_dist_dir() -> Option<PathBuf> {
    let static_disabled = std::env::var("CC_SWITCH_WEB_DISABLE_STATIC")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false);

    if static_disabled {
        return None;
    }

    let configured = std::env::var("CC_SWITCH_WEB_DIST_DIR")
        .ok()
        .map(PathBuf::from);

    let dist_dir = configured.unwrap_or_else(|| PathBuf::from("dist"));

    if dist_dir.exists() {
        Some(dist_dir)
    } else {
        None
    }
}

fn has_embedded_frontend_dist() -> bool {
    env!("CC_SWITCH_WEB_HAS_EMBEDDED_DIST") == "1"
        && EMBEDDED_FRONTEND_DIST.get_file("index.html").is_some()
}

fn normalize_frontend_path(path: &str) -> Option<String> {
    let trimmed = path.trim_start_matches('/').trim();
    if trimmed.is_empty() {
        return Some("index.html".to_string());
    }

    let segments = trimmed
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments
        .iter()
        .any(|segment| *segment == "." || *segment == "..")
    {
        return None;
    }

    Some(segments.join("/"))
}

fn embedded_frontend_candidates(path: &str) -> Option<Vec<String>> {
    let normalized = normalize_frontend_path(path)?;
    let mut candidates = vec![normalized.clone()];

    if !normalized.contains('.') && normalized != "index.html" {
        candidates.push(format!("{normalized}/index.html"));
    }

    if normalized != "index.html" {
        candidates.push("index.html".to_string());
    }

    Some(candidates)
}

fn build_embedded_file_response(path: &str, contents: &'static [u8]) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(contents));
    *response.status_mut() = StatusCode::OK;

    if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }

    if path.ends_with(".html") {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }

    response
}

fn embedded_frontend_response(path: &str) -> Option<Response> {
    if !has_embedded_frontend_dist() {
        return None;
    }

    let candidates = embedded_frontend_candidates(path)?;

    for candidate in candidates {
        if let Some(file) = EMBEDDED_FRONTEND_DIST.get_file(&candidate) {
            return Some(build_embedded_file_response(&candidate, file.contents()));
        }
    }

    None
}

async fn serve_embedded_frontend(uri: Uri) -> Response {
    embedded_frontend_response(uri.path()).unwrap_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "frontend asset not found".to_string(),
            }),
        )
            .into_response()
    })
}

pub async fn run_web_server() -> Result<(), String> {
    run_web_server_with_options(WebServerOptions::from_env()).await
}

pub async fn run_web_server_with_options(options: WebServerOptions) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| format!("database init failed: {e}"))?);
    match db.init_default_skill_repos() {
        Ok(count) if count > 0 => {
            log::info!("startup initialized {count} default skill repositories");
        }
        Ok(_) => {}
        Err(err) => {
            log::warn!("startup default skill repository init failed: {err}");
        }
    }
    if let Err(err) = db.periodic_backup_if_needed() {
        log::warn!("startup periodic maintenance failed: {err}");
    }
    let app_state = Arc::new(AppState::new(db));
    crate::services::webdav_auto_sync::start_worker(app_state.db.clone());
    let state = WebApiState {
        copilot_auth_state: app_state.copilot_auth_state.clone(),
        codex_oauth_state: app_state.codex_oauth_state.clone(),
        app_state,
    };
    let bind_options = resolve_bind_options(&options)?;

    let mut app = Router::new()
        .route("/api", get(root))
        .route("/api/health", get(health))
        .route("/api/config/export", get(export_config_download))
        .route("/api/config/import", post(import_config_upload))
        .route("/api/settings", get(get_settings).put(save_settings))
        .route(
            "/api/settings/auto-launch",
            get(get_auto_launch_status).put(set_auto_launch),
        )
        .route(
            "/api/settings/claude-plugin",
            post(apply_claude_plugin_config),
        )
        .route(
            "/api/settings/claude-onboarding-skip",
            post(apply_claude_onboarding_skip).delete(clear_claude_onboarding_skip),
        )
        .route("/api/settings/app-config-dir", get(get_app_config_dir))
        .route(
            "/api/settings/default-app-config-dir",
            get(get_default_app_config_dir),
        )
        .route(
            "/api/settings/app-config-dir-override",
            get(get_app_config_dir_override).put(set_app_config_dir_override),
        )
        .route(
            "/api/settings/default-config-dir/:app",
            get(get_default_config_dir),
        )
        .route(
            "/api/settings/common-config/:app",
            get(get_common_config_snippet).put(set_common_config_snippet),
        )
        .route(
            "/api/settings/common-config/:app/extract",
            post(extract_common_config_snippet),
        )
        .route(
            "/api/settings/sync-current-providers-live",
            post(sync_current_providers_live),
        )
        .route("/api/webdav/test", post(webdav_test_connection))
        .route("/api/webdav/upload", post(webdav_sync_upload))
        .route("/api/webdav/download", post(webdav_sync_download))
        .route("/api/webdav/settings", post(webdav_sync_save_settings))
        .route(
            "/api/webdav/remote-info",
            get(webdav_sync_fetch_remote_info),
        )
        .route(
            "/api/settings/rectifier",
            get(get_rectifier_config).put(set_rectifier_config),
        )
        .route(
            "/api/settings/optimizer",
            get(get_optimizer_config).put(set_optimizer_config),
        )
        .route(
            "/api/settings/log-config",
            get(get_log_config).put(set_log_config),
        )
        .route(
            "/api/settings/stream-check-config",
            get(get_stream_check_config).put(set_stream_check_config),
        )
        .route("/api/settings/tool-versions", post(get_tool_versions))
        .route("/api/settings/windows-env-paths", get(get_windows_env_paths))
        .route("/api/settings/latest-release", get(get_latest_release))
        .route("/api/settings/config-dir/:app", get(get_config_dir))
        .route("/api/omo/local-file", get(get_omo_local_file))
        .route(
            "/api/omo/current-provider-id",
            get(get_current_omo_provider_id),
        )
        .route("/api/omo/disable", post(disable_current_omo))
        .route("/api/omo-slim/local-file", get(get_omo_slim_local_file))
        .route(
            "/api/omo-slim/current-provider-id",
            get(get_current_omo_slim_provider_id),
        )
        .route("/api/omo-slim/disable", post(disable_current_omo_slim))
        .route("/api/auth/start-login", post(auth_start_login))
        .route("/api/auth/poll-for-account", post(auth_poll_for_account))
        .route("/api/auth/:auth_provider/accounts", get(auth_list_accounts))
        .route("/api/auth/:auth_provider/status", get(auth_get_status))
        .route("/api/auth/remove-account", post(auth_remove_account))
        .route(
            "/api/auth/set-default-account",
            post(auth_set_default_account),
        )
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/copilot/token", get(get_copilot_token))
        .route(
            "/api/copilot/accounts/:account_id/token",
            get(get_copilot_token_for_account),
        )
        .route("/api/copilot/models", get(get_copilot_models))
        .route(
            "/api/copilot/accounts/:account_id/models",
            get(get_copilot_models_for_account),
        )
        .route("/api/copilot/usage", get(get_copilot_usage))
        .route(
            "/api/copilot/accounts/:account_id/usage",
            get(get_copilot_usage_for_account),
        )
        .route("/api/subscription/codex-oauth", get(get_codex_oauth_quota))
        .route("/api/subscription/coding-plan", post(get_coding_plan_quota))
        .route("/api/subscription/balance", post(get_balance))
        .route("/api/subscription/:tool", get(get_subscription_quota))
        .route("/api/env/conflicts/:app", get(get_env_conflicts))
        .route("/api/env/delete", post(delete_env_conflicts))
        .route("/api/env/restore", post(restore_env_conflicts))
        .route(
            "/api/backups/db",
            get(list_db_backups).post(create_db_backup),
        )
        .route("/api/backups/db/rename", put(rename_db_backup))
        .route(
            "/api/backups/db/:filename",
            axum::routing::delete(delete_db_backup),
        )
        .route("/api/backups/db/:filename/restore", post(restore_db_backup))
        .route("/api/providers/:app", get(get_providers).post(add_provider))
        .route(
            "/api/providers/:app/sort-order",
            put(update_providers_sort_order),
        )
        .route("/api/providers/:app/current", get(get_current_provider))
        .route(
            "/api/providers/:app/import-default",
            post(import_default_provider_config),
        )
        .route(
            "/api/providers/:app/stream-check/:id",
            post(stream_check_provider),
        )
        .route(
            "/api/providers/:app/stream-check-all",
            post(stream_check_all_providers),
        )
        .route(
            "/api/providers/:app/live-settings",
            get(read_live_provider_settings),
        )
        .route("/api/providers/:app/:id/usage", get(query_provider_usage))
        .route(
            "/api/providers/:app/:id/usage/test",
            post(test_usage_script),
        )
        .route("/api/providers/models/fetch", post(fetch_provider_models))
        .route("/api/providers/endpoints/test", post(test_api_endpoints))
        .route(
            "/api/providers/:app/:id/custom-endpoints",
            get(get_custom_endpoints)
                .post(add_custom_endpoint)
                .delete(remove_custom_endpoint),
        )
        .route(
            "/api/providers/:app/:id/custom-endpoints/last-used",
            post(update_endpoint_last_used),
        )
        .route(
            "/api/providers/:app/live-provider-ids",
            get(get_live_provider_ids),
        )
        .route(
            "/api/providers/:app/import-live",
            post(import_providers_from_live),
        )
        .route(
            "/api/providers/:app/live-config/:id",
            axum::routing::delete(remove_provider_from_live_config),
        )
        .route(
            "/api/universal-providers",
            get(get_universal_providers).post(upsert_universal_provider),
        )
        .route(
            "/api/universal-providers/:id",
            get(get_universal_provider).delete(delete_universal_provider),
        )
        .route(
            "/api/universal-providers/:id/sync",
            post(sync_universal_provider),
        )
        .route("/api/skills/installed", get(get_installed_skills))
        .route("/api/skills/backups", get(get_skill_backups))
        .route("/api/skills/unmanaged", get(scan_unmanaged_skills))
        .route("/api/skills/import", post(import_skills_from_apps))
        .route(
            "/api/skills/repos",
            get(get_skill_repos).post(add_skill_repo),
        )
        .route(
            "/api/skills/repos/:owner/:name",
            axum::routing::delete(remove_skill_repo),
        )
        .route("/api/skills/discover", get(discover_available_skills))
        .route("/api/skills/updates", get(check_skill_updates))
        .route("/api/skills/install", post(install_skill_unified))
        .route("/api/skills/install-archives", post(install_skill_archives))
        .route("/api/skills/skillssh/search", get(search_skills_sh))
        .route("/api/skills/update", post(update_skill))
        .route("/api/skills/storage/migrate", post(migrate_skill_storage))
        .route(
            "/api/skills/uninstall",
            post(uninstall_skill_unified_by_body),
        )
        .route("/api/skills/apps/toggle", put(toggle_skill_app_by_body))
        .route(
            "/api/skills/backups/:backup_id",
            post(restore_skill_backup).delete(delete_skill_backup),
        )
        .route(
            "/api/skills/:id",
            axum::routing::delete(uninstall_skill_unified),
        )
        .route("/api/skills/:id/apps/:app", put(toggle_skill_app))
        .route(
            "/api/workspace/files/:filename",
            get(get_workspace_file).put(save_workspace_file),
        )
        .route(
            "/api/workspace/daily-memory",
            get(list_workspace_daily_memory_files),
        )
        .route(
            "/api/workspace/daily-memory/search",
            get(search_workspace_daily_memory_files),
        )
        .route(
            "/api/workspace/daily-memory/:filename",
            get(get_workspace_daily_memory_file)
                .put(save_workspace_daily_memory_file)
                .delete(delete_workspace_daily_memory_file),
        )
        .route(
            "/api/workspace/directories/:subdir/path",
            get(get_workspace_directory_path),
        )
        .route(
            "/api/openclaw/default-model",
            get(get_openclaw_default_model).put(set_openclaw_default_model),
        )
        .route(
            "/api/openclaw/model-catalog",
            get(get_openclaw_model_catalog).put(set_openclaw_model_catalog),
        )
        .route(
            "/api/openclaw/agents-defaults",
            get(get_openclaw_agents_defaults).put(set_openclaw_agents_defaults),
        )
        .route(
            "/api/openclaw/env",
            get(get_openclaw_env).put(set_openclaw_env),
        )
        .route(
            "/api/openclaw/tools",
            get(get_openclaw_tools).put(set_openclaw_tools),
        )
        .route("/api/openclaw/health", get(scan_openclaw_config_health))
        .route(
            "/api/openclaw/live-provider/:provider_id",
            get(get_openclaw_live_provider),
        )
        .route(
            "/api/hermes/memory/:kind",
            get(get_hermes_memory).put(set_hermes_memory),
        )
        .route("/api/hermes/model", get(get_hermes_model_config))
        .route("/api/hermes/live-provider-ids", get(get_hermes_live_provider_ids))
        .route("/api/hermes/web-ui-url", get(get_hermes_web_ui_url))
        .route("/api/hermes/dashboard", post(launch_hermes_dashboard))
        .route("/api/hermes/health", get(scan_hermes_config_health))
        .route("/api/hermes/memory-limits", get(get_hermes_memory_limits))
        .route(
            "/api/hermes/memory/:kind/enabled",
            put(set_hermes_memory_enabled),
        )
        .route("/api/sessions", get(list_sessions).delete(delete_session))
        .route("/api/sessions/messages", get(get_session_messages))
        .route("/api/sessions/launch-terminal", post(launch_session_terminal))
        .route("/api/sessions/delete-batch", post(delete_sessions))
        .route("/api/usage/summary", get(get_usage_summary))
        .route("/api/usage/trends", get(get_usage_trends))
        .route("/api/usage/provider-stats", get(get_usage_provider_stats))
        .route("/api/usage/model-stats", get(get_usage_model_stats))
        .route("/api/usage/session-sync", post(sync_usage_session_logs))
        .route("/api/usage/data-sources", get(get_usage_data_sources))
        .route("/api/usage/request-logs", post(get_usage_request_logs))
        .route(
            "/api/usage/request-logs/:request_id",
            get(get_usage_request_detail),
        )
        .route("/api/usage/model-pricing", get(get_usage_model_pricing))
        .route(
            "/api/usage/model-pricing/:model_id",
            put(update_usage_model_pricing).delete(delete_usage_model_pricing),
        )
        .route(
            "/api/usage/provider-limits/:app_type/:provider_id",
            get(get_usage_provider_limits),
        )
        .route("/api/prompts/:app", get(get_prompts))
        .route("/api/prompts/:app/import", post(import_prompt_from_file))
        .route(
            "/api/prompts/:app/current-file",
            get(get_current_prompt_file_content),
        )
        .route(
            "/api/prompts/:app/:id",
            put(upsert_prompt).delete(delete_prompt),
        )
        .route("/api/prompts/:app/:id/enable", post(enable_prompt))
        .route(
            "/api/mcp/servers",
            get(get_mcp_servers).post(upsert_mcp_server),
        )
        .route("/api/mcp/servers/import", post(import_mcp_from_apps))
        .route(
            "/api/mcp/servers/:id",
            axum::routing::delete(delete_mcp_server),
        )
        .route("/api/mcp/servers/:id/apps/:app", put(toggle_mcp_app))
        .route(
            "/api/providers/:app/:id",
            put(update_provider).delete(delete_provider),
        )
        .route("/api/providers/:app/:id/switch", post(switch_provider))
        .route(
            "/api/providers/:app/:id/open-terminal",
            post(open_provider_terminal),
        )
        .route("/api/proxy/status", get(get_proxy_status))
        .route("/api/proxy/takeover-status", get(get_proxy_takeover_status))
        .route(
            "/api/proxy/config",
            get(get_proxy_config).put(update_proxy_config),
        )
        .route(
            "/api/proxy/global-config",
            get(get_global_proxy_config).put(update_global_proxy_config),
        )
        .route(
            "/api/proxy/global-url",
            get(get_global_proxy_url).put(set_global_proxy_url),
        )
        .route("/api/proxy/test", post(test_proxy_url))
        .route("/api/proxy/upstream-status", get(get_upstream_proxy_status))
        .route("/api/proxy/scan-local", get(scan_local_proxies))
        .route(
            "/api/proxy/apps/:app/config",
            get(get_proxy_config_for_app).put(update_proxy_config_for_app),
        )
        .route("/api/proxy/running", get(is_proxy_running))
        .route(
            "/api/claude-desktop/status",
            get(get_claude_desktop_status),
        )
        .route(
            "/api/claude-desktop/default-routes",
            get(get_claude_desktop_default_routes),
        )
        .route(
            "/api/proxy/live-takeover-active",
            get(is_live_takeover_active),
        )
        .route("/api/proxy/start", post(start_proxy_server))
        .route(
            "/api/proxy/stop-with-restore",
            post(stop_proxy_with_restore),
        )
        .route(
            "/api/proxy/apps/:app/takeover",
            put(set_proxy_takeover_for_app),
        )
        .route(
            "/api/proxy/apps/:app/providers/:id/switch",
            post(switch_proxy_provider),
        )
        .route(
            "/api/proxy/apps/:app/default-cost-multiplier",
            get(get_default_cost_multiplier).put(set_default_cost_multiplier),
        )
        .route(
            "/api/proxy/apps/:app/pricing-model-source",
            get(get_pricing_model_source).put(set_pricing_model_source),
        )
        .route(
            "/api/failover/apps/:app/queue",
            get(get_failover_queue).post(add_to_failover_queue),
        )
        .route(
            "/api/failover/apps/:app/queue/:provider_id",
            axum::routing::delete(remove_from_failover_queue),
        )
        .route(
            "/api/failover/apps/:app/available-providers",
            get(get_available_providers_for_failover),
        )
        .route(
            "/api/failover/apps/:app/auto-enabled",
            get(get_auto_failover_enabled).put(set_auto_failover_enabled),
        )
        .route(
            "/api/failover/apps/:app/providers/:provider_id/health",
            get(get_provider_health),
        )
        .route(
            "/api/failover/apps/:app/providers/:provider_id/reset-circuit-breaker",
            post(reset_circuit_breaker),
        )
        .route(
            "/api/failover/circuit-breaker-config",
            get(get_circuit_breaker_config).put(update_circuit_breaker_config),
        )
        .layer(middleware::from_fn(api_request_logger))
        .layer(DefaultBodyLimit::max(128 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state);

    if let Some(dist_dir) = resolve_frontend_dist_dir() {
        println!(
            "cc-switch web service will serve static assets from {}",
            dist_dir.display()
        );
        app = app.fallback_service(get_service(
            ServeDir::new(dist_dir).append_index_html_on_directories(true),
        ));
    } else if has_embedded_frontend_dist() {
        println!("cc-switch web service will serve embedded frontend static assets");
        app = app.fallback(serve_embedded_frontend);
    } else {
        println!("cc-switch web service running without frontend static assets");
        app = app.route("/", get(root));
    }

    let (listener, bind_addr) = bind_listener(&bind_options).await?;
    if bind_addr.port() != bind_options.preferred_port {
        println!(
            "preferred cc-switch web port {} unavailable, switched to {}",
            bind_options.preferred_port,
            bind_addr.port()
        );
    }
    println!("cc-switch web service listening on http://{bind_addr}");

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("server error: {e}"))
}
