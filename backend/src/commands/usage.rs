//! 使用统计相关命令

use crate::error::AppError;
use crate::services::model_pricing::{
    ModelPricingInfo, ModelsDevSyncConfig, ModelsDevSyncState,
};
use crate::services::session_usage::{DataSourceSummary, SessionSyncResult};
use crate::services::usage_stats::*;
use crate::store::AppState;

pub fn get_usage_summary_internal(
    state: &AppState,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
) -> Result<UsageSummary, AppError> {
    state
        .db
        .get_usage_summary(start_date, end_date, app_type.as_deref())
}

pub fn get_usage_trends_internal(
    state: &AppState,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
) -> Result<Vec<DailyStats>, AppError> {
    state
        .db
        .get_daily_trends(start_date, end_date, app_type.as_deref())
}

pub fn get_provider_stats_internal(
    state: &AppState,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
) -> Result<Vec<ProviderStats>, AppError> {
    state
        .db
        .get_provider_stats(start_date, end_date, app_type.as_deref())
}

pub fn get_model_stats_internal(
    state: &AppState,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
) -> Result<Vec<ModelStats>, AppError> {
    state
        .db
        .get_model_stats(start_date, end_date, app_type.as_deref())
}

pub fn get_request_logs_internal(
    state: &AppState,
    filters: LogFilters,
    page: u32,
    page_size: u32,
) -> Result<PaginatedLogs, AppError> {
    state.db.get_request_logs(&filters, page, page_size)
}

pub fn get_request_detail_internal(
    state: &AppState,
    request_id: String,
) -> Result<Option<RequestLogDetail>, AppError> {
    state.db.get_request_detail(&request_id)
}

pub async fn sync_session_usage_internal(
    state: &AppState,
) -> Result<SessionSyncResult, AppError> {
    let db = state.db.clone();
    let _guard = crate::services::session_usage::session_sync_mutex()
        .lock()
        .await;
    tokio::task::spawn_blocking(move || crate::services::session_usage::sync_all_unlocked(&db))
        .await
        .map_err(|error| AppError::Message(format!("会话用量同步任务失败: {error}")))
}

pub async fn rebuild_codex_usage_internal(
    state: &AppState,
) -> Result<SessionSyncResult, AppError> {
    let db = state.db.clone();
    let _guard = crate::services::session_usage::session_sync_mutex()
        .lock()
        .await;
    tokio::task::spawn_blocking(move || {
        db.backup_database_file()?;
        db.reset_codex_usage()?;
        crate::services::session_usage_codex::sync_codex_usage(&db)
    })
    .await
    .map_err(|error| AppError::Message(format!("Codex 用量重建任务失败: {error}")))?
}

pub fn get_usage_data_sources_internal(
    state: &AppState,
) -> Result<Vec<DataSourceSummary>, AppError> {
    crate::services::session_usage::get_data_source_breakdown(&state.db)
}

pub fn get_model_pricing_internal(state: &AppState) -> Result<Vec<ModelPricingInfo>, AppError> {
    log::info!("获取模型定价列表");
    state.db.ensure_model_pricing_seeded()?;
    crate::services::model_pricing::sync_local_model_pricing(&state.db)?;

    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='model_pricing'",
            [],
            |row| row.get::<_, i64>(0).map(|count| count > 0),
        )
        .unwrap_or(false);

    if !table_exists {
        log::error!("model_pricing 表不存在,可能需要重启应用以触发数据库迁移");
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(
        "SELECT model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
         FROM model_pricing
         ORDER BY display_name",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ModelPricingInfo {
            model_id: row.get(0)?,
            display_name: row.get(1)?,
            input_cost_per_million: row.get(2)?,
            output_cost_per_million: row.get(3)?,
            cache_read_cost_per_million: row.get(4)?,
            cache_creation_cost_per_million: row.get(5)?,
        })
    })?;

    let mut pricing = Vec::new();
    for row in rows {
        pricing.push(row?);
    }

    log::info!("成功获取 {} 条模型定价数据", pricing.len());
    Ok(pricing)
}

pub fn update_model_pricing_internal(
    state: &AppState,
    model_id: String,
    display_name: String,
    input_cost: String,
    output_cost: String,
    cache_read_cost: String,
    cache_creation_cost: String,
) -> Result<(), AppError> {
    crate::services::model_pricing::update_model_pricing(
        &state.db,
        ModelPricingInfo {
            model_id,
            display_name,
            input_cost_per_million: input_cost,
            output_cost_per_million: output_cost,
            cache_read_cost_per_million: cache_read_cost,
            cache_creation_cost_per_million: cache_creation_cost,
        },
    )?;

    Ok(())
}

pub fn update_model_pricing_batch_internal(
    state: &AppState,
    entries: Vec<ModelPricingInfo>,
) -> Result<usize, AppError> {
    crate::services::model_pricing::update_model_pricing_batch(&state.db, entries)
}

pub fn get_models_dev_sync_config_internal(
    state: &AppState,
) -> Result<ModelsDevSyncState, AppError> {
    crate::services::model_pricing::get_models_dev_sync_state(&state.db)
}

pub fn save_models_dev_sync_config_internal(
    state: &AppState,
    config: ModelsDevSyncConfig,
) -> Result<(), AppError> {
    crate::services::model_pricing::save_models_dev_sync_config(&state.db, config)
}

pub fn record_models_dev_sync_result_internal(
    state: &AppState,
    synced_at: Option<i64>,
    error: Option<String>,
) -> Result<(), AppError> {
    crate::services::model_pricing::record_models_dev_sync_result(&state.db, synced_at, error)
}

pub fn check_provider_limits_internal(
    state: &AppState,
    provider_id: String,
    app_type: String,
) -> Result<crate::services::usage_stats::ProviderLimitStatus, AppError> {
    state.db.check_provider_limits(&provider_id, &app_type)
}

pub fn delete_model_pricing_internal(
    state: &AppState,
    model_id: String,
) -> Result<(), AppError> {
    crate::services::model_pricing::delete_model_pricing(&state.db, &model_id)?;

    log::info!("已删除模型定价: {model_id}");
    Ok(())
}
