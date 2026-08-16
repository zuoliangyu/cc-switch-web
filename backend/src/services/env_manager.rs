use super::env_checker::EnvConflict;
use crate::config::get_app_config_dir;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub backup_path: String,
    pub timestamp: String,
    pub conflicts: Vec<EnvConflict>,
}

pub fn delete_env_vars(conflicts: Vec<EnvConflict>) -> Result<BackupInfo, String> {
    let backup_info = create_backup(&conflicts)?;

    for conflict in &conflicts {
        delete_single_env(conflict).map_err(|error| {
            format!(
                "删除环境变量失败: {}. 备份已保存到: {}",
                error, backup_info.backup_path
            )
        })?;
    }

    Ok(backup_info)
}

pub fn restore_from_backup(backup_path: String) -> Result<(), String> {
    let content =
        fs::read_to_string(&backup_path).map_err(|error| format!("读取备份文件失败: {error}"))?;
    let backup_info: BackupInfo =
        serde_json::from_str(&content).map_err(|error| format!("解析备份文件失败: {error}"))?;

    for conflict in &backup_info.conflicts {
        restore_single_env(conflict)?;
    }

    Ok(())
}

fn create_backup(conflicts: &[EnvConflict]) -> Result<BackupInfo, String> {
    let backup_dir = get_app_config_dir().join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| format!("创建备份目录失败: {error}"))?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_file = backup_dir.join(format!("env-backup-{timestamp}.json"));
    let backup_info = BackupInfo {
        backup_path: backup_file.to_string_lossy().to_string(),
        timestamp,
        conflicts: conflicts.to_vec(),
    };

    let json = serde_json::to_string_pretty(&backup_info)
        .map_err(|error| format!("序列化备份数据失败: {error}"))?;
    fs::write(&backup_file, json).map_err(|error| format!("写入备份文件失败: {error}"))?;

    Ok(backup_info)
}

#[cfg(target_os = "windows")]
fn delete_single_env(conflict: &EnvConflict) -> Result<(), String> {
    if conflict.source_type != "system" {
        return Err(format!("未知的环境变量来源类型: {}", conflict.source_type));
    }

    if conflict.source_path.contains("HKEY_CURRENT_USER") {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Environment", KEY_ALL_ACCESS)
            .map_err(|error| format!("打开注册表失败: {error}"))?;
        hkcu.delete_value(&conflict.var_name)
            .map_err(|error| format!("删除注册表项失败: {error}"))?;
        return Ok(());
    }

    if conflict.source_path.contains("HKEY_LOCAL_MACHINE") {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(
                "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
                KEY_ALL_ACCESS,
            )
            .map_err(|error| format!("打开系统注册表失败 (需要管理员权限): {error}"))?;
        hklm.delete_value(&conflict.var_name)
            .map_err(|error| format!("删除系统注册表项失败: {error}"))?;
        return Ok(());
    }

    Err(format!("未知的环境变量来源路径: {}", conflict.source_path))
}

#[cfg(not(target_os = "windows"))]
fn delete_single_env(conflict: &EnvConflict) -> Result<(), String> {
    match conflict.source_type.as_str() {
        "file" => {
            let file_path = conflict
                .source_path
                .split(':')
                .next()
                .ok_or("无效的文件路径格式")?;
            let content = fs::read_to_string(file_path)
                .map_err(|error| format!("读取文件失败 {file_path}: {error}"))?;
            let filtered = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim();
                    let export_line = trimmed.strip_prefix("export ").unwrap_or(trimmed);
                    export_line
                        .find('=')
                        .map(|eq_pos| export_line[..eq_pos].trim() != conflict.var_name)
                        .unwrap_or(true)
                })
                .collect::<Vec<_>>()
                .join("\n");
            fs::write(file_path, filtered)
                .map_err(|error| format!("写入文件失败 {file_path}: {error}"))?;
            Ok(())
        }
        "system" => Ok(()),
        _ => Err(format!("未知的环境变量来源类型: {}", conflict.source_type)),
    }
}

#[cfg(target_os = "windows")]
fn restore_single_env(conflict: &EnvConflict) -> Result<(), String> {
    if conflict.source_type != "system" {
        return Err(format!("无法恢复类型为 {} 的环境变量", conflict.source_type));
    }

    if conflict.source_path.contains("HKEY_CURRENT_USER") {
        let (hkcu, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey("Environment")
            .map_err(|error| format!("打开注册表失败: {error}"))?;
        hkcu.set_value(&conflict.var_name, &conflict.var_value)
            .map_err(|error| format!("恢复注册表项失败: {error}"))?;
        return Ok(());
    }

    if conflict.source_path.contains("HKEY_LOCAL_MACHINE") {
        let (hklm, _) = RegKey::predef(HKEY_LOCAL_MACHINE)
            .create_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
            .map_err(|error| format!("打开系统注册表失败 (需要管理员权限): {error}"))?;
        hklm.set_value(&conflict.var_name, &conflict.var_value)
            .map_err(|error| format!("恢复系统注册表项失败: {error}"))?;
        return Ok(());
    }

    Err(format!("未知的环境变量来源路径: {}", conflict.source_path))
}

#[cfg(not(target_os = "windows"))]
fn restore_single_env(conflict: &EnvConflict) -> Result<(), String> {
    if conflict.source_type != "file" {
        return Err(format!("无法恢复类型为 {} 的环境变量", conflict.source_type));
    }

    let file_path = conflict
        .source_path
        .split(':')
        .next()
        .ok_or("无效的文件路径格式")?;
    let mut content = fs::read_to_string(file_path)
        .map_err(|error| format!("读取文件失败 {file_path}: {error}"))?;
    content.push_str(&format!("\nexport {}={}", conflict.var_name, conflict.var_value));
    fs::write(file_path, content).map_err(|error| format!("写入文件失败 {file_path}: {error}"))?;
    Ok(())
}
