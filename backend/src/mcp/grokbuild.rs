//! Grok Build MCP 同步与导入。
//!
//! Grok Build 与 Codex 都使用顶层 `[mcp_servers]` TOML，但远程连接字段略有差异。

use serde_json::{json, Value};

use crate::app_config::AppType;
use crate::error::AppError;

use super::codex::json_server_to_toml_table;
use super::validation::validate_server_spec;
use super::{merge_imported_server, ImportedMcpServers};

fn should_sync() -> bool {
    crate::grok_config::get_grok_config_dir().exists()
}

fn read_config_text() -> Result<String, AppError> {
    let path = crate::grok_config::get_grok_config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|error| AppError::io(&path, error))
}

fn json_server_to_grokbuild_table(server: &Value) -> Result<toml_edit::Table, AppError> {
    let mut table = json_server_to_toml_table(server)?;
    table.remove("type");
    if let Some(headers) = table.remove("http_headers") {
        table.insert("headers", headers);
    }
    Ok(table)
}

fn toml_server_to_json(entry: &toml::value::Table) -> Value {
    fn convert(value: &toml::Value) -> Value {
        match value {
            toml::Value::String(value) => json!(value),
            toml::Value::Integer(value) => json!(value),
            toml::Value::Float(value) => json!(value),
            toml::Value::Boolean(value) => json!(value),
            toml::Value::Datetime(value) => json!(value.to_string()),
            toml::Value::Array(values) => {
                Value::Array(values.iter().map(convert).collect::<Vec<_>>())
            }
            toml::Value::Table(values) => Value::Object(
                values
                    .iter()
                    .map(|(key, value)| (key.clone(), convert(value)))
                    .collect(),
            ),
        }
    }

    let mut spec = serde_json::Map::new();
    for (key, value) in entry {
        let output_key = if key == "http_headers" { "headers" } else { key };
        spec.insert(output_key.to_string(), convert(value));
    }
    let default_type = if spec.contains_key("url") { "http" } else { "stdio" };
    spec.entry("type".to_string())
        .or_insert_with(|| json!(default_type));
    Value::Object(spec)
}

pub fn import_from_grokbuild(servers: &mut ImportedMcpServers) -> Result<usize, AppError> {
    let text = read_config_text()?;
    if text.trim().is_empty() {
        return Ok(0);
    }
    let root: toml::Table = toml::from_str(&text)
        .map_err(|error| AppError::McpValidation(format!("解析 Grok Build config.toml 失败: {error}")))?;
    let Some(entries) = root.get("mcp_servers").and_then(toml::Value::as_table) else {
        return Ok(0);
    };

    let mut changed = 0;
    for (id, entry) in entries {
        let Some(entry) = entry.as_table() else {
            continue;
        };
        let spec = toml_server_to_json(entry);
        if let Err(error) = validate_server_spec(&spec) {
            log::warn!("跳过无效 Grok Build MCP 项 '{id}': {error}");
            continue;
        }
        changed += usize::from(merge_imported_server(
            servers,
            id,
            spec,
            AppType::GrokBuild,
        ));
    }
    Ok(changed)
}

pub fn sync_single_server_to_grokbuild(id: &str, server: &Value) -> Result<(), AppError> {
    if !should_sync() {
        return Ok(());
    }

    let path = crate::grok_config::get_grok_config_path();
    let text = read_config_text()?;
    let mut document = if text.trim().is_empty() {
        toml_edit::DocumentMut::new()
    } else {
        text.parse::<toml_edit::DocumentMut>().map_err(|error| {
            AppError::McpValidation(format!("解析 Grok Build config.toml 失败: {error}"))
        })?
    };
    if document
        .get("mcp_servers")
        .is_none_or(|item| item.as_table_like().is_none())
    {
        if document
            .get("mcp_servers")
            .is_some_and(|item| !item.is_none())
        {
            log::warn!("Grok Build config.toml 的 mcp_servers 不是表，已重置为空表");
        }
        document["mcp_servers"] = toml_edit::table();
    }
    let servers = document
        .get_mut("mcp_servers")
        .and_then(toml_edit::Item::as_table_like_mut)
        .ok_or_else(|| {
            AppError::McpValidation("Grok Build config.toml 的 mcp_servers 不是表".to_string())
        })?;
    servers.insert(
        id,
        toml_edit::Item::Table(json_server_to_grokbuild_table(server)?),
    );
    crate::config::write_text_file(&path, &document.to_string())
}

pub fn remove_server_from_grokbuild(id: &str) -> Result<(), AppError> {
    if !should_sync() {
        return Ok(());
    }
    let path = crate::grok_config::get_grok_config_path();
    if !path.exists() {
        return Ok(());
    }
    let text = read_config_text()?;
    let mut document = match text.parse::<toml_edit::DocumentMut>() {
        Ok(document) => document,
        Err(error) => {
            log::warn!("解析 Grok Build config.toml 失败: {error}，跳过删除操作");
            return Ok(());
        }
    };
    if let Some(item) = document.get_mut("mcp_servers") {
        let user_authored = !item.is_none();
        match item.as_table_like_mut() {
            Some(servers) => {
                servers.remove(id);
            }
            None if user_authored => {
                log::warn!("Grok Build config.toml 的 mcp_servers 不是表，无法删除 '{id}'");
            }
            None => {}
        }
    }
    crate::config::write_text_file(&path, &document.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    fn remote_server_uses_grok_header_shape() {
        let table = json_server_to_grokbuild_table(&json!({
            "type": "http",
            "url": "https://example.com/mcp",
            "headers": { "Authorization": "Bearer token" }
        }))
        .expect("convert server");
        assert!(!table.contains_key("type"));
        assert!(!table.contains_key("http_headers"));
        assert!(table.contains_key("headers"));
    }

    #[test]
    #[serial]
    fn sync_import_and_remove_preserve_model_config() {
        let temp = tempfile::tempdir().expect("temp home");
        let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        crate::settings::reload_settings().expect("reload settings");
        crate::grok_config::write_grok_live_settings(&json!({ "config": "[models]\ndefault = \"grok\"\n" }))
            .expect("seed config");

        sync_single_server_to_grokbuild(
            "demo",
            &json!({ "type": "stdio", "command": "demo", "args": ["--serve"] }),
        )
        .expect("sync server");
        let mut imported = ImportedMcpServers::new();
        assert_eq!(import_from_grokbuild(&mut imported).unwrap(), 1);
        assert!(imported["demo"].apps.grokbuild);
        remove_server_from_grokbuild("demo").expect("remove server");
        let text = read_config_text().unwrap();
        assert!(text.contains("default = \"grok\""));
        assert!(!text.contains("[mcp_servers.demo]"));

        match previous {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
        crate::settings::reload_settings().expect("restore settings");
    }
}
