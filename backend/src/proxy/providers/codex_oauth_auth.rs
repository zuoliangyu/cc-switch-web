//! Codex OAuth Authentication Module
//!
//! 实现 OpenAI ChatGPT Plus/Pro 订阅的 OAuth Device Code 流程。
//! 支持多账号管理，每个 Provider 可关联不同的 ChatGPT 账号。
//!
//! ## 认证流程
//! 1. 启动 Device Code 流程，获取 device_auth_id 和 user_code
//! 2. 用户在浏览器中完成 ChatGPT 授权
//! 3. 轮询获取 authorization_code 和 code_verifier（注意：verifier 由服务端返回）
//! 4. 使用 code + verifier 换取 access_token + refresh_token + id_token
//! 5. 自动刷新 access_token（到期前 60 秒）
//!
//! ## 多账号支持
//! - 每个 ChatGPT 账号独立存储 refresh_token
//! - Provider 通过 meta.authBinding 关联账号（auth_provider = "codex_oauth"）
//! - 通过 JWT id_token 提取 chatgpt_account_id 作为账号唯一标识

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};

use super::copilot_auth::{GitHubAccount, GitHubDeviceCodeResponse};

const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_USERCODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_AUTH_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const TOKEN_REFRESH_BUFFER_MS: i64 = 60_000;
const OAUTH_HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const DEVICE_CODE_DEFAULT_EXPIRES_IN: u64 = 900;
const POLLING_SAFETY_MARGIN_SECS: u64 = 3;
const CODEX_USER_AGENT: &str = "cc-switch-codex-oauth";

#[derive(Debug, thiserror::Error)]
pub enum CodexOAuthError {
    #[error("等待用户授权中")]
    AuthorizationPending,

    #[error("用户拒绝授权")]
    AccessDenied,

    #[error("Device Code 已过期")]
    ExpiredToken,

    #[error("OAuth Token 获取失败: {0}")]
    TokenFetchFailed(String),

    #[error("Refresh Token 失效或已过期")]
    RefreshTokenInvalid,

    #[error("网络错误: {0}")]
    NetworkError(String),

    #[error("解析错误: {0}")]
    ParseError(String),

    #[error("IO 错误: {0}")]
    IoError(String),

    #[error("账号不存在: {0}")]
    AccountNotFound(String),
}

impl From<reqwest::Error> for CodexOAuthError {
    fn from(err: reqwest::Error) -> Self {
        CodexOAuthError::NetworkError(err.to_string())
    }
}

impl From<std::io::Error> for CodexOAuthError {
    fn from(err: std::io::Error) -> Self {
        CodexOAuthError::IoError(err.to_string())
    }
}

