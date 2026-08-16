//! Skills 命令层
//!
//! v3.10.0+ 统一管理架构：
//! - 支持三应用开关（Claude/Codex/Gemini）
//! - SSOT 存储在 ~/.cc-switch-web/skills/

use crate::app_config::{AppType, InstalledSkill, UnmanagedSkill};
use crate::services::skill::{
    DiscoverableSkill, ImportSkillSelection, MigrationResult, SkillBackupEntry, SkillRepo,
    SkillService, SkillStorageLocation, SkillUninstallResult, SkillUpdateInfo,
    SkillsShSearchResult,
};
use crate::store::AppState;
use std::path::Path;

/// 解析 app 参数为 AppType
fn parse_app_type(app: &str) -> Result<AppType, String> {
    match app.to_lowercase().as_str() {
        "claude" => Ok(AppType::Claude),
        "codex" => Ok(AppType::Codex),
        "gemini" => Ok(AppType::Gemini),
        "opencode" => Ok(AppType::OpenCode),
        "openclaw" => Ok(AppType::OpenClaw),
        _ => Err(format!("不支持的 app 类型: {app}")),
    }
}

// ========== 统一管理命令 ==========

pub(crate) fn get_installed_skills_internal(app_state: &AppState) -> Result<Vec<InstalledSkill>, String> {
    SkillService::get_all_installed(&app_state.db).map_err(|e| e.to_string())
}

pub(crate) fn get_skill_backups_internal() -> Result<Vec<SkillBackupEntry>, String> {
    SkillService::list_backups().map_err(|e| e.to_string())
}

pub(crate) fn delete_skill_backup_internal(backup_id: String) -> Result<bool, String> {
    SkillService::delete_backup(&backup_id).map_err(|e| e.to_string())?;
    Ok(true)
}

pub(crate) fn uninstall_skill_unified_internal(
    app_state: &AppState,
    id: String,
) -> Result<SkillUninstallResult, String> {
    SkillService::uninstall(&app_state.db, &id).map_err(|e| e.to_string())
}

pub(crate) fn restore_skill_backup_internal(
    app_state: &AppState,
    backup_id: String,
    current_app: String,
) -> Result<InstalledSkill, String> {
    let app_type = parse_app_type(&current_app)?;
    SkillService::restore_from_backup(&app_state.db, &backup_id, &app_type)
        .map_err(|e| e.to_string())
}

pub(crate) fn toggle_skill_app_internal(
    app_state: &AppState,
    id: String,
    app: String,
    enabled: bool,
) -> Result<bool, String> {
    let app_type = parse_app_type(&app)?;
    SkillService::toggle_app(&app_state.db, &id, &app_type, enabled).map_err(|e| e.to_string())?;
    Ok(true)
}

pub(crate) fn scan_unmanaged_skills_internal(
    app_state: &AppState,
) -> Result<Vec<UnmanagedSkill>, String> {
    SkillService::scan_unmanaged(&app_state.db).map_err(|e| e.to_string())
}

pub(crate) fn import_skills_from_apps_internal(
    app_state: &AppState,
    imports: Vec<ImportSkillSelection>,
) -> Result<Vec<InstalledSkill>, String> {
    SkillService::import_from_apps(&app_state.db, imports).map_err(|e| e.to_string())
}

pub(crate) async fn install_skill_unified_internal(
    app_state: &AppState,
    skill: DiscoverableSkill,
    current_app: String,
) -> Result<InstalledSkill, String> {
    let app_type = parse_app_type(&current_app)?;
    SkillService::new()
        .install(&app_state.db, &skill, &app_type)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn install_skills_from_zip_internal(
    app_state: &AppState,
    zip_path: &Path,
    current_app: String,
) -> Result<Vec<InstalledSkill>, String> {
    let app_type = parse_app_type(&current_app)?;
    SkillService::install_from_zip(&app_state.db, zip_path, &app_type).map_err(|e| e.to_string())
}

// ========== 发现功能命令 ==========

pub(crate) async fn discover_available_skills_internal(
    app_state: &AppState,
) -> Result<Vec<DiscoverableSkill>, String> {
    let repos = app_state.db.get_skill_repos().map_err(|e| e.to_string())?;
    SkillService::new()
        .discover_available(repos)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn check_skill_updates_internal(
    app_state: &AppState,
) -> Result<Vec<SkillUpdateInfo>, String> {
    SkillService::new()
        .check_updates(&app_state.db)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn update_skill_internal(
    app_state: &AppState,
    id: String,
) -> Result<InstalledSkill, String> {
    SkillService::new()
        .update_skill(&app_state.db, &id)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn migrate_skill_storage_internal(
    app_state: &AppState,
    target: SkillStorageLocation,
) -> Result<MigrationResult, String> {
    SkillService::migrate_storage(&app_state.db, target).map_err(|e| e.to_string())
}

pub(crate) async fn search_skills_sh_internal(
    query: String,
    limit: usize,
    offset: usize,
) -> Result<SkillsShSearchResult, String> {
    SkillService::search_skills_sh(&query, limit, offset)
        .await
        .map_err(|e| e.to_string())
}

// ========== 仓库管理命令 ==========

pub(crate) fn get_skill_repos_internal(app_state: &AppState) -> Result<Vec<SkillRepo>, String> {
    app_state.db.get_skill_repos().map_err(|e| e.to_string())
}

pub(crate) fn add_skill_repo_internal(app_state: &AppState, repo: SkillRepo) -> Result<bool, String> {
    SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch)
        .map_err(|e| e.to_string())?;
    app_state
        .db
        .save_skill_repo(&repo)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub(crate) fn remove_skill_repo_internal(
    app_state: &AppState,
    owner: String,
    name: String,
) -> Result<bool, String> {
    app_state
        .db
        .delete_skill_repo(&owner, &name)
        .map_err(|e| e.to_string())?;
    Ok(true)
}
