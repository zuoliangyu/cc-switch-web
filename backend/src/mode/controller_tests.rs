use super::*;
use crate::database::Database;
use crate::proxy::provider_router::ProviderRouter;
use crate::settings::{get_settings, update_settings, AppSettings};
use serde_json::{json, Value};
use serial_test::serial;
use std::{ffi::OsString, sync::Arc};
pub(crate) struct Fixture {
    pub(crate) state: AppState,
    previous_home: Option<OsString>,
    previous_settings: AppSettings,
    _dir: tempfile::TempDir,
}

impl Fixture {
    pub(crate) fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        let previous_settings = get_settings();
        update_settings(AppSettings::default()).unwrap();
        Self {
            state: AppState::new(Arc::new(Database::memory().unwrap())),
            previous_home,
            previous_settings,
            _dir: dir,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        crate::mode::operation::failpoint::crash_at(None);
        // 在临时 HOME 内恢复缓存，避免恢复 settings 时写入真实目录。
        update_settings(self.previous_settings.clone()).unwrap();
        match &self.previous_home {
            Some(home) => std::env::set_var("CC_SWITCH_TEST_HOME", home),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}

fn row(id: &str) -> Provider {
    Provider::with_id(
        id.into(),
        id.into(),
        json!({"env":{"ANTHROPIC_AUTH_TOKEN":format!("{id}-key"),"ANTHROPIC_BASE_URL":format!("https://{id}.example"),"ANTHROPIC_MODEL":"claude-sonnet-4-6"}}),
        None,
    )
}
fn setup() -> Fixture {
    let f = Fixture::new();
    for id in ["a", "b"] {
        f.state.db.save_provider("claude", &row(id)).unwrap();
    }
    claude_direct::switch_to(&f.state.db, None, &row("a")).unwrap();
    f.state
        .db
        .set_proxy_flags_sync("claude", false, false)
        .unwrap();
    f
}
#[tokio::test]
#[serial]
async fn route_selection_and_request_routing_leave_direct_pointer_untouched() {
    let f = setup();
    let state = &f.state;
    let path = crate::config::get_claude_settings_path();
    let before = std::fs::read(&path).unwrap();
    set_route(state, &AppType::Claude, "b").await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(!state.proxy_service.is_running().await);
    write_proxy(
        state,
        &AppType::Claude,
        &row("b"),
        "http://127.0.0.1:15721",
        op::ENTER,
    )
    .await
    .unwrap();
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::Direct)
            .unwrap()
            .as_deref(),
        Some("a")
    );
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::InUse)
            .unwrap()
            .as_deref(),
        Some("b")
    );
    let router = ProviderRouter::new(state.db.clone());
    assert_eq!(router.select_providers("claude").await.unwrap()[0].id, "b");
    write_direct(state, &AppType::Claude, false).unwrap();
    let live: Value = crate::config::read_json_file(&path).unwrap();
    assert_eq!(live["env"]["ANTHROPIC_AUTH_TOKEN"], "a-key");
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("b")
    );
    assert_eq!(router.select_providers("claude").await.unwrap()[0].id, "a");
}
#[tokio::test]
#[serial]
async fn interrupted_mode_publish_recovers_files_and_route_together() {
    let f = setup();
    let state = &f.state;
    operation::failpoint::crash_at(Some("published:0"));
    assert!(write_proxy(
        state,
        &AppType::Claude,
        &row("b"),
        "http://127.0.0.1:15721",
        op::ENTER
    )
    .await
    .is_err());
    assert!(operation::has_pending("claude"));
    operation::failpoint::crash_at(None);
    operation::settle(&state.db, "claude").unwrap();
    let mode = stored_mode(&AppType::Claude).unwrap();
    assert!(mode.is_proxy() && mode.attached);
    assert_eq!(mode.proxy_route.as_deref(), Some("b"));
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::Direct)
            .unwrap()
            .as_deref(),
        Some("a")
    );
    assert!(current::is_referenced(&state.db, &AppType::Claude, "a").unwrap());
    assert!(current::is_referenced(&state.db, &AppType::Claude, "b").unwrap());
}
#[tokio::test]
#[serial]
async fn bind_failure_preserves_client_and_restores_global_enable_flag() {
    let f = setup();
    let state = &f.state;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_address = "127.0.0.1".into();
    global.listen_port = listener.local_addr().unwrap().port();
    global.proxy_enabled = false;
    state.db.update_global_proxy_config(global).await.unwrap();
    let before = std::fs::read(crate::config::get_claude_settings_path()).unwrap();
    assert!(enter(state, &AppType::Claude, Some("b")).await.is_err());
    assert!(!state.proxy_service.is_running().await);
    assert!(
        !state
            .db
            .get_global_proxy_config()
            .await
            .unwrap()
            .proxy_enabled
    );
    assert!(!stored_mode(&AppType::Claude).unwrap().is_proxy());
    assert_eq!(
        std::fs::read(crate::config::get_claude_settings_path()).unwrap(),
        before
    );
}
#[tokio::test]
#[serial]
async fn entering_and_exiting_service_restores_direct_selection() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("b")).await.unwrap();
    assert!(state.proxy_service.is_running().await);
    let status = state.proxy_service.get_status().await.unwrap();
    assert_ne!(status.port, 0);
    set_route(state, &AppType::Claude, "a").await.unwrap();
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("a")
    );
    exit(state, &AppType::Claude).await.unwrap();
    assert!(!state.proxy_service.is_running().await);
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::Direct)
            .unwrap()
            .as_deref(),
        Some("a")
    );
}