#[derive(Debug, Clone, Deserialize)]
struct DeviceCodeResponse {
    device_auth_id: String,
    user_code: String,
    #[serde(default)]
    interval: Option<serde_json::Value>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct DevicePollSuccess {
    authorization_code: String,
    code_verifier: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct IdTokenClaims {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organizations: Vec<OrgClaim>,
    #[serde(default, rename = "https://api.openai.com/auth")]
    openai_auth: Option<OpenAiAuthClaim>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct OrgClaim {
    #[serde(default)]
    id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct OpenAiAuthClaim {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedAccessToken {
    token: String,
    expires_at_ms: i64,
    obtained_at_ms: i64,
}

impl CachedAccessToken {
    fn is_expiring_soon(&self) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        self.expires_at_ms - now < TOKEN_REFRESH_BUFFER_MS
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefreshTokenAdoptionMode {
    TimestampChecked,
    RejectedManagerToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefreshTokenAdoptionOutcome {
    Synchronized { state_changed: bool },
    Adopted,
    ProvablyOlder,
    Ambiguous,
    NotManaged,
}

impl RefreshTokenAdoptionOutcome {
    fn state_changed(self) -> bool {
        matches!(
            self,
            Self::Synchronized {
                state_changed: true
            } | Self::Adopted
        )
    }
}

#[derive(Debug, Clone)]
struct PendingDeviceCode {
    user_code: String,
    expires_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexAccountData {
    pub account_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub refresh_token: String,
    pub authenticated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(default)]
    pub token_updated_at_ms: i64,
}

impl From<&CodexAccountData> for GitHubAccount {
    fn from(data: &CodexAccountData) -> Self {
        GitHubAccount {
            id: data.account_id.clone(),
            login: data
                .email
                .clone()
                .unwrap_or_else(|| format!("ChatGPT ({})", &data.account_id)),
            avatar_url: None,
            authenticated_at: data.authenticated_at,
            github_domain: "github.com".to_string(),
            reauth_required: data.id_token.is_none(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CodexOAuthStore {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    accounts: HashMap<String, CodexAccountData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_account_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ManagedTokenBundle {
    pub access_token: String,
    pub id_token: Option<String>,
    pub refresh_token: String,
    pub last_refresh: String,
}

pub struct CodexOAuthManager {
    accounts: Arc<RwLock<HashMap<String, CodexAccountData>>>,
    default_account_id: Arc<RwLock<Option<String>>>,
    access_tokens: Arc<RwLock<HashMap<String, CachedAccessToken>>>,
    refresh_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    lifecycle_lock: Arc<RwLock<()>>,
    pending_device_codes: Arc<RwLock<HashMap<String, PendingDeviceCode>>>,
    /// 清除全部认证时递增，使已经在网络请求中的登录流程无法重新登记。
    login_epoch: AtomicU64,
    http_client: Client,
    storage_path: PathBuf,
    storage_lock: Arc<Mutex<()>>,
}

impl CodexOAuthManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let storage_path = data_dir.join("codex_oauth_auth.json");

        let manager = Self {
            accounts: Arc::new(RwLock::new(HashMap::new())),
            default_account_id: Arc::new(RwLock::new(None)),
            access_tokens: Arc::new(RwLock::new(HashMap::new())),
            refresh_locks: Arc::new(RwLock::new(HashMap::new())),
            lifecycle_lock: Arc::new(RwLock::new(())),
            pending_device_codes: Arc::new(RwLock::new(HashMap::new())),
            login_epoch: AtomicU64::new(0),
            http_client: Client::builder()
                .timeout(OAUTH_HTTP_TIMEOUT)
                .build()
                .expect("build Codex OAuth HTTP client"),
            storage_path,
            storage_lock: Arc::new(Mutex::new(())),
        };

        if let Err(e) = manager.load_from_disk_sync() {
            log::warn!("[CodexOAuth] 加载存储失败: {e}");
        }

        manager
    }

    pub async fn start_device_flow(&self) -> Result<GitHubDeviceCodeResponse, CodexOAuthError> {
        log::info!("[CodexOAuth] 启动 Device Code 流程");
        let login_epoch = self.login_epoch.load(Ordering::Acquire);

        let response = self
            .http_client
            .post(DEVICE_AUTH_USERCODE_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", CODEX_USER_AGENT)
            .json(&serde_json::json!({ "client_id": CODEX_CLIENT_ID }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(CodexOAuthError::NetworkError(format!(
                "Device Code 请求失败: {status} - {text}"
            )));
        }

        let device: DeviceCodeResponse = response
            .json()
            .await
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))?;

        let interval = parse_interval(device.interval.as_ref());
        let expires_in = device.expires_in.unwrap_or(DEVICE_CODE_DEFAULT_EXPIRES_IN);
        let expires_at_ms = chrono::Utc::now().timestamp_millis() + (expires_in as i64) * 1000;

        self.register_pending_device_code(
            device.device_auth_id.clone(),
            device.user_code.clone(),
            expires_at_ms,
            login_epoch,
        )
        .await?;

        log::info!(
            "[CodexOAuth] 获取 Device Code 成功，user_code: {}",
            device.user_code
        );

        Ok(GitHubDeviceCodeResponse {
            device_code: device.device_auth_id,
            user_code: device.user_code,
            verification_uri: DEVICE_VERIFICATION_URL.to_string(),
            expires_in,
            interval,
        })
    }

    async fn register_pending_device_code(
        &self,
        device_auth_id: String,
        user_code: String,
        expires_at_ms: i64,
        login_epoch: u64,
    ) -> Result<(), CodexOAuthError> {
        let mut pending = self.pending_device_codes.write().await;
        if self.login_epoch.load(Ordering::Acquire) != login_epoch {
            return Err(CodexOAuthError::ExpiredToken);
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
        pending.retain(|_, entry| entry.expires_at_ms > now_ms);
        pending.insert(
            device_auth_id,
            PendingDeviceCode {
                user_code,
                expires_at_ms,
            },
        );
        Ok(())
    }

    pub async fn poll_for_token(
        &self,
        device_code: &str,
    ) -> Result<Option<GitHubAccount>, CodexOAuthError> {
        let entry = {
            let pending = self.pending_device_codes.read().await;
            pending.get(device_code).cloned()
        };

        let entry = entry.ok_or_else(|| {
            CodexOAuthError::TokenFetchFailed(
                "未找到对应的 user_code，请重新启动登录流程".to_string(),
            )
        })?;

        if entry.expires_at_ms <= chrono::Utc::now().timestamp_millis() {
            let mut pending = self.pending_device_codes.write().await;
            pending.remove(device_code);
            return Err(CodexOAuthError::ExpiredToken);
        }

        let poll_response = self
            .http_client
            .post(DEVICE_AUTH_TOKEN_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", CODEX_USER_AGENT)
            .json(&serde_json::json!({
                "device_auth_id": device_code,
                "user_code": entry.user_code,
            }))
            .send()
            .await?;

        let status = poll_response.status();
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
            return Err(CodexOAuthError::AuthorizationPending);
        }
        if status == reqwest::StatusCode::GONE {
            return Err(CodexOAuthError::ExpiredToken);
        }
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(CodexOAuthError::AccessDenied);
        }
        if !status.is_success() {
            let text = poll_response.text().await.unwrap_or_default();
            return Err(CodexOAuthError::TokenFetchFailed(format!(
                "{status} - {text}"
            )));
        }

        let success: DevicePollSuccess = poll_response
            .json()
            .await
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))?;

        let tokens = self
            .exchange_code_for_tokens(&success.authorization_code, &success.code_verifier)
            .await?;

        let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
            CodexOAuthError::TokenFetchFailed("响应缺少 refresh_token".to_string())
        })?;

        let (account_id, email) = extract_identity_from_tokens(&tokens);
        let account_id = account_id.ok_or_else(|| {
            CodexOAuthError::ParseError("无法从 token 中提取 account_id".to_string())
        })?;

        let obtained_at_ms = chrono::Utc::now().timestamp_millis();
        let account = self
            .add_account_internal(
                account_id,
                refresh_token,
                email,
                tokens.id_token.filter(|token| !token.trim().is_empty()),
                Some(CachedAccessToken {
                    token: tokens.access_token,
                    expires_at_ms: compute_expires_at_ms(tokens.expires_in),
                    obtained_at_ms,
                }),
                Some(device_code),
            )
            .await?;

        Ok(Some(account))
    }

    async fn exchange_code_for_tokens(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> Result<OAuthTokenResponse, CodexOAuthError> {
        let response = self
            .http_client
            .post(OAUTH_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("User-Agent", CODEX_USER_AGENT)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", DEVICE_REDIRECT_URI),
                ("client_id", CODEX_CLIENT_ID),
                ("code_verifier", code_verifier),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(CodexOAuthError::TokenFetchFailed(format!(
                "Token 交换失败: {status} - {text}"
            )));
        }

        response
            .json()
            .await
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))
    }

    async fn refresh_with_token(
        &self,
        refresh_token: &str,
    ) -> Result<OAuthTokenResponse, CodexOAuthError> {
        let response = self
            .http_client
            .post(OAUTH_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("User-Agent", CODEX_USER_AGENT)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", CODEX_CLIENT_ID),
                ("scope", "openid profile email"),
            ])
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let refresh_error_code = extract_refresh_error_code(&text);
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
                || matches!(
                    refresh_error_code.as_deref(),
                    Some(
                        "refresh_token_expired"
                            | "refresh_token_reused"
                            | "refresh_token_invalidated"
                    )
                )
            {
                return Err(CodexOAuthError::RefreshTokenInvalid);
            }
            return Err(CodexOAuthError::TokenFetchFailed(format!(
                "Refresh 失败: {status} - {text}"
            )));
        }

        response
            .json()
            .await
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))
    }

    pub async fn get_valid_token_for_account(
        &self,
        account_id: &str,
    ) -> Result<String, CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.read().await;
        Ok(self.resolve_valid_cached_token(account_id).await?.token)
    }

