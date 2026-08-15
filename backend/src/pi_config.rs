//! Pi 原生配置适配器。
//!
//! CC Switch 只管理 `models.json.providers` 的显式节点；`settings.json`
//! 只读默认项和会话目录，`auth.json` 永远不读写。

use crate::config::{atomic_write_private, get_home_dir};
use crate::error::AppError;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};

const MAX_PI_FILE_BYTES: u64 = 1024 * 1024;
const MISSING_REVISION: &str = "missing";
static MODELS_FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
#[cfg(test)]
static TEST_AGENT_DIR: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PiNativeDefaults {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_dir: Option<String>,
}

pub(crate) fn get_pi_agent_dir() -> Result<PathBuf, AppError> {
    #[cfg(test)]
    if let Some(path) = TEST_AGENT_DIR.lock()?.clone() {
        return require_absolute(path, "Pi test override");
    }

    if let Some(path) = crate::settings::get_pi_override_dir() {
        return require_absolute(path, "Pi settings override");
    }
    if let Some(raw) = std::env::var_os("PI_CODING_AGENT_DIR").filter(|value| !value.is_empty()) {
        let raw = raw.to_string_lossy();
        let path = if raw == "~" {
            get_home_dir()
        } else if let Some(suffix) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
            suffix
                .split(['/', '\\'])
                .filter(|part| !part.is_empty())
                .fold(get_home_dir(), |path, part| path.join(part))
        } else {
            PathBuf::from(raw.as_ref())
        };
        return require_absolute(path, "PI_CODING_AGENT_DIR");
    }
    require_absolute(get_home_dir().join(".pi").join("agent"), "Pi default")
}

fn require_absolute(path: PathBuf, source: &str) -> Result<PathBuf, AppError> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(AppError::InvalidInput(format!(
            "{source} must resolve to an absolute directory: {}",
            path.display()
        )))
    }
}

pub(crate) fn get_pi_models_path() -> Result<PathBuf, AppError> {
    Ok(get_pi_agent_dir()?.join("models.json"))
}

pub(crate) fn get_pi_settings_path() -> Result<PathBuf, AppError> {
    Ok(get_pi_agent_dir()?.join("settings.json"))
}

pub(crate) fn read_pi_native_defaults() -> Result<PiNativeDefaults, AppError> {
    let path = get_pi_settings_path()?;
    if !path.exists() {
        return Ok(PiNativeDefaults::default());
    }
    let value = read_json5_value(&path, "Pi settings")?;
    let object = value.as_object().ok_or_else(|| {
        AppError::Config(format!(
            "Pi settings root must be an object: {}",
            path.display()
        ))
    })?;
    Ok(PiNativeDefaults {
        default_provider: optional_string(object, "defaultProvider", &path)?,
        default_model: optional_string(object, "defaultModel", &path)?,
        session_dir: optional_string(object, "sessionDir", &path)?,
    })
}

pub(crate) fn read_pi_native_providers() -> Result<IndexMap<String, Value>, AppError> {
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let document = read_models_document(&path)?;
    Ok(providers(&document, &path)?
        .iter()
        .map(|(id, config)| (id.clone(), config.clone()))
        .collect())
}

pub(crate) fn read_pi_native_provider(id: &str) -> Result<Option<Value>, AppError> {
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    Ok(providers(&read_models_document(&path)?, &path)?
        .get(id)
        .cloned())
}

pub(crate) fn pi_provider_exists(id: &str) -> Result<bool, AppError> {
    Ok(read_pi_native_provider(id)?.is_some())
}

pub(crate) fn insert_pi_provider(id: &str, config: &Value) -> Result<bool, AppError> {
    validate_provider_node(id, config)?;
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let entries = providers_mut(&mut document, &path)?;
    match entries.get(id) {
        Some(current) if current == config => return Ok(false),
        Some(_) => {
            return Err(AppError::InvalidInput(format!(
                "Pi provider key '{id}' already exists in models.json"
            )))
        }
        None => {}
    }
    entries.insert(id.to_string(), config.clone());
    write_models_document(&path, &document, &expected_revision)?;
    Ok(true)
}

pub(crate) fn replace_pi_provider_if_present(
    id: &str,
    replacement: &Value,
) -> Result<Option<Value>, AppError> {
    validate_provider_node(id, replacement)?;
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let entries = providers_mut(&mut document, &path)?;
    let Some(previous) = entries.get(id).cloned() else {
        return Ok(None);
    };
    if previous != *replacement {
        entries.insert(id.to_string(), replacement.clone());
        write_models_document(&path, &document, &expected_revision)?;
    }
    Ok(Some(previous))
}

