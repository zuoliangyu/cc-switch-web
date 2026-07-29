//! 从 Grok Build `updates.jsonl` 导入官方 OAuth 模式下的逐轮用量。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::calculator::CostCalculator;
use crate::proxy::usage::parser::TokenUsage;
use crate::services::session_usage::{
    get_sync_state, metadata_modified_nanos, update_sync_state, SessionSyncResult,
};
use crate::services::usage_stats::{
    find_model_pricing, has_recent_grokbuild_proxy_activity, SESSION_PROXY_DEDUP_WINDOW_SECONDS,
};
use rust_decimal::Decimal;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const SETTLE_WINDOW_SECONDS: i64 = SESSION_PROXY_DEDUP_WINDOW_SECONDS;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct GrokCounters {
    input: u64,
    output: u64,
    cached: u64,
    api_ms: u64,
    cost_ticks: u64,
    cost_partial: bool,
}

impl GrokCounters {
    fn is_zero(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cached == 0
    }

    fn reported_cost_usd(&self) -> Option<Decimal> {
        (self.cost_ticks > 0)
            .then(|| Decimal::from(self.cost_ticks) / Decimal::from(10_000_000_000u64))
    }
}

#[derive(Debug)]
struct GrokUsageEvent {
    created_at: i64,
    prompt_id: String,
    cost_is_partial: bool,
    per_model: Vec<(String, GrokCounters)>,
}

pub fn sync_grokbuild_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    let files = collect_grok_updates_files();
    let mut result = SessionSyncResult {
        files_scanned: files.len() as u32,
        ..Default::default()
    };

    for file_path in &files {
        match sync_single_grok_file(db, file_path) {
            Ok(file_result) => result.merge(file_result),
            Err(error) => {
                let message = format!(
                    "Grok Build 会话文件解析失败 {}: {error}",
                    file_path.display()
                );
                log::warn!("[GROK-SYNC] {message}");
                result.errors.push(message);
            }
        }
    }

    Ok(result)
}

fn collect_grok_updates_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in crate::session_manager::grokbuild_session_roots() {
        collect_files_named(&root, "updates.jsonl", &mut files);
    }
    files
}

fn collect_files_named(root: &Path, name: &str, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_named(&path, name, files);
        } else if path.file_name().and_then(|value| value.to_str()) == Some(name) {
            files.push(path);
        }
    }
}

fn sync_single_grok_file(db: &Database, file_path: &Path) -> Result<SessionSyncResult, AppError> {
    let file_path_str = file_path.to_string_lossy().to_string();
    let metadata = fs::metadata(file_path)
        .map_err(|error| AppError::Config(format!("无法读取文件元数据: {error}")))?;
    let file_modified = metadata_modified_nanos(&metadata);
    let (last_modified, _) = get_sync_state(db, &file_path_str)?;
    if file_modified <= last_modified {
        return Ok(SessionSyncResult::default());
    }

    // 延后事件需要下轮重读，因此保持全文件解析；稳定 request_id 让重读幂等。
    let content = fs::read_to_string(file_path)
        .map_err(|error| AppError::Config(format!("无法读取文件: {error}")))?;
    let events = parse_grok_usage_events(&content);
    let session_id = file_path
        .parent()
        .and_then(|dir| dir.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);

    let mut result = SessionSyncResult::default();
    let mut deferred = false;
    for (index, event) in events.iter().enumerate() {
        if now.saturating_sub(event.created_at) < SETTLE_WINDOW_SECONDS {
            deferred = true;
            break;
        }

        let takeover_active = {
            let conn = lock_conn!(db.conn);
            has_recent_grokbuild_proxy_activity(&conn, event.created_at)?
        };

        for (model, counters) in &event.per_model {
            if counters.is_zero() {
                continue;
            }
            if takeover_active {
                result.skipped += 1;
                continue;
            }

            let turn_key = if event.prompt_id.is_empty() {
                format!("idx{index}")
            } else {
                event.prompt_id.clone()
            };
            let request_id = format!("grok_session:{session_id}:{turn_key}:{model}");
            match insert_grok_session_entry(
                db,
                &request_id,
                counters,
                event.cost_is_partial || counters.cost_partial,
                model,
                &session_id,
                event.created_at,
            ) {
                Ok(true) => result.imported += 1,
                Ok(false) => result.skipped += 1,
                Err(error) => {
                    log::warn!("[GROK-SYNC] 插入失败 ({request_id}): {error}");
                    result.skipped += 1;
                }
            }
        }
    }

    if deferred {
        result.deferred_files += 1;
    } else {
        update_sync_state(db, &file_path_str, file_modified, events.len() as i64)?;
    }

    Ok(result)
}

