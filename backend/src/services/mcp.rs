use indexmap::IndexMap;

use crate::app_config::{AppType, McpServer};
use crate::error::AppError;
use crate::mcp;
use crate::mcp::ImportedMcpServers;
use crate::store::AppState;

/// MCP 相关业务逻辑（v3.7.0 统一结构）
pub struct McpService;

impl McpService {
    /// 获取所有 MCP 服务器（统一结构）
    pub fn get_all_servers(state: &AppState) -> Result<IndexMap<String, McpServer>, AppError> {
        state.db.get_all_mcp_servers()
    }

    /// 添加或更新 MCP 服务器
    pub fn upsert_server(state: &AppState, server: McpServer) -> Result<(), AppError> {
        // 读取旧状态：用于处理“编辑时取消勾选某个应用”的场景（需要从对应 live 配置中移除）
        let prev_apps = state
            .db
            .get_all_mcp_servers()?
            .get(&server.id)
            .map(|s| s.apps.clone())
            .unwrap_or_default();

        state.db.save_mcp_server(&server)?;

        // 处理禁用：若旧版本启用但新版本取消，则需要从该应用的 live 配置移除
        if prev_apps.claude && !server.apps.claude {
            Self::remove_server_from_app(state, &server.id, &AppType::Claude)?;
        }
        if prev_apps.codex && !server.apps.codex {
            Self::remove_server_from_app(state, &server.id, &AppType::Codex)?;
        }
        if prev_apps.gemini && !server.apps.gemini {
            Self::remove_server_from_app(state, &server.id, &AppType::Gemini)?;
        }
        if prev_apps.grokbuild && !server.apps.grokbuild {
            Self::remove_server_from_app(state, &server.id, &AppType::GrokBuild)?;
        }
        if prev_apps.opencode && !server.apps.opencode {
            Self::remove_server_from_app(state, &server.id, &AppType::OpenCode)?;
        }

        // 同步到各个启用的应用
        Self::sync_server_to_apps(state, &server)?;

        Ok(())
    }

