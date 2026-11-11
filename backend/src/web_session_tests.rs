use super::*;

#[tokio::test]
#[serial_test::serial]
async fn session_http_stream_and_content_stay_inside_fixture_roots() {
    let _fixture = crate::mode::controller::tests::Fixture::new();
    let root = crate::config::get_claude_config_dir().join("projects").join("fixture");
    std::fs::create_dir_all(&root).unwrap();
    let source = root.join("fixture.jsonl");
    let line = json!({"type":"user","uuid":"u1","message":{"role":"user","content":"中文 fixture"}}).to_string();
    std::fs::write(&source, format!("{line}\n")).unwrap();
    let app = Router::new()
        .route("/stream", get(stream_session_messages))
        .route("/content", post(get_session_block_content));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client.get(format!("{base}/stream"))
        .query(&[("providerId", "claude"), ("sourcePath", source.to_str().unwrap())]).send().await.unwrap();
    assert_eq!(response.headers()["content-type"], "application/x-ndjson");
    let chunks: Vec<Value> = response.text().await.unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert_eq!(chunks.first().unwrap()["type"], "header");
    assert_eq!(chunks[1]["messages"][0]["blocks"][0]["text"], "中文 fixture");
    assert_eq!(chunks.last().unwrap()["type"], "done");
    let response = client.post(format!("{base}/content")).json(&json!({
        "providerId":"claude", "sourcePath":source,
        "contentRef":{"kind":"jsonl","offset":0,"len":line.len(),"pointer":"/message/content"},
        "offset":0,"limit":2
    })).send().await.unwrap();
    let page: Value = response.json().await.unwrap();
    assert_eq!(page["text"], "中文");
    assert_eq!(page["nextOffset"], 2);
    let outside = crate::config::get_home_dir().join("outside.jsonl");
    std::fs::write(&outside, line).unwrap();
    let rejected = client.get(format!("{base}/stream"))
        .query(&[("providerId", "claude"), ("sourcePath", outside.to_str().unwrap())]).send().await.unwrap().text().await.unwrap();
    let error: Value = serde_json::from_str(rejected.trim()).unwrap();
    assert_eq!(error["type"], "error");
    server.abort();
}

#[tokio::test]
#[serial_test::serial]
async fn session_messages_endpoint_serializes_the_cached_transcript_directly() {
    let _fixture = crate::mode::controller::tests::Fixture::new();
    let root = crate::config::get_claude_config_dir()
        .join("projects")
        .join("runtime");
    std::fs::create_dir_all(&root).unwrap();
    let source = root.join("runtime.jsonl");
    let record = json!({"type":"user", "uuid":"u1", "sessionId":"runtime",
        "message":{"role":"user", "content":"你好\n\"quoted\" 😀"}});
    std::fs::write(&source, format!("{record}\n")).unwrap();
    let source = source.to_string_lossy().into_owned();
    let expected =
        serde_json::to_value(crate::session_manager::load_messages("claude", &source).unwrap())
            .unwrap();
    assert_eq!(expected.as_array().unwrap().len(), 1);

    let app = Router::new()
        .route("/messages", get(get_session_messages))
        .route("/stream", get(stream_session_messages));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let query = [("providerId", "claude"), ("sourcePath", source.as_str())];

    let response = client
        .get(format!("{base}/messages"))
        .query(&query)
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "application/json");
    assert_eq!(response.json::<Value>().await.unwrap(), expected);

    let chunks: Vec<Value> = client
        .get(format!("{base}/stream"))
        .query(&query)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0]["type"], "header");
    assert_eq!(chunks[0]["total"], 1);
    assert_eq!(
        chunks[1],
        json!({"type":"messages", "start":0, "messages":expected})
    );
    assert_eq!(chunks[2]["type"], "done");
    assert!(chunks[2]["payloadBytes"].as_u64().unwrap() > 0);
    server.abort();
}