fn parse_grok_usage_events(content: &str) -> Vec<GrokUsageEvent> {
    let mut events = Vec::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if record.get("method").and_then(|value| value.as_str()) != Some("_x.ai/session/update") {
            continue;
        }

        let update = record.get("params").and_then(|params| params.get("update"));
        let kind = update
            .and_then(|value| value.get("sessionUpdate"))
            .and_then(|value| value.as_str());
        if kind.is_some() && kind != Some("turn_completed") {
            continue;
        }
        let Some(usage) = update
            .and_then(|value| value.get("usage"))
            .filter(|value| value.is_object())
        else {
            continue;
        };
        let Some(created_at) = parse_event_timestamp(record.get("timestamp")) else {
            continue;
        };

        let prompt_id = update
            .and_then(|value| value.get("prompt_id"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let mut per_model = usage
            .get("modelUsage")
            .and_then(|value| value.as_object())
            .map(|models| {
                models
                    .iter()
                    .map(|(model, counters)| (model.clone(), parse_grok_counters(counters)))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if per_model.is_empty() {
            per_model.push(("unknown".to_string(), parse_grok_counters(usage)));
        }
        per_model.sort_by(|left, right| left.0.cmp(&right.0));

        events.push(GrokUsageEvent {
            created_at,
            prompt_id,
            cost_is_partial: usage
                .get("costIsPartial")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            per_model,
        });
    }
    events
}

fn parse_grok_counters(value: &serde_json::Value) -> GrokCounters {
    let get = |key: &str| value.get(key).and_then(|value| value.as_u64()).unwrap_or(0);
    GrokCounters {
        input: get("inputTokens"),
        output: get("outputTokens"),
        cached: get("cachedReadTokens"),
        api_ms: get("apiDurationMs"),
        cost_ticks: get("costUsdTicks"),
        cost_partial: value
            .get("costIsPartial")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    }
}

fn parse_event_timestamp(value: Option<&serde_json::Value>) -> Option<i64> {
    let value = value?;
    if let Some(number) = value.as_i64() {
        return Some(if number > 100_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    value
        .as_str()
        .and_then(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).ok())
        .map(|timestamp| timestamp.timestamp())
}

fn insert_grok_session_entry(
    db: &Database,
    request_id: &str,
    counters: &GrokCounters,
    cost_is_partial: bool,
    model: &str,
    session_id: &str,
    created_at: i64,
) -> Result<bool, AppError> {
    let conn = lock_conn!(db.conn);
    let clamp = |value: u64| value.min(u32::MAX as u64) as u32;
    let usage = TokenUsage {
        input_tokens: clamp(counters.input),
        output_tokens: clamp(counters.output),
        cache_read_tokens: clamp(counters.cached),
        cache_creation_tokens: 0,
        model: Some(model.to_string()),
        message_id: None,
    };
    let reported = counters.reported_cost_usd();
    let mut warning = None;

    let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) =
        match find_model_pricing(&conn, model) {
            Some(pricing) => {
                let cost =
                    CostCalculator::calculate_for_app("grokbuild", &usage, &pricing, Decimal::ONE);
                let total = match reported {
                    Some(reported) if !cost_is_partial => {
                        let tolerance = (reported * Decimal::new(1, 2)).max(Decimal::new(1, 6));
                        if (cost.total_cost - reported).abs() > tolerance {
                            warning = Some(format!(
                                "本地定价与 CLI 自报成本偏差超阈值: model={model} local={} reported={reported} request_id={request_id}",
                                cost.total_cost
                            ));
                        }
                        reported
                    }
                    _ => cost.total_cost,
                };
                (
                    cost.input_cost.to_string(),
                    cost.output_cost.to_string(),
                    cost.cache_read_cost.to_string(),
                    cost.cache_creation_cost.to_string(),
                    total.to_string(),
                )
            }
            None => {
                let total = reported.unwrap_or(Decimal::ZERO);
                if model != "unknown" {
                    warning = Some(format!(
                        "模型定价未找到，成本按 CLI 自报值入账: model={model} total={total} request_id={request_id}"
                    ));
                }
                (
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    total.to_string(),
                )
            }
        };

    let changed = conn
        .execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                input_cost_usd, output_cost_usd, cache_read_cost_usd,
                cache_creation_cost_usd, total_cost_usd, latency_ms, first_token_ms,
                status_code, error_message, session_id, provider_type, is_streaming,
                cost_multiplier, created_at, data_source
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
            )
            ON CONFLICT(request_id) DO UPDATE SET
                model = excluded.model,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                cache_read_tokens = excluded.cache_read_tokens,
                input_cost_usd = excluded.input_cost_usd,
                output_cost_usd = excluded.output_cost_usd,
                cache_read_cost_usd = excluded.cache_read_cost_usd,
                cache_creation_cost_usd = excluded.cache_creation_cost_usd,
                total_cost_usd = excluded.total_cost_usd,
                latency_ms = excluded.latency_ms
            WHERE data_source = 'grok_session'
              AND (input_tokens != excluded.input_tokens
               OR output_tokens != excluded.output_tokens
               OR cache_read_tokens != excluded.cache_read_tokens
               OR latency_ms != excluded.latency_ms
               OR model != excluded.model)",
            rusqlite::params![
                request_id,
                "_grok_session",
                "grokbuild",
                model,
                model,
                usage.input_tokens,
                usage.output_tokens,
                usage.cache_read_tokens,
                0i64,
                input_cost,
                output_cost,
                cache_read_cost,
                cache_creation_cost,
                total_cost,
                counters.api_ms.min(i64::MAX as u64) as i64,
                Option::<i64>::None,
                200i64,
                Option::<String>::None,
                session_id,
                Some("grok_session"),
                1i64,
                "1.0",
                created_at,
                "grok_session",
            ],
        )
        .map_err(|error| AppError::Database(format!("插入 Grok Build 会话日志失败: {error}")))?
        > 0;

    if changed {
        if let Some(message) = warning {
            log::warn!("[GROK-SYNC] {message}");
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::str::FromStr;
    use tempfile::tempdir;

    const OLD_EPOCH: i64 = 1_700_000_000;

    fn model_counters(model: &str, input: u64, output: u64, cached: u64, ticks: u64) -> String {
        format!(
            r#""{model}":{{"inputTokens":{input},"outputTokens":{output},"cachedReadTokens":{cached},"apiDurationMs":1000,"costUsdTicks":{ticks}}}"#
        )
    }

    fn usage_event(epoch: i64, prompt_id: &str, model_usage: &str) -> String {
        format!(
            r#"{{"timestamp":{epoch},"method":"_x.ai/session/update","params":{{"update":{{"sessionUpdate":"turn_completed","prompt_id":"{prompt_id}","usage":{{"modelUsage":{{{model_usage}}}}}}}}}}}"#
        )
    }

    fn write_session_file(dir: &Path, session_id: &str, lines: &[String]) -> PathBuf {
        let session_dir = dir.join("sessions").join("project").join(session_id);
        fs::create_dir_all(&session_dir).expect("create session dir");
        let path = session_dir.join("updates.jsonl");
        let mut file = fs::File::create(&path).expect("create updates file");
        for line in lines {
            writeln!(file, "{line}").expect("write event");
        }
        path
    }

    fn query_rows(db: &Database) -> Result<Vec<(String, u32, u32, u32, String)>, AppError> {
        let conn = lock_conn!(db.conn);
        let mut statement = conn.prepare(
            "SELECT request_id, input_tokens, output_tokens, cache_read_tokens, total_cost_usd
             FROM proxy_request_logs WHERE data_source = 'grok_session' ORDER BY request_id",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    #[test]
    fn parses_only_completed_usage_events() {
        let content = concat!(
            "not json\n",
            "{\"timestamp\":1700000000,\"method\":\"_x.ai/session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"usage_snapshot\",\"usage\":{\"inputTokens\":9}}}}\n",
            "{\"timestamp\":1700000000,\"method\":\"_x.ai/session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"turn_completed\",\"prompt_id\":\"p1\",\"usage\":{\"modelUsage\":{\"grok-4.5-build\":{\"inputTokens\":100,\"outputTokens\":10,\"cachedReadTokens\":5}}}}}}\n"
        );
        let events = parse_grok_usage_events(content);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].prompt_id, "p1");
        assert_eq!(events[0].per_model[0].1.input, 100);
    }

    #[test]
    fn imports_turns_at_face_value_and_rescan_is_idempotent() -> Result<(), AppError> {
        let db = Database::memory()?;
        let temp = tempdir().expect("tempdir");
        let lines = vec![
            usage_event(
                OLD_EPOCH,
                "p1",
                &model_counters("grok-4.5-build", 100, 10, 5, 0),
            ),
            usage_event(
                OLD_EPOCH + 60,
                "p2",
                &model_counters("grok-4.5-build", 100, 10, 5, 0),
            ),
        ];
        let path = write_session_file(temp.path(), "session-idem", &lines);

        assert_eq!(sync_single_grok_file(&db, &path)?.imported, 2);
        {
            let conn = lock_conn!(db.conn);
            conn.execute("DELETE FROM session_log_sync", [])?;
        }
        let rescan = sync_single_grok_file(&db, &path)?;
        assert_eq!(rescan.imported, 0);
        assert_eq!(rescan.skipped, 2);

        let rows = query_rows(&db)?;
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].1, rows[0].2, rows[0].3), (100, 10, 5));
        assert_eq!((rows[1].1, rows[1].2, rows[1].3), (100, 10, 5));
        Ok(())
    }

    #[test]
    fn settle_window_defers_recent_events_without_cursor() -> Result<(), AppError> {
        let db = Database::memory()?;
        let temp = tempdir().expect("tempdir");
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("now")
            .as_secs() as i64;
        let lines = vec![
            usage_event(
                OLD_EPOCH,
                "old",
                &model_counters("grok-4.5-build", 100, 10, 0, 0),
            ),
            usage_event(
                now,
                "recent",
                &model_counters("grok-4.5-build", 200, 20, 0, 0),
            ),
        ];
        let path = write_session_file(temp.path(), "session-settle", &lines);

        let result = sync_single_grok_file(&db, &path)?;
        assert_eq!(result.imported, 1);
        assert_eq!(result.deferred_files, 1);
        assert_eq!(get_sync_state(&db, &path.to_string_lossy())?, (0, 0));
        Ok(())
    }

    #[test]
    fn takeover_activity_skips_nearby_session_event() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model, input_tokens, output_tokens,
                    total_cost_usd, latency_ms, status_code, created_at, data_source
                 ) VALUES (?1, ?2, ?3, ?4, 1, 1, '0', 1, 200, ?5, 'proxy')",
                rusqlite::params!["proxy-grok", "provider", "grokbuild", "grok-4.5", OLD_EPOCH],
            )?;
        }
        let temp = tempdir().expect("tempdir");
        let path = write_session_file(
            temp.path(),
            "session-takeover",
            &[usage_event(
                OLD_EPOCH,
                "p1",
                &model_counters("grok-4.5-build", 100, 10, 0, 0),
            )],
        );

        let result = sync_single_grok_file(&db, &path)?;
        assert_eq!(result.imported, 0);
        assert_eq!(result.skipped, 1);
        assert!(query_rows(&db)?.is_empty());
        Ok(())
    }

    #[test]
    fn reported_complete_cost_wins_but_partial_cost_uses_local_pricing() -> Result<(), AppError> {
        let db = Database::memory()?;
        let temp = tempdir().expect("tempdir");
        let reported_ticks = 677_760_000;
        let complete = usage_event(
            OLD_EPOCH,
            "complete",
            &model_counters("grok-4.5-build", 16632, 104, 0, reported_ticks),
        );
        let partial = usage_event(
            OLD_EPOCH + 60,
            "partial",
            &format!(
                r#""grok-4.5-build":{{"inputTokens":16632,"outputTokens":104,"cachedReadTokens":0,"costUsdTicks":1000,"costIsPartial":true}}"#
            ),
        );
        let path = write_session_file(temp.path(), "session-cost", &[complete, partial]);

        assert_eq!(sync_single_grok_file(&db, &path)?.imported, 2);
        let rows = query_rows(&db)?;
        let complete_cost = Decimal::from_str(&rows[0].4).expect("complete cost");
        let partial_cost = Decimal::from_str(&rows[1].4).expect("partial cost");
        assert_eq!(
            complete_cost,
            Decimal::from(reported_ticks) / Decimal::from(10_000_000_000u64)
        );
        assert_eq!(
            partial_cost,
            Decimal::from(338_880_000u64) / Decimal::from(10_000_000_000u64)
        );
        Ok(())
    }

    #[test]
    fn unpriced_model_uses_reported_cost() -> Result<(), AppError> {
        let db = Database::memory()?;
        let temp = tempdir().expect("tempdir");
        let ticks = 56_540_000;
        let path = write_session_file(
            temp.path(),
            "session-unpriced",
            &[usage_event(
                OLD_EPOCH,
                "p1",
                &model_counters("grok-future", 100, 10, 0, ticks),
            )],
        );

        assert_eq!(sync_single_grok_file(&db, &path)?.imported, 1);
        let rows = query_rows(&db)?;
        assert_eq!(
            Decimal::from_str(&rows[0].4).expect("cost"),
            Decimal::from(ticks) / Decimal::from(10_000_000_000u64)
        );
        Ok(())
    }
}
