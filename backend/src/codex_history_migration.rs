//! Codex 官方会话历史的可选统一迁移与账本恢复。

use crate::codex_config::{
    get_codex_config_dir, read_codex_config_text, CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
};
use crate::config::{atomic_write, get_app_config_dir, get_home_dir};
use crate::database::Database;
use crate::error::AppError;
use crate::settings::CodexOfficialHistoryUnifyMigration;
use chrono::{Local, Utc};
use rusqlite::{backup::Backup, params_from_iter, Connection};
use serde_json::Value;
use std::collections::{hash_map::DefaultHasher, BTreeSet, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use toml_edit::DocumentMut;

const MIGRATION_NAME: &str = "codex-official-history-unify-v1";
const RESTORE_BACKUP_NAME: &str = "codex-official-history-unify-restore-v1";
const OFFICIAL_PROVIDER_ID: &str = "openai";
const STATE_DB_FILENAME: &str = "state_5.sqlite";
const STATE_DB_ID_CHUNK: usize = 500;

static OP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_operation() -> std::sync::MutexGuard<'static, ()> {
    OP_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Default)]
pub struct MigrationOutcome {
    pub migrated_jsonl_files: usize,
    pub migrated_state_rows: usize,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RestoreOutcome {
    pub restored_jsonl_files: usize,
    pub restored_state_rows: usize,
    pub skipped_reason: Option<String>,
}

pub fn maybe_migrate_codex_official_history() -> Result<MigrationOutcome, AppError> {
    if !crate::settings::unify_codex_session_history() {
        return Ok(MigrationOutcome {
            skipped_reason: Some("unify_toggle_off".to_string()),
            ..Default::default()
        });
    }
    if !crate::settings::unify_codex_migrate_existing_requested() {
        return Ok(MigrationOutcome {
            skipped_reason: Some("migration_not_requested".to_string()),
            ..Default::default()
        });
    }

    let _guard = lock_operation();
    let codex_dir = get_codex_config_dir();
    let codex_dir_key = canonical_dir_string(&codex_dir);
    if crate::settings::is_codex_official_history_unify_migrated_for_dir(&codex_dir_key) {
        return Ok(MigrationOutcome {
            skipped_reason: Some("already_migrated".to_string()),
            ..Default::default()
        });
    }

    let config_text = read_codex_config_text().unwrap_or_default();
    if !config_routes_to_unified_bucket(&config_text) {
        return Ok(MigrationOutcome {
            skipped_reason: Some("live_not_unified".to_string()),
            ..Default::default()
        });
    }

    let source_ids: BTreeSet<String> = std::iter::once(OFFICIAL_PROVIDER_ID.to_string()).collect();
    let backup_root = migration_backup_root(MIGRATION_NAME);
    let migrated_jsonl_files = migrate_jsonl_files(&codex_dir, &source_ids, &backup_root)?;
    let migrated_state_rows =
        migrate_state_dbs(&codex_dir, &config_text, &source_ids, &backup_root)?;
    write_generation_meta(&backup_root, &codex_dir_key)?;

    let outcome = MigrationOutcome {
        migrated_jsonl_files,
        migrated_state_rows,
        skipped_reason: None,
    };
    let marker_written = crate::settings::mark_codex_official_history_unify_migrated_if_enabled(
        CodexOfficialHistoryUnifyMigration {
            completed_at: Utc::now().to_rfc3339(),
            target_provider_id: CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string(),
            migrated_jsonl_files,
            migrated_state_rows,
            codex_config_dir: Some(codex_dir_key),
        },
    )?;
    if !marker_written {
        return Ok(MigrationOutcome {
            skipped_reason: Some("toggle_disabled_during_migration".to_string()),
            ..outcome
        });
    }
    Ok(outcome)
}

pub fn has_codex_official_history_backup() -> bool {
    has_backup_for_dir(
        &backup_parent(),
        &canonical_dir_string(&get_codex_config_dir()),
    )
}

pub fn restore_codex_official_history() -> Result<RestoreOutcome, AppError> {
    let _guard = lock_operation();
    if crate::settings::unify_codex_session_history() {
        return Ok(RestoreOutcome {
            skipped_reason: Some("unify_toggle_on".to_string()),
            ..Default::default()
        });
    }
    let codex_dir = get_codex_config_dir();
    let config_text = read_codex_config_text().unwrap_or_default();
    restore_history_inner(
        &codex_dir,
        &backup_parent(),
        &migration_backup_root(RESTORE_BACKUP_NAME),
        &config_text,
    )
}

fn config_routes_to_unified_bucket(config_text: &str) -> bool {
    config_text
        .parse::<DocumentMut>()
        .ok()
        .and_then(|doc| {
            doc.get("model_provider")
                .and_then(|item| item.as_str())
                .map(|id| id.trim() == CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
        })
        .unwrap_or(false)
}

fn canonical_dir_string(dir: &Path) -> String {
    fs::canonicalize(dir)
        .unwrap_or_else(|_| dir.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn migration_backup_root(name: &str) -> PathBuf {
    get_app_config_dir()
        .join("backups")
        .join(name)
        .join(Local::now().format("%Y%m%d_%H%M%S").to_string())
}

fn backup_parent() -> PathBuf {
    get_app_config_dir().join("backups").join(MIGRATION_NAME)
}

fn write_generation_meta(root: &Path, codex_dir_key: &str) -> Result<(), AppError> {
    if !root.exists() {
        return Ok(());
    }
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "codexConfigDir": codex_dir_key,
    }))
    .map_err(|source| AppError::JsonSerialize { source })?;
    atomic_write(&root.join("meta.json"), &bytes)
}

fn has_backup_for_dir(parent: &Path, codex_dir_key: &str) -> bool {
    let Ok(entries) = fs::read_dir(parent) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let generation = entry.path();
        generation.is_dir() && generation_matches_dir(&generation, codex_dir_key)
    })
}

