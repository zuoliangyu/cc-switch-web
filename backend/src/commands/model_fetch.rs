use crate::services::model_fetch::{self, FetchedModel};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModelRef {
    pub provider_id: String,
    pub model_id: String,
}

/// Read the current runtime's model list. No shell and no credential values in errors.
///
/// Without a key this asks the signed-in agy. With a key it runs agy in API-key mode from a
/// throwaway `--gemini_dir`: that mode only accepts agy's built-in Gemini models (by display
/// name), which the Gemini API's own model list does not match.
#[allow(non_snake_case)]
pub(crate) async fn get_agy_models_internal(
    apiKey: Option<String>,
    baseUrl: Option<String>,
) -> Result<Vec<FetchedModel>, String> {
    let api_key = apiKey.filter(|key| !key.trim().is_empty());
    let base_url = baseUrl.filter(|url| !url.trim().is_empty());
    // 登录态不在 settings.json 里：首次使用、只用官方登录时它可能还不存在，列模型只依赖
    // CLI 自己。文件在但坏了照样报错，免得静默略过。
    if api_key.is_none() && crate::agy_config::settings_path().exists() {
        crate::agy_config::read_live_settings().map_err(|e| e.to_string())?;
    }
    let path = tokio::task::spawn_blocking(crate::agy_config::real_agy_bin)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Antigravity CLI not found; install agy first".to_string())?;
    let mut command = crate::agy_config::background_command(&path);
    command
        .kill_on_drop(true)
        .env_remove("GEMINI_API_KEY")
        .env_remove("GOOGLE_GEMINI_BASE_URL");
    // Dropped (and removed) after the command finishes.
    let _scratch = match &api_key {
        Some(key) => {
            let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
            let settings = dir.path().join("antigravity-cli").join("settings.json");
            std::fs::create_dir_all(dir.path().join("antigravity-cli"))
                .map_err(|e| e.to_string())?;
            std::fs::write(&settings, br#"{"modelProvider":"gemini"}"#)
                .map_err(|e| e.to_string())?;
            command
                .arg(format!("--gemini_dir={}", dir.path().display()))
                .current_dir(dir.path())
                .env("GEMINI_API_KEY", key);
            if let Some(url) = &base_url {
                command.env("GOOGLE_GEMINI_BASE_URL", url);
            }
            Some(dir)
        }
        None => None,
    };
    command.arg("models");
    let output = tokio::time::timeout(std::time::Duration::from_secs(20), command.output())
        .await
        .map_err(|_| "Antigravity model discovery timed out".to_string())?
        .map_err(|_| "Antigravity CLI not found; install agy first".to_string())?;
    if !output.status.success() {
        return Err("Antigravity could not list models. Check the API key and endpoint, or sign in with agy for official models.".into());
    }
    Ok(parse_agy_models(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_agy_models(output: &str) -> Vec<FetchedModel> {
    let mut names = BTreeMap::new();
    for line in output.lines() {
        let Some((id, name)) = line.trim().split_once('\t') else {
            continue;
        };
        let name = name.trim();
        if id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
            || name.is_empty()
            || name.chars().any(char::is_control)
        {
            continue;
        }
        names
            .entry(id.to_string())
            .or_insert_with(|| name.to_string());
    }
    // Native settings.json stores the display name, unlike the --model flag
    // which accepts the first-column CLI alias. Persisting that alias silently
    // falls back to the runtime's default model in account-login mode.
    names
        .into_values()
        .map(|id| FetchedModel { id, owned_by: None })
        .collect()
}

const OPENCODE_MODELS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

fn opencode_models_command(config_dir: &std::path::Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new("opencode");
    command
        .arg("models")
        .current_dir(&config_dir)
        .env("OPENCODE_CONFIG_DIR", &config_dir)
        .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x08000000);
    }
    command
}

pub(crate) async fn get_opencode_models_internal() -> Result<Vec<OpenCodeModelRef>, String> {
    let config_dir = crate::opencode_config::get_opencode_dir();
    std::fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Failed to prepare OpenCode config directory: {error}"))?;
    let mut command = opencode_models_command(&config_dir);

    let output = tokio::time::timeout(OPENCODE_MODELS_TIMEOUT, command.output())
        .await
        .map_err(|_| "OpenCode model discovery timed out after 20 seconds".to_string())?
        .map_err(|error| format!("Failed to run opencode models: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Failed to load OpenCode models".to_string()
        } else {
            format!("Failed to load OpenCode models: {detail}")
        });
    }

    Ok(parse_opencode_models(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_opencode_models(output: &str) -> Vec<OpenCodeModelRef> {
    output
        .lines()
        .filter_map(|line| {
            let (provider_id, model_id) = line.trim().split_once('/')?;
            if provider_id.is_empty()
                || model_id.is_empty()
                || !provider_id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                || model_id
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control())
            {
                return None;
            }
            Some((provider_id.to_string(), model_id.to_string()))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|(provider_id, model_id)| OpenCodeModelRef {
            provider_id,
            model_id,
        })
        .collect()
}

pub(crate) async fn fetch_models_for_config_internal(
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    models_url_override: Option<String>,
    custom_user_agent: Option<String>,
    api_format: Option<String>,
    request_headers: Option<std::collections::BTreeMap<String, String>>,
) -> Result<Vec<FetchedModel>, String> {
    let user_agent = crate::provider::parse_custom_user_agent(custom_user_agent.as_deref())
        .ok()
        .flatten();
    model_fetch::fetch_models(
        &base_url,
        &api_key,
        is_full_url.unwrap_or(false),
        models_url_override.as_deref(),
        user_agent,
        api_format.as_deref(),
        request_headers.as_ref(),
    )
    .await
}

pub(crate) async fn fetch_xai_oauth_models_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<Vec<FetchedModel>, String> {
    let manager = state.read().await;
    let account_id = match account_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => id.to_string(),
        None => manager
            .default_account_id()
            .await
            .ok_or_else(|| "No usable xAI account available".to_string())?,
    };
    let token = manager
        .get_valid_token_for_account(&account_id)
        .await
        .map_err(|error| format!("xAI OAuth token unavailable: {error}"))?;

    model_fetch::fetch_models(
        crate::proxy::providers::XAI_API_BASE_URL,
        &token,
        false,
        None,
        None,
        None,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        opencode_models_command, parse_opencode_models, OpenCodeModelRef, OPENCODE_MODELS_TIMEOUT,
    };

    #[test]
    fn w3_parses_sorts_and_filters_opencode_models() {
        assert_eq!(
            parse_opencode_models(
                "openrouter/vendor/model\nopencode/free-model\ninvalid\nopencode/free-model\nbad provider/model\n"
            ),
            vec![
                OpenCodeModelRef {
                    provider_id: "opencode".to_string(),
                    model_id: "free-model".to_string(),
                },
                OpenCodeModelRef {
                    provider_id: "openrouter".to_string(),
                    model_id: "vendor/model".to_string(),
                },
            ]
        );
    }

    #[test]
    fn w3_opencode_models_command_is_isolated_and_bounded() {
        let config_dir = std::path::Path::new("isolated-opencode-config");
        let command = opencode_models_command(config_dir);
        let command = command.as_std();
        let envs: std::collections::HashMap<_, _> = command.get_envs().collect();

        assert_eq!(command.get_current_dir(), Some(config_dir));
        assert_eq!(
            envs.get(std::ffi::OsStr::new("OPENCODE_CONFIG_DIR")),
            Some(&Some(config_dir.as_os_str()))
        );
        assert_eq!(
            envs.get(std::ffi::OsStr::new("OPENCODE_DISABLE_PROJECT_CONFIG")),
            Some(&Some(std::ffi::OsStr::new("true")))
        );
        assert_eq!(OPENCODE_MODELS_TIMEOUT.as_secs(), 20);
    }
}

pub(crate) async fn fetch_codex_oauth_models_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
) -> Result<Vec<FetchedModel>, String> {
    let manager = state.read().await;
    let id = match account_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => id.to_string(),
        None => manager
            .default_account_id()
            .await
            .ok_or("No ChatGPT account available")?,
    };
    let token = manager
        .get_valid_token_for_account(&id)
        .await
        .map_err(|e| format!("Codex OAuth token unavailable: {e}"))?;
    let chatgpt_id = manager
        .chatgpt_account_id_for_account(&id)
        .await
        .map_err(|e| e.to_string())?;
    drop(manager);
    crate::services::codex_oauth_models::fetch_models_with_token(&token, &chatgpt_id).await
}