    async fn resolve_valid_cached_token(
        &self,
        account_id: &str,
    ) -> Result<CachedAccessToken, CodexOAuthError> {
        {
            let accounts = self.accounts.read().await;
            if !accounts.contains_key(account_id) {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
            let tokens = self.access_tokens.read().await;
            if let Some(cached) = tokens.get(account_id) {
                if !cached.is_expiring_soon() {
                    return Ok(cached.clone());
                }
            }
        }

        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        self.resolve_valid_cached_token_under_lock(account_id).await
    }

    async fn resolve_valid_cached_token_under_lock(
        &self,
        account_id: &str,
    ) -> Result<CachedAccessToken, CodexOAuthError> {
        if let Some((live_refresh, live_id_token, live_last_refresh_ms)) =
            crate::codex_config::read_codex_live_auth_refresh_for_account(account_id)
        {
            self.adopt_account_refresh_token_under_lock(
                account_id,
                live_refresh,
                live_id_token,
                live_last_refresh_ms,
                RefreshTokenAdoptionMode::TimestampChecked,
            )
            .await?;
        }

        {
            let accounts = self.accounts.read().await;
            if !accounts.contains_key(account_id) {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
            let tokens = self.access_tokens.read().await;
            if let Some(cached) = tokens.get(account_id) {
                if !cached.is_expiring_soon() {
                    return Ok(cached.clone());
                }
            }
        }

        let mut refresh_token = {
            let accounts = self.accounts.read().await;
            accounts
                .get(account_id)
                .map(|a| a.refresh_token.clone())
                .ok_or_else(|| CodexOAuthError::AccountNotFound(account_id.to_string()))?
        };

        let new_tokens = match self.refresh_with_token(&refresh_token).await {
            Err(CodexOAuthError::RefreshTokenInvalid) => {
                let Some((live_refresh, live_id_token, live_last_refresh_ms)) =
                    crate::codex_config::read_codex_live_auth_refresh_for_account(account_id)
                        .filter(|(token, _, _)| token.trim() != refresh_token.as_str())
                else {
                    return Err(CodexOAuthError::RefreshTokenInvalid);
                };
                let adoption = self
                    .adopt_account_refresh_token_under_lock(
                        account_id,
                        live_refresh.clone(),
                        live_id_token,
                        live_last_refresh_ms,
                        RefreshTokenAdoptionMode::RejectedManagerToken,
                    )
                    .await?;
                if !matches!(adoption, RefreshTokenAdoptionOutcome::Adopted) {
                    return Err(CodexOAuthError::RefreshTokenInvalid);
                }
                refresh_token = live_refresh;
                self.refresh_with_token(&refresh_token).await?
            }
            result => result?,
        };

        let obtained_at_ms = chrono::Utc::now().timestamp_millis();
        let mut needs_save = false;
        let (stored_refresh_token, stored_id_token) = {
            let mut accounts = self.accounts.write().await;
            let account = accounts
                .get_mut(account_id)
                .ok_or_else(|| CodexOAuthError::AccountNotFound(account_id.to_string()))?;
            if account.refresh_token != refresh_token {
                return Err(CodexOAuthError::TokenFetchFailed(
                    "账号凭据已更新，已丢弃旧刷新响应".to_string(),
                ));
            }
            if let Some(new_refresh) = new_tokens
                .refresh_token
                .clone()
                .filter(|token| !token.trim().is_empty())
            {
                if new_refresh != account.refresh_token {
                    account.refresh_token = new_refresh;
                    needs_save = true;
                }
            }
            if let Some(new_id_token) = new_tokens
                .id_token
                .clone()
                .filter(|token| !token.trim().is_empty())
            {
                if account.id_token.as_deref() != Some(new_id_token.as_str()) {
                    account.id_token = Some(new_id_token);
                    needs_save = true;
                }
            }
            if account.token_updated_at_ms != obtained_at_ms {
                account.token_updated_at_ms = obtained_at_ms;
                needs_save = true;
            }
            (account.refresh_token.clone(), account.id_token.clone())
        };
        if needs_save {
            self.save_to_disk().await?;
        }

        let cached = CachedAccessToken {
            token: new_tokens.access_token,
            expires_at_ms: compute_expires_at_ms(new_tokens.expires_in),
            obtained_at_ms,
        };
        let last_refresh = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(obtained_at_ms)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
        let refreshed_auth = crate::codex_config::codex_managed_oauth_auth_value(
            account_id,
            &cached.token,
            stored_id_token.as_deref(),
            &stored_refresh_token,
            &last_refresh,
        );
        if let Err(error) = crate::codex_config::sync_codex_managed_oauth_live_auth_after_refresh(
            account_id,
            &refresh_token,
            &refreshed_auth,
        ) {
            log::warn!(
                "[CodexOAuth] 同步刷新后的 Codex live auth 失败（account={account_id}）: {error}"
            );
        }

        {
            let accounts = self.accounts.read().await;
            if !accounts.contains_key(account_id) {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
            self.access_tokens
                .write()
                .await
                .insert(account_id.to_string(), cached.clone());
        }

        Ok(cached)
    }

    pub async fn get_valid_token_and_id_token_for_account(
        &self,
        account_id: &str,
    ) -> Result<(String, Option<String>), CodexOAuthError> {
        let bundle = self.get_valid_token_bundle_for_account(account_id).await?;
        Ok((bundle.access_token, bundle.id_token))
    }

    pub(crate) async fn get_valid_token_bundle_for_account(
        &self,
        account_id: &str,
    ) -> Result<ManagedTokenBundle, CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.read().await;
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _refresh_guard = refresh_lock.lock().await;
        let cached = self
            .resolve_valid_cached_token_under_lock(account_id)
            .await?;

        if let Some((live_refresh, live_id_token, live_last_refresh_ms)) =
            crate::codex_config::read_codex_live_auth_refresh_for_account(account_id)
        {
            match self
                .adopt_account_refresh_token_under_lock(
                    account_id,
                    live_refresh,
                    live_id_token,
                    live_last_refresh_ms,
                    RefreshTokenAdoptionMode::TimestampChecked,
                )
                .await?
            {
                RefreshTokenAdoptionOutcome::Synchronized { .. }
                | RefreshTokenAdoptionOutcome::ProvablyOlder => {}
                RefreshTokenAdoptionOutcome::Ambiguous => {
                    return Err(Self::ambiguous_live_refresh_error(account_id));
                }
                RefreshTokenAdoptionOutcome::Adopted => {
                    return Err(CodexOAuthError::TokenFetchFailed(format!(
                        "Codex CLI 账号 {account_id} 的磁盘凭据在准备写入期间已刷新；请重试"
                    )));
                }
                RefreshTokenAdoptionOutcome::NotManaged => {
                    return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
                }
            }
        }

        let last_refresh =
            chrono::DateTime::<chrono::Utc>::from_timestamp_millis(cached.obtained_at_ms)
                .unwrap_or_else(chrono::Utc::now)
                .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
        let (id_token, refresh_token) = {
            let accounts = self.accounts.read().await;
            let account = accounts
                .get(account_id)
                .ok_or_else(|| CodexOAuthError::AccountNotFound(account_id.to_string()))?;
            (account.id_token.clone(), account.refresh_token.clone())
        };
        Ok(ManagedTokenBundle {
            access_token: cached.token,
            id_token,
            refresh_token,
            last_refresh,
        })
    }

    pub async fn adopt_account_refresh_token(
        &self,
        account_id: &str,
        refresh_token: String,
        id_token: Option<String>,
        last_refresh_ms: Option<i64>,
    ) -> Result<bool, CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.read().await;
        let refresh_token = refresh_token.trim().to_string();
        if refresh_token.is_empty() {
            return Ok(false);
        }
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        self.adopt_account_refresh_token_under_lock(
            account_id,
            refresh_token,
            id_token,
            last_refresh_ms,
            RefreshTokenAdoptionMode::TimestampChecked,
        )
        .await
        .map(RefreshTokenAdoptionOutcome::state_changed)
    }

    fn ambiguous_live_refresh_error(account_id: &str) -> CodexOAuthError {
        CodexOAuthError::TokenFetchFailed(format!(
            "Codex CLI 账号 {account_id} 的磁盘凭据已变化，但无法安全判断 refresh token 新旧；请在认证中心重新登录"
        ))
    }

    pub(crate) async fn prepare_live_auth_for_account_switch_away(
        &self,
        account_id: &str,
    ) -> Result<Option<String>, CodexOAuthError> {
        let Some((live_refresh, live_id_token, live_last_refresh_ms)) =
            crate::codex_config::read_codex_live_auth_refresh_for_account(account_id)
        else {
            return Ok(None);
        };
        let _lifecycle = self.lifecycle_lock.read().await;
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        let outcome = self
            .adopt_account_refresh_token_under_lock(
                account_id,
                live_refresh.clone(),
                live_id_token,
                live_last_refresh_ms,
                RefreshTokenAdoptionMode::TimestampChecked,
            )
            .await?;
        match outcome {
            RefreshTokenAdoptionOutcome::Synchronized { .. }
            | RefreshTokenAdoptionOutcome::Adopted
            | RefreshTokenAdoptionOutcome::ProvablyOlder => Ok(Some(live_refresh)),
            RefreshTokenAdoptionOutcome::Ambiguous => {
                Err(Self::ambiguous_live_refresh_error(account_id))
            }
            RefreshTokenAdoptionOutcome::NotManaged => {
                Err(CodexOAuthError::AccountNotFound(account_id.to_string()))
            }
        }
    }

    async fn adopt_account_refresh_token_under_lock(
        &self,
        account_id: &str,
        refresh_token: String,
        id_token: Option<String>,
        last_refresh_ms: Option<i64>,
        mode: RefreshTokenAdoptionMode,
    ) -> Result<RefreshTokenAdoptionOutcome, CodexOAuthError> {
        let incoming_id_token = id_token.filter(|token| !token.trim().is_empty());
        let mut changed = false;
        let mut material_replaced = false;
        let mut outcome;
        {
            let mut accounts = self.accounts.write().await;
            let Some(account) = accounts.get_mut(account_id) else {
                return Ok(RefreshTokenAdoptionOutcome::NotManaged);
            };

            let refresh_changed = account.refresh_token != refresh_token;
            let id_token_changed = incoming_id_token
                .as_ref()
                .is_some_and(|token| account.id_token.as_deref() != Some(token.as_str()));
            let material_changed = refresh_changed || id_token_changed;
            let manager_was_undated = account.token_updated_at_ms <= 0;
            let observed_order =
                last_refresh_ms.map(|observed| observed.cmp(&account.token_updated_at_ms));
            let should_adopt = material_changed
                && (matches!(mode, RefreshTokenAdoptionMode::RejectedManagerToken)
                    || (!manager_was_undated
                        && matches!(observed_order, Some(std::cmp::Ordering::Greater))));

            if !material_changed {
                outcome = RefreshTokenAdoptionOutcome::Synchronized {
                    state_changed: false,
                };
            } else if should_adopt {
                if refresh_changed {
                    account.refresh_token = refresh_token;
                    changed = true;
                    material_replaced = true;
                }
                if let Some(id_token) = incoming_id_token {
                    if account.id_token.as_deref() != Some(id_token.as_str()) {
                        account.id_token = Some(id_token);
                        changed = true;
                        material_replaced = true;
                    }
                }
                outcome = RefreshTokenAdoptionOutcome::Adopted;
            } else if !manager_was_undated
                && matches!(observed_order, Some(std::cmp::Ordering::Less))
            {
                outcome = RefreshTokenAdoptionOutcome::ProvablyOlder;
            } else {
                outcome = RefreshTokenAdoptionOutcome::Ambiguous;
            }

            if matches!(outcome, RefreshTokenAdoptionOutcome::Adopted)
                && matches!(mode, RefreshTokenAdoptionMode::RejectedManagerToken)
            {
                let adopted_at = last_refresh_ms
                    .filter(|observed| *observed > account.token_updated_at_ms)
                    .unwrap_or_else(|| {
                        chrono::Utc::now()
                            .timestamp_millis()
                            .max(account.token_updated_at_ms.saturating_add(1))
                    });
                if account.token_updated_at_ms != adopted_at {
                    account.token_updated_at_ms = adopted_at;
                    changed = true;
                }
            } else if matches!(outcome, RefreshTokenAdoptionOutcome::Adopted) {
                if let Some(observed) = last_refresh_ms {
                    if account.token_updated_at_ms != observed {
                        account.token_updated_at_ms = observed;
                        changed = true;
                    }
                }
            } else if matches!(outcome, RefreshTokenAdoptionOutcome::Synchronized { .. }) {
                if manager_was_undated {
                    account.token_updated_at_ms = last_refresh_ms
                        .filter(|observed| *observed > 0)
                        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
                    changed = true;
                } else if let Some(observed) = last_refresh_ms {
                    if observed > account.token_updated_at_ms {
                        account.token_updated_at_ms = observed;
                        changed = true;
                    }
                }
            }
            if material_replaced {
                self.access_tokens.write().await.remove(account_id);
            }
            if let RefreshTokenAdoptionOutcome::Synchronized { .. } = outcome {
                outcome = RefreshTokenAdoptionOutcome::Synchronized {
                    state_changed: changed,
                };
            }
        }
        if changed {
            self.save_to_disk().await?;
        }
        Ok(outcome)
    }

    pub async fn get_valid_token(&self) -> Result<String, CodexOAuthError> {
        match self.resolve_default_account_id().await {
            Some(id) => self.get_valid_token_for_account(&id).await,
            None => Err(CodexOAuthError::AccountNotFound(
                "无可用的 ChatGPT 账号".to_string(),
            )),
        }
    }

    pub async fn default_account_id(&self) -> Option<String> {
        self.resolve_default_account_id().await
    }

    pub async fn remove_account(&self, account_id: &str) -> Result<(), CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.write().await;
        {
            let accounts = self.accounts.read().await;
            if !accounts.contains_key(account_id) {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
        }

        crate::codex_config::clear_codex_live_auth_for_managed_account(account_id)
            .map_err(|error| CodexOAuthError::IoError(error.to_string()))?;

        {
            let mut accounts = self.accounts.write().await;
            accounts.remove(account_id);
            self.access_tokens.write().await.remove(account_id);
        }
        {
            let mut locks = self.refresh_locks.write().await;
            locks.remove(account_id);
        }

        {
            let accounts = self.accounts.read().await;
            let mut default = self.default_account_id.write().await;
            if default.as_deref() == Some(account_id) {
                *default = Self::fallback_default_account_id(&accounts);
            }
        }

        self.save_to_disk().await?;
        Ok(())
    }

    pub async fn set_default_account(&self, account_id: &str) -> Result<(), CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.read().await;
        {
            let accounts = self.accounts.read().await;
            if !accounts.contains_key(account_id) {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
        }

        {
            let mut default = self.default_account_id.write().await;
            *default = Some(account_id.to_string());
        }

        self.save_to_disk().await?;
        Ok(())
    }

    pub async fn clear_auth(&self) -> Result<(), CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.write().await;
        let account_ids = self
            .accounts
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for account_id in &account_ids {
            crate::codex_config::clear_codex_live_auth_for_managed_account(account_id)
                .map_err(|error| CodexOAuthError::IoError(error.to_string()))?;
        }
        let _persist = self.storage_lock.lock().await;
        {
            let mut accounts = self.accounts.write().await;
            accounts.clear();
            self.access_tokens.write().await.clear();
        }
        *self.default_account_id.write().await = None;
        {
            let mut locks = self.refresh_locks.write().await;
            locks.clear();
        }
        {
            let mut pending = self.pending_device_codes.write().await;
            self.login_epoch.fetch_add(1, Ordering::AcqRel);
            pending.clear();
        }

        if self.storage_path.exists() {
            std::fs::remove_file(&self.storage_path)?;
        }

        Ok(())
    }

