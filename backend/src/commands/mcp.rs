#![allow(non_snake_case)]

use indexmap::IndexMap;
use crate::app_config::AppType;
use crate::services::mcp::McpService;
use crate::store::AppState;
use std::str::FromStr;

// ============================================================================
// v3.7.0 新增：统一 MCP 管理命令
// ============================================================================

use crate::app_config::McpServer;

pub(crate) async fn get_mcp_servers_internal(
    state: &AppState,
) -> Result<IndexMap<String, McpServer>, String> {
    McpService::get_all_servers(state).map_err(|e| e.to_string())
}

/// 添加或更新 MCP 服务器
pub(crate) async fn upsert_mcp_server_internal(
    state: &AppState,
    server: McpServer,
) -> Result<(), String> {
    McpService::upsert_server(state, server).map_err(|e| e.to_string())
}

/// 删除 MCP 服务器
pub(crate) async fn delete_mcp_server_internal(
    state: &AppState,
    id: String,
) -> Result<bool, String> {
    McpService::delete_server(state, &id).map_err(|e| e.to_string())
}

/// 切换 MCP 服务器在指定应用的启用状态
pub(crate) async fn toggle_mcp_app_internal(
    state: &AppState,
    server_id: String,
    app: String,
    enabled: bool,
) -> Result<(), String> {
    let app_ty = AppType::from_str(&app).map_err(|e| e.to_string())?;
    McpService::toggle_app(state, &server_id, app_ty, enabled).map_err(|e| e.to_string())
}

/// 从所有应用导入 MCP 服务器（复用已有的导入逻辑）
pub(crate) async fn import_mcp_from_apps_internal(state: &AppState) -> Result<usize, String> {
    McpService::import_from_all_apps(state).map_err(|error| error.to_string())
}
