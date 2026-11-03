#![allow(non_snake_case)]

use crate::session_manager;
use tokio::task::spawn_blocking;

pub async fn list_sessions_internal() -> Result<Vec<session_manager::SessionMeta>, String> {
    let sessions = spawn_blocking(session_manager::scan_sessions)
        .await
        .map_err(|e| format!("Failed to scan sessions: {e}"))?;
    Ok(sessions)
}

pub async fn get_session_messages_internal(
    providerId: String,
    sourcePath: String,
) -> Result<Vec<session_manager::SessionMessage>, String> {
    let provider_id = providerId.clone();
    let source_path = sourcePath.clone();
    spawn_blocking(move || session_manager::load_transcript(&provider_id, &source_path).map(|loaded| loaded.transcript.messages.clone()))
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
