#![allow(non_snake_case)]

fn merge_settings_for_save(
    mut incoming: crate::settings::AppSettings,
    existing: &crate::settings::AppSettings,
) -> crate::settings::AppSettings {
    match (&mut incoming.webdav_sync, &existing.webdav_sync) {
        // incoming 没有 webdav → 保留现有
        (None, _) => {
            incoming.webdav_sync = existing.webdav_sync.clone();
        }
        // incoming 有 webdav 但密码为空，且现有有密码 → 填回现有密码
        // （get_settings_for_frontend 总是清空密码，所以通过 save_settings
        //   传入的空密码意味着"保持现有"而非"用户主动清空"）
        (Some(incoming_sync), Some(existing_sync))
            if incoming_sync.password.is_empty() && !existing_sync.password.is_empty() =>
        {
            incoming_sync.password = existing_sync.password.clone();
        }
        _ => {}
    }
    incoming.local_migrations = existing.local_migrations.clone();
    // 客户端地址只经 PUT /api/proxy/client-host 保存（它还要重写客户端）；全量保存带的是前端
    // 缓存里的旧值，透传会把刚保存的地址冲掉。
    incoming.proxy_client_host = existing.proxy_client_host.clone();
    incoming
}

pub fn get_settings_internal() -> crate::settings::AppSettings {
    crate::settings::get_settings_for_frontend()
}

/// 保存设置
pub fn save_settings_internal(
    state: &crate::store::AppState,
    settings: crate::settings::AppSettings,
) -> Result<bool, String> {
    let existing = crate::settings::get_settings();
    let merged = merge_settings_for_save(settings, &existing);
    let unify_changed = merged.unify_codex_session_history != existing.unify_codex_session_history;
    let unify_enabled = merged.unify_codex_session_history;
    let content_search_disabled =
        existing.session_content_search_enabled && !merged.session_content_search_enabled;
    crate::settings::update_settings(merged).map_err(|e| e.to_string())?;
    // 关掉「搜索消息正文」就删索引文件：网页在保存后还会单独调一次清理，
    // 这里兜住绕过网页、直接 PUT 设置的情况（重复清理没有副作用）
    if content_search_disabled {
        if let Err(error) = crate::session_manager::search::clear() {
            log::warn!("关闭正文搜索后删除会话正文索引失败: {error}");
        }
    }
    if unify_changed {
        if let Err(error) = crate::services::provider::reapply_current_codex_official_live(state) {
            let _ = crate::settings::update_settings(existing);
            let _ = crate::services::provider::reapply_current_codex_official_live(state);
            return Err(format!("统一 Codex 会话历史设置未生效: {error}"));
        }
        if unify_enabled {
            // 后台把留在 openai 桶的会话迁进 custom 桶（仅当用户勾选了迁入既有会话，函数内部
            // 自门控）。大会话目录可能要读数秒，不能阻塞设置保存；失败时下次启动自动重试。
            tokio::task::spawn_blocking(run_codex_unify_migration_and_notify);
        } else if let Err(error) = crate::settings::clear_codex_official_history_unify_state() {
            log::warn!("清理 Codex 官方历史迁移状态失败: {error}");
        }
    }
    Ok(true)
}

/// 开启统一会话历史后，后台把官方会话迁进共享组的那一轮跑完了（或失败）。
const CODEX_UNIFY_MIGRATION_FINISHED_EVENT: &str = "codex-unify-migration-finished";

/// 跑一轮统一迁移，迁完（或失败）经事件推送告诉前端：开启时前端只说了「后台迁入中」，
/// 用户要等到这一刻再重启 Codex，旧会话才会解锁。跳过（没东西可迁等）时不发。
fn run_codex_unify_migration_and_notify() {
    let result = crate::codex_history_migration::maybe_migrate_codex_official_history();
    match &result {
        Ok(outcome) => match &outcome.skipped_reason {
            Some(reason) => log::debug!("Codex 官方历史迁移跳过: {reason}"),
            None => log::info!(
                "Codex 官方历史迁移完成: files={}, rows={}",
                outcome.migrated_jsonl_files,
                outcome.migrated_state_rows
            ),
        },
        Err(error) => log::warn!("Codex 官方历史迁移失败，将在下次启动重试: {error}"),
    }
    if let Some(payload) = codex_unify_migration_finished_payload(&result) {
        crate::events::emit(CODEX_UNIFY_MIGRATION_FINISHED_EVENT, payload);
    }
}