fn restore_history_inner(
    codex_dir: &Path,
    ledger_parent: &Path,
    restore_backup_root: &Path,
    config_text: &str,
) -> Result<RestoreOutcome, AppError> {
    let (session_ids, thread_ids) =
        collect_official_ledger(ledger_parent, &canonical_dir_string(codex_dir))?;
    if session_ids.is_empty() && thread_ids.is_empty() {
        return Ok(RestoreOutcome {
            skipped_reason: Some("no_backup_ledger".to_string()),
            ..Default::default()
        });
    }

    let mut files = Vec::new();
    collect_files(&codex_dir.join("sessions"), "jsonl", &mut files, 0, 8);
    collect_files(
        &codex_dir.join("archived_sessions"),
        "jsonl",
        &mut files,
        0,
        4,
    );
    let mut restored_jsonl_files = 0;
    for path in files {
        if rewrite_session_file(&path, codex_dir, restore_backup_root, |line| {
            rewrite_session_meta_for_restore(line, &session_ids)
        })? {
            restored_jsonl_files += 1;
        }
    }

    let mut restored_state_rows = 0;
    for path in state_db_paths(codex_dir, config_text) {
        restored_state_rows +=
            restore_state_db(&path, codex_dir, &thread_ids, restore_backup_root)?;
    }
    if restored_jsonl_files == 0 && restored_state_rows == 0 {
        return Ok(RestoreOutcome {
            skipped_reason: Some("nothing_to_restore".to_string()),
            ..Default::default()
        });
    }
    Ok(RestoreOutcome {
        restored_jsonl_files,
        restored_state_rows,
        skipped_reason: None,
    })
}

fn collect_official_ledger(
    parent: &Path,
    codex_dir_key: &str,
) -> Result<(HashSet<String>, BTreeSet<String>), AppError> {
    let mut session_ids = HashSet::new();
    let mut thread_ids = BTreeSet::new();
    let Ok(entries) = fs::read_dir(parent) else {
        return Ok((session_ids, thread_ids));
    };
    for entry in entries.flatten() {
        let generation = entry.path();
        if !generation.is_dir() || !generation_matches_dir(&generation, codex_dir_key) {
            continue;
        }
        let mut jsonl_files = Vec::new();
        collect_files(&generation.join("jsonl"), "jsonl", &mut jsonl_files, 0, 10);
        for path in jsonl_files {
            collect_official_session_ids(&path, &mut session_ids);
        }
        let mut db_files = Vec::new();
        collect_files(&generation.join("state"), "sqlite", &mut db_files, 0, 4);
        for path in db_files {
            collect_official_thread_ids(&path, &mut thread_ids);
        }
    }
    Ok((session_ids, thread_ids))
}

