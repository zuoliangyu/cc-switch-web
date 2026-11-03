//! Live configuration operations
//!
//! Handles reading and writing live configuration files for Claude, Codex, and Gemini.

use serde_json::{json, Value};
use toml_edit::{DocumentMut, Item, TableLike};

use crate::app_config::AppType;
use crate::codex_config::get_codex_auth_path;
use crate::config::{get_claude_settings_path, read_json_file};
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::mcp::McpService;
use crate::store::AppState;

use super::normalize_claude_models_in_value;

pub(crate) fn provider_exists_in_live_config(
    app_type: &AppType,
    provider_id: &str,
) -> Result<bool, AppError> {
    match app_type {
        AppType::OpenCode => crate::opencode_config::get_providers()
            .map(|providers| providers.contains_key(provider_id)),
        AppType::OpenClaw => crate::openclaw_config::get_providers()
            .map(|providers| providers.contains_key(provider_id)),
        AppType::Hermes => crate::hermes_config::get_providers()
            .map(|providers| providers.contains_key(provider_id)),
        AppType::Mcode => crate::mcode_config::get_providers()
            .map(|providers| providers.contains_key(provider_id)),
        AppType::Kimi => {
            crate::kimi_config::get_providers().map(|providers| providers.contains_key(provider_id))
        }
        AppType::Dsh => {
            crate::dsh_config::get_providers().map(|providers| providers.contains_key(provider_id))
        }
        AppType::Omp => Ok(crate::omp_config::get_providers()?.contains_key(provider_id)),
        _ => Ok(false),
    }
}

fn json_is_subset(target: &Value, source: &Value) -> bool {
    match source {
        Value::Object(source_map) => {
            let Some(target_map) = target.as_object() else {
                return false;
            };
            source_map.iter().all(|(key, source_value)| {
                target_map
                    .get(key)
                    .is_some_and(|target_value| json_is_subset(target_value, source_value))
            })
        }
        Value::Array(source_arr) => {
            let Some(target_arr) = target.as_array() else {
                return false;
            };
            json_array_contains_subset(target_arr, source_arr)
        }
        _ => target == source,
    }
}

fn json_array_contains_subset(target_arr: &[Value], source_arr: &[Value]) -> bool {
    let mut matched = vec![false; target_arr.len()];

    source_arr.iter().all(|source_item| {
        if let Some((index, _)) = target_arr.iter().enumerate().find(|(index, target_item)| {
            !matched[*index] && json_is_subset(target_item, source_item)
        }) {
            matched[index] = true;
            true
        } else {
            false
        }
    })
}

fn json_remove_array_items(target_arr: &mut Vec<Value>, source_arr: &[Value]) {
    for source_item in source_arr {
        if let Some(index) = target_arr
            .iter()
            .position(|target_item| json_is_subset(target_item, source_item))
        {
            target_arr.remove(index);
        }
    }
}

fn json_deep_merge(target: &mut Value, source: &Value) {
    match (target, source) {
        (Value::Object(target_map), Value::Object(source_map)) => {
            for (key, source_value) in source_map {
                match target_map.get_mut(key) {
                    Some(target_value) => json_deep_merge(target_value, source_value),
                    None => {
                        target_map.insert(key.clone(), source_value.clone());
                    }
                }
            }
        }
        (target_value, source_value) => {
            *target_value = source_value.clone();
        }
    }
}

fn json_deep_remove(target: &mut Value, source: &Value) {
    let (Some(target_map), Some(source_map)) = (target.as_object_mut(), source.as_object()) else {
        return;
    };

    for (key, source_value) in source_map {
        let mut remove_key = false;

        if let Some(target_value) = target_map.get_mut(key) {
            if source_value.is_object() && target_value.is_object() {
                json_deep_remove(target_value, source_value);
                remove_key = target_value.as_object().is_some_and(|obj| obj.is_empty());
            } else if let (Some(target_arr), Some(source_arr)) =
                (target_value.as_array_mut(), source_value.as_array())
            {
                json_remove_array_items(target_arr, source_arr);
                remove_key = target_arr.is_empty();
            } else if json_is_subset(target_value, source_value) {
                remove_key = true;
            }
        }

        if remove_key {
            target_map.remove(key);
        }
    }
}

fn toml_value_is_subset(target: &toml_edit::Value, source: &toml_edit::Value) -> bool {
    match (target, source) {
        (toml_edit::Value::String(target), toml_edit::Value::String(source)) => {
            target.value() == source.value()
        }
        (toml_edit::Value::Integer(target), toml_edit::Value::Integer(source)) => {
            target.value() == source.value()
        }
        (toml_edit::Value::Float(target), toml_edit::Value::Float(source)) => {
            target.value() == source.value()
        }
        (toml_edit::Value::Boolean(target), toml_edit::Value::Boolean(source)) => {
            target.value() == source.value()
        }
        (toml_edit::Value::Datetime(target), toml_edit::Value::Datetime(source)) => {
            target.value() == source.value()
        }
        (toml_edit::Value::Array(target), toml_edit::Value::Array(source)) => {
            toml_array_contains_subset(target, source)
        }
        (toml_edit::Value::InlineTable(target), toml_edit::Value::InlineTable(source)) => {
            source.iter().all(|(key, source_item)| {
                target
                    .get(key)
                    .is_some_and(|target_item| toml_value_is_subset(target_item, source_item))
            })
        }
        _ => false,
    }
}

fn toml_array_contains_subset(target: &toml_edit::Array, source: &toml_edit::Array) -> bool {
    let mut matched = vec![false; target.len()];
    let target_items: Vec<&toml_edit::Value> = target.iter().collect();

    source.iter().all(|source_item| {
        if let Some((index, _)) = target_items
            .iter()
            .enumerate()
            .find(|(index, target_item)| {
                !matched[*index] && toml_value_is_subset(target_item, source_item)
            })
        {
            matched[index] = true;
            true
        } else {
            false
        }
    })
}

fn toml_remove_array_items(target: &mut toml_edit::Array, source: &toml_edit::Array) {
    for source_item in source.iter() {
        let index = {
            let target_items: Vec<&toml_edit::Value> = target.iter().collect();
            target_items
                .iter()
                .enumerate()
                .find(|(_, target_item)| toml_value_is_subset(target_item, source_item))
                .map(|(index, _)| index)
        };

        if let Some(index) = index {
            target.remove(index);
        }
    }
}

fn toml_item_is_subset(target: &Item, source: &Item) -> bool {
    if let Some(source_table) = source.as_table_like() {
        let Some(target_table) = target.as_table_like() else {
            return false;
        };
        return source_table.iter().all(|(key, source_item)| {
            target_table
                .get(key)
                .is_some_and(|target_item| toml_item_is_subset(target_item, source_item))
        });
    }

    match (target.as_value(), source.as_value()) {
        (Some(target_value), Some(source_value)) => {
            toml_value_is_subset(target_value, source_value)
        }
        _ => false,
    }
}

fn merge_toml_item(target: &mut Item, source: &Item) {
    if let Some(source_table) = source.as_table_like() {
        if let Some(target_table) = target.as_table_like_mut() {
            merge_toml_table_like(target_table, source_table);
            return;
        }
    }

    *target = source.clone();
}

fn merge_toml_table_like(target: &mut dyn TableLike, source: &dyn TableLike) {
    for (key, source_item) in source.iter() {
        match target.get_mut(key) {
            Some(target_item) => merge_toml_item(target_item, source_item),
            None => {
                target.insert(key, source_item.clone());
            }
        }
    }
}

fn remove_toml_item(target: &mut Item, source: &Item) {
    if let Some(source_table) = source.as_table_like() {
        if let Some(target_table) = target.as_table_like_mut() {
            remove_toml_table_like(target_table, source_table);
            if target_table.is_empty() {
                *target = Item::None;
            }
            return;
        }
    }

    if let Some(source_value) = source.as_value() {
        let mut remove_item = false;

        if let Some(target_value) = target.as_value_mut() {
            match (target_value, source_value) {
                (toml_edit::Value::Array(target_arr), toml_edit::Value::Array(source_arr)) => {
                    toml_remove_array_items(target_arr, source_arr);
                    remove_item = target_arr.is_empty();
                }
                (target_value, source_value)
                    if toml_value_is_subset(target_value, source_value) =>
                {
                    remove_item = true;
                }
                _ => {}
            }
        }

        if remove_item {
            *target = Item::None;
        }
    }
}

