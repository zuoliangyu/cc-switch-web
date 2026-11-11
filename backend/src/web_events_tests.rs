use super::*;
use futures::StreamExt;

const TEST_ACCESS_KEY: &str = "events-test-access-key";

async fn spawn_events_server(access_key: Option<&str>) -> (String, tokio::task::JoinHandle<()>) {
    let fixture = crate::mode::controller::tests::Fixture::new();
    let state = Arc::new(fixture.state.clone());
    let web = WebApiState {
        app_state: state.clone(),
        copilot_auth_state: state.copilot_auth_state.clone(),
        codex_oauth_state: state.codex_oauth_state.clone(),
        xai_oauth_state: state.xai_oauth_state.clone(),
        access_key: WebAccessKey::new(access_key).unwrap(),
    };
    let app = Router::new()
        .route("/api/events", get(server_events))
        .layer(middleware::from_fn_with_state(
            web.clone(),
            require_access_key,
        ))
        .with_state(web);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, server)
}

#[tokio::test]
#[serial_test::serial]
async fn events_endpoint_requires_the_access_key() {
    let (url, server) = spawn_events_server(Some(TEST_ACCESS_KEY)).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .get(format!("{url}/api/events"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    server.abort();
}

#[tokio::test]
#[serial_test::serial]
async fn events_endpoint_streams_emitted_events_as_sse() {
    let (url, server) = spawn_events_server(Some(TEST_ACCESS_KEY)).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .get(format!("{url}/api/events"))
        .bearer_auth(TEST_ACCESS_KEY)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert!(headers[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    assert_eq!(headers[header::CACHE_CONTROL], "no-cache");
    assert_eq!(headers["x-accel-buffering"], "no");

    // 响应头回来时处理函数已经订阅，之后发的事件一定能收到
    crate::events::emit(
        "test-sse-event",
        json!({ "appType": "claude", "providerId": "p1" }),
    );

    let mut body = response.bytes_stream();
    let mut received = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while !received.contains("event: test-sse-event") {
        let chunk = tokio::time::timeout_at(deadline, body.next())
            .await
            .expect("event arrives in time")
            .expect("stream open")
            .unwrap();
        received.push_str(&String::from_utf8_lossy(&chunk));
    }
    let block = received
        .split("\n\n")
        .find(|block| block.contains("event: test-sse-event"))
        .unwrap();
    let data = block
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    let payload: Value = serde_json::from_str(data).unwrap();
    assert_eq!(payload, json!({ "appType": "claude", "providerId": "p1" }));
    server.abort();
}

#[test]
#[serial_test::serial]
fn profile_apply_emits_provider_switched_per_app_then_profile_applied() {
    let fixture = crate::mode::controller::tests::Fixture::new();
    crate::events::take_test_events();
    emit_profile_apply_events(&fixture.state, "profile-1", ProfileScope::Codex);
    let events = crate::events::take_test_events();
    let names: Vec<&str> = events.iter().map(|event| event.name.as_str()).collect();
    assert_eq!(names, ["provider-switched", "profile-applied"]);
    assert_eq!(events[0].payload["appType"], "codex");
    assert!(events[0].payload.get("proxyEnabled").is_some());
    assert!(events[0].payload.get("autoFailoverEnabled").is_some());
    assert_eq!(
        events[1].payload,
        json!({ "profileId": "profile-1", "scope": "codex" })
    );
}
