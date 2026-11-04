use crate::proxy::providers::codex_oauth_auth::CodexOAuthError;
use crate::proxy::providers::copilot_auth::{
    CopilotAuthError, GitHubAccount, GitHubDeviceCodeResponse,
};
use crate::proxy::providers::xai_oauth_auth::{XaiOAuthAccount, XaiOAuthError};
use std::sync::Arc;
use tokio::sync::RwLock;

const AUTH_PROVIDER_GITHUB_COPILOT: &str = "github_copilot";
const AUTH_PROVIDER_CODEX_OAUTH: &str = "codex_oauth";
const AUTH_PROVIDER_XAI_OAUTH: &str = "xai_oauth";
const AUTH_PROVIDER_AGY_OAUTH: &str = "agy_oauth";
const AUTH_PROVIDER_CLAUDE_OFFICIAL: &str = "claude_official";

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthAccount {
    pub id: String,
    pub provider: String,
    pub login: String,
    pub avatar_url: Option<String>,
    pub authenticated_at: i64,
    pub is_default: bool,
    pub github_domain: String,
    /// Codex 旧账号缺少写入原生 auth.json 所需的 id_token。
    pub reauth_required: bool,
    pub requires_reauth: bool,
    /// Claude 官方专用：不在 Claude Code 默认登录里的账号，登录约什么时候过期（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_expires_at: Option<i64>,
    /// Claude 官方专用：套餐（`pro` / `max` / `team` / `enterprise`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Claude 官方专用：凭据里的 `rateLimitTier`，区分 Max 5x / 20x
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_tier: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthStatus {
    pub provider: String,
    pub authenticated: bool,
    pub default_account_id: Option<String>,
    pub migration_error: Option<String>,
    pub accounts: Vec<ManagedAuthAccount>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthDeviceCodeResponse {
    pub provider: String,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

fn ensure_auth_provider(auth_provider: &str) -> Result<&str, String> {
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => Ok(AUTH_PROVIDER_GITHUB_COPILOT),
        AUTH_PROVIDER_CODEX_OAUTH => Ok(AUTH_PROVIDER_CODEX_OAUTH),
        AUTH_PROVIDER_XAI_OAUTH => Ok(AUTH_PROVIDER_XAI_OAUTH),
        AUTH_PROVIDER_AGY_OAUTH => Ok(AUTH_PROVIDER_AGY_OAUTH),
        AUTH_PROVIDER_CLAUDE_OFFICIAL => Ok(AUTH_PROVIDER_CLAUDE_OFFICIAL),
        _ => Err(format!("Unsupported auth provider: {auth_provider}")),
    }
}

fn map_account(
    provider: &str,
    account: GitHubAccount,
    default_account_id: Option<&str>,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: default_account_id == Some(account.id.as_str()),
        id: account.id,
        provider: provider.to_string(),
        login: account.login,
        avatar_url: account.avatar_url,
        authenticated_at: account.authenticated_at,
        github_domain: account.github_domain,
        reauth_required: account.reauth_required,
        requires_reauth: false,
        login_expires_at: None,
        plan: None,
        rate_limit_tier: None,
    }
}

fn map_xai_account(
    account: XaiOAuthAccount,
    default_account_id: Option<&str>,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: default_account_id == Some(account.id.as_str()),
        id: account.id,
        provider: AUTH_PROVIDER_XAI_OAUTH.to_string(),
        login: account.login,
        avatar_url: account.avatar_url,
        authenticated_at: account.authenticated_at,
        github_domain: account.github_domain,
        reauth_required: false,
        requires_reauth: account.requires_reauth,
        login_expires_at: None,
        plan: None,
        rate_limit_tier: None,
    }
}

fn map_agy_account(
    account: crate::services::agy_account::AgyAccount,
    current_account_id: Option<&str>,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: current_account_id == Some(account.id.as_str()),
        login: account.label(),
        avatar_url: account.picture,
        authenticated_at: account.authenticated_at,
        github_domain: "google.com".to_string(),
        reauth_required: false,
        requires_reauth: account.requires_reauth,
        provider: AUTH_PROVIDER_AGY_OAUTH.to_string(),
        id: account.id,
        login_expires_at: None,
        plan: None,
        rate_limit_tier: None,
    }
}