fn remove_toml_table_like(target: &mut dyn TableLike, source: &dyn TableLike) {
    let keys: Vec<String> = source.iter().map(|(key, _)| key.to_string()).collect();

    for key in keys {
        let mut remove_key = false;
        if let (Some(target_item), Some(source_item)) = (target.get_mut(&key), source.get(&key)) {
            remove_toml_item(target_item, source_item);
            remove_key = target_item.is_none()
                || target_item
                    .as_table_like()
                    .is_some_and(|table_like| table_like.is_empty());
        }

        if remove_key {
            target.remove(&key);
        }
    }
}

/// 在编辑器的 config.toml 文本中结构化合并或剥离通用配置片段。
/// 使用 toml_edit 保留用户注释和键顺序。
pub fn update_toml_common_config_snippet(
    config_toml: &str,
    snippet_toml: &str,
    enabled: bool,
) -> Result<String, AppError> {
    let trimmed = snippet_toml.trim();
    if trimmed.is_empty() {
        return Ok(config_toml.to_string());
    }

    let mut target_doc = if config_toml.trim().is_empty() {
        DocumentMut::new()
    } else {
        config_toml
            .parse::<DocumentMut>()
            .map_err(|error| AppError::Message(format!("Invalid Codex config.toml: {error}")))?
    };
    let source_doc = trimmed.parse::<DocumentMut>().map_err(|error| {
        AppError::Message(format!("Invalid Codex common config snippet: {error}"))
    })?;

    if enabled {
        merge_toml_table_like(target_doc.as_table_mut(), source_doc.as_table());
    } else {
        remove_toml_table_like(target_doc.as_table_mut(), source_doc.as_table());
    }

    Ok(target_doc.to_string())
}

fn settings_contain_common_config(app_type: &AppType, settings: &Value, snippet: &str) -> bool {
    let trimmed = snippet.trim();
    if trimmed.is_empty() {
        return false;
    }

    match app_type {
        AppType::Claude | AppType::ClaudeDesktop => match serde_json::from_str::<Value>(trimmed) {
            Ok(source) if source.is_object() => json_is_subset(settings, &source),
            _ => false,
        },
        AppType::Codex => {
            let config_toml = settings.get("config").and_then(Value::as_str).unwrap_or("");
            if config_toml.trim().is_empty() {
                return false;
            }

            let target_doc = match config_toml.parse::<DocumentMut>() {
                Ok(doc) => doc,
                Err(_) => return false,
            };
            let source_doc = match trimmed.parse::<DocumentMut>() {
                Ok(doc) => doc,
                Err(_) => return false,
            };

            toml_item_is_subset(target_doc.as_item(), source_doc.as_item())
        }
        AppType::Gemini => match serde_json::from_str::<Value>(trimmed) {
            Ok(Value::Object(source_map)) => {
                let Some(target_map) = settings.get("env").and_then(Value::as_object) else {
                    return false;
                };
                source_map.iter().all(|(key, source_value)| {
                    target_map
                        .get(key)
                        .is_some_and(|target_value| json_is_subset(target_value, source_value))
                })
            }
            _ => false,
        },
        AppType::GrokBuild
        | AppType::OpenCode
        | AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi
        | AppType::Mcode
        | AppType::Kimi
        | AppType::Dsh
        | AppType::Agy
        | AppType::Omp => false,
    }
}

pub(crate) fn provider_uses_common_config(
    app_type: &AppType,
    provider: &Provider,
    snippet: Option<&str>,
) -> bool {
    match provider
        .meta
        .as_ref()
        .and_then(|meta| meta.common_config_enabled)
    {
        Some(explicit) => explicit && snippet.is_some_and(|value| !value.trim().is_empty()),
        None => snippet.is_some_and(|value| {
            settings_contain_common_config(app_type, &provider.settings_config, value)
        }),
    }
}

pub(crate) fn remove_common_config_from_settings(
    app_type: &AppType,
    settings: &Value,
    snippet: &str,
) -> Result<Value, AppError> {
    let trimmed = snippet.trim();
    if trimmed.is_empty() {
        return Ok(settings.clone());
    }

    match app_type {
        AppType::Claude | AppType::ClaudeDesktop => {
            let source = serde_json::from_str::<Value>(trimmed)
                .map_err(|e| AppError::Message(format!("Invalid Claude common config: {e}")))?;
            let mut result = settings.clone();
            json_deep_remove(&mut result, &source);
            Ok(result)
        }
        AppType::Codex => {
            let mut result = settings.clone();
            let config_toml = settings.get("config").and_then(Value::as_str).unwrap_or("");
            let mut target_doc = if config_toml.trim().is_empty() {
                DocumentMut::new()
            } else {
                config_toml.parse::<DocumentMut>().map_err(|e| {
                    AppError::Message(format!(
                        "Invalid Codex config.toml while removing common config: {e}"
                    ))
                })?
            };
            let source_doc = trimmed.parse::<DocumentMut>().map_err(|e| {
                AppError::Message(format!("Invalid Codex common config snippet: {e}"))
            })?;

            remove_toml_table_like(target_doc.as_table_mut(), source_doc.as_table());
            if let Some(obj) = result.as_object_mut() {
                obj.insert("config".to_string(), Value::String(target_doc.to_string()));
            }
            Ok(result)
        }
        AppType::Gemini => {
            let source = serde_json::from_str::<Value>(trimmed)
                .map_err(|e| AppError::Message(format!("Invalid Gemini common config: {e}")))?;
            let mut result = settings.clone();
            if let Some(env) = result.get_mut("env") {
                json_deep_remove(env, &source);
            }
            Ok(result)
        }
        AppType::GrokBuild
        | AppType::OpenCode
        | AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi
        | AppType::Mcode
        | AppType::Kimi
        | AppType::Dsh
        | AppType::Agy
        | AppType::Omp => Ok(settings.clone()),
    }
}

fn apply_common_config_to_settings(
    app_type: &AppType,
    settings: &Value,
    snippet: &str,
) -> Result<Value, AppError> {
    let trimmed = snippet.trim();
    if trimmed.is_empty() {
        return Ok(settings.clone());
    }

    match app_type {
        AppType::Claude | AppType::ClaudeDesktop => {
            let source = serde_json::from_str::<Value>(trimmed)
                .map_err(|e| AppError::Message(format!("Invalid Claude common config: {e}")))?;
            let mut result = settings.clone();
            json_deep_merge(&mut result, &source);
            Ok(result)
        }
        AppType::Codex => {
            let mut result = settings.clone();
            let config_toml = settings.get("config").and_then(Value::as_str).unwrap_or("");
            let mut target_doc = if config_toml.trim().is_empty() {
                DocumentMut::new()
            } else {
                config_toml.parse::<DocumentMut>().map_err(|e| {
                    AppError::Message(format!(
                        "Invalid Codex config.toml while applying common config: {e}"
                    ))
                })?
            };
            let source_doc = trimmed.parse::<DocumentMut>().map_err(|e| {
                AppError::Message(format!("Invalid Codex common config snippet: {e}"))
            })?;

            merge_toml_table_like(target_doc.as_table_mut(), source_doc.as_table());
            if let Some(obj) = result.as_object_mut() {
                obj.insert("config".to_string(), Value::String(target_doc.to_string()));
            }
            Ok(result)
        }
        AppType::Gemini => {
            let source = serde_json::from_str::<Value>(trimmed)
                .map_err(|e| AppError::Message(format!("Invalid Gemini common config: {e}")))?;
            let mut result = settings.clone();
            if let Some(env) = result.get_mut("env") {
                json_deep_merge(env, &source);
            } else if let Some(obj) = result.as_object_mut() {
                obj.insert("env".to_string(), source);
            }
            Ok(result)
        }
        AppType::GrokBuild
        | AppType::OpenCode
        | AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi
        | AppType::Mcode
        | AppType::Kimi
        | AppType::Dsh
        | AppType::Agy
        | AppType::Omp => Ok(settings.clone()),
    }
}