fn generation_matches_dir(generation: &Path, codex_dir_key: &str) -> bool {
    let Ok(text) = fs::read_to_string(generation.join("meta.json")) else {
        return true;
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("codexConfigDir")
                .and_then(Value::as_str)
                .map(|dir| dir == codex_dir_key)
        })
        .unwrap_or(true)
}

fn collect_official_session_ids(path: &Path, ids: &mut HashSet<String>) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let Some(payload) = value.get("payload") else {
            continue;
        };
        if payload.get("model_provider").and_then(Value::as_str) == Some(OFFICIAL_PROVIDER_ID) {
            if let Some(id) = payload.get("id").and_then(Value::as_str) {
                ids.insert(id.to_string());
            }
        }
    }
}

fn collect_official_thread_ids(path: &Path, ids: &mut BTreeSet<String>) {
    let Ok(conn) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return;
    };
    if !Database::table_exists(&conn, "threads").unwrap_or(false)
        || !Database::has_column(&conn, "threads", "model_provider").unwrap_or(false)
    {
        return;
    }
    let Ok(mut statement) = conn.prepare("SELECT id FROM threads WHERE model_provider = ?1") else {
        return;
    };
    let Ok(rows) = statement.query_map([OFFICIAL_PROVIDER_ID], |row| row.get::<_, String>(0))
    else {
        return;
    };
    ids.extend(rows.flatten());
}

fn collect_files(dir: &Path, extension: &str, files: &mut Vec<PathBuf>, depth: u8, max_depth: u8) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, extension, files, depth + 1, max_depth);
        } else if path.extension().and_then(|value| value.to_str()) == Some(extension) {
            files.push(path);
        }
    }
}

fn migrate_jsonl_files(
    codex_dir: &Path,
    source_ids: &BTreeSet<String>,
    backup_root: &Path,
) -> Result<usize, AppError> {
    let mut files = Vec::new();
    collect_files(&codex_dir.join("sessions"), "jsonl", &mut files, 0, 8);
    collect_files(
        &codex_dir.join("archived_sessions"),
        "jsonl",
        &mut files,
        0,
        4,
    );
    let source_ids: HashSet<String> = source_ids.iter().cloned().collect();
    let mut migrated = 0;
    for path in files {
        if rewrite_session_file(&path, codex_dir, backup_root, |line| {
            rewrite_session_meta_for_migration(line, &source_ids)
        })? {
            migrated += 1;
        }
    }
    Ok(migrated)
}

fn rewrite_session_file(
    path: &Path,
    codex_dir: &Path,
    backup_root: &Path,
    rewrite_line: impl Fn(&str) -> Option<String>,
) -> Result<bool, AppError> {
    let metadata = fs::metadata(path).map_err(|error| AppError::io(path, error))?;
    let modified = metadata.modified().ok();
    let len = metadata.len();
    let content = fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
    let mut output = String::with_capacity(content.len());
    let mut changed = false;
    for segment in content.split_inclusive('\n') {
        let (line, newline) = segment
            .strip_suffix('\n')
            .map(|line| (line, "\n"))
            .unwrap_or((segment, ""));
        if let Some(next) = rewrite_line(line) {
            output.push_str(&next);
            changed = true;
        } else {
            output.push_str(line);
        }
        output.push_str(newline);
    }
    if !changed {
        return Ok(false);
    }

    ensure_file_unchanged(path, modified, len)?;
    backup_file(path, codex_dir, backup_root.join("jsonl"))?;
    ensure_file_unchanged(path, modified, len)?;
    atomic_write(path, output.as_bytes())?;
    Ok(true)
}

