//! Provider service module
//!
//! Handles provider CRUD operations, switching, and configuration management.

pub(crate) mod agy_direct;
pub(crate) mod claude_direct;
pub(crate) mod claude_editor;
pub(crate) use claude_editor::{switch_drops as claude_switch_drops, SwitchDrops};
pub(crate) mod claude_official;
pub(crate) mod codex_client_catalog;
pub(crate) mod codex_direct;
pub(crate) mod codex_editor;
mod codex_login;
pub(crate) mod codex_official_models;
#[cfg(test)]
mod codex_runtime_tests;
pub(crate) mod codex_terminal;
#[cfg(test)]
mod common_config_tests;
pub(crate) mod copilot_direct;
#[cfg(test)]
mod copilot_tests;
mod desktop;
#[cfg(test)]
mod desktop_tests;
#[cfg(test)]
mod dsh_tests;
pub(crate) mod editor_toml;
mod endpoints;
mod gemini_auth;
pub(crate) mod gemini_direct;
pub(crate) mod gemini_editor;
pub(crate) mod grok_direct;
pub(crate) mod grok_editor;
pub(crate) mod icon;
#[cfg(test)]
mod kimi_tests;
mod live;
#[cfg(test)]
mod mcode_tests;
mod omp;
#[cfg(test)]
mod opencode_tests;
mod pi;
mod usage;

use indexmap::IndexMap;
#[cfg(test)]
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::{Provider, UsageResult};
use crate::services::mcp::McpService;
use crate::services::omo::OmoService;
use crate::settings::CustomEndpoint;
use crate::store::AppState;

// Re-export sub-module functions for external access
pub use live::{
    import_default_config, import_hermes_providers_from_live, import_openclaw_providers_from_live,
    import_opencode_providers_from_live, read_live_settings, sync_current_to_live,
    update_toml_common_config_snippet,
};

pub fn import_pi_providers_from_live(state: &AppState) -> Result<usize, AppError> {
    pi::import_from_live(state)
}

pub fn import_omp_providers_from_live(state: &AppState) -> Result<usize, AppError> {
    omp::import_from_live(state)
}

// Internal re-exports (pub(crate))
#[cfg(test)]
pub(crate) use live::initialize_dsh_profiles;
pub(crate) use live::{
    build_effective_settings_with_common_config, normalize_provider_common_config_for_storage,
    provider_exists_in_live_config, strip_common_config_from_live_settings,
    sync_current_provider_for_app_to_live, write_live_with_common_config,
};

// Internal re-exports
use live::{
    remove_hermes_provider_from_live, remove_openclaw_provider_from_live,
    remove_opencode_provider_from_live,
};
use usage::validate_usage_script;

/// Provider business logic service
pub struct ProviderService;

/// Copilot 官方卡只用来打开终端，不能添加进 providers.json。
fn copilot_official_not_added() -> AppError {
    AppError::localized(
        "copilot.switch.unsupported",
        "GitHub Copilot CLI 的官方卡片不需要启用，用「打开终端」启动即可",
        "GitHub Copilot CLI official cards are not enabled; use Open terminal to start one",
    )
}

/// Result of a provider switch operation, including any non-fatal warnings
#[derive(Debug, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub warnings: Vec<String>,
    /// 这次选的是本地路由的目标时才有：实际生效的是什么、客户端文件有没有改写。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<crate::mode::controller::RouteSwitchResult>,
    /// Codex only: this switch moved new sessions to the other history bucket
    /// while unified history is off, so newer Codex locks the old bucket.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_history_split: Option<crate::codex_history_migration::CodexHistorySplitHint>,
}

/// Claude Desktop 直连模式下用不了要经路由的卡。
pub(crate) fn desktop_needs_routing_error() -> AppError {
    AppError::localized(
        "switch.desktop_needs_routing",
        "这个供应商要经本地路由才能用（模型映射或托管账号），请先把 Claude Desktop 切到路由模式",
        "This provider only works through local routing (model mapping or a managed account); switch Claude Desktop to the routing mode first",
    )
}

/// 官方供应商通常禁止代理接管；Codex 固定内置条目是唯一例外。
pub fn official_provider_supports_proxy_takeover(app_type: &AppType, provider: &Provider) -> bool {
    matches!(app_type, AppType::Codex)
        && crate::proxy::providers::is_codex_official_provider(provider)
}

/// 统一会话开关变化后，立即刷新当前官方 Codex 的 live 或代理恢复备份。
pub fn reapply_current_codex_official_live(state: &AppState) -> Result<bool, AppError> {
    let _service = futures::executor::block_on(crate::mode::controller::lock_service());
    let _app = futures::executor::block_on(state.proxy_service.lock_switch_for_app("codex"));
    crate::mode::operation::settle(&state.db, "codex")?;
    if futures::executor::block_on(crate::mode::controller::reapply_after_save_locked(
        state,
        &AppType::Codex,
        None,
    ))? {
        return Ok(true);
    }
    if crate::mode::current::is_proxy(&AppType::Codex) {
        return Ok(false);
    }
    let Some(current_id) =
        crate::settings::get_effective_current_provider(&state.db, &AppType::Codex)?
    else {
        return Ok(false);
    };
    let Some(provider) = state
        .db
        .get_provider_by_id(&current_id, AppType::Codex.as_str())?
    else {
        return Ok(false);
    };
    if !crate::proxy::providers::is_codex_official_provider(&provider) {
        return Ok(false);
    }

    if sync_live_for_provider_respecting_takeover(state, &AppType::Codex, &provider)? {
        McpService::sync_enabled_for_app(state, &AppType::Codex)?;
    }
    Ok(true)
}

/// 本地代理当前是否持有该应用的 live 文件，返回 (是否接管, 是否存在备份)（上游 926af949）。
///
/// 单独一条备份记录不是接管证据：崩溃或恢复失败都会留下残留备份；中断的
/// 关闭流程留下的 enabled 标志同样不能单独阻止真实的 live 写入。live 中存在
/// 接管占位符即为接管；否则仅在 enabled、仍有备份且代理进程确实在运行时才视为
/// 接管。Web 端的更新 / 重投影调用方已持有该应用的切换锁，接管激活不可能与之
/// 并发，因此不需要上游的“切换进行中”判定。
pub(crate) fn proxy_owns_live_config(state: &AppState, app_type: &AppType) -> (bool, bool) {
    let mode = crate::mode::current::mode_state(app_type);
    if mode.mode.is_some() {
        return (mode.is_proxy(), false);
    }
    let has_live_backup =
        match futures::executor::block_on(state.db.get_live_backup(app_type.as_str())) {
            Ok(backup) => backup.is_some(),
            Err(err) => {
                log::warn!(
                    "读取 {} Live 备份失败，按无备份处理并继续写入 live 配置: {err}",
                    app_type.as_str()
                );
                false
            }
        };
    if state
        .proxy_service
        .detect_takeover_in_live_config_for_app(app_type)
    {
        return (true, has_live_backup);
    }
    if !has_live_backup {
        return (false, false);
    }
    let takeover_enabled =
        match futures::executor::block_on(state.db.get_proxy_config_for_app(app_type.as_str())) {
            Ok(config) => config.enabled,
            Err(err) => {
                log::warn!(
                    "读取 {} 代理接管标志失败，按未接管处理并继续写入 live 配置: {err}",
                    app_type.as_str()
                );
                false
            }
        };
    let owned = takeover_enabled && futures::executor::block_on(state.proxy_service.is_running());
    (owned, true)
}

fn refresh_stale_live_backup(state: &AppState, app_type: &AppType, provider: &Provider) {
    if let Err(err) = futures::executor::block_on(
        crate::services::proxy::ProxyService::update_live_backup_from_provider_for_db(
            state.db.as_ref(),
            app_type.as_str(),
            provider,
        ),
    ) {
        log::warn!(
            "刷新 {} 残留 Live 备份失败（不影响本次 live 写入）: {err}",
            app_type.as_str()
        );
    }
}

