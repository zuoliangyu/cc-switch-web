use crate::config::{atomic_write, get_home_dir};
use crate::error::AppError;
use crate::settings::get_hermes_override_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const PROVIDER_SOURCE_FIELD: &str = "_cc_source";
pub const PROVIDER_SOURCE_CUSTOM_LIST: &str = "custom_providers";
pub const PROVIDER_SOURCE_DICT: &str = "providers_dict";

static HERMES_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn hermes_write_guard() -> Result<MutexGuard<'static, ()>, AppError> {
    HERMES_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| AppError::Message("Hermes config write lock is poisoned".to_string()))
}

pub fn get_hermes_dir() -> PathBuf {
    if let Some(override_dir) = get_hermes_override_dir() {
        return override_dir;
    }

    get_default_hermes_dir()
}

pub fn get_default_hermes_dir() -> PathBuf {
    get_home_dir().join(".hermes")
}

fn get_hermes_config_path() -> PathBuf {
    get_hermes_dir().join("config.yaml")
}

fn memories_dir() -> PathBuf {
    get_hermes_dir().join("memories")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryKind {
    Memory,
    User,
}

impl MemoryKind {
    fn filename(self) -> &'static str {
        match self {
            Self::Memory => "MEMORY.md",
            Self::User => "USER.md",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesMemoryLimits {
    pub memory: usize,
    pub user: usize,
    pub memory_enabled: bool,
    pub user_enabled: bool,
}

impl Default for HermesMemoryLimits {
    fn default() -> Self {
        Self {
            memory: 2200,
            user: 1375,
            memory_enabled: true,
            user_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HermesHealthWarning {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HermesModelConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "baseUrl",
        alias = "base_url"
    )]
    pub base_url: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "contextLength",
        alias = "context_length"
    )]
    pub context_length: Option<u64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "maxTokens",
        alias = "max_tokens"
    )]
    pub max_tokens: Option<u64>,
}