#[tokio::test]
#[serial]
async fn aggregation_members_and_defaults_commit_with_client_and_keep_keys() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter_mode(state, &AppType::Claude, Some("b"), true)
        .await
        .unwrap();
    let live: Value =
        serde_json::from_slice(&std::fs::read(crate::config::get_claude_settings_path()).unwrap())
            .unwrap();
    assert_eq!(
        live["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"],
        "ccs-claude-b--claude-sonnet-4-6"
    );
    set_stack_member(state, &AppType::Claude, "a", true)
        .await
        .unwrap();
    let roster = state::stack(&DeviceStore::for_device(), "claude").unwrap();
    let key = roster.key_of("a").unwrap().to_string();
    let view = stack_view(state, &AppType::Claude).await.unwrap();
    assert!(view.active);
    assert_eq!(
        view.members
            .iter()
            .map(|m| m.provider_id.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    assert!(set_stack_member(state, &AppType::Claude, "b", false)
        .await
        .is_err());
    set_stack_member(state, &AppType::Claude, "a", false)
        .await
        .unwrap();
    assert_eq!(
        state::stack(&DeviceStore::for_device(), "claude")
            .unwrap()
            .key_of("a"),
        Some(key.as_str())
    );
    set_stack_member(state, &AppType::Claude, "a", true)
        .await
        .unwrap();
    set_route(state, &AppType::Claude, "a").await.unwrap();
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::Direct)
            .unwrap()
            .as_deref(),
        Some("a")
    );
    exit(state, &AppType::Claude).await.unwrap();
    assert!(!stack_view(state, &AppType::Claude).await.unwrap().active);
    assert_eq!(
        state::stack(&DeviceStore::for_device(), "claude")
            .unwrap()
            .members
            .len(),
        2
    );
}

#[tokio::test]
#[serial]
async fn codex_aggregation_publishes_each_model_and_sinks_window_per_provider() {
    let f = Fixture::new();
    let state = &f.state;
    for (id, window) in [("a", 128000), ("b", 256000)] {
        let row = Provider::with_id(
            id.into(),
            id.into(),
            json!({"auth":{"OPENAI_API_KEY":"test-key"},"config":format!("model_provider = \"{id}\"\nmodel = \"{id}-model\"\nmodel_context_window = {window}\n[model_providers.{id}]\nbase_url = \"https://{id}.example/v1\"\nwire_api = \"responses\"\n")}),
            None,
        );
        state.db.save_provider("codex", &row).unwrap();
    }
    let a = provider(state, &AppType::Codex, "a").unwrap();
    codex_direct::write_direct(state, None, &a, true, None).unwrap();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter_mode(state, &AppType::Codex, Some("a"), true)
        .await
        .unwrap();
    set_stack_member(state, &AppType::Codex, "b", true)
        .await
        .unwrap();
    let catalog: Value = serde_json::from_slice(
        &std::fs::read(crate::codex_config::get_codex_model_catalog_path()).unwrap(),
    )
    .unwrap();
    assert_eq!(catalog["models"][0]["slug"], "a-model");
    assert_eq!(catalog["models"][0]["context_window"], 128000);
    assert_eq!(catalog["models"][1]["slug"], "ccs-b/b-model");
    assert_eq!(catalog["models"][1]["context_window"], 256000);
    let config = codex_direct::read_config_text()
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    assert!(config.get("model_context_window").is_none());
    exit(state, &AppType::Codex).await.unwrap();
    let config = codex_direct::read_config_text()
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    assert_eq!(config["model_context_window"].as_integer(), Some(128000));
}