/// 按接管归属同步 Provider 到 live：未接管时写 live，并让残留备份跟随最新配置
/// （否则之后的恢复会把旧地址写回、撤销本次 live 写入）；接管时只更新恢复源。
/// 返回是否写入了 live。
pub(crate) fn sync_live_for_provider_respecting_takeover(
    state: &AppState,
    app_type: &AppType,
    provider: &Provider,
) -> Result<bool, AppError> {
    if *app_type == AppType::ClaudeDesktop {
        // 路由模式下 Desktop 的配置文件归路由那家（指向本地路由的 profile），直连那家不写；
        // 要经路由的卡直连写不进去。
        if crate::mode::current::is_proxy(app_type)
            || crate::claude_desktop_config::needs_routing(provider)
        {
            return Ok(false);
        }
        crate::claude_desktop_config::apply_provider(state.db.as_ref(), provider)?;
        return Ok(true);
    }
    let (owned, has_live_backup) = proxy_owns_live_config(state, app_type);
    if owned {
        futures::executor::block_on(
            crate::services::proxy::ProxyService::update_live_backup_from_provider_for_db(
                state.db.as_ref(),
                app_type.as_str(),
                provider,
            ),
        )
        .map_err(|e| AppError::Message(format!("更新 Live 备份失败: {e}")))?;
        return Ok(false);
    }
    if has_live_backup {
        refresh_stale_live_backup(state, app_type, provider);
    }
    if *app_type == AppType::Codex {
        crate::mode::operation::settle(&state.db, "codex")?;
        let previous = codex_direct::current_provider(&state.db)?;
        codex_direct::write_direct(state, previous.as_ref(), provider, false, None)?;
    } else {
        write_live_with_common_config(state.db.as_ref(), app_type, provider)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;

    struct TestHome {
        previous: Option<std::ffi::OsString>,
        _dir: tempfile::TempDir,
    }

    impl TestHome {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("temp home");
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
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
        }
    }

    #[test]
    #[serial]
    fn universal_provider_icon_is_validated_on_save_and_sync() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(crate::database::Database::memory().expect("memory db"));
        let state = AppState::new(db.clone());
        let mut universal = crate::provider::UniversalProvider::new(
            "icon".into(),
            "Icon".into(),
            "custom".into(),
            "https://api.example".into(),
            "key".into(),
        );
        universal.apps.claude = true;
        // 只有文件头、没有像素数据的「PNG」
        universal.icon =
            Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAAA=".into());
        assert!(ProviderService::upsert_universal(&state, universal.clone()).is_err());
        assert!(state.db.get_universal_provider("icon").unwrap().is_none());

        // 绕过保存直接写进库的坏图标，同步到应用时也不会复制给子供应商
        state.db.save_universal_provider(&universal).unwrap();
        assert!(ProviderService::sync_universal_to_apps(&state, "icon").is_err());
        assert!(state
            .db
            .get_provider_by_id("universal-claude-icon", "claude")
            .unwrap()
            .is_none());
    }

    #[test]
    #[serial]
    fn sync_universal_to_apps_preserves_child_metadata() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(crate::database::Database::memory().expect("memory db"));
        let state = AppState::new(db.clone());
        let mut universal = crate::provider::UniversalProvider::new(
            "metadata".into(),
            "Original".into(),
            "custom".into(),
            "https://old.example".into(),
            "old-key".into(),
        );
        universal.apps.claude = true;
        universal.apps.codex = true;
        universal.apps.gemini = true;
        universal.meta = Some(
            serde_json::from_value(json!({
                "usage_script": {"enabled": false, "language": "javascript", "code": "parent"}
            }))
            .unwrap(),
        );
        state.db.save_universal_provider(&universal).unwrap();
        ProviderService::sync_universal_to_apps(&state, &universal.id).unwrap();

        let mut expected = Vec::new();
        for (index, app) in ["claude", "codex", "gemini"].iter().enumerate() {
            let id = format!("universal-{app}-metadata");
            let mut child = state.db.get_provider_by_id(&id, app).unwrap().unwrap();
            assert_eq!(
                serde_json::to_value(&child.meta).unwrap(),
                serde_json::to_value(&universal.meta).unwrap()
            );
            child.meta = Some(
                serde_json::from_value(json!({
                    "usage_script": {"enabled": true, "language": "javascript", "code": app,
                        "apiKey": "usage-only-key", "autoQueryInterval": 15},
                    "commonConfigEnabled": false,
                    "endpointAutoSelect": true
                }))
                .unwrap(),
            );
            child.created_at = Some(123 + index as i64);
            child.sort_index = Some(10 + index);
            child.settings_config["local_setting"] = json!(app);
            state.db.save_provider(app, &child).unwrap();
            expected.push(child);
        }

        universal.name = "Updated".into();
        universal.base_url = "https://new.example".into();
        universal.api_key = "new-key".into();
        // 父级 meta 缺失或存在都不能覆盖子供应商设置。
        for parent_meta in [None, universal.meta.clone()] {
            universal.meta = parent_meta;
            state.db.save_universal_provider(&universal).unwrap();
            ProviderService::sync_universal_to_apps(&state, &universal.id).unwrap();
            for (app, before) in ["claude", "codex", "gemini"].iter().zip(&expected) {
                let after = state
                    .db
                    .get_provider_by_id(&before.id, app)
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    serde_json::to_value(&after.meta).unwrap(),
                    serde_json::to_value(&before.meta).unwrap(),
                    "{app}"
                );
                assert_eq!(after.created_at, before.created_at, "{app}");
                assert_eq!(after.sort_index, before.sort_index, "{app}");
                assert_eq!(after.name, "Updated");
                assert_eq!(after.settings_config["local_setting"], json!(app));
            }
        }
    }

    // ---- 上游 926af949 回归测试：更新当前 Provider 必须投影到 live ----

    /// Saving the active provider while takeover has never been enabled must
    /// rewrite the real live file immediately.
    #[tokio::test]
    #[serial]
    async fn update_current_claude_provider_writes_live_when_proxy_never_enabled() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");

        let db = std::sync::Arc::new(crate::database::Database::memory().expect("init db"));
        let state = AppState::new(db.clone());
        let original = Provider::with_id(
            "p1".into(),
            "Claude A".into(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "token-a",
                    "ANTHROPIC_BASE_URL": "https://api.old.example"
                }
            }),
            None,
        );
        db.save_provider("claude", &original)
            .expect("save provider");
        db.set_current_provider("claude", "p1")
            .expect("set current provider");
        crate::settings::set_current_provider(&AppType::Claude, Some("p1"))
            .expect("set local current provider");
        write_live_with_common_config(state.db.as_ref(), &AppType::Claude, &original)
            .expect("seed live file");

        let mut updated = original.clone();
        updated.settings_config["env"]["ANTHROPIC_BASE_URL"] =
            serde_json::Value::String("https://api.new.example".into());
        ProviderService::update(&state, AppType::Claude, None, updated)
            .expect("update current provider");

        let live: serde_json::Value =
            crate::config::read_json_file(&crate::config::get_claude_settings_path())
                .expect("read live");
        assert_eq!(
            live["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://api.new.example")
        );
    }

    /// A stale backup row must be refreshed but must not divert the live write.
    #[tokio::test]
    #[serial]
    async fn update_current_claude_provider_writes_live_when_backup_row_is_stale() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");

        let db = std::sync::Arc::new(crate::database::Database::memory().expect("init db"));
        let state = AppState::new(db.clone());
        let original = Provider::with_id(
            "p1".into(),
            "Claude A".into(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "token-a",
                    "ANTHROPIC_BASE_URL": "https://api.old.example"
                }
            }),
            None,
        );
        db.save_provider("claude", &original)
            .expect("save provider");
        db.set_current_provider("claude", "p1")
            .expect("set current provider");
        crate::settings::set_current_provider(&AppType::Claude, Some("p1"))
            .expect("set local current provider");
        write_live_with_common_config(state.db.as_ref(), &AppType::Claude, &original)
            .expect("seed live file");
        db.save_live_backup(
            "claude",
            &serde_json::to_string(&original.settings_config).expect("serialize backup"),
        )
        .await
        .expect("seed stale backup");
        assert!(!state.proxy_service.is_running().await);

        let mut updated = original.clone();
        updated.settings_config["env"]["ANTHROPIC_BASE_URL"] =
            serde_json::Value::String("https://api.new.example".into());
        ProviderService::update(&state, AppType::Claude, None, updated)
            .expect("update current provider");

        let live: serde_json::Value =
            crate::config::read_json_file(&crate::config::get_claude_settings_path())
                .expect("read live");
        assert_eq!(
            live["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://api.new.example")
        );
        let backup = db
            .get_live_backup("claude")
            .await
            .expect("read backup")
            .expect("backup remains");
        assert!(backup.original_config.contains("https://api.new.example"));
    }

    /// An enabled flag left behind by an interrupted teardown is not enough to
    /// suppress a live write when neither placeholder nor backup evidence exists.
    #[tokio::test]
    #[serial]
    async fn update_current_claude_provider_ignores_enabled_flag_without_evidence() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");

        let db = std::sync::Arc::new(crate::database::Database::memory().expect("init db"));
        let state = AppState::new(db.clone());
        let original = Provider::with_id(
            "p1".into(),
            "Claude A".into(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "token-a",
                    "ANTHROPIC_BASE_URL": "https://api.old.example"
                }
            }),
            None,
        );
        db.save_provider("claude", &original)
            .expect("save provider");
        db.set_current_provider("claude", "p1")
            .expect("set current provider");
        crate::settings::set_current_provider(&AppType::Claude, Some("p1"))
            .expect("set local current provider");
        write_live_with_common_config(state.db.as_ref(), &AppType::Claude, &original)
            .expect("seed live file");
        let mut config = db
            .get_proxy_config_for_app("claude")
            .await
            .expect("read proxy config");
        config.enabled = true;
        db.update_proxy_config_for_app(config)
            .await
            .expect("leave enabled flag set");
        assert!(!state.proxy_service.is_running().await);

        let mut updated = original.clone();
        updated.settings_config["env"]["ANTHROPIC_BASE_URL"] =
            serde_json::Value::String("https://api.new.example".into());
        ProviderService::update(&state, AppType::Claude, None, updated)
            .expect("update current provider");

        let live: serde_json::Value =
            crate::config::read_json_file(&crate::config::get_claude_settings_path())
                .expect("read live");
        assert_eq!(
            live["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://api.new.example")
        );
    }

    #[test]
    #[serial]
    fn sync_universal_to_apps_reprojects_current_child_to_live() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(crate::database::Database::memory().expect("memory db"));
        let owned_state = AppState::new(db);
        let state = &owned_state;
        {
            let mut universal = crate::provider::UniversalProvider::new(
                "shared".to_string(),
                "Shared Relay".to_string(),
                "custom".to_string(),
                "https://api.new.example".to_string(),
                "new-key".to_string(),
            );
            universal.apps.claude = true;
            universal.models.claude = Some(crate::provider::ClaudeModelConfig {
                model: Some("claude-sonnet-4".to_string()),
                ..Default::default()
            });
            state
                .db
                .save_universal_provider(&universal)
                .expect("save universal provider");

            let child = universal
                .to_claude_provider()
                .expect("claude child provider");
            state
                .db
                .save_provider("claude", &child)
                .expect("seed child provider");
            state
                .db
                .set_current_provider("claude", &child.id)
                .expect("set current child");
            crate::settings::set_current_provider(&AppType::Claude, Some(&child.id))
                .expect("set local current child");

            let mut old_live = child.settings_config.clone();
            old_live["env"]["ANTHROPIC_BASE_URL"] =
                serde_json::Value::String("https://api.old.example".to_string());
            crate::config::write_json_file(&crate::config::get_claude_settings_path(), &old_live)
                .expect("seed old live");

            ProviderService::sync_universal_to_apps(state, "shared")
                .expect("sync universal provider");

            let live: serde_json::Value =
                crate::config::read_json_file(&crate::config::get_claude_settings_path())
                    .expect("read live");
            assert_eq!(
                live["env"]["ANTHROPIC_BASE_URL"].as_str(),
                Some("https://api.new.example")
            );
            assert_eq!(
                live["env"]["ANTHROPIC_AUTH_TOKEN"].as_str(),
                Some("new-key")
            );
        }
    }

    #[test]
    fn validate_provider_settings_rejects_missing_auth() {
        let provider = Provider::with_id(
            "codex".into(),
            "Codex".into(),
            json!({ "config": "base_url = \"https://example.com\"" }),
            None,
        );
        let err = ProviderService::validate_provider_settings(&AppType::Codex, &provider)
            .expect_err("missing auth should be rejected");
        assert!(
            err.to_string().contains("auth"),
            "expected auth error, got {err:?}"
        );
    }

    #[test]
    fn extract_credentials_returns_expected_values() {
        let provider = Provider::with_id(
            "claude".into(),
            "Claude".into(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "token",
                    "ANTHROPIC_BASE_URL": "https://claude.example"
                }
            }),
            None,
        );
        let (api_key, base_url) =
            ProviderService::extract_credentials(&provider, &AppType::Claude).unwrap();
        assert_eq!(api_key, "token");
        assert_eq!(base_url, "https://claude.example");
    }

    #[test]
    #[serial]
    fn grokbuild_provider_crud_accepts_custom_and_official_configs() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(
            crate::database::Database::memory().expect("create in-memory database"),
        );
        let state = AppState::new(db);
        let custom = Provider::with_id(
            "grok-custom".into(),
            "Grok Custom".into(),
            json!({
                "config": r#"[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://example.com/v1"
name = "Example"
api_key = "secret"
api_backend = "responses"
context_window = 500000
"#
            }),
            None,
        );
        ProviderService::add(&state, AppType::GrokBuild, custom, true)
            .expect("add custom provider");

        let mut official = Provider::with_id(
            "grokbuild-official".into(),
            "Grok Official".into(),
            json!({ "config": "" }),
            None,
        );
        official.category = Some("official".into());
        ProviderService::add(&state, AppType::GrokBuild, official, true)
            .expect("add official provider");

        let providers = ProviderService::list(&state, AppType::GrokBuild).unwrap();
        assert!(providers.contains_key("grok-custom"));
        assert!(providers.contains_key("grokbuild-official"));
    }

    #[test]
    fn extract_codex_common_config_removes_provider_and_mcp_sections() {
        let config_toml = r#"model_provider = "azure"
model = "gpt-4"
disable_response_storage = true

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://azure.example/v1"
wire_api = "responses"

[mcp_servers.my_server]
base_url = "http://localhost:8080"
"#;

        let settings = json!({ "config": config_toml });
        let extracted = ProviderService::extract_codex_common_config(&settings)
            .expect("extract_codex_common_config should succeed");

        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model_provider")),
            "should remove top-level model_provider"
        );
        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model =")),
            "should remove top-level model"
        );
        assert!(
            !extracted.contains("[model_providers"),
            "should remove entire model_providers table"
        );
        assert!(!extracted.contains("[mcp_servers"));
        assert!(!extracted.contains("http://localhost:8080"));
    }

    #[test]
    fn codex_live_shared_changes_replace_common_config_on_switch() {
        let db = std::sync::Arc::new(
            crate::database::Database::memory().expect("create in-memory database"),
        );
        db.set_config_snippet(
            AppType::Codex.as_str(),
            Some("approval_policy = \"on-request\"".to_string()),
        )
        .expect("seed snippet");
        let state = AppState::new(db.clone());
        let mut provider = Provider::with_id(
            "codex-source".to_string(),
            "Codex Source".to_string(),
            json!({}),
            None,
        );
        provider.meta = Some(crate::provider::ProviderMeta {
            common_config_enabled: Some(true),
            ..Default::default()
        });
        let live = json!({
            "config": "model = \"gpt-5.6\"\napproval_policy = \"never\"\ndisable_response_storage = false\n\n[model_providers.remote]\nbase_url = \"https://example.com/v1\"\n"
        });
        let mut result = SwitchResult::default();

        ProviderService::sync_common_config_snippet_from_live(
            &state,
            &AppType::Codex,
            &provider,
            &live,
            &mut result,
        );

        let snippet = db
            .get_config_snippet(AppType::Codex.as_str())
            .expect("read snippet")
            .expect("snippet");
        assert!(snippet.contains("approval_policy = \"never\""));
        assert!(!snippet.contains("disable_response_storage"));
        assert!(!snippet.contains("model_providers"));
        assert!(!snippet.contains("https://example.com"));
        assert!(result.warnings.is_empty());
    }

    #[test]
    #[serial]
    fn stopped_routing_with_backup_still_uses_hot_switch() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(
            crate::database::Database::memory().expect("create in-memory database"),
        );
        let state = AppState::new(db.clone());
        let provider_a = Provider::with_id(
            "a".to_string(),
            "A".to_string(),
            json!({ "env": { "ANTHROPIC_AUTH_TOKEN": "token-a" } }),
            None,
        );
        let provider_b = Provider::with_id(
            "b".to_string(),
            "B".to_string(),
            json!({ "env": { "ANTHROPIC_AUTH_TOKEN": "token-b" } }),
            None,
        );
        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();
        db.set_current_provider("claude", "a").unwrap();
        crate::settings::set_current_provider(&AppType::Claude, Some("a")).unwrap();
        futures::executor::block_on(db.save_live_backup(
            "claude",
            &serde_json::to_string(&provider_a.settings_config).unwrap(),
        ))
        .unwrap();
        assert!(!futures::executor::block_on(
            state.proxy_service.is_running()
        ));

        ProviderService::switch(&state, AppType::Claude, "b").unwrap();

        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("b")
        );
        let backup = futures::executor::block_on(db.get_live_backup("claude"))
            .unwrap()
            .unwrap();
        let restored: Value = serde_json::from_str(&backup.original_config).unwrap();
        assert_eq!(restored["env"]["ANTHROPIC_AUTH_TOKEN"], "token-b");
    }

    #[test]
    #[serial]
    fn managed_codex_add_and_current_update_write_dynamic_auth() {
        let _home = TestHome::new();
        crate::settings::reload_settings().expect("reload settings");
        let db = std::sync::Arc::new(
            crate::database::Database::memory().expect("create in-memory database"),
        );
        let state = AppState::new(db.clone());
        futures::executor::block_on(async {
            state
                .codex_oauth_state
                .read()
                .await
                .seed_account_for_test("account-one", "access-one", "refresh-one", "id-one")
                .await;
        });

        let mut provider = Provider::with_id(
            "team-follow-login".to_string(),
            "Team Follow Login".to_string(),
            json!({ "auth": {}, "config": "model = \"gpt-5\"\n" }),
            None,
        );
        provider.meta = Some(crate::provider::ProviderMeta {
            auth_binding: Some(crate::provider::AuthBinding {
                source: crate::provider::AuthBindingSource::ManagedAccount,
                auth_provider: Some("codex_oauth".to_string()),
                account_id: Some("account-one".to_string()),
            }),
            ..Default::default()
        });

        ProviderService::add(&state, AppType::Codex, provider.clone(), true).unwrap();
        let first_live: Value =
            crate::config::read_json_file(&crate::codex_config::get_codex_auth_path()).unwrap();
        assert_eq!(first_live["tokens"]["access_token"], "access-one");
        assert_eq!(first_live["tokens"]["refresh_token"], "refresh-one");

        futures::executor::block_on(async {
            state
                .codex_oauth_state
                .read()
                .await
                .seed_account_for_test("account-one", "access-two", "refresh-two", "id-two")
                .await;
        });
        provider.name = "Updated Follow Login".to_string();
        ProviderService::update(&state, AppType::Codex, Some("team-follow-login"), provider)
            .unwrap();

        let updated_live: Value =
            crate::config::read_json_file(&crate::codex_config::get_codex_auth_path()).unwrap();
        assert_eq!(updated_live["tokens"]["access_token"], "access-two");
        assert_eq!(updated_live["tokens"]["refresh_token"], "refresh-two");
        let stored = db
            .get_provider_by_id("team-follow-login", "codex")
            .unwrap()
            .unwrap();
        assert_eq!(stored.settings_config["auth"], json!({}));
    }

    fn managed_codex_provider(id: &str, account_id: &str) -> Provider {
        let mut provider = Provider::with_id(
            id.to_string(),
            id.to_string(),
            json!({ "auth": {}, "config": "model = \"gpt-5\"\n" }),
            None,
        );
        provider.meta = Some(crate::provider::ProviderMeta {
            auth_binding: Some(crate::provider::AuthBinding {
                source: crate::provider::AuthBindingSource::ManagedAccount,
                auth_provider: Some("codex_oauth".to_string()),
                account_id: Some(account_id.to_string()),
            }),
            ..Default::default()
        });
        provider
    }

    /// 上游 15884b20：删除托管账号后重新登录会得到新的本地 ID，旧绑定必须能改绑或切走，
    /// 且失效目标给出“选择账号”指引。
    #[test]
    #[serial]
    fn deleted_codex_account_can_rebind_or_switch_directly() {
        for rebind in [true, false] {
            let _home = TestHome::new();
            crate::settings::reload_settings().expect("reload settings");
            let db = std::sync::Arc::new(crate::database::Database::memory().unwrap());
            let state = AppState::new(db.clone());
            let token = crate::codex_config::test_codex_id_token("same-user");
            futures::executor::block_on(async {
                state
                    .codex_oauth_state
                    .read()
                    .await
                    .add_test_account_with_workspace_and_access_token(
                        "old-local-id",
                        "workspace",
                        "old-access",
                        Some(&token),
                    )
                    .await
                    .unwrap();
            });
            let current = managed_codex_provider("current", "old-local-id");
            state.db.save_provider("codex", &current).unwrap();
            ProviderService::switch(&state, AppType::Codex, &current.id).unwrap();
            let live: Value =
                crate::config::read_json_file(&crate::codex_config::get_codex_auth_path()).unwrap();
            assert_eq!(live["tokens"]["access_token"], "old-access");

            futures::executor::block_on(async {
                let manager = state.codex_oauth_state.read().await;
                manager.remove_account("old-local-id").await.unwrap();
                // 普通登录即便同一用户/workspace 也会生成新的本地 ID。
                manager
                    .add_test_account_with_workspace_and_access_token(
                        "new-local-id",
                        "workspace",
                        "new-access",
                        Some(&token),
                    )
                    .await
                    .unwrap();
            });

            let stale = managed_codex_provider("stale", "old-local-id");
            state.db.save_provider("codex", &stale).unwrap();
            let error = ProviderService::switch(&state, AppType::Codex, &stale.id)
                .unwrap_err()
                .to_string();
            assert!(error.contains("选择账号"), "{error}");
            assert_eq!(
                crate::settings::get_effective_current_provider(&state.db, &AppType::Codex)
                    .unwrap()
                    .as_deref(),
                Some("current")
            );

            let target =
                managed_codex_provider(if rebind { "current" } else { "target" }, "new-local-id");
            if rebind {
                ProviderService::update(&state, AppType::Codex, None, target.clone()).unwrap();
            } else {
                state.db.save_provider("codex", &target).unwrap();
                ProviderService::switch(&state, AppType::Codex, &target.id).unwrap();
            }
            let auth: Value =
                crate::config::read_json_file(&crate::codex_config::get_codex_auth_path()).unwrap();
            assert_eq!(
                auth["tokens"]["access_token"], "new-access",
                "rebind={rebind}"
            );
            assert!(
                crate::codex_config::codex_auth_matches_recorded_managed_oauth(
                    &auth,
                    "new-local-id"
                )
                .unwrap(),
                "rebind={rebind}"
            );
            assert_eq!(
                crate::settings::get_effective_current_provider(&state.db, &AppType::Codex)
                    .unwrap()
                    .as_deref(),
                Some(target.id.as_str())
            );
        }
    }

    /// 上游 15884b20：已删除账号的旧 marker 不能认领之后同一用户的原生登录；
    /// 账号存储损坏时无法证明删除，切换必须中止且不改动 live。
    /// Web 端接管期间不写托管 live auth，此处覆盖直连场景，接管场景见 proxy 测试。
    #[test]
    #[serial]
    fn missing_codex_account_preserves_native_login_but_corrupt_store_blocks_recovery() {
        for corrupt in [false, true] {
            let _home = TestHome::new();
            crate::settings::reload_settings().unwrap();
            crate::settings::update_settings(crate::settings::AppSettings {
                preserve_codex_official_auth_on_switch: true,
                ..Default::default()
            })
            .unwrap();
            let db = std::sync::Arc::new(crate::database::Database::memory().unwrap());
            let state = AppState::new(db.clone());
            futures::executor::block_on(async {
                state
                    .codex_oauth_state
                    .read()
                    .await
                    .add_test_account_with_user_identity("old", "access", "user")
                    .await
                    .unwrap();
            });
            let current = managed_codex_provider("current", "old");
            state.db.save_provider("codex", &current).unwrap();
            ProviderService::switch(&state, AppType::Codex, "current").unwrap();
            let mut auth: Value =
                crate::config::read_json_file(&crate::codex_config::get_codex_auth_path()).unwrap();
            futures::executor::block_on(async {
                state
                    .codex_oauth_state
                    .read()
                    .await
                    .remove_account("old")
                    .await
                    .unwrap();
            });
            // A stale marker must not claim a later native login of the same user.
            auth["tokens"]["refresh_token"] = json!("native-rotated-token");
            crate::config::write_json_file(&crate::codex_config::get_codex_auth_path(), &auth)
                .unwrap();
            crate::codex_config::record_codex_managed_oauth_live_auth(&auth, "old").unwrap();
            if corrupt {
                std::fs::write(
                    crate::config::get_app_config_dir().join("codex_oauth_auth.json"),
                    "{broken",
                )
                .unwrap();
            }
            let restarted = AppState::new(state.db.clone());
            let target = Provider::with_id(
                "target".into(),
                "Third party".into(),
                json!({
                    "auth": { "OPENAI_API_KEY": "sk-target" },
                    "config": "model_provider = \"custom\"\n[model_providers.custom]\nname = \"custom\"\nbase_url = \"https://example.test/v1\"\nwire_api = \"chat\"\n"
                }),
                None,
            );
            state.db.save_provider("codex", &target).unwrap();
            let before = crate::codex_config::CodexLiveStateSnapshot::capture().unwrap();
            let result = ProviderService::switch(&restarted, AppType::Codex, "target");
            if corrupt {
                assert!(result.is_err(), "corrupt store must block recovery");
                assert_eq!(
                    crate::codex_config::CodexLiveStateSnapshot::capture().unwrap(),
                    before
                );
                assert_eq!(
                    state.db.get_current_provider("codex").unwrap().as_deref(),
                    Some("current")
                );
            } else {
                result.unwrap();
                assert!(
                    !crate::codex_config::codex_managed_oauth_live_auth_marker_exists(),
                    "missing account must relinquish ownership"
                );
            }
            assert_eq!(
                crate::config::read_json_file::<Value>(&crate::codex_config::get_codex_auth_path())
                    .unwrap(),
                auth,
                "corrupt={corrupt}"
            );
        }
    }

    /// 上游 06082e18：MiniMax Code 供应商直接读写原生 config.yaml 的 custom_provider，
    /// 列表合并原生条目，删除同时移除原生条目并保留无关配置。
    #[test]
    #[serial]
    fn mcode_provider_add_list_and_delete_use_native_config() {
        let _home = TestHome::new();
        std::env::remove_var("MINIMAX_DATA_DIR");
        std::env::remove_var("MAVIS_DATA_DIR");
        crate::settings::reload_settings().expect("reload settings");
        let state = AppState::new(std::sync::Arc::new(
            crate::database::Database::memory().unwrap(),
        ));
        let config_path = crate::mcode_config::config_path();
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::write(
            &config_path,
            "defaultModel: minimax/MiniMax-M3\ncustom_provider:\n  native:\n    name: Native\n    options:\n      baseURL: https://native.example/v1\n      apiKey: native-key\n    models:\n      m: {}\n",
        )
        .unwrap();

        let provider = Provider::with_id(
            "cc-switch-minimax".into(),
            "MiniMax".into(),
            json!({
                "name": "MiniMax",
                "api": "anthropic-messages",
                "options": {"baseURL": "https://api.minimaxi.com/anthropic", "apiKey": "test-key"},
                "models": {"MiniMax-M3": {}}
            }),
            None,
        );
        ProviderService::add(&state, AppType::Mcode, provider, true).unwrap();
        let native = crate::mcode_config::get_providers().unwrap();
        assert!(native.contains_key("cc-switch-minimax"));
        assert!(native.contains_key("native"));

        let listed = ProviderService::list(&state, AppType::Mcode).unwrap();
        assert_eq!(listed["native"].name, "Native");
        assert_eq!(
            ProviderService::provider_live_config_managed(&listed["native"]),
            Some(true)
        );

        ProviderService::delete(&state, AppType::Mcode, "cc-switch-minimax").unwrap();
        let native = crate::mcode_config::get_providers().unwrap();
        assert!(!native.contains_key("cc-switch-minimax"));
        assert!(native.contains_key("native"));
        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(raw.contains("defaultModel"));
    }

    // 上游 50270d5e：Fable 等角色模型字段不进入 Claude 通用配置。
    /// Regression for issue #4272: Fable tier env keys must not enter the shared
    /// Claude common-config snippet (same class as haiku/sonnet/opus model pins).
    #[test]
    fn retired_snippet_entries_keep_the_current_providers_own_family() {
        let old_snippet = json!({
            "env": {
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "AWS_REGION": "us-west-2",
                "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer x",
                "DISABLE_TELEMETRY": "1"
            },
            "model": "picked",
            "theme": "dark"
        })
        .to_string();
        let retired = |live: Value| -> Value {
            ProviderService::retired_snippet_entries(&AppType::Claude, &old_snippet, &live)
                .map(|text| serde_json::from_str(&text).expect("valid JSON"))
                .unwrap_or(Value::Null)
        };

        assert_eq!(
            retired(json!({ "env": {} })),
            json!({
                "env": {
                    "CLAUDE_CODE_USE_BEDROCK": "1",
                    "AWS_REGION": "us-west-2",
                    "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer x"
                },
                "model": "picked"
            })
        );
        for live in [
            json!({ "env": { "AWS_BEARER_TOKEN_BEDROCK": "k", "ANTHROPIC_MODEL": "arn" } }),
            json!({ "env": { "AWS_ACCESS_KEY_ID": "AKIA", "ANTHROPIC_MODEL": "arn" } }),
            // 旧版 Bedrock API Key 预设把 Key 写在顶层。
            json!({ "env": { "ANTHROPIC_MODEL": "arn" }, "apiKey": "legacy-bedrock-key" }),
        ] {
            assert_eq!(
                retired(live),
                json!({
                    "env": { "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer x" },
                    "model": "picked"
                }),
                "the Bedrock provider keeps its own selector and region"
            );
        }
        assert_eq!(
            ProviderService::retired_snippet_entries(&AppType::Codex, &old_snippet, &json!({})),
            None
        );
    }

    #[test]
    fn extract_gemini_common_config_strips_credentials_keeps_shareable() {
        // Gemini 的共享片段会被 deep-merge 回**其它** Gemini 供应商的 env
        // Web 尚保留切换时合并片段的流程，因此任何凭据都不得进入片段。
        // 之前这里只硬编码跳过 GEMINI_API_KEY/GOOGLE_GEMINI_BASE_URL，而
        // GOOGLE_API_KEY 是 provider.rs 认可的一等 Gemini 凭据 → 会泄露到别的供应商。
        let settings = json!({
            "env": {
                "GEMINI_API_KEY": "g-gem",
                "GOOGLE_API_KEY": "g-legacy-real-key",
                "GOOGLE_GEMINI_BASE_URL": "https://gemini.example",
                "GOOGLE_APPLICATION_CREDENTIALS": "/path/creds.json",
                "SOME_PROXY_AUTH_TOKEN": "tok-proxy",
                // 关键字段归供应商，不能随共享片段带入其他供应商。
                "GEMINI_MODEL": "gemini-2.5-pro",
                "GOOGLE_GENAI_USE_VERTEXAI": "true",
                // 可共享的非机密配置必须保留
                "GEMINI_TIMEOUT_MS": "30000"
            }
        });

        let snippet =
            ProviderService::extract_gemini_common_config(&settings).expect("extract should work");
        let value: Value = serde_json::from_str(&snippet).expect("snippet is valid JSON");

        for leaked in [
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "SOME_PROXY_AUTH_TOKEN",
            "GEMINI_MODEL",
            "GOOGLE_GENAI_USE_VERTEXAI",
        ] {
            assert!(
                value.get(leaked).is_none(),
                "{leaked} must not go into the shared Gemini snippet"
            );
        }
        assert_eq!(
            value.get("GEMINI_TIMEOUT_MS").and_then(|v| v.as_str()),
            Some("30000"),
            "shareable non-secret config must be preserved"
        );
    }

    #[test]
    fn extract_claude_common_config_strips_all_credentials_keeps_shareable() {
        // env 混入多种凭据（Anthropic/OpenRouter/Google/OpenAI/Gemini + AWS/Vertex）
        // 与可共享配置；顶层混入非标准的 apiKey/api_key 凭据与正常设置。
        let settings = json!({
            "env": {
                "ANTHROPIC_API_KEY": "sk-ant",
                "ANTHROPIC_AUTH_TOKEN": "tok-ant",
                "OPENROUTER_API_KEY": "sk-or",
                "GOOGLE_API_KEY": "g-key",
                "OPENAI_API_KEY": "sk-oai",
                "GEMINI_API_KEY": "g-gem",
                "AWS_ACCESS_KEY_ID": "AKIA",
                "AWS_SECRET_ACCESS_KEY": "secret",
                "AWS_SESSION_TOKEN": "sess",
                "GOOGLE_APPLICATION_CREDENTIALS": "/path/creds.json",
                "AWS_BEARER_TOKEN_BEDROCK": "bedrock-tok",
                "ANTHROPIC_BASE_URL": "https://example.com",
                "ANTHROPIC_MODEL": "claude-x",
                "CLAUDE_CODE_SUBAGENT_MODEL": "gpt-5.4-mini",
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "400000",
                "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000",
                // 可共享、非机密配置（复数 _TOKENS 不应被误剥）
                "ENABLE_TOOL_SEARCH": "true",
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "8192"
            },
            "apiKey": "sk-top",
            "api_key": "sk-top2",
            "theme": "dark",
            "includeCoAuthoredBy": false
        });

        let snippet = ProviderService::extract_claude_common_config(&settings)
            .expect("extract should succeed");
        let value: Value = serde_json::from_str(&snippet).expect("snippet is valid JSON");

        // 所有凭据都不得出现在共享片段里
        let env = value.get("env");
        for leaked in [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "OPENROUTER_API_KEY",
            "GOOGLE_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "AWS_BEARER_TOKEN_BEDROCK",
        ] {
            assert!(
                env.and_then(|e| e.get(leaked)).is_none(),
                "credential {leaked} must not leak into common config"
            );
        }
        assert!(
            value.get("apiKey").is_none() && value.get("api_key").is_none(),
            "top-level credentials must be stripped"
        );

        // 端点/模型（provider-specific 非机密）也应剥掉
        assert!(env.and_then(|e| e.get("ANTHROPIC_BASE_URL")).is_none());
        assert!(env.and_then(|e| e.get("ANTHROPIC_MODEL")).is_none());
        assert!(env
            .and_then(|e| e.get("CLAUDE_CODE_SUBAGENT_MODEL"))
            .is_none());
        assert!(env
            .and_then(|e| e.get("CLAUDE_CODE_MAX_CONTEXT_TOKENS"))
            .is_none());
        assert!(env
            .and_then(|e| e.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW"))
            .is_none());

        // 可共享的非机密配置必须保留（含复数 _TOKENS 不被误剥）
        assert_eq!(
            env.and_then(|e| e.get("ENABLE_TOOL_SEARCH"))
                .and_then(|v| v.as_str()),
            Some("true")
        );
        assert_eq!(
            env.and_then(|e| e.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS"))
                .and_then(|v| v.as_str()),
            Some("8192")
        );
        assert_eq!(value.get("theme").and_then(|v| v.as_str()), Some("dark"));
        assert_eq!(value.get("includeCoAuthoredBy"), Some(&json!(false)));
    }

    #[test]
    fn extract_claude_common_config_keeps_key_fields_per_provider() {
        let settings = json!({
            "env": {
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "CLAUDE_CODE_USE_VERTEX": "1",
                "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1",
                "AWS_REGION": "us-west-2",
                "AWS_PROFILE": "work",
                "CLOUD_ML_REGION": "us-east5",
                "VERTEX_REGION_CLAUDE_4_0_OPUS": "europe-west1",
                "ANTHROPIC_VERTEX_PROJECT_ID": "my-project",
                "ANTHROPIC_SMALL_FAST_MODEL": "haiku",
                "CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "1",
                "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1",
                "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
                "DISABLE_TELEMETRY": "1"
            },
            "model": "opus",
            "fallbackModel": "sonnet",
            "apiKeyHelper": "~/bin/key.sh",
            "awsAuthRefresh": "aws sso login",
            "hooks": { "Stop": [] },
            "theme": "dark"
        });

        let snippet = ProviderService::extract_claude_common_config(&settings)
            .expect("extract should succeed");
        let value: Value = serde_json::from_str(&snippet).expect("snippet is valid JSON");

        assert_eq!(
            value,
            json!({
                "env": {
                    "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1",
                    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
                    "DISABLE_TELEMETRY": "1"
                },
                "hooks": { "Stop": [] },
                "theme": "dark"
            })
        );
        assert!(
            snippet.find("CLAUDE_CODE_USE_POWERSHELL_TOOL") < snippet.find("DISABLE_TELEMETRY"),
            "removing keys must not reorder the ones that stay: {snippet}"
        );
    }

    #[test]
    fn extract_codex_common_config_strips_provider_fields_and_injected_artifacts() {
        // 顶层 experimental_bearer_token 模拟无活跃路由时的 fallback 注入；
        // web_search = "disabled" 是 cc-switch 对黑名单网关注入的哨兵；
        // 顶层 wire_api 模拟无 model_provider 时的 fallback 写法；
        // [mcp.servers] 是历史错误格式，sync_all_enabled 清不掉它。
        let config_toml = r#"model_provider = "azure"
model = "gpt-4"
wire_api = "chat"
disable_response_storage = true
model_reasoning_effort = "high"
approval_policy = "on-request"
experimental_bearer_token = "sk-live-secret"
model_catalog_json = "cc-switch-model-catalog.json"
web_search = "disabled"

[agents]
default_subagent_model = "gpt-4-mini"
max_threads = 4

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://azure.example/v1"
wire_api = "responses"

[mcp_servers.my_server]
base_url = "http://localhost:8080"

[mcp.servers.legacy_server]
command = "legacy-cmd"
"#;

        let settings = json!({ "config": config_toml });
        let extracted = ProviderService::extract_codex_common_config(&settings)
            .expect("extract_codex_common_config should succeed");

        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model_provider")),
            "should remove top-level model_provider"
        );
        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model =")),
            "should remove top-level model"
        );
        assert!(
            !extracted.contains("[model_providers"),
            "should remove entire model_providers table"
        );
        // MCP 归 DB mcp_servers 表所有，不得进共享片段（含历史错误格式 [mcp.servers]）
        assert!(
            !extracted.contains("mcp_servers") && !extracted.contains("http://localhost:8080"),
            "should strip mcp_servers from the shared snippet, got: {extracted}"
        );
        assert!(
            !extracted.contains("[mcp") && !extracted.contains("legacy-cmd"),
            "should strip the legacy [mcp.servers] form from the shared snippet, got: {extracted}"
        );
        // 顶层 wire_api 是供应商路由语义（model_providers 整表已剥，
        // 剩余任何 wire_api 都意味着泄漏）
        assert!(
            !extracted.contains("wire_api"),
            "should strip top-level wire_api from the shared snippet, got: {extracted}"
        );
        // 注入产物不得进共享片段（bearer token 泄漏为密钥级问题）
        assert!(
            !extracted.contains("experimental_bearer_token")
                && !extracted.contains("sk-live-secret"),
            "should strip top-level fallback bearer token, got: {extracted}"
        );
        assert!(
            !extracted.contains("model_catalog_json"),
            "should strip catalog projection pointer, got: {extracted}"
        );
        assert!(
            !extracted.contains("web_search"),
            "should strip the cc-switch web_search disabled sentinel, got: {extracted}"
        );
        // 关键字段归供应商，不在共享片段中传播。
        for key in [
            "disable_response_storage",
            "model_reasoning_effort",
            "default_subagent_model",
        ] {
            assert!(
                !extracted.contains(key),
                "key field {key} must stay with the provider, got: {extracted}"
            );
        }
        // 真正可共享的键保留
        assert!(
            extracted.contains("approval_policy = \"on-request\"")
                && extracted.contains("max_threads = 4"),
            "shareable keys must survive extraction, got: {extracted}"
        );
    }

    #[test]
    fn extract_codex_common_config_keeps_user_set_web_search() {
        let config_toml = "web_search = \"enabled\"\ndisable_response_storage = true\n";
        let settings = json!({ "config": config_toml });
        let extracted = ProviderService::extract_codex_common_config(&settings)
            .expect("extract should succeed");
        assert!(
            extracted.contains("web_search = \"enabled\""),
            "a user-set web_search value is a shareable preference, got: {extracted}"
        );
    }

    #[test]
    fn sensitive_key_matcher_covers_common_credential_namings() {
        for key in [
            // 裸 `_KEY`：最常见的写法，却曾被"只枚举 `_API_KEY` 这些子类"漏在外面
            "OPENAI_KEY",
            "GROQ_KEY",
            "XAI_KEY",
            // 不带分隔符的复合写法
            "VOLC_ACCESSKEY",
            "ALIYUN_SECRETKEY",
            "SOME_APITOKEN",
            // personal access token：既不含 TOKEN 也不含 KEY
            "GITHUB_PAT",
            "gitlab_pat",
            // 口令类缩写
            "MYSQL_PWD",
            "DB_PASS",
            "GPG_PASSPHRASE",
            "AWS_CREDS",
            // 发往上游的自定义请求头、Cookie、Authorization
            "ANTHROPIC_CUSTOM_HEADERS",
            "GEMINI_CLI_CUSTOM_HEADERS",
            "headers",
            "UPSTREAM_COOKIE",
            "PROXY_AUTHORIZATION",
        ] {
            assert!(
                ProviderService::is_sensitive_config_key(key),
                "{key} must be treated as a credential"
            );
        }

        // 后缀必须带下划线，不能把正常配置一起卷进来
        for key in [
            "PATH",
            "OLDPWD",
            "GEMINI_COMPAT",
            "SSL_BYPASS",
            "GEMINI_TIMEOUT_MS",
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
            // 名字带 HEADER 但不是发往上游的凭据：普通开关、用户自己的遥测端点
            "CLAUDE_CODE_ATTRIBUTION_HEADER",
            "OTEL_EXPORTER_OTLP_HEADERS",
        ] {
            assert!(
                !ProviderService::is_sensitive_config_key(key),
                "{key} is ordinary shareable config and must not be stripped"
            );
        }
    }

    #[test]
    fn extract_claude_common_config_strips_fable_model_env_keys() {
        let settings = json!({
            "env": {
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "haiku-mapped",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "Haiku Mapped",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "sonnet-mapped[1M]",
                "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "Sonnet Mapped",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "opus-mapped[1M]",
                "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "Opus Mapped",
                "ANTHROPIC_DEFAULT_FABLE_MODEL": "deepseek-v4-flash[1M]",
                "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME": "deepseek-v4-flash",
                "ANTHROPIC_MODEL": "default-mapped",
                "ENABLE_TOOL_SEARCH": "true"
            },
            "theme": "dark"
        });

        let snippet = ProviderService::extract_claude_common_config(&settings)
            .expect("extract should succeed");
        let value: Value = serde_json::from_str(&snippet).expect("snippet is valid JSON");
        let env = value.get("env");

        for stripped in [
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
            "ANTHROPIC_MODEL",
        ] {
            assert!(
                env.and_then(|e| e.get(stripped)).is_none(),
                "provider-specific model key {stripped} must not enter common config"
            );
        }

        assert_eq!(
            env.and_then(|e| e.get("ENABLE_TOOL_SEARCH"))
                .and_then(|v| v.as_str()),
            Some("true")
        );
        assert_eq!(value.get("theme").and_then(|v| v.as_str()), Some("dark"));
    }

    #[test]
    fn sensitive_key_matcher_covers_credentials_without_hiding_token_limits() {
        for key in [
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "SOME_PROXY_AUTH_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "GITHUB_PAT",
        ] {
            assert!(ProviderService::is_sensitive_config_key(key), "{key}");
        }
        for key in ["PATH", "GEMINI_TIMEOUT_MS", "MAX_THINKING_TOKENS"] {
            assert!(!ProviderService::is_sensitive_config_key(key), "{key}");
        }
    }

    #[test]
    fn extract_gemini_common_config_strips_all_credentials() {
        let settings = json!({
            "env": {
                "GEMINI_API_KEY": "gemini-key",
                "GOOGLE_API_KEY": "google-key",
                "GOOGLE_APPLICATION_CREDENTIALS": "/path/credentials.json",
                "SOME_PROXY_AUTH_TOKEN": "proxy-token",
                "GOOGLE_GEMINI_BASE_URL": "https://gemini.example",
                "GEMINI_TIMEOUT_MS": "30000"
            }
        });

        let snippet = ProviderService::extract_gemini_common_config(&settings)
            .expect("extract common config");
        let value: Value = serde_json::from_str(&snippet).expect("valid json");

        assert_eq!(value["GEMINI_TIMEOUT_MS"], "30000");
        assert_eq!(value.as_object().expect("object").len(), 1);
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn scrub_removes_historical_gemini_credentials_without_storing_values() {
        let _home = TestHome::new();
        let db = std::sync::Arc::new(crate::database::Database::memory().expect("database"));
        let state = AppState::new(db.clone());
        db.set_config_snippet(
            "gemini",
            Some(
                json!({
                    "GOOGLE_API_KEY": "leaked-secret",
                    "GEMINI_TIMEOUT_MS": "30000"
                })
                .to_string(),
            ),
        )
        .expect("snippet");
        let provider = Provider::with_id(
            "victim".to_string(),
            "Victim".to_string(),
            json!({
                "env": {
                    "GOOGLE_API_KEY": "leaked-secret",
                    "GEMINI_TIMEOUT_MS": "30000"
                }
            }),
            None,
        );
        db.save_provider("gemini", &provider).expect("provider");

        ProviderService::scrub_leaked_gemini_common_config(&state)
            .await
            .expect("scrub");

        let snippet = db
            .get_config_snippet("gemini")
            .expect("read snippet")
            .expect("snippet remains");
        assert_eq!(
            serde_json::from_str::<Value>(&snippet).expect("json"),
            json!({ "GEMINI_TIMEOUT_MS": "30000" })
        );
        let cleaned = db
            .get_provider_by_id("victim", "gemini")
            .expect("read provider")
            .expect("provider exists");
        assert!(cleaned.settings_config["env"]
            .get("GOOGLE_API_KEY")
            .is_none());
        let audit = db
            .get_setting("gemini_common_config_scrub_audit_v1")
            .expect("audit")
            .expect("audit exists");
        assert!(!audit.contains("leaked-secret"));
    }
}