pub(crate) fn replace_pi_provider(
    id: &str,
    expected: &Value,
    replacement: &Value,
) -> Result<(), AppError> {
    validate_provider_node(id, replacement)?;
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let entries = providers_mut(&mut document, &path)?;
    let current = entries
        .get(id)
        .ok_or_else(|| AppError::Conflict(format!("Pi provider '{id}' is no longer present")))?;
    if current != expected {
        return Err(AppError::Conflict(format!(
            "Pi provider '{id}' changed outside CC Switch"
        )));
    }
    if current != replacement {
        entries.insert(id.to_string(), replacement.clone());
        write_models_document(&path, &document, &expected_revision)?;
    }
    Ok(())
}

pub(crate) fn remove_pi_provider(id: &str) -> Result<Option<Value>, AppError> {
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let removed = providers_mut(&mut document, &path)?.remove(id);
    if removed.is_some() {
        write_models_document(&path, &document, &expected_revision)?;
    }
    Ok(removed)
}

pub(crate) fn remove_pi_provider_if_matches(id: &str, expected: &Value) -> Result<bool, AppError> {
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let entries = providers_mut(&mut document, &path)?;
    let Some(current) = entries.get(id) else {
        return Ok(false);
    };
    if current != expected {
        return Err(AppError::Conflict(format!(
            "Pi provider '{id}' changed outside CC Switch"
        )));
    }
    entries.remove(id);
    write_models_document(&path, &document, &expected_revision)?;
    Ok(true)
}

pub(crate) fn restore_pi_provider_if_missing(id: &str, config: &Value) -> Result<(), AppError> {
    let _guard = lock_models_file()?;
    let path = get_pi_models_path()?;
    let (mut document, expected_revision) = read_models_document_with_revision(&path)?;
    let entries = providers_mut(&mut document, &path)?;
    match entries.get(id) {
        Some(current) if current == config => return Ok(()),
        Some(_) => {
            return Err(AppError::Conflict(format!(
                "cannot restore Pi provider '{id}' because the key is occupied"
            )))
        }
        None => {}
    }
    entries.insert(id.to_string(), config.clone());
    write_models_document(&path, &document, &expected_revision)
}

pub(crate) fn validate_provider_node(id: &str, config: &Value) -> Result<(), AppError> {
    if id.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Pi provider key cannot be empty".to_string(),
        ));
    }
    if !config.is_object() {
        return Err(AppError::InvalidInput(
            "Pi provider configuration must be an object".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn provider_base_url(config: &Value) -> Result<String, AppError> {
    let provider = config.as_object().ok_or_else(|| {
        AppError::InvalidInput("Pi provider configuration must be an object".to_string())
    })?;
    provider
        .get("baseUrl")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            provider
                .get("models")
                .and_then(Value::as_array)
                .and_then(|models| {
                    models.iter().find_map(|model| {
                        model
                            .get("baseUrl")
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                    })
                })
        })
        .map(str::to_string)
        .ok_or_else(|| AppError::InvalidInput("Pi provider has no request URL".to_string()))
}

fn lock_models_file() -> Result<MutexGuard<'static, ()>, AppError> {
    MODELS_FILE_LOCK.lock().map_err(AppError::from)
}

fn read_models_document(path: &Path) -> Result<Value, AppError> {
    read_models_document_with_revision(path).map(|(document, _)| document)
}

fn read_models_document_with_revision(path: &Path) -> Result<(Value, String), AppError> {
    if !path.exists() {
        return Ok((Value::Object(Map::new()), MISSING_REVISION.to_string()));
    }
    let bytes = read_file_limited(path, "Pi models")?;
    let revision = revision(&bytes);
    Ok((parse_json5_value(path, "Pi models", bytes)?, revision))
}

fn read_json5_value(path: &Path, label: &str) -> Result<Value, AppError> {
    parse_json5_value(path, label, read_file_limited(path, label)?)
}

fn read_file_limited(path: &Path, label: &str) -> Result<Vec<u8>, AppError> {
    let file = fs::File::open(path).map_err(|error| AppError::io(path, error))?;
    let length = file
        .metadata()
        .map_err(|error| AppError::io(path, error))?
        .len();
    if length > MAX_PI_FILE_BYTES {
        return Err(AppError::InvalidInput(format!(
            "{label} file exceeds the 1 MiB limit: {}",
            path.display()
        )));
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(MAX_PI_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| AppError::io(path, error))?;
    if bytes.len() as u64 > MAX_PI_FILE_BYTES {
        return Err(AppError::InvalidInput(format!(
            "{label} file exceeds the 1 MiB limit: {}",
            path.display()
        )));
    }
    Ok(bytes)
}

fn parse_json5_value(path: &Path, label: &str, bytes: Vec<u8>) -> Result<Value, AppError> {
    let source = String::from_utf8(bytes).map_err(|error| {
        AppError::Config(format!(
            "{label} must be UTF-8 ({}): {error}",
            path.display()
        ))
    })?;
    json5::from_str(&source).map_err(|error| {
        AppError::Config(format!(
            "{label} is not valid JSON/JSONC ({}): {error}",
            path.display()
        ))
    })
}

fn providers<'a>(document: &'a Value, path: &Path) -> Result<&'a Map<String, Value>, AppError> {
    let root = document.as_object().ok_or_else(|| {
        AppError::Config(format!(
            "Pi models root must be an object: {}",
            path.display()
        ))
    })?;
    match root.get("providers") {
        None => Ok(empty_object()),
        Some(Value::Object(entries)) => Ok(entries),
        Some(_) => Err(AppError::Config(format!(
            "Pi models 'providers' must be an object: {}",
            path.display()
        ))),
    }
}