pub(crate) fn build_effective_settings_with_common_config(
    db: &Database,
    app_type: &AppType,
    provider: &Provider,
) -> Result<Value, AppError> {
    if matches!(
        app_type,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    ) {
        return Ok(provider.settings_config.clone());
    }
    let snippet = db.get_config_snippet(app_type.as_str())?;
    let mut effective_settings = provider.settings_config.clone();

    if provider_uses_common_config(app_type, provider, snippet.as_deref()) {
        if let Some(snippet_text) = snippet.as_deref() {
            match apply_common_config_to_settings(app_type, &effective_settings, snippet_text) {
                Ok(settings) => effective_settings = settings,
                Err(err) => {
                    log::warn!(
                        "Failed to apply common config for {} provider '{}': {err}",
                        app_type.as_str(),
                        provider.id
                    );
                }
            }
        }
    }

    Ok(effective_settings)
}

pub(crate) fn write_live_with_common_config(
    db: &Database,
    app_type: &AppType,
    provider: &Provider,
) -> Result<(), AppError> {
    if *app_type == AppType::Codex {
        return super::codex_direct::reapply_prepared(db, provider);
    }
    if *app_type == AppType::Claude {
        crate::mode::operation::settle(db, "claude")?;
        super::claude_direct::reapply(db, None, provider)?;
        return Ok(());
    }
    if *app_type == AppType::Gemini {
        crate::mode::operation::settle(db, "gemini")?;
        super::gemini_direct::reapply(db, provider)?;
        return Ok(());
    }
    if *app_type == AppType::GrokBuild {
        crate::mode::operation::settle(db, "grokbuild")?;
        let previous = super::grok_direct::current_provider(db)?;
        super::grok_direct::reapply(db, previous.as_ref(), provider)?;
        return Ok(());
    }
    if matches!(app_type, AppType::ClaudeDesktop) {
        return crate::claude_desktop_config::apply_provider(db, provider);
    }
    let mut effective_provider = provider.clone();
    effective_provider.settings_config =
        build_effective_settings_with_common_config(db, app_type, provider)?;
    neutralize_codex_proxy_oauth_fallback(app_type, &mut effective_provider);

    write_live_snapshot(app_type, &effective_provider)
}

/// 代理托管 OAuth 卡片（xai_oauth、github_copilot 等）按设计无 key，但预设快照继承了
/// 旧版 `requires_openai_auth = true`，会被写入层的无 key 安全闸门拒绝。这里在生效
/// 快照中把该标记中和为 false，而不是豁免闸门：写出的配置在 0.149 下被视为未认证、
/// 不会读取 auth.json。`codex_oauth` 由判定函数排除（上游 c88b00fa）。
pub(crate) fn neutralize_codex_proxy_oauth_fallback(app_type: &AppType, provider: &mut Provider) {
    if !matches!(app_type, AppType::Codex) || !provider.uses_proxy_injected_oauth() {
        return;
    }
    let Some(settings) = provider.settings_config.as_object_mut() else {
        return;
    };
    let Some(config_text) = settings.get("config").and_then(Value::as_str) else {
        return;
    };
    if let Some(updated) =
        crate::codex_config::neutralize_codex_official_auth_fallback_for_proxy_oauth(config_text)
    {
        settings.insert("config".to_string(), Value::String(updated));
    }
}

pub(crate) fn strip_common_config_from_live_settings(
    db: &Database,
    app_type: &AppType,
    provider: &Provider,
    live_settings: Value,
) -> Value {
    let snippet = match db.get_config_snippet(app_type.as_str()) {
        Ok(snippet) => snippet,
        Err(err) => {
            log::warn!(
                "Failed to load common config for {} while backfilling '{}': {err}",
                app_type.as_str(),
                provider.id
            );
            return restore_live_settings_for_provider_backfill(app_type, provider, live_settings);
        }
    };

    let backfill_settings = if provider_uses_common_config(app_type, provider, snippet.as_deref()) {
        match snippet.as_deref() {
            Some(snippet_text) => {
                match remove_common_config_from_settings(app_type, &live_settings, snippet_text) {
                    Ok(settings) => settings,
                    Err(err) => {
                        log::warn!(
                            "Failed to strip common config for {} provider '{}': {err}",
                            app_type.as_str(),
                            provider.id
                        );
                        live_settings
                    }
                }
            }
            None => live_settings,
        }
    } else {
        live_settings
    };

    restore_live_settings_for_provider_backfill(app_type, provider, backfill_settings)
}

/// 在 backfill 阶段把 live 配置中的 stable provider id 还原回 stored 模板原始 id。
/// Codex 还原标识；Grok Build 保留供应商模型选择并移除 MCP 投影。
fn restore_live_settings_for_provider_backfill(
    app_type: &AppType,
    provider: &Provider,
    live_settings: Value,
) -> Value {
    if matches!(app_type, AppType::GrokBuild) {
        let mut settings = live_settings;
        if let Err(error) = crate::grok_config::strip_grok_mcp_servers_from_settings(&mut settings)
        {
            log::warn!(
                "Failed to strip Grok Build mcp_servers while backfilling '{}': {error}",
                provider.id
            );
        }
        let restored = match (
            settings.get("config").and_then(Value::as_str),
            provider
                .settings_config
                .get("config")
                .and_then(Value::as_str),
        ) {
            (Some(live_config), Some(provider_config)) => {
                crate::grok_config::restore_provider_default_model(live_config, provider_config)
            }
            _ => None,
        };
        if let Some(config) = restored {
            log::info!(
                "Grok Build models.default no longer selected provider '{}' table; restored it while backfilling",
                provider.id
            );
            settings["config"] = Value::String(config);
        }
        return settings;
    }
    if !matches!(app_type, AppType::Codex) {
        return live_settings;
    }

    let mut settings = live_settings;
    if let Err(err) =
        crate::codex_config::strip_codex_unified_session_bucket_from_settings(&mut settings)
    {
        log::warn!("Failed to strip Codex unified history route while backfilling: {err}");
    }
    if let Err(err) = crate::codex_config::restore_codex_settings_config_model_provider_for_backfill(
        &mut settings,
        &provider.settings_config,
    ) {
        log::warn!(
            "Failed to restore Codex provider id while backfilling '{}': {err}",
            provider.id
        );
    }

    // live auth.json 是没有 Provider 身份的共享槽位，Codex 0.149+ 第三方路由从不读取它：
    // 默认模式切换会删除该文件，provider 表自带凭据来源时也不注入 bearer。因此无凭据
    // 的 live auth 等同于字段缺失而非用户清空了 key——数据库是唯一副本，切走时的回填
    // 不能抹掉它。live 携带凭据时仍以 live 为准；官方 Provider 以 live 登录为权威来源
    // （上游 5a80e300）。
    if provider.category.as_deref() != Some("official")
        && !crate::proxy::providers::is_codex_official_provider(provider)
    {
        let stored_auth = provider.settings_config.get("auth");
        let live_auth_has_material = settings
            .get("auth")
            .is_some_and(crate::codex_config::codex_auth_has_login_material);
        if !live_auth_has_material
            && stored_auth.is_some_and(crate::codex_config::codex_auth_has_login_material)
        {
            if let (Some(obj), Some(stored_auth)) = (settings.as_object_mut(), stored_auth) {
                obj.insert("auth".to_string(), stored_auth.clone());
            }
        }
    }

    settings
}