impl ProviderService {
    pub(crate) fn is_sensitive_config_key(name: &str) -> bool {
        let upper = name.to_ascii_uppercase();

        // 单数 `_TOKEN` 命中 AWS_SESSION_TOKEN 等，但**不**误伤复数 `_TOKENS`
        // （CLAUDE_CODE_MAX_OUTPUT_TOKENS / MAX_THINKING_TOKENS 是正常可共享配置）。
        const SENSITIVE_SUFFIXES: &[&str] = &[
            // 裸 `_KEY` 是最常见的凭据写法（OPENAI_KEY / GROQ_KEY / XAI_KEY…），
            // 必须单列：只枚举 `_API_KEY` / `_ACCESS_KEY` 这些子类，等于把最普通
            // 的那一种漏在外面。下面几条 `_*_KEY` 被它蕴含，保留是为了说明覆盖面。
            "_KEY",
            "_API_KEY",
            "_ACCESS_KEY",
            "_ACCESS_KEY_ID",
            "_KEY_ID",
            "_PRIVATE_KEY",
            // 不带分隔符的复合写法各走各的后缀：`_KEY` 够不着 `..._APIKEY`
            // （倒数第四个字符是 I 不是下划线）。VOLC_ACCESSKEY 是火山引擎文档
            // 里的正式变量名，本仓库就实现了火山 AK/SK 用量查询。
            "_APIKEY",
            "_ACCESSKEY",
            "_SECRETKEY",
            "_APITOKEN",
            "_AUTH_TOKEN",
            "_TOKEN",
            // GITHUB_PAT / GITLAB_PAT 等 personal access token 的惯用写法，
            // 既不含 TOKEN 也不含 KEY，前面每一条规则都够不着。
            "_PAT",
            // 口令类的常见缩写。`_PASS` 不会误伤 `*_BYPASS`（那个以 `_BYPASS`
            // 结尾），`_PWD` 也不会误伤 shell 的 PWD / OLDPWD。
            "_PWD",
            "_PASS",
            "_PASSPHRASE",
            "_CREDS",
            // 发往上游的自定义请求头（ANTHROPIC_CUSTOM_HEADERS、
            // GEMINI_CLI_CUSTOM_HEADERS）：常见写法是 `Authorization: Bearer …`
            // 或 `Cookie: …`，整串就是凭据。只认 `_CUSTOM_HEADERS`，不按 HEADER
            // 一刀切：CLAUDE_CODE_ATTRIBUTION_HEADER 是普通开关，
            // OTEL_EXPORTER_OTLP_HEADERS 发往用户自己的遥测端点，都应照常共享。
            "_CUSTOM_HEADERS",
        ];
        const SENSITIVE_EXACT: &[&str] = &[
            "APIKEY",
            "API_KEY",
            "TOKEN",
            "SECRET",
            "PASSWORD",
            "CREDENTIALS",
            "HEADERS",
        ];
        // contains：覆盖 AWS_SECRET_ACCESS_KEY / *_CLIENT_SECRET /
        // GOOGLE_APPLICATION_CREDENTIALS / AWS_BEARER_TOKEN_BEDROCK 等变体。
        const SENSITIVE_CONTAINS: &[&str] = &[
            "SECRET",
            "PASSWORD",
            "PASSWD",
            "CREDENTIAL",
            "PRIVATE_KEY",
            "BEARER_TOKEN",
            "COOKIE",
            "AUTHORIZATION",
        ];

        SENSITIVE_EXACT.contains(&upper.as_str())
            || SENSITIVE_SUFFIXES.iter().any(|s| upper.ends_with(s))
            || SENSITIVE_CONTAINS.iter().any(|c| upper.contains(c))
    }

    fn normalize_provider_if_claude(app_type: &AppType, provider: &mut Provider) {
        if matches!(app_type, AppType::Claude) {
            let mut v = provider.settings_config.clone();
            if normalize_claude_models_in_value(&mut v) {
                provider.settings_config = v;
            }
        }
    }

    fn check_live_config_exists(
        app_type: &AppType,
        provider_id: &str,
        live_config_managed: Option<bool>,
    ) -> Result<bool, AppError> {
        if live_config_managed == Some(false) {
            Ok(provider_exists_in_live_config(app_type, provider_id).unwrap_or(false))
        } else {
            provider_exists_in_live_config(app_type, provider_id)
        }
    }

    fn provider_live_config_managed(provider: &Provider) -> Option<bool> {
        provider
            .meta
            .as_ref()
            .and_then(|meta| meta.live_config_managed)
    }

    fn set_provider_live_config_managed(provider: &mut Provider, managed: bool) {
        provider
            .meta
            .get_or_insert_with(Default::default)
            .live_config_managed = Some(managed);
    }

    fn is_hermes_read_only_provider(provider: &Provider) -> bool {
        provider
            .settings_config
            .get(crate::hermes_config::PROVIDER_SOURCE_FIELD)
            .and_then(Value::as_str)
            == Some(crate::hermes_config::PROVIDER_SOURCE_DICT)
    }

    fn managed_codex_oauth_account_id(provider: &Provider) -> Option<String> {
        if !crate::proxy::providers::is_codex_official_provider(provider) {
            return None;
        }
        provider
            .meta
            .as_ref()
            .and_then(|meta| meta.managed_account_id_for("codex_oauth"))
            .map(|account_id| account_id.trim().to_string())
            .filter(|account_id| !account_id.is_empty())
    }

    fn preflight_managed_codex_provider(
        state: &AppState,
        app_type: &AppType,
        provider: &Provider,
    ) -> Result<Option<Provider>, AppError> {
        if !matches!(app_type, AppType::Codex) {
            return Ok(None);
        }
        let Some(account_id) = Self::managed_codex_oauth_account_id(provider) else {
            return Ok(None);
        };
        let bundle = futures::executor::block_on(async {
            let manager = state.codex_oauth_state.read().await;
            // 已删除账号的旧绑定给出“选择账号”指引，而不是裸 not-found（上游 15884b20）。
            manager.ensure_account_exists(&account_id).await?;
            manager
                .get_valid_token_bundle_for_account(&account_id)
                .await
        })
        .map_err(|error| AppError::Message(format!("Codex OAuth 账号不可用: {error}")))?;
        if bundle.id_token.is_none() {
            return Err(AppError::Message(format!(
                "Codex OAuth 账号 {account_id} 缺少 id_token，请在认证中心重新登录"
            )));
        }
        let mut prepared = provider.clone();
        let settings = prepared
            .settings_config
            .as_object_mut()
            .ok_or_else(|| AppError::Config("Codex 供应商配置必须是 JSON 对象".to_string()))?;
        settings.insert(
            "auth".to_string(),
            crate::codex_config::codex_managed_oauth_auth_value(
                &bundle.chatgpt_account_id,
                &bundle.access_token,
                bundle.id_token.as_deref(),
                &bundle.refresh_token,
                &bundle.last_refresh,
            ),
        );
        Ok(Some(prepared))
    }

    fn prepare_outgoing_managed_codex_live_auth(
        state: &AppState,
        account_id: Option<&str>,
    ) -> Result<Option<crate::proxy::providers::codex_oauth_auth::CodexLiveAuthSwitchGuard>, AppError>
    {
        let Some(account_id) = account_id else {
            return Ok(None);
        };
        futures::executor::block_on(async {
            let manager = state.codex_oauth_state.read().await;
            manager
                .prepare_live_auth_for_account_switch_away(account_id)
                .await
        })
        .map(Some)
        .map_err(|error| AppError::Message(error.to_string()))
    }

    fn managed_codex_transaction_error(
        operation: &str,
        error: AppError,
        snapshot: &crate::codex_config::CodexLiveStateSnapshot,
        restore_local_current: Option<(&AppType, Option<&str>)>,
    ) -> AppError {
        let mut rollback_failures = Vec::new();
        if let Some((app_type, previous_local_current)) = restore_local_current {
            if let Err(rollback_error) =
                crate::settings::set_current_provider(app_type, previous_local_current)
            {
                rollback_failures.push(format!("恢复本地 current 失败: {rollback_error}"));
            }
        }
        if let Err(rollback_error) = snapshot.restore_preserving_newer_same_account_auth() {
            rollback_failures.push(rollback_error.to_string());
        }

        if rollback_failures.is_empty() {
            error
        } else {
            AppError::Message(format!(
                "{operation}失败: {error}; 回滚同时失败: {}",
                rollback_failures.join("; ")
            ))
        }
    }