/// Claude 官方账号没有「默认账号」：用哪个号由绑定它的官方卡决定。
fn map_claude_account(
    account: crate::services::claude_account::ClaudeAccount,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: false,
        login: account.label(),
        avatar_url: None,
        authenticated_at: account.authenticated_at,
        github_domain: "claude.ai".to_string(),
        reauth_required: false,
        requires_reauth: account.requires_reauth,
        login_expires_at: account.login_expires_at,
        plan: account.plan.clone(),
        rate_limit_tier: account.rate_limit_tier.clone(),
        provider: AUTH_PROVIDER_CLAUDE_OFFICIAL.to_string(),
        id: account.id,
    }
}

fn map_device_code_response(
    provider: &str,
    response: GitHubDeviceCodeResponse,
) -> ManagedAuthDeviceCodeResponse {
    ManagedAuthDeviceCodeResponse {
        provider: provider.to_string(),
        device_code: response.device_code,
        user_code: response.user_code,
        verification_uri: response.verification_uri,
        expires_in: response.expires_in,
        interval: response.interval,
    }
}

pub(crate) async fn auth_start_login_internal(
    auth_provider: &str,
    target_account_id: Option<&str>,
    login_method: Option<&str>,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<ManagedAuthDeviceCodeResponse, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    // 部分 ChatGPT 工作区禁用设备码登录：Codex OAuth 另有浏览器登录（PKCE，回调落在服务端本机 1455 端口）
    let browser_login = match login_method.unwrap_or("device_code") {
        "device_code" => false,
        "browser" if auth_provider == AUTH_PROVIDER_CODEX_OAUTH => true,
        // Claude 官方账号：只给链接、不打开浏览器（Web 本来就不在服务端开浏览器，见下）
        "copy_link" if auth_provider == AUTH_PROVIDER_CLAUDE_OFFICIAL => false,
        _ => return Err("Unsupported login method for this auth provider".into()),
    };
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            if target_account_id.is_some() {
                return Err("Targeted re-authentication is only supported for Codex OAuth".into());
            }
            let auth_manager = copilot_state.read().await;
            let response = auth_manager
                .start_device_flow()
                .await
                .map_err(|e| e.to_string())?;
            Ok(map_device_code_response(auth_provider, response))
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.read().await;
            let response = if browser_login {
                auth_manager.start_browser_flow(target_account_id).await
            } else {
                auth_manager.start_device_flow(target_account_id).await
            }
            .map_err(|e| e.to_string())?;
            Ok(map_device_code_response(auth_provider, response))
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            if target_account_id.is_some() {
                return Err("Targeted re-authentication is only supported for Codex OAuth".into());
            }
            let auth_manager = xai_state.read().await;
            let response = auth_manager
                .start_device_flow()
                .await
                .map_err(|e| e.to_string())?;
            Ok(map_device_code_response(auth_provider, response))
        }
        // 浏览器登录没有用户码：device_code 放这次登录的 id，verification_uri 放授权页地址
        AUTH_PROVIDER_AGY_OAUTH => {
            if target_account_id.is_some() {
                return Err("Targeted re-authentication is only supported for Codex OAuth".into());
            }
            let start = crate::commands::agy_account_manager()
                .start_login()
                .await
                .map_err(|e| e.to_string())?;
            Ok(ManagedAuthDeviceCodeResponse {
                provider: auth_provider.to_string(),
                device_code: start.flow_id,
                user_code: String::new(),
                verification_uri: start.auth_url,
                expires_in: start.expires_in,
                interval: 1,
            })
        }
        // 同上：在新账号目录里跑 `claude auth login`，授权页地址是它要打开的那个。Web 一律不在
        // 服务端开浏览器（用户的浏览器可能在别的机器上）：地址交给前端，回不到服务端本机时
        // 由用户把落地页地址或代码贴回来（claude_account_submit_paste）
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            if target_account_id.is_some() {
                return Err("Targeted re-authentication is only supported for Codex OAuth".into());
            }
            let start = crate::commands::claude_account_manager()
                .start_login(false)
                .await
                .map_err(|e| e.to_string())?;
            Ok(ManagedAuthDeviceCodeResponse {
                provider: auth_provider.to_string(),
                device_code: start.flow_id,
                user_code: String::new(),
                verification_uri: start.auth_url,
                expires_in: start.expires_in,
                interval: 1,
            })
        }
        _ => unreachable!(),
    }
}

