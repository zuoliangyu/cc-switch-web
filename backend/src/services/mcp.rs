use indexmap::IndexMap;

use crate::app_config::{AppType, McpServer};
use crate::error::AppError;
use crate::mcp;
use crate::mcp::ImportedMcpServers;
use crate::store::AppState;

/// MCP 相关业务逻辑（v3.7.0 统一结构）
pub struct McpService;

/// 「重新同步到各应用」里单个应用的结果
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppSyncOutcome {
    pub app: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl McpService {
    pub fn resync_app(state: &AppState, app: &AppType) -> McpAppSyncOutcome {
        match Self::sync_enabled_for_app(state, app) {
            Ok(()) => McpAppSyncOutcome {
                app: app.as_str().to_string(),
                ok: true,
                error: None,
            },
            Err(err) => {
                log::warn!("重新同步 MCP 到 {app:?} 失败: {err}");
                McpAppSyncOutcome {
                    app: app.as_str().to_string(),
                    ok: false,
                    error: Some(err.to_string()),
                }
            }
        }
    }

    pub fn resync_targets(apps: Option<&[String]>) -> Result<Vec<AppType>, AppError> {
        let managed = Self::live_sync_apps();
        let Some(apps) = apps.filter(|apps| !apps.is_empty()) else {
            return Ok(managed);
        };
        let mut targets = Vec::new();
        for raw in apps {
            let app = <AppType as std::str::FromStr>::from_str(raw)?;
            if !managed.contains(&app) {
                return Err(AppError::Message(format!(
                    "{} 不支持由 CC Switch 管理 MCP",
                    app.as_str()
                )));
            }
            if !targets.contains(&app) {
                targets.push(app);
            }
        }
        Ok(targets)
    }

    pub fn live_sync_apps() -> Vec<AppType> {
        AppType::all()
            .filter(|app| {
                !matches!(
                    app,
                    AppType::OpenClaw | AppType::Hermes | AppType::ClaudeDesktop
                )
            })
            .collect()
    }

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

        // MCode / Pi / Kimi 的文件和数据库一起提交：任一步失败都恢复原样
        let save_with_kimi = || {
            if server.apps.kimi || prev_apps.kimi {
                mcp::kimi::sync_and_commit(
                    &server.id,
                    server.apps.kimi.then_some(&server.server),
                    || state.db.save_mcp_server(&server),
                )
            } else {
                state.db.save_mcp_server(&server)
            }
        };
        let save_with_agy = || {
            if server.apps.agy || prev_apps.agy {
                mcp::agy::sync_and_commit(
                    &server.id,
                    mcp::agy::AgyChange::from_enabled(server.apps.agy.then_some(&server.server)),
                    save_with_kimi,
                )
            } else {
                save_with_kimi()
            }
        };
        let save_with_pi = || {
            if server.apps.pi || prev_apps.pi {
                mcp::pi::sync_and_commit(
                    &state.db,
                    &server.id,
                    mcp::pi::PiChange::from_enabled(server.apps.pi.then_some(&server.server)),
                    save_with_agy,
                )
            } else {
                save_with_agy()
            }
        };
        if server.apps.mcode || prev_apps.mcode {
            mcp::mcode::sync_and_commit(
                &server.id,
                server.apps.mcode.then_some(&server.server),
                save_with_pi,
            )?;
        } else {
            save_with_pi()?;
        }

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
            let delete_with_kimi = || {
                if server.apps.kimi {
                    mcp::kimi::sync_and_commit(id, None, || state.db.delete_mcp_server(id))
                } else {
                    state.db.delete_mcp_server(id)
                }
            };
            let delete_with_agy = || {
                if server.apps.agy {
                    mcp::agy::sync_and_commit(id, mcp::agy::AgyChange::Remove, delete_with_kimi)
                } else {
                    delete_with_kimi()
                }
            };
            let delete_with_pi = || {
                if server.apps.pi {
                    mcp::pi::sync_and_commit(
                        &state.db,
                        id,
                        mcp::pi::PiChange::Remove,
                        delete_with_agy,
                    )
                } else {
                    delete_with_agy()
                }
            };
            if server.apps.mcode {
                mcp::mcode::sync_and_commit(id, None, delete_with_pi)?;
            } else {
                delete_with_pi()?;
            }
            if !server.apps.pi {
                // 取消勾选只在 Pi 里禁用、条目还留着：服务器删了就一并清掉（尽力而为）
                if let Err(err) = mcp::pi::remove_disabled_if_managed(id, &server.server) {
                    log::warn!("清理 Pi 中已禁用的 MCP 条目 '{id}' 失败: {err}");
                }
            }

            // 从所有应用的 live 配置中移除
            Self::remove_server_from_all_apps(state, id, &server)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// 命令入口用的 [`Self::toggle_app`]：先拿这个应用的切换锁再读改写 live 配置。
    ///
    /// 逐条写入是「读文件 → 改 → 写回」，并发的两次切换（批量勾选、和切换供应商或
    /// 重新同步撞在一起）会互相覆盖、丢掉对方写的条目。和 `resync_mcp_to_apps` 用同一把
    /// 锁。`toggle_app` 内部不拿这把锁（tokio 的锁不可重入），已经持锁的调用方直接调它。
    pub async fn toggle_app_locked(
        state: &AppState,
        server_id: &str,
        app: AppType,
        enabled: bool,
    ) -> Result<(), AppError> {
        let _guard = state.proxy_service.lock_switch_for_app(app.as_str()).await;
        Self::toggle_app(state, server_id, app, enabled)
    }

    /// 切换指定应用的启用状态。调用方负责先拿这个应用的切换锁（见 [`Self::toggle_app_locked`]）。
    pub fn toggle_app(
        state: &AppState,
        server_id: &str,
        app: AppType,
        enabled: bool,
    ) -> Result<(), AppError> {
        if matches!(
            app,
            AppType::Mcode | AppType::Pi | AppType::Kimi | AppType::Agy
        ) {
            if let Some(server) = state.db.get_all_mcp_servers()?.get(server_id) {
                let spec = enabled.then_some(&server.server);
                let commit = || {
                    state
                        .db
                        .update_mcp_server_app_enabled(server_id, &app, enabled)
                };
                if app == AppType::Mcode {
                    mcp::mcode::sync_and_commit(server_id, spec, commit)?;
                } else if app == AppType::Kimi {
                    mcp::kimi::sync_and_commit(server_id, spec, commit)?;
                } else if app == AppType::Agy {
                    mcp::agy::sync_and_commit(
                        server_id,
                        mcp::agy::AgyChange::from_enabled(spec),
                        commit,
                    )?;
                } else {
                    mcp::pi::sync_and_commit(
                        &state.db,
                        server_id,
                        mcp::pi::PiChange::from_enabled(spec),
                        commit,
                    )?;
                }
            }
            return Ok(());
        }
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
            if matches!(
                app,
                AppType::Mcode | AppType::Pi | AppType::Kimi | AppType::Agy
            ) {
                continue; // Already written before saving the managed state.
            }
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
            AppType::Mcode => mcp::mcode::sync(&server.id, Some(&server.server))?,
            AppType::Pi => mcp::pi::sync(&server.id, Some(&server.server))?,
            AppType::Kimi => mcp::kimi::sync(&server.id, Some(&server.server))?,
            AppType::Agy => mcp::agy::sync(&server.id, Some(&server.server))?,
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
            if matches!(
                app,
                AppType::Mcode | AppType::Pi | AppType::Kimi | AppType::Agy
            ) {
                continue; // Already removed before deleting the managed record.
            }
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
            AppType::Mcode => mcp::mcode::sync(id, None)?,
            AppType::Pi => mcp::pi::sync(id, None)?,
            AppType::Kimi => mcp::kimi::sync(id, None)?,
            AppType::Agy => mcp::agy::sync(id, None)?,
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
            AppType::OpenClaw | AppType::Hermes | AppType::ClaudeDesktop
        ) {
            return Ok(());
        }

        // 逐条容错：一条写不进去（规范不是对象、这个应用不认的类型）不该让排在
        // 它后面的服务器全都停在旧状态。全部跑完后聚合上报，调用方照旧能看到
        // 失败。错误相同的条目归并成一项：live 文件本身损坏时每一条都报同一句。
        let mut failures: IndexMap<String, Vec<&str>> = IndexMap::new();
        for server in servers.values() {
            let result = if server.apps.is_enabled_for(app) {
                Self::sync_server_to_app(state, server, app)
            } else if !matches!(
                app,
                AppType::Mcode | AppType::Pi | AppType::Kimi | AppType::Agy
            ) {
                Self::remove_server_from_app(state, &server.id, app)
            } else {
                // MCode / Pi's false flag also covers pre-existing, unmanaged servers.
                // Only explicit disable/delete operations may remove those entries.
                Ok(())
            };
            if let Err(err) = result {
                log::warn!("同步 MCP 服务器 '{}' 到 {app:?} 失败: {err}", server.id);
                failures
                    .entry(err.to_string())
                    .or_default()
                    .push(&server.id);
            }
        }

        if failures.is_empty() {
            return Ok(());
        }
        let detail = failures
            .iter()
            .map(|(error, ids)| format!("{}: {error}", ids.join(", ")))
            .collect::<Vec<_>>()
            .join("; ");
        Err(AppError::Message(format!(
            "部分 MCP 服务器同步到 {} 失败: {detail}",
            app.as_str()
        )))
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
            ("mcode", mcp::mcode::import(state)),
            ("pi", mcp::pi::import(state)),
            ("kimi", mcp::kimi::import(state)),
            ("agy", mcp::agy::import(state)),
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

    // 以下三项移植自上游 tests/mcp_commands.rs（06082e18）。
    fn mcode_test_state() -> (TestHome, AppState, std::path::PathBuf) {
        std::env::remove_var("MINIMAX_DATA_DIR");
        std::env::remove_var("MAVIS_DATA_DIR");
        let home = TestHome::new();
        let state = AppState::new(Arc::new(
            crate::database::Database::memory().expect("database"),
        ));
        let path = crate::config::get_home_dir().join(".minimax/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        (home, state, path)
    }

    #[test]
    #[serial]
    fn mcode_import_ignores_native_metadata_and_continues_after_conflicts() {
        let (_home, state, path) = mcode_test_state();
        for id in ["a-conflict", "b-shared"] {
            let server: McpServer = serde_json::from_value(serde_json::json!({
                "id":id, "name":id, "server":{"type":"http","url":"https://example.com/mcp"},
                "apps":{"claude":true}
            }))
            .unwrap();
            state.db.save_mcp_server(&server).unwrap();
        }
        let original = serde_json::json!({"mcpServers":{
            "a-conflict":{"command":"different"},
            "b-shared":{"type":"streamable-http","url":"https://example.com/mcp","timeout":5000,"description":"native","tools":[{"name":"tool"}]},
            "c-new":{"command":"node"}
        }});
        std::fs::write(&path, original.to_string()).unwrap();
        let error = McpService::import_from_all_apps(&state)
            .unwrap_err()
            .to_string();
        assert!(error.contains("a-conflict"));
        assert!(!error.contains("b-shared"));
        let servers = state.db.get_all_mcp_servers().unwrap();
        assert!(!servers["a-conflict"].apps.mcode);
        assert!(servers["b-shared"].apps.mcode && servers["b-shared"].apps.claude);
        assert!(servers["c-new"].apps.mcode);
        McpService::sync_enabled_for_app(&state, &AppType::Mcode).unwrap();
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        for field in ["timeout", "description", "tools"] {
            assert_eq!(
                written["mcpServers"]["b-shared"][field],
                original["mcpServers"]["b-shared"][field]
            );
        }
        assert_eq!(
            written["mcpServers"]["a-conflict"],
            original["mcpServers"]["a-conflict"]
        );
    }

    #[test]
    #[serial]
    fn mcode_write_failures_keep_managed_mcp_state_for_all_write_entries() {
        let (_home, state, path) = mcode_test_state();
        let server: McpServer = serde_json::from_value(serde_json::json!({
            "id":"managed", "name":"Managed", "server":{"command":"node"}, "apps":{"mcode":true}
        }))
        .unwrap();
        state.db.save_mcp_server(&server).unwrap();
        std::fs::write(&path, "invalid json").unwrap();
        assert!(McpService::toggle_app(&state, &server.id, AppType::Mcode, false).is_err());
        let mut disabled = server.clone();
        disabled.apps.mcode = false;
        assert!(McpService::upsert_server(&state, disabled.clone()).is_err());
        let mut edited = server.clone();
        edited.server = serde_json::json!({"command":"replacement"});
        assert!(McpService::upsert_server(&state, edited).is_err());
        assert!(McpService::delete_server(&state, &server.id).is_err());
        let current = &state.db.get_all_mcp_servers().unwrap()[&server.id];
        assert!(current.apps.mcode);
        assert_eq!(current.server, server.server);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid json");
        state.db.save_mcp_server(&disabled).unwrap();
        assert!(McpService::toggle_app(&state, &server.id, AppType::Mcode, true).is_err());
        assert!(
            !state.db.get_all_mcp_servers().unwrap()[&server.id]
                .apps
                .mcode
        );
        std::fs::write(&path, "{}").unwrap();
        McpService::toggle_app(&state, &server.id, AppType::Mcode, true).unwrap();
        assert!(
            state.db.get_all_mcp_servers().unwrap()[&server.id]
                .apps
                .mcode
        );
        McpService::toggle_app(&state, &server.id, AppType::Mcode, false).unwrap();
        assert!(
            !state.db.get_all_mcp_servers().unwrap()[&server.id]
                .apps
                .mcode
        );
    }

    #[test]
    #[serial]
    fn mcode_automatic_sync_preserves_unmanaged_same_name_servers() {
        let (_home, state, path) = mcode_test_state();
        let native = serde_json::json!({"mcpServers":{"context7":{"command":"native-server","enabled":true}}});
        std::fs::write(&path, native.to_string()).unwrap();
        let server = McpServer {
            id: "context7".into(),
            name: "Context7".into(),
            server: serde_json::json!({"command":"managed-server"}),
            apps: crate::app_config::McpApps {
                claude: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: vec![],
        };
        state.db.save_mcp_server(&server).unwrap();
        let error = McpService::import_from_all_apps(&state).unwrap_err();
        assert!(error.to_string().contains("context7"));
        assert!(
            !state.db.get_all_mcp_servers().unwrap()["context7"]
                .apps
                .mcode
        );
        McpService::sync_enabled_for_app(&state, &AppType::Mcode).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&path).unwrap())
                .unwrap(),
            native
        );
        McpService::toggle_app(&state, "context7", AppType::Mcode, true).unwrap();
        McpService::import_from_all_apps(&state).unwrap();
        McpService::toggle_app(&state, "context7", AppType::Mcode, false).unwrap();
        let disabled: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(disabled["mcpServers"].get("context7").is_none());
    }

    #[test]
    #[serial]
    fn projecting_an_app_continues_past_a_server_that_cannot_be_written() {
        let _home = TestHome::new();
        let mcp_path = crate::config::get_claude_mcp_path();
        std::fs::write(
            &mcp_path,
            serde_json::json!({"mcpServers": {"c-off": {"type": "stdio", "command": "old"}}})
                .to_string(),
        )
        .expect("seed ~/.claude.json");

        let state = AppState::new(Arc::new(
            crate::database::Database::memory().expect("database"),
        ));
        // 直接入库，绕过面板校验：规范不是对象的行可能来自云同步或旧数据。
        for (id, server, claude) in [
            ("a-broken", serde_json::json!("not an object"), true),
            (
                "b-good",
                serde_json::json!({"type": "stdio", "command": "echo"}),
                true,
            ),
            (
                "c-off",
                serde_json::json!({"type": "stdio", "command": "old"}),
                false,
            ),
        ] {
            let server: McpServer = serde_json::from_value(serde_json::json!({
                "id": id, "name": id, "server": server, "apps": {"claude": claude}
            }))
            .expect("build server");
            state.db.save_mcp_server(&server).expect("save server");
        }

        let err = McpService::sync_enabled_for_app(&state, &AppType::Claude)
            .expect_err("the broken server must still be reported");
        assert!(
            err.to_string().contains("a-broken"),
            "error should name the failed server: {err}"
        );

        let text = std::fs::read_to_string(&mcp_path).expect("read ~/.claude.json");
        let v: serde_json::Value = serde_json::from_str(&text).expect("parse ~/.claude.json");
        assert!(
            v.pointer("/mcpServers/b-good").is_some(),
            "servers after the failed one must still be written"
        );
        assert!(
            v.pointer("/mcpServers/c-off").is_none(),
            "disabled servers after the failed one must still be removed"
        );
        assert!(v.pointer("/mcpServers/a-broken").is_none());
    }

    /// 上游 tests/mcp_commands.rs 的 Pi MCP 用例（d455dd85、1cc2c732），改为 Web 的单元测试
    mod pi_mcp {
        use super::*;
        use serde_json::json;
        use std::fs;

        fn pi_test_state() -> (TestHome, AppState) {
            std::env::remove_var("PI_CODING_AGENT_DIR");
            let home = TestHome::new();
            let state = AppState::new(Arc::new(
                crate::database::Database::memory().expect("database"),
            ));
            (home, state)
        }

        #[test]
        #[serial]
        fn pi_toggle_writes_its_mcp_json_and_keeps_pi_fields() {
            let (_home, state) = pi_test_state();
            let path = crate::config::get_home_dir().join(".pi/agent/mcp.json");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                json!({"mcpServers":{"docs":{"command":"old","exposure":"direct","timeout":30}}})
                    .to_string(),
            )
            .unwrap();
            let read = || -> serde_json::Value {
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
            };
            let server: McpServer = serde_json::from_value(json!({
                "id":"docs", "name":"Docs", "server":{"type":"stdio","command":"node","args":["s.js"]}, "apps":{}
            }))
            .unwrap();
            state.db.save_mcp_server(&server).unwrap();

            McpService::toggle_app(&state, "docs", AppType::Pi, true).unwrap();
            let docs = &read()["mcpServers"]["docs"];
            assert_eq!(docs["command"], "node");
            assert_eq!(docs["args"], json!(["s.js"]));
            assert_eq!(docs["exposure"], "direct");
            assert_eq!(docs["timeout"], 30);
            assert!(state.db.get_all_mcp_servers().unwrap()["docs"].apps.pi);

            // 取消勾选只在 Pi 里禁用，保留条目和 Pi 自己的设置
            McpService::toggle_app(&state, "docs", AppType::Pi, false).unwrap();
            let disabled = &read()["mcpServers"]["docs"];
            assert_eq!(disabled["enabled"], false);
            assert_eq!(disabled["exposure"], "direct");
            assert!(!state.db.get_all_mcp_servers().unwrap()["docs"].apps.pi);

            // 在 CC Switch 里删除服务器才删掉条目
            McpService::delete_server(&state, "docs").unwrap();
            assert!(read()["mcpServers"].get("docs").is_none());

            // Pi 不支持 SSE：拒绝写入，数据库也不勾选
            let sse: McpServer = serde_json::from_value(json!({
                "id":"remote", "name":"Remote", "server":{"type":"sse","url":"https://example.com/sse"}, "apps":{}
            }))
            .unwrap();
            state.db.save_mcp_server(&sse).unwrap();
            assert!(McpService::toggle_app(&state, "remote", AppType::Pi, true).is_err());
            assert!(!state.db.get_all_mcp_servers().unwrap()["remote"].apps.pi);
            assert!(read()["mcpServers"].get("remote").is_none());
        }

        /// 审查 #7862：导入 → 取消勾选 → 重新勾选（含批量禁用后撤销：前端逐个 toggle）
        /// 不能丢掉 timeout、toolExposure、oauth 等 Pi 自己的设置
        #[test]
        #[serial]
        fn pi_disable_then_enable_round_trip_keeps_pi_settings() {
            let (_home, state) = pi_test_state();
            let path = crate::config::get_home_dir().join(".pi/agent/mcp.json");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let pi_settings = json!({
                "timeout": 30000,
                "exposure": "direct",
                "toolExposure": {"delete_*": "hidden"},
                "oauth": {"clientName": "custom-client"}
            });
            let mut servers = serde_json::Map::new();
            for id in ["a", "b"] {
                let mut entry = pi_settings.clone();
                entry["command"] = json!("node");
                entry["args"] = json!([format!("{id}.js")]);
                servers.insert(id.into(), entry);
            }
            fs::write(&path, json!({"mcpServers": servers}).to_string()).unwrap();
            McpService::import_from_all_apps(&state).unwrap();
            let read = || -> serde_json::Value {
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
            };

            for id in ["a", "b"] {
                McpService::toggle_app(&state, id, AppType::Pi, false).unwrap();
            }
            for id in ["a", "b"] {
                McpService::toggle_app(&state, id, AppType::Pi, true).unwrap();
            }
            let written = read();
            for id in ["a", "b"] {
                let entry = &written["mcpServers"][id];
                assert_eq!(entry["enabled"], true, "{id}");
                assert_eq!(entry["args"], json!([format!("{id}.js")]), "{id}");
                for field in ["timeout", "exposure", "toolExposure", "oauth"] {
                    assert_eq!(entry[field], pi_settings[field], "{id}.{field}");
                }
            }

            // 条目在 Pi 里被删掉后再勾选：从导入时保存的 Pi 字段重建
            fs::write(&path, json!({"mcpServers": {}}).to_string()).unwrap();
            McpService::toggle_app(&state, "a", AppType::Pi, false).unwrap();
            McpService::toggle_app(&state, "a", AppType::Pi, true).unwrap();
            let rebuilt = &read()["mcpServers"]["a"];
            for field in ["timeout", "exposure", "toolExposure", "oauth"] {
                assert_eq!(rebuilt[field], pi_settings[field], "a.{field}");
            }
        }

        #[test]
        #[serial]
        fn pi_import_keeps_disabled_entries_unchecked() {
            let (_home, state) = pi_test_state();
            let path = crate::config::get_home_dir().join(".pi/agent/mcp.json");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                json!({"mcpServers":{
                    "on":{"url":"https://example.com/mcp"},
                    "off":{"command":"node","enabled":false,"exposure":"deferred"}
                }})
                .to_string(),
            )
            .unwrap();
            McpService::import_from_all_apps(&state).unwrap();
            let servers = state.db.get_all_mcp_servers().unwrap();
            assert!(servers["on"].apps.pi);
            assert_eq!(servers["on"].server["type"], "http");
            assert!(!servers["off"].apps.pi);
            assert_eq!(servers["off"].server["exposure"], "deferred");
        }

        /// 导入按 Pi 的规则校验：SSE、非法名、只差 - 和 _ 的条目不导入，免得之后每次同步报错
        #[test]
        #[serial]
        fn pi_import_skips_entries_pi_rejects() {
            let (_home, state) = pi_test_state();
            // 数据库里已勾选 Pi 的 api_server（比如 Pi 没装时勾上的）：文件里的 api-server 不能再导入勾上
            let ticked: McpServer = serde_json::from_value(json!({
                "id":"api_server", "name":"api_server", "server":{"type":"stdio","command":"x"},
                "apps":{"pi":true}
            }))
            .unwrap();
            state.db.save_mcp_server(&ticked).unwrap();
            let path = crate::config::get_home_dir().join(".pi/agent/mcp.json");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                json!({"mcpServers":{
                    "ok":{"command":"node"},
                    "remote":{"type":"sse","url":"https://example.com/sse"},
                    "bad name":{"command":"node"},
                    "dev-tools":{"command":"a"},
                    "dev_tools":{"command":"b"},
                    "api-server":{"command":"y"}
                }})
                .to_string(),
            )
            .unwrap();
            assert!(McpService::import_from_all_apps(&state).is_err());
            let servers = state.db.get_all_mcp_servers().unwrap();
            assert!(servers["ok"].apps.pi);
            for id in ["remote", "bad name", "dev-tools", "dev_tools", "api-server"] {
                assert!(!servers.contains_key(id), "{id}");
            }
        }

        /// Pi 没装（没有 Pi 配置目录）时勾选只入库，不新建 mcp.json；Pi 不接受的仍然拒绝
        #[test]
        #[serial]
        fn pi_toggle_without_pi_dir_skips_the_file() {
            let (_home, state) = pi_test_state();
            let dir = crate::config::get_home_dir().join(".pi/agent");
            let _ = fs::remove_dir_all(&dir);
            for (id, spec) in [
                ("docs", json!({"type":"stdio","command":"node"})),
                (
                    "remote",
                    json!({"type":"sse","url":"https://example.com/sse"}),
                ),
                ("dev-tools", json!({"type":"stdio","command":"a"})),
                ("dev_tools", json!({"type":"stdio","command":"b"})),
            ] {
                let server: McpServer = serde_json::from_value(json!({
                    "id": id, "name": id, "server": spec, "apps": {}
                }))
                .unwrap();
                state.db.save_mcp_server(&server).unwrap();
            }

            McpService::toggle_app(&state, "docs", AppType::Pi, true).unwrap();
            assert!(state.db.get_all_mcp_servers().unwrap()["docs"].apps.pi);
            McpService::sync_enabled_for_app(&state, &AppType::Pi).unwrap();
            McpService::toggle_app(&state, "docs", AppType::Pi, false).unwrap();
            McpService::delete_server(&state, "docs").unwrap();
            assert!(McpService::toggle_app(&state, "remote", AppType::Pi, true).is_err());
            assert!(!state.db.get_all_mcp_servers().unwrap()["remote"].apps.pi);

            // 没有文件可对照时，只差 - 和 _ 的名字对照数据库里已勾选 Pi 的服务器拒绝
            McpService::toggle_app(&state, "dev-tools", AppType::Pi, true).unwrap();
            assert!(McpService::toggle_app(&state, "dev_tools", AppType::Pi, true).is_err());
            let mut edited = state.db.get_all_mcp_servers().unwrap()["dev_tools"].clone();
            edited.apps.pi = true;
            assert!(McpService::upsert_server(&state, edited).is_err());
            assert!(!state.db.get_all_mcp_servers().unwrap()["dev_tools"].apps.pi);
            assert!(!dir.exists());
        }

        /// 审查 #7888：Pi 没装时两个请求并发勾选 dev-tools 和 dev_tools，最多只能成功一个。
        /// 重名检查要和提交在同一把写锁里读数据库，锁外读的快照会让两个都通过
        #[test]
        #[serial]
        fn pi_concurrent_toggles_of_colliding_names_enable_at_most_one() {
            let (_home, state) = pi_test_state();
            for round in 0..20 {
                for (id, enable) in [("dev-tools", "toggle"), ("dev_tools", "upsert")] {
                    let server: McpServer = serde_json::from_value(json!({
                        "id": id, "name": id, "server": {"type":"stdio","command": enable}, "apps": {}
                    }))
                    .unwrap();
                    state.db.save_mcp_server(&server).unwrap();
                }
                let barrier = std::sync::Barrier::new(2);
                std::thread::scope(|scope| {
                    scope.spawn(|| {
                        barrier.wait();
                        let _ = McpService::toggle_app(&state, "dev-tools", AppType::Pi, true);
                    });
                    scope.spawn(|| {
                        let mut server =
                            state.db.get_all_mcp_servers().unwrap()["dev_tools"].clone();
                        server.apps.pi = true;
                        barrier.wait();
                        let _ = McpService::upsert_server(&state, server);
                    });
                });
                let servers = state.db.get_all_mcp_servers().unwrap();
                let enabled = ["dev-tools", "dev_tools"]
                    .iter()
                    .filter(|id| servers[**id].apps.pi)
                    .count();
                assert_eq!(enabled, 1, "round {round}");
            }
            assert!(!crate::config::get_home_dir().join(".pi").exists());
        }
    }
}
