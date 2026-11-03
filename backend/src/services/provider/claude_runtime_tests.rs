//! Claude runtime integration, always isolated in a temporary home.
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

fn read_live() -> Value {
    crate::config::read_json_file(&crate::config::get_claude_settings_path()).unwrap()
}
fn write_live(value: &Value) {
    crate::config::write_json_file(&crate::config::get_claude_settings_path(), value).unwrap();
}
fn save(
    state: &AppState,
    row: Provider,
    base: Value,
    policy: ConflictPolicy,
    add: bool,
) -> Result<bool, crate::error::AppError> {
    ProviderService::save_claude(
        state,
        row,
        Some(EditorSave {
            base,
            on_conflict: policy,
        }),
        add,
    )
}

#[test]
#[serial]
fn add_without_switching_keeps_the_first_provider_inactive() {
    // 深链接导入时关掉「导入后立即切换」：首个供应商也只存进列表，不写 live、不设当前
    let fixture = Fixture::new();
    let state = &fixture.state;
    write_live(&json!({"env":{"DEBUG":"1"}}));
    let row = provider(
        "link",
        json!({"env":{"ANTHROPIC_AUTH_TOKEN":"link-key","ANTHROPIC_BASE_URL":"https://api.example.com"}}),
    );
    ProviderService::add_without_switching(state, AppType::Claude, row.clone()).unwrap();

    assert!(state
        .db
        .get_provider_by_id("link", "claude")
        .unwrap()
        .is_some());
    assert!(state.db.get_current_provider("claude").unwrap().is_none());
    assert_eq!(read_live(), json!({"env":{"DEBUG":"1"}}));
    // 同一个 ID 不能被覆盖
    assert!(ProviderService::add_without_switching(state, AppType::Claude, row).is_err());

    // 对照：普通的 add 会让首个供应商直接生效
    let other = provider("other", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"other-key"}}));
    ProviderService::add(state, AppType::Claude, other, true).unwrap();
    assert_eq!(read_live()["env"]["ANTHROPIC_AUTH_TOKEN"], "other-key");
}

#[test]
#[serial]
fn switching_preserves_globals_and_removes_only_owned_exclusive_values() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    write_live(&json!({"hooks":{"Stop":[]},"permissions":{"allow":["Read"]},"env":{"DEBUG":"1"}}));
    let a = provider(
        "a",
        json!({"env":{"ANTHROPIC_AUTH_TOKEN":"a-key","ENABLE_TOOL_SEARCH":"false","CLAUDE_CODE_DISABLE_ARTIFACT":"1"},"hooks":{"Stop":["ignored"]}}),
    );
    let b = provider("b", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"b-key"}}));
    state.db.save_provider("claude", &a).unwrap();
    state.db.save_provider("claude", &b).unwrap();
    ProviderService::switch(state, AppType::Claude, "a").unwrap();
    let mut live = read_live();
    live["env"]["ENABLE_TOOL_SEARCH"] = json!("user-custom");
    write_live(&live);
    ProviderService::switch(state, AppType::Claude, "b").unwrap();
    let live = read_live();
    assert_eq!(live["env"]["ENABLE_TOOL_SEARCH"], "user-custom");
    assert!(live["env"].get("CLAUDE_CODE_DISABLE_ARTIFACT").is_none());
    assert_eq!(live["hooks"], json!({"Stop":[]}));
    assert_eq!(live["permissions"], json!({"allow":["Read"]}));
    assert_eq!(
        state
            .db
            .get_provider_by_id("a", "claude")
            .unwrap()
            .unwrap()
            .settings_config,
        a.settings_config
    );
    let mut official = provider("official", json!({"env":{}}));
    official.category = Some("official".into());
    state.db.save_provider("claude", &official).unwrap();
    ProviderService::switch(state, AppType::Claude, "official").unwrap();
    assert!(read_live()["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    assert_eq!(read_live()["env"]["DEBUG"], "1");
}

#[test]
#[serial]
fn editor_saves_inactive_globals_without_switching_and_refuses_concurrent_changes() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    write_live(&json!({"theme":"dark"}));
    let a = provider("a", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"a-key"}}));
    ProviderService::add(state, AppType::Claude, a, true).unwrap();
    let b = provider("b", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"b-key"}}));
    state.db.save_provider("claude", &b).unwrap();
    let base = ProviderService::claude_editor_view(state, &b.settings_config)
        .unwrap()
        .settings;
    let mut edited = b.clone();
    edited.settings_config = base.clone();
    edited.settings_config["theme"] = json!("light");
    let mut live = read_live();
    live["theme"] = json!("external");
    live["hooks"] = json!({"Stop":[]});
    write_live(&live);
    assert!(save(
        state,
        edited.clone(),
        base.clone(),
        ConflictPolicy::Refuse,
        false
    )
    .unwrap_err()
    .to_string()
    .contains("LIVE_EDIT_CONFLICT"));
    assert_eq!(read_live(), live);
    assert_eq!(
        state
            .db
            .get_provider_by_id("b", "claude")
            .unwrap()
            .unwrap()
            .settings_config,
        b.settings_config
    );
    save(
        state,
        edited.clone(),
        base.clone(),
        ConflictPolicy::KeepTheirs,
        false,
    )
    .unwrap();
    assert_eq!(read_live()["theme"], "external");
    save(state, edited, base, ConflictPolicy::KeepMine, false).unwrap();
    assert_eq!(read_live()["theme"], "light");
    assert_eq!(read_live()["hooks"], json!({"Stop":[]}));
    assert_eq!(read_live()["env"]["ANTHROPIC_AUTH_TOKEN"], "a-key");
    assert_eq!(
        ProviderService::current(state, AppType::Claude).unwrap(),
        "a"
    );
}

