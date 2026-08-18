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
    crate::settings::update_settings(merged).map_err(|e| e.to_string())?;
    if unify_changed {
        if let Err(error) = crate::services::provider::reapply_current_codex_official_live(state) {
            let _ = crate::settings::update_settings(existing);
            let _ = crate::services::provider::reapply_current_codex_official_live(state);
            return Err(format!("统一 Codex 会话历史设置未生效: {error}"));
        }
        if unify_enabled {
            tokio::task::spawn_blocking(|| {
                if let Err(error) =
                    crate::codex_history_migration::maybe_migrate_codex_official_history()
                {
                    log::warn!("Codex 官方历史迁移失败，将在下次启动重试: {error}");
                }
            });
        } else if let Err(error) = crate::settings::clear_codex_official_history_unify_state() {
            log::warn!("清理 Codex 官方历史迁移状态失败: {error}");
        }
    }
    Ok(true)
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
