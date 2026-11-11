#![allow(non_snake_case)]

use serde_json::{json, Value};
use tokio::task::spawn_blocking;

use crate::database::Database;
use crate::error::AppError;
use crate::services::provider::ProviderService;
use crate::store::AppState;

// ─── File import/export ──────────────────────────────────────

pub async fn sync_current_providers_live_internal(
    db: std::sync::Arc<Database>,
) -> Result<Value, String> {
    spawn_blocking(move || {
        let app_state = AppState::new(db);
        ProviderService::sync_current_to_live(&app_state)?;
        Ok::<_, AppError>(json!({
            "success": true,
            "message": "Live configuration synchronized"
        }))
    })
    .await
    .map_err(|e| format!("同步当前供应商失败: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

// ─── Database backup management ─────────────────────────────

/// Manually create a database backup
pub async fn create_db_backup_internal(db: std::sync::Arc<Database>) -> Result<String, String> {
    spawn_blocking(move || match db.backup_database_file()? {
        Some(path) => Ok(path
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default()),
        None => Err(AppError::Config(
            "Database file not found, backup skipped".to_string(),
        )),
    })
    .await
    .map_err(|e| format!("Backup failed: {e}"))?
    .map_err(|e: AppError| e.to_string())
}

/// Restore database from a backup file
pub async fn restore_db_backup_internal(
    db: std::sync::Arc<Database>,
    filename: String,
) -> Result<String, String> {
    spawn_blocking(move || db.restore_from_backup(&filename))
        .await
        .map_err(|e| format!("Restore failed: {e}"))?
        .map_err(|e: AppError| e.to_string())
}
