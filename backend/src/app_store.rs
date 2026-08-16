use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::config::get_home_dir;
use crate::error::AppError;

const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";
const STORE_FILE_NAME: &str = "app_paths.json";

#[derive(Debug, Default, Deserialize, Serialize)]
struct AppPathStore {
    #[serde(default)]
    app_config_dir_override: Option<String>,
}

fn store_file_path() -> PathBuf {
    crate::config::get_home_dir()
        .join(".cc-switch-web")
        .join(STORE_FILE_NAME)
}

fn resolve_path(raw: &str) -> PathBuf {
    let home = get_home_dir();
    if raw == "~" {
        return home;
    } else if let Some(stripped) = raw.strip_prefix("~/") {
        return home.join(stripped);
    } else if let Some(stripped) = raw.strip_prefix("~\\") {
        return home.join(stripped);
    }

    PathBuf::from(raw)
}

fn read_store() -> Option<AppPathStore> {
    let path = store_file_path();
    if !path.exists() {
        return None;
    }

    let raw = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<AppPathStore>(&raw) {
        Ok(store) => Some(store),
        Err(error) => {
            log::warn!("无法解析 {}: {error}", path.display());
            None
        }
    }
}

pub fn get_app_config_dir_override() -> Option<PathBuf> {
    let path_str = read_store()?.app_config_dir_override?;
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = resolve_path(trimmed);
    if crate::config::is_cc_switch_source_path(&path) {
        log::warn!(
            "忽略指向 CC Switch 只读源目录的 {STORE_KEY_APP_CONFIG_DIR}: {}",
            path.display()
        );
        return None;
    }
    if !path.exists() {
        log::warn!(
            "{} 中配置的 {STORE_KEY_APP_CONFIG_DIR} 不存在: {}",
            store_file_path().display(),
            path.display()
        );
        return None;
    }

    Some(path)
}

pub fn refresh_app_config_dir_override() -> Option<PathBuf> {
    get_app_config_dir_override()
}

pub fn set_app_config_dir_override(path: Option<&str>) -> Result<(), AppError> {
    if let Some(path) = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(resolve_path)
    {
        if crate::config::is_cc_switch_source_path(&path) {
            return Err(AppError::InvalidInput(
                "CC Switch 数据目录 ~/.cc-switch 仅允许读取，不能作为 Web 数据目录"
                    .to_string(),
            ));
        }
    }

    let store_path = store_file_path();
    if let Some(parent) = store_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let mut store = read_store().unwrap_or_default();
    store.app_config_dir_override = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let json = serde_json::to_string_pretty(&store)
        .map_err(|e| AppError::Message(format!("序列化 app path store 失败: {e}")))?;
    std::fs::write(&store_path, json).map_err(|e| AppError::io(&store_path, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    #[serial]
    fn app_store_lives_in_web_directory_and_rejects_desktop_source() {
        let home = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", home.path());
        std::fs::create_dir_all(home.path().join(".cc-switch")).unwrap();

        set_app_config_dir_override(None).unwrap();
        assert_eq!(
            store_file_path(),
            home.path().join(".cc-switch-web/app_paths.json")
        );
        assert!(store_file_path().is_file());
        assert!(set_app_config_dir_override(
            home.path().join(".cc-switch").to_str()
        )
        .is_err());

        match previous {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}