fn codex_unify_migration_finished_payload(
    result: &Result<crate::codex_history_migration::MigrationOutcome, crate::error::AppError>,
) -> Option<serde_json::Value> {
    match result {
        Ok(outcome) if outcome.skipped_reason.is_some() => None,
        Ok(outcome) => Some(serde_json::json!({
            "migratedStateRows": outcome.migrated_state_rows,
            "migratedJsonlFiles": outcome.migrated_jsonl_files,
            "error": null,
        })),
        Err(error) => Some(serde_json::json!({
            "migratedStateRows": 0,
            "migratedJsonlFiles": 0,
            "error": error.to_string(),
        })),
    }
}

/// 聚合设置（经典子 agent 工具、子 agent 模型和推理强度、自动审批模型）只影响 Stack 模式下
/// 写给 Codex 的内容：保存后立即重写，失败时回滚这几项，免得界面显示已改好、客户端还是旧的。
/// `existing` 是保存前的设置。
pub async fn resync_codex_stack_settings(
    state: &crate::store::AppState,
    existing: &crate::settings::AppSettings,
) -> Result<(), String> {
    let saved = crate::settings::get_settings();
    let changed = saved.codex_stack_classic_tools != existing.codex_stack_classic_tools
        || saved.codex_stack_subagent_model != existing.codex_stack_subagent_model
        || saved.codex_stack_subagent_reasoning_effort
            != existing.codex_stack_subagent_reasoning_effort
        || saved.codex_stack_auto_review_model != existing.codex_stack_auto_review_model;
    if !changed {
        return Ok(());
    }
    if let Err(err) = crate::mode::controller::resync_codex_stack_catalog(state).await {
        log::warn!("Codex 聚合设置变更后重写客户端配置失败，回滚设置: {err}");
        let mut rollback = crate::settings::get_settings();
        rollback.codex_stack_classic_tools = existing.codex_stack_classic_tools;
        rollback.codex_stack_subagent_model = existing.codex_stack_subagent_model.clone();
        rollback.codex_stack_subagent_reasoning_effort =
            existing.codex_stack_subagent_reasoning_effort.clone();
        rollback.codex_stack_auto_review_model = existing.codex_stack_auto_review_model.clone();
        if let Err(rollback_err) = crate::settings::update_settings(rollback) {
            log::error!("回滚 Codex 聚合设置失败: {rollback_err}");
        }
        return Err(format!(
            "聚合设置未生效（Codex 配置重写失败） (The aggregation setting did not take effect: rewriting the Codex config failed): {err}"
        ));
    }
    Ok(())
}

/// 「暂停使用官方登录」只影响路由 / 聚合模式下写给 Codex 的内容：保存后立即重写，失败时回滚
/// 这一项。`existing` 是保存前的设置。
pub async fn resync_codex_proxy_settings(
    state: &crate::store::AppState,
    existing: &crate::settings::AppSettings,
) -> Result<(), String> {
    let saved = crate::settings::get_settings();
    if saved.codex_proxy_without_official_login == existing.codex_proxy_without_official_login {
        return Ok(());
    }
    if let Err(err) = crate::mode::controller::resync_codex_proxy(state).await {
        log::warn!("「暂停使用官方登录」变更后重写 Codex 配置失败，回滚设置: {err}");
        let mut rollback = crate::settings::get_settings();
        rollback.codex_proxy_without_official_login = existing.codex_proxy_without_official_login;
        if let Err(rollback_err) = crate::settings::update_settings(rollback) {
            log::error!("回滚「暂停使用官方登录」设置失败: {rollback_err}");
        }
        return Err(format!(
            "「暂停使用官方登录」未生效（Codex 配置重写失败） (\"Pause the official login\" did not take effect: rewriting the Codex config failed): {err}"
        ));
    }
    Ok(())
}