fn read_hermes_config() -> Result<serde_yaml::Value, AppError> {
    let path = get_hermes_config_path();
    if !path.exists() {
        return Ok(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
    }

    let content = fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
    if content.trim().is_empty() {
        return Ok(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
    }

    serde_yaml::from_str(&content)
        .map_err(|e| AppError::Config(format!("Failed to parse Hermes config as YAML: {e}")))
}

pub fn scan_hermes_config_health() -> Result<Vec<HermesHealthWarning>, AppError> {
    let path = get_hermes_config_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
    Ok(scan_hermes_health_internal(&content))
}

pub fn get_model_config() -> Result<Option<HermesModelConfig>, AppError> {
    let config = read_hermes_config()?;
    let Some(model_value) = config.get("model") else {
        return Ok(None);
    };

    let model = serde_yaml::from_value::<HermesModelConfig>(model_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse Hermes model config: {e}")))?;
    Ok(Some(model))
}

pub fn get_live_provider_ids() -> Result<Vec<String>, AppError> {
    Ok(get_providers()?.keys().cloned().collect())
}

fn provider_models_to_yaml_dict(models: Vec<serde_json::Value>) -> serde_json::Value {
    let mut mapped = serde_json::Map::new();
    for model in models {
        let Some(mut object) = model.as_object().cloned() else {
            continue;
        };
        let Some(id) = object
            .remove("id")
            .and_then(|value| value.as_str().map(str::trim).map(str::to_string))
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        object.remove("name");
        mapped.insert(id, serde_json::Value::Object(object));
    }
    serde_json::Value::Object(mapped)
}

fn provider_models_to_ui_array(
    models: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    let mut entries = Vec::with_capacity(models.len());
    for (id, value) in models {
        let mut object = value.as_object().cloned().unwrap_or_default();
        object.insert("id".to_string(), serde_json::Value::String(id));
        entries.push(serde_json::Value::Object(object));
    }
    serde_json::Value::Array(entries)
}

fn normalize_provider_for_write(
    name: &str,
    mut provider: serde_json::Value,
) -> Result<serde_yaml::Value, AppError> {
    let object = provider.as_object_mut().ok_or_else(|| {
        AppError::Config("Hermes provider configuration must be an object".to_string())
    })?;
    for (legacy, current) in [
        ("baseUrl", "base_url"),
        ("apiKey", "api_key"),
        ("apiMode", "api_mode"),
        ("contextLength", "context_length"),
    ] {
        if let Some(value) = object.remove(legacy) {
            object.entry(current.to_string()).or_insert(value);
        }
    }
    for internal in [PROVIDER_SOURCE_FIELD, "provider_key", "api"] {
        object.remove(internal);
    }
    if let Some(serde_json::Value::Array(models)) = object.remove("models") {
        object.insert("models".to_string(), provider_models_to_yaml_dict(models));
    }
    object.insert(
        "name".to_string(),
        serde_json::Value::String(name.to_string()),
    );
    let first_model = object
        .get("models")
        .and_then(serde_json::Value::as_object)
        .and_then(|models| models.keys().next())
        .cloned();
    match first_model {
        Some(model) => {
            object.insert("model".to_string(), serde_json::Value::String(model));
        }
        None => {
            object.remove("model");
        }
    }
    serde_yaml::to_value(provider)
        .map_err(|error| AppError::Config(format!("Failed to serialize Hermes provider: {error}")))
}

fn normalize_provider_for_read(
    provider: &serde_yaml::Value,
    source: &str,
) -> Result<serde_json::Value, AppError> {
    let mut value = serde_json::to_value(provider)
        .map_err(|error| AppError::Config(format!("Failed to parse Hermes provider: {error}")))?;
    let object = value.as_object_mut().ok_or_else(|| {
        AppError::Config("Hermes provider configuration must be an object".to_string())
    })?;
    if let Some(serde_json::Value::Object(models)) = object.remove("models") {
        object.insert("models".to_string(), provider_models_to_ui_array(models));
    }
    object.remove("model");
    object.insert(
        PROVIDER_SOURCE_FIELD.to_string(),
        serde_json::Value::String(source.to_string()),
    );
    Ok(value)
}

fn dict_only_provider(config: &serde_yaml::Value, name: &str) -> bool {
    let in_custom = config
        .get("custom_providers")
        .and_then(serde_yaml::Value::as_sequence)
        .is_some_and(|providers| {
            providers.iter().any(|provider| {
                provider.get("name").and_then(serde_yaml::Value::as_str) == Some(name)
            })
        });
    !in_custom
        && config
            .get("providers")
            .and_then(serde_yaml::Value::as_mapping)
            .is_some_and(|providers| {
                providers.iter().any(|(key, provider)| {
                    key.as_str() == Some(name)
                        || provider.get("name").and_then(serde_yaml::Value::as_str) == Some(name)
                })
            })
}

pub fn get_providers() -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    let config = read_hermes_config()?;
    let mut providers = serde_json::Map::new();
    if let Some(custom) = config
        .get("custom_providers")
        .and_then(serde_yaml::Value::as_sequence)
    {
        for provider in custom {
            let Some(name) = provider.get("name").and_then(yaml_as_non_empty_str) else {
                continue;
            };
            providers.insert(
                name.to_string(),
                normalize_provider_for_read(provider, PROVIDER_SOURCE_CUSTOM_LIST)?,
            );
        }
    }
    if let Some(overlays) = config
        .get("providers")
        .and_then(serde_yaml::Value::as_mapping)
    {
        for (key, provider) in overlays {
            let Some(key) = key.as_str().map(str::trim).filter(|key| !key.is_empty()) else {
                continue;
            };
            let name = provider
                .get("name")
                .and_then(yaml_as_non_empty_str)
                .unwrap_or(key);
            if providers.contains_key(name) || !provider.is_mapping() {
                continue;
            }
            let mut normalized = normalize_provider_for_read(provider, PROVIDER_SOURCE_DICT)?;
            if let Some(object) = normalized.as_object_mut() {
                object.insert(
                    "name".to_string(),
                    serde_json::Value::String(name.to_string()),
                );
                object.insert(
                    "provider_key".to_string(),
                    serde_json::Value::String(key.to_string()),
                );
            }
            providers.insert(name.to_string(), normalized);
        }
    }
    Ok(providers)
}

pub fn set_provider(name: &str, provider_config: serde_json::Value) -> Result<(), AppError> {
    let _guard = hermes_write_guard()?;
    let config = read_hermes_config()?;
    if dict_only_provider(&config, name) {
        return Err(AppError::Config(format!(
            "Provider '{name}' is managed by Hermes' providers map; edit it in Hermes Web UI"
        )));
    }
    let mut providers = config
        .get("custom_providers")
        .and_then(serde_yaml::Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let mut normalized = normalize_provider_for_write(name, provider_config)?;
    if let Some(existing) = providers
        .iter_mut()
        .find(|provider| provider.get("name").and_then(serde_yaml::Value::as_str) == Some(name))
    {
        if let (Some(previous), Some(next)) = (existing.as_mapping(), normalized.as_mapping_mut()) {
            for (key, value) in previous {
                next.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        *existing = normalized;
    } else {
        providers.push(normalized);
    }
    write_yaml_section_to_config_locked("custom_providers", &serde_yaml::Value::Sequence(providers))
}

pub fn remove_provider(name: &str) -> Result<(), AppError> {
    let removed_title_model = get_providers()?
        .get(name)
        .and_then(declared_title_generation_model)
        .map(String::from);
    {
        let _guard = hermes_write_guard()?;
        let config = read_hermes_config()?;
        if dict_only_provider(&config, name) {
            return Err(AppError::Config(format!(
                "Provider '{name}' is managed by Hermes' providers map; remove it in Hermes Web UI"
            )));
        }
        let mut providers = config
            .get("custom_providers")
            .and_then(serde_yaml::Value::as_sequence)
            .cloned()
            .unwrap_or_default();
        let previous_len = providers.len();
        providers.retain(|provider| {
            provider.get("name").and_then(serde_yaml::Value::as_str) != Some(name)
        });
        if providers.len() == previous_len {
            return Ok(());
        }
        write_yaml_section_to_config_locked(
            "custom_providers",
            &serde_yaml::Value::Sequence(providers),
        )?;
    }

    // 删掉的卡可能是唯一声明当前标题模型钉选的那张；当前那家仍要这个模型时保留，否则放开
    if let Some(removed) = removed_title_model {
        let active = active_provider_settings()?;
        let wanted = active.as_ref().and_then(declared_title_generation_model);
        if let Err(e) = sync_title_generation_model(wanted, Some(&removed)) {
            log::warn!("Failed to release Hermes auxiliary.title_generation.model: {e}");
        }
    }
    Ok(())
}

/// Hermes `model.provider` 指向的那张卡（按名称或 `provider_key` 找）
fn active_provider_settings() -> Result<Option<serde_json::Value>, AppError> {
    let Some(active) = get_model_config()?.and_then(|model| model.provider) else {
        return Ok(None);
    };
    let providers = get_providers()?;
    if let Some(provider) = providers.get(&active) {
        return Ok(Some(provider.clone()));
    }
    Ok(providers
        .values()
        .find(|provider| {
            provider
                .get("provider_key")
                .and_then(serde_json::Value::as_str)
                == Some(&active)
        })
        .cloned())
}

pub fn apply_switch_defaults(
    provider_id: &str,
    settings_config: &serde_json::Value,
) -> Result<(), AppError> {
    write_switch_model_defaults(provider_id, settings_config)?;
    let wanted = declared_title_generation_model(settings_config);
    if let Err(e) = sync_title_generation_model(wanted, None) {
        log::warn!("Failed to sync Hermes auxiliary.title_generation.model: {e}");
    }
    Ok(())
}

fn write_switch_model_defaults(
    provider_id: &str,
    settings_config: &serde_json::Value,
) -> Result<(), AppError> {
    let _guard = hermes_write_guard()?;
    let config = read_hermes_config()?;
    let mut model = config
        .get("model")
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    model.insert(
        serde_yaml::Value::String("provider".to_string()),
        serde_yaml::Value::String(
            settings_config
                .get("provider_key")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|key| !key.is_empty())
                .unwrap_or(provider_id)
                .to_string(),
        ),
    );
    if let Some(default_model) = settings_config
        .get("models")
        .and_then(serde_json::Value::as_array)
        .and_then(|models| models.first())
        .and_then(|model| model.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        model.insert(
            serde_yaml::Value::String("default".to_string()),
            serde_yaml::Value::String(default_model.to_string()),
        );
    }
    write_yaml_section_to_config_locked("model", &serde_yaml::Value::Mapping(model))
}

/// 供应商卡声明的 `title_generation_model`（例如 MiniMax 卡写 M3）
fn declared_title_generation_model(provider: &serde_json::Value) -> Option<&str> {
    provider
        .get("title_generation_model")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

/// 把 `auxiliary.title_generation.model` 钉成当前那家声明的模型（MiniMax M3.1 不接受
/// Hermes 标题请求带的 `reasoning_effort: none`，标题改用接受它的模型），`wanted` 为空时放开。
///
/// 只动 CC Switch 可能写过的钉选：当前值为空，或等于某张卡声明的值（或正在删除的那张卡
/// 声明的 `released`）。用户自己选的标题模型、指向自己供应商 / 地址的标题路由都不碰。
fn sync_title_generation_model(
    wanted: Option<&str>,
    released: Option<&str>,
) -> Result<(), AppError> {
    let _guard = hermes_write_guard()?;
    let config = read_hermes_config()?;
    let mut aux = config
        .get("auxiliary")
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    let k_title = serde_yaml::Value::from("title_generation");
    let mut title = aux
        .get(&k_title)
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    let text = |key: &str| {
        title
            .get(key)
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from)
    };
    if text("provider").is_some_and(|provider| provider != "auto") || text("base_url").is_some() {
        return Ok(());
    }
    let current = text("model");
    let owned = |model: &str| -> Result<bool, AppError> {
        Ok(released == Some(model)
            || get_providers()?
                .values()
                .any(|provider| declared_title_generation_model(provider) == Some(model)))
    };
    let next = match (wanted, current.as_deref()) {
        (Some(w), Some(cur)) if w == cur => return Ok(()),
        (Some(w), None) => Some(w),
        (Some(w), Some(cur)) if owned(cur)? => Some(w),
        (None, Some(cur)) if owned(cur)? => None,
        _ => return Ok(()),
    };
    let k_model = serde_yaml::Value::from("model");
    match next {
        Some(model) => {
            title.insert(k_model, serde_yaml::Value::from(model));
        }
        None => {
            title.remove(&k_model);
        }
    }
    if title.is_empty() {
        aux.remove(&k_title);
    } else {
        aux.insert(k_title, serde_yaml::Value::Mapping(title));
    }
    write_yaml_section_to_config_locked("auxiliary", &serde_yaml::Value::Mapping(aux))
}

fn scan_hermes_health_internal(content: &str) -> Vec<HermesHealthWarning> {
    let mut warnings = Vec::new();

    if content.trim().is_empty() {
        return warnings;
    }

    let config = match serde_yaml::from_str::<serde_yaml::Value>(content) {
        Ok(value) => value,
        Err(error) => {
            warnings.push(hermes_warning(
                "config_parse_failed",
                format!("Hermes config could not be parsed as YAML: {error}"),
                Some(get_hermes_config_path().display().to_string()),
            ));
            return warnings;
        }
    };

    if let Some(model) = config.get("model") {
        if model.get("default").is_none() && model.get("provider").is_none() {
            warnings.push(hermes_warning(
                "model_no_default",
                "No default model or provider configured in 'model' section".to_string(),
                Some("model".to_string()),
            ));
        }
    }

    if config
        .get("custom_providers")
        .and_then(|value| value.as_mapping())
        .is_some()
    {
        warnings.push(hermes_warning(
            "custom_providers_not_list",
            "custom_providers should be a YAML list (sequence), not a mapping".to_string(),
            Some("custom_providers".to_string()),
        ));
    }

    let mut provider_models: HashMap<String, Vec<String>> = HashMap::new();
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    let mut base_url_counts: HashMap<String, usize> = HashMap::new();

    if let Some(sequence) = config
        .get("custom_providers")
        .and_then(|value| value.as_sequence())
    {
        for item in sequence {
            if let Some(name) = item.get("name").and_then(yaml_as_non_empty_str) {
                *name_counts.entry(name.to_string()).or_insert(0) += 1;
                if let Some(models) = item.get("models").and_then(|value| value.as_mapping()) {
                    provider_models
                        .entry(name.to_string())
                        .or_insert_with(|| collect_mapping_string_keys(models));
                }
            }

            if let Some(base_url) = item
                .get("base_url")
                .and_then(yaml_as_non_empty_str)
                .map(|value| value.trim_end_matches('/').to_lowercase())
                .filter(|value| !value.is_empty())
            {
                *base_url_counts.entry(base_url).or_insert(0) += 1;
            }
        }
    }

    for (name, count) in &name_counts {
        if *count > 1 {
            warnings.push(hermes_warning(
                "duplicate_provider_name",
                format!(
                    "Duplicate provider name '{name}' in custom_providers; only one entry will be used"
                ),
                Some("custom_providers".to_string()),
            ));
        }
    }

    for (base_url, count) in &base_url_counts {
        if *count > 1 {
            warnings.push(hermes_warning(
                "duplicate_provider_base_url",
                format!(
                    "Duplicate base_url '{base_url}' in custom_providers; possible accidental copy"
                ),
                Some("custom_providers".to_string()),
            ));
        }
    }

    if let Some(model) = config.get("model") {
        if let Some(provider_ref) = model.get("provider").and_then(yaml_as_non_empty_str) {
            if !name_counts.contains_key(provider_ref) {
                warnings.push(hermes_warning(
                    "model_provider_unknown",
                    format!(
                        "model.provider '{provider_ref}' does not match any configured provider"
                    ),
                    Some("model.provider".to_string()),
                ));
            } else if let Some(default_model) = model.get("default").and_then(yaml_as_non_empty_str)
            {
                if let Some(model_ids) = provider_models.get(provider_ref) {
                    if !model_ids.is_empty() && !model_ids.iter().any(|id| id == default_model) {
                        warnings.push(hermes_warning(
                            "model_default_not_in_provider",
                            format!(
                                "model.default '{default_model}' is not in provider '{provider_ref}' models list"
                            ),
                            Some("model.default".to_string()),
                        ));
                    }
                }
            }
        }
    }

    let version = config
        .get("_config_version")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let providers_dict_populated = config
        .get("providers")
        .and_then(|value| value.as_mapping())
        .map(|mapping| !mapping.is_empty())
        .unwrap_or(false);
    if version >= 12 && providers_dict_populated {
        warnings.push(hermes_warning(
            "schema_migrated_v12",
            "Hermes newer schema moved some entries into the 'providers' dict; CC Switch currently treats them as read-only".to_string(),
            Some("providers".to_string()),
        ));
    }

    warnings
}

fn hermes_warning(code: &str, message: String, path: Option<String>) -> HermesHealthWarning {
    HermesHealthWarning {
        code: code.to_string(),
        message,
        path,
    }
}

fn yaml_as_non_empty_str(value: &serde_yaml::Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn collect_mapping_string_keys(mapping: &serde_yaml::Mapping) -> Vec<String> {
    mapping
        .keys()
        .filter_map(|key| key.as_str().map(ToString::to_string))
        .collect()
}

fn is_top_level_key_line(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    let first_char = line.as_bytes()[0];
    if matches!(first_char, b' ' | b'\t' | b'#' | b'-') {
        return false;
    }

    if let Some(colon_pos) = line.find(':') {
        let after_colon = &line[colon_pos + 1..];
        after_colon.is_empty() || after_colon.starts_with(' ') || after_colon.starts_with('\t')
    } else {
        false
    }
}

fn find_yaml_section_range(raw: &str, section_key: &str) -> Option<(usize, usize)> {
    let target = format!("{section_key}:");
    let mut section_start = None;
    let mut offset = 0;

    for line in raw.split('\n') {
        if section_start.is_none() && is_top_level_key_line(line) && line.starts_with(&target) {
            let after_target = &line[target.len()..];
            if after_target.is_empty()
                || after_target.starts_with(' ')
                || after_target.starts_with('\t')
                || after_target.starts_with('\r')
            {
                section_start = Some(offset);
            }
        } else if section_start.is_some() && is_top_level_key_line(line) {
            return Some((section_start.unwrap(), offset));
        }

        offset += line.len() + 1;
    }

    section_start.map(|start| (start, raw.len()))
}

fn serialize_yaml_section(key: &str, value: &serde_yaml::Value) -> Result<String, AppError> {
    let mut section = serde_yaml::Mapping::new();
    section.insert(serde_yaml::Value::String(key.to_string()), value.clone());
    serde_yaml::to_string(&serde_yaml::Value::Mapping(section))
        .map_err(|e| AppError::Config(format!("Failed to serialize YAML section '{key}': {e}")))
}

fn replace_yaml_section(
    raw: &str,
    section_key: &str,
    value: &serde_yaml::Value,
) -> Result<String, AppError> {
    let serialized = serialize_yaml_section(section_key, value)?;

    if let Some((start, end)) = find_yaml_section_range(raw, section_key) {
        let mut result = String::with_capacity(raw.len());
        result.push_str(&raw[..start]);
        result.push_str(&serialized);
        let remainder = &raw[end..];
        if !serialized.ends_with('\n') && !remainder.is_empty() && !remainder.starts_with('\n') {
            result.push('\n');
        }
        result.push_str(remainder);
        Ok(result)
    } else {
        let mut result = raw.to_string();
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str(&serialized);
        if !result.ends_with('\n') {
            result.push('\n');
        }
        Ok(result)
    }
}

fn write_yaml_section_to_config_locked(
    section_key: &str,
    value: &serde_yaml::Value,
) -> Result<(), AppError> {
    let path = get_hermes_config_path();
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(AppError::io(&path, error)),
    };
    let next = replace_yaml_section(&raw, section_key, value)?;
    atomic_write(&path, next.as_bytes())
}

fn write_memory_section(memory: &serde_yaml::Mapping) -> Result<(), AppError> {
    write_yaml_section_to_config_locked("memory", &serde_yaml::Value::Mapping(memory.clone()))
}

pub fn read_memory(kind: MemoryKind) -> Result<String, AppError> {
    let path = memories_dir().join(kind.filename());
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(AppError::io(&path, error)),
    }
}

pub fn write_memory(kind: MemoryKind, content: &str) -> Result<(), AppError> {
    let path = memories_dir().join(kind.filename());
    atomic_write(&path, content.as_bytes())
}

pub fn read_memory_limits() -> Result<HermesMemoryLimits, AppError> {
    let mut limits = HermesMemoryLimits::default();
    let config = read_hermes_config()?;
    let Some(memory) = config.get("memory") else {
        return Ok(limits);
    };

    if let Some(value) = memory.get("memory_char_limit").and_then(|v| v.as_u64()) {
        limits.memory = value as usize;
    }
    if let Some(value) = memory.get("user_char_limit").and_then(|v| v.as_u64()) {
        limits.user = value as usize;
    }
    if let Some(value) = memory.get("memory_enabled").and_then(|v| v.as_bool()) {
        limits.memory_enabled = value;
    }
    if let Some(value) = memory.get("user_profile_enabled").and_then(|v| v.as_bool()) {
        limits.user_enabled = value;
    }

    Ok(limits)
}

pub fn set_memory_enabled(kind: MemoryKind, enabled: bool) -> Result<(), AppError> {
    let _guard = hermes_write_guard()?;
    let config = read_hermes_config()?;
    let mut memory = match config.get("memory") {
        Some(serde_yaml::Value::Mapping(mapping)) => mapping.clone(),
        _ => serde_yaml::Mapping::new(),
    };

    let key = match kind {
        MemoryKind::Memory => "memory_enabled",
        MemoryKind::User => "user_profile_enabled",
    };
    memory.insert(
        serde_yaml::Value::String(key.to_string()),
        serde_yaml::Value::Bool(enabled),
    );

    write_memory_section(&memory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_models_round_trip_between_ui_array_and_yaml_map() {
        let yaml = normalize_provider_for_write(
            "demo",
            json!({
                "baseUrl": "https://example.com/v1",
                "apiKey": "secret",
                "apiMode": "chat_completions",
                "models": [
                    { "id": "model-a", "name": "Model A", "supports_tools": true },
                    { "id": "model-b", "name": "Model B" }
                ]
            }),
        )
        .unwrap();

        assert_eq!(yaml["name"], "demo");
        assert_eq!(yaml["base_url"], "https://example.com/v1");
        assert_eq!(yaml["model"], "model-a");
        assert_eq!(yaml["models"]["model-a"]["supports_tools"], true);
        assert!(yaml["models"]["model-a"].get("name").is_none());

        let ui = normalize_provider_for_read(&yaml, PROVIDER_SOURCE_CUSTOM_LIST).unwrap();
        assert_eq!(ui["models"][0]["id"], "model-a");
        assert_eq!(ui["models"][0]["supports_tools"], true);
        assert_eq!(ui[PROVIDER_SOURCE_FIELD], PROVIDER_SOURCE_CUSTOM_LIST);
    }

    #[test]
    fn replacing_provider_section_preserves_unrelated_yaml() {
        let raw = "# user config\ntoolsets:\n  - web\ncustom_providers:\n  - name: old\n    unknown: keep\nmemory:\n  memory_enabled: true\n";
        let providers = serde_yaml::from_str("- name: next\n  api_key: secret\n").unwrap();
        let updated = replace_yaml_section(raw, "custom_providers", &providers).unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&updated).unwrap();

        assert!(updated.starts_with("# user config\n"));
        assert_eq!(parsed["toolsets"][0], "web");
        assert_eq!(parsed["memory"]["memory_enabled"], true);
        assert_eq!(parsed["custom_providers"][0]["name"], "next");
    }

    #[test]
    fn providers_map_entries_are_read_only_overlays() {
        let config: serde_yaml::Value = serde_yaml::from_str(
            "custom_providers:\n  - name: editable\nproviders:\n  builtin-key:\n    name: Built In\n    base_url: https://example.com\n",
        )
        .unwrap();

        assert!(!dict_only_provider(&config, "editable"));
        assert!(dict_only_provider(&config, "builtin-key"));
        assert!(dict_only_provider(&config, "Built In"));
    }

    /// 临时 HOME：Hermes 目录跟着 `CC_SWITCH_TEST_HOME` 走，设置也重读一遍（不带目录覆盖）
    struct HomeGuard {
        _dir: tempfile::TempDir,
        previous: Option<std::ffi::OsString>,
    }
    impl HomeGuard {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
            crate::settings::reload_settings().unwrap();
            Self {
                _dir: dir,
                previous,
            }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            let _ = crate::settings::reload_settings();
        }
    }

    fn write_section(key: &str, yaml: &str) {
        let _guard = hermes_write_guard().unwrap();
        write_yaml_section_to_config_locked(key, &serde_yaml::from_str(yaml).unwrap()).unwrap();
    }

    fn title_section() -> serde_yaml::Value {
        read_hermes_config().unwrap()["auxiliary"]["title_generation"].clone()
    }

    #[test]
    #[serial_test::serial]
    fn title_generation_model_is_pinned_and_removed_only_when_owned() {
        let _home = HomeGuard::new();
        let mm = json!({
            "base_url": "https://api.minimax.cn/v1",
            "models": [{ "id": "MiniMax-M3.1-Flash" }, { "id": "MiniMax-M3" }],
            "title_generation_model": "MiniMax-M3",
        });
        let other = json!({ "models": [{ "id": "x" }] });
        set_provider("minimax", mm.clone()).unwrap();
        set_provider("other", other.clone()).unwrap();
        // 用户别的 auxiliary 设置要留着
        write_section(
            "auxiliary",
            "title_generation:
  timeout: 9
compression:
  model: keep
",
        );

        apply_switch_defaults("minimax", &mm).unwrap();
        assert_eq!(title_section()["model"].as_str(), Some("MiniMax-M3"));
        apply_switch_defaults("other", &other).unwrap();
        assert!(title_section()["model"].is_null());
        let cfg = read_hermes_config().unwrap();
        assert_eq!(
            cfg["auxiliary"]["title_generation"]["timeout"].as_i64(),
            Some(9)
        );
        assert_eq!(
            cfg["auxiliary"]["compression"]["model"].as_str(),
            Some("keep")
        );

        // 用户手动写的钉选不删
        apply_switch_defaults("minimax", &mm).unwrap();
        write_section(
            "auxiliary",
            "title_generation:
  model: mine
",
        );
        apply_switch_defaults("other", &other).unwrap();
        assert_eq!(title_section()["model"].as_str(), Some("mine"));
    }

    #[test]
    #[serial_test::serial]
    fn title_generation_model_leaves_user_choice_and_follows_deleted_cards() {
        let _home = HomeGuard::new();
        let mm = json!({
            "models": [{ "id": "MiniMax-M3.1-Flash" }],
            "title_generation_model": "MiniMax-M3",
        });
        let other = json!({ "models": [{ "id": "x" }] });
        set_provider("minimax", mm.clone()).unwrap();
        set_provider("minimax_en", mm.clone()).unwrap();
        set_provider("other", other.clone()).unwrap();
        let set_title = |yaml: &str| {
            write_section(
                "auxiliary",
                &format!(
                    "title_generation:
{yaml}"
                ),
            )
        };

        // 用户把标题路由指到自己的供应商时从不改
        set_title(
            "  provider: openrouter
  model: google/gemini-flash
",
        );
        apply_switch_defaults("minimax", &mm).unwrap();
        assert_eq!(
            title_section()["model"].as_str(),
            Some("google/gemini-flash")
        );
        apply_switch_defaults("other", &other).unwrap();
        assert_eq!(
            title_section()["model"].as_str(),
            Some("google/gemini-flash")
        );

        // 自动路由下用户自己选的标题模型也不改
        set_title(
            "  model: my-model
",
        );
        apply_switch_defaults("minimax", &mm).unwrap();
        assert_eq!(title_section()["model"].as_str(), Some("my-model"));

        // 删掉声明钉选的卡：当前那家还要时保留……
        set_title(
            "  timeout: 9
",
        );
        apply_switch_defaults("minimax_en", &mm).unwrap();
        remove_provider("minimax").unwrap();
        assert_eq!(title_section()["model"].as_str(), Some("MiniMax-M3"));
        // ……没有卡要了就放开
        remove_provider("minimax_en").unwrap();
        assert!(title_section()["model"].is_null());
        assert_eq!(title_section()["timeout"].as_i64(), Some(9));

        // 在 Hermes 里自己换了供应商，下次切换不会留下钉选
        set_provider("minimax", mm.clone()).unwrap();
        apply_switch_defaults("minimax", &mm).unwrap();
        write_section(
            "model",
            "provider: other
",
        );
        apply_switch_defaults("other", &other).unwrap();
        assert!(title_section()["model"].is_null());
    }
}