    pub async fn get_status(&self) -> CodexOAuthStatus {
        let accounts_map = self.accounts.read().await.clone();
        let default_id = self.resolve_default_account_id().await;
        let account_list = Self::sorted_accounts(&accounts_map, default_id.as_deref());
        let authenticated = !account_list.is_empty();
        let username = default_id
            .as_ref()
            .and_then(|id| accounts_map.get(id))
            .and_then(|a| a.email.clone())
            .or_else(|| account_list.first().map(|a| a.login.clone()));

        CodexOAuthStatus {
            accounts: account_list,
            default_account_id: default_id,
            authenticated,
            username,
        }
    }

    #[cfg(test)]
    pub(crate) async fn seed_account_for_test(
        &self,
        account_id: &str,
        access_token: &str,
        refresh_token: &str,
        id_token: &str,
    ) {
        let wall_clock_ms = chrono::Utc::now().timestamp_millis();
        let mut accounts = self.accounts.write().await;
        let now_ms = accounts
            .get(account_id)
            .map(|account| wall_clock_ms.max(account.token_updated_at_ms.saturating_add(1)))
            .unwrap_or(wall_clock_ms);
        accounts.insert(
            account_id.to_string(),
            CodexAccountData {
                account_id: account_id.to_string(),
                email: Some(format!("{account_id}@example.com")),
                refresh_token: refresh_token.to_string(),
                authenticated_at: now_ms / 1000,
                id_token: Some(id_token.to_string()),
                token_updated_at_ms: now_ms,
            },
        );
        drop(accounts);
        self.access_tokens.write().await.insert(
            account_id.to_string(),
            CachedAccessToken {
                token: access_token.to_string(),
                expires_at_ms: now_ms + 3_600_000,
                obtained_at_ms: now_ms,
            },
        );
    }