fn ensure_file_unchanged(
    path: &Path,
    modified: Option<SystemTime>,
    len: u64,
) -> Result<(), AppError> {
    let current = fs::metadata(path).map_err(|error| AppError::io(path, error))?;
    if current.modified().ok() != modified || current.len() != len {
        return Err(AppError::Message(format!(
            "Codex 会话文件在迁移期间发生变化: {}",
            path.display()
        )));
    }
    Ok(())
}

fn rewrite_session_meta_for_migration(line: &str, source_ids: &HashSet<String>) -> Option<String> {
    rewrite_session_meta(
        line,
        |provider, _| source_ids.contains(provider),
        CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
    )
}

fn rewrite_session_meta_for_restore(
    line: &str,
    official_session_ids: &HashSet<String>,
) -> Option<String> {
    rewrite_session_meta(
        line,
        |provider, id| {
            provider == CC_SWITCH_CODEX_MODEL_PROVIDER_ID && official_session_ids.contains(id)
        },
        OFFICIAL_PROVIDER_ID,
    )
}

fn rewrite_session_meta(
    line: &str,
    matches: impl Fn(&str, &str) -> bool,
    target_provider: &str,
) -> Option<String> {
    if !line.contains("\"session_meta\"") || !line.contains("\"model_provider\"") {
        return None;
    }
    let mut value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = value.get_mut("payload")?.as_object_mut()?;
    let provider = payload.get("model_provider")?.as_str()?;
    let id = payload.get("id")?.as_str()?;
    if !matches(provider, id) {
        return None;
    }
    payload.insert(
        "model_provider".to_string(),
        Value::String(target_provider.to_string()),
    );
    serde_json::to_string(&value).ok()
}

fn migrate_state_dbs(
    codex_dir: &Path,
    config_text: &str,
    source_ids: &BTreeSet<String>,
    backup_root: &Path,
) -> Result<usize, AppError> {
    let mut migrated = 0;
    for path in state_db_paths(codex_dir, config_text) {
        migrated += migrate_state_db(&path, codex_dir, source_ids, backup_root)?;
    }
    Ok(migrated)
}

fn migrate_state_db(
    path: &Path,
    codex_dir: &Path,
    source_ids: &BTreeSet<String>,
    backup_root: &Path,
) -> Result<usize, AppError> {
    if !path.exists() || source_ids.is_empty() {
        return Ok(0);
    }
    let mut conn = open_state_db(path)?;
    if !has_provider_column(&conn)? {
        return Ok(0);
    }
    let placeholders = placeholders(source_ids.len());
    let count_sql =
        format!("SELECT COUNT(*) FROM threads WHERE model_provider IN ({placeholders})");
    let count: i64 = conn
        .query_row(&count_sql, params_from_iter(source_ids.iter()), |row| {
            row.get(0)
        })
        .map_err(|error| {
            AppError::Database(format!("统计 Codex state DB 待迁移行失败: {error}"))
        })?;
    if count == 0 {
        return Ok(0);
    }
    backup_state_db(path, codex_dir, backup_root, &conn)?;
    let update_sql =
        format!("UPDATE threads SET model_provider = ? WHERE model_provider IN ({placeholders})");
    let mut values = Vec::with_capacity(source_ids.len() + 1);
    values.push(CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string());
    values.extend(source_ids.iter().cloned());
    let transaction = conn.transaction()?;
    let changed = transaction.execute(&update_sql, params_from_iter(values.iter()))?;
    transaction.commit()?;
    Ok(changed)
}