pub(crate) async fn auth_poll_for_account_internal(
    app_state: &crate::store::AppState,
    auth_provider: &str,
    device_code: &str,
    proxy_service: &crate::services::proxy::ProxyService,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<Option<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.write().await;
            match auth_manager.poll_for_token(device_code).await {
                Ok(account) => {
                    let default_account_id = auth_manager.get_status().await.default_account_id;
                    Ok(account.map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    }))
                }
                Err(CopilotAuthError::AuthorizationPending) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.write().await;
            // 提交新账号前持有 Codex 切换锁，避免与 Provider 切换 / 接管并发写 live（上游 c2ec78dd）。
            match auth_manager
                .poll_for_token(device_code, || async {
                    proxy_service
                        .lock_switch_for_app(crate::app_config::AppType::Codex.as_str())
                        .await
                })
                .await
            {
                Ok(account) => {
                    let default_account_id = auth_manager.get_status().await.default_account_id;
                    Ok(account.map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    }))
                }
                Err(CodexOAuthError::AuthorizationPending) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.write().await;
            match auth_manager.poll_for_token(device_code).await {
                Ok(account) => {
                    let default_account_id = auth_manager.get_status().await.default_account_id;
                    Ok(account
                        .map(|account| map_xai_account(account, default_account_id.as_deref())))
                }
                Err(XaiOAuthError::AuthorizationPending) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        AUTH_PROVIDER_AGY_OAUTH => {
            let manager = crate::commands::agy_account_manager();
            let Some(account) = manager
                .poll_login(device_code)
                .await
                .map_err(|e| e.to_string())?
            else {
                return Ok(None);
            };
            let current = manager
                .status()
                .await
                .ok()
                .and_then(|status| status.current_account_id);
            Ok(Some(map_agy_account(account, current.as_deref())))
        }
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            let account = crate::commands::claude_account_manager()
                .poll_login(device_code)
                .await
                .map_err(|e| e.to_string())?;
            if account.is_some() {
                // 同一账号重新登录会换掉目录：正在用它的官方卡要把新目录写进 live
                crate::services::provider::claude_official::refresh_live_after_account_change(
                    app_state,
                    &crate::commands::claude_account_manager(),
                )
                .await?;
            }
            Ok(account.map(map_claude_account))
        }
        _ => unreachable!(),
    }
}

/// 取消进行中的 Codex OAuth device flow（仅 Codex 支持）。
pub(crate) async fn auth_cancel_login_internal(
    auth_provider: &str,
    device_code: &str,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
) -> Result<bool, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    if auth_provider == AUTH_PROVIDER_AGY_OAUTH {
        return Ok(crate::commands::agy_account_manager()
            .cancel_login(device_code)
            .await);
    }
    if auth_provider == AUTH_PROVIDER_CLAUDE_OFFICIAL {
        return Ok(crate::commands::claude_account_manager()
            .cancel_login(device_code)
            .await);
    }
    if auth_provider != AUTH_PROVIDER_CODEX_OAUTH {
        return Err("Login cancellation is only supported for Codex OAuth".to_string());
    }
    Ok(codex_state
        .read()
        .await
        .cancel_device_flow(device_code)
        .await)
}

pub(crate) async fn auth_list_accounts_internal(
    auth_provider: &str,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<Vec<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_account(auth_provider, account, default_account_id.as_deref()))
                .collect())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_account(auth_provider, account, default_account_id.as_deref()))
                .collect())
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_xai_account(account, default_account_id.as_deref()))
                .collect())
        }
        AUTH_PROVIDER_AGY_OAUTH => {
            let status = crate::commands::agy_account_manager()
                .status()
                .await
                .map_err(|e| e.to_string())?;
            let current = status.current_account_id;
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_agy_account(account, current.as_deref()))
                .collect())
        }
        AUTH_PROVIDER_CLAUDE_OFFICIAL => Ok(crate::commands::claude_account_manager()
            .list()
            .await
            .into_iter()
            .map(map_claude_account)
            .collect()),
        _ => unreachable!(),
    }
}