    /// List all providers for an app type
    pub fn list(
        state: &AppState,
        app_type: AppType,
    ) -> Result<IndexMap<String, Provider>, AppError> {
        // DSH 的列表会回写行：整个快照与回读和增删改用同一把锁，进行中的列表不会恢复已删的行
        let _dsh_guard = (app_type == AppType::Dsh).then(|| {
            futures::executor::block_on(state.proxy_service.lock_switch_for_app(app_type.as_str()))
        });
        if app_type == AppType::Dsh {
            // A profile can appear while CC Switch is running. Keep the provider list usable
            // when a native lock or an invalid profile prevents the initial sync; retry later.
            if let Err(error) = live::initialize_dsh_profiles(state) {
                log::warn!("Initializing DeepSeek Harness profiles failed: {error}");
            }
        }
        if app_type == AppType::Pi {
            return pi::list(state);
        }
        if app_type == AppType::Omp {
            return omp::list(state);
        }
        if app_type == AppType::Copilot {
            return Self::list_copilot(state);
        }
        if matches!(app_type, AppType::Mcode | AppType::Kimi | AppType::Dsh) {
            let native = if app_type == AppType::Dsh {
                crate::dsh_config::get_providers()?
            } else if app_type == AppType::Kimi {
                crate::kimi_config::get_providers()?
            } else {
                crate::mcode_config::get_providers()?
            };
            let mut saved = state.db.get_all_providers(app_type.as_str())?;
            let nicknames = if app_type == AppType::Kimi {
                crate::services::kimi_oauth::account_nicknames()
            } else {
                Default::default()
            };
            for (id, config) in &native {
                if !saved.contains_key(id) {
                    let name = config.get("name").and_then(Value::as_str).unwrap_or(id);
                    saved.insert(
                        id.clone(),
                        Provider::with_id(id.clone(), name.into(), config.clone(), None),
                    );
                }
            }
            for (id, provider) in &mut saved {
                if let Some(config) = native.get(id) {
                    if let Some(name) = config.get("name").and_then(Value::as_str) {
                        provider.name = name.into();
                    }
                    provider.settings_config = config.clone();
                }
                Self::set_provider_live_config_managed(provider, native.contains_key(id));
                if app_type == AppType::Kimi {
                    crate::kimi_config::normalize_provider_identity(
                        provider,
                        nicknames.get(id).map(String::as_str),
                    );
                }
                state.db.save_provider(app_type.as_str(), provider)?;
            }
            return Ok(saved);
        }
        state.db.get_all_providers(app_type.as_str())
    }

    /// GitHub Copilot CLI 的列表：自带模型卡和 `providers.json` 合并（文件里有、库里没有的
    /// 显示成卡片；库里有的用文件里的 provider / models 覆盖，保留卡片自己的推理强度）。
    /// 官方卡不参与合并，永远不是「已添加」。旧版环境变量形状的自带模型卡就地转成新形状。
    fn list_copilot(state: &AppState) -> Result<IndexMap<String, Provider>, AppError> {
        let app = AppType::Copilot.as_str();
        let _guard = futures::executor::block_on(state.proxy_service.lock_switch_for_app(app));
        let mut saved = state.db.get_all_providers(app)?;
        let native = match crate::copilot_config::get_providers() {
            Ok(native) => native,
            Err(error) => {
                // Keep the last known membership. A read failure is not a removal.
                log::warn!("Could not refresh Copilot providers.json: {error}");
                return Ok(saved);
            }
        };
        for (id, config) in &native {
            if !saved.contains_key(id) {
                saved.insert(
                    id.clone(),
                    Provider::with_id(id.clone(), id.clone(), config.clone(), None),
                );
            }
        }
        for (id, provider) in &mut saved {
            let before = (
                provider.settings_config.clone(),
                Self::provider_live_config_managed(provider),
            );
            if provider.category.as_deref() != Some("official") {
                if let Some(converted) =
                    crate::copilot_config::convert_legacy_settings(&provider.settings_config)
                {
                    provider.settings_config = converted;
                }
            }
            let official = copilot_direct::is_official(provider);
            let in_file = !official && native.contains_key(id);
            if in_file {
                let config = &native[id];
                provider.settings_config["provider"] = config["provider"].clone();
                provider.settings_config["models"] = config["models"].clone();
            }
            Self::set_provider_live_config_managed(provider, in_file);
            if before
                != (
                    provider.settings_config.clone(),
                    Self::provider_live_config_managed(provider),
                )
            {
                state.db.save_provider(app, provider)?;
            }
        }
        Ok(saved)
    }

    /// Copilot 自带模型卡写进 providers.json（官方卡绝不写文件），再存行；
    /// 写文件和存库在 `save_and_commit` 里一个事务完成。
    fn save_copilot_provider(
        state: &AppState,
        provider: &Provider,
        write_live: bool,
        create: bool,
    ) -> Result<bool, AppError> {
        if write_live && !copilot_direct::is_official(provider) {
            crate::copilot_config::save_and_commit(
                &provider.id,
                Some(&provider.settings_config),
                create,
                || {
                    state.db.save_provider("copilot", provider)?;
                    Ok(true)
                },
            )
        } else {
            state.db.save_provider("copilot", provider)?;
            Ok(true)
        }
    }

    /// Copilot「新增」：官方卡只存行；自带模型卡按 `add_to_live`（前端默认 true）写进
    /// providers.json。卡片 id 也是 providers.json 里的供应商名，库里或文件里已有就拒绝。
    fn add_copilot(
        state: &AppState,
        provider: Provider,
        add_to_live: bool,
    ) -> Result<bool, AppError> {
        let _guard =
            futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
        let mut provider = provider;
        Self::validate_provider_settings(&AppType::Copilot, &provider)?;
        let add_to_live = add_to_live && !copilot_direct::is_official(&provider);
        Self::set_provider_live_config_managed(&mut provider, add_to_live);
        if state
            .db
            .get_provider_by_id(&provider.id, "copilot")?
            .is_some()
            || crate::copilot_config::provider_key_exists(&provider.id)?
        {
            return Err(AppError::InvalidInput(format!(
                "copilot provider key '{}' already exists",
                provider.id
            )));
        }
        Self::save_copilot_provider(state, &provider, add_to_live, true)
    }

    /// Copilot「编辑」：已添加的自带模型卡同步改 providers.json（默认那家不能删掉选中的模型）；
    /// 还没添加的卡可以改 id，加进去之后 id 就是 Copilot 里的供应商名，不能再改。
    fn update_copilot(
        state: &AppState,
        original_id: Option<&str>,
        provider: Provider,
    ) -> Result<bool, AppError> {
        let _guard =
            futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
        let mut provider = provider;
        Self::validate_provider_settings(&AppType::Copilot, &provider)?;
        let official = copilot_direct::is_official(&provider);
        let original_id = original_id.unwrap_or(provider.id.as_str()).to_string();
        if original_id != provider.id {
            let existing = state
                .db
                .get_provider_by_id(&original_id, "copilot")?
                .ok_or_else(|| {
                    AppError::Message(format!(
                        "Original provider '{original_id}' does not exist in app 'copilot'"
                    ))
                })?;
            if !copilot_direct::is_official(&existing)
                && crate::copilot_config::provider_key_exists(&original_id)?
            {
                return Err(AppError::Message(
                    "Provider key cannot be changed after the provider has been added to the app config"
                        .to_string(),
                ));
            }
            if state
                .db
                .get_provider_by_id(&provider.id, "copilot")?
                .is_some()
                || crate::copilot_config::provider_key_exists(&provider.id)?
            {
                return Err(AppError::Message(format!(
                    "Provider '{}' already exists in app 'copilot'",
                    provider.id
                )));
            }
            Self::set_provider_live_config_managed(&mut provider, false);
            state.db.save_provider("copilot", &provider)?;
            state.db.delete_provider("copilot", &original_id)?;
            return Ok(true);
        }
        // 官方卡不在 providers.json 里（同名条目属于别人）。
        let in_file = !official && crate::copilot_config::provider_key_exists(&provider.id)?;
        Self::set_provider_live_config_managed(&mut provider, in_file);
        Self::save_copilot_provider(state, &provider, in_file, false)
    }

    /// Copilot 自带模型卡写进 providers.json；文件里已经有这家时原样保留（同 Kimi）。
    /// 调用方已拿 Copilot 的应用锁。
    fn add_copilot_to_live(state: &AppState, id: &str) -> Result<(), AppError> {
        let mut provider = state
            .db
            .get_provider_by_id(id, "copilot")?
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;
        if copilot_direct::is_official(&provider) {
            return Err(copilot_official_not_added());
        }
        Self::validate_provider_settings(&AppType::Copilot, &provider)?;
        Self::set_provider_live_config_managed(&mut provider, true);
        crate::copilot_config::add_and_commit(id, &provider.settings_config, || {
            state.db.save_provider("copilot", &provider)
        })
    }

    /// Get current provider ID
    ///
    /// 使用有效的当前供应商 ID（验证过存在性）。
    /// 优先从本地 settings 读取，验证后 fallback 到数据库的 is_current 字段。
    /// 这确保了云同步场景下多设备可以独立选择供应商，且返回的 ID 一定有效。
    ///
    /// 对于累加模式应用（OpenCode, OpenClaw），不存在"当前供应商"概念，直接返回空字符串。
    pub fn current(state: &AppState, app_type: AppType) -> Result<String, AppError> {
        if app_type == AppType::Kimi {
            return crate::kimi_config::current_provider();
        }
        if app_type == AppType::Copilot {
            // 拥有 Copilot 默认模型（settings.json 的 `model`）的那家是「默认」。读不了 Copilot
            // 的设置或供应商文件时不影响列表显示，只是没有「默认」。
            return Ok(
                crate::copilot_config::current_provider().unwrap_or_else(|error| {
                    log::warn!("读取 GitHub Copilot CLI 默认模型失败: {error}");
                    String::new()
                }),
            );
        }
        if matches!(
            app_type,
            AppType::Claude
                | AppType::ClaudeDesktop
                | AppType::Codex
                | AppType::Gemini
                | AppType::GrokBuild
        ) {
            crate::mode::operation::settle(state.db.as_ref(), app_type.as_str())?;
        }
        // Additive mode apps have no "current" provider concept
        if app_type.is_additive_mode() {
            return Ok(String::new());
        }
        crate::mode::current::provider_for(
            &state.db,
            &app_type,
            crate::mode::current::Purpose::InUse,
        )
        .map(|opt| opt.unwrap_or_default())
    }

    fn save_mcode_provider(
        state: &AppState,
        provider: &Provider,
        write_live: bool,
        create: bool,
    ) -> Result<bool, AppError> {
        let previous = state.db.get_provider_by_id(&provider.id, "mcode")?;
        state.db.save_provider("mcode", provider)?;
        if write_live {
            let config = provider.settings_config.clone();
            let written = if create {
                crate::mcode_config::add_provider(&provider.id, config)
            } else {
                crate::mcode_config::set_provider(&provider.id, config)
            };
            if let Err(error) = written {
                match previous {
                    Some(previous) => state.db.save_provider("mcode", &previous)?,
                    None => state.db.delete_provider("mcode", &provider.id)?,
                }
                return Err(error);
            }
        }
        Ok(true)
    }

    fn save_dsh_provider(
        state: &AppState,
        provider: &Provider,
        write_live: bool,
        create: bool,
    ) -> Result<bool, AppError> {
        if write_live {
            crate::dsh_config::save_and_commit(
                &provider.id,
                Some(provider.settings_config.clone()),
                create,
                || {
                    state.db.save_provider("dsh", provider)?;
                    Ok(true)
                },
            )
        } else {
            state.db.save_provider("dsh", provider)?;
            Ok(true)
        }
    }

    fn save_kimi_provider(
        state: &AppState,
        provider: &Provider,
        write_live: bool,
        create: bool,
    ) -> Result<bool, AppError> {
        if write_live {
            crate::kimi_config::save_and_commit(
                &provider.id,
                Some(provider.settings_config.clone()),
                create,
                || {
                    state.db.save_provider("kimi", provider)?;
                    Ok(true)
                },
            )
        } else {
            state.db.save_provider("kimi", provider)?;
            Ok(true)
        }
    }

    /// The signed-in connection node of a Kimi official card: Kimi's live node
    /// first, else the saved card (an official card removed from Kimi's config).
    fn kimi_official_connection(state: &AppState, id: &str) -> Result<Option<Value>, AppError> {
        if let Some(live) = crate::kimi_config::get_providers()?.get(id) {
            return Ok(
                crate::kimi_config::is_official_provider(live).then(|| live["provider"].clone())
            );
        }
        Ok(state
            .db
            .get_provider_by_id(id, "kimi")?
            .filter(|saved| crate::kimi_config::is_official_provider(&saved.settings_config))
            .map(|saved| saved.settings_config["provider"].clone()))
    }

    /// Deleting an official account that is still in Kimi's config goes through
    /// the Authorization Center (it also deletes the login); remove it first.
    fn ensure_kimi_provider_editable(id: &str) -> Result<(), AppError> {
        let native = crate::kimi_config::get_providers()?;
        if native
            .get(id)
            .is_some_and(crate::kimi_config::is_official_provider)
        {
            return Err(AppError::InvalidInput(
                "Manage Kimi official accounts in the Authorization Center".into(),
            ));
        }
        Ok(())
    }

