use super::{Database, SCHEMA_VERSION};
use crate::config::{
    atomic_write, get_app_config_dir, get_cc_switch_source_dir, get_default_app_config_dir,
    is_cc_switch_source_path,
};
use crate::error::AppError;
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tempfile::Builder;

const DATABASE_FILE: &str = "cc-switch.db";
const MIGRATED_FILES: &[&str] = &["settings.json", "model-pricing.json"];
static MIGRATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CcSwitchMigrationResult {
    pub migrated: bool,
    pub backup_id: String,
    pub source_version: i32,
    pub copied_files: Vec<String>,
}

fn lock_migration() -> Result<MutexGuard<'static, ()>, AppError> {
    MIGRATION_LOCK
        .lock()
        .map_err(|error| AppError::Database(format!("迁移锁获取失败: {error}")))
}

pub(crate) fn migrate_default_data_dir_if_needed() -> Result<bool, AppError> {
    let _guard = lock_migration()?;
    let target_dir = get_default_app_config_dir();
    if target_dir.exists() {
        return Ok(false);
    }

    let source_dir = get_cc_switch_source_dir();
    let source_db = source_dir.join(DATABASE_FILE);
    if !source_db.is_file() {
        return Ok(false);
    }

    let parent = target_dir
        .parent()
        .ok_or_else(|| AppError::Config("Web 数据目录缺少父目录".to_string()))?;
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    let staging = Builder::new()
        .prefix(".cc-switch-web.migrating-")
        .tempdir_in(parent)
        .map_err(|error| AppError::io(parent, error))?;

    create_web_database_snapshot(&source_db, &staging.path().join(DATABASE_FILE))?;
    copy_payload(&source_dir, staging.path())?;

    let staging_path = staging.keep();
    if let Err(error) = fs::rename(&staging_path, &target_dir) {
        let _ = fs::remove_dir_all(&staging_path);
        return Err(AppError::IoContext {
            context: format!(
                "发布 Web 数据目录失败: {} -> {}",
                staging_path.display(),
                target_dir.display()
            ),
            source: error,
        });
    }

    log::info!("已从只读 CC Switch 数据目录迁移到 {}", target_dir.display());
    Ok(true)
}

impl Database {
    pub(crate) fn migrate_from_cc_switch(&self) -> Result<CcSwitchMigrationResult, AppError> {
        let _guard = lock_migration()?;
        let source_dir = get_cc_switch_source_dir();
        let source_db = source_dir.join(DATABASE_FILE);
        if !source_db.is_file() {
            return Err(AppError::InvalidInput(format!(
                "未找到 CC Switch 数据库: {}",
                source_db.display()
            )));
        }

        let target_dir = get_app_config_dir();
        if is_cc_switch_source_path(&target_dir) {
            return Err(AppError::InvalidInput(
                "CC Switch 数据目录仅允许读取，不能作为 Web 数据目录".to_string(),
            ));
        }
        fs::create_dir_all(&target_dir).map_err(|error| AppError::io(&target_dir, error))?;

        let staging = Builder::new()
            .prefix(".cc-switch-migration-")
            .tempdir_in(&target_dir)
            .map_err(|error| AppError::io(&target_dir, error))?;
        let staged_db = staging.path().join(DATABASE_FILE);
        let source_version = create_web_database_snapshot(&source_db, &staged_db)?;
        let source_payload = staging.path().join("source");
        let copied_files = copy_payload(&source_dir, &source_payload)?;
        let current_payload = staging.path().join("current");
        copy_payload(&target_dir, &current_payload)?;

        let staged_conn = Connection::open(&staged_db)
            .map_err(|error| AppError::Database(format!("打开迁移暂存库失败: {error}")))?;
        let backup_id = self.replace_from_snapshot(&staged_conn)?;
        drop(staged_conn);

        let files_backup = target_dir
            .join("backups")
            .join(format!("{backup_id}-files"));
        if let Some(parent) = files_backup.parent() {
            fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
        }
        if let Err(error) = fs::rename(&current_payload, &files_backup) {
            let _ = rollback_database(self, &backup_id);
            return Err(AppError::IoContext {
                context: format!("保存迁移前 Web 文件失败: {}", files_backup.display()),
                source: error,
            });
        }

        if let Err(error) = install_payload(&source_payload, &target_dir, staging.path()) {
            let file_rollback = restore_payload(&files_backup, &target_dir, &copied_files);
            let db_rollback = rollback_database(self, &backup_id);
            return Err(AppError::Message(format!(
                "迁移文件失败: {error}; 文件回滚: {}; 数据库回滚: {}",
                format_rollback(file_rollback),
                format_rollback(db_rollback)
            )));
        }

        Ok(CcSwitchMigrationResult {
            migrated: true,
            backup_id,
            source_version,
            copied_files,
        })
    }
}

