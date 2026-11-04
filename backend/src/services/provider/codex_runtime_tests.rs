//! Codex runtime integration, always isolated in a temporary home.
use super::claude_editor::{ConflictPolicy, EditorSave};
use super::ProviderService;
use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::{Provider, ProviderMeta};
use crate::settings::{get_settings, update_settings, AppSettings};
use crate::store::AppState;
use serde_json::{json, Value};
use serial_test::serial;
use std::{ffi::OsString, sync::Arc};

struct Fixture {
    state: AppState,
    previous_home: Option<OsString>,
    previous_settings: AppSettings,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
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

fn provider(id: &str, settings: Value) -> Provider {
    let mut provider = Provider::with_id(id.into(), id.into(), settings, None);
    provider.meta = Some(ProviderMeta {
        common_config_enabled: Some(true),
        ..Default::default()
    });
    provider
}

fn row(id: &str) -> Provider {
    provider(
        id,
        json!({"auth":{"OPENAI_API_KEY":format!("{id}-key")},"config":format!("model = '{id}'\nmodel_provider = '{id}'\n[model_providers.{id}]\nbase_url = 'https://{id}.example/v1'\nwire_api = 'responses'\n")}),
    )
}
fn seed(text: &str) {
    let path = crate::codex_config::get_codex_config_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}
fn live_text() -> String {
    std::fs::read_to_string(crate::codex_config::get_codex_config_path()).unwrap()
}

#[test]
#[serial]
fn add_editor_keeps_live_exclusive_fields_changed_after_opening() {
    let f = Fixture::new();
    seed("model_context_window = 12345\napproval_policy = 'on-request'\n");
    f.state.db.save_provider("codex", &row("a")).unwrap();
    ProviderService::switch(&f.state, AppType::Codex, "a").unwrap();
    let base = ProviderService::codex_editor_view(
        &f.state,
        &json!({"auth":{},"config":""}),
        Some("official"),
    )
    .unwrap()
    .settings;
    let mut added = row("b");
    added.settings_config["config"] = json!(format!(
        "model_context_window = 12345\n{}",
        added.settings_config["config"].as_str().unwrap()
    ));
    seed(&live_text().replace("12345", "54321"));
    ProviderService::save_codex(
        &f.state,
        added,
        Some(EditorSave {
            base,
            on_conflict: ConflictPolicy::Refuse,
        }),
        true,
    )
    .unwrap();
    let saved = f
        .state
        .db
        .get_provider_by_id("b", "codex")
        .unwrap()
        .unwrap();
    assert!(!saved.settings_config["config"]
        .as_str()
        .unwrap()
        .contains("model_context_window"));
    assert!(live_text().contains("54321"));
    ProviderService::switch(&f.state, AppType::Codex, "b").unwrap();
    assert!(live_text().contains("54321"));
}

#[test]
#[serial]
fn keyless_editor_drafts_save_but_cannot_replace_live_credentials() {
    let f = Fixture::new();
    seed("approval_policy = 'on-request'\n");
    let draft = provider(
        "draft",
        json!({"auth":{"OPENAI_API_KEY":""},"config":
        "model_provider = 'custom'\n[model_providers.custom]\nbase_url = 'https://example.invalid/v1'\nrequires_openai_auth = true\n"}),
    );
    let view = ProviderService::codex_editor_view(&f.state, &draft.settings_config, None).unwrap();
    assert_eq!(view.settings["auth"]["OPENAI_API_KEY"], "");
    let before = live_text();
    assert!(ProviderService::save_codex(&f.state, draft.clone(), None, true).is_err());
    assert!(f
        .state
        .db
        .get_provider_by_id("draft", "codex")
        .unwrap()
        .is_none());
    assert_eq!(live_text(), before);
    f.state.db.save_provider("codex", &row("a")).unwrap();
    ProviderService::switch(&f.state, AppType::Codex, "a").unwrap();
    ProviderService::save_codex(&f.state, draft.clone(), None, true).unwrap();
    let before = live_text();
    assert!(ProviderService::switch(&f.state, AppType::Codex, "draft").is_err());
    let mut current = draft;
    current.id = "a".into();
    assert!(ProviderService::save_codex(&f.state, current, None, false).is_err());
    assert_eq!(live_text(), before);
    assert_eq!(
        f.state
            .db
            .get_provider_by_id("a", "codex")
            .unwrap()
            .unwrap()
            .settings_config,
        row("a").settings_config
    );
}
#[test]
#[serial]
fn switches_keep_global_comments_and_user_tables_without_backfill() {
    let f = Fixture::new();
    let state = &f.state;
    seed("# user\napproval_policy = 'on-request' # keep\n[mcp_servers.local]\ncommand = 'local'\n[model_providers.mine]\nbase_url = 'https://mine.example'\n");
    for id in ["a", "b"] {
        state.db.save_provider("codex", &row(id)).unwrap();
    }
    ProviderService::switch(state, AppType::Codex, "a").unwrap();
    ProviderService::switch(state, AppType::Codex, "b").unwrap();
    let text = live_text();
    assert!(text.contains("approval_policy = 'on-request' # keep"));
    assert!(text.contains("[model_providers.mine]"));
    assert!(text.contains("[mcp_servers.local]"));
    assert!(text.contains("b-key"));
    assert!(!text.contains("a-key"));
    assert_eq!(
        state
            .db
            .get_provider_by_id("a", "codex")
            .unwrap()
            .unwrap()
            .settings_config,
        row("a").settings_config
    );
}

#[test]
#[serial]
fn direct_responses_switch_writes_catalog_and_keeps_upstream_url() {
    let f = Fixture::new();
    seed("approval_policy = 'on-request'\n");
    let direct = provider(
        "direct",
        json!({
            "auth": {"OPENAI_API_KEY": "test-key"},
            "config": "model = 'mimo-v2.5-pro'\nmodel_provider = 'direct'\n[model_providers.direct]\nbase_url = 'https://direct.example/v1'\nwire_api = 'responses'\n",
            "modelCatalog": {"models": [{
                "model": "mimo-v2.5-pro",
                "displayName": "MiMo",
                "contextWindow": 262144
            }]}
        }),
    );
    f.state.db.save_provider("codex", &direct).unwrap();
    ProviderService::switch(&f.state, AppType::Codex, "direct").unwrap();

    let config: toml::Value = toml::from_str(&live_text()).unwrap();
    assert_eq!(config["model"].as_str(), Some("mimo-v2.5-pro"));
    assert_eq!(config["approval_policy"].as_str(), Some("on-request"));
    let route = &config["model_providers"][config["model_provider"].as_str().unwrap()];
    assert_eq!(
        route["base_url"].as_str(),
        Some("https://direct.example/v1")
    );
    assert_eq!(route["wire_api"].as_str(), Some("responses"));
    // Codex 按 config.toml 所在目录解析相对引用。
    let catalog_path = crate::codex_config::get_codex_config_path()
        .parent()
        .unwrap()
        .join(config["model_catalog_json"].as_str().unwrap());
    assert!(catalog_path
        .canonicalize()
        .unwrap()
        .starts_with(f._dir.path().canonicalize().unwrap()));
    let catalog: Value = serde_json::from_slice(&std::fs::read(catalog_path).unwrap()).unwrap();
    assert_eq!(catalog["models"][0]["slug"], "mimo-v2.5-pro");
    assert_eq!(catalog["models"][0]["display_name"], "MiMo");
    assert_eq!(catalog["models"][0]["context_window"], 262144);
}

#[test]
#[serial]
fn corrupt_login_stash_refuses_without_changing_files_or_pointer() {
    let f = Fixture::new();
    let state = &f.state;
    seed("model = 'original'\n");
    state.db.save_provider("codex", &row("a")).unwrap();
    let path =
        crate::live::engine::DeviceStore::for_device().file(super::codex_login::STASH_FILENAME);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "{broken").unwrap();
    assert!(ProviderService::switch(state, AppType::Codex, "a")
        .unwrap_err()
        .to_string()
        .contains("登录暂存"));
    assert_eq!(live_text(), "model = 'original'\n");
    assert_eq!(std::fs::read_to_string(path).unwrap(), "{broken");
    assert!(state.db.get_current_provider("codex").unwrap().is_none());
}
#[test]
#[serial]
fn native_login_stashes_and_restores_in_same_operation() {
    let f = Fixture::new();
    let state = &f.state;
    let mut settings = get_settings();
    settings.preserve_codex_official_auth_on_switch = false;
    update_settings(settings).unwrap();
    seed("approval_policy = 'on-request'\n");
    let login = json!({"auth_mode":"chatgpt","tokens":{"id_token":crate::codex_config::test_codex_id_token("native"),"access_token":"native-access","refresh_token":"native-refresh","account_id":"workspace"}});
    crate::config::write_json_file_private(&crate::codex_config::get_codex_auth_path(), &login)
        .unwrap();
    state.db.save_provider("codex", &row("a")).unwrap();
    let mut official = provider("official", json!({"auth":{},"config":""}));
    official.category = Some("official".into());
    state.db.save_provider("codex", &official).unwrap();
    ProviderService::switch(state, AppType::Codex, "a").unwrap();
    assert!(!crate::codex_config::get_codex_auth_path().exists());
    ProviderService::switch(state, AppType::Codex, "official").unwrap();
    assert_eq!(
        crate::config::read_json_file::<Value>(&crate::codex_config::get_codex_auth_path())
            .unwrap(),
        login
    );
}
#[test]
#[serial]
fn interrupted_publish_recovers_all_files_and_pointer() {
    let f = Fixture::new();
    let state = &f.state;
    seed("approval_policy = 'on-request'\n");
    state.db.save_provider("codex", &row("a")).unwrap();
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(ProviderService::switch(state, AppType::Codex, "a").is_err());
    assert!(crate::mode::operation::has_pending("codex"));
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(state, AppType::Codex).unwrap(),
        "a"
    );
    assert!(live_text().contains("a-key"));
    assert!(!crate::mode::operation::has_pending("codex"));
}
#[test]
#[serial]
fn inactive_editor_global_changes_detect_conflict_and_restore_row() {
    let f = Fixture::new();
    let state = &f.state;
    seed("approval_policy = 'on-request'\n");
    for id in ["a", "b"] {
        state.db.save_provider("codex", &row(id)).unwrap();
    }
    ProviderService::switch(state, AppType::Codex, "a").unwrap();
    let view = ProviderService::codex_editor_view(state, &row("b").settings_config, None).unwrap();
    seed(&live_text().replace("'on-request'", "'never'"));
    let mut edited = row("b");
    edited.settings_config = view.settings.clone();
    edited.settings_config["config"] = Value::String(
        view.settings["config"]
            .as_str()
            .unwrap()
            .replace("'on-request'", "'untrusted'"),
    );
    let error = ProviderService::save_codex(
        state,
        edited.clone(),
        Some(EditorSave {
            base: view.settings.clone(),
            on_conflict: ConflictPolicy::Refuse,
        }),
        false,
    )
    .unwrap_err();
    assert!(error.to_string().contains("LIVE_EDIT_CONFLICT"));
    assert_eq!(
        state
            .db
            .get_provider_by_id("b", "codex")
            .unwrap()
            .unwrap()
            .settings_config,
        row("b").settings_config
    );
    ProviderService::save_codex(
        state,
        edited,
        Some(EditorSave {
            base: view.settings,
            on_conflict: ConflictPolicy::KeepMine,
        }),
        false,
    )
    .unwrap();
    assert!(live_text().contains("untrusted"));
    assert!(live_text().contains("a-key"));
    assert!(!live_text().contains("b-key"));
}