    /// 只把供应商存进列表，不写客户端配置、不动当前指针（切换式应用）。
    ///
    /// `add` 在还没有当前供应商时会让新的这家直接生效；深链接导入时用户关掉了「导入后立即
    /// 切换」，就不能这样，交给用户之后自己切换。累加式应用没有「切换」，等同于不写进应用配置的
    /// `add`。
    pub fn add_without_switching(
        state: &AppState,
        app_type: AppType,
        provider: Provider,
    ) -> Result<bool, AppError> {
        if app_type.is_additive_mode() {
            return Self::add(state, app_type, provider, false);
        }
        if !matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            return Self::add(state, app_type, provider, true);
        }
        // 和切换、编辑器保存互斥：等着的切换不能看到只存了一半的行
        let _service = futures::executor::block_on(crate::mode::controller::lock_service());
        let _guard =
            futures::executor::block_on(state.proxy_service.lock_switch_for_app(app_type.as_str()));
        crate::mode::operation::settle(state.db.as_ref(), app_type.as_str())?;
        if state
            .db
            .get_provider_by_id(&provider.id, app_type.as_str())?
            .is_some()
        {
            return Err(AppError::Message(format!("供应商 {} 已存在", provider.id)));
        }
        let mut provider = provider;
        // 与 save_claude / save_codex / save_gemini / save_grok 新增时的规范化和校验一致
        Self::normalize_provider_if_claude(&app_type, &mut provider);
        Self::validate_provider_settings(&app_type, &provider)?;
        provider
            .meta
            .get_or_insert_with(Default::default)
            .common_config_enabled = Some(true);
        state.db.save_provider(app_type.as_str(), &provider)?;
        Ok(true)
    }

    /// Add a new provider
    pub fn add(
        state: &AppState,
        app_type: AppType,
        provider: Provider,
        add_to_live: bool,
    ) -> Result<bool, AppError> {
        if app_type == AppType::ClaudeDesktop {
            return Self::save_desktop(state, provider, true);
        }
        if app_type == AppType::Codex {
            return Self::save_codex(state, provider, None, true);
        }
        if app_type == AppType::Claude {
            return Self::save_claude(state, provider, None, true);
        }
        if app_type == AppType::Gemini {
            return Self::save_gemini(state, provider, None, true);
        }
        if app_type == AppType::GrokBuild {
            return Self::save_grok(state, provider, None, true);
        }
        if app_type == AppType::Pi {
            return pi::add(state, provider, add_to_live);
        }
        if app_type == AppType::Omp {
            return omp::add(state, provider, add_to_live);
        }
        // Antigravity 的卡只用来打开终端：添加只存行，不写任何文件、不设当前。
        if app_type == AppType::Agy {
            Self::validate_provider_settings(&app_type, &provider)?;
            state.db.save_provider(app_type.as_str(), &provider)?;
            return Ok(true);
        }
        // Copilot CLI：官方卡只存行；自带模型卡写进 providers.json（累加式）。
        if app_type == AppType::Copilot {
            return Self::add_copilot(state, provider, add_to_live);
        }
        let _switch_guard = if matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            Some(futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            ))
        } else {
            None
        };
        let mut provider = provider;
        // Normalize Claude model keys
        Self::normalize_provider_if_claude(&app_type, &mut provider);
        Self::validate_provider_settings(&app_type, &provider)?;
        normalize_provider_common_config_for_storage(state.db.as_ref(), &app_type, &mut provider)?;
        if app_type.is_additive_mode() {
            Self::set_provider_live_config_managed(&mut provider, add_to_live);
        }

        let current = state.db.get_current_provider(app_type.as_str())?;
        if matches!(app_type, AppType::Codex)
            && current.is_none()
            && Self::managed_codex_oauth_account_id(&provider).is_some()
        {
            let prepared = Self::preflight_managed_codex_provider(state, &app_type, &provider)?
                .expect("managed Codex preflight must return a provider");
            let snapshot = crate::codex_config::CodexLiveStateSnapshot::capture()?;
            let live_result = (|| {
                write_live_with_common_config(state.db.as_ref(), &app_type, &prepared)?;
                if let (Some(auth), Some(account_id)) = (
                    prepared.settings_config.get("auth"),
                    Self::managed_codex_oauth_account_id(&prepared),
                ) {
                    crate::codex_config::record_codex_managed_oauth_live_auth(auth, &account_id)?;
                }
                Ok::<(), AppError>(())
            })();
            if let Err(error) = live_result {
                return Err(Self::managed_codex_transaction_error(
                    "写入首个托管 Codex Provider Live",
                    error,
                    &snapshot,
                    None,
                ));
            }
            if let Err(error) = state.db.save_provider(app_type.as_str(), &provider) {
                return Err(Self::managed_codex_transaction_error(
                    "保存首个托管 Codex Provider",
                    error,
                    &snapshot,
                    None,
                ));
            }
            if let Err(error) = state
                .db
                .set_current_provider(app_type.as_str(), &provider.id)
            {
                let _ = state.db.delete_provider(app_type.as_str(), &provider.id);
                return Err(Self::managed_codex_transaction_error(
                    "设置首个托管 Codex Provider",
                    error,
                    &snapshot,
                    None,
                ));
            }
            return Ok(true);
        }

        if app_type == AppType::Mcode {
            // Serialize user-chosen keys; the live write checks again under MCode's file lock.
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            if state
                .db
                .get_provider_by_id(&provider.id, "mcode")?
                .is_some()
                || crate::mcode_config::provider_key_exists(&provider.id)?
            {
                return Err(AppError::InvalidInput(format!(
                    "MCode provider key '{}' already exists",
                    provider.id
                )));
            }
            return Self::save_mcode_provider(state, &provider, add_to_live, true);
        }

        if app_type == AppType::Dsh {
            // The key is user-chosen, and saving would overwrite an existing row or live node.
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            if state.db.get_provider_by_id(&provider.id, "dsh")?.is_some()
                || crate::dsh_config::provider_key_exists(&provider.id)?
            {
                return Err(AppError::InvalidInput(format!(
                    "dsh provider key '{}' already exists",
                    provider.id
                )));
            }
            return Self::save_dsh_provider(state, &provider, add_to_live, true);
        }

        if app_type == AppType::Kimi {
            if crate::kimi_config::is_official_provider(&provider.settings_config) {
                return Err(AppError::InvalidInput(
                    "Manage Kimi official accounts in the Authorization Center".into(),
                ));
            }
            // The key is user-chosen; the per-app lock also serializes native list refreshes.
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            if state.db.get_provider_by_id(&provider.id, "kimi")?.is_some()
                || crate::kimi_config::provider_key_exists(&provider.id)?
            {
                return Err(AppError::InvalidInput(format!(
                    "kimi provider key '{}' already exists",
                    provider.id
                )));
            }
            return Self::save_kimi_provider(state, &provider, add_to_live, true);
        }

        // 累加式写 live 失败（如配置文件解析不了）时要撤回这一行，先记下原来的
        let existing_row = if app_type.is_additive_mode() {
            state
                .db
                .get_provider_by_id(&provider.id, app_type.as_str())?
        } else {
            None
        };

        // Save to database
        state.db.save_provider(app_type.as_str(), &provider)?;

        if matches!(app_type, AppType::ClaudeDesktop) {
            // 要经路由的卡直连写不进去，路由模式下配置文件归路由那家：只存行。
            if current.is_none()
                && !crate::mode::current::is_proxy(&app_type)
                && !crate::claude_desktop_config::needs_routing(&provider)
            {
                crate::claude_desktop_config::write_direct(
                    state.db.as_ref(),
                    crate::mode::state::op::SWITCH,
                    Some(&provider),
                    crate::mode::state::PendingTarget::pointer(Some(provider.id.clone())),
                )?;
            }
            return Ok(true);
        }

        // Additive mode apps (OpenCode, OpenClaw) - optionally write to live config
        if app_type.is_additive_mode() {
            // OMO / OMO Slim providers use exclusive mode and write to dedicated config file.
            if matches!(app_type, AppType::OpenCode)
                && matches!(provider.category.as_deref(), Some("omo") | Some("omo-slim"))
            {
                // Do not auto-enable newly added OMO / OMO Slim providers.
                // Users must explicitly switch/apply an OMO provider to activate it.
                return Ok(true);
            }
            if !add_to_live {
                return Ok(true);
            }
            if let Err(error) =
                write_live_with_common_config(state.db.as_ref(), &app_type, &provider)
            {
                // live 没写进去就不留这一行，免得界面显示已添加、配置文件里却没有
                let rollback = match existing_row.as_ref() {
                    Some(existing) => state.db.save_provider(app_type.as_str(), existing),
                    None => state.db.delete_provider(app_type.as_str(), &provider.id),
                };
                if let Err(rollback) = rollback {
                    log::warn!(
                        "恢复 {} 供应商 '{}' 失败: {rollback}",
                        app_type.as_str(),
                        provider.id
                    );
                }
                return Err(error);
            }
            return Ok(true);
        }

        // For other apps: Check if sync is needed (if this is current provider, or no current provider)
        if current.is_none() {
            // No current provider, set as current and sync
            state
                .db
                .set_current_provider(app_type.as_str(), &provider.id)?;
            write_live_with_common_config(state.db.as_ref(), &app_type, &provider)?;
        }

        Ok(true)
    }

    /// Update a provider
    pub fn update(
        state: &AppState,
        app_type: AppType,
        original_id: Option<&str>,
        provider: Provider,
    ) -> Result<bool, AppError> {
        let mut provider = provider;
        let _dsh_guard = (app_type == AppType::Dsh).then(|| {
            futures::executor::block_on(state.proxy_service.lock_switch_for_app(app_type.as_str()))
        });
        if app_type == AppType::Kimi {
            // Official cards come from signing in. Their models, name and notes are
            // editable; the connection stays as signed in, and no edit may turn
            // another card into an official one.
            let id = original_id.unwrap_or(&provider.id).to_string();
            match Self::kimi_official_connection(state, &id)? {
                Some(_) if provider.id != id => {
                    return Err(AppError::InvalidInput(
                        "Kimi official account keys cannot be changed".into(),
                    ));
                }
                Some(connection) => provider.settings_config["provider"] = connection,
                None if crate::kimi_config::is_official_provider(&provider.settings_config) => {
                    return Err(AppError::InvalidInput(
                        "Manage Kimi official accounts in the Authorization Center".into(),
                    ));
                }
                None => {}
            }
        }
        if app_type == AppType::ClaudeDesktop {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Claude Desktop provider ID cannot be changed".into(),
                ));
            }
            return Self::save_desktop(state, provider, false);
        }
        if app_type == AppType::Codex {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Codex provider ID cannot be changed".into(),
                ));
            }
            return Self::save_codex(state, provider, None, false);
        }
        if app_type == AppType::Claude {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Claude provider ID cannot be changed".into(),
                ));
            }
            return Self::save_claude(state, provider, None, false);
        }
        if app_type == AppType::Gemini {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Gemini provider ID cannot be changed".into(),
                ));
            }
            return Self::save_gemini(state, provider, None, false);
        }
        // Antigravity 的卡只用来打开终端：编辑只存行，不写任何文件。
        if app_type == AppType::Agy {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Antigravity provider ID cannot be changed".into(),
                ));
            }
            Self::validate_provider_settings(&app_type, &provider)?;
            state.db.save_provider(app_type.as_str(), &provider)?;
            return Ok(true);
        }
        if app_type == AppType::Copilot {
            return Self::update_copilot(state, original_id, provider);
        }
        if app_type == AppType::GrokBuild {
            if original_id.is_some_and(|id| id != provider.id) {
                return Err(AppError::Message(
                    "Grok provider ID cannot be changed".into(),
                ));
            }
            return Self::save_grok(state, provider, None, false);
        }
        if app_type == AppType::Pi {
            return pi::update(state, original_id, provider);
        }
        if app_type == AppType::Omp {
            return omp::update(state, original_id, provider);
        }
        let _switch_guard = if matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            Some(futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            ))
        } else {
            None
        };
        let mut provider = provider;
        let original_id = original_id.unwrap_or(provider.id.as_str()).to_string();
        let provider_id_changed = original_id != provider.id;
        let existing_provider = state
            .db
            .get_provider_by_id(&original_id, app_type.as_str())?;
        if matches!(app_type, AppType::Hermes)
            && existing_provider
                .as_ref()
                .is_some_and(Self::is_hermes_read_only_provider)
        {
            return Err(AppError::localized(
                "provider.hermes.read_only",
                "该供应商由 Hermes providers 配置管理，请在 Hermes Web UI 中修改",
                "This provider is managed by Hermes; edit it in Hermes Web UI",
            ));
        }
        // Normalize Claude model keys
        Self::normalize_provider_if_claude(&app_type, &mut provider);
        Self::validate_provider_settings(&app_type, &provider)?;
        normalize_provider_common_config_for_storage(state.db.as_ref(), &app_type, &mut provider)?;

        let effective_current =
            crate::settings::get_effective_current_provider(&state.db, &app_type)?;
        let updates_current_provider = effective_current.as_deref() == Some(original_id.as_str());
        let existing_managed_codex_account_id = existing_provider
            .as_ref()
            .and_then(Self::managed_codex_oauth_account_id);
        let target_managed_codex_account_id = Self::managed_codex_oauth_account_id(&provider);
        if matches!(app_type, AppType::Codex)
            && !provider_id_changed
            && updates_current_provider
            && (existing_managed_codex_account_id.is_some()
                || target_managed_codex_account_id.is_some())
        {
            let outgoing_managed_account_id = existing_managed_codex_account_id
                .as_ref()
                .filter(|account_id| target_managed_codex_account_id.as_ref() != Some(*account_id))
                .cloned();
            let outgoing_live_auth_guard = Self::prepare_outgoing_managed_codex_live_auth(
                state,
                outgoing_managed_account_id.as_deref(),
            )?;
            let prepared_provider =
                Self::preflight_managed_codex_provider(state, &app_type, &provider)?;
            let provider_for_live = prepared_provider.as_ref().unwrap_or(&provider);
            let snapshot = crate::codex_config::CodexLiveStateSnapshot::capture()?;
            let live_result = (|| {
                if let (Some(account_id), Some(guard)) = (
                    outgoing_managed_account_id.as_deref(),
                    outgoing_live_auth_guard.as_ref(),
                ) {
                    guard.ensure_unchanged(account_id)?;
                }
                write_live_with_common_config(state.db.as_ref(), &app_type, provider_for_live)?;
                if let Some(account_id) = target_managed_codex_account_id.as_deref() {
                    if let Some(auth) = provider_for_live.settings_config.get("auth") {
                        crate::codex_config::record_codex_managed_oauth_live_auth(
                            auth, account_id,
                        )?;
                    }
                }
                if let (Some(account_id), Some(guard)) = (
                    outgoing_managed_account_id.as_deref(),
                    outgoing_live_auth_guard.as_ref(),
                ) {
                    guard.clear_outgoing(account_id)?;
                }
                Ok::<(), AppError>(())
            })();
            if let Err(error) = live_result {
                return Err(Self::managed_codex_transaction_error(
                    "更新托管 Codex Provider Live",
                    error,
                    &snapshot,
                    None,
                ));
            }
            if let Err(error) = state.db.save_provider(app_type.as_str(), &provider) {
                return Err(Self::managed_codex_transaction_error(
                    "保存托管 Codex Provider",
                    error,
                    &snapshot,
                    None,
                ));
            }
            if let Err(error) = McpService::sync_enabled_for_app(state, &app_type) {
                log::warn!(
                    "保存托管 Codex Provider 后重投影 MCP 失败（将在下次同步时自愈）: {error}"
                );
            }
            return Ok(true);
        }

        if provider_id_changed {
            if !app_type.is_additive_mode() {
                return Err(AppError::Message(
                    "Only additive-mode providers support changing provider key".to_string(),
                ));
            }

            let Some(existing_provider) = existing_provider else {
                return Err(AppError::Message(format!(
                    "Original provider '{}' does not exist in app '{}'",
                    original_id,
                    app_type.as_str()
                )));
            };

            if matches!(app_type, AppType::OpenCode)
                && matches!(
                    existing_provider.category.as_deref(),
                    Some("omo") | Some("omo-slim")
                )
            {
                return Err(AppError::Message(
                    "Provider key cannot be changed for OMO/OMO Slim providers".to_string(),
                ));
            }

            let original_in_live = Self::check_live_config_exists(
                &app_type,
                &original_id,
                Self::provider_live_config_managed(&existing_provider),
            )?;
            if original_in_live {
                return Err(AppError::Message(
                    "Provider key cannot be changed after the provider has been added to the app config"
                        .to_string(),
                ));
            }

            let next_id_in_live = Self::check_live_config_exists(
                &app_type,
                &provider.id,
                Self::provider_live_config_managed(&existing_provider),
            )?;
            if state
                .db
                .get_provider_by_id(&provider.id, app_type.as_str())?
                .is_some()
                || next_id_in_live
            {
                return Err(AppError::Message(format!(
                    "Provider '{}' already exists in app '{}'",
                    provider.id,
                    app_type.as_str()
                )));
            }

            Self::set_provider_live_config_managed(&mut provider, false);
            state.db.save_provider(app_type.as_str(), &provider)?;
            state.db.delete_provider(app_type.as_str(), &original_id)?;

            if crate::settings::get_current_provider(&app_type).as_deref() == Some(&original_id) {
                crate::settings::set_current_provider(&app_type, Some(provider.id.as_str()))?;
            }

            return Ok(true);
        }

        if app_type.is_additive_mode() {
            if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo")
            {
                state.db.save_provider(app_type.as_str(), &provider)?;
                let is_omo_current =
                    state
                        .db
                        .is_omo_provider_current(app_type.as_str(), &provider.id, "omo")?;
                if is_omo_current {
                    OmoService::write_config_to_file(state, &crate::services::omo::STANDARD)?;
                }
                return Ok(true);
            }
            if matches!(app_type, AppType::OpenCode)
                && provider.category.as_deref() == Some("omo-slim")
            {
                state.db.save_provider(app_type.as_str(), &provider)?;
                let is_current = state.db.is_omo_provider_current(
                    app_type.as_str(),
                    &provider.id,
                    "omo-slim",
                )?;
                if is_current {
                    OmoService::write_config_to_file(state, &crate::services::omo::SLIM)?;
                }
                return Ok(true);
            }
            let live_config_managed = Self::check_live_config_exists(
                &app_type,
                &provider.id,
                Self::provider_live_config_managed(&provider).or_else(|| {
                    existing_provider
                        .as_ref()
                        .and_then(Self::provider_live_config_managed)
                }),
            )?;
            Self::set_provider_live_config_managed(&mut provider, live_config_managed);
            if app_type == AppType::Mcode {
                return Self::save_mcode_provider(state, &provider, live_config_managed, false);
            }
            if app_type == AppType::Kimi {
                return Self::save_kimi_provider(state, &provider, live_config_managed, false);
            }
            if app_type == AppType::Dsh {
                return Self::save_dsh_provider(state, &provider, live_config_managed, false);
            }
            state.db.save_provider(app_type.as_str(), &provider)?;
            if !live_config_managed {
                return Ok(true);
            }
            write_live_with_common_config(state.db.as_ref(), &app_type, &provider)?;
            return Ok(true);
        }

        // Save to database
        state.db.save_provider(app_type.as_str(), &provider)?;

        // For other apps: Check if this is current provider (use effective current, not just DB)
        let is_current = effective_current.as_deref() == Some(provider.id.as_str());

        if is_current {
            // 备份或 live 占位符存在时 Routing 仍持有 live，即使代理进程暂时停止。
            // - 不写 Live 配置（否则会破坏接管）
            // - 仅更新 Live 备份（保证关闭代理时能恢复到最新配置）
            if sync_live_for_provider_respecting_takeover(state, &app_type, &provider)? {
                if let Err(error) = McpService::sync_enabled_for_app(state, &app_type) {
                    log::warn!(
                        "保存供应商后重投影 {app_type:?} MCP 失败（将在下次同步时自愈）: {error}"
                    );
                }
            }
        }

        Ok(true)
    }

    /// Delete a provider
    ///
    pub(crate) fn update_pi_usage_script(
        state: &AppState,
        app_type: AppType,
        id: &str,
        script: crate::provider::UsageScript,
    ) -> Result<bool, AppError> {
        pi::update_usage_script(state, app_type, id, script)
    }

    /// 直连指针或代理路由指着的供应商不能删（见 `mode::current::is_referenced`）。
    /// 对于累加模式应用（OpenCode, OpenClaw），可以随时删除任意供应商，同时从 live 配置中移除。
    pub fn delete(state: &AppState, app_type: AppType, id: &str) -> Result<(), AppError> {
        if app_type == AppType::Pi {
            return pi::delete(state, id);
        }
        if app_type == AppType::Omp {
            return omp::delete(state, id);
        }
        if app_type == AppType::Dsh {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            return crate::dsh_config::save_and_commit(id, None, false, || {
                state.db.delete_provider(app_type.as_str(), id)
            });
        }
        if app_type == AppType::Copilot {
            let _guard =
                futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
            // 官方卡不在文件里；自带模型卡连同 providers.json 里的条目一起删（默认那家拒绝）。
            let official = state
                .db
                .get_provider_by_id(id, "copilot")?
                .is_some_and(|row| copilot_direct::is_official(&row));
            if official {
                return state.db.delete_provider("copilot", id);
            }
            return crate::copilot_config::save_and_commit(id, None, false, || {
                state.db.delete_provider("copilot", id)
            });
        }
        if app_type == AppType::Kimi {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            Self::ensure_kimi_provider_editable(id)?;
            let saved = state.db.get_provider_by_id(id, "kimi")?;
            crate::kimi_config::save_and_commit(id, None, false, || {
                state.db.delete_provider("kimi", id)
            })?;
            // The official node is already gone from Kimi (otherwise editing is
            // refused above); its CC Switch-owned credential goes with the card.
            if let Some(saved) = saved {
                if let Err(error) =
                    crate::services::kimi_oauth::forget_removed_profile(id, &saved.settings_config)
                {
                    log::warn!("[Kimi] 删除卡片后清理凭据失败: {error}");
                }
            }
            return Ok(());
        }
        // Additive mode apps - no current provider concept
        if app_type.is_additive_mode() {
            let existing = state.db.get_provider_by_id(id, app_type.as_str())?;

            if matches!(app_type, AppType::OpenCode) {
                let provider_category = existing.as_ref().and_then(|p| p.category.clone());

                if provider_category.as_deref() == Some("omo") {
                    let was_current =
                        state
                            .db
                            .is_omo_provider_current(app_type.as_str(), id, "omo")?;

                    state.db.delete_provider(app_type.as_str(), id)?;
                    if was_current {
                        OmoService::delete_config_file(&crate::services::omo::STANDARD)?;
                    }
                    return Ok(());
                }

                if provider_category.as_deref() == Some("omo-slim") {
                    let was_current =
                        state
                            .db
                            .is_omo_provider_current(app_type.as_str(), id, "omo-slim")?;

                    state.db.delete_provider(app_type.as_str(), id)?;
                    if was_current {
                        OmoService::delete_config_file(&crate::services::omo::SLIM)?;
                    }
                    return Ok(());
                }
            }
            let live_managed = existing
                .as_ref()
                .and_then(Self::provider_live_config_managed);
            if Self::check_live_config_exists(&app_type, id, live_managed)? {
                match app_type {
                    AppType::OpenCode => remove_opencode_provider_from_live(id)?,
                    AppType::OpenClaw => remove_openclaw_provider_from_live(id)?,
                    AppType::Hermes => remove_hermes_provider_from_live(id)?,
                    AppType::Mcode => crate::mcode_config::remove_provider(id)?,
                    _ => {}
                }
            }
            state.db.delete_provider(app_type.as_str(), id)?;
            return Ok(());
        }

        // Antigravity 的卡没有「启用」（只用来打开终端），旧版留下的当前指针不拦删除。
        if app_type == AppType::Agy {
            return state.db.delete_provider(app_type.as_str(), id);
        }

        // For other apps: Check both local settings and database
        let local_current = crate::settings::get_current_provider(&app_type);
        let db_current = state.db.get_current_provider(app_type.as_str())?;

        if local_current.as_deref() == Some(id)
            || db_current.as_deref() == Some(id)
            || crate::mode::current::is_referenced(&state.db, &app_type, id)?
        {
            return Err(AppError::Message(
                "无法删除当前正在使用的供应商".to_string(),
            ));
        }

        state.db.delete_provider(app_type.as_str(), id)
    }

    /// Kimi「添加」：把卡片写进 config.toml，但不改 default_model（「切换」才改）。
    /// Copilot「添加」：把自带模型卡写进 providers.json（不改 Copilot 的默认模型）。
    /// 其他累加式应用的添加就是 `switch`，不走这里。
    pub fn add_to_live_config(
        state: &AppState,
        app_type: AppType,
        id: &str,
    ) -> Result<(), AppError> {
        if app_type == AppType::Copilot {
            let _guard =
                futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
            return Self::add_copilot_to_live(state, id);
        }
        if app_type != AppType::Kimi {
            return Err(AppError::InvalidInput(format!(
                "{} adds providers through switch",
                app_type.as_str()
            )));
        }
        let _guard =
            futures::executor::block_on(state.proxy_service.lock_switch_for_app(app_type.as_str()));
        let mut provider = state
            .db
            .get_provider_by_id(id, "kimi")?
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;
        crate::services::kimi_oauth::ensure_profile_signed_in(&provider.settings_config)?;
        Self::set_provider_live_config_managed(&mut provider, true);
        crate::kimi_config::add_and_commit(id, provider.settings_config.clone(), || {
            state.db.save_provider("kimi", &provider)
        })
    }

    /// Remove provider from live config only (for additive mode apps like OpenCode, OpenClaw)
    ///
    /// Does NOT delete from database - provider remains in the list.
    /// This is used when user wants to "remove" a provider from active config
    /// but keep it available for future use.
    pub fn remove_from_live_config(
        state: &AppState,
        app_type: AppType,
        id: &str,
    ) -> Result<(), AppError> {
        if app_type == AppType::Pi {
            return pi::remove(state, id);
        }
        if app_type == AppType::Omp {
            return omp::remove(state, id);
        }
        if app_type == AppType::Copilot {
            let _guard =
                futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
            if state
                .db
                .get_provider_by_id(id, "copilot")?
                .is_some_and(|row| copilot_direct::is_official(&row))
            {
                return Err(copilot_official_not_added());
            }
            return crate::copilot_config::save_and_commit(id, None, false, || {
                if let Some(mut provider) = state.db.get_provider_by_id(id, "copilot")? {
                    Self::set_provider_live_config_managed(&mut provider, false);
                    state.db.save_provider("copilot", &provider)?;
                }
                Ok(())
            });
        }
        if app_type == AppType::Dsh {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            return crate::dsh_config::save_and_commit(id, None, false, || {
                if let Some(mut provider) = state.db.get_provider_by_id(id, app_type.as_str())? {
                    Self::set_provider_live_config_managed(&mut provider, false);
                    state.db.save_provider(app_type.as_str(), &provider)?;
                }
                Ok(())
            });
        }
        if app_type == AppType::Kimi {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            // An official account leaves Kimi's config but keeps its login and card,
            // so「添加」can put it back.
            return crate::kimi_config::save_and_commit(id, None, false, || {
                if let Some(mut provider) = state.db.get_provider_by_id(id, "kimi")? {
                    Self::set_provider_live_config_managed(&mut provider, false);
                    state.db.save_provider("kimi", &provider)?;
                }
                Ok(())
            });
        }
        match app_type {
            AppType::OpenCode => {
                let provider_category = state
                    .db
                    .get_provider_by_id(id, app_type.as_str())?
                    .and_then(|p| p.category);

                if provider_category.as_deref() == Some("omo") {
                    state
                        .db
                        .clear_omo_provider_current(app_type.as_str(), id, "omo")?;
                    let still_has_current = state
                        .db
                        .get_current_omo_provider("opencode", "omo")?
                        .is_some();
                    if still_has_current {
                        OmoService::write_config_to_file(state, &crate::services::omo::STANDARD)?;
                    } else {
                        OmoService::delete_config_file(&crate::services::omo::STANDARD)?;
                    }
                } else if provider_category.as_deref() == Some("omo-slim") {
                    state
                        .db
                        .clear_omo_provider_current(app_type.as_str(), id, "omo-slim")?;
                    let still_has_current = state
                        .db
                        .get_current_omo_provider("opencode", "omo-slim")?
                        .is_some();
                    if still_has_current {
                        OmoService::write_config_to_file(state, &crate::services::omo::SLIM)?;
                    } else {
                        OmoService::delete_config_file(&crate::services::omo::SLIM)?;
                    }
                } else {
                    remove_opencode_provider_from_live(id)?;
                }
            }
            AppType::OpenClaw => {
                remove_openclaw_provider_from_live(id)?;
            }
            AppType::Hermes => {
                remove_hermes_provider_from_live(id)?;
            }
            AppType::Mcode => crate::mcode_config::remove_provider(id)?,
            _ => {
                return Err(AppError::Message(format!(
                    "App {} does not support remove from live config",
                    app_type.as_str()
                )));
            }
        }

        if let Some(mut provider) = state.db.get_provider_by_id(id, app_type.as_str())? {
            Self::set_provider_live_config_managed(&mut provider, false);
            state.db.save_provider(app_type.as_str(), &provider)?;
        }
        Ok(())
    }

    /// Switch to a provider
    ///
    /// Switch flow:
    /// 1. Validate target provider exists
    /// 2. Check if proxy takeover mode is active AND proxy server is running
    /// 3. If takeover mode active: hot-switch proxy target only (no Live config write)
    /// 4. If normal mode:
    ///    a. **Backfill mechanism**: Backfill current live config to current provider
    ///    b. Update local settings current_provider_xxx (device-level)
    ///    c. Update database is_current (as default for new devices)
    ///    d. Write target provider config to live files
    ///    e. Sync MCP configuration
    pub fn switch(state: &AppState, app_type: AppType, id: &str) -> Result<SwitchResult, AppError> {
        let app = app_type.as_str().to_string();
        let result = Self::switch_inner(state, app_type, id);
        match &result {
            Ok(result) if result.warnings.is_empty() => {
                log::info!("[SWITCH] {app} 切到 {id} 完成");
            }
            Ok(result) => {
                log::warn!(
                    "[SWITCH] {app} 切到 {id} 完成，有警告: {:?}",
                    result.warnings
                );
            }
            // 规则拒绝：什么都没改。
            Err(error @ AppError::Localized { key, .. })
                if *key == "provider.switch.official_blocked_by_proxy"
                    || *key == "switch.desktop_needs_routing"
                    || *key == "agy.switch.unsupported"
                    || *key == "copilot.switch.unsupported" =>
            {
                log::info!("[SWITCH] {app} 拒绝切到 {id}: {error}");
            }
            Err(error) => log::error!(
                "[SWITCH] {app} 切到 {id} 失败: {}",
                crate::error_for_log(&error.to_string())
            ),
        }
        result
    }

    fn switch_inner(
        state: &AppState,
        app_type: AppType,
        id: &str,
    ) -> Result<SwitchResult, AppError> {
        if app_type == AppType::Pi {
            return pi::enable(state, id);
        }
        if app_type == AppType::Omp {
            return omp::enable(state, id);
        }
        // Antigravity 的卡只作用于它打开的终端，没有「启用」（见 agy_config 模块说明）。
        if app_type == AppType::Agy {
            return Err(AppError::localized(
                "agy.switch.unsupported",
                "Antigravity 的卡片不需要启用，用「打开终端」启动即可",
                "Antigravity cards are not enabled; use Open terminal to start one",
            ));
        }
        // Copilot CLI：官方卡只用来打开终端；自带模型卡的「切换」就是添加进 providers.json，
        // 不改 Copilot 自己的默认模型（见 copilot_config 模块说明）。
        if app_type == AppType::Copilot {
            let _guard =
                futures::executor::block_on(state.proxy_service.lock_switch_for_app("copilot"));
            Self::add_copilot_to_live(state, id)?;
            return Ok(SwitchResult::default());
        }
        let _service = if crate::mode::controller::PROXY_APPS.contains(&app_type) {
            Some(futures::executor::block_on(
                crate::mode::controller::lock_service(),
            ))
        } else {
            None
        };
        if matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            crate::mode::operation::settle(state.db.as_ref(), app_type.as_str())?;
        }
        // Check if provider exists
        let providers = state.db.get_all_providers(app_type.as_str())?;
        let _provider = providers
            .get(id)
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

        if app_type == AppType::Dsh {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            let mut provider = _provider.clone();
            Self::set_provider_live_config_managed(&mut provider, true);
            crate::dsh_config::save_and_commit(
                id,
                Some(provider.settings_config.clone()),
                false,
                || state.db.save_provider(app_type.as_str(), &provider),
            )?;
            return Ok(SwitchResult::default());
        }

        if matches!(app_type, AppType::ClaudeDesktop) {
            return Self::switch_desktop(state, _provider);
        }

        if app_type == AppType::Kimi {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );
            crate::services::kimi_oauth::ensure_profile_signed_in(&_provider.settings_config)?;
            let mut provider = _provider.clone();
            Self::set_provider_live_config_managed(&mut provider, true);
            crate::kimi_config::switch_and_commit(
                id,
                provider.settings_config.clone(),
                |config| {
                    provider.settings_config = config;
                    state.db.save_provider("kimi", &provider)
                },
            )?;
            return Ok(SwitchResult::default());
        }

        if crate::mode::current::mode_state(&app_type).is_proxy() {
            log::info!(
                "[SWITCH] {} 代理模式：路由 {} → {id}",
                app_type.as_str(),
                crate::mode::current::mode_state(&app_type)
                    .proxy_route
                    .as_deref()
                    .unwrap_or("（无）")
            );
            let route = futures::executor::block_on(crate::mode::controller::set_route_locked(
                state, &app_type, id,
            ))?;
            // MCP 不随路由变：客户端文件没按直连重写。
            return Ok(SwitchResult {
                route: Some(route),
                ..Default::default()
            });
        }

        // OMO providers are switched through their own exclusive path.
        if matches!(app_type, AppType::OpenCode) && _provider.category.as_deref() == Some("omo") {
            return Self::switch_normal(state, app_type, id, &providers);
        }

        // OMO Slim providers are switched through their own exclusive path.
        if matches!(app_type, AppType::OpenCode)
            && _provider.category.as_deref() == Some("omo-slim")
        {
            return Self::switch_normal(state, app_type, id, &providers);
        }

        let _switch_guard = if matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            Some(futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            ))
        } else {
            None
        };

        // 备份或 live 占位符存在即表示 Routing 持有 live；代理进程暂时停止也不能普通覆写。
        let is_app_taken_over =
            futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))
                .ok()
                .flatten()
                .is_some();
        let live_taken_over = state
            .proxy_service
            .detect_takeover_in_live_config_for_app(&app_type);
        let should_hot_switch = is_app_taken_over || live_taken_over;

        if should_hot_switch
            && _provider.category.as_deref() == Some("official")
            && !official_provider_supports_proxy_takeover(&app_type, _provider)
        {
            return Err(AppError::localized(
                "provider.switch.official_blocked_by_proxy",
                "Routing 激活时不能切换到官方供应商，经由本地代理访问官方 API 可能导致账号风险。请先关闭 Routing，或改用第三方供应商。",
                "Cannot switch to an official provider while routing is active. Sending official API traffic through the local proxy may put the account at risk. Disable routing first or switch to a third-party provider.",
            ));
        }

        if should_hot_switch {
            // Proxy takeover mode: hot-switch only, don't write Live config
            log::info!(
                "代理接管模式：热切换 {} 的目标供应商为 {}",
                app_type.as_str(),
                id
            );

            // 获取新供应商的完整配置（用于更新备份）
            let provider = providers
                .get(id)
                .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

            // Update database is_current
            state.db.set_current_provider(app_type.as_str(), id)?;

            // Update local settings for consistency
            crate::settings::set_current_provider(&app_type, Some(id))?;

            // 更新 Live 备份（确保代理关闭时恢复正确的供应商配置）
            futures::executor::block_on(
                crate::services::proxy::ProxyService::update_live_backup_from_provider_for_db(
                    state.db.as_ref(),
                    app_type.as_str(),
                    provider,
                ),
            )
            .map_err(|e| AppError::Message(format!("更新 Live 备份失败: {e}")))?;

            // 接管模式下按目标供应商重写 Claude Live：模型字段写成稳定角色别名与
            // 真实显示名，Claude Code 模型菜单随供应商切换（上游 f93b935d）。
            if matches!(app_type, AppType::Claude) {
                if let Err(e) = futures::executor::block_on(
                    state
                        .proxy_service
                        .sync_claude_live_from_provider_while_proxy_active(provider),
                ) {
                    log::warn!("同步 Claude 接管 Live 失败（不影响切换结果）: {e}");
                }
            } else if matches!(app_type, AppType::Codex) {
                futures::executor::block_on(state.proxy_service.reapply_codex_takeover_live())
                    .map_err(|e| AppError::Message(format!("刷新 Codex 接管配置失败: {e}")))?;
            }

            // Note: No Live config write, no MCP sync
            // The proxy server will route requests to the new provider via is_current
            return Ok(SwitchResult::default());
        }

        // Normal mode: full switch with Live config write
        Self::switch_normal(state, app_type, id, &providers)
    }

    /// Normal switch flow (non-proxy mode)
    fn switch_normal(
        state: &AppState,
        app_type: AppType,
        id: &str,
        providers: &indexmap::IndexMap<String, Provider>,
    ) -> Result<SwitchResult, AppError> {
        let provider = providers
            .get(id)
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

        if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo") {
            state
                .db
                .set_omo_provider_current(app_type.as_str(), id, "omo")?;
            OmoService::write_config_to_file(state, &crate::services::omo::STANDARD)?;
            // OMO ↔ OMO Slim mutually exclusive: remove Slim config
            let _ = OmoService::delete_config_file(&crate::services::omo::SLIM);
            return Ok(SwitchResult::default());
        }

        if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo-slim")
        {
            state
                .db
                .set_omo_provider_current(app_type.as_str(), id, "omo-slim")?;
            OmoService::write_config_to_file(state, &crate::services::omo::SLIM)?;
            // OMO ↔ OMO Slim mutually exclusive: remove Standard config
            let _ = OmoService::delete_config_file(&crate::services::omo::STANDARD);
            return Ok(SwitchResult::default());
        }

        if app_type == AppType::Claude {
            let current = crate::settings::get_effective_current_provider(&state.db, &app_type)?;
            let previous = current.as_deref().and_then(|id| providers.get(id));
            claude_direct::switch_to(state.db.as_ref(), previous, provider)?;
            return Ok(SwitchResult::default());
        }

        if app_type == AppType::Gemini {
            gemini_direct::switch_to(&state.db, provider)?;
            return Ok(SwitchResult::default());
        }
        if app_type == AppType::GrokBuild {
            let previous = grok_direct::current_provider(&state.db)?;
            grok_direct::switch_to(&state.db, previous.as_ref(), provider)?;
            return Ok(SwitchResult::default());
        }
        if app_type == AppType::Codex {
            let previous = codex_direct::current_provider(&state.db)?;
            codex_direct::write_direct(state, previous.as_ref(), provider, true, None)?;
            return Ok(SwitchResult::default());
        }
        let mut result = SwitchResult::default();

        // Backfill: Backfill current live config to current provider
        // Use effective current provider (validated existence) to ensure backfill targets valid provider
        let current_id = crate::settings::get_effective_current_provider(&state.db, &app_type)?;
        let current_managed_codex_account_id = current_id
            .as_deref()
            .and_then(|current_id| providers.get(current_id))
            .and_then(Self::managed_codex_oauth_account_id);

        let mut backfill_completed = false;
        if let Some(current_id) = current_id.as_deref() {
            if current_id != id {
                // Additive mode apps - all providers coexist in the same file,
                // no backfill needed (backfill is for exclusive mode apps like Claude/Codex/Gemini)
                if !app_type.is_additive_mode() {
                    // Only backfill when switching to a different provider
                    if let Ok(live_config) = read_live_settings(app_type.clone()) {
                        if let Some(mut current_provider) = providers.get(current_id).cloned() {
                            let retired_entries = Self::sync_common_config_snippet_from_live(
                                state,
                                &app_type,
                                &current_provider,
                                &live_config,
                                &mut result,
                            );
                            current_provider.settings_config =
                                strip_common_config_from_live_settings(
                                    state.db.as_ref(),
                                    &app_type,
                                    &current_provider,
                                    live_config,
                                );
                            if let Some(retired) = retired_entries.as_deref() {
                                current_provider.settings_config =
                                    live::remove_common_config_from_settings(
                                        &app_type,
                                        &current_provider.settings_config,
                                        retired,
                                    )?;
                            }
                            if let Some(account_id) = current_managed_codex_account_id.as_deref() {
                                let live_auth = current_provider.settings_config.get("auth");
                                if live_auth.is_some_and(|auth| {
                                    crate::codex_config::codex_live_auth_is_managed_chatgpt_login(
                                        auth, account_id,
                                    )
                                }) {
                                    let stored_auth = providers
                                        .get(current_id)
                                        .and_then(|provider| provider.settings_config.get("auth"))
                                        .cloned()
                                        .unwrap_or_else(|| serde_json::json!({}));
                                    current_provider.settings_config["auth"] = stored_auth;
                                }
                            }
                            if let Err(e) =
                                state.db.save_provider(app_type.as_str(), &current_provider)
                            {
                                log::warn!("Backfill failed: {e}");
                                result
                                    .warnings
                                    .push(format!("backfill_failed:{current_id}"));
                            } else {
                                backfill_completed = true;
                            }
                        }
                    }
                }
            }
        }

        let target_managed_codex_account_id = Self::managed_codex_oauth_account_id(provider);
        let outgoing_managed_codex_account_id = current_managed_codex_account_id
            .as_ref()
            .filter(|account_id| target_managed_codex_account_id.as_ref() != Some(*account_id))
            .cloned();
        let outgoing_live_auth_guard = Self::prepare_outgoing_managed_codex_live_auth(
            state,
            outgoing_managed_codex_account_id.as_deref(),
        )?;
        let prepared_provider = Self::preflight_managed_codex_provider(state, &app_type, provider)?;
        let provider_for_live = prepared_provider.as_ref().unwrap_or(provider);
        let managed_codex_transition = matches!(app_type, AppType::Codex)
            && (current_managed_codex_account_id.is_some()
                || target_managed_codex_account_id.is_some());

        if managed_codex_transition {
            let snapshot = crate::codex_config::CodexLiveStateSnapshot::capture()?;
            let live_result = (|| {
                if let (Some(account_id), Some(guard)) = (
                    outgoing_managed_codex_account_id.as_deref(),
                    outgoing_live_auth_guard.as_ref(),
                ) {
                    guard.ensure_unchanged(account_id)?;
                }
                write_live_with_common_config(state.db.as_ref(), &app_type, provider_for_live)?;
                if let Some(account_id) = target_managed_codex_account_id.as_deref() {
                    if let Some(auth) = provider_for_live.settings_config.get("auth") {
                        crate::codex_config::record_codex_managed_oauth_live_auth(
                            auth, account_id,
                        )?;
                    }
                }
                if let (Some(account_id), Some(guard)) = (
                    outgoing_managed_codex_account_id.as_deref(),
                    outgoing_live_auth_guard.as_ref(),
                ) {
                    guard.clear_outgoing(account_id)?;
                }
                Ok::<(), AppError>(())
            })();
            if let Err(error) = live_result {
                return Err(Self::managed_codex_transaction_error(
                    "写入 Codex Live",
                    error,
                    &snapshot,
                    None,
                ));
            }

            let previous_local_current = crate::settings::get_current_provider(&app_type);
            if let Err(error) = crate::settings::set_current_provider(&app_type, Some(id)) {
                return Err(Self::managed_codex_transaction_error(
                    "更新本地 current",
                    error,
                    &snapshot,
                    Some((&app_type, previous_local_current.as_deref())),
                ));
            }
            if let Err(error) = state.db.set_current_provider(app_type.as_str(), id) {
                return Err(Self::managed_codex_transaction_error(
                    "更新数据库 current",
                    error,
                    &snapshot,
                    Some((&app_type, previous_local_current.as_deref())),
                ));
            }
        } else {
            // Codex：提交 current 之前先校验 live 投影——写入层安全闸门可能拒绝本次切换，
            // 若 current 已切换再被拒绝，下一次切换会把旧 live 配置回填进新 Provider。
            if matches!(app_type, AppType::Codex) {
                live::preflight_codex_live_write(state.db.as_ref(), provider_for_live)?;
            }
            // Additive mode apps skip setting is_current (no such concept)
            if !app_type.is_additive_mode() {
                crate::settings::set_current_provider(&app_type, Some(id))?;
                state.db.set_current_provider(app_type.as_str(), id)?;
            }

            // providers: map entries are owned by Hermes and must not be rewritten as custom providers.
            if !matches!(app_type, AppType::Hermes) || !Self::is_hermes_read_only_provider(provider)
            {
                write_live_with_common_config(state.db.as_ref(), &app_type, provider_for_live)?;
            }
        }
        if matches!(app_type, AppType::Codex)
            && backfill_completed
            && crate::proxy::providers::is_codex_official_provider(provider)
            && target_managed_codex_account_id.is_none()
        {
            let db_auth = provider.settings_config.get("auth");
            if let Err(error) =
                crate::codex_config::clear_stale_codex_live_auth_after_official_switch(
                    db_auth.unwrap_or(&serde_json::Value::Null),
                )
            {
                log::warn!("Failed to clean stale Codex auth.json: {error}");
            }
        }
        // 与上面官方切换对应的第三方分支：关闭登录保留时 config-only 写入应删除
        // auth.json。删除失败（只读目录、ACL、文件锁）不应让切换失败——config 与
        // current 已提交——但要以切换警告提示用户官方登录仍留在磁盘上。
        if matches!(app_type, AppType::Codex)
            && provider.category.as_deref() != Some("official")
            && !crate::proxy::providers::is_codex_official_provider(provider)
            && !crate::settings::preserve_codex_official_auth_on_switch()
            && crate::codex_config::get_codex_auth_path().exists()
        {
            log::warn!("Codex auth.json still present after a preservation-off third-party switch");
            result
                .warnings
                .push("codex_auth_cleanup_failed".to_string());
        }
        if matches!(app_type, AppType::Hermes) {
            crate::hermes_config::apply_switch_defaults(&provider.id, &provider.settings_config)?;
        }

        if app_type.is_additive_mode() && Self::provider_live_config_managed(provider) != Some(true)
        {
            let mut updated = provider.clone();
            Self::set_provider_live_config_managed(&mut updated, true);
            if let Err(e) = state.db.save_provider(app_type.as_str(), &updated) {
                let rollback_result = match app_type {
                    AppType::OpenCode => remove_opencode_provider_from_live(&provider.id),
                    AppType::OpenClaw => remove_openclaw_provider_from_live(&provider.id),
                    AppType::Hermes => remove_hermes_provider_from_live(&provider.id),
                    AppType::Mcode => crate::mcode_config::remove_provider(&provider.id),
                    AppType::Kimi => crate::kimi_config::remove_provider(&provider.id),
                    AppType::Dsh => crate::dsh_config::remove_provider(&provider.id),
                    _ => Ok(()),
                };

                match rollback_result {
                    Ok(()) => {
                        return Err(AppError::Message(format!(
                            "Failed to persist live_config_managed for '{}' after writing live config; live changes were rolled back: {e}",
                            provider.id
                        )));
                    }
                    Err(rollback_err) => {
                        return Err(AppError::Message(format!(
                            "Failed to persist live_config_managed for '{}' after writing live config: {e}; additionally failed to roll back live config: {rollback_err}",
                            provider.id
                        )));
                    }
                }
            }
        }

        if let Err(error) = McpService::sync_enabled_for_app(state, &app_type) {
            log::warn!("切换供应商后重投影 {app_type:?} MCP 失败（将在下次同步时自愈）: {error}");
        }

        Ok(result)
    }

    /// Sync current provider to live configuration (re-export)
    pub fn sync_current_to_live(state: &AppState) -> Result<(), AppError> {
        sync_current_to_live(state)
    }

    pub fn sync_current_provider_for_app(
        state: &AppState,
        app_type: AppType,
    ) -> Result<(), AppError> {
        if app_type.is_additive_mode() {
            return sync_current_provider_for_app_to_live(state, &app_type);
        }
        let _service = futures::executor::block_on(crate::mode::controller::lock_service());
        let _switch_guard = if matches!(
            app_type,
            AppType::Claude
                | AppType::Codex
                | AppType::Gemini
                | AppType::GrokBuild
                | AppType::ClaudeDesktop
        ) {
            Some(futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            ))
        } else {
            None
        };

        crate::mode::operation::settle(&state.db, app_type.as_str())?;
        if futures::executor::block_on(crate::mode::controller::reapply_after_save_locked(
            state, &app_type, None,
        ))? {
            return Ok(());
        }
        if crate::mode::current::is_proxy(&app_type) {
            return Ok(());
        }

        let current_id =
            match crate::settings::get_effective_current_provider(&state.db, &app_type)? {
                Some(id) => id,
                None => return Ok(()),
            };

        let providers = state.db.get_all_providers(app_type.as_str())?;
        let Some(provider) = providers.get(&current_id) else {
            return Ok(());
        };

        let (owned, has_live_backup) = proxy_owns_live_config(state, &app_type);
        if !owned && has_live_backup {
            refresh_stale_live_backup(state, &app_type, provider);
        }

        if owned {
            futures::executor::block_on(
                crate::services::proxy::ProxyService::update_live_backup_from_provider_for_db(
                    state.db.as_ref(),
                    app_type.as_str(),
                    provider,
                ),
            )
            .map_err(|e| AppError::Message(format!("更新 Live 备份失败: {e}")))?;
            return Ok(());
        }

        sync_current_provider_for_app_to_live(state, &app_type)
    }

    pub(crate) fn migrate_legacy_common_config_usage(
        state: &AppState,
        app_type: AppType,
        legacy_snippet: &str,
    ) -> Result<(), AppError> {
        if matches!(
            app_type,
            AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
        ) {
            return Ok(());
        }
        if app_type.is_additive_mode() || legacy_snippet.trim().is_empty() {
            return Ok(());
        }

        let providers = state.db.get_all_providers(app_type.as_str())?;

        for provider in providers.values() {
            if provider
                .meta
                .as_ref()
                .and_then(|meta| meta.common_config_enabled)
                .is_some()
            {
                continue;
            }

            if !live::provider_uses_common_config(&app_type, provider, Some(legacy_snippet)) {
                continue;
            }

            let mut updated_provider = provider.clone();
            updated_provider
                .meta
                .get_or_insert_with(Default::default)
                .common_config_enabled = Some(true);

            match live::remove_common_config_from_settings(
                &app_type,
                &updated_provider.settings_config,
                legacy_snippet,
            ) {
                Ok(settings) => updated_provider.settings_config = settings,
                Err(err) => {
                    log::warn!(
                        "Failed to normalize legacy common config for {} provider '{}': {err}",
                        app_type.as_str(),
                        updated_provider.id
                    );
                }
            }

            state
                .db
                .save_provider(app_type.as_str(), &updated_provider)?;
        }

        Ok(())
    }

    pub(crate) fn migrate_legacy_common_config_usage_if_needed(
        state: &AppState,
        app_type: AppType,
    ) -> Result<(), AppError> {
        if app_type.is_additive_mode() {
            return Ok(());
        }

        let Some(snippet) = state.db.get_config_snippet(app_type.as_str())? else {
            return Ok(());
        };

        if snippet.trim().is_empty() {
            return Ok(());
        }

        Self::migrate_legacy_common_config_usage(state, app_type, &snippet)
    }

    /// 切走前把 Claude/Codex live 中的共享改动整体重提取回通用配置片段。
    fn sync_common_config_snippet_from_live(
        state: &AppState,
        app_type: &AppType,
        provider: &Provider,
        live_config: &Value,
        result: &mut SwitchResult,
    ) -> Option<String> {
        if !matches!(app_type, AppType::Claude | AppType::Codex)
            || provider
                .meta
                .as_ref()
                .and_then(|meta| meta.common_config_enabled)
                != Some(true)
        {
            return None;
        }

        match state.db.is_config_snippet_cleared(app_type.as_str()) {
            Ok(true) => return None,
            Ok(false) => {}
            Err(error) => {
                log::warn!("读取 {} 通用配置清空标记失败: {error}", app_type.as_str());
                return None;
            }
        }

        let new_snippet = match Self::extract_common_config_snippet_from_settings(
            app_type.clone(),
            live_config,
        ) {
            Ok(snippet) => snippet,
            Err(error) => {
                log::warn!(
                    "从 {} Provider '{}' live 配置提取通用配置失败: {error}",
                    app_type.as_str(),
                    provider.id
                );
                return None;
            }
        };
        // 重提取前保留旧片段，回填须剥除本次不再共享的键值。
        let current = match state.db.get_config_snippet(app_type.as_str()) {
            Ok(current) => current,
            Err(error) => {
                log::warn!("读取旧通用配置失败，跳过重提取: {error}");
                result
                    .warnings
                    .push(format!("common_config_sync_failed:{}", provider.id));
                return None;
            }
        };
        if current.as_deref() == Some(new_snippet.as_str()) {
            return None;
        }

        if let Err(error) = state
            .db
            .set_config_snippet(app_type.as_str(), Some(new_snippet))
        {
            log::warn!(
                "保存 {} Provider '{}' 自动同步的通用配置失败: {error}",
                app_type.as_str(),
                provider.id
            );
            result
                .warnings
                .push(format!("common_config_sync_failed:{}", provider.id));
            return None;
        }
        current
            .as_deref()
            .and_then(|old| Self::retired_snippet_entries(app_type, old, live_config))
    }

    /// 旧片段里、按现行提取规则不再共享的条目（凭据、关键字段），序列化成可交给
    /// `remove_common_config_from_settings` 的片段文本；没有则返回 `None`。
    ///
    /// 提取规则收紧后（补上 `ANTHROPIC_CUSTOM_HEADERS` 这类凭据、`CLAUDE_CODE_USE_BEDROCK`
    /// 这类关键字段），存量片段里还留着这些条目，并已合并进当前 live。重提取会把它们从
    /// 片段里去掉，但回填按**新**片段剥离，就剥不掉它们，于是某一家的自定义头、Bedrock
    /// 选择器会被永久写进**当前**供应商的行。所以切换时要按旧片段里的值再剥一次。
    ///
    /// 例外：当前供应商自己带着 AWS / Google 的凭据时，同家族的选择器和区域是它自己的
    /// （片段收走它们时，也从它的行里剥掉了），不剥。凭据键从不进片段，一定是这一家的。
    ///
    /// 代价：别的供应商如果把自己的选择器或区域交给了片段，这次之后要重填一次；
    /// `/model` 的选择回到默认模型。与 `scrub_leaked_gemini_common_config` 取舍一致：
    /// 宁可让人重填，也不把一家的凭据和路由留在别家的行里。
    ///
    /// Codex 同样按旧片段剥除新规则排除的模型、推理档位和选路字段。
    fn retired_snippet_entries(app_type: &AppType, snippet: &str, live: &Value) -> Option<String> {
        if matches!(app_type, AppType::Codex) {
            let shared = Self::extract_codex_common_config(&serde_json::json!({
                "config": snippet
            }))
            .ok()?;
            let retired = live::update_toml_common_config_snippet(snippet, &shared, false).ok()?;
            let doc = retired.parse::<toml_edit::DocumentMut>().ok()?;
            return (!doc.as_table().is_empty()).then_some(retired);
        }
        if !matches!(app_type, AppType::Claude) {
            return None;
        }
        let Ok(Value::Object(entries)) = serde_json::from_str::<Value>(snippet) else {
            return None;
        };

        let owns_aws = Self::claude_owns_credentials(live, "AWS_");
        let owns_google = Self::claude_owns_credentials(live, "GOOGLE_");
        let keep = |key: &str| {
            (owns_aws && Self::is_claude_aws_family_key(key))
                || (owns_google && Self::is_claude_google_family_key(key))
        };

        let mut retired = serde_json::Map::new();
        for (key, value) in entries {
            if key == "env" {
                let Value::Object(env) = value else {
                    continue;
                };
                let env: serde_json::Map<String, Value> = env
                    .into_iter()
                    .filter(|(name, _)| !Self::claude_env_key_is_shared(name) && !keep(name))
                    .collect();
                if !env.is_empty() {
                    retired.insert(key, Value::Object(env));
                }
            } else if !Self::claude_top_key_is_shared(&key) && !keep(&key) {
                retired.insert(key, value);
            }
        }

        (!retired.is_empty()).then(|| Value::Object(retired).to_string())
    }

    /// live 里是否有这家自己的某类凭据：`env` 里带该前缀的敏感键。AWS 另认旧 Bedrock
    /// API Key 预设写在顶层的 `apiKey`（Claude Code 自身没有这个设置）。
    fn claude_owns_credentials(live: &Value, env_prefix: &str) -> bool {
        let in_env = live
            .get("env")
            .and_then(Value::as_object)
            .is_some_and(|env| {
                env.keys()
                    .any(|key| key.starts_with(env_prefix) && Self::is_sensitive_config_key(key))
            });
        in_env || (env_prefix == "AWS_" && live.get("apiKey").is_some())
    }

    fn is_claude_aws_family_key(key: &str) -> bool {
        key.starts_with("AWS_")
            || key.starts_with("ANTHROPIC_BEDROCK_")
            || matches!(
                key,
                "CLAUDE_CODE_USE_BEDROCK"
                    | "CLAUDE_CODE_USE_ANTHROPIC_AWS"
                    | "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION"
                    | "awsAuthRefresh"
                    | "awsCredentialExport"
            )
    }

    fn is_claude_google_family_key(key: &str) -> bool {
        key.starts_with("GOOGLE_")
            || key.starts_with("VERTEX_REGION_")
            || key.starts_with("ANTHROPIC_VERTEX_")
            || matches!(
                key,
                "CLAUDE_CODE_USE_VERTEX"
                    | "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD"
                    | "CLOUD_ML_REGION"
                    | "gcpAuthRefresh"
            )
    }

    /// Extract common config snippet from current provider
    ///
    /// Extracts the current provider's configuration and removes provider-specific fields
    /// (API keys, model settings, endpoints) to create a reusable common config snippet.
    pub fn extract_common_config_snippet(
        state: &AppState,
        app_type: AppType,
    ) -> Result<String, AppError> {
        // Get current provider
        let current_id = Self::current(state, app_type.clone())?;
        if current_id.is_empty() {
            return Err(AppError::Message("No current provider".to_string()));
        }

        let providers = state.db.get_all_providers(app_type.as_str())?;
        let provider = providers
            .get(&current_id)
            .ok_or_else(|| AppError::Message(format!("Provider {current_id} not found")))?;

        match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                Self::extract_claude_common_config(&provider.settings_config)
            }
            AppType::Codex => Self::extract_codex_common_config(&provider.settings_config),
            AppType::Gemini => Self::extract_gemini_common_config(&provider.settings_config),
            AppType::GrokBuild => Ok(String::new()),
            AppType::OpenCode => Self::extract_opencode_common_config(&provider.settings_config),
            AppType::OpenClaw => Self::extract_openclaw_common_config(&provider.settings_config),
            AppType::Hermes => Ok(String::new()),
            AppType::Pi
            | AppType::Mcode
            | AppType::Kimi
            | AppType::Dsh
            | AppType::Agy
            | AppType::Omp
            | AppType::Copilot => Ok(String::new()),
        }
    }

    /// Extract common config snippet from a config value (e.g. editor content).
    pub fn extract_common_config_snippet_from_settings(
        app_type: AppType,
        settings_config: &Value,
    ) -> Result<String, AppError> {
        match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                Self::extract_claude_common_config(settings_config)
            }
            AppType::Codex => Self::extract_codex_common_config(settings_config),
            AppType::Gemini => Self::extract_gemini_common_config(settings_config),
            AppType::GrokBuild => Ok(String::new()),
            AppType::OpenCode => Self::extract_opencode_common_config(settings_config),
            AppType::OpenClaw => Self::extract_openclaw_common_config(settings_config),
            AppType::Hermes => Ok(String::new()),
            AppType::Pi
            | AppType::Mcode
            | AppType::Kimi
            | AppType::Dsh
            | AppType::Agy
            | AppType::Omp
            | AppType::Copilot => Ok(String::new()),
        }
    }

    /// Claude `env` 里的键能否进通用配置片段。
    ///
    /// 片段会合并进每一家勾选了它的供应商，所以只能放与供应商无关的设置。关键字段
    /// （请求发到哪、凭什么鉴权、哪个模型名、哪种协议）一旦进了片段，就会跟着切换带给
    /// 下一家：从 Bedrock 切到官方后，官方的 live 里还留着 `CLAUDE_CODE_USE_BEDROCK=1`，
    /// Claude Code 继续走 Bedrock。凭据另由 `is_sensitive_config_key` 统一剥离。
    fn claude_env_key_is_shared(key: &str) -> bool {
        // Context limits follow the actual upstream model. Sharing these
        // across providers can cap GPT/Kimi to the wrong window and make
        // Claude Code compact too early or miss the upstream limit.
        const UPSTREAM_WINDOW_KEYS: &[&str] = &[
            "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
            "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
        ];

        !crate::live::floor::claude_floor_env(key)
            && !UPSTREAM_WINDOW_KEYS.contains(&key)
            && !Self::is_sensitive_config_key(key)
    }

    /// Claude 顶层键能否进通用配置片段，口径同 [`Self::claude_env_key_is_shared`]。
    /// `model` 是 `/model` 保存的选择，属于当时那一家。
    fn claude_top_key_is_shared(key: &str) -> bool {
        !crate::live::floor::claude_floor_top(key) && !Self::is_sensitive_config_key(key)
    }

    /// Extract common config for Claude (JSON format)
    fn extract_claude_common_config(settings: &Value) -> Result<String, AppError> {
        let mut config = settings.clone();

        if let Some(obj) = config.as_object_mut() {
            if let Some(Value::Object(env)) = obj.get_mut("env") {
                env.retain(|key, _| Self::claude_env_key_is_shared(key));
            }
            obj.retain(|key, value| match key.as_str() {
                "env" => !value.as_object().is_some_and(|env| env.is_empty()),
                _ => Self::claude_top_key_is_shared(key),
            });
        }

        // Check if result is empty
        if config.as_object().is_none_or(|obj| obj.is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Extract common config for Codex (TOML format)
    fn extract_codex_common_config(settings: &Value) -> Result<String, AppError> {
        // Codex config is stored as { "auth": {...}, "config": "toml string" }
        let config_toml = settings
            .get("config")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if config_toml.is_empty() {
            return Ok(String::new());
        }

        let mut doc = config_toml
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| AppError::Message(format!("TOML parse error: {e}")))?;

        // 关键字段（选路、模型名、推理档位等，见 `live::floor`）归供应商，不进片段：
        // 避免将一家供应商的连接配置共享给其他供应商。
        let root = doc.as_table_mut();
        for key in crate::live::floor::CODEX_FLOOR_TOP {
            root.remove(key);
        }
        for path in crate::live::floor::CODEX_FLOOR_NESTED {
            let [parent, key] = path else { continue };
            if let Some(table) = root
                .get_mut(parent)
                .and_then(|item| item.as_table_like_mut())
            {
                table.remove(key);
                if table.is_empty() {
                    root.remove(parent);
                }
            }
        }

        // Remove entire model_providers table (provider-specific configuration)
        root.remove("model_providers");

        // MCP 服务器归 DB mcp_servers 表所有：进了共享片段会绕过按应用的
        // 启用状态被合并进所有勾选通用配置的供应商，且在通用配置编辑框里
        // 显示为一份"重复"的 MCP 配置。
        root.remove("mcp_servers");
        // 历史错误格式 [mcp.servers] 一并剥离（与 strip_codex_mcp_servers_from_settings
        // 一致）：sync_all_enabled 只管理 [mcp_servers.*]，legacy 形态一旦进了
        // 片段就会被合并进所有供应商，且没有任何同步路径能清掉这个孤儿。
        if let Some(mcp_tbl) = root
            .get_mut("mcp")
            .and_then(|item| item.as_table_like_mut())
        {
            mcp_tbl.remove("servers");
            if mcp_tbl.is_empty() {
                root.remove("mcp");
            }
        }

        // cc-switch 写 live 时注入的产物一律不进共享片段：
        // - experimental_bearer_token 正常写在 [model_providers.<id>] 内（上面
        //   整表已剥），但无活跃路由 / 内建保留 id / 路由表缺失三种 fallback
        //   会落在顶层——不剥等于把 API 密钥写进共享片段。
        root.remove("experimental_bearer_token");
        // - model_catalog_json 指向按供应商生成的 catalog 投影文件（DB 为 SSOT）。
        root.remove("model_catalog_json");
        // - web_search 只剥 cc-switch 注入的 "disabled" 哨兵；用户手设的其它值
        //   属于可共享偏好，保留。
        if root
            .get(crate::codex_config::CODEX_WEB_SEARCH_FIELD)
            .and_then(|item| item.as_str())
            == Some(crate::codex_config::CODEX_WEB_SEARCH_DISABLED)
        {
            root.remove(crate::codex_config::CODEX_WEB_SEARCH_FIELD);
        }

        // Clean up multiple empty lines (keep at most one blank line).
        let mut cleaned = String::new();
        let mut blank_run = 0usize;
        for line in doc.to_string().lines() {
            if line.trim().is_empty() {
                blank_run += 1;
                if blank_run <= 1 {
                    cleaned.push('\n');
                }
                continue;
            }
            blank_run = 0;
            cleaned.push_str(line);
            cleaned.push('\n');
        }

        Ok(cleaned.trim().to_string())
    }

    /// Extract common config for Gemini (JSON format)
    ///
    /// Extracts `.env` values while excluding provider-specific credentials:
    /// - GOOGLE_GEMINI_BASE_URL
    /// - GEMINI_API_KEY
    fn extract_gemini_common_config(settings: &Value) -> Result<String, AppError> {
        let env = settings.get("env").and_then(|v| v.as_object());

        let mut snippet = serde_json::Map::new();
        if let Some(env) = env {
            for (key, value) in env {
                // 关键字段（地址、凭据、模型名、Vertex 选择器）归供应商，不进片段：
                // 防止模型名和认证方式随通用配置传播到其他供应商。凭据另交给
                // `is_sensitive_config_key` 统一模式匹配（与 Claude 提取器一致），
                // 兜住关键字段清单以外的 `*_API_KEY`、`*_TOKEN`。
                if crate::live::floor::gemini_floor_env(key) || Self::is_sensitive_config_key(key) {
                    continue;
                }
                let Value::String(v) = value else {
                    continue;
                };
                let trimmed = v.trim();
                if !trimmed.is_empty() {
                    snippet.insert(key.to_string(), Value::String(trimmed.to_string()));
                }
            }
        }

        if snippet.is_empty() {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&Value::Object(snippet))
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    pub async fn scrub_leaked_gemini_common_config(state: &AppState) -> Result<(), AppError> {
        const FLAG: &str = "gemini_common_config_credentials_scrubbed_v1";
        const AUDIT_KEY: &str = "gemini_common_config_scrub_audit_v1";
        let app = AppType::Gemini;

        if state.db.get_setting(FLAG)?.as_deref() == Some("true") {
            return Ok(());
        }

        let Some(snippet_text) = state.db.get_config_snippet(app.as_str())? else {
            state.db.set_setting(FLAG, "true")?;
            return Ok(());
        };
        let Ok(Value::Object(entries)) = serde_json::from_str::<Value>(&snippet_text) else {
            state.db.set_setting(FLAG, "true")?;
            return Ok(());
        };

        let mut leaked = serde_json::Map::new();
        let mut clean = serde_json::Map::new();
        for (key, value) in entries {
            if Self::is_sensitive_config_key(&key) {
                leaked.insert(key, value);
            } else {
                clean.insert(key, value);
            }
        }
        if leaked.is_empty() {
            state.db.set_setting(FLAG, "true")?;
            return Ok(());
        }

        let leaked_keys: Vec<String> = leaked.keys().cloned().collect();
        let leaked_value = Value::Object(leaked);
        let leaked_text = serde_json::to_string(&leaked_value)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))?;

        let providers = state.db.get_all_providers(app.as_str())?;
        let mut pending = Vec::new();
        for (id, provider) in providers {
            let cleaned = live::remove_common_config_from_settings(
                &app,
                &provider.settings_config,
                &leaked_text,
            )?;
            if cleaned != provider.settings_config {
                pending.push((id, provider, cleaned));
            }
        }

        let removed_env_keys = |before: &Value, after: &Value| -> Vec<String> {
            let before_env = before.get("env").and_then(Value::as_object);
            let after_env = after.get("env").and_then(Value::as_object);
            match (before_env, after_env) {
                (Some(before_env), Some(after_env)) => before_env
                    .keys()
                    .filter(|key| !after_env.contains_key(*key))
                    .cloned()
                    .collect(),
                (Some(before_env), None) => before_env.keys().cloned().collect(),
                _ => Vec::new(),
            }
        };
        let audit = serde_json::json!({
            "removedFromSnippet": leaked_keys,
            "providers": pending
                .iter()
                .map(|(id, provider, cleaned)| serde_json::json!({
                    "id": id,
                    "removedKeys": removed_env_keys(&provider.settings_config, cleaned),
                }))
                .collect::<Vec<_>>(),
        });
        if state.db.get_setting(AUDIT_KEY)?.is_none() {
            state.db.set_setting(
                AUDIT_KEY,
                &serde_json::to_string(&audit)
                    .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))?,
            )?;
        }

        for (id, provider, cleaned) in pending {
            let mut updated = provider;
            updated.settings_config = cleaned;
            state.db.save_provider(app.as_str(), &updated)?;
            log::info!("已从 Gemini 供应商 '{id}' 中清除泄漏的共享凭据");
        }

        if let Some(backup) = state.db.get_live_backup(app.as_str()).await? {
            let original: Value = serde_json::from_str(&backup.original_config)
                .map_err(|e| AppError::Message(format!("解析 Gemini 代理接管备份失败: {e}")))?;
            let cleaned = live::remove_common_config_from_settings(&app, &original, &leaked_text)?;
            if cleaned != original {
                state
                    .db
                    .save_live_backup(
                        app.as_str(),
                        &serde_json::to_string(&cleaned)
                            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))?,
                    )
                    .await?;
            }
        }

        let leaked_env: std::collections::HashMap<String, String> = leaked_value
            .as_object()
            .map(|map| {
                map.iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|text| (key.clone(), text.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        crate::gemini_config::remove_gemini_env_entries(&leaked_env)?;

        if clean.is_empty() {
            state.db.set_config_snippet(app.as_str(), None)?;
        } else {
            state.db.set_config_snippet(
                app.as_str(),
                Some(
                    serde_json::to_string_pretty(&Value::Object(clean))
                        .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))?,
                ),
            )?;
        }

        state.db.set_setting(FLAG, "true")?;
        log::warn!("Gemini 通用配置中的历史凭据污染已完成一次性清理");
        Ok(())
    }

    /// Extract common config for OpenCode (JSON format)
    fn extract_opencode_common_config(settings: &Value) -> Result<String, AppError> {
        // OpenCode uses a different config structure with npm, options, models
        // For common config, we exclude provider-specific fields like apiKey
        let mut config = settings.clone();

        // Remove provider-specific fields
        if let Some(obj) = config.as_object_mut() {
            for key in ["options", "settings"] {
                if let Some(options) = obj.get_mut(key).and_then(|v| v.as_object_mut()) {
                    options.remove("apiKey");
                    options.remove("baseURL");
                }
            }
            // Keep npm and models as they might be common
        }

        if config.is_null() || (config.is_object() && config.as_object().unwrap().is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Extract common config for OpenClaw (JSON format)
    fn extract_openclaw_common_config(settings: &Value) -> Result<String, AppError> {
        // OpenClaw uses a different config structure with baseUrl, apiKey, api, models
        // For common config, we exclude provider-specific fields like apiKey
        let mut config = settings.clone();

        // Remove provider-specific fields
        if let Some(obj) = config.as_object_mut() {
            obj.remove("apiKey");
            obj.remove("baseUrl");
            // Keep api and models as they might be common
        }

        if config.is_null() || (config.is_object() && config.as_object().unwrap().is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Import default configuration from live files (re-export)
    ///
    /// Returns `Ok(true)` if imported, `Ok(false)` if skipped.
    pub fn import_default_config(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
        import_default_config(state, app_type)
    }

    /// Read current live settings (re-export)
    pub fn read_live_settings(app_type: AppType) -> Result<Value, AppError> {
        read_live_settings(app_type)
    }

    /// Get custom endpoints list (re-export)
    pub fn get_custom_endpoints(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
    ) -> Result<Vec<CustomEndpoint>, AppError> {
        endpoints::get_custom_endpoints(state, app_type, provider_id)
    }

    /// Add custom endpoint (re-export)
    pub fn add_custom_endpoint(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::add_custom_endpoint(state, app_type, provider_id, url)
    }

    /// Remove custom endpoint (re-export)
    pub fn remove_custom_endpoint(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::remove_custom_endpoint(state, app_type, provider_id, url)
    }

    /// Update endpoint last used timestamp (re-export)
    pub fn update_endpoint_last_used(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::update_endpoint_last_used(state, app_type, provider_id, url)
    }

    /// Update provider sort order
    pub fn update_sort_order(
        state: &AppState,
        app_type: AppType,
        updates: Vec<ProviderSortUpdate>,
    ) -> Result<bool, AppError> {
        let updates: Vec<(String, usize)> = updates
            .into_iter()
            .map(|update| (update.id, update.sort_index))
            .collect();
        state
            .db
            .update_provider_sort_indexes(app_type.as_str(), &updates)?;
        Ok(true)
    }

    /// Query provider usage (re-export)
    pub async fn query_usage(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
    ) -> Result<UsageResult, AppError> {
        usage::query_usage(state, app_type, provider_id).await
    }

    /// Test usage script (re-export)
    #[allow(clippy::too_many_arguments)]
    pub async fn test_usage_script(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        script_code: &str,
        timeout: u64,
        api_key: Option<&str>,
        base_url: Option<&str>,
        access_token: Option<&str>,
        user_id: Option<&str>,
        template_type: Option<&str>,
    ) -> Result<UsageResult, AppError> {
        usage::test_usage_script(
            state,
            app_type,
            provider_id,
            script_code,
            timeout,
            api_key,
            base_url,
            access_token,
            user_id,
            template_type,
        )
        .await
    }

    fn validate_provider_settings(app_type: &AppType, provider: &Provider) -> Result<(), AppError> {
        icon::validate_icon(provider.icon.as_deref())?;
        match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.claude.settings.not_object",
                        "Claude 配置必须是 JSON 对象",
                        "Claude configuration must be a JSON object",
                    ));
                }
            }
            AppType::Codex => {
                let settings = provider.settings_config.as_object().ok_or_else(|| {
                    AppError::localized(
                        "provider.codex.settings.not_object",
                        "Codex 配置必须是 JSON 对象",
                        "Codex configuration must be a JSON object",
                    )
                })?;

                let auth = settings.get("auth").ok_or_else(|| {
                    AppError::localized(
                        "provider.codex.auth.missing",
                        format!("供应商 {} 缺少 auth 配置", provider.id),
                        format!("Provider {} is missing auth configuration", provider.id),
                    )
                })?;
                if !auth.is_object() {
                    return Err(AppError::localized(
                        "provider.codex.auth.not_object",
                        format!("供应商 {} 的 auth 配置必须是 JSON 对象", provider.id),
                        format!(
                            "Provider {} auth configuration must be a JSON object",
                            provider.id
                        ),
                    ));
                }

                if let Some(config_value) = settings.get("config") {
                    if !(config_value.is_string() || config_value.is_null()) {
                        return Err(AppError::localized(
                            "provider.codex.config.invalid_type",
                            "Codex config 字段必须是字符串",
                            "Codex config field must be a string",
                        ));
                    }
                    if let Some(cfg_text) = config_value.as_str() {
                        crate::codex_config::validate_config_toml(cfg_text)?;
                    }
                }
            }
            AppType::Gemini | AppType::Agy => {
                use crate::gemini_config::validate_gemini_settings;
                validate_gemini_settings(&provider.settings_config)?
            }
            AppType::Copilot => {
                crate::copilot_config::validate_provider(&provider.id, &provider.settings_config)?
            }
            AppType::GrokBuild => {
                let settings = provider.settings_config.as_object().ok_or_else(|| {
                    AppError::localized(
                        "provider.grokbuild.settings.not_object",
                        "Grok Build 配置必须是 JSON 对象",
                        "Grok Build configuration must be a JSON object",
                    )
                })?;
                let config = settings
                    .get("config")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.grokbuild.config.missing",
                            "Grok Build 配置缺少 config 字段",
                            "Grok Build configuration is missing the config field",
                        )
                    })?;
                if provider.category.as_deref() == Some("official") {
                    crate::grok_config::validate_config_toml_syntax(config)?;
                } else {
                    crate::grok_config::validate_config_toml(config)?;
                }
            }
            AppType::OpenCode => {
                // OpenCode uses a different config structure: { npm, options, models }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.opencode.settings.not_object",
                        "OpenCode 配置必须是 JSON 对象",
                        "OpenCode configuration must be a JSON object",
                    ));
                }
                // The row is saved before the live write, which would refuse an invalid
                // native declaration only after the database already holds it.
                if !matches!(provider.category.as_deref(), Some("omo") | Some("omo-slim")) {
                    let (fragment, format) = crate::opencode_config::provider_fragment(
                        &provider.id,
                        &provider.settings_config,
                        provider.opencode_config_format(),
                    )?;
                    if format == crate::provider::OpenCodeConfigFormat::V2 {
                        crate::opencode_config::validate_native_provider(&provider.id, fragment)?;
                    }
                }
            }
            AppType::OpenClaw => {
                // OpenClaw uses config structure: { baseUrl, apiKey, api, models }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.openclaw.settings.not_object",
                        "OpenClaw 配置必须是 JSON 对象",
                        "OpenClaw configuration must be a JSON object",
                    ));
                }
            }
            AppType::Hermes => {
                let settings = provider.settings_config.as_object().ok_or_else(|| {
                    AppError::localized(
                        "provider.hermes.settings.not_object",
                        "Hermes 配置必须是 JSON 对象",
                        "Hermes configuration must be a JSON object",
                    )
                })?;
                let name = settings
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                if name.is_empty() {
                    return Err(AppError::localized(
                        "provider.hermes.name.missing",
                        "Hermes 配置缺少供应商名称",
                        "Hermes configuration is missing the provider name",
                    ));
                }
            }
            AppType::Mcode => {
                crate::mcode_config::validate_provider(&provider.id, &provider.settings_config)?
            }
            AppType::Kimi => {
                crate::kimi_config::validate_provider(&provider.id, &provider.settings_config)?
            }
            AppType::Dsh => {
                crate::dsh_config::validate_provider(&provider.id, &provider.settings_config)?;
            }
            AppType::Pi => {
                crate::pi_config::validate_provider_node(&provider.id, &provider.settings_config)?;
            }
            AppType::Omp => {
                crate::omp_config::validate_provider(&provider.id, &provider.settings_config)?;
            }
        }

        // Validate and clean UsageScript configuration (common for all app types)
        if let Some(meta) = &provider.meta {
            if let Some(usage_script) = &meta.usage_script {
                validate_usage_script(usage_script)?;
            }
        }

        Ok(())
    }

    #[cfg(test)]
    fn extract_credentials(
        provider: &Provider,
        app_type: &AppType,
    ) -> Result<(String, String), AppError> {
        match app_type {
            AppType::Claude | AppType::ClaudeDesktop => {
                let env = provider
                    .settings_config
                    .get("env")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.env.missing",
                            "配置格式错误: 缺少 env",
                            "Invalid configuration: missing env section",
                        )
                    })?;

                let api_key = env
                    .get("ANTHROPIC_AUTH_TOKEN")
                    .or_else(|| env.get("ANTHROPIC_API_KEY"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = env
                    .get("ANTHROPIC_BASE_URL")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.base_url.missing",
                            "缺少 ANTHROPIC_BASE_URL 配置",
                            "Missing ANTHROPIC_BASE_URL configuration",
                        )
                    })?
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::Codex => {
                let auth = provider
                    .settings_config
                    .get("auth")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.codex.auth.missing",
                            "配置格式错误: 缺少 auth",
                            "Invalid configuration: missing auth section",
                        )
                    })?;

                let api_key = auth
                    .get("OPENAI_API_KEY")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.codex.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let config_toml = provider
                    .settings_config
                    .get("config")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let base_url = if config_toml.contains("base_url") {
                    let re = Regex::new(r#"base_url\s*=\s*["']([^"']+)["']"#).map_err(|e| {
                        AppError::localized(
                            "provider.regex_init_failed",
                            format!("正则初始化失败: {e}"),
                            format!("Failed to initialize regex: {e}"),
                        )
                    })?;
                    re.captures(config_toml)
                        .and_then(|caps| caps.get(1))
                        .map(|m| m.as_str().to_string())
                        .ok_or_else(|| {
                            AppError::localized(
                                "provider.codex.base_url.invalid",
                                "config.toml 中 base_url 格式错误",
                                "base_url in config.toml has invalid format",
                            )
                        })?
                } else {
                    return Err(AppError::localized(
                        "provider.codex.base_url.missing",
                        "config.toml 中缺少 base_url 配置",
                        "base_url is missing from config.toml",
                    ));
                };

                Ok((api_key, base_url))
            }
            AppType::Gemini | AppType::Agy => {
                use crate::gemini_config::json_to_env;

                let env_map = json_to_env(&provider.settings_config)?;

                let api_key = env_map.get("GEMINI_API_KEY").cloned().ok_or_else(|| {
                    AppError::localized(
                        "gemini.missing_api_key",
                        "缺少 GEMINI_API_KEY",
                        "Missing GEMINI_API_KEY",
                    )
                })?;

                let base_url = env_map
                    .get("GOOGLE_GEMINI_BASE_URL")
                    .cloned()
                    .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string());

                Ok((api_key, base_url))
            }
            AppType::Copilot => {
                // 新形状在 provider 节点；旧版环境变量形状的行还没被列表转换时兜底。
                let settings =
                    crate::copilot_config::convert_legacy_settings(&provider.settings_config)
                        .unwrap_or_else(|| provider.settings_config.clone());
                let get = |key: &str| {
                    settings
                        .get("provider")
                        .and_then(|provider| provider.get(key))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                };
                let api_key = get("apiKey")
                    .or_else(|| get("bearerToken"))
                    .unwrap_or_default();
                let base_url = get("baseUrl").ok_or_else(|| {
                    AppError::localized(
                        "copilot.missing_base_url",
                        "缺少自带模型的接口地址",
                        "Missing the bring-your-own-model endpoint",
                    )
                })?;
                Ok((api_key, base_url))
            }
            AppType::GrokBuild => {
                let config = provider
                    .settings_config
                    .get("config")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.grokbuild.config.missing",
                            "Grok Build 配置缺少 config 字段",
                            "Grok Build configuration is missing the config field",
                        )
                    })?;
                let (base_url, api_key) = crate::grok_config::extract_credentials(config)
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.grokbuild.credentials.missing",
                            "Grok Build 配置缺少 Base URL 或 API Key",
                            "Grok Build configuration is missing the base URL or API key",
                        )
                    })?;
                Ok((api_key, base_url))
            }
            AppType::OpenCode => {
                // OpenCode uses options.apiKey and options.baseURL
                let options = provider
                    .settings_config
                    .get("options")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.opencode.options.missing",
                            "配置格式错误: 缺少 options",
                            "Invalid configuration: missing options section",
                        )
                    })?;

                let api_key = options
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.opencode.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = options
                    .get("baseURL")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::OpenClaw => {
                // OpenClaw uses apiKey and baseUrl directly on the object
                let api_key = provider
                    .settings_config
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.openclaw.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = provider
                    .settings_config
                    .get("baseUrl")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::Hermes => {
                let api_key = provider
                    .settings_config
                    .get("api_key")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let base_url = provider
                    .settings_config
                    .get("base_url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                Ok((api_key, base_url))
            }
            AppType::Pi => {
                let api_key = provider
                    .settings_config
                    .get("apiKey")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let base_url = crate::pi_config::provider_base_url(&provider.settings_config)
                    .unwrap_or_default();
                Ok((api_key, base_url))
            }
            AppType::Omp => {
                // Oh My Pi 的 models.yml 节点把 apiKey、baseUrl 直接放在节点上。
                let field = |key: &str| {
                    provider
                        .settings_config
                        .get(key)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                Ok((field("apiKey"), field("baseUrl")))
            }
            AppType::Mcode => {
                // MiniMax Code 的 custom_provider 把凭据放在 options 下。
                let options = provider.settings_config.get("options");
                let field = |top: &str, nested: &str| {
                    provider
                        .settings_config
                        .get(top)
                        .or_else(|| options.and_then(|options| options.get(nested)))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                Ok((field("apiKey", "apiKey"), field("baseUrl", "baseURL")))
            }
            AppType::Dsh => Ok((
                provider
                    .settings_config
                    .pointer("/options/apiKey")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                provider
                    .settings_config
                    .pointer("/options/baseURL")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
            )),
            AppType::Kimi => Ok((
                provider
                    .settings_config
                    .pointer("/provider/api_key")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                provider
                    .settings_config
                    .pointer("/provider/base_url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
            )),
        }
    }
}

/// Normalize Claude model keys in a JSON value
///
/// Reads old key (ANTHROPIC_SMALL_FAST_MODEL), writes new keys (DEFAULT_*), and deletes old key.
pub(crate) fn normalize_claude_models_in_value(settings: &mut Value) -> bool {
    let mut changed = false;
    let env = match settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        Some(obj) => obj,
        None => return changed,
    };

    let model = env
        .get("ANTHROPIC_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let small_fast = env
        .get("ANTHROPIC_SMALL_FAST_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let current_haiku = env
        .get("ANTHROPIC_DEFAULT_HAIKU_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let current_sonnet = env
        .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let current_opus = env
        .get("ANTHROPIC_DEFAULT_OPUS_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let target_haiku = current_haiku
        .or_else(|| small_fast.clone())
        .or_else(|| model.clone());
    let target_sonnet = current_sonnet
        .or_else(|| model.clone())
        .or_else(|| small_fast.clone());
    let target_opus = current_opus
        .or_else(|| model.clone())
        .or_else(|| small_fast.clone());

    if env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").is_none() {
        if let Some(v) = target_haiku {
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(v),
            );
            changed = true;
        }
    }
    if env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").is_none() {
        if let Some(v) = target_sonnet {
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                Value::String(v),
            );
            changed = true;
        }
    }
    if env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").is_none() {
        if let Some(v) = target_opus {
            env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), Value::String(v));
            changed = true;
        }
    }

    if env.remove("ANTHROPIC_SMALL_FAST_MODEL").is_some() {
        changed = true;
    }

    changed
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderSortUpdate {
    pub id: String,
    #[serde(rename = "sortIndex")]
    pub sort_index: usize,
}

