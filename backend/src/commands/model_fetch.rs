use crate::services::model_fetch::{self, FetchedModel};
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModelRef {
    pub provider_id: String,
    pub model_id: String,
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

    Ok(parse_opencode_models(&String::from_utf8_lossy(&output.stdout)))
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
    )
    .await
}

pub(crate) async fn fetch_xai_oauth_models_internal(
    account_id: Option<String>,
    state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<Vec<FetchedModel>, String> {
    let manager = state.read().await;
    let account_id = match account_id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
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
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        opencode_models_command, parse_opencode_models, OpenCodeModelRef,
        OPENCODE_MODELS_TIMEOUT,
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