pub(crate) fn normalize_provider_common_config_for_storage(
    db: &Database,
    app_type: &AppType,
    provider: &mut Provider,
) -> Result<(), AppError> {
    if matches!(
        app_type,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    ) {
        return Ok(());
    }
    let uses_common_config = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.common_config_enabled)
        .unwrap_or(false);

    if !uses_common_config {
        return Ok(());
    }

    let Some(snippet) = db.get_config_snippet(app_type.as_str())? else {
        return Ok(());
    };

    if snippet.trim().is_empty() {
        return Ok(());
    }

    match remove_common_config_from_settings(app_type, &provider.settings_config, &snippet) {
        Ok(settings) => provider.settings_config = settings,
        Err(err) => {
            log::warn!(
                "Failed to normalize common config before saving {} provider '{}': {err}",
                app_type.as_str(),
                provider.id
            );
        }
    }

    Ok(())
}

/// 在提交 current 之前校验目标 Provider 的 Codex live 投影，不写入任何文件：
/// 按 live 写入相同的方式构建生效配置，再执行写入层计划（legacy 归一化、安全闸门、
/// token 注入、TOML 解析）。current 已切换后才被写入层拒绝，会让下一次切换把旧
/// live 配置回填进新 Provider 的数据库记录（上游 97a7425f）。
pub(crate) fn preflight_codex_live_write(
    db: &Database,
    provider: &Provider,
) -> Result<(), AppError> {
    super::codex_direct::preflight(db, provider)
}

pub(crate) fn write_live_snapshot(app_type: &AppType, provider: &Provider) -> Result<(), AppError> {
    match app_type {
        AppType::ClaudeDesktop => {
            return Err(AppError::Message(
                "Claude Desktop 配置必须通过独立的写入引擎保存".into(),
            ));
        }
        AppType::Claude => {
            return Err(AppError::Message(
                "Claude 配置必须通过关键字段引擎写入".into(),
            ))
        }
        AppType::Codex => {
            return Err(AppError::Message(
                "Codex 配置必须通过关键字段写入引擎保存".into(),
            ));
        }
        AppType::Gemini => {
            return Err(AppError::Message(
                "Gemini 配置必须通过关键字段引擎写入".into(),
            ));
        }
        AppType::GrokBuild => {
            return Err(AppError::Message(
                "Grok 配置必须通过关键字段引擎写入".into(),
            ))
        }
        AppType::OpenCode => {
            // OpenCode uses additive mode - write provider to config
            use crate::opencode_config;
            use crate::provider::{OpenCodeConfigFormat, OpenCodeProviderConfig};
            use serde::Deserialize;

            // Native declarations may rely on a built-in definition without a package:
            // a stored override must stay re-addable after removal from live. The UI
            // still requires a definition for a new or renamed ID, as it does for V1.
            let (config_to_write, format) = opencode_config::provider_fragment(
                &provider.id,
                &provider.settings_config,
                provider.opencode_config_format(),
            )?;
            if format == OpenCodeConfigFormat::V2 {
                return opencode_config::set_provider_with_format(
                    &provider.id,
                    config_to_write.clone(),
                    format,
                );
            }

            // A new ID cannot inherit an existing provider's built-in definition.
            // Check at the write boundary as well as in the UI, including old copies.
            let has_npm = config_to_write
                .get("npm")
                .and_then(Value::as_str)
                .is_some_and(|npm| !npm.trim().is_empty());
            let has_models = config_to_write
                .get("models")
                .and_then(Value::as_object)
                .is_some_and(|models| !models.is_empty());
            if (!has_npm || !has_models)
                && !opencode_config::get_providers()?.contains_key(&provider.id)
            {
                return Err(AppError::localized(
                    "provider.opencode.custom_definition_required",
                    "新的 OpenCode 供应商标识需要填写 npm 包和至少一个模型；只有配置中已有的同名供应商可以沿用默认定义",
                    "A new OpenCode provider ID requires an npm package and at least one model; only an existing ID in the live config may inherit defaults",
                ));
            }

            // 仅用类型校验，写回原始 JSON，保留未建模的字段。
            let opencode_config_result = OpenCodeProviderConfig::deserialize(config_to_write);

            match opencode_config_result {
                Ok(_) => {
                    opencode_config::set_provider_with_format(
                        &provider.id,
                        config_to_write.clone(),
                        format,
                    )?;
                    log::info!("OpenCode provider '{}' written to live config", provider.id);
                }
                Err(e) => {
                    log::warn!(
                        "Failed to parse OpenCode provider config for '{}': {}",
                        provider.id,
                        e
                    );
                    // Only write if config looks like a valid provider fragment
                    if config_to_write.get("npm").is_some()
                        || config_to_write.get("options").is_some()
                    {
                        opencode_config::set_provider_with_format(
                            &provider.id,
                            config_to_write.clone(),
                            format,
                        )?;
                        log::info!(
                            "OpenCode provider '{}' written as raw JSON to live config",
                            provider.id
                        );
                    } else {
                        log::error!(
                            "OpenCode provider '{}' has invalid config structure, skipping write",
                            provider.id
                        );
                    }
                }
            }
        }
        AppType::OpenClaw => {
            // OpenClaw uses additive mode - write provider to config
            use crate::openclaw_config;
            use crate::openclaw_config::OpenClawProviderConfig;

            // Convert settings_config to OpenClawProviderConfig
            let openclaw_config_result =
                serde_json::from_value::<OpenClawProviderConfig>(provider.settings_config.clone());

            match openclaw_config_result {
                Ok(config) => {
                    openclaw_config::set_typed_provider(&provider.id, &config)?;
                    log::info!("OpenClaw provider '{}' written to live config", provider.id);
                }
                Err(e) => {
                    log::warn!(
                        "Failed to parse OpenClaw provider config for '{}': {}",
                        provider.id,
                        e
                    );
                    // Try to write as raw JSON if it looks valid
                    if provider.settings_config.get("baseUrl").is_some()
                        || provider.settings_config.get("api").is_some()
                        || provider.settings_config.get("models").is_some()
                    {
                        openclaw_config::set_provider(
                            &provider.id,
                            provider.settings_config.clone(),
                        )?;
                        log::info!(
                            "OpenClaw provider '{}' written as raw JSON to live config",
                            provider.id
                        );
                    } else {
                        log::error!(
                            "OpenClaw provider '{}' has invalid config structure, skipping write",
                            provider.id
                        );
                    }
                }
            }
        }
        AppType::Hermes => {
            crate::hermes_config::set_provider(&provider.id, provider.settings_config.clone())?;
            log::info!("Hermes provider '{}' written to live config", provider.id);
        }
        AppType::Mcode => {
            crate::mcode_config::set_provider(&provider.id, provider.settings_config.clone())?
        }
        AppType::Kimi => {
            crate::kimi_config::set_provider(&provider.id, provider.settings_config.clone())?
        }
        AppType::Dsh => {
            crate::dsh_config::set_provider(&provider.id, provider.settings_config.clone())?
        }
        AppType::Agy => {
            // 卡片只作用于它打开的终端，真实的 settings.json 不写（见 agy_config 模块说明）
            return Err(AppError::Config(
                "Antigravity configuration requires the provider switch flow".into(),
            ));
        }
        AppType::Pi => {
            return Err(AppError::InvalidInput(
                "Pi providers must use the native models.json adapter".to_string(),
            ));
        }
        AppType::Omp => {
            return Err(AppError::InvalidInput(
                "Oh My Pi providers use the Oh My Pi provider service".to_string(),
            ));
        }
    }
    Ok(())
}

/// Sync all providers to live configuration (for additive mode apps)
///
/// Writes all providers from the database to the live configuration file.
/// Used for OpenCode and other additive mode applications.
fn sync_all_providers_to_live(state: &AppState, app_type: &AppType) -> Result<(), AppError> {
    // Pi 的 models.json 成员关系由原生文件决定；全局恢复不能把数据库目录全部启用。
    if *app_type == AppType::Pi {
        return Ok(());
    }
    let providers = state.db.get_all_providers(app_type.as_str())?;
    let mut synced_count = 0usize;

    for provider in providers.values() {
        if provider
            .meta
            .as_ref()
            .and_then(|meta| meta.live_config_managed)
            == Some(false)
        {
            continue;
        }

        if let Err(e) = write_live_with_common_config(state.db.as_ref(), app_type, provider) {
            log::warn!(
                "Failed to sync {:?} provider '{}' to live: {e}",
                app_type,
                provider.id
            );
            // Continue syncing other providers, don't abort
            continue;
        }
        synced_count += 1;
    }

    log::info!("Synced {synced_count} {app_type:?} providers to live config");
    Ok(())
}