#[tokio::test]
#[serial]
async fn unchanged_route_contract_does_not_read_or_rewrite_client_file() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("a")).await.unwrap();
    let path = crate::config::get_claude_settings_path();
    std::fs::write(&path, b"incomplete user edit").unwrap();
    set_route(state, &AppType::Claude, "b").await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"incomplete user edit");
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("b")
    );
    std::fs::write(path, b"{}").unwrap();
    exit(state, &AppType::Claude).await.unwrap();
}

#[tokio::test]
#[serial]
async fn detach_and_startup_restore_aggregation_without_changing_direct() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter_mode(state, &AppType::Claude, Some("b"), true)
        .await
        .unwrap();
    set_stack_member(state, &AppType::Claude, "a", true)
        .await
        .unwrap();
    detach_all(state).await.unwrap();
    let mode = stored_mode(&AppType::Claude).unwrap();
    assert!(mode.is_proxy());
    assert!(!mode.attached);
    assert!(!state.proxy_service.is_running().await);
    assert!(startup(state).await.is_empty());
    assert!(stored_mode(&AppType::Claude).unwrap().attached);
    assert!(stack_view(state, &AppType::Claude).await.unwrap().active);
    assert_eq!(
        current::provider_for(&state.db, &AppType::Claude, current::Purpose::Direct)
            .unwrap()
            .as_deref(),
        Some("a")
    );
    exit(state, &AppType::Claude).await.unwrap();
}

#[tokio::test]
#[serial]
async fn startup_failure_is_visible_until_mode_is_successfully_restored() {
    let f = setup();
    let state = &f.state;
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state
        .db
        .update_global_proxy_config(global.clone())
        .await
        .unwrap();
    enter(state, &AppType::Claude, Some("b")).await.unwrap();
    detach_all(state).await.unwrap();
    global.listen_port = occupied.local_addr().unwrap().port();
    state
        .db
        .update_global_proxy_config(global.clone())
        .await
        .unwrap();
    assert!(!startup(state).await.is_empty());
    let view = view(state, &AppType::Claude).await.unwrap();
    assert!(view.startup_error.is_some());
    assert!(!view.attached);
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("b")).await.unwrap();
    assert!(super::view(state, &AppType::Claude)
        .await
        .unwrap()
        .startup_error
        .is_none());
    exit(state, &AppType::Claude).await.unwrap();
}

#[tokio::test]
#[serial]
async fn failover_updates_route_only_and_late_results_cannot_replace_aggregation_default() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("a")).await.unwrap();
    let manager = crate::proxy::failover_switch::FailoverSwitchManager::new(state.db.clone());
    assert!(manager.try_switch("claude", "b", "b").await.unwrap());
    assert_eq!(
        state.db.get_current_provider("claude").unwrap().as_deref(),
        Some("a")
    );
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("b")
    );
    assert!(
        crate::services::provider::ProviderService::delete(state, AppType::Claude, "b").is_err()
    );
    enter_mode(state, &AppType::Claude, Some("a"), true)
        .await
        .unwrap();
    assert!(!manager.try_switch("claude", "b", "b").await.unwrap());
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("a")
    );
    exit(state, &AppType::Claude).await.unwrap();
    assert!(!manager.try_switch("claude", "b", "b").await.unwrap());
}

