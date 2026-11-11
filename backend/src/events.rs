//! 服务端事件推送总线（对应上游 Tauri `emit` / `listen`）
//!
//! 后端在供应商切换、用量写入、同步状态变化等时机调用 [`emit`]，浏览器经
//! `GET /api/events`（SSE）收到同名事件，代替原先的定时轮询。
//!
//! 设计要点：
//! - 全局单例：写路径（代理日志、会话导入、故障转移等）上不持有任何状态，任意线程可调用。
//! - 无订阅者时直接丢弃；发送从不阻塞调用方，也不向上传播错误。
//! - 订阅者跟不上（broadcast 落后）时由 SSE 端补发一条 [`EVENT_RESYNC`]，前端整体重取。
//! - `usage-log-recorded` 照上游 200ms 防抖合并：流式响应等场景短时间写入多条日志时，
//!   合并成一次事件，避免前端连续重查。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::broadcast;

/// 有新的用量明细写入（代理日志、会话同步、归档、Codex 重建）
pub const EVENT_USAGE_LOG_RECORDED: &str = "usage-log-recorded";
/// 订阅者落后、丢了事件：前端应整体重取
pub const EVENT_RESYNC: &str = "resync";

/// 防抖窗口：合并 200ms 内的多次用量通知（同上游 `usage_events`）。
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(200);
/// 每个订阅者可积压的事件数；超出后该订阅者收到 `resync`。
const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct ServerEvent {
    pub name: String,
    pub payload: Value,
}

static SENDER: OnceLock<broadcast::Sender<ServerEvent>> = OnceLock::new();
static RUNTIME: OnceLock<tokio::runtime::Handle> = OnceLock::new();
/// 防抖标记：true 表示已有调度任务在等待发出用量事件，后续通知合并到该任务。
static USAGE_EMIT_SCHEDULED: AtomicBool = AtomicBool::new(false);

fn sender() -> &'static broadcast::Sender<ServerEvent> {
    SENDER.get_or_init(|| broadcast::channel(CHANNEL_CAPACITY).0)
}

/// Web 服务启动时调用一次，记下运行时句柄，供同步线程（会话导入、代理日志写库）
/// 调度防抖任务。重复调用无害。
pub fn init() {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        let _ = RUNTIME.set(handle);
    }
}

/// 订阅全部服务端事件（SSE 端每个连接一个）。
pub fn subscribe() -> broadcast::Receiver<ServerEvent> {
    sender().subscribe()
}

/// 发出事件；没有订阅者时静默丢弃。
pub fn emit(name: &str, payload: Value) {
    #[cfg(test)]
    TEST_EVENTS.with(|events| {
        events.borrow_mut().push(ServerEvent {
            name: name.to_string(),
            payload: payload.clone(),
        })
    });

    let sender = sender();
    if sender.receiver_count() == 0 {
        return;
    }
    let _ = sender.send(ServerEvent {
        name: name.to_string(),
        payload,
    });
}

/// 通知前端有新的用量明细写入。任意线程可调用，200ms 内的多次通知合并为一次。
pub fn notify_log_recorded() {
    #[cfg(test)]
    TEST_NOTIFY_COUNT.with(|count| count.set(count.get().saturating_add(1)));

    // 没人在听（没有打开的页面）：不必调度
    if sender().receiver_count() == 0 {
        return;
    }
    // 已有调度任务：本次通知合并进去
    if USAGE_EMIT_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }

    let handle = tokio::runtime::Handle::try_current()
        .ok()
        .or_else(|| RUNTIME.get().cloned());
    let Some(handle) = handle else {
        // 没有运行时（服务进程里 init 已记下句柄，只有同步单元测试会走到这里）：放弃
        USAGE_EMIT_SCHEDULED.store(false, Ordering::Release);
        return;
    };
    handle.spawn(async {
        tokio::time::sleep(DEBOUNCE_WINDOW).await;
        // 先清标志再发：发的同时又有新通知进来，会调度下一轮，不会丢
        USAGE_EMIT_SCHEDULED.store(false, Ordering::Release);
        emit(EVENT_USAGE_LOG_RECORDED, Value::Null);
    });
}