fn create_web_database_snapshot(source: &Path, target: &Path) -> Result<i32, AppError> {
    let source_conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| {
            AppError::Database(format!(
                "以只读方式打开 CC Switch 数据库失败 {}: {error}",
                source.display()
            ))
        })?;
    let source_version = Database::get_user_version(&source_conn)?;
    let mut target_conn = Connection::open(target)
        .map_err(|error| AppError::Database(format!("创建迁移暂存库失败: {error}")))?;

    {
        let backup = Backup::new(&source_conn, &mut target_conn)
            .map_err(|error| AppError::Database(format!("创建源库只读快照失败: {error}")))?;
        Database::complete_backup(&backup, "创建 CC Switch 只读快照")?;
    }

    Database::validate_imported_schema(&target_conn)?;
    Database::create_tables_on_conn(&target_conn)?;
    if source_version <= SCHEMA_VERSION {
        Database::apply_schema_migrations_on_conn(&target_conn)?;
    } else {
        Database::set_user_version(&target_conn, SCHEMA_VERSION)?;
    }
    Database::ensure_incremental_auto_vacuum_on_conn(&target_conn)?;
    Database::validate_sqlite_integrity(&target_conn)?;
    validate_foreign_keys(&target_conn)?;
    Ok(source_version)
}

fn validate_foreign_keys(conn: &Connection) -> Result<(), AppError> {
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|error| AppError::Database(format!("检查迁移库外键失败: {error}")))?;
    if violations == 0 {
        Ok(())
    } else {
        Err(AppError::Database(format!(
            "迁移库存在 {violations} 条外键错误"
        )))
    }
}

fn copy_payload(source: &Path, target: &Path) -> Result<Vec<String>, AppError> {
    fs::create_dir_all(target).map_err(|error| AppError::io(target, error))?;
    let mut copied = Vec::new();
    for name in MIGRATED_FILES {
        let source_file = source.join(name);
        if source_file.is_file() {
            copy_regular_file(&source_file, &target.join(name))?;
            copied.push((*name).to_string());
        }
    }

    let source_skills = source.join("skills");
    if source_skills.is_dir() {
        copy_tree(&source_skills, &target.join("skills"))?;
        copied.push("skills/".to_string());
    }
    Ok(copied)
}