#[tokio::test]
#[serial]
async fn editing_aggregation_route_commits_global_edits_and_contract_together() {
    use crate::services::provider::{
        claude_editor::{ConflictPolicy, EditorSave},
        ProviderService,
    };
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter_mode(state, &AppType::Claude, Some("b"), true)
        .await
        .unwrap();
    let before = provider(state, &AppType::Claude, "b").unwrap();
    let base = ProviderService::claude_editor_view(state, &before.settings_config)
        .unwrap()
        .settings;
    let mut changed = before.clone();
    changed.settings_config = base.clone();
    changed.settings_config["env"]["ANTHROPIC_MODEL"] = json!("new-model");
    changed.settings_config["theme"] = json!("mine");
    let path = crate::config::get_claude_settings_path();
    let mut external: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    external["theme"] = json!("theirs");
    std::fs::write(&path, serde_json::to_vec(&external).unwrap()).unwrap();
    let mode_before = stored_mode(&AppType::Claude).unwrap();
    let err = ProviderService::save_claude(
        state,
        changed.clone(),
        Some(EditorSave {
            base: base.clone(),
            on_conflict: ConflictPolicy::Refuse,
        }),
        false,
    )
    .unwrap_err();
    assert!(err.to_string().contains("LIVE_EDIT_CONFLICT"));
    assert_eq!(
        provider(state, &AppType::Claude, "b")
            .unwrap()
            .settings_config,
        before.settings_config
    );
    assert_eq!(stored_mode(&AppType::Claude).unwrap(), mode_before);
    ProviderService::save_claude(
        state,
        changed,
        Some(EditorSave {
            base,
            on_conflict: ConflictPolicy::KeepMine,
        }),
        false,
    )
    .unwrap();
    let live: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(live["theme"], "mine");
    assert_eq!(
        live["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"],
        "ccs-claude-b--new-model"
    );
    assert_eq!(
        live["env"]["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"],
        "1"
    );
    assert_eq!(
        state.db.get_current_provider("claude").unwrap().as_deref(),
        Some("a")
    );
    assert!(state.db.get_live_backup("claude").await.unwrap().is_none());
    exit(state, &AppType::Claude).await.unwrap();
}

#[tokio::test]
#[serial]
async fn provider_switch_in_proxy_mode_changes_route_without_replacing_direct() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("a")).await.unwrap();
    crate::services::provider::ProviderService::switch(state, AppType::Claude, "b").unwrap();
    assert_eq!(
        stored_mode(&AppType::Claude)
            .unwrap()
            .proxy_route
            .as_deref(),
        Some("b")
    );
    assert_eq!(
        state.db.get_current_provider("claude").unwrap().as_deref(),
        Some("a")
    );
    exit(state, &AppType::Claude).await.unwrap();
}

#[tokio::test]
#[serial]
async fn codex_member_editor_conflict_keeps_catalog_and_success_republishes_member() {
    use crate::services::provider::{
        claude_editor::{ConflictPolicy, EditorSave},
        ProviderService,
    };
    let f = Fixture::new();
    let state = &f.state;
    for id in ["a", "b"] {
        let row = Provider::with_id(
            id.into(),
            id.into(),
            json!({"auth":{"OPENAI_API_KEY":"test-key"}, "config":format!("model_provider = '{id}'\nmodel = '{id}-model'\n[model_providers.{id}]\nbase_url = 'https://{id}.example/v1'\nwire_api = 'responses'\n")}),
            None,
        );
        state.db.save_provider("codex", &row).unwrap();
    }
    let a = provider(state, &AppType::Codex, "a").unwrap();
    codex_direct::write_direct(state, None, &a, true, None).unwrap();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter_mode(state, &AppType::Codex, Some("a"), true)
        .await
        .unwrap();
    set_stack_member(state, &AppType::Codex, "b", true)
        .await
        .unwrap();
    let old = provider(state, &AppType::Codex, "b").unwrap();
    let base = ProviderService::codex_editor_view(state, &old.settings_config, None)
        .unwrap()
        .settings;
    let mut edited = old.clone();
    edited.settings_config = base.clone();
    edited.settings_config["config"] = json!(format!(
        "personality = 'mine'\n{}",
        base["config"].as_str().unwrap().replace("b-model", "b-new")
    ));
    let config_path = crate::codex_config::get_codex_config_path();
    let external = format!(
        "personality = 'theirs'\n{}",
        std::fs::read_to_string(&config_path).unwrap()
    );
    std::fs::write(&config_path, &external).unwrap();
    let catalog_path = crate::codex_config::get_codex_model_catalog_path();
    let old_catalog = std::fs::read(&catalog_path).unwrap();
    assert!(ProviderService::save_codex(
        state,
        edited.clone(),
        Some(EditorSave {
            base: base.clone(),
            on_conflict: ConflictPolicy::Refuse
        }),
        false
    )
    .unwrap_err()
    .to_string()
    .contains("LIVE_EDIT_CONFLICT"));
    assert_eq!(std::fs::read(&catalog_path).unwrap(), old_catalog);
    assert_eq!(std::fs::read_to_string(&config_path).unwrap(), external);
    assert_eq!(
        provider(state, &AppType::Codex, "b")
            .unwrap()
            .settings_config,
        old.settings_config
    );
    ProviderService::save_codex(
        state,
        edited,
        Some(EditorSave {
            base,
            on_conflict: ConflictPolicy::KeepMine,
        }),
        false,
    )
    .unwrap();
    let catalog: Value = serde_json::from_slice(&std::fs::read(&catalog_path).unwrap()).unwrap();
    assert!(catalog["models"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["slug"] == "ccs-b/b-new"));
    assert!(std::fs::read_to_string(config_path)
        .unwrap()
        .contains("personality = 'mine'"));
    ProviderService::sync_current_provider_for_app(state, AppType::Codex).unwrap();
    assert!(state.db.get_live_backup("codex").await.unwrap().is_none());
    assert_eq!(
        state.db.get_current_provider("codex").unwrap().as_deref(),
        Some("a")
    );
    exit(state, &AppType::Codex).await.unwrap();
}

