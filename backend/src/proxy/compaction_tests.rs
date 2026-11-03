use super::{handler_context::RequestContext, server::ProxyState};
use crate::{app_config::AppType, provider::Provider};
use axum::{
    extract::State,
    http::{Extensions, HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone)]
struct Upstream {
    replies: Arc<Mutex<VecDeque<(StatusCode, String, &'static str)>>>,
    requests: Arc<Mutex<Vec<Value>>>,
}

async fn receive(State(up): State<Upstream>, Json(body): Json<Value>) -> axum::response::Response {
    up.requests.lock().await.push(body);
    let (status, body, content_type) = up
        .replies
        .lock()
        .await
        .pop_front()
        .expect("unexpected retry");
    axum::response::Response::builder()
        .status(status)
        .header("content-type", content_type)
        // Deliberately include length: a rebuilt compaction stream must remove it.
        .header("content-length", body.len())
        .body(axum::body::Body::from(body))
        .unwrap()
}

async fn upstream(
    replies: Vec<(StatusCode, String, &'static str)>,
    format: &str,
) -> (Upstream, Provider, tokio::task::JoinHandle<()>) {
    let up = Upstream {
        replies: Arc::new(Mutex::new(replies.into())),
        requests: Arc::new(Mutex::new(vec![])),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/v1/responses", post(receive))
        .route("/v1/chat/completions", post(receive))
        .route("/v1/messages", post(receive))
        .with_state(up.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let provider = Provider::with_id(
        "member".into(),
        "Member".into(),
        json!({
            "baseUrl": format!("http://{address}/v1"), "apiFormat":format,
            "auth":{"OPENAI_API_KEY":"test-key"}, "config":format!("model = \"test-model\"\nmodel_provider = \"test\"\n[model_providers.test]\nbase_url = \"http://{address}/v1\"\nwire_api = \"responses\"\n")
        }),
        None,
    );
    (up, provider, task)
}

#[tokio::test]
#[serial_test::serial]
async fn opaque_retry_is_bounded_and_keeps_aggregation_state_neutral() {
    let _home = crate::mode::controller::tests::Fixture::new();
    for (code, message, twice, expected) in [
        (
            400,
            "The encrypted content could not be verified.",
            false,
            2,
        ),
        (400, "The encrypted content could not be verified.", true, 2),
        (
            400,
            "Invalid 'input[0].content': array too long. Expected an array with maximum length 0",
            false,
            2,
        ),
        (400, "unrelated invalid model", false, 1),
        (401, "bad credentials", false, 1),
    ] {
        let error = json!({"error":{"message":message}}).to_string();
        let mut replies = vec![(
            StatusCode::from_u16(code).unwrap(),
            error.clone(),
            "application/json",
        )];
        if expected == 2 {
            replies.push(if twice {
                (StatusCode::BAD_REQUEST, error, "application/json")
            } else {
                (StatusCode::OK, "{}".into(), "application/json")
            });
        }
        let (up, provider, task) = upstream(replies, "openai_responses").await;
        let state = ProxyState::for_test(Arc::new(crate::database::Database::memory().unwrap()));
        state.db.save_provider("codex", &provider).unwrap();
        let body = json!({"model":"test-model", "input":[
            {"type":"reasoning", "content":[{"type":"text","text":"thought"}],"encrypted_content":"foreign"},
            {"type":"function_call","id":"foreign_id","call_id":"keep-call-id","name":"tool","arguments":"{}"},
            {"type":"function_call_output","call_id":"keep-call-id","output":"ok"}
        ]});
        let before = serde_json::to_value(state.status.read().await.clone()).unwrap();
        let ctx = RequestContext::new_with_stack(
            &state,
            &body,
            &HeaderMap::new(),
            AppType::Codex,
            "Codex",
            "codex",
            Some(crate::mode::stack::StackTarget {
                provider,
                upstream_model: "test-model".into(),
                original_model: "ccs-test".into(),
            }),
        )
        .await
        .unwrap();
        let result = ctx
            .create_forwarder(&state)
            .forward_with_retry(
                &AppType::Codex,
                "/responses",
                body,
                HeaderMap::new(),
                Extensions::new(),
                ctx.get_providers(),
            )
            .await;
        assert_eq!(result.is_ok(), expected == 2 && !twice, "{message}");
        let seen = up.requests.lock().await;
        assert_eq!(seen.len(), expected, "{message}");
        assert_eq!(seen[0]["input"][0]["type"], "reasoning");
        if expected == 2 {
            assert_eq!(seen[1]["input"].as_array().unwrap().len(), 2);
            assert!(seen[1]["input"][0].get("id").is_none());
            assert_eq!(seen[1]["input"][0]["call_id"], "keep-call-id");
        }
        assert_eq!(
            serde_json::to_value(state.status.read().await.clone()).unwrap(),
            before
        );
        assert!(state.current_providers.read().await.is_empty());
        task.abort();
    }
}

#[tokio::test]
#[serial_test::serial]
async fn compaction_is_returned_through_native_chat_and_anthropic_http_paths() {
    let _home = crate::mode::controller::tests::Fixture::new();
    for (format, upstream_body, content_type) in [
        ("openai_responses", format!("data: {}\n\n", json!({"type":"response.completed", "response":{
            "id":"r", "status":"completed", "output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"summary"}]}]
        }})), "text/event-stream"),
        ("openai_chat", format!("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"id":"r","choices":[{"delta":{"content":"summary"},"index":0}]}),
            json!({"id":"r","choices":[{"delta":{},"finish_reason":"stop","index":0}]})), "text/event-stream"),
        ("anthropic", json!({"id":"r","type":"message","role":"assistant","model":"test-model",
            "content":[{"type":"text","text":"summary"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}).to_string(), "application/json"),
    ] {
        let (up, provider, task) = upstream(vec![(StatusCode::OK, upstream_body, content_type)], format).await;
        let state = ProxyState::for_test(Arc::new(crate::database::Database::memory().unwrap()));
        state.db.save_provider("codex", &provider).unwrap();
        state.db.set_current_provider("codex", &provider.id).unwrap();
        let body = json!({"model":"test-model","stream":true,"tools":[{"type":"function","name":"tool","parameters":{}}],
            "input":[{"role":"user","content":"context"},{"type":"compaction_trigger"}]});
        let request = axum::http::Request::builder().uri("/responses").method("POST")
            .body(axum::body::Body::from(body.to_string())).unwrap();
        let response = super::handlers::handle_responses(State(state), request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{format}");
        assert!(response.headers().get("content-length").is_none(), "{format}");
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        let events: Vec<Value> = text.lines().filter_map(|line|line.strip_prefix("data: "))
            .filter_map(|data|serde_json::from_str(data).ok()).collect();
        let completed = events.iter().find(|event|event["type"] == "response.completed").expect(&text);
        let output = completed["response"]["output"].as_array().unwrap();
        let summaries: Vec<_> = output.iter().filter(|item|item["type"]=="compaction").collect();
        assert_eq!(summaries.len(), 1, "{format}: {text}");
        assert_eq!(super::providers::codex_compaction::decode_compaction_summary(
            summaries[0]["encrypted_content"].as_str().unwrap()).as_deref(), Some("summary"));
        let seen = up.requests.lock().await;
        assert_eq!(seen.len(), 1);
        assert!(!seen[0].to_string().contains("compaction_trigger"));
        if format == "openai_responses" {
            // 原生 Responses 摘要回合保留工具定义（历史调用还引用它们），只禁止新调用
            assert_eq!(seen[0]["tools"][0]["name"], "tool", "{format}");
            assert_eq!(seen[0]["tool_choice"], "none", "{format}");
        } else {
            assert!(seen[0].get("tools").is_none(), "{format}");
        }
        task.abort();
    }
}