pub(crate) fn sync_current_provider_for_app_to_live(
    state: &AppState,
    app_type: &AppType,
) -> Result<(), AppError> {
    if *app_type == AppType::Pi {
        return Ok(());
    }
    if app_type.is_additive_mode() {
        sync_all_providers_to_live(state, app_type)?;
    } else {
        let current_id = match crate::settings::get_effective_current_provider(&state.db, app_type)?
        {
            Some(id) => id,
            None => return Ok(()),
        };

        let providers = state.db.get_all_providers(app_type.as_str())?;
        if let Some(provider) = providers.get(&current_id) {
            super::sync_live_for_provider_respecting_takeover(state, app_type, provider)?;
        }
    }

    McpService::sync_enabled_for_app(state, app_type)?;

    Ok(())
}

/// Sync current provider to live configuration
///
/// 使用有效的当前供应商 ID（验证过存在性）。
/// 优先从本地 settings 读取，验证后 fallback 到数据库的 is_current 字段。
/// 这确保了配置导入后无效 ID 会自动 fallback 到数据库。
///
/// For additive mode apps (OpenCode), all providers are synced instead of just the current one.
/// Populate newly encountered DSH profiles with managed providers and enabled MCP servers.
/// The native writer records completion locally so later native deletions remain intentional.
pub(crate) fn initialize_dsh_profiles(state: &AppState) -> Result<(), AppError> {
    let providers = state
        .db
        .get_all_providers("dsh")?
        .into_iter()
        .filter(|(_, provider)| {
            provider
                .meta
                .as_ref()
                .and_then(|meta| meta.live_config_managed)
                == Some(true)
        })
        .map(|(id, provider)| (id, provider.settings_config))
        .collect();
    let servers = state
        .db
        .get_all_mcp_servers()?
        .into_iter()
        .filter(|(_, server)| server.apps.dsh)
        .map(|(id, server)| (id, server.server))
        .collect();
    crate::dsh_config::initialize_profiles(&providers, &servers)
}

pub fn sync_current_to_live(state: &AppState) -> Result<(), AppError> {
    // DSH 的 profile 由它自己的配置文件维护：全量同步只给新出现的 profile 补上
    // 已管理的供应商与 MCP，失败不阻断其余应用，最后一并上报（同上游）。
    let dsh_result = initialize_dsh_profiles(state);
    // Sync providers based on mode
    for app_type in AppType::all() {
        // MiniMax Code / Kimi Code 的原生配置由各自维护，不做全量回写（上游 06082e18、e4873bc8）；
        // Antigravity 的卡只作用于它打开的终端，全量同步不写真实 settings.json；
        // Oh My Pi 的 models.yml 只经它自己的供应商服务改动（上游同样跳过）。
        if matches!(
            app_type,
            AppType::Mcode | AppType::Kimi | AppType::Dsh | AppType::Agy | AppType::Omp
        ) {
            continue;
        }
        if app_type.is_additive_mode() {
            // Additive mode: sync ALL providers
            sync_all_providers_to_live(state, &app_type)?;
        } else {
            // Switch mode: sync only current provider
            let current_id =
                match crate::settings::get_effective_current_provider(&state.db, &app_type)? {
                    Some(id) => id,
                    None => continue,
                };

            let providers = state.db.get_all_providers(app_type.as_str())?;
            if let Some(provider) = providers.get(&current_id) {
                super::sync_live_for_provider_respecting_takeover(state, &app_type, provider)?;
            }
            // Note: get_effective_current_provider already validates existence,
            // so providers.get() should always succeed here
        }
    }

    if let Err(error) = dsh_result {
        log::warn!("初始化 DeepSeek Harness profile 失败: {error}");
        return Err(AppError::Message(format!("provider/dsh: {error}")));
    }

    // MCP 逐应用同步失败不应跳过后续 Skill 同步，但最终仍需上报结果不完整。
    let mcp_result = McpService::sync_all_enabled(state);

    // Skill sync
    for app_type in AppType::all() {
        if let Err(e) = crate::services::skill::SkillService::sync_to_app(&state.db, &app_type) {
            log::warn!("同步 Skill 到 {app_type:?} 失败: {e}");
            // Continue syncing other apps, don't abort
        }
    }

    mcp_result
}

/// Read current live settings for an app type
pub fn read_live_settings(app_type: AppType) -> Result<Value, AppError> {
    if matches!(app_type, AppType::ClaudeDesktop) {
        return Err(AppError::Message(
            "Claude Desktop 使用独立的 profile 配置，请通过供应商编辑器管理".into(),
        ));
    }
    match app_type {
        AppType::Codex => {
            let mut result = crate::codex_config::read_codex_live_settings()?;
            if let Ok(Some(model_catalog)) =
                crate::codex_config::read_codex_model_catalog_simplified_from_live()
            {
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("modelCatalog".to_string(), model_catalog);
                }
            }
            Ok(result)
        }
        AppType::Claude | AppType::ClaudeDesktop => {
            let path = get_claude_settings_path();
            if !path.exists() {
                return Err(AppError::localized(
                    "claude.live.missing",
                    "Claude Code 配置文件不存在",
                    "Claude settings file is missing",
                ));
            }
            read_json_file(&path)
        }
        AppType::Gemini => {
            use crate::gemini_config::{
                env_to_json, get_gemini_env_path, get_gemini_settings_path, read_gemini_env,
            };

            // Read .env file (environment variables)
            let env_path = get_gemini_env_path();
            if !env_path.exists() {
                return Err(AppError::localized(
                    "gemini.env.missing",
                    "Gemini .env 文件不存在",
                    "Gemini .env file not found",
                ));
            }

            let env_map = read_gemini_env()?;
            let env_json = env_to_json(&env_map);
            let env_obj = env_json.get("env").cloned().unwrap_or_else(|| json!({}));

            // Read settings.json file (MCP config etc.)
            let settings_path = get_gemini_settings_path();
            let config_obj = if settings_path.exists() {
                read_json_file(&settings_path)?
            } else {
                json!({})
            };

            // Return complete structure: { "env": {...}, "config": {...} }
            Ok(json!({
                "env": env_obj,
                "config": config_obj
            }))
        }
        AppType::GrokBuild => crate::grok_config::read_grok_live_settings(),
        AppType::OpenCode => {
            use crate::opencode_config::{
                get_opencode_config_path, read_opencode_config_from_path,
            };

            let config_path = get_opencode_config_path()?;
            if !config_path
                .try_exists()
                .map_err(|e| AppError::io(&config_path, e))?
            {
                return Err(AppError::localized(
                    "opencode.config.missing",
                    "OpenCode 配置文件不存在",
                    "OpenCode configuration file not found",
                ));
            }

            let config = read_opencode_config_from_path(&config_path)?;
            Ok(config)
        }
        AppType::OpenClaw => {
            use crate::openclaw_config::{get_openclaw_config_path, read_openclaw_config};

            let config_path = get_openclaw_config_path();
            if !config_path.exists() {
                return Err(AppError::localized(
                    "openclaw.config.missing",
                    "OpenClaw 配置文件不存在",
                    "OpenClaw configuration file not found",
                ));
            }

            let config = read_openclaw_config()?;
            Ok(config)
        }
        AppType::Hermes => Ok(Value::Object(crate::hermes_config::get_providers()?)),
        AppType::Pi => serde_json::to_value(crate::pi_config::read_pi_native_providers()?)
            .map_err(|source| AppError::JsonSerialize { source }),
        AppType::Mcode => Ok(json!(crate::mcode_config::get_providers()?)),
        AppType::Kimi => Ok(json!(crate::kimi_config::get_providers()?)),
        AppType::Agy => crate::agy_config::read_live_settings(),
        AppType::Omp => Ok(json!(crate::omp_config::get_providers()?)),
        AppType::Dsh => Ok(json!(crate::dsh_config::get_providers()?)),
    }
}