fn providers_mut<'a>(
    document: &'a mut Value,
    path: &Path,
) -> Result<&'a mut Map<String, Value>, AppError> {
    let root = document.as_object_mut().ok_or_else(|| {
        AppError::Config(format!(
            "Pi models root must be an object: {}",
            path.display()
        ))
    })?;
    root.entry("providers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            AppError::Config(format!(
                "Pi models 'providers' must be an object: {}",
                path.display()
            ))
        })
}

fn empty_object() -> &'static Map<String, Value> {
    static EMPTY: LazyLock<Map<String, Value>> = LazyLock::new(Map::new);
    &EMPTY
}

fn write_models_document(
    path: &Path,
    document: &Value,
    expected_revision: &str,
) -> Result<(), AppError> {
    let mut bytes =
        serde_json::to_vec_pretty(document).map_err(|source| AppError::JsonSerialize { source })?;
    bytes.push(b'\n');
    ensure_private_parent(path)?;
    ensure_revision(path, expected_revision)?;
    atomic_write_private(path, &bytes)
}

fn ensure_revision(path: &Path, expected: &str) -> Result<(), AppError> {
    let actual = if path.exists() {
        revision(&read_file_limited(path, "Pi models")?)
    } else {
        MISSING_REVISION.to_string()
    };
    if actual == expected {
        Ok(())
    } else {
        Err(AppError::Conflict(format!(
            "Pi models.json changed outside CC Switch: {}",
            path.display()
        )))
    }
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn ensure_private_parent(path: &Path) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| {
        AppError::Config(format!("Pi models path has no parent: {}", path.display()))
    })?;
    let created = !parent.exists();
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    #[cfg(not(unix))]
    let _ = created;
    #[cfg(unix)]
    if created {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|error| AppError::io(parent, error))?;
    }
    Ok(())
}

fn optional_string(
    object: &Map<String, Value>,
    key: &str,
    path: &Path,
) -> Result<Option<String>, AppError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(AppError::Config(format!(
            "Pi settings '{key}' must be a string: {}",
            path.display()
        ))),
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::PathBuf;

    pub(crate) struct TestAgentDir {
        _dir: tempfile::TempDir,
        previous: Option<PathBuf>,
    }

    impl TestAgentDir {
        pub(crate) fn new() -> Self {
            let dir = tempfile::tempdir().expect("create Pi test directory");
            let previous = super::TEST_AGENT_DIR
                .lock()
                .expect("lock Pi test directory")
                .replace(dir.path().join("agent"));
            Self {
                _dir: dir,
                previous,
            }
        }
    }

    impl Drop for TestAgentDir {
        fn drop(&mut self) {
            *super::TEST_AGENT_DIR
                .lock()
                .expect("lock Pi test directory") = self.previous.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;

    fn provider() -> Value {
        json!({
            "name": "Example",
            "baseUrl": "https://api.example.com/v1",
            "apiKey": "secret",
            "futureField": { "keep": true }
        })
    }

    #[test]
    #[serial]
    fn target_updates_preserve_unknown_fields_and_other_nodes() {
        let _agent = test_support::TestAgentDir::new();
        let path = get_pi_models_path().expect("models path");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"defaultModel":"keep","providers":{"other":{"x":1}}}"#,
        )
        .unwrap();

        insert_pi_provider("example", &provider()).expect("insert provider");
        let document: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(document["defaultModel"], "keep");
        assert_eq!(document["providers"]["other"]["x"], 1);

        let removed = remove_pi_provider("example").expect("remove provider");
        assert_eq!(removed, Some(provider()));
        assert_eq!(
            read_pi_native_provider("other").unwrap(),
            Some(json!({"x": 1}))
        );
    }

    #[test]
    fn explicit_builtin_ids_and_unknown_fields_are_valid() {
        validate_provider_node("anthropic", &json!({})).expect("builtin override");
        validate_provider_node("deepseek", &provider()).expect("unknown fields");
        assert!(validate_provider_node("", &json!({})).is_err());
        assert!(validate_provider_node("openai", &json!("invalid")).is_err());
    }
}
