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
