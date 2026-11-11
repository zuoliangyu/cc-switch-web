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

/// 正文搜索的命中只回会话根目录内的来源：同步只收扫描到的会话，搜索时再按读取会话
/// 内容的同一条校验过滤，根目录外的旧行（换了配置目录、索引被改过）不外泄路径和摘录。
#[tokio::test]
#[serial_test::serial]
async fn session_content_search_never_returns_sources_outside_session_roots() {
    use crate::session_manager::search;

    let _fixture = crate::mode::controller::tests::Fixture::new();
    let mut settings = crate::settings::get_settings();
    settings.session_content_search_enabled = true;
    crate::settings::update_settings(settings).unwrap();
    search::clear().unwrap();

    let root = crate::config::get_claude_config_dir()
        .join("projects")
        .join("search");
    std::fs::create_dir_all(&root).unwrap();
    let inside = root.join("inside.jsonl");
    let record = |id: &str, text: &str| {
        json!({"type":"user", "uuid":"u1", "sessionId":id,
            "message":{"role":"user", "content":text}})
        .to_string()
    };
    std::fs::write(
        &inside,
        format!("{}\n", record("inside", "部署 needle 内部")),
    )
    .unwrap();
    let outside = crate::config::get_home_dir().join("outside.jsonl");
    std::fs::write(
        &outside,
        format!("{}\n", record("outside", "部署 needle 外部")),
    )
    .unwrap();
    let inside = inside.to_string_lossy().into_owned();
    let outside = outside.to_string_lossy().into_owned();

    let app = Router::new()
        .route("/sync", post(sync_session_index))
        .route("/search", post(search_session_content))
        .route("/clear", axum::routing::delete(clear_session_index));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();

    // 与页面一样先读列表再同步；进度经服务端推送，等到收尾那一条
    let mut events = crate::events::subscribe();
    crate::session_manager::scan_sessions();
    let started: Value = client
        .post(format!("{base}/sync"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(started.get("running").is_some());
    let finished = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.name == "session-index-status" && event.payload["running"] == false {
                return event.payload;
            }
        }
    })
    .await
    .expect("index sync finishes");
    assert_eq!(finished["processed"], finished["total"]);

    let search = |query: &'static str| {
        let client = client.clone();
        let base = base.clone();
        async move {
            client
                .post(format!("{base}/search"))
                .json(&json!({"query": query, "providerIds": ["claude"]}))
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()
        }
    };
    let result = search("needle").await;
    let hits = result["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "{result}");
    assert_eq!(hits[0]["sourcePath"], inside.as_str());
    assert!(hits[0]["snippets"][0]["text"]
        .as_str()
        .unwrap()
        .contains("needle"));

    // 根目录外的来源即使在索引里有行，也不会出现在结果里
    let mut index = search::SessionIndex::open(&search::index_path()).unwrap();
    index
        .replace_source(
            "claude",
            &outside,
            search::StoredFingerprint {
                modified_ns: Some(1),
                len: 1,
            },
            &[(0, "部署 needle 外部".to_string())],
        )
        .unwrap();
    drop(index);
    let result = search("needle").await;
    let paths: Vec<&str> = result["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| hit["sourcePath"].as_str().unwrap())
        .collect();
    assert_eq!(paths, vec![inside.as_str()], "{result}");
    assert!(!result.to_string().contains("外部"));

    // 关掉开关后搜索不回任何命中，清理删除索引文件
    let mut settings = crate::settings::get_settings();
    settings.session_content_search_enabled = false;
    crate::settings::update_settings(settings).unwrap();
    assert!(search("needle").await["hits"]
        .as_array()
        .unwrap()
        .is_empty());
    let cleared: Value = client
        .delete(format!("{base}/clear"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cleared, true);
    assert!(!search::index_path().exists());
    server.abort();
}

/// Copilot CLI 的会话只能从 `COPILOT_HOME/session-state` 里读：根目录内的能读出正文，
/// 根目录外的（直接给路径、或用 `..` 跳出去）一律拒绝；删除交给 Copilot CLI 自己。
#[tokio::test]
#[serial_test::serial]
async fn copilot_sessions_stay_inside_the_session_state_root() {
    let _fixture = crate::mode::controller::tests::Fixture::new();
    let copilot_home = crate::config::get_home_dir().join(".copilot");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("COPILOT_HOME", value),
                None => std::env::remove_var("COPILOT_HOME"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("COPILOT_HOME"));
    std::env::set_var("COPILOT_HOME", &copilot_home);

    let events = [
        json!({"type":"session.start","timestamp":"2026-10-10T09:07:56.748Z","data":{"sessionId":"s1","context":{"cwd":"/work"}}}),
        json!({"type":"user.message","timestamp":"2026-10-10T09:08:00.043Z","data":{"content":"copilot fixture","messageId":"u1"}}),
    ]
    .iter()
    .map(|event| format!("{event}\n"))
    .collect::<String>();
    let inside_dir = copilot_home.join("session-state").join("s1");
    std::fs::create_dir_all(&inside_dir).unwrap();
    let inside = inside_dir.join("events.jsonl");
    std::fs::write(&inside, &events).unwrap();
    let outside_dir = crate::config::get_home_dir().join("outside");
    std::fs::create_dir_all(&outside_dir).unwrap();
    let outside = outside_dir.join("events.jsonl");
    std::fs::write(&outside, &events).unwrap();
    let escaped = copilot_home
        .join("session-state")
        .join("..")
        .join("..")
        .join("outside")
        .join("events.jsonl");

    let app = Router::new()
        .route("/messages", get(get_session_messages))
        .route("/delete", post(delete_session));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let messages = |source: std::path::PathBuf| {
        let request = client.get(format!("{base}/messages")).query(&[
            ("providerId", "copilot".to_string()),
            ("sourcePath", source.to_string_lossy().into_owned()),
        ]);
        async move { request.send().await.unwrap() }
    };

    let response = messages(inside.clone()).await;
    assert!(response.status().is_success());
    let body: Value = response.json().await.unwrap();
    assert_eq!(body[0]["blocks"][0]["text"], "copilot fixture");
    for source in [outside.clone(), escaped] {
        let response = messages(source.clone()).await;
        assert!(!response.status().is_success(), "{}", source.display());
        assert!(!response.text().await.unwrap().contains("copilot fixture"));
    }

    let response = client
        .post(format!("{base}/delete"))
        .json(&json!({"providerId":"copilot","sessionId":"s1","sourcePath":inside}))
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    assert!(inside.exists());
    server.abort();
}