    async fn add_account_internal(
        &self,
        account_id: String,
        refresh_token: String,
        email: Option<String>,
        id_token: Option<String>,
        initial_access_token: Option<CachedAccessToken>,
        pending_device_code: Option<&str>,
    ) -> Result<GitHubAccount, CodexOAuthError> {
        let _lifecycle = self.lifecycle_lock.read().await;
        if let Some(device_code) = pending_device_code {
            if self
                .pending_device_codes
                .write()
                .await
                .remove(device_code)
                .is_none()
            {
                return Err(CodexOAuthError::ExpiredToken);
            }
        }
        let refresh_lock = self.get_refresh_lock(&account_id).await;
        let _refresh_guard = refresh_lock.lock().await;
        let now = chrono::Utc::now().timestamp();
        let now_ms = chrono::Utc::now().timestamp_millis();
        let data = CodexAccountData {
            account_id: account_id.clone(),
            email,
            refresh_token,
            authenticated_at: now,
            id_token,
            token_updated_at_ms: now_ms,
        };

        let account = GitHubAccount::from(&data);

        {
            let mut accounts = self.accounts.write().await;
            accounts.insert(account_id.clone(), data);
            let mut access_tokens = self.access_tokens.write().await;
            if let Some(cached) = initial_access_token {
                access_tokens.insert(account_id.clone(), cached);
            } else {
                access_tokens.remove(&account_id);
            }
        }

        {
            let mut default = self.default_account_id.write().await;
            if default.is_none() {
                *default = Some(account_id);
            }
        }

        self.save_to_disk().await?;
        Ok(account)
    }