#[cfg(test)]
thread_local! {
    static TEST_NOTIFY_COUNT: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static TEST_EVENTS: std::cell::RefCell<Vec<ServerEvent>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// 取出并清零本线程记下的用量通知次数（测试用）。
#[cfg(test)]
pub(crate) fn take_test_notify_count() -> u32 {
    TEST_NOTIFY_COUNT.with(|count| count.replace(0))
}

/// 取出并清空本线程发出的事件（测试用）。
#[cfg(test)]
pub(crate) fn take_test_events() -> Vec<ServerEvent> {
    TEST_EVENTS.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

/// 把 broadcast 接收端转成 SSE 用的事件流：落后时补一条 `resync`，发送端关闭时结束。
pub fn subscription_stream(
    rx: broadcast::Receiver<ServerEvent>,
) -> impl futures::Stream<Item = ServerEvent> + Send + 'static {
    futures::stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(event) => Some((event, rx)),
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                log::debug!("[events] 订阅者落后 {skipped} 条事件，补发 resync");
                Some((
                    ServerEvent {
                        name: EVENT_RESYNC.to_string(),
                        payload: Value::Null,
                    },
                    rx,
                ))
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use serde_json::json;
    use serial_test::serial;

    /// 全局总线在并行用例间共享：只看本用例关心的事件名。
    async fn recv_named(rx: &mut broadcast::Receiver<ServerEvent>, name: &str) -> ServerEvent {
        loop {
            match rx.recv().await {
                Ok(event) if event.name == name => return event,
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => panic!("channel closed"),
            }
        }
    }

    fn drain_named(rx: &mut broadcast::Receiver<ServerEvent>, name: &str) -> usize {
        let mut count = 0;
        loop {
            match rx.try_recv() {
                Ok(event) if event.name == name => count += 1,
                Ok(_) | Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(_) => return count,
            }
        }
    }

    #[tokio::test]
    #[serial(server_events)]
    async fn subscriber_receives_emitted_events() {
        let mut rx = subscribe();
        emit("test-provider-switched", json!({ "appType": "claude" }));
        let event = recv_named(&mut rx, "test-provider-switched").await;
        assert_eq!(event.payload, json!({ "appType": "claude" }));
        take_test_events();
    }

    #[tokio::test]
    #[serial(server_events)]
    async fn emit_without_subscribers_is_not_buffered() {
        // 订阅之前发的事件不会补给之后的订阅者
        emit("test-orphan-event", Value::Null);
        let mut rx = subscribe();
        emit("test-fresh-event", Value::Null);
        recv_named(&mut rx, "test-fresh-event").await;
        assert_eq!(drain_named(&mut rx, "test-orphan-event"), 0);
        take_test_events();
    }

    #[tokio::test(start_paused = true)]
    #[serial(server_events)]
    async fn usage_notifications_are_debounced_into_one_event() {
        // 别的用例的运行时可能在调度任务跑完前就结束了，标记停在 true；本用例从干净状态开始
        USAGE_EMIT_SCHEDULED.store(false, Ordering::Release);
        let mut rx = subscribe();
        take_test_notify_count();
        for _ in 0..5 {
            notify_log_recorded();
        }
        assert_eq!(take_test_notify_count(), 5);
        tokio::time::sleep(DEBOUNCE_WINDOW * 2).await;
        recv_named(&mut rx, EVENT_USAGE_LOG_RECORDED).await;
        assert_eq!(
            drain_named(&mut rx, EVENT_USAGE_LOG_RECORDED),
            0,
            "five notifications merge into one"
        );

        // 窗口过后再通知，重新调度一轮
        notify_log_recorded();
        tokio::time::sleep(DEBOUNCE_WINDOW * 2).await;
        recv_named(&mut rx, EVENT_USAGE_LOG_RECORDED).await;
        take_test_events();
    }

    #[tokio::test]
    #[serial(server_events)]
    async fn lagging_subscriber_gets_resync_then_continues() {
        let rx = subscribe();
        for i in 0..(CHANNEL_CAPACITY + 10) {
            emit("test-tick", json!(i));
        }
        let mut stream = Box::pin(subscription_stream(rx));
        let first = stream.next().await.expect("event");
        assert_eq!(first.name, EVENT_RESYNC);
        // 补发 resync 之后照常收后面的事件
        let next = stream.next().await.expect("event");
        assert_ne!(next.name, EVENT_RESYNC);
        take_test_events();
    }
}
