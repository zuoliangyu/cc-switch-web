use super::ProviderService;
use crate::app_config::AppType;
use crate::database::{Database, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID};
use crate::provider::Provider;
use crate::settings::{get_settings, update_settings, AppSettings};
use crate::store::AppState;
use serde_json::{json, Value};
use serial_test::serial;
use std::{ffi::OsString, fs, path::PathBuf, sync::Arc};

struct Fixture {
    previous_env: Vec<(&'static str, Option<OsString>)>,
    previous_settings: AppSettings,
    state: AppState,
    claude_settings: PathBuf,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let previous_env = ["CC_SWITCH_TEST_HOME", "LOCALAPPDATA", "XDG_CONFIG_HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        std::env::set_var("LOCALAPPDATA", dir.path().join("local"));
        std::env::set_var("XDG_CONFIG_HOME", dir.path().join("config"));
        let previous_settings = get_settings();
        update_settings(AppSettings::default()).unwrap();
        let claude_settings = crate::config::get_claude_settings_path();
        fs::create_dir_all(claude_settings.parent().unwrap()).unwrap();
        fs::write(&claude_settings, b"{\"claudeCodeOnly\":true}\n").unwrap();
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        for id in ["desktop-a", "desktop-b"] {
            state
                .db
                .save_provider(
                    "claude-desktop",
                    &Provider::with_id(
                        id.into(),
                        id.into(),
                        json!({"env": {
                            "ANTHROPIC_BASE_URL": format!("https://{id}.example.com"),
                            "ANTHROPIC_AUTH_TOKEN": format!("test-{id}")
                        }}),
                        None,
                    ),
                )
                .unwrap();
        }
        let mut official = Provider::with_id(
            CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID.into(),
            "Official".into(),
            json!({"env":{}}),
            None,
        );
        official.category = Some("official".into());
        state.db.save_provider("claude-desktop", &official).unwrap();
        Self {
            previous_env,
            previous_settings,
            state,
            claude_settings,
            _dir: dir,
        }
    }

    fn switch(&self, id: &str) -> Result<super::SwitchResult, crate::error::AppError> {
        ProviderService::switch(&self.state, AppType::ClaudeDesktop, id)
    }

    fn assert_isolated(&self) {
        assert_eq!(
            fs::read(&self.claude_settings).unwrap(),
            b"{\"claudeCodeOnly\":true}\n"
        );
        assert!(!self._dir.path().join(".cc-switch").exists());
        assert!(self
            ._dir
            .path()
            .join(".cc-switch-web/backups/live-first-write")
            .exists());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        crate::mode::operation::failpoint::crash_at(None);
        update_settings(self.previous_settings.clone()).unwrap();
        for (key, value) in &self.previous_env {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

#[test]
#[serial]
fn desktop_switch_preserves_user_profile_and_never_writes_claude_code() {
    let fixture = Fixture::new();
    assert_eq!(
        "claude-desktop".parse::<AppType>().unwrap(),
        AppType::ClaudeDesktop
    );
    fixture.switch("desktop-a").unwrap();
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    let profile_path = PathBuf::from(status.profile_path.unwrap());
    let mut profile: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    profile["userSetting"] = json!({"keep": true});
    profile["disableDeploymentModeChooser"] = json!(false);
    crate::config::write_json_file(&profile_path, &profile).unwrap();

    fixture.switch("desktop-b").unwrap();
    let switched: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    assert_eq!(switched["inferenceGatewayApiKey"], "test-desktop-b");
    assert_eq!(switched["userSetting"], profile["userSetting"]);
    assert_eq!(switched["disableDeploymentModeChooser"], false);

    fixture.switch(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID).unwrap();
    let official: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    assert!(official.get("inferenceGatewayApiKey").is_none());
    assert_eq!(official["userSetting"], profile["userSetting"]);
    assert!(
        !crate::claude_desktop_config::get_status(&fixture.state.db, false)
            .unwrap()
            .configured
    );
    fixture.assert_isolated();
}

#[test]
#[serial]
fn desktop_rejects_corrupt_meta_without_switching_current() {
    let fixture = Fixture::new();
    fixture.switch("desktop-a").unwrap();
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    let profile = PathBuf::from(status.profile_path.unwrap());
    let original = fs::read(&profile).unwrap();
    let meta = profile.parent().unwrap().join("_meta.json");
    fs::write(&meta, b"[]").unwrap();
    assert!(fixture.switch("desktop-b").is_err());
    assert_eq!(
        ProviderService::current(&fixture.state, AppType::ClaudeDesktop).unwrap(),
        "desktop-a"
    );
    assert_eq!(fs::read(&profile).unwrap(), original);
    assert_eq!(fs::read(&meta).unwrap(), b"[]");
    fixture.assert_isolated();
}

#[test]
#[serial]
fn desktop_current_read_recovers_interrupted_files_and_pointer() {
    let fixture = Fixture::new();
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(fixture.switch("desktop-b").is_err());
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(&fixture.state, AppType::ClaudeDesktop).unwrap(),
        "desktop-b"
    );
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    assert!(status.configured);
    assert_eq!(
        status.actual_base_url.as_deref(),
        Some("https://desktop-b.example.com")
    );
    assert!(crate::mode::state::pending(
        &crate::live::engine::DeviceStore::for_device(),
        "claude-desktop"
    )
    .unwrap()
    .is_none());
    fixture.assert_isolated();
}

/// 本机空闲端口：路由服务按它监听，profile 里的网关地址也就确定下来。
async fn listen_on_free_port(state: &AppState) -> u16 {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = port;
    state.db.update_global_proxy_config(global).await.unwrap();
    port
}

/// 模型映射卡：Desktop 看到的 `route` 映射到上游的 `upstream`。
fn mapping_card(id: &str, name: &str, route: &str, upstream: &str) -> Provider {
    use crate::provider::{ClaudeDesktopMode, ClaudeDesktopModelRoute, ProviderMeta};
    let mut row = Provider::with_id(
        id.into(),
        name.into(),
        json!({"env": {
            "ANTHROPIC_BASE_URL": format!("https://{id}.example.com"),
            "ANTHROPIC_AUTH_TOKEN": format!("test-{id}")
        }}),
        None,
    );
    row.meta = Some(ProviderMeta {
        claude_desktop_mode: Some(ClaudeDesktopMode::Proxy),
        claude_desktop_model_routes: std::collections::HashMap::from([(
            route.into(),
            ClaudeDesktopModelRoute {
                model: upstream.into(),
                label_override: None,
                supports_1m: None,
            },
        )]),
        ..Default::default()
    });
    row
}

fn profile(state: &AppState) -> Value {
    let status = crate::claude_desktop_config::get_status(&state.db, true).unwrap();
    serde_json::from_slice(&fs::read(status.profile_path.unwrap()).unwrap()).unwrap()
}

fn desktop_mode() -> crate::mode::state::ModeState {
    crate::mode::current::mode_state(&AppType::ClaudeDesktop)
}

/// Desktop 的直连 / 路由是设备级模式（上游 3e9eede4）：路由模式写指向本地路由的网关 profile，
/// 模型列表是路由那家的映射表；退出 CC Switch 不分离；退回直连写回直连那家、停掉服务、路由留着。
#[tokio::test]
#[serial]
async fn desktop_route_mode_writes_the_gateway_and_exit_restores_direct() {
    let f = Fixture::new();
    let state = &f.state;
    let port = listen_on_free_port(state).await;
    let desktop = AppType::ClaudeDesktop;
    state
        .db
        .save_provider(
            "claude-desktop",
            &mapping_card("map", "Map", "claude-sonnet-5", "kimi-k3"),
        )
        .unwrap();
    let switch_state = state.clone();
    tokio::task::spawn_blocking(move || {
        ProviderService::switch(&switch_state, AppType::ClaudeDesktop, "desktop-a")
    })
    .await
    .unwrap()
    .unwrap();

    crate::mode::controller::enter(state, &desktop, Some("map"))
        .await
        .unwrap();
    assert!(desktop_mode().is_proxy() && desktop_mode().attached);
    assert!(state.proxy_service.is_running().await);
    let routed = profile(state);
    assert_eq!(
        routed["inferenceGatewayBaseUrl"],
        json!(format!("http://127.0.0.1:{port}/claude-desktop"))
    );
    assert_eq!(routed["inferenceModels"], json!(["claude-sonnet-5"]));
    assert_eq!(routed["inferenceGatewayAuthScheme"], json!("bearer"));
    assert_eq!(routed["modelDiscoveryEnabled"], json!(true));
    // 请求按路由那家走
    assert_eq!(
        crate::mode::current::provider_for(
            &state.db,
            &desktop,
            crate::mode::current::Purpose::InUse
        )
        .unwrap()
        .as_deref(),
        Some("map")
    );

    // Claude Code 退出路由时，Desktop 还在路由模式，服务不能跟着停。
    crate::mode::controller::exit(state, &AppType::Claude)
        .await
        .unwrap();
    assert!(state.proxy_service.is_running().await);

    // 退出 CC Switch 不分离 Desktop：它只在启动时读配置。
    crate::mode::controller::detach_all(state).await.unwrap();
    assert!(desktop_mode().attached);
    assert_eq!(
        profile(state)["inferenceGatewayBaseUrl"],
        routed["inferenceGatewayBaseUrl"]
    );

    // 退回直连：写回直连那家，没人在用路由了，服务停掉；路由留着下次用。
    state.proxy_service.start().await.unwrap();
    crate::mode::controller::exit(state, &desktop)
        .await
        .unwrap();
    assert!(!desktop_mode().is_proxy());
    assert!(!state.proxy_service.is_running().await);
    assert_eq!(
        profile(state)["inferenceGatewayBaseUrl"],
        json!("https://desktop-a.example.com")
    );
    assert_eq!(desktop_mode().proxy_route.as_deref(), Some("map"));
    f.assert_isolated();
}

/// 直连模式下用不了要经路由的卡：切过去、把正在用的卡改成映射卡都拒绝，什么都不写。
#[tokio::test]
#[serial]
async fn desktop_direct_mode_refuses_cards_that_need_routing() {
    let f = Fixture::new();
    let state = f.state.clone();
    tokio::task::spawn_blocking(move || {
        state
            .db
            .save_provider(
                "claude-desktop",
                &mapping_card("map", "Map", "claude-sonnet-5", "kimi-k3"),
            )
            .unwrap();
        ProviderService::switch(&state, AppType::ClaudeDesktop, "desktop-a").unwrap();
        let before = profile(&state);

        let error = ProviderService::switch(&state, AppType::ClaudeDesktop, "map").unwrap_err();
        assert!(error.to_string().contains("本地路由"), "{error}");
        let mut edited = mapping_card("desktop-a", "desktop-a", "claude-sonnet-5", "kimi-k3");
        edited.settings_config = state
            .db
            .get_provider_by_id("desktop-a", "claude-desktop")
            .unwrap()
            .unwrap()
            .settings_config;
        assert!(ProviderService::update(&state, AppType::ClaudeDesktop, None, edited).is_err());

        assert_eq!(
            ProviderService::current(&state, AppType::ClaudeDesktop).unwrap(),
            "desktop-a"
        );
        assert_eq!(profile(&state), before);
        assert!(state
            .db
            .get_provider_by_id("desktop-a", "claude-desktop")
            .unwrap()
            .unwrap()
            .meta
            .and_then(|meta| meta.claude_desktop_mode)
            .is_none());
    })
    .await
    .unwrap();
    f.assert_isolated();
}

/// 升级前的旧版状态：直连指针是模型映射卡（旧版按卡片决定模式）。启动时拆成路由模式、路由
/// 到这张卡、直连指针改为官方（上游 3e9eede4、58354f91）；第二次启动不再看卡片。
#[tokio::test]
#[serial]
async fn desktop_on_a_mapping_card_starts_in_route_mode_after_upgrade() {
    let f = Fixture::new();
    let state = &f.state;
    listen_on_free_port(state).await;
    let desktop = AppType::ClaudeDesktop;
    state
        .db
        .save_provider(
            "claude-desktop",
            &mapping_card("map", "Map", "claude-sonnet-5", "kimi-k3"),
        )
        .unwrap();
    crate::settings::set_current_provider(&desktop, Some("map")).unwrap();

    crate::mode::controller::startup(state).await;

    let mode = desktop_mode();
    assert!(mode.is_proxy() && mode.attached);
    assert_eq!(mode.proxy_route.as_deref(), Some("map"));
    assert!(state.proxy_service.is_running().await);
    assert_eq!(
        crate::mode::current::direct_provider(&state.db, &desktop)
            .unwrap()
            .map(|row| row.id)
            .as_deref(),
        Some(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID)
    );

    crate::mode::controller::exit(state, &desktop)
        .await
        .unwrap();
    assert!(profile(state).get("inferenceGatewayApiKey").is_none());
    crate::mode::controller::startup(state).await;
    assert!(!desktop_mode().is_proxy());
    assert!(!state.proxy_service.is_running().await);
    f.assert_isolated();
}

/// 没有官方卡的 Web 数据库：迁移时补一行官方卡，直连指针指向它。
#[tokio::test]
#[serial]
async fn desktop_upgrade_adds_the_official_card_when_missing() {
    let f = Fixture::new();
    let state = &f.state;
    listen_on_free_port(state).await;
    let desktop = AppType::ClaudeDesktop;
    state
        .db
        .delete_provider("claude-desktop", CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID)
        .unwrap();
    state
        .db
        .save_provider(
            "claude-desktop",
            &mapping_card("map", "Map", "claude-sonnet-5", "kimi-k3"),
        )
        .unwrap();
    crate::settings::set_current_provider(&desktop, Some("map")).unwrap();

    crate::mode::controller::startup(state).await;

    let official = state
        .db
        .get_provider_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, "claude-desktop")
        .unwrap()
        .expect("official card added");
    assert_eq!(official.category.as_deref(), Some("official"));
    assert_eq!(
        crate::mode::current::provider_for(
            &state.db,
            &desktop,
            crate::mode::current::Purpose::Direct
        )
        .unwrap()
        .as_deref(),
        Some(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID)
    );
    crate::mode::controller::exit(state, &desktop)
        .await
        .unwrap();
    f.assert_isolated();
}

/// 聚合模式（上游 b93bf12d、9267ec8b）：默认那家的映射表在前，别家的模型用 `claude-fable-ccs-*`
/// 跟在后面，标签带供应商名；选中聚合模型的请求直达那一家。官方卡、映射表不完整的卡不能加入。
#[tokio::test]
#[serial]
async fn desktop_stack_mode_lists_the_members_after_the_default() {
    let f = Fixture::new();
    let state = &f.state;
    listen_on_free_port(state).await;
    let desktop = AppType::ClaudeDesktop;
    for row in [
        mapping_card("map", "Map", "claude-sonnet-5", "kimi-k3"),
        mapping_card("other", "Other", "claude-sonnet-5", "glm-5.2"),
    ] {
        state.db.save_provider("claude-desktop", &row).unwrap();
    }

    crate::mode::controller::enter_mode(state, &desktop, Some("map"), true)
        .await
        .unwrap();
    assert_eq!(
        crate::mode::controller::view(state, &desktop)
            .await
            .unwrap()
            .mode,
        "aggregation"
    );
    crate::mode::controller::set_stack_member(state, &desktop, "other", true)
        .await
        .unwrap();
    let routed = profile(state);
    let models = routed["inferenceModels"].as_array().unwrap();
    assert_eq!(models[0], json!("claude-sonnet-5"));
    assert_eq!(models.len(), 2, "{models:?}");
    let stacked = &models[1];
    let stacked_id = stacked["name"].as_str().unwrap();
    assert!(stacked_id.starts_with("claude-fable-ccs-"), "{stacked_id}");
    assert_eq!(stacked["labelOverride"], json!("Other / glm-5.2"));
    assert_eq!(routed["modelDiscoveryEnabled"], json!(true));

    match crate::mode::stack::resolve(
        &state.db,
        &crate::live::engine::DeviceStore::for_device(),
        &desktop,
        stacked_id,
    )
    .unwrap()
    {
        crate::mode::stack::Resolved::Hit(target) => {
            assert_eq!(target.provider.id, "other");
            assert_eq!(target.upstream_model, "glm-5.2");
        }
        other => panic!("expected a hit, got {other:?}"),
    }

    // 官方卡、没存映射表的直连卡不能加入聚合。
    for id in [CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, "desktop-b"] {
        assert!(
            crate::mode::controller::set_stack_member(state, &desktop, id, true)
                .await
                .is_err(),
            "{id}"
        );
    }

    // 换回路由模式：名单留着，模型列表只剩路由那家的。
    crate::mode::controller::enter_mode(state, &desktop, Some("map"), false)
        .await
        .unwrap();
    assert_eq!(
        profile(state)["inferenceModels"],
        json!(["claude-sonnet-5"])
    );
    assert!(crate::mode::state::stack(
        &crate::live::engine::DeviceStore::for_device(),
        "claude-desktop"
    )
    .unwrap()
    .is_member("other"));
    crate::mode::controller::exit(state, &desktop)
        .await
        .unwrap();
    f.assert_isolated();
}

/// 没存模型列表的原生直连卡也能进路由（上游 7344cc37）：按默认档位发布（UI 的档位顺序，上游
/// 983113a1），不把这份默认目录存进行；之后在同一张卡上存映射，路由模式下按新行重写 profile。
#[tokio::test]
#[serial]
async fn desktop_native_direct_card_can_enter_routing_before_becoming_a_mapping_card() {
    let f = Fixture::new();
    let state = &f.state;
    listen_on_free_port(state).await;
    let desktop = AppType::ClaudeDesktop;
    let native = state
        .db
        .get_provider_by_id("desktop-a", "claude-desktop")
        .unwrap()
        .unwrap();

    crate::mode::controller::enter(state, &desktop, Some("desktop-a"))
        .await
        .unwrap();
    let routed = profile(state);
    assert_eq!(
        routed["inferenceModels"],
        json!([
            "claude-sonnet-5",
            "claude-opus-5",
            "claude-fable-5",
            "claude-haiku-4-5"
        ])
    );
    let stored = state
        .db
        .get_provider_by_id("desktop-a", "claude-desktop")
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(&stored.meta).unwrap(),
        serde_json::to_value(&native.meta).unwrap(),
        "routing must not persist its bootstrap catalog"
    );

    let mut mapped = mapping_card("desktop-a", "desktop-a", "claude-sonnet-5", "edited-model");
    mapped.settings_config = native.settings_config.clone();
    let update_state = state.clone();
    tokio::task::spawn_blocking(move || {
        ProviderService::update(&update_state, AppType::ClaudeDesktop, None, mapped)
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        profile(state)["inferenceModels"],
        json!(["claude-sonnet-5"])
    );
    crate::mode::controller::exit(state, &desktop)
        .await
        .unwrap();
    f.assert_isolated();
}