fn copy_regular_file(source: &Path, target: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(source).map_err(|error| AppError::io(source, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::InvalidInput(format!(
            "迁移来源必须是普通文件: {}",
            source.display()
        )));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| AppError::IoContext {
            context: format!(
                "复制迁移文件失败: {} -> {}",
                source.display(),
                target.display()
            ),
            source: error,
        })
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(source).map_err(|error| AppError::io(source, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "迁移目录不能是符号链接: {}",
            source.display()
        )));
    }
    fs::create_dir_all(target).map_err(|error| AppError::io(target, error))?;
    for entry in fs::read_dir(source).map_err(|error| AppError::io(source, error))? {
        let entry = entry.map_err(|error| AppError::io(source, error))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| AppError::io(&source_path, error))?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::InvalidInput(format!(
                "迁移目录包含符号链接: {}",
                source_path.display()
            )));
        }
        if metadata.is_dir() {
            copy_tree(&source_path, &target_path)?;
        } else if metadata.is_file() {
            copy_regular_file(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn install_payload(source: &Path, target: &Path, staging: &Path) -> Result<(), AppError> {
    for name in MIGRATED_FILES {
        let source_file = source.join(name);
        if source_file.is_file() {
            let bytes =
                fs::read(&source_file).map_err(|error| AppError::io(&source_file, error))?;
            atomic_write(&target.join(name), &bytes)?;
        }
    }

    let source_skills = source.join("skills");
    if source_skills.is_dir() {
        replace_directory(&source_skills, &target.join("skills"), staging)?;
    }
    Ok(())
}

fn replace_directory(incoming: &Path, target: &Path, staging: &Path) -> Result<(), AppError> {
    let previous = staging.join("previous-skills");
    let had_previous = target.exists();
    if had_previous {
        fs::rename(target, &previous).map_err(|error| AppError::IoContext {
            context: format!("暂存现有目录失败: {}", target.display()),
            source: error,
        })?;
    }
    if let Err(error) = fs::rename(incoming, target) {
        if had_previous {
            let _ = fs::rename(&previous, target);
        }
        return Err(AppError::IoContext {
            context: format!("发布迁移目录失败: {}", target.display()),
            source: error,
        });
    }
    Ok(())
}

fn restore_payload(backup: &Path, target: &Path, copied_files: &[String]) -> Result<(), AppError> {
    for name in MIGRATED_FILES {
        if !copied_files.iter().any(|item| item == name) {
            continue;
        }
        let backup_file = backup.join(name);
        let target_file = target.join(name);
        if backup_file.is_file() {
            let bytes =
                fs::read(&backup_file).map_err(|error| AppError::io(&backup_file, error))?;
            atomic_write(&target_file, &bytes)?;
        } else if target_file.exists() {
            fs::remove_file(&target_file).map_err(|error| AppError::io(&target_file, error))?;
        }
    }

    if copied_files.iter().any(|item| item == "skills/") {
        let target_skills = target.join("skills");
        if target_skills.exists() {
            fs::remove_dir_all(&target_skills)
                .map_err(|error| AppError::io(&target_skills, error))?;
        }
        let backup_skills = backup.join("skills");
        if backup_skills.is_dir() {
            copy_tree(&backup_skills, &target_skills)?;
        }
    }
    Ok(())
}

fn rollback_database(db: &Database, backup_id: &str) -> Result<(), AppError> {
    if backup_id.is_empty() {
        return Err(AppError::Database("迁移前数据库备份不存在".to_string()));
    }
    db.restore_from_backup(&format!("{backup_id}.db"))?;
    Ok(())
}

fn format_rollback(result: Result<(), AppError>) -> String {
    match result {
        Ok(()) => "成功".to_string(),
        Err(error) => format!("失败（{error}）"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use serial_test::serial;
    use std::ffi::OsString;
    use std::time::SystemTime;
    use tempfile::tempdir;

    struct TestHome {
        previous: Option<OsString>,
    }

    impl TestHome {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", path);
            Self { previous }
        }
    }

    impl Drop for TestHome {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
        }
    }

    fn create_source_database(home: &Path, version: i32, provider_name: &str) -> PathBuf {
        let source_dir = home.join(".cc-switch");
        fs::create_dir_all(&source_dir).unwrap();
        let path = source_dir.join(DATABASE_FILE);
        let conn = Connection::open(&path).unwrap();
        Database::create_tables_on_conn(&conn).unwrap();
        Database::set_user_version(&conn, version).unwrap();
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES (?1, 'claude', ?2, '{}')",
            params!["source-provider", provider_name],
        )
        .unwrap();
        drop(conn);
        path
    }

    #[test]
    #[serial]
    fn automatic_migration_normalizes_future_schema_without_touching_source() {
        let home = tempdir().unwrap();
        let _home = TestHome::set(home.path());
        let source_db = create_source_database(home.path(), 17, "桌面端供应商");
        fs::write(
            home.path().join(".cc-switch/settings.json"),
            b"{\"language\":\"zh\"}",
        )
        .unwrap();
        let source_bytes = fs::read(&source_db).unwrap();
        let source_modified = fs::metadata(&source_db)
            .unwrap()
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);

        assert!(migrate_default_data_dir_if_needed().unwrap());

        let target = home.path().join(".cc-switch-web");
        let conn = Connection::open(target.join(DATABASE_FILE)).unwrap();
        assert_eq!(Database::get_user_version(&conn).unwrap(), SCHEMA_VERSION);
        let name: String = conn
            .query_row(
                "SELECT name FROM providers WHERE id = 'source-provider'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "桌面端供应商");
        assert_eq!(
            fs::read(target.join("settings.json")).unwrap(),
            b"{\"language\":\"zh\"}"
        );
        assert_eq!(fs::read(&source_db).unwrap(), source_bytes);
        assert_eq!(
            fs::metadata(&source_db).unwrap().modified().unwrap(),
            source_modified
        );
        assert_eq!(
            Database::get_user_version(
                &Connection::open_with_flags(&source_db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
            )
            .unwrap(),
            17
        );
    }

    #[test]
    #[serial]
    fn existing_web_directory_is_never_automatically_overwritten() {
        let home = tempdir().unwrap();
        let _home = TestHome::set(home.path());
        create_source_database(home.path(), 17, "source");
        let target = home.path().join(".cc-switch-web");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("sentinel"), b"keep").unwrap();

        assert!(!migrate_default_data_dir_if_needed().unwrap());
        assert_eq!(fs::read(target.join("sentinel")).unwrap(), b"keep");
        assert!(!target.join(DATABASE_FILE).exists());
    }

    #[test]
    #[serial]
    fn failed_automatic_migration_does_not_publish_target_directory() {
        let home = tempdir().unwrap();
        let _home = TestHome::set(home.path());
        let source = home.path().join(".cc-switch");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join(DATABASE_FILE), b"not sqlite").unwrap();

        assert!(migrate_default_data_dir_if_needed().is_err());
        assert!(!home.path().join(".cc-switch-web").exists());
    }

    #[test]
    #[serial]
    fn manual_migration_backs_up_web_data_and_keeps_source_unchanged() {
        let home = tempdir().unwrap();
        let _home = TestHome::set(home.path());
        let source_db = create_source_database(home.path(), 16, "source");
        fs::write(
            home.path().join(".cc-switch/settings.json"),
            b"source-settings",
        )
        .unwrap();
        let source_bytes = fs::read(&source_db).unwrap();
        let source_modified = fs::metadata(&source_db).unwrap().modified().unwrap();

        let target = home.path().join(".cc-switch-web");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("settings.json"), b"web-settings").unwrap();
        let db = Database::init().unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('web-provider', 'claude', 'web', '{}')",
                [],
            )
            .unwrap();

        let result = db.migrate_from_cc_switch().unwrap();

        assert!(result.migrated);
        assert_eq!(result.source_version, 16);
        assert!(!result.backup_id.is_empty());
        assert!(target
            .join("backups")
            .join(format!("{}.db", result.backup_id))
            .is_file());
        assert_eq!(
            fs::read(
                target
                    .join("backups")
                    .join(format!("{}-files/settings.json", result.backup_id))
            )
            .unwrap(),
            b"web-settings"
        );
        assert_eq!(
            fs::read(target.join("settings.json")).unwrap(),
            b"source-settings"
        );
        let conn = db.conn.lock().unwrap();
        let source_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM providers WHERE id = 'source-provider'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let web_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM providers WHERE id = 'web-provider'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((source_count, web_count), (1, 0));
        drop(conn);
        assert_eq!(fs::read(&source_db).unwrap(), source_bytes);
        assert_eq!(
            fs::metadata(&source_db).unwrap().modified().unwrap(),
            source_modified
        );
    }
}