    fn fallback_default_account_id(accounts: &HashMap<String, CodexAccountData>) -> Option<String> {
        accounts
            .iter()
            .max_by(|(id_a, a), (id_b, b)| {
                a.authenticated_at
                    .cmp(&b.authenticated_at)
                    .then_with(|| id_b.cmp(id_a))
            })
            .map(|(id, _)| id.clone())
    }

    fn sorted_accounts(
        accounts: &HashMap<String, CodexAccountData>,
        default_account_id: Option<&str>,
    ) -> Vec<GitHubAccount> {
        let mut list: Vec<GitHubAccount> = accounts.values().map(GitHubAccount::from).collect();
        list.sort_by(|a, b| {
            let a_default = default_account_id == Some(a.id.as_str());
            let b_default = default_account_id == Some(b.id.as_str());
            b_default
                .cmp(&a_default)
                .then_with(|| b.authenticated_at.cmp(&a.authenticated_at))
                .then_with(|| a.login.cmp(&b.login))
        });
        list
    }

    async fn resolve_default_account_id(&self) -> Option<String> {
        let stored = self.default_account_id.read().await.clone();
        let accounts = self.accounts.read().await;

        if let Some(id) = stored {
            if accounts.contains_key(&id) {
                return Some(id);
            }
        }

        Self::fallback_default_account_id(&accounts)
    }