/// Import default configuration from live files
///
/// Returns `Ok(true)` if a provider was actually imported,
/// `Ok(false)` if skipped (providers already exist for this app).
pub fn import_default_config(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
    if matches!(app_type, AppType::ClaudeDesktop) {
        // Desktop profile 与 Claude Code settings 不是同一种配置，不能互相导入。
        return Ok(false);
    }
    // Additive mode apps (OpenCode, OpenClaw) should use their dedicated
    // import_xxx_providers_from_live functions, not this generic default config import
    if app_type.is_additive_mode() {
        return Ok(false);
    }

    {
        let providers = state.db.get_all_providers(app_type.as_str())?;
        let has_user_provider = providers.values().any(|provider| {
            !(matches!(app_type, AppType::GrokBuild)
                && provider.id == crate::grok_config::OFFICIAL_PROVIDER_ID
                && provider.category.as_deref() == Some("official"))
        });
        if has_user_provider {
            return Ok(false); // 已有供应商，跳过
        }
    }

    let settings_config = match app_type {
        AppType::Codex => {
            let auth_path = get_codex_auth_path();
            if !auth_path.exists() {
                return Err(AppError::localized(
                    "codex.live.missing",
                    "Codex 配置文件不存在",
                    "Codex configuration file is missing",
                ));
            }
            let auth: Value = read_json_file(&auth_path)?;
            let config_str = crate::codex_config::read_and_validate_codex_config_text()?;
            json!({ "auth": auth, "config": config_str })
        }
        AppType::Claude | AppType::ClaudeDesktop => {
            let settings_path = get_claude_settings_path();
            if !settings_path.exists() {
                return Err(AppError::localized(
                    "claude.live.missing",
                    "Claude Code 配置文件不存在",
                    "Claude settings file is missing",
                ));
            }
            let mut v = read_json_file::<Value>(&settings_path)?;
            let _ = normalize_claude_models_in_value(&mut v);
            v
        }
        AppType::Gemini => {
            use crate::gemini_config::{
                env_to_json, get_gemini_env_path, get_gemini_settings_path, read_gemini_env,
            };

            // Read .env file (environment variables)
            let env_path = get_gemini_env_path();
            if !env_path.exists() {
                return Err(AppError::localized(
                    "gemini.live.missing",
                    "Gemini 配置文件不存在",
                    "Gemini configuration file is missing",
                ));
            }

            let env_map = read_gemini_env()?;
            let env_json = env_to_json(&env_map);
            let env_obj = env_json.get("env").cloned().unwrap_or_else(|| json!({}));

            // Read settings.json file (MCP config etc.)
            let settings_path = get_gemini_settings_path();
            let config_obj = if settings_path.exists() {
                read_json_file(&settings_path)?
            } else {
                json!({})
            };

            // Return complete structure: { "env": {...}, "config": {...} }
            json!({
                "env": env_obj,
                "config": config_obj
            })
        }
        AppType::GrokBuild => {
            let mut settings = crate::grok_config::read_grok_live_settings()?;
            let config = settings
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or_default();
            crate::grok_config::validate_config_toml(config)?;
            crate::grok_config::strip_grok_mcp_servers_from_settings(&mut settings)?;
            settings
        }
        AppType::Agy => {
            let live = crate::agy_config::read_live_settings()?;
            // agy 首次启动就会写出空的 settings.json；没有 Key、端点、模型的配置
            // 不是用户的供应商，不导入。
            if !crate::agy_config::has_managed_content(&live) {
                return Ok(false);
            }
            live
        }
        // Additive mode apps are handled by the early return above.
        AppType::OpenCode
        | AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi
        | AppType::Mcode
        | AppType::Kimi
        | AppType::Dsh
        | AppType::Omp => {
            unreachable!("additive mode apps are handled by early return")
        }
    };

    let mut provider = Provider::with_id(
        "default".to_string(),
        "default".to_string(),
        settings_config,
        None,
    );
    // agy 的 Key 只在进程环境里，从不落盘：从 live 导入的一定是 agy 自己的登录。
    provider.category = Some(
        if matches!(app_type, AppType::Agy) {
            "official"
        } else {
            "custom"
        }
        .to_string(),
    );

    state.db.save_provider(app_type.as_str(), &provider)?;
    state
        .db
        .set_current_provider(app_type.as_str(), &provider.id)?;

    Ok(true) // 真正导入了
}

/// Remove an OpenCode provider from the live configuration
///
/// This is specific to OpenCode's additive mode - removing a provider
/// from the opencode.json file.
pub(crate) fn remove_opencode_provider_from_live(provider_id: &str) -> Result<(), AppError> {
    use crate::opencode_config;

    // Check if OpenCode config directory exists
    if !opencode_config::get_opencode_dir().exists() {
        log::debug!("OpenCode config directory doesn't exist, skipping removal of '{provider_id}'");
        return Ok(());
    }

    opencode_config::remove_provider(provider_id)?;
    log::info!("OpenCode provider '{provider_id}' removed from live config");

    Ok(())
}

/// Import all providers from OpenCode live config to database
///
/// This imports existing providers from ~/.config/opencode/opencode.json
/// into the CC Switch database. Each provider found will be added to the
/// database with is_current set to false.
pub fn import_opencode_providers_from_live(state: &AppState) -> Result<usize, AppError> {
    use crate::opencode_config;
    use crate::provider::{OpenCodeConfigFormat, OpenCodeProviderConfig};
    use serde::Deserialize;

    let providers = opencode_config::get_providers_with_format()?;
    if providers.is_empty() {
        return Ok(0);
    }

    let mut imported = 0;
    let existing = state.db.get_all_providers("opencode")?;

    for (id, (settings_config, format)) in providers {
        // Skip if already exists in database
        if existing.contains_key(&id) {
            log::debug!("OpenCode provider '{id}' already exists in database, skipping");
            continue;
        }

        // 校验与显示名提取不改变原始 JSON；原生 v2 声明只取 name。
        let name = match format {
            OpenCodeConfigFormat::V1 => match OpenCodeProviderConfig::deserialize(&settings_config)
            {
                Ok(config) => config.name,
                Err(e) => {
                    log::warn!("Failed to parse OpenCode provider '{id}': {e}");
                    continue;
                }
            },
            OpenCodeConfigFormat::V2 => settings_config
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned),
        };
        let native_format =
            (format == OpenCodeConfigFormat::V2).then_some(OpenCodeConfigFormat::V2);

        // Create provider
        let mut provider = Provider::with_id(
            id.clone(),
            name.unwrap_or_else(|| id.clone()),
            settings_config,
            None,
        );
        if native_format.is_some() {
            provider
                .meta
                .get_or_insert_with(Default::default)
                .opencode_config_format = native_format;
        }

        // Save to database
        if let Err(e) = state.db.save_provider("opencode", &provider) {
            log::warn!("Failed to import OpenCode provider '{id}': {e}");
            continue;
        }

        imported += 1;
        log::info!("Imported OpenCode provider '{id}' from live config");
    }

    Ok(imported)
}

/// Import all providers from OpenClaw live config to database
///
/// This imports existing providers from ~/.openclaw/openclaw.json
/// into the CC Switch database. Each provider found will be added to the
/// database with is_current set to false.
pub fn import_openclaw_providers_from_live(state: &AppState) -> Result<usize, AppError> {
    use crate::openclaw_config;

    let providers = openclaw_config::get_typed_providers()?;
    if providers.is_empty() {
        return Ok(0);
    }

    let mut imported = 0;
    let existing = state.db.get_all_providers("openclaw")?;

    for (id, config) in providers {
        // Validate: skip entries with empty id or no models
        if id.trim().is_empty() {
            log::warn!("Skipping OpenClaw provider with empty id");
            continue;
        }
        if config.models.is_empty() {
            log::warn!("Skipping OpenClaw provider '{id}': no models defined");
            continue;
        }

        // Skip if already exists in database
        if existing.contains_key(&id) {
            log::debug!("OpenClaw provider '{id}' already exists in database, skipping");
            continue;
        }

        // Convert to Value for settings_config
        let settings_config = match serde_json::to_value(&config) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Failed to serialize OpenClaw provider '{id}': {e}");
                continue;
            }
        };

        // Determine display name: use first model name if available, otherwise use id
        let display_name = config
            .models
            .first()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| id.clone());

        // Create provider
        let provider = Provider::with_id(id.clone(), display_name, settings_config, None);

        // Save to database
        if let Err(e) = state.db.save_provider("openclaw", &provider) {
            log::warn!("Failed to import OpenClaw provider '{id}': {e}");
            continue;
        }

        imported += 1;
        log::info!("Imported OpenClaw provider '{id}' from live config");
    }

    Ok(imported)
}

