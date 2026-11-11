use super::*;

#[tokio::test]
#[serial_test::serial]
async fn resource_resync_http_reports_failures_and_preserves_unmanaged_files() {
    let fixture = crate::mode::controller::tests::Fixture::new();
    let state = Arc::new(fixture.state.clone());
    let skill_dir =
        crate::services::skill::SkillService::get_app_skills_dir(&AppType::OpenClaw).unwrap();
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("owned.txt"), "keep").unwrap();
    let web = WebApiState {
        app_state: state.clone(),
        copilot_auth_state: state.copilot_auth_state.clone(),
        codex_oauth_state: state.codex_oauth_state.clone(),
        xai_oauth_state: state.xai_oauth_state.clone(),
        access_key: WebAccessKey::new(None).unwrap(),
    };
    let app = Router::new()
        .route("/mcp", post(resync_mcp))
        .route("/skills", post(resync_skills))
        .route("/paths", get(skill_storage_paths))
        .route("/scan", get(last_session_scan))
        .with_state(web);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for app in ["unknown", "openclaw", "claude-desktop"] {
        let response = client
            .post(format!("{url}/mcp"))
            .json(&json!({"apps":[app]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let outcome: Value = client
        .post(format!("{url}/mcp"))
        .json(&json!({"apps":["claude","claude"]}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(outcome.as_array().unwrap().len(), 1);
    assert_eq!(outcome[0]["app"], "claude");
    assert_eq!(outcome[0]["ok"], true);
    let skills: Value = client
        .post(format!("{url}/skills"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(skills
        .as_array()
        .unwrap()
        .iter()
        .all(|o| o["app"] != "openclaw" && o["ok"] == true));
    assert_eq!(
        std::fs::read_to_string(skill_dir.join("owned.txt")).unwrap(),
        "keep"
    );
    let paths: Value = client
        .get(format!("{url}/paths"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(paths["ccSwitch"].as_str().unwrap().ends_with("skills"));
    crate::services::session_usage::sync_all_unlocked(&state.db);
    let scanned: Option<i64> = client
        .get(format!("{url}/scan"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(scanned.is_some_and(|value| value > 0));
    server.abort();
}

#[tokio::test]
#[serial_test::serial]
async fn omp_api_key_reference_reports_keys_omp_would_resolve() {
    let _fixture = crate::mode::controller::tests::Fixture::new();
    let probe = |value: &str| {
        omp_api_key_is_reference(Json(OmpApiKeyReferenceRequest {
            value: value.to_string(),
        }))
    };
    let previous = std::env::var_os("ccswitch_link_probe_secret");
    std::env::set_var("ccswitch_link_probe_secret", "real-secret");
    let resolved = probe("ccswitch_link_probe_secret").await.ok().unwrap().0;
    match previous {
        Some(value) => std::env::set_var("ccswitch_link_probe_secret", value),
        None => std::env::remove_var("ccswitch_link_probe_secret"),
    }
    assert!(resolved, "omp 会把环境里的值发到链接给的地址");
    assert!(probe("!printf secret").await.ok().unwrap().0);
    assert!(!probe("sk-literal-key").await.ok().unwrap().0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn profile_and_universal_mutations_wait_for_their_serial_locks() {
    let fixture = crate::mode::controller::tests::Fixture::new();
    let state = Arc::new(fixture.state.clone());
    let web = WebApiState {
        app_state: state.clone(),
        copilot_auth_state: state.copilot_auth_state.clone(),
        codex_oauth_state: state.codex_oauth_state.clone(),
        xai_oauth_state: state.xai_oauth_state.clone(),
        access_key: WebAccessKey::new(None).unwrap(),
    };

    // 非法参数不用等锁就拒绝
    let held = PROFILE_LOCK.lock().await;
    let rejected = create_profile(
        State(web.clone()),
        Json(CreateProfileRequest {
            name: "x".into(),
            scope: "not-a-scope".into(),
        }),
    )
    .await;
    assert!(rejected.is_err());

    let create = tokio::spawn(create_profile(
        State(web.clone()),
        Json(CreateProfileRequest {
            name: "Serial".into(),
            scope: "claude".into(),
        }),
    ));
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!create.is_finished(), "项目写入要等前一个写入结束");
    drop(held);
    let created = create.await.unwrap().ok().unwrap().0;
    assert_eq!(created.name, "Serial");

    let held = UNIVERSAL_LOCK.lock().await;
    let delete = tokio::spawn(delete_universal_provider(
        State(web.clone()),
        Path("missing".to_string()),
    ));
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!delete.is_finished(), "统一供应商写入要等前一个写入结束");
    drop(held);
    let _ = delete.await.unwrap();
}