    /// 删除 MCP 服务器
    pub fn delete_server(state: &AppState, id: &str) -> Result<bool, AppError> {
        let server = state.db.get_all_mcp_servers()?.shift_remove(id);

        if let Some(server) = server {
            state.db.delete_mcp_server(id)?;

            // 从所有应用的 live 配置中移除
            Self::remove_server_from_all_apps(state, id, &server)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// 切换指定应用的启用状态
    pub fn toggle_app(
        state: &AppState,
        server_id: &str,
        app: AppType,
        enabled: bool,
    ) -> Result<(), AppError> {
        if let Some(server) = state
            .db
            .update_mcp_server_app_enabled(server_id, &app, enabled)?
        {
            // 同步到对应应用
            if enabled {
                Self::sync_server_to_app(state, &server, &app)?;
            } else {
                Self::remove_server_from_app(state, server_id, &app)?;
            }
        }

        Ok(())
    }

    /// 将 MCP 服务器同步到所有启用的应用
    fn sync_server_to_apps(_state: &AppState, server: &McpServer) -> Result<(), AppError> {
        for app in server.apps.enabled_apps() {
            Self::sync_server_to_app_no_config(server, &app)?;
        }

        Ok(())
    }

    /// 将 MCP 服务器同步到指定应用
    fn sync_server_to_app(
        _state: &AppState,
        server: &McpServer,
        app: &AppType,
    ) -> Result<(), AppError> {
        Self::sync_server_to_app_no_config(server, app)
    }

    fn sync_server_to_app_no_config(server: &McpServer, app: &AppType) -> Result<(), AppError> {
        match app {
            AppType::Claude => {
                mcp::sync_single_server_to_claude(&server.id, &server.server)?;
            }
            AppType::Codex => {
                // Codex uses TOML format, must use the correct function
                mcp::sync_single_server_to_codex(&server.id, &server.server)?;
            }
            AppType::Gemini => {
                mcp::sync_single_server_to_gemini(&server.id, &server.server)?;
            }
            AppType::GrokBuild => {
                mcp::sync_single_server_to_grokbuild(&server.id, &server.server)?;
            }
            AppType::OpenCode => {
                mcp::sync_single_server_to_opencode(&server.id, &server.server)?;
            }
            AppType::OpenClaw => {
                // OpenClaw MCP support is still in development (Issue #4834)
                // Skip for now
                log::debug!("OpenClaw MCP support is still in development, skipping sync");
            }
            AppType::Hermes => {
                log::debug!("Hermes MCP sync is not available in the Web backend yet, skipping");
            }
            AppType::Pi => {}
            AppType::ClaudeDesktop => {
                // C-Phase0：claude-desktop 运行时尚未实现，跳过 MCP 同步
                log::debug!("claude-desktop MCP 尚未实现（C-Phase0），跳过同步");
            }
        }
        Ok(())
    }

    /// 从所有曾启用过该服务器的应用中移除
    fn remove_server_from_all_apps(
        state: &AppState,
        id: &str,
        server: &McpServer,
    ) -> Result<(), AppError> {
        // 从所有曾启用的应用中移除
        for app in server.apps.enabled_apps() {
            Self::remove_server_from_app(state, id, &app)?;
        }
        Ok(())
    }

    fn remove_server_from_app(_state: &AppState, id: &str, app: &AppType) -> Result<(), AppError> {
        match app {
            AppType::Claude => mcp::remove_server_from_claude(id)?,
            AppType::Codex => mcp::remove_server_from_codex(id)?,
            AppType::Gemini => mcp::remove_server_from_gemini(id)?,
            AppType::GrokBuild => {
                mcp::remove_server_from_grokbuild(id)?;
            }
            AppType::OpenCode => {
                mcp::remove_server_from_opencode(id)?;
            }
            AppType::OpenClaw => {
                // OpenClaw MCP support is still in development
                log::debug!("OpenClaw MCP support is still in development, skipping remove");
            }
            AppType::Hermes => {
                log::debug!("Hermes MCP removal is not available in the Web backend yet, skipping");
            }
            AppType::Pi => {}
            AppType::ClaudeDesktop => {
                // C-Phase0：claude-desktop 运行时尚未实现，跳过 MCP 移除
                log::debug!("claude-desktop MCP 尚未实现（C-Phase0），跳过移除");
            }
        }
        Ok(())
    }

    /// 逐应用 best-effort 同步所有启用状态，结束后聚合上报失败。
    pub fn sync_all_enabled(state: &AppState) -> Result<(), AppError> {
        let servers = Self::get_all_servers(state)?;
        let mut failures = Vec::new();

        for app in AppType::all() {
            if let Err(error) = Self::project_servers_to_app(state, &servers, &app) {
                log::warn!("同步 MCP 到 {app:?} 失败: {error}");
                failures.push(format!("{}: {error}", app.as_str()));
            }
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::Message(format!(
                "部分应用 MCP 同步失败: {}",
                failures.join("; ")
            )))
        }
    }

    /// 只重投影目标应用，避免无关应用配置损坏牵连关键路径。
    pub fn sync_enabled_for_app(state: &AppState, app: &AppType) -> Result<(), AppError> {
        let servers = Self::get_all_servers(state)?;
        Self::project_servers_to_app(state, &servers, app)
    }

    fn project_servers_to_app(
        state: &AppState,
        servers: &IndexMap<String, McpServer>,
        app: &AppType,
    ) -> Result<(), AppError> {
        if matches!(
            app,
            AppType::OpenClaw | AppType::Hermes | AppType::ClaudeDesktop | AppType::Pi
        ) {
            return Ok(());
        }

        for server in servers.values() {
            if server.apps.is_enabled_for(app) {
                Self::sync_server_to_app(state, server, app)?;
            } else {
                Self::remove_server_from_app(state, &server.id, app)?;
            }
        }

        Ok(())
    }

    fn persist_imported_servers(
        state: &AppState,
        imported: ImportedMcpServers,
        app: AppType,
    ) -> Result<usize, AppError> {
        if imported.is_empty() {
            return Ok(0);
        }

        let mut new_count = 0;
        let mut existing = state.db.get_all_mcp_servers()?;

        for server in imported.into_values() {
            let to_save = if let Some(existing_server) = existing.get(&server.id) {
                let mut merged = existing_server.clone();
                merged.apps.set_enabled_for(&app, true);
                merged
            } else {
                new_count += 1;
                server
            };

            state.db.save_mcp_server(&to_save)?;
            existing.insert(to_save.id.clone(), to_save.clone());
            // 导入是读取已有配置，不应反向写回任何应用的 live 配置。
            // 显式编辑、启用/禁用或手动同步时再执行写回。
        }

        Ok(new_count)
    }

    /// 从 Claude 导入 MCP（v3.7.0 已更新为统一结构）
    pub fn import_from_claude(state: &AppState) -> Result<usize, AppError> {
        let mut imported = ImportedMcpServers::new();
        crate::mcp::import_from_claude(&mut imported)?;
        Self::persist_imported_servers(state, imported, AppType::Claude)
    }

    /// 从 Codex 导入 MCP（v3.7.0 已更新为统一结构）
    pub fn import_from_codex(state: &AppState) -> Result<usize, AppError> {
        let mut imported = ImportedMcpServers::new();
        crate::mcp::import_from_codex(&mut imported)?;
        Self::persist_imported_servers(state, imported, AppType::Codex)
    }

    /// 从 Gemini 导入 MCP（v3.7.0 已更新为统一结构）
    pub fn import_from_gemini(state: &AppState) -> Result<usize, AppError> {
        let mut imported = ImportedMcpServers::new();
        crate::mcp::import_from_gemini(&mut imported)?;
        Self::persist_imported_servers(state, imported, AppType::Gemini)
    }

    /// 从 Grok Build 的 `[mcp_servers]` 导入 MCP。
    pub fn import_from_grokbuild(state: &AppState) -> Result<usize, AppError> {
        let mut imported = ImportedMcpServers::new();
        crate::mcp::import_from_grokbuild(&mut imported)?;
        Self::persist_imported_servers(state, imported, AppType::GrokBuild)
    }

    /// 从 OpenCode 导入 MCP（v3.9.2+ 新增）
    pub fn import_from_opencode(state: &AppState) -> Result<usize, AppError> {
        let mut imported = ImportedMcpServers::new();
        crate::mcp::import_from_opencode(&mut imported)?;
        Self::persist_imported_servers(state, imported, AppType::OpenCode)
    }

    /// Best-effort 导入所有当前支持 MCP 的应用，并在结束后聚合上报失败。
    pub fn import_from_all_apps(state: &AppState) -> Result<usize, AppError> {
        let results = [
            ("claude", Self::import_from_claude(state)),
            ("codex", Self::import_from_codex(state)),
            ("gemini", Self::import_from_gemini(state)),
            ("grokbuild", Self::import_from_grokbuild(state)),
            ("opencode", Self::import_from_opencode(state)),
        ];
        let mut total = 0;
        let mut failures = Vec::new();

        for (app, result) in results {
            match result {
                Ok(count) => total += count,
                Err(error) => {
                    log::warn!("从 {app} 导入 MCP 失败: {error}");
                    failures.push(format!("{app}: {error}"));
                }
            }
        }

        if failures.is_empty() {
            Ok(total)
        } else {
            Err(AppError::Message(format!(
                "已导入 {total} 个，部分应用导入失败: {}",
                failures.join("; ")
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::sync::Arc;

    struct TestHome {
        previous: Option<std::ffi::OsString>,
        _dir: tempfile::TempDir,
    }

    impl TestHome {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("temp home");
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
            crate::settings::reload_settings().expect("reload test settings");
            Self {
                previous,
                _dir: dir,
            }
        }
    }

    impl Drop for TestHome {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            crate::settings::reload_settings().expect("restore settings");
        }
    }

    #[test]
    #[serial]
    fn import_from_all_apps_reports_failure_but_keeps_successes() {
        let _home = TestHome::new();
        std::fs::write(
            crate::config::get_claude_mcp_path(),
            r#"{"mcpServers":{"alpha":{"type":"stdio","command":"echo"}}}"#,
        )
        .expect("write claude mcp");
        let codex_path = crate::codex_config::get_codex_config_path();
        std::fs::create_dir_all(codex_path.parent().expect("codex parent"))
            .expect("create codex dir");
        std::fs::write(codex_path, "not = = valid toml").expect("write invalid codex config");

        let db = Arc::new(crate::database::Database::memory().expect("database"));
        let state = AppState::new(db.clone());
        let error = McpService::import_from_all_apps(&state)
            .expect_err("invalid Codex config must be reported");

        assert!(error.to_string().contains("codex"));
        let servers = db.get_all_mcp_servers().expect("servers");
        assert!(servers
            .get("alpha")
            .is_some_and(|server| server.apps.claude));
    }

    #[test]
    #[serial]
    fn sync_all_reports_broken_app_but_projects_the_rest() {
        let _home = TestHome::new();
        std::fs::write(crate::config::get_claude_mcp_path(), "not json")
            .expect("write invalid claude config");
        let codex_path = crate::codex_config::get_codex_config_path();
        std::fs::create_dir_all(codex_path.parent().expect("codex parent"))
            .expect("create codex dir");
        std::fs::write(&codex_path, "").expect("write codex config");

        let db = Arc::new(crate::database::Database::memory().expect("database"));
        db.save_mcp_server(&McpServer {
            id: "alpha".to_string(),
            name: "Alpha".to_string(),
            server: serde_json::json!({ "type": "stdio", "command": "echo" }),
            apps: crate::app_config::McpApps {
                codex: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: Vec::new(),
        })
        .expect("save server");
        let state = AppState::new(db);

        let error = McpService::sync_all_enabled(&state)
            .expect_err("invalid Claude config must be reported");
        assert!(error.to_string().contains("claude"));
        assert!(std::fs::read_to_string(&codex_path)
            .expect("read codex config")
            .contains("[mcp_servers.alpha]"));
        McpService::sync_enabled_for_app(&state, &AppType::Codex)
            .expect("targeted Codex projection ignores broken Claude config");
    }
}