    async fn get_refresh_lock(&self, account_id: &str) -> Arc<Mutex<()>> {
        {
            let locks = self.refresh_locks.read().await;
            if let Some(lock) = locks.get(account_id) {
                return Arc::clone(lock);
            }
        }

        let mut locks = self.refresh_locks.write().await;
        Arc::clone(
            locks
                .entry(account_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    fn write_store_atomic(&self, content: &str) -> Result<(), CodexOAuthError> {
        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let parent = self
            .storage_path
            .parent()
            .ok_or_else(|| CodexOAuthError::IoError("无效的存储路径".to_string()))?;
        let file_name = self
            .storage_path
            .file_name()
            .ok_or_else(|| CodexOAuthError::IoError("无效的存储文件名".to_string()))?
            .to_string_lossy()
            .to_string();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp_path = parent.join(format!("{file_name}.tmp.{ts}"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&tmp_path)?;
            file.write_all(content.as_bytes())?;
            file.flush()?;

            fs::rename(&tmp_path, &self.storage_path)?;
            fs::set_permissions(&self.storage_path, fs::Permissions::from_mode(0o600))?;
        }

        #[cfg(windows)]
        {
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&tmp_path)?;
            file.write_all(content.as_bytes())?;
            file.flush()?;

            if self.storage_path.exists() {
                let _ = fs::remove_file(&self.storage_path);
            }
            fs::rename(&tmp_path, &self.storage_path)?;
        }

        Ok(())
    }

    fn load_from_disk_sync(&self) -> Result<(), CodexOAuthError> {
        if !self.storage_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&self.storage_path)?;
        let store: CodexOAuthStore = serde_json::from_str(&content)
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))?;

        if let Ok(mut accounts) = self.accounts.try_write() {
            *accounts = store.accounts;
            log::info!("[CodexOAuth] 从磁盘加载 {} 个账号", accounts.len());
        }
        if let Ok(mut default) = self.default_account_id.try_write() {
            *default = store.default_account_id;
            if default.is_none() {
                if let Ok(accounts) = self.accounts.try_read() {
                    *default = Self::fallback_default_account_id(&accounts);
                }
            }
        }