#[test]
#[serial]
fn takeover_preserves_inline_route_and_live_globals() {
    let f = Fixture::new();
    seed("approval_policy = 'on-request'\n");
    super::codex_direct::apply_takeover_settings(&f.state.db, &json!({"config":"model_provider = 'custom'\nmodel_providers = { custom = { base_url = 'http://127.0.0.1:15721/v1', experimental_bearer_token = 'PROXY_MANAGED', wire_api = 'responses', requires_openai_auth = false } }\n"})).unwrap();
    let doc: toml::Value = toml::from_str(&live_text()).unwrap();
    assert_eq!(
        doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
        Some("PROXY_MANAGED")
    );
    assert_eq!(doc["approval_policy"].as_str(), Some("on-request"));
}
#[test]
#[serial]
fn editing_auth_store_uses_the_new_store_mode_for_login_stamp() {
    let f = Fixture::new();
    let state = &f.state;
    let mut settings = get_settings();
    settings.preserve_codex_official_auth_on_switch = true;
    update_settings(settings).unwrap();
    seed("cli_auth_credentials_store = 'file'\n");
    crate::config::write_json_file_private(
        &crate::codex_config::get_codex_auth_path(),
        &json!({"auth_mode":"chatgpt","tokens":{"refresh_token":"native"}}),
    )
    .unwrap();
    ProviderService::add(state, AppType::Codex, row("a"), true).unwrap();
    let view = ProviderService::codex_editor_view(state, &row("a").settings_config, None).unwrap();
    let mut edited = row("a");
    edited.settings_config = view.settings.clone();
    edited.settings_config["config"] = Value::String(
        view.settings["config"]
            .as_str()
            .unwrap()
            .replace("'file'", "'ephemeral'"),
    );
    ProviderService::save_codex(
        state,
        edited,
        Some(EditorSave {
            base: view.settings,
            on_conflict: ConflictPolicy::Refuse,
        }),
        false,
    )
    .unwrap();
    let doc: toml::Value = toml::from_str(&live_text()).unwrap();
    assert_eq!(
        doc["model_providers"]["custom"]["requires_openai_auth"].as_bool(),
        Some(false)
    );
    assert!(crate::codex_config::get_codex_auth_path().exists());
}