#[tokio::test]
#[serial]
async fn gemini_and_grok_editors_keep_proxy_contract_while_updating_globals() {
    use crate::services::provider::{
        claude_editor::{ConflictPolicy, EditorSave},
        ProviderService,
    };
    let f = Fixture::new();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    for app in [AppType::Gemini, AppType::GrokBuild] {
        for id in ["a", "b"] {
            let settings = if app == AppType::Gemini {
                json!({"env":{"GEMINI_API_KEY":format!("{id}-key"),"GOOGLE_GEMINI_BASE_URL":format!("https://{id}.example")},"config":{"model":{"name":"gemini-test"}}})
            } else {
                json!({"config":format!("[models]\ndefault = '{id}'\n[model.{id}]\nmodel = 'grok-4.5'\nbase_url = 'https://{id}.example/v1'\napi_key = '{id}-key'\nname = '{id}'\napi_backend = 'responses'\ncontext_window = 500000\n")})
            };
            state
                .db
                .save_provider(
                    app.as_str(),
                    &Provider::with_id(id.into(), id.into(), settings, None),
                )
                .unwrap();
        }
        ProviderService::switch(state, app.clone(), "a").unwrap();
        enter(state, &app, Some("b")).await.unwrap();
        let mut edited = provider(state, &app, "b").unwrap();
        let base = if app == AppType::Gemini {
            ProviderService::gemini_editor_view(state, &edited.settings_config, None)
                .unwrap()
                .settings
        } else {
            ProviderService::grok_editor_view(state, &edited.settings_config, None)
                .unwrap()
                .settings
        };
        edited.settings_config = base.clone();
        if app == AppType::Gemini {
            edited.settings_config["config"]["ui"] = json!({"theme":"mine"});
            edited.settings_config["config"]["model"]["name"] = json!("gemini-new");
            ProviderService::save_gemini(
                state,
                edited,
                Some(EditorSave {
                    base,
                    on_conflict: ConflictPolicy::Refuse,
                }),
                false,
            )
            .unwrap();
            let live: Value =
                crate::config::read_json_file(&crate::gemini_config::get_gemini_settings_path())
                    .unwrap();
            assert_eq!(live["ui"]["theme"], "mine");
            assert_eq!(live["model"]["name"], "gemini-new");
            assert!(
                std::fs::read_to_string(crate::gemini_config::get_gemini_env_path())
                    .unwrap()
                    .contains(PROXY_TOKEN_PLACEHOLDER)
            );
        } else {
            edited.settings_config["config"] = json!(format!(
                "personality = 'mine'\n{}",
                base["config"]
                    .as_str()
                    .unwrap()
                    .replace("grok-4.5", "grok-new")
            ));
            ProviderService::save_grok(
                state,
                edited,
                Some(EditorSave {
                    base,
                    on_conflict: ConflictPolicy::Refuse,
                }),
                false,
            )
            .unwrap();
            let live = std::fs::read_to_string(crate::grok_config::get_grok_config_path()).unwrap();
            assert!(live.contains("personality = 'mine'"));
            assert!(live.contains(PROXY_TOKEN_PLACEHOLDER));
            assert!(live.contains("grok-new"));
        }
        ProviderService::sync_current_provider_for_app(state, app.clone()).unwrap();
        assert_eq!(ProviderService::current(state, app.clone()).unwrap(), "b");
        assert_eq!(
            state
                .db
                .get_current_provider(app.as_str())
                .unwrap()
                .as_deref(),
            Some("a")
        );
        assert!(state
            .db
            .get_live_backup(app.as_str())
            .await
            .unwrap()
            .is_none());
        exit(state, &app).await.unwrap();
    }
}

