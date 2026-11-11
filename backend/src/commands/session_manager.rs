#![allow(non_snake_case)]

use crate::session_manager;
use tokio::task::spawn_blocking;

pub async fn list_sessions_internal() -> Result<Vec<session_manager::SessionMeta>, String> {
    let sessions = spawn_blocking(session_manager::scan_sessions)
        .await
        .map_err(|e| format!("Failed to scan sessions: {e}"))?;
    Ok(sessions)
}

/// 会话正文索引进度的服务端推送事件名（对应上游 `app.emit("session-index-status", …)`）
pub const SESSION_INDEX_STATUS_EVENT: &str = "session-index-status";

/// 在后台把会话正文索引同步到当前会话列表；进度经服务端推送 `session-index-status`。
/// 已在同步时只排一次重跑，立即返回当前进度。
pub async fn sync_session_index_internal() -> Result<session_manager::search::IndexStatus, String> {
    spawn_blocking(|| {
        session_manager::search::start_sync(|status| {
            crate::events::emit(
                SESSION_INDEX_STATUS_EVENT,
                serde_json::to_value(status).unwrap_or_default(),
            );
        })
    })
    .await
    .map_err(|e| format!("Failed to sync session index: {e}"))
}

/// 在消息正文里搜索，按会话聚合；`providerIds` 为空时不按应用过滤
pub async fn search_session_content_internal(
    query: String,
    providerIds: Option<Vec<String>>,
    limit: Option<usize>,
) -> Result<session_manager::search::ContentSearchResult, String> {
    let limit = limit
        .unwrap_or(session_manager::search::DEFAULT_LIMIT)
        .min(session_manager::search::DEFAULT_LIMIT);
    spawn_blocking(move || session_manager::search::search(&query, providerIds, limit))
        .await
        .map_err(|e| format!("Failed to search session content: {e}"))
}

/// 删除会话正文索引文件（关闭「搜索消息正文」时调用）
pub async fn clear_session_index_internal() -> Result<bool, String> {
    spawn_blocking(session_manager::search::clear)
        .await
        .map_err(|e| format!("Failed to clear session index: {e}"))??;
    Ok(true)
}

/// 返回序列化好的消息数组 JSON：直接从缓存借用序列化，不先复制整份会话。
pub async fn get_session_messages_internal(
    providerId: String,
    sourcePath: String,
) -> Result<Vec<u8>, String> {
    spawn_blocking(move || {
        session_manager::load_transcript(&providerId, &sourcePath).and_then(|loaded| {
            serde_json::to_vec(&loaded.transcript.messages).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Failed to load session messages: {e}"))?
}

pub async fn launch_session_terminal_internal(
    db: &crate::database::Database,
    command: String,
    cwd: Option<String>,
    customConfig: Option<String>,
) -> Result<bool, String> {
    // Antigravity 第三方 Key 的会话：命令里只有私有目录、没有 Key，按「打开终端」的方式补上
    // 那张卡的 Key 再恢复。
    if let Some((provider, conversation)) =
        crate::services::provider::agy_direct::key_resume_target(db, &command)
            .map_err(|e| e.to_string())?
    {
        crate::commands::open_agy_resume_terminal(&provider, &conversation, cwd)?;
        return Ok(true);
    }
    spawn_blocking(move || {
        crate::commands::launch_terminal_command_internal(command, cwd, customConfig)
    })
    .await
    .map_err(|e| format!("Failed to launch session terminal: {e}"))?
}

pub async fn delete_session_internal(
    providerId: String,
    sessionId: String,
    sourcePath: String,
) -> Result<bool, String> {
    let provider_id = providerId.clone();
    let session_id = sessionId.clone();
    let source_path = sourcePath.clone();

    spawn_blocking(move || {
        session_manager::delete_session(&provider_id, &session_id, &source_path)
    })
    .await
    .map_err(|e| format!("Failed to delete session: {e}"))?
}

pub async fn delete_sessions_internal(
    items: Vec<session_manager::DeleteSessionRequest>,
) -> Result<Vec<session_manager::DeleteSessionOutcome>, String> {
    spawn_blocking(move || session_manager::delete_sessions(&items))
        .await
        .map_err(|e| format!("Failed to delete sessions: {e}"))
}