pub(crate) async fn auth_get_status_internal(
    auth_provider: &str,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<ManagedAuthStatus, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: status.authenticated,
                default_account_id: default_account_id.clone(),
                migration_error: status.migration_error,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect(),
            })
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: status.authenticated,
                default_account_id: default_account_id.clone(),
                migration_error: None,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect(),
            })
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: status.authenticated,
                default_account_id: default_account_id.clone(),
                migration_error: None,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| map_xai_account(account, default_account_id.as_deref()))
                    .collect(),
            })
        }
        // 「默认账号」在这里是 agy 当前登录的那个号
        AUTH_PROVIDER_AGY_OAUTH => {
            let status = crate::commands::agy_account_manager()
                .status()
                .await
                .map_err(|e| e.to_string())?;
            let current = status.current_account_id;
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: !status.accounts.is_empty(),
                default_account_id: current.clone(),
                migration_error: None,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| map_agy_account(account, current.as_deref()))
                    .collect(),
            })
        }
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            let accounts = crate::commands::claude_account_manager().list().await;
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: !accounts.is_empty(),
                default_account_id: None,
                migration_error: None,
                accounts: accounts.into_iter().map(map_claude_account).collect(),
            })
        }
        _ => unreachable!(),
    }
}

pub(crate) async fn auth_remove_account_internal(
    app_state: &crate::store::AppState,
    auth_provider: &str,
    account_id: &str,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.write().await;
            auth_manager
                .remove_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.write().await;
            auth_manager
                .remove_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.write().await;
            auth_manager
                .remove_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        // 只删 CC Switch 里的副本，不替 agy 登出
        AUTH_PROVIDER_AGY_OAUTH => crate::commands::agy_account_manager()
            .remove(account_id)
            .await
            .map_err(|e| e.to_string()),
        // 删目录和钥匙串条目（不吊销、不登出）；正在用它的官方卡退回默认登录
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            crate::commands::claude_account_manager()
                .remove(account_id)
                .await
                .map_err(|e| e.to_string())?;
            crate::services::provider::claude_official::refresh_live_after_account_change(
                app_state,
                &crate::commands::claude_account_manager(),
            )
            .await
        }
        _ => unreachable!(),
    }
}

pub(crate) async fn auth_set_default_account_internal(
    auth_provider: &str,
    account_id: &str,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.write().await;
            auth_manager
                .set_default_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.write().await;
            auth_manager
                .set_default_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.write().await;
            auth_manager
                .set_default_account(account_id)
                .await
                .map_err(|e| e.to_string())
        }
        // 切 agy 的全局登录（写钥匙串）
        AUTH_PROVIDER_AGY_OAUTH => crate::commands::agy_account_manager()
            .switch_to(account_id)
            .await
            .map_err(|e| e.to_string()),
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            let _ = account_id;
            Err("Claude accounts are used through the official provider card bound to them".into())
        }
        _ => unreachable!(),
    }
}

pub(crate) async fn auth_logout_internal(
    app_state: &crate::store::AppState,
    auth_provider: &str,
    copilot_state: &Arc<RwLock<crate::proxy::providers::copilot_auth::CopilotAuthManager>>,
    codex_state: &Arc<RwLock<crate::proxy::providers::codex_oauth_auth::CodexOAuthManager>>,
    xai_state: &Arc<RwLock<crate::proxy::providers::xai_oauth_auth::XaiOAuthManager>>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.write().await;
            auth_manager.clear_auth().await.map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.write().await;
            auth_manager.clear_auth().await.map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_XAI_OAUTH => {
            let auth_manager = xai_state.write().await;
            auth_manager.clear_auth().await.map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_AGY_OAUTH => crate::commands::agy_account_manager()
            .remove_all()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        AUTH_PROVIDER_CLAUDE_OFFICIAL => {
            crate::commands::claude_account_manager()
                .remove_all()
                .await
                .map_err(|e| e.to_string())?;
            crate::services::provider::claude_official::refresh_live_after_account_change(
                app_state,
                &crate::commands::claude_account_manager(),
            )
            .await
        }
        _ => unreachable!(),
    }
}