#[tokio::test]
#[serial]
async fn service_restart_failure_restores_listener_and_preserves_per_app_config() {
    let f = setup();
    let state = &f.state;
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();
    enter(state, &AppType::Claude, Some("b")).await.unwrap();
    let previous = state.proxy_service.get_status().await.unwrap();
    let client_before = std::fs::read(crate::config::get_claude_settings_path()).unwrap();
    let mut per_app = state.db.get_proxy_config_for_app("claude").await.unwrap();
    per_app.max_retries = 7;
    per_app.streaming_idle_timeout = 239;
    state.db.update_proxy_config_for_app(per_app).await.unwrap();
    let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut proposed = state.db.get_global_proxy_config().await.unwrap();
    proposed.listen_address = "127.0.0.1".into();
    proposed.listen_port = blocker.local_addr().unwrap().port();
    assert!(configure_service(state, proposed, true)
        .await
        .unwrap_err()
        .to_string()
        .contains("已恢复原配置"));
    let restored = state.proxy_service.get_status().await.unwrap();
    assert!(restored.running);
    assert_eq!(restored.port, previous.port);
    assert_eq!(
        std::fs::read(crate::config::get_claude_settings_path()).unwrap(),
        client_before
    );
    let per_app = state.db.get_proxy_config_for_app("claude").await.unwrap();
    assert_eq!(per_app.max_retries, 7);
    assert_eq!(per_app.streaming_idle_timeout, 239);
    let global = state.db.get_global_proxy_config().await.unwrap();
    assert_eq!(global.listen_port, 0);
    configure_service(state, global, true).await.unwrap();
    assert!(state.proxy_service.is_running().await);
    let live: Value =
        crate::config::read_json_file(&crate::config::get_claude_settings_path()).unwrap();
    let status = state.proxy_service.get_status().await.unwrap();
    assert_eq!(
        live["env"]["ANTHROPIC_BASE_URL"],
        origin(&status.address, status.port)
    );
    let view = view(state, &AppType::Claude).await.unwrap();
    assert_eq!(view.mode, "routing");
    assert_eq!(view.direct_provider_id.as_deref(), Some("a"));
    assert_eq!(view.route_provider_id.as_deref(), Some("b"));
    exit_all(state).await.unwrap();
    assert!(!state.proxy_service.is_running().await);
    assert_eq!(view_for_test(state).await, "direct");
}

async fn view_for_test(state: &AppState) -> &'static str {
    view(state, &AppType::Claude).await.unwrap().mode
}

#[tokio::test]
#[serial]
async fn official_codex_routing_keeps_history_bucket_and_detects_only_our_proxy() {
    use crate::services::provider::{codex_official_models as models, ProviderService};
    struct ResetModels;
    impl Drop for ResetModels {
        fn drop(&mut self) {
            models::reset_test_env();
        }
    }
    let _reset = ResetModels;
    models::set_test_env(models::Env {
        codex_version: Box::new(|| None),
        fetch: Box::new(|_, _, _| panic!("no external model requests in this test")),
        bundled: Box::new(|| Err(models::BundledSkip::NoCli)),
        keychain: Box::new(|| crate::services::subscription::CodexKeychainLogin::Missing),
        now: Box::new(|| 0),
    });
    for unified in [false, true] {
        let f = Fixture::new();
        let state = &f.state;
        let mut settings = get_settings();
        settings.unify_codex_session_history = unified;
        update_settings(settings).unwrap();
        let mut global = state.db.get_global_proxy_config().await.unwrap();
        global.listen_port = 0;
        state.db.update_global_proxy_config(global).await.unwrap();
        let mut official = Provider::with_id(
            "official".into(),
            "OpenAI".into(),
            json!({"auth":{},"config":"model = 'gpt-5.4'\n"}),
            None,
        );
        official.category = Some("official".into());
        state.db.save_provider("codex", &official).unwrap();
        ProviderService::switch(state, AppType::Codex, "official").unwrap();
        let path = crate::codex_config::get_codex_config_path();
        let selector = || {
            let text = std::fs::read_to_string(&path).unwrap();
            let doc: toml::Table = toml::from_str(&text).unwrap();
            doc.get("model_provider")
                .and_then(toml::Value::as_str)
                .map(str::to_owned)
        };
        let bucket = selector();
        assert_eq!(
            bucket.as_deref(),
            if unified { Some("custom") } else { None }
        );
        enter(state, &AppType::Codex, Some("official"))
            .await
            .unwrap();
        assert_eq!(selector(), bucket);
        assert!(state
            .proxy_service
            .detect_takeover_in_live_config_for_app(&AppType::Codex));
        exit(state, &AppType::Codex).await.unwrap();
        assert_eq!(selector(), bucket);
        assert!(!state
            .proxy_service
            .detect_takeover_in_live_config_for_app(&AppType::Codex));
        let mut global = state.db.get_global_proxy_config().await.unwrap();
        global.listen_port = 15721;
        state.db.update_global_proxy_config(global).await.unwrap();
        for (url, expected) in [
            ("http://127.0.0.1:15721/v1", true),
            ("http://127.0.0.1:10531/v1", false),
        ] {
            assert_eq!(
                codex_direct::routes_official_to_proxy(
                    &state.db,
                    &format!("openai_base_url = '{url}'\n")
                ),
                expected
            );
        }
    }
}