        Ok(())
    }

    async fn save_to_disk(&self) -> Result<(), CodexOAuthError> {
        let _persist = self.storage_lock.lock().await;
        let accounts = self.accounts.read().await.clone();
        let default = self.resolve_default_account_id().await;

        let store = CodexOAuthStore {
            version: 1,
            accounts,
            default_account_id: default,
        };

        let content = serde_json::to_string_pretty(&store)
            .map_err(|e| CodexOAuthError::ParseError(e.to_string()))?;

        self.write_store_atomic(&content)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexOAuthStatus {
    pub accounts: Vec<GitHubAccount>,
    pub default_account_id: Option<String>,
    pub authenticated: bool,
    pub username: Option<String>,
}

fn parse_interval(value: Option<&serde_json::Value>) -> u64 {
    let raw = match value {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(5),
        Some(serde_json::Value::String(s)) => s.parse::<u64>().unwrap_or(5),
        _ => 5,
    };
    raw.max(1) + POLLING_SAFETY_MARGIN_SECS
}

fn compute_expires_at_ms(expires_in: Option<i64>) -> i64 {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let secs = expires_in.unwrap_or(3600);
    now_ms + secs * 1000
}

fn extract_refresh_error_code(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("error")
        .and_then(|error| match error {
            serde_json::Value::Object(object) => object.get("code").and_then(|code| code.as_str()),
            serde_json::Value::String(code) => Some(code.as_str()),
            _ => None,
        })
        .or_else(|| value.get("code").and_then(|code| code.as_str()))
        .map(|code| code.to_ascii_lowercase())
}

fn parse_jwt_claims(token: &str) -> Option<IdTokenClaims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn extract_identity_from_tokens(tokens: &OAuthTokenResponse) -> (Option<String>, Option<String>) {
    let mut account_id: Option<String> = None;
    let mut email: Option<String> = None;

    if let Some(id_token) = tokens.id_token.as_deref() {
        if let Some(claims) = parse_jwt_claims(id_token) {
            account_id = claims
                .chatgpt_account_id
                .clone()
                .or_else(|| {
                    claims
                        .openai_auth
                        .as_ref()
                        .and_then(|a| a.chatgpt_account_id.clone())
                })
                .or_else(|| claims.organizations.first().and_then(|o| o.id.clone()));
            email = claims.email.clone();
        }
    }

    if account_id.is_none() {
        if let Some(claims) = parse_jwt_claims(&tokens.access_token) {
            account_id = claims
                .chatgpt_account_id
                .clone()
                .or_else(|| {
                    claims
                        .openai_auth
                        .as_ref()
                        .and_then(|a| a.chatgpt_account_id.clone())
                })
                .or_else(|| claims.organizations.first().and_then(|o| o.id.clone()));
            if email.is_none() {
                email = claims.email.clone();
            }
        }
    }

    (account_id, email)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_data(
        account_id: &str,
        refresh_token: &str,
        id_token: Option<&str>,
        token_updated_at_ms: i64,
    ) -> CodexAccountData {
        CodexAccountData {
            account_id: account_id.to_string(),
            email: Some(format!("{account_id}@example.com")),
            refresh_token: refresh_token.to_string(),
            authenticated_at: 1_700_000_000,
            id_token: id_token.map(ToString::to_string),
            token_updated_at_ms,
        }
    }

    async fn insert_account(manager: &CodexOAuthManager, account: CodexAccountData) {
        manager
            .accounts
            .write()
            .await
            .insert(account.account_id.clone(), account);
    }

    #[test]
    fn test_parse_interval_number() {
        let v = serde_json::Value::Number(serde_json::Number::from(5));
        assert_eq!(parse_interval(Some(&v)), 5 + POLLING_SAFETY_MARGIN_SECS);
    }

    #[test]
    fn test_parse_interval_string() {
        let v = serde_json::Value::String("10".to_string());
        assert_eq!(parse_interval(Some(&v)), 10 + POLLING_SAFETY_MARGIN_SECS);
    }

    #[test]
    fn test_parse_interval_default() {
        assert_eq!(parse_interval(None), 5 + POLLING_SAFETY_MARGIN_SECS);
    }

    #[test]
    fn test_compute_expires_at_ms_default() {
        let result = compute_expires_at_ms(None);
        let now = chrono::Utc::now().timestamp_millis();
        assert!(result > now);
    }

    #[tokio::test]
    async fn test_manager_initial_state() {
        let temp = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(temp.path().to_path_buf());
        let status = manager.get_status().await;
        assert!(!status.authenticated);
        assert!(status.accounts.is_empty());
    }

    #[tokio::test]
    async fn legacy_store_without_id_token_requires_reauthentication() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("codex_oauth_auth.json"),
            r#"{
  "version": 1,
  "accounts": {
    "legacy-account": {
      "account_id": "legacy-account",
      "email": "legacy@example.com",
      "refresh_token": "legacy-refresh",
      "authenticated_at": 1700000000
    }
  },
  "default_account_id": "legacy-account"
}"#,
        )
        .unwrap();

        let manager = CodexOAuthManager::new(temp.path().to_path_buf());
        let status = manager.get_status().await;

        assert_eq!(status.accounts.len(), 1);
        assert!(status.accounts[0].reauth_required);
        let stored = manager.accounts.read().await;
        let account = stored.get("legacy-account").unwrap();
        assert!(account.id_token.is_none());
        assert_eq!(account.token_updated_at_ms, 0);
    }

    #[tokio::test]
    async fn new_login_persists_id_token_and_token_generation() {
        let temp = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(temp.path().to_path_buf());

        manager
            .add_account_internal(
                "account-one".to_string(),
                "refresh-one".to_string(),
                Some("one@example.com".to_string()),
                Some("id-token-one".to_string()),
                None,
                None,
            )
            .await
            .unwrap();

        let store: CodexOAuthStore = serde_json::from_str(
            &std::fs::read_to_string(temp.path().join("codex_oauth_auth.json")).unwrap(),
        )
        .unwrap();
        let account = store.accounts.get("account-one").unwrap();
        assert_eq!(account.id_token.as_deref(), Some("id-token-one"));
        assert!(account.token_updated_at_ms > 0);
        assert!(!GitHubAccount::from(account).reauth_required);
    }

    #[tokio::test]
    async fn refresh_token_adoption_respects_generation_order() {
        let temp = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(temp.path().to_path_buf());
        insert_account(
            &manager,
            account_data("account-one", "manager-refresh", Some("manager-id"), 200),
        )
        .await;

        assert!(manager
            .adopt_account_refresh_token(
                "account-one",
                "newer-refresh".to_string(),
                Some("newer-id".to_string()),
                Some(300),
            )
            .await
            .unwrap());
        {
            let accounts = manager.accounts.read().await;
            let account = accounts.get("account-one").unwrap();
            assert_eq!(account.refresh_token, "newer-refresh");
            assert_eq!(account.id_token.as_deref(), Some("newer-id"));
            assert_eq!(account.token_updated_at_ms, 300);
        }

        assert!(!manager
            .adopt_account_refresh_token(
                "account-one",
                "older-refresh".to_string(),
                None,
                Some(250),
            )
            .await
            .unwrap());
        assert!(!manager
            .adopt_account_refresh_token("account-one", "undated-refresh".to_string(), None, None,)
            .await
            .unwrap());

        let accounts = manager.accounts.read().await;
        let account = accounts.get("account-one").unwrap();
        assert_eq!(account.refresh_token, "newer-refresh");
        assert_eq!(account.token_updated_at_ms, 300);
    }

    #[tokio::test]
    async fn matching_legacy_token_backfills_generation_without_replacing_material() {
        let temp = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(temp.path().to_path_buf());
        insert_account(
            &manager,
            account_data("legacy-account", "same-refresh", None, 0),
        )
        .await;

        assert!(manager
            .adopt_account_refresh_token(
                "legacy-account",
                "same-refresh".to_string(),
                None,
                Some(400),
            )
            .await
            .unwrap());

        let accounts = manager.accounts.read().await;
        let account = accounts.get("legacy-account").unwrap();
        assert_eq!(account.refresh_token, "same-refresh");
        assert_eq!(account.token_updated_at_ms, 400);
    }

    #[tokio::test]
    async fn device_start_rejects_flow_cleared_during_network_request() {
        let temp = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(temp.path().to_path_buf());
        let login_epoch = manager.login_epoch.load(Ordering::Acquire);

        manager.clear_auth().await.unwrap();
        let result = manager
            .register_pending_device_code(
                "stale-device-auth-id".to_string(),
                "ABCD-EFGH".to_string(),
                chrono::Utc::now().timestamp_millis() + 60_000,
                login_epoch,
            )
            .await;

        assert!(matches!(result, Err(CodexOAuthError::ExpiredToken)));
        assert!(manager.pending_device_codes.read().await.is_empty());
    }
}