fn restore_state_db(
    path: &Path,
    codex_dir: &Path,
    thread_ids: &BTreeSet<String>,
    backup_root: &Path,
) -> Result<usize, AppError> {
    if !path.exists() || thread_ids.is_empty() {
        return Ok(0);
    }
    let mut conn = open_state_db(path)?;
    if !has_provider_column(&conn)? {
        return Ok(0);
    }
    let ids: Vec<&String> = thread_ids.iter().collect();
    let mut count = 0_i64;
    for chunk in ids.chunks(STATE_DB_ID_CHUNK) {
        let placeholders = placeholders(chunk.len());
        let sql = format!(
            "SELECT COUNT(*) FROM threads WHERE model_provider = ? AND id IN ({placeholders})"
        );
        let mut values = vec![CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string()];
        values.extend(chunk.iter().map(|id| (*id).clone()));
        let chunk_count: i64 =
            conn.query_row(&sql, params_from_iter(values.iter()), |row| row.get(0))?;
        count += chunk_count;
    }
    if count == 0 {
        return Ok(0);
    }
    backup_state_db(path, codex_dir, backup_root, &conn)?;
    let transaction = conn.transaction()?;
    let mut changed = 0;
    for chunk in ids.chunks(STATE_DB_ID_CHUNK) {
        let placeholders = placeholders(chunk.len());
        let sql = format!(
            "UPDATE threads SET model_provider = ? WHERE model_provider = ? AND id IN ({placeholders})"
        );
        let mut values = vec![
            OFFICIAL_PROVIDER_ID.to_string(),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string(),
        ];
        values.extend(chunk.iter().map(|id| (*id).clone()));
        changed += transaction.execute(&sql, params_from_iter(values.iter()))?;
    }
    transaction.commit()?;
    Ok(changed)
}

fn open_state_db(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path)
        .map_err(|error| AppError::Database(format!("打开 Codex state DB 失败: {error}")))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| AppError::Database(format!("设置 Codex state DB 超时失败: {error}")))?;
    Ok(conn)
}

fn has_provider_column(conn: &Connection) -> Result<bool, AppError> {
    Ok(Database::table_exists(conn, "threads")?
        && Database::has_column(conn, "threads", "model_provider")?)
}