pub fn import_hermes_providers_from_live(state: &AppState) -> Result<usize, AppError> {
    let providers = crate::hermes_config::get_providers()?;
    if providers.is_empty() {
        return Ok(0);
    }

    let existing = state.db.get_all_providers("hermes")?;
    let mut imported = 0;
    for (id, settings_config) in providers {
        if existing.contains_key(&id) {
            continue;
        }
        let mut provider = Provider::with_id(id.clone(), id.clone(), settings_config, None);
        provider
            .meta
            .get_or_insert_with(Default::default)
            .live_config_managed = Some(true);
        state.db.save_provider("hermes", &provider)?;
        imported += 1;
    }
    Ok(imported)
}

/// Remove an OpenClaw provider from live config
///
/// This removes a specific provider from ~/.openclaw/openclaw.json
/// without affecting other providers in the file.
pub fn remove_openclaw_provider_from_live(provider_id: &str) -> Result<(), AppError> {
    use crate::openclaw_config;

    // Check if OpenClaw config directory exists
    if !openclaw_config::get_openclaw_dir().exists() {
        log::debug!("OpenClaw config directory doesn't exist, skipping removal of '{provider_id}'");
        return Ok(());
    }

    openclaw_config::remove_provider(provider_id)?;
    log::info!("OpenClaw provider '{provider_id}' removed from live config");

    Ok(())
}

