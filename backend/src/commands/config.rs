#![allow(non_snake_case)]

use crate::app_config::AppType;
use crate::codex_config;
use crate::config;
use crate::settings;

use std::str::FromStr;

pub(crate) enum ConfigCommandError {
    BadRequest(String),
    Internal(String),
}

impl ConfigCommandError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self::BadRequest(message.into())
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
}

pub(crate) fn invalid_json_format_error(error: serde_json::Error) -> String {
    let lang = settings::get_settings()
        .language
        .unwrap_or_else(|| "zh".to_string());

    match lang.as_str() {
        "en" => format!("Invalid JSON format: {error}"),
        "ja" => format!("JSON形式が無効です: {error}"),
        _ => format!("无效的 JSON 格式: {error}"),
    }
}

fn invalid_toml_format_error(error: toml_edit::TomlError) -> String {
    let lang = settings::get_settings()
        .language
        .unwrap_or_else(|| "zh".to_string());

    match lang.as_str() {
        "en" => format!("Invalid TOML format: {error}"),
        "ja" => format!("TOML形式が無効です: {error}"),
        _ => format!("无效的 TOML 格式: {error}"),
    }
}

pub(crate) fn validate_common_config_snippet(app_type: &str, snippet: &str) -> Result<(), String> {
    if snippet.trim().is_empty() {
        return Ok(());
    }

    match app_type {
        "claude" | "gemini" | "omo" | "omo-slim" => {
            serde_json::from_str::<serde_json::Value>(snippet)
                .map_err(invalid_json_format_error)?;
        }
        "codex" => {
            snippet
                .parse::<toml_edit::DocumentMut>()
                .map_err(invalid_toml_format_error)?;
        }
        _ => {}
    }

    Ok(())
}

pub(crate) fn get_config_dir_internal(app: String) -> Result<String, String> {
    if app == "hermes" {
        return Ok(crate::hermes_config::get_hermes_dir()
            .to_string_lossy()
            .to_string());
    }

    let dir = match AppType::from_str(&app).map_err(|e| e.to_string())? {
        // C-Phase0 脚手架：claude-desktop 配置目录尚未实现
        AppType::ClaudeDesktop => {
            return Err("claude-desktop 运行时尚未实现（C-Phase0 脚手架）".to_string())
        }
        AppType::Claude => config::get_claude_config_dir(),
        AppType::Codex => codex_config::get_codex_config_dir(),
        AppType::Gemini => crate::gemini_config::get_gemini_dir(),
        AppType::OpenCode => crate::opencode_config::get_opencode_dir(),
        AppType::OpenClaw => crate::openclaw_config::get_openclaw_dir(),
    };

    Ok(dir.to_string_lossy().to_string())
}

pub(crate) fn get_default_config_dir_internal(app: String) -> Result<String, String> {
    if app == "hermes" {
        return Ok(crate::hermes_config::get_default_hermes_dir()
            .to_string_lossy()
            .to_string());
    }

    let dir = match AppType::from_str(&app).map_err(|e| e.to_string())? {
        // C-Phase0 脚手架：claude-desktop 配置目录尚未实现
        AppType::ClaudeDesktop => {
            return Err("claude-desktop 运行时尚未实现（C-Phase0 脚手架）".to_string())
        }
        AppType::Claude => config::get_default_claude_config_dir(),
        AppType::Codex => codex_config::get_default_codex_config_dir(),
        AppType::Gemini => crate::gemini_config::get_default_gemini_dir(),
        AppType::OpenCode => crate::opencode_config::get_default_opencode_dir(),
        AppType::OpenClaw => crate::openclaw_config::get_default_openclaw_dir(),
    };

    Ok(dir.to_string_lossy().to_string())
}

pub(crate) fn get_common_config_snippet_internal(
    state: &crate::store::AppState,
    app_type: &str,
) -> Result<Option<String>, String> {
    state
        .db
        .get_config_snippet(app_type)
        .map_err(|e| e.to_string())
}

pub(crate) fn set_common_config_snippet_internal(
    state: &crate::store::AppState,
    app_type: &str,
    snippet: String,
) -> Result<(), ConfigCommandError> {
    let is_cleared = snippet.trim().is_empty();
    let old_snippet = state
        .db
        .get_config_snippet(app_type)
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;

    validate_common_config_snippet(app_type, &snippet).map_err(ConfigCommandError::bad_request)?;

    let value = if is_cleared { None } else { Some(snippet) };

    if matches!(app_type, "claude" | "codex" | "gemini") {
        if let Some(legacy_snippet) = old_snippet
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let app = AppType::from_str(app_type)
                .map_err(|e| ConfigCommandError::bad_request(e.to_string()))?;
            crate::services::provider::ProviderService::migrate_legacy_common_config_usage(
                state,
                app,
                legacy_snippet,
            )
            .map_err(|e| ConfigCommandError::internal(e.to_string()))?;
        }
    }

    state
        .db
        .set_config_snippet(app_type, value)
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;
    state
        .db
        .set_config_snippet_cleared(app_type, is_cleared)
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;

    if matches!(app_type, "claude" | "codex" | "gemini") {
        let app = AppType::from_str(app_type)
            .map_err(|e| ConfigCommandError::bad_request(e.to_string()))?;
        crate::services::provider::ProviderService::sync_current_provider_for_app(
            state,
            app,
        )
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;
    }

    if app_type == "omo"
        && state
            .db
            .get_current_omo_provider("opencode", "omo")
            .map_err(|e| ConfigCommandError::internal(e.to_string()))?
            .is_some()
    {
        crate::services::omo::OmoService::write_config_to_file(
            state,
            &crate::services::omo::STANDARD,
        )
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;
    }
    if app_type == "omo-slim"
        && state
            .db
            .get_current_omo_provider("opencode", "omo-slim")
            .map_err(|e| ConfigCommandError::internal(e.to_string()))?
            .is_some()
    {
        crate::services::omo::OmoService::write_config_to_file(
            state,
            &crate::services::omo::SLIM,
        )
        .map_err(|e| ConfigCommandError::internal(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_common_config_snippet;

    #[test]
    fn validate_common_config_snippet_accepts_comment_only_codex_snippet() {
        validate_common_config_snippet("codex", "# comment only\n")
            .expect("comment-only codex snippet should be valid");
    }

    #[test]
    fn validate_common_config_snippet_rejects_invalid_codex_snippet() {
        let err = validate_common_config_snippet("codex", "[broken")
            .expect_err("invalid codex snippet should be rejected");
        assert!(
            err.contains("TOML") || err.contains("toml") || err.contains("格式"),
            "expected TOML validation error, got {err}"
        );
    }
}

pub(crate) fn extract_common_config_snippet_internal(
    state: &crate::store::AppState,
    app: AppType,
    settings: Option<serde_json::Value>,
) -> Result<String, ConfigCommandError> {
    if let Some(settings) = settings {
        return crate::services::provider::ProviderService::extract_common_config_snippet_from_settings(
            app,
            &settings,
        )
        .map_err(|e| ConfigCommandError::internal(e.to_string()));
    }

    crate::services::provider::ProviderService::extract_common_config_snippet(state, app)
        .map_err(|e| ConfigCommandError::internal(e.to_string()))
}