// ============================================================================
// 统一供应商（Universal Provider）服务方法
// ============================================================================

use crate::provider::UniversalProvider;
use std::collections::HashMap;

impl ProviderService {
    /// 获取所有统一供应商
    pub fn list_universal(
        state: &AppState,
    ) -> Result<HashMap<String, UniversalProvider>, AppError> {
        state.db.get_all_universal_providers()
    }

    /// 获取单个统一供应商
    pub fn get_universal(
        state: &AppState,
        id: &str,
    ) -> Result<Option<UniversalProvider>, AppError> {
        state.db.get_universal_provider(id)
    }

    /// 添加或更新统一供应商（不自动同步，需手动调用 sync_universal_to_apps）
    pub fn upsert_universal(
        state: &AppState,
        provider: UniversalProvider,
    ) -> Result<bool, AppError> {
        icon::validate_icon(provider.icon.as_deref())?;
        // 保存统一供应商
        state.db.save_universal_provider(&provider)?;

        Ok(true)
    }

    /// 删除统一供应商
    pub fn delete_universal(state: &AppState, id: &str) -> Result<bool, AppError> {
        // 获取统一供应商（用于删除生成的子供应商）
        let provider = state.db.get_universal_provider(id)?;

        // 删除统一供应商
        state.db.delete_universal_provider(id)?;

        // 删除生成的子供应商
        if let Some(p) = provider {
            if p.apps.claude {
                let claude_id = format!("universal-claude-{id}");
                let _ = state.db.delete_provider("claude", &claude_id);
            }
            if p.apps.codex {
                let codex_id = format!("universal-codex-{id}");
                let _ = state.db.delete_provider("codex", &codex_id);
            }
            if p.apps.gemini {
                let gemini_id = format!("universal-gemini-{id}");
                let _ = state.db.delete_provider("gemini", &gemini_id);
            }
        }

        Ok(true)
    }