fn codex_login_on_disk() -> Option<Value> {
    std::fs::read(crate::codex_config::get_codex_auth_path())
        .ok()
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
}

fn chatgpt_login(account: &str) -> Value {
    json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": crate::codex_config::test_codex_id_token(&format!("user-{account}")),
            "access_token": format!("access-{account}"),
            "refresh_token": format!("refresh-{account}"),
            "account_id": account,
        }
    })
}

/// 直连指针在第三方卡上：退出 CC Switch 的分离不暂存登录，重启接上后登录还在；真正退出
/// 路由仍按保留登录开关走。Codex 桌面版续会话要 ChatGPT 登录（上游 6c36d68a，#8431）。
#[tokio::test]
#[serial]
async fn codex_detaching_and_attaching_keep_the_login_next_to_a_third_party_route() {
    let f = Fixture::new();
    let state = &f.state;
    let mut settings = get_settings();
    settings.preserve_codex_official_auth_on_switch = false;
    update_settings(settings).unwrap();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = 0;
    state.db.update_global_proxy_config(global).await.unwrap();

    let row = Provider::with_id(
        "a".into(),
        "a".into(),
        json!({"auth":{"OPENAI_API_KEY":"test-key"},"config":"model_provider = \"a\"\nmodel = \"a-model\"\n[model_providers.a]\nbase_url = \"https://a.example/v1\"\nwire_api = \"responses\"\n"}),
        None,
    );
    state.db.save_provider("codex", &row).unwrap();
    // 直连到第三方前 auth.json 里的登录被暂存走（保留开关关着）。
    let path = crate::codex_config::get_codex_auth_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, chatgpt_login("acct").to_string()).unwrap();
    codex_direct::write_direct(state, None, &row, true, None).unwrap();
    assert_eq!(
        codex_login_on_disk(),
        None,
        "stashed next to a third-party card"
    );

    // 进入代理：把最近暂存的登录还回去。
    enter(state, &AppType::Codex, Some("a")).await.unwrap();
    assert_eq!(codex_login_on_disk(), Some(chatgpt_login("acct")));

    detach_all(state).await.unwrap();
    assert!(!stored_mode(&AppType::Codex).unwrap().attached);
    assert_eq!(
        codex_login_on_disk(),
        Some(chatgpt_login("acct")),
        "detaching keeps the login"
    );
    assert!(startup(state).await.is_empty());
    assert!(stored_mode(&AppType::Codex).unwrap().attached);
    assert_eq!(codex_login_on_disk(), Some(chatgpt_login("acct")));

    // 只还一次：在 Codex 里登出后重新接上，不会又被登上。
    std::fs::remove_file(&path).unwrap();
    detach_all(state).await.unwrap();
    assert!(startup(state).await.is_empty());
    assert_eq!(codex_login_on_disk(), None, "logging out sticks");

    std::fs::write(&path, chatgpt_login("acct").to_string()).unwrap();
    exit(state, &AppType::Codex).await.unwrap();
    assert_eq!(
        codex_login_on_disk(),
        None,
        "a real exit follows the setting"
    );
}