pub fn remove_hermes_provider_from_live(provider_id: &str) -> Result<(), AppError> {
    crate::hermes_config::remove_provider(provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn category_less_fixed_follow_login_backfill_preserves_logout() {
        let provider = Provider::with_id(
            crate::database::CODEX_OFFICIAL_PROVIDER_ID.to_string(),
            "OpenAI Official".to_string(),
            json!({
                "auth": {
                    "auth_mode": "chatgpt",
                    "tokens": { "refresh_token": "old-refresh-token" }
                },
                "config": "model = \"old-model\"\n"
            }),
            None,
        );
        assert!(crate::proxy::providers::is_codex_official_provider(
            &provider
        ));

        for live_auth in [json!({}), json!({ "auth_mode": "chatgpt" })] {
            let live_settings = json!({
                "auth": live_auth,
                "config": "model = \"live-model\"\n"
            });
            let backfilled = restore_live_settings_for_provider_backfill(
                &AppType::Codex,
                &provider,
                live_settings.clone(),
            );

            assert_eq!(
                backfilled, live_settings,
                "a legacy official card must not restore the stored login after logout"
            );
        }
    }

    #[test]
    fn category_less_fixed_third_party_backfill_keeps_stored_api_key() {
        let provider = Provider::with_id(
            crate::database::CODEX_OFFICIAL_PROVIDER_ID.to_string(),
            "Custom API".to_string(),
            json!({
                "auth": { "OPENAI_API_KEY": "sk-db-only" },
                "config": "model_provider = \"custom\"\n"
            }),
            None,
        );
        assert!(!crate::proxy::providers::is_codex_official_provider(
            &provider
        ));
        let backfilled = restore_live_settings_for_provider_backfill(
            &AppType::Codex,
            &provider,
            json!({ "auth": {}, "config": "model_provider = \"custom\"\n" }),
        );

        assert_eq!(backfilled, provider.settings_config);
    }

    #[test]
    fn codex_switch_backfill_keeps_stored_auth_when_live_has_no_credential() {
        // Repro of #7433: the provider table declares its own Authorization
        // header, so the switch injects no bearer token into config.toml, and
        // default mode deletes the shared auth.json. Live is `{ auth: {}, … }`
        // while the stored key is the only remaining copy — the switch-away
        // backfill must keep it, while still capturing the Live config.toml.
        let mut provider = Provider::with_id(
            "header-auth".to_string(),
            "Header Auth".to_string(),
            json!({
                "auth": { "OPENAI_API_KEY": "sk-db-only" },
                "config": "model_provider = \"custom\"\nmodel = \"old-model\"\n"
            }),
            None,
        );
        provider.category = Some("custom".to_string());

        let live_settings = json!({
            "auth": {},
            "config": "model_provider = \"custom\"\nmodel = \"live-model\"\n"
        });

        let result =
            restore_live_settings_for_provider_backfill(&AppType::Codex, &provider, live_settings);

        assert_eq!(
            result.get("auth"),
            Some(&json!({ "OPENAI_API_KEY": "sk-db-only" })),
            "a credential-less Live auth.json must not erase the stored provider key"
        );
        assert_eq!(
            result.get("config"),
            Some(&json!(
                "model_provider = \"custom\"\nmodel = \"live-model\"\n"
            )),
            "Live still owns the config.toml snapshot"
        );
    }

    #[test]
    fn codex_switch_backfill_keeps_live_auth_when_it_carries_material() {
        // Positive control: a Live auth.json that does carry material stays
        // authoritative (the manual `~/.codex/auth.json` edit path).
        let mut provider = Provider::with_id(
            "custom".to_string(),
            "Custom".to_string(),
            json!({
                "auth": { "OPENAI_API_KEY": "sk-db-stale" },
                "config": "model_provider = \"custom\"\n"
            }),
            None,
        );
        provider.category = Some("custom".to_string());

        let live_settings = json!({
            "auth": { "OPENAI_API_KEY": "sk-live" },
            "config": "model_provider = \"custom\"\n"
        });

        let result =
            restore_live_settings_for_provider_backfill(&AppType::Codex, &provider, live_settings);

        assert_eq!(
            result.get("auth"),
            Some(&json!({ "OPENAI_API_KEY": "sk-live" }))
        );
    }

    #[test]
    fn proxy_oauth_codex_snapshot_neutralizes_official_auth_fallback() {
        let poisoned_config = "model_provider = \"custom\"\n\n[model_providers.custom]\nname = \"xai\"\nbase_url = \"https://api.x.ai/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n";
        let settings = json!({
            "auth": { "OPENAI_API_KEY": "" },
            "config": poisoned_config,
        });

        // The raw managed-OAuth snapshot is exactly what the keyless safety
        // gate refuses — the switch regression this neutralization fixes.
        assert!(crate::codex_config::preflight_codex_live_write(
            None,
            &settings["auth"],
            Some(poisoned_config)
        )
        .is_err());

        let mut provider = Provider::with_id(
            "grok-oauth".to_string(),
            "xAI (Grok) OAuth".to_string(),
            settings.clone(),
            None,
        );
        provider.meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("xai_oauth".to_string()),
            ..Default::default()
        });
        neutralize_codex_proxy_oauth_fallback(&AppType::Codex, &mut provider);
        let config = provider.settings_config["config"].as_str().expect("config");
        assert!(config.contains("requires_openai_auth = false"));
        assert!(crate::codex_config::preflight_codex_live_write(
            None,
            &provider.settings_config["auth"],
            Some(config)
        )
        .is_ok());

        // codex_oauth keeps its fallback shape — the official login IS its
        // credential — and non-Codex app types are untouched entirely.
        let mut official = Provider::with_id(
            "chatgpt".to_string(),
            "ChatGPT".to_string(),
            settings.clone(),
            None,
        );
        official.meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("codex_oauth".to_string()),
            ..Default::default()
        });
        neutralize_codex_proxy_oauth_fallback(&AppType::Codex, &mut official);
        assert!(official.settings_config["config"]
            .as_str()
            .expect("config")
            .contains("requires_openai_auth = true"));

        let mut claude_card = provider.clone();
        claude_card.settings_config = settings;
        neutralize_codex_proxy_oauth_fallback(&AppType::Claude, &mut claude_card);
        assert!(claude_card.settings_config["config"]
            .as_str()
            .expect("config")
            .contains("requires_openai_auth = true"));
    }

    #[test]
    fn update_toml_common_config_preserves_comments_and_key_order() {
        let config = r#"# user comment
model = "gpt-5.5"
model_provider = "custom"
disable_response_storage = true

[model_providers.custom]
# provider comment
name = "Custom"
base_url = "https://example.com/v1"
"#;
        let snippet = "[tui]\nnotifications = true\n";

        let merged = update_toml_common_config_snippet(config, snippet, true).unwrap();
        assert!(merged.contains("# user comment"));
        assert!(merged.contains("# provider comment"));
        assert!(merged.find("model = ").unwrap() < merged.find("model_provider = ").unwrap());
        assert!(
            merged.find("model_provider = ").unwrap()
                < merged.find("disable_response_storage").unwrap()
        );
        assert!(merged.contains("[tui]"));
        assert!(!merged.contains("[model_providers]\n"));

        let removed = update_toml_common_config_snippet(&merged, snippet, false).unwrap();
        assert!(!removed.contains("[tui]"));
        assert!(removed.contains("# user comment"));
    }

    #[test]
    fn update_toml_common_config_removes_only_matching_values() {
        let snippet = "[tui]\nnotifications = true\n";
        let merged =
            update_toml_common_config_snippet("[tui]\nnotifications = false\n", snippet, true)
                .unwrap();
        assert!(merged.contains("notifications = true"));

        let removed =
            update_toml_common_config_snippet("[tui]\nnotifications = false\n", snippet, false)
                .unwrap();
        assert!(removed.contains("notifications = false"));
    }

    #[test]
    fn claude_common_config_apply_and_remove_roundtrip_for_non_overlapping_fields() {
        let settings = json!({
            "env": {
                "ANTHROPIC_API_KEY": "sk-test"
            }
        });
        let snippet = r#"{
  "includeCoAuthoredBy": false,
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1"
  }
}"#;

        let applied =
            apply_common_config_to_settings(&AppType::Claude, &settings, snippet).unwrap();
        assert_eq!(applied["includeCoAuthoredBy"], json!(false));
        assert_eq!(applied["env"]["CLAUDE_CODE_USE_BEDROCK"], json!("1"));

        let stripped =
            remove_common_config_from_settings(&AppType::Claude, &applied, snippet).unwrap();
        assert_eq!(stripped, settings);
    }

    #[test]
    fn codex_common_config_apply_and_remove_roundtrip_for_non_overlapping_fields() {
        let settings = json!({
            "auth": {
                "OPENAI_API_KEY": "sk-test"
            },
            "config": "model_provider = \"openai\"\n[general]\nmodel = \"gpt-5\"\n"
        });
        let snippet = "[shared]\nreasoning = \"medium\"\n";

        let applied = apply_common_config_to_settings(&AppType::Codex, &settings, snippet).unwrap();
        let applied_config = applied["config"].as_str().unwrap_or_default();
        assert!(applied_config.contains("[shared]"));
        assert!(applied_config.contains("reasoning = \"medium\""));

        let stripped =
            remove_common_config_from_settings(&AppType::Codex, &applied, snippet).unwrap();
        assert_eq!(stripped, settings);
    }

    #[test]
    fn explicit_common_config_flag_overrides_legacy_subset_detection() {
        let mut provider = Provider::with_id(
            "claude-test".to_string(),
            "Claude Test".to_string(),
            json!({
                "includeCoAuthoredBy": false
            }),
            None,
        );
        provider.meta = Some(crate::provider::ProviderMeta {
            common_config_enabled: Some(false),
            ..Default::default()
        });

        assert!(
            !provider_uses_common_config(
                &AppType::Claude,
                &provider,
                Some(r#"{ "includeCoAuthoredBy": false }"#),
            ),
            "explicit false should win over legacy subset detection"
        );
    }

    #[test]
    fn claude_common_config_array_subset_detection_and_strip_preserve_extra_items() {
        let settings = json!({
            "allowedTools": ["tool1", "tool2"]
        });
        let snippet = r#"{
  "allowedTools": ["tool1"]
}"#;

        assert!(
            settings_contain_common_config(&AppType::Claude, &settings, snippet),
            "array subset should be detected for legacy providers"
        );

        let stripped =
            remove_common_config_from_settings(&AppType::Claude, &settings, snippet).unwrap();
        assert_eq!(
            stripped,
            json!({
                "allowedTools": ["tool2"]
            })
        );
    }

    #[test]
    fn codex_common_config_array_subset_detection_and_strip_preserve_extra_items() {
        let settings = json!({
            "auth": {},
            "config": "allowed_tools = [\"tool1\", \"tool2\"]\n"
        });
        let snippet = "allowed_tools = [\"tool1\"]\n";

        assert!(
            settings_contain_common_config(&AppType::Codex, &settings, snippet),
            "TOML array subset should be detected for legacy providers"
        );

        let stripped =
            remove_common_config_from_settings(&AppType::Codex, &settings, snippet).unwrap();
        assert_eq!(stripped["auth"], json!({}));
        let stripped_config = stripped["config"].as_str().unwrap_or_default();
        let parsed = stripped_config
            .parse::<DocumentMut>()
            .expect("stripped codex config should remain valid TOML");
        let allowed_tools = parsed["allowed_tools"]
            .as_array()
            .expect("allowed_tools should remain an array");
        let values: Vec<&str> = allowed_tools
            .iter()
            .map(|value| value.as_str().expect("tool id should be string"))
            .collect();
        assert_eq!(values, vec!["tool2"]);
    }

    #[test]
    fn grokbuild_backfill_does_not_persist_projected_mcp_servers() {
        let provider = Provider::with_id(
            "grok".to_string(),
            "Grok".to_string(),
            json!({ "config": "[models]\ndefault = \"grok\"\n" }),
            None,
        );
        let live = json!({
            "config": "[models]\ndefault = \"grok\"\n\n[mcp_servers.echo]\ncommand = \"echo\"\n"
        });

        let restored =
            restore_live_settings_for_provider_backfill(&AppType::GrokBuild, &provider, live);
        let config = restored["config"].as_str().expect("config text");
        assert!(config.contains("default = \"grok\""));
        assert!(!config.contains("mcp_servers"));
    }

    #[test]
    fn grokbuild_backfill_restores_custom_model_without_losing_live_edits() {
        let stored = "[models]\ndefault = \"relay\"\n\n[model.relay]\nmodel = \"grok\"\nname = \"Relay\"\nbase_url = \"https://example.com/v1\"\napi_key = \"test-key\"\napi_backend = \"responses\"\ncontext_window = 500000\n";
        let provider = Provider::with_id(
            "grok".into(),
            "Grok".into(),
            json!({"config": stored}),
            None,
        );
        for live in [
            stored.replace("default = \"relay\"", "default = \"builtin\""),
            stored.replace("default = \"relay\"\n", ""),
        ] {
            let live = format!("{live}\n# edited outside CC Switch\n[custom]\nvalue = 42\n\n[mcp_servers.echo]\ncommand = \"echo\"\n");
            let restored = restore_live_settings_for_provider_backfill(
                &AppType::GrokBuild,
                &provider,
                json!({"config": live}),
            );
            let config = restored["config"].as_str().unwrap();
            crate::grok_config::validate_config_toml(config).unwrap();
            assert_eq!(
                crate::grok_config::extract_model_config(config)
                    .unwrap()
                    .profile,
                "relay"
            );
            assert!(config.contains("# edited outside CC Switch"));
            assert!(config.contains("value = 42"));
            assert!(!config.contains("mcp_servers"));
        }
    }
}