    /// 同步统一供应商到各应用
    pub fn sync_universal_to_apps(state: &AppState, id: &str) -> Result<bool, AppError> {
        let provider = state
            .db
            .get_universal_provider(id)?
            .ok_or_else(|| AppError::Message(format!("统一供应商 {id} 不存在")))?;
        // 子供应商经 save_provider 直接入库，不走保存校验，图标在这里把关
        icon::validate_icon(provider.icon.as_deref())?;

        // 各应用独立同步数据库与 live：一个损坏的配置文件不能阻止其余应用更新，
        // 但必须报告出来而不是返回成功（上游 926af949）。
        let mut live_failures = Vec::new();

        // 同步到 Claude
        if let Some(mut claude_provider) = provider.to_claude_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&claude_provider.id, "claude")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &claude_provider.settings_config);
                claude_provider.settings_config = merged;
                // 已有子供应商的应用专属配置与排序不属于统一供应商管理的字段（上游 e0c2fd2b）。
                claude_provider.meta = existing.meta;
                claude_provider.created_at = existing.created_at;
                claude_provider.sort_index = existing.sort_index;
            }
            state.db.save_provider("claude", &claude_provider)?;
            Self::project_universal_child_to_live(
                state,
                AppType::Claude,
                &claude_provider.id,
                &mut live_failures,
            );
        } else {
            // 如果禁用了 Claude，删除对应的子供应商
            let claude_id = format!("universal-claude-{id}");
            let _ = state.db.delete_provider("claude", &claude_id);
        }

        // 同步到 Codex
        if let Some(mut codex_provider) = provider.to_codex_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&codex_provider.id, "codex")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &codex_provider.settings_config);
                codex_provider.settings_config = merged;
                // 已有子供应商的应用专属配置与排序不属于统一供应商管理的字段（上游 e0c2fd2b）。
                codex_provider.meta = existing.meta;
                codex_provider.created_at = existing.created_at;
                codex_provider.sort_index = existing.sort_index;
            }
            state.db.save_provider("codex", &codex_provider)?;
            Self::project_universal_child_to_live(
                state,
                AppType::Codex,
                &codex_provider.id,
                &mut live_failures,
            );
        } else {
            let codex_id = format!("universal-codex-{id}");
            let _ = state.db.delete_provider("codex", &codex_id);
        }

        // 同步到 Gemini
        if let Some(mut gemini_provider) = provider.to_gemini_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&gemini_provider.id, "gemini")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &gemini_provider.settings_config);
                gemini_provider.settings_config = merged;
                // 已有子供应商的应用专属配置与排序不属于统一供应商管理的字段（上游 e0c2fd2b）。
                gemini_provider.meta = existing.meta;
                gemini_provider.created_at = existing.created_at;
                gemini_provider.sort_index = existing.sort_index;
            }
            state.db.save_provider("gemini", &gemini_provider)?;
            Self::project_universal_child_to_live(
                state,
                AppType::Gemini,
                &gemini_provider.id,
                &mut live_failures,
            );
        } else {
            let gemini_id = format!("universal-gemini-{id}");
            let _ = state.db.delete_provider("gemini", &gemini_id);
        }

        if live_failures.is_empty() {
            Ok(true)
        } else {
            Err(AppError::Message(format!(
                "统一供应商已保存到数据库，但以下应用的配置文件未能写入，仍是旧内容：{}。请重试同步，或切换一次该应用的供应商。",
                live_failures.join("、")
            )))
        }
    }

    /// 仅当生成的统一供应商子项是该应用的当前供应商时重投影 live；失败由调用方
    /// 收集，其余应用继续同步。
    fn project_universal_child_to_live(
        state: &AppState,
        app_type: AppType,
        child_id: &str,
        failures: &mut Vec<String>,
    ) {
        let is_current = match crate::settings::get_effective_current_provider(&state.db, &app_type)
        {
            Ok(current) => current.as_deref() == Some(child_id),
            Err(err) => {
                log::warn!(
                    "读取 {} 当前供应商失败，跳过统一供应商的 live 重投影: {err}",
                    app_type.as_str()
                );
                failures.push(app_type.as_str().to_string());
                return;
            }
        };
        if !is_current {
            return;
        }
        if let Err(err) = Self::sync_current_provider_for_app(state, app_type.clone()) {
            log::warn!(
                "统一供应商同步后重写 {} live 配置失败: {err}",
                app_type.as_str()
            );
            failures.push(app_type.as_str().to_string());
        }
    }

    /// 递归合并 JSON：base 为底，patch 覆盖同名字段
    fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
        use serde_json::Value;

        match (base, patch) {
            (Value::Object(base_map), Value::Object(patch_map)) => {
                for (k, v_patch) in patch_map {
                    match base_map.get_mut(k) {
                        Some(v_base) => Self::merge_json(v_base, v_patch),
                        None => {
                            base_map.insert(k.clone(), v_patch.clone());
                        }
                    }
                }
            }
            // 其它类型：直接覆盖
            (base_val, patch_val) => {
                *base_val = patch_val.clone();
            }
        }
    }
}

#[cfg(test)]
mod claude_runtime_tests;

#[cfg(test)]
mod gemini_runtime_tests;

#[cfg(test)]
mod grok_runtime_tests;

#[cfg(test)]
mod opencode_native_tests {
    use super::ProviderService;
    use serde_json::{json, Value};

    #[test]
    fn native_opencode_common_config_excludes_provider_credentials() {
        let config = json!({
            "settings": {"baseURL": "https://native.example", "apiKey": "test", "timeout": 1000},
            "body": {"metadata": {"keep": true}}
        });
        let common: Value = serde_json::from_str(
            &ProviderService::extract_opencode_common_config(&config).unwrap(),
        )
        .unwrap();
        assert_eq!(
            common,
            json!({"settings": {"timeout": 1000}, "body": {"metadata": {"keep": true}}})
        );
    }
}