/// Codex 的 `config.toml` 是不是用 `[features] multi_agent_v2` 强制了新版子 agent 工具
/// （这时「经典子 agent 工具」开关不生效，界面上提示）。
pub fn codex_forces_multi_agent_v2_internal() -> Result<bool, String> {
    let text = crate::codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
    Ok(crate::codex_config::codex_config_forces_multi_agent_v2(
        &text,
    ))
}

/// Codex 会话压缩开关（`[features] local_thread_store_compression`）当前是否开启。
pub fn get_codex_session_compression_internal() -> Result<bool, String> {
    crate::services::codex_session_compression::is_enabled().map_err(|e| e.to_string())
}

/// 开关 Codex 会话压缩，返回写入后的状态。
pub fn set_codex_session_compression_internal(
    db: &crate::database::Database,
    enabled: bool,
) -> Result<bool, String> {
    crate::services::codex_session_compression::set_enabled(db, enabled).map_err(|e| e.to_string())
}

/// Codex 会话目录（sessions + archived_sessions）当前占用的字节数。
pub fn get_codex_sessions_disk_usage_internal() -> u64 {
    crate::services::codex_session_compression::sessions_disk_usage()
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUnifyHistoryRestoreResult {
    pub restored_jsonl_files: usize,
    pub restored_state_rows: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<String>,
}

pub fn has_codex_unify_history_backup_internal() -> bool {
    crate::codex_history_migration::has_codex_official_history_backup()
}

pub fn restore_codex_unified_history_internal() -> Result<CodexUnifyHistoryRestoreResult, String> {
    let outcome = crate::codex_history_migration::restore_codex_official_history()
        .map_err(|error| error.to_string())?;
    Ok(CodexUnifyHistoryRestoreResult {
        restored_jsonl_files: outcome.restored_jsonl_files,
        restored_state_rows: outcome.restored_state_rows,
        skipped_reason: outcome.skipped_reason,
    })
}

/// 获取 app_config_dir 覆盖配置 (从 Store)
pub fn get_app_config_dir_override_internal() -> Result<Option<String>, String> {
    Ok(
        crate::app_store::refresh_app_config_dir_override()
            .map(|p| p.to_string_lossy().to_string()),
    )
}

/// 获取当前生效的 app_config_dir
pub fn get_app_config_dir_internal() -> Result<String, String> {
    Ok(crate::config::get_app_config_dir()
        .to_string_lossy()
        .to_string())
}

/// 获取默认 app_config_dir（不读取 override）
pub fn get_default_app_config_dir_internal() -> Result<String, String> {
    Ok(crate::config::get_default_app_config_dir()
        .to_string_lossy()
        .to_string())
}

/// 设置 app_config_dir 覆盖配置 (到 Store)
pub fn set_app_config_dir_override_internal(path: Option<String>) -> Result<bool, String> {
    crate::app_store::set_app_config_dir_override(path.as_deref())?;
    Ok(true)
}

pub fn set_auto_launch_internal(enabled: bool) -> Result<bool, String> {
    if enabled {
        crate::auto_launch::enable_auto_launch().map_err(|e| format!("启用开机自启失败: {e}"))?;
    } else {
        crate::auto_launch::disable_auto_launch().map_err(|e| format!("禁用开机自启失败: {e}"))?;
    }
    Ok(true)
}

pub fn get_auto_launch_status_internal() -> Result<bool, String> {
    crate::auto_launch::is_auto_launch_enabled().map_err(|e| format!("获取开机自启状态失败: {e}"))
}

pub fn apply_claude_plugin_config_internal(official: bool) -> Result<bool, String> {
    if official {
        crate::claude_plugin::clear_claude_config().map_err(|e| e.to_string())
    } else {
        crate::claude_plugin::write_claude_config().map_err(|e| e.to_string())
    }
}

pub fn apply_claude_onboarding_skip_internal() -> Result<bool, String> {
    crate::claude_mcp::set_has_completed_onboarding().map_err(|e| e.to_string())
}

pub fn clear_claude_onboarding_skip_internal() -> Result<bool, String> {
    crate::claude_mcp::clear_has_completed_onboarding().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::merge_settings_for_save;
    use crate::settings::{
        AppSettings, CodexOfficialHistoryUnifyMigration, LocalMigrations, WebDavSyncSettings,
    };

    #[test]
    fn unify_migration_finished_payload_reports_counts_or_error_but_not_skips() {
        use super::codex_unify_migration_finished_payload as payload;
        use crate::codex_history_migration::MigrationOutcome;

        let done = Ok(MigrationOutcome {
            migrated_jsonl_files: 4,
            migrated_state_rows: 3,
            skipped_reason: None,
        });
        assert_eq!(
            payload(&done),
            Some(serde_json::json!({
                "migratedStateRows": 3,
                "migratedJsonlFiles": 4,
                "error": null,
            }))
        );

        let failed = Err(crate::error::AppError::Message("disk full".to_string()));
        let failed = payload(&failed).expect("failure is reported");
        assert_eq!(failed["migratedStateRows"], 0);
        assert!(failed["error"].as_str().unwrap().contains("disk full"));

        // 跳过（开关关着、没勾选迁入、没东西可迁）时不提示。
        let skipped = Ok(MigrationOutcome {
            skipped_reason: Some("nothing_to_migrate".to_string()),
            ..Default::default()
        });
        assert_eq!(payload(&skipped), None);
    }

    #[test]
    fn save_settings_should_keep_the_existing_proxy_client_host() {
        let existing = AppSettings {
            proxy_client_host: Some("172.25.144.1".to_string()),
            ..AppSettings::default()
        };

        let merged = merge_settings_for_save(AppSettings::default(), &existing);

        assert_eq!(merged.proxy_client_host.as_deref(), Some("172.25.144.1"));
    }

    #[test]
    fn save_settings_preserves_backend_migration_marker() {
        let existing = AppSettings {
            local_migrations: Some(LocalMigrations {
                codex_official_history_unify_v1: Some(CodexOfficialHistoryUnifyMigration {
                    completed_at: "2026-07-30T00:00:00Z".to_string(),
                    target_provider_id: "custom".to_string(),
                    migrated_jsonl_files: 2,
                    migrated_state_rows: 3,
                    codex_config_dir: Some("C:/Users/test/.codex".to_string()),
                }),
                ..LocalMigrations::default()
            }),
            ..AppSettings::default()
        };
        let incoming = AppSettings {
            local_migrations: Some(LocalMigrations::default()),
            ..AppSettings::default()
        };

        let merged = merge_settings_for_save(incoming, &existing);

        assert_eq!(
            merged
                .local_migrations
                .and_then(|migrations| migrations.codex_official_history_unify_v1)
                .map(|migration| migration.migrated_state_rows),
            Some(3)
        );
    }

    #[test]
    fn save_settings_should_preserve_existing_webdav_when_payload_omits_it() {
        let mut existing = AppSettings::default();
        existing.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.example.com".to_string(),
            username: "alice".to_string(),
            password: "secret".to_string(),
            ..WebDavSyncSettings::default()
        });

        let incoming = AppSettings::default();
        let merged = merge_settings_for_save(incoming, &existing);

        assert!(merged.webdav_sync.is_some());
        assert_eq!(
            merged.webdav_sync.as_ref().map(|v| v.base_url.as_str()),
            Some("https://dav.example.com")
        );
    }

    #[test]
    fn save_settings_should_keep_incoming_webdav_when_present() {
        let mut existing = AppSettings::default();
        existing.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.old.example.com".to_string(),
            username: "old".to_string(),
            password: "old-pass".to_string(),
            ..WebDavSyncSettings::default()
        });

        let mut incoming = AppSettings::default();
        incoming.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.new.example.com".to_string(),
            username: "new".to_string(),
            password: "new-pass".to_string(),
            ..WebDavSyncSettings::default()
        });

        let merged = merge_settings_for_save(incoming, &existing);

        assert_eq!(
            merged.webdav_sync.as_ref().map(|v| v.base_url.as_str()),
            Some("https://dav.new.example.com")
        );
    }

    /// Regression test: frontend always receives empty password from
    /// get_settings_for_frontend(). If a component accidentally spreads
    /// the full settings object into save_settings, the empty password
    /// must NOT overwrite the existing one.
    #[test]
    fn save_settings_should_preserve_password_when_incoming_has_empty_password() {
        let mut existing = AppSettings::default();
        existing.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.example.com".to_string(),
            username: "alice".to_string(),
            password: "secret".to_string(),
            ..WebDavSyncSettings::default()
        });

        // Simulate frontend sending settings with cleared password
        let mut incoming = AppSettings::default();
        incoming.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.example.com".to_string(),
            username: "alice".to_string(),
            password: "".to_string(),
            ..WebDavSyncSettings::default()
        });

        let merged = merge_settings_for_save(incoming, &existing);

        assert_eq!(
            merged.webdav_sync.as_ref().map(|v| v.password.as_str()),
            Some("secret"),
            "empty password from frontend must not overwrite existing password"
        );
    }

    /// When both incoming and existing have no password, merge should
    /// work without panicking and keep the empty state.
    #[test]
    fn save_settings_should_handle_both_empty_passwords() {
        let mut existing = AppSettings::default();
        existing.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.example.com".to_string(),
            username: "alice".to_string(),
            password: "".to_string(),
            ..WebDavSyncSettings::default()
        });

        let mut incoming = AppSettings::default();
        incoming.webdav_sync = Some(WebDavSyncSettings {
            base_url: "https://dav.example.com".to_string(),
            username: "alice".to_string(),
            password: "".to_string(),
            ..WebDavSyncSettings::default()
        });

        let merged = merge_settings_for_save(incoming, &existing);

        assert_eq!(
            merged.webdav_sync.as_ref().map(|v| v.password.as_str()),
            Some("")
        );
    }
}