/// Codex 官方卡的编辑器：auth.json 框显示盘上真实的登录（Codex 轮换过 token，行里旧版
/// 回填的快照早就对不上了）；不改直接保存，行里原来的 auth 不变、盘上的登录也不动（上游 2c2d6c43）。
#[test]
#[serial]
fn codex_editor_official_auth_shows_disk_login_and_keeps_row_auth() {
    let f = Fixture::new();
    let login = |access: &str| {
        json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "access_token": access,
                "refresh_token": format!("{access}-refresh"),
                "account_id": "acct-official"
            }
        })
    };
    seed("");
    let auth_path = crate::codex_config::get_codex_auth_path();
    std::fs::write(&auth_path, login("fresh").to_string()).unwrap();

    for (id, stored_auth) in [("codex-official", login("stale")), ("follow", json!({}))] {
        let mut official = Provider::with_id(
            id.into(),
            id.into(),
            json!({ "auth": stored_auth.clone(), "config": "" }),
            None,
        );
        official.category = Some("official".into());
        f.state.db.save_provider("codex", &official).unwrap();

        let view = ProviderService::codex_editor_view(
            &f.state,
            &official.settings_config,
            Some("official"),
        )
        .unwrap();
        assert_eq!(
            view.settings.pointer("/auth/tokens/access_token"),
            Some(&json!("fresh")),
            "{id}: the auth.json box shows the login on disk, not the row snapshot"
        );

        let mut edited = official.clone();
        edited.settings_config = view.settings.clone();
        ProviderService::save_codex(
            &f.state,
            edited,
            Some(EditorSave {
                base: view.settings.clone(),
                on_conflict: ConflictPolicy::Refuse,
            }),
            false,
        )
        .unwrap();

        let saved = f.state.db.get_provider_by_id(id, "codex").unwrap().unwrap();
        assert_eq!(
            saved.settings_config.get("auth"),
            Some(&stored_auth),
            "{id}: an untouched auth box must not capture the disk login into the row"
        );
        let on_disk: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth_path).unwrap()).unwrap();
        assert_eq!(
            on_disk,
            login("fresh"),
            "{id}: saving leaves auth.json alone"
        );
    }
}