fn state_db_paths(codex_dir: &Path, config_text: &str) -> Vec<PathBuf> {
    let mut paths = vec![codex_dir.join(STATE_DB_FILENAME)];
    let sqlite_home = sqlite_home_from_config(config_text).or_else(sqlite_home_from_env);
    if let Some(home) = sqlite_home {
        let path = home.join(STATE_DB_FILENAME);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

fn sqlite_home_from_config(config_text: &str) -> Option<PathBuf> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    resolve_sqlite_home(doc.get("sqlite_home")?.as_str()?)
}

fn sqlite_home_from_env() -> Option<PathBuf> {
    resolve_sqlite_home(&std::env::var("CODEX_SQLITE_HOME").ok()?)
}

fn resolve_sqlite_home(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw == "~" {
        return Some(get_home_dir());
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return Some(get_home_dir().join(rest));
    }
    Some(PathBuf::from(raw))
}

fn placeholders(count: usize) -> String {
    std::iter::repeat("?")
        .take(count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn backup_state_db(
    path: &Path,
    codex_dir: &Path,
    backup_root: &Path,
    source: &Connection,
) -> Result<(), AppError> {
    let target = backup_root
        .join("state")
        .join(relative_backup_path(path, codex_dir));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    }
    let mut target_conn = Connection::open(&target)
        .map_err(|error| AppError::Database(format!("创建 Codex state DB 备份失败: {error}")))?;
    let backup = Backup::new(source, &mut target_conn)?;
    backup.run_to_completion(5, Duration::from_millis(25), None)?;
    Ok(())
}

fn backup_file(source: &Path, root: &Path, backup_namespace: PathBuf) -> Result<(), AppError> {
    let target = backup_namespace.join(relative_backup_path(source, root));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    }
    fs::copy(source, &target).map_err(|error| AppError::IoContext {
        context: format!(
            "复制 Codex 迁移备份失败 ({} -> {})",
            source.display(),
            target.display()
        ),
        source: error,
    })?;
    Ok(())
}

fn relative_backup_path(path: &Path, root: &Path) -> PathBuf {
    if let Ok(relative) = path.strip_prefix(root) {
        return relative.to_path_buf();
    }
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    PathBuf::from("external").join(format!("{:016x}-{file_name}", hasher.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::tempdir;

    struct EnvGuard(Option<std::ffi::OsString>);

    impl EnvGuard {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("CODEX_SQLITE_HOME");
            std::env::set_var("CODEX_SQLITE_HOME", path);
            Self(previous)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.0.take() {
                std::env::set_var("CODEX_SQLITE_HOME", previous);
            } else {
                std::env::remove_var("CODEX_SQLITE_HOME");
            }
        }
    }

    #[test]
    fn jsonl_migration_and_ledger_restore_round_trip() {
        let temp = tempdir().unwrap();
        let codex_dir = temp.path().join("codex");
        let session_dir = codex_dir.join("sessions/2026/07/30");
        fs::create_dir_all(&session_dir).unwrap();
        let session = session_dir.join("rollout.jsonl");
        fs::write(
            &session,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"official-1\",\"model_provider\":\"openai\"}}\n{\"type\":\"message\"}\n",
        )
        .unwrap();
        let ledger_parent = temp.path().join("ledger");
        let generation = ledger_parent.join("generation");
        let sources = std::iter::once(OFFICIAL_PROVIDER_ID.to_string()).collect();

        assert_eq!(
            migrate_jsonl_files(&codex_dir, &sources, &generation).unwrap(),
            1
        );
        write_generation_meta(&generation, &canonical_dir_string(&codex_dir)).unwrap();
        assert!(fs::read_to_string(&session).unwrap().contains("ccswitch"));

        let outcome =
            restore_history_inner(&codex_dir, &ledger_parent, &temp.path().join("restore"), "")
                .unwrap();
        assert_eq!(outcome.restored_jsonl_files, 1);
        assert!(fs::read_to_string(&session).unwrap().contains("openai"));
    }

    #[test]
    fn state_db_migration_and_ledger_restore_round_trip() {
        let temp = tempdir().unwrap();
        let codex_dir = temp.path().join("codex");
        fs::create_dir_all(&codex_dir).unwrap();
        let db_path = codex_dir.join(STATE_DB_FILENAME);
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL);
             INSERT INTO threads VALUES ('official-1', 'openai');
             INSERT INTO threads VALUES ('third-party', 'ccswitch');",
        )
        .unwrap();
        drop(conn);
        let ledger_parent = temp.path().join("ledger");
        let generation = ledger_parent.join("generation");
        let sources = std::iter::once(OFFICIAL_PROVIDER_ID.to_string()).collect();

        assert_eq!(
            migrate_state_db(&db_path, &codex_dir, &sources, &generation).unwrap(),
            1
        );
        write_generation_meta(&generation, &canonical_dir_string(&codex_dir)).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT model_provider FROM threads WHERE id = 'official-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID
        );
        drop(conn);

        let outcome =
            restore_history_inner(&codex_dir, &ledger_parent, &temp.path().join("restore"), "")
                .unwrap();
        assert_eq!(outcome.restored_state_rows, 1);
        let conn = Connection::open(&db_path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT model_provider FROM threads WHERE id = 'official-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            OFFICIAL_PROVIDER_ID
        );
        assert_eq!(
            conn.query_row(
                "SELECT model_provider FROM threads WHERE id = 'third-party'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID
        );
    }

    #[test]
    fn restore_only_touches_session_ids_proven_by_ledger() {
        let known: HashSet<String> = ["official-1".to_string()].into_iter().collect();
        let unknown = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"third-party\",\"model_provider\":\"ccswitch\"}}";
        assert!(rewrite_session_meta_for_restore(unknown, &known).is_none());
    }

    #[test]
    #[serial]
    fn state_paths_use_env_and_config_takes_precedence() {
        let temp = tempdir().unwrap();
        let codex_dir = temp.path().join("codex");
        let env_home = temp.path().join("env");
        let config_home = temp.path().join("config");
        let _guard = EnvGuard::set(&env_home);

        assert_eq!(
            state_db_paths(&codex_dir, ""),
            vec![
                codex_dir.join(STATE_DB_FILENAME),
                env_home.join(STATE_DB_FILENAME),
            ]
        );
        let config = format!("sqlite_home = '{}'\n", config_home.display());
        assert_eq!(
            state_db_paths(&codex_dir, &config),
            vec![
                codex_dir.join(STATE_DB_FILENAME),
                config_home.join(STATE_DB_FILENAME),
            ]
        );
    }
}