#[test]
#[serial]
fn corrupt_live_rolls_back_new_row_and_interrupted_first_save_recovers() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    write_live(&json!({}));
    std::fs::write(crate::config::get_claude_settings_path(), b"{broken").unwrap();
    let row = provider("a", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"key"}}));
    assert!(ProviderService::add(state, AppType::Claude, row.clone(), true).is_err());
    assert!(state
        .db
        .get_provider_by_id("a", "claude")
        .unwrap()
        .is_none());
    assert_eq!(
        std::fs::read(crate::config::get_claude_settings_path()).unwrap(),
        b"{broken"
    );
    write_live(&json!({"hooks":{"Stop":[]}}));
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(ProviderService::add(state, AppType::Claude, row, true).is_err());
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(state, AppType::Claude).unwrap(),
        "a"
    );
    assert!(state
        .db
        .get_provider_by_id("a", "claude")
        .unwrap()
        .is_some());
    assert_eq!(read_live()["hooks"], json!({"Stop":[]}));
    assert!(
        super::claude_direct::previous_projection(state.db.as_ref(), None)
            .unwrap()
            .is_some()
    );
}

#[test]
#[serial]
fn proxy_writes_and_restore_preserve_global_edits() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let direct =
        json!({"env":{"ANTHROPIC_AUTH_TOKEN":"real-key","CLAUDE_CODE_DISABLE_ARTIFACT":"1"}});
    write_live(&json!({"theme":"dark"}));
    super::claude_direct::apply_settings(&state.db, &direct).unwrap();
    super::claude_direct::apply_settings(&state.db, &json!({"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:15721","ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED","ENABLE_TOOL_SEARCH":"false"}})).unwrap();
    assert!(read_live()["env"]
        .get("CLAUDE_CODE_DISABLE_ARTIFACT")
        .is_none());
    let mut live = read_live();
    live["theme"] = json!("light");
    write_live(&live);
    super::claude_direct::apply_settings(&state.db, &direct).unwrap();
    assert_eq!(read_live()["theme"], "light");
    assert!(read_live()["env"].get("ENABLE_TOOL_SEARCH").is_none());
    assert_eq!(read_live()["env"]["ANTHROPIC_AUTH_TOKEN"], "real-key");
}

#[test]
#[serial]
fn editing_taken_over_provider_commits_globals_and_proxy_keys_together() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let row = provider("a", json!({"env":{"ANTHROPIC_AUTH_TOKEN":"real-key"}}));
    state.db.save_provider("claude", &row).unwrap();
    state.db.set_current_provider("claude", "a").unwrap();
    crate::settings::set_current_provider(&AppType::Claude, Some("a")).unwrap();
    futures::executor::block_on(
        state
            .db
            .save_live_backup("claude", &row.settings_config.to_string()),
    )
    .unwrap();
    write_live(
        &json!({"theme":"dark","env":{"ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED","ANTHROPIC_BASE_URL":"http://127.0.0.1:15721"}}),
    );
    let base = ProviderService::claude_editor_view(state, &row.settings_config)
        .unwrap()
        .settings;
    let mut edited = row.clone();
    edited.settings_config = base.clone();
    edited.settings_config["theme"] = json!("light");
    edited.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"] = json!("new-key");
    let mut external = read_live();
    external["theme"] = json!("external");
    write_live(&external);
    assert!(save(
        state,
        edited.clone(),
        base.clone(),
        ConflictPolicy::Refuse,
        false
    )
    .is_err());
    assert_eq!(read_live(), external);
    let backup = futures::executor::block_on(state.db.get_live_backup("claude"))
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&backup.original_config).unwrap(),
        row.settings_config
    );
    save(state, edited, base, ConflictPolicy::KeepMine, false).unwrap();
    assert_eq!(read_live()["theme"], "light");
    assert_eq!(read_live()["env"]["ANTHROPIC_AUTH_TOKEN"], "PROXY_MANAGED");
    let backup = futures::executor::block_on(state.db.get_live_backup("claude"))
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&backup.original_config).unwrap()["env"]
            ["ANTHROPIC_AUTH_TOKEN"],
        "new-key"
    );
}