/// 获取整流器配置
pub fn get_rectifier_config_internal(
    state: &crate::store::AppState,
) -> Result<crate::proxy::types::RectifierConfig, String> {
    state.db.get_rectifier_config().map_err(|e| e.to_string())
}

pub fn set_rectifier_config_internal(
    state: &crate::store::AppState,
    config: crate::proxy::types::RectifierConfig,
) -> Result<bool, String> {
    state
        .db
        .set_rectifier_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取优化器配置
pub fn get_optimizer_config_internal(
    state: &crate::store::AppState,
) -> Result<crate::proxy::types::OptimizerConfig, String> {
    state.db.get_optimizer_config().map_err(|e| e.to_string())
}

pub fn set_optimizer_config_internal(
    state: &crate::store::AppState,
    config: crate::proxy::types::OptimizerConfig,
) -> Result<bool, String> {
    // Validate cache_ttl: only allow known values
    match config.cache_ttl.as_str() {
        "5m" | "1h" => {}
        other => {
            return Err(format!(
                "Invalid cache_ttl value: '{other}'. Allowed values: '5m', '1h'"
            ))
        }
    }
    state
        .db
        .set_optimizer_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取隐私过滤器配置
pub fn get_privacy_filter_config_internal(
    state: &crate::store::AppState,
) -> Result<crate::proxy::types::PrivacyFilterConfig, String> {
    state
        .db
        .get_privacy_filter_config()
        .map_err(|e| e.to_string())
}

/// 设置隐私过滤器配置
pub fn set_privacy_filter_config_internal(
    state: &crate::store::AppState,
    config: crate::proxy::types::PrivacyFilterConfig,
) -> Result<bool, String> {
    state
        .db
        .set_privacy_filter_config(&config)
        .map_err(|e| e.to_string())?;
    if config.enabled {
        // 规则编译有一次性耗时，开关打开时在后台预热，不压到第一个请求上
        std::thread::spawn(crate::proxy::privacy_filter::warm_up);
    }
    Ok(true)
}

/// 获取日志配置
pub fn get_log_config_internal(
    state: &crate::store::AppState,
) -> Result<crate::proxy::types::LogConfig, String> {
    state.db.get_log_config().map_err(|e| e.to_string())
}

pub fn set_log_config_internal(
    state: &crate::store::AppState,
    config: crate::proxy::types::LogConfig,
) -> Result<bool, String> {
    state
        .db
        .set_log_config(&config)
        .map_err(|e| e.to_string())?;
    log::set_max_level(config.to_level_filter());
    log::info!(
        "日志配置已更新: enabled={}, level={}",
        config.enabled,
        config.level
    );
    Ok(true)
}
