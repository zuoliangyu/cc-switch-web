use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Valid,
    Expired,
    NotFound,
    ParseError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaTier {
    pub name: String,
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: Option<f64>,
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionQuota {
    pub tool: String,
    pub credential_status: CredentialStatus,
    pub credential_message: Option<String>,
    pub success: bool,
    pub tiers: Vec<QuotaTier>,
    pub extra_usage: Option<ExtraUsage>,
    pub error: Option<String>,
    pub queried_at: Option<i64>,
}

impl SubscriptionQuota {
    pub fn not_found(tool: &str) -> Self {
        Self {
            tool: tool.to_string(),
            credential_status: CredentialStatus::NotFound,
            credential_message: None,
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: None,
            queried_at: None,
        }
    }

    pub fn error(tool: &str, status: CredentialStatus, message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            tool: tool.to_string(),
            credential_status: status,
            credential_message: Some(message.clone()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(message),
            queried_at: Some(now_millis()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ClaudeOAuthEntry {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiUsageWindow {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiExtraUsage {
    is_enabled: Option<bool>,
    monthly_limit: Option<f64>,
    used_credits: Option<f64>,
    utilization: Option<f64>,
    currency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexAuthJson {
    auth_mode: Option<String>,
    tokens: Option<CodexTokens>,
    last_refresh: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexTokens {
    access_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitWindow {
    used_percent: Option<f64>,
    limit_window_seconds: Option<i64>,
    reset_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimit {
    primary_window: Option<CodexRateLimitWindow>,
    secondary_window: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
struct CodexUsageResponse {
    rate_limit: Option<CodexRateLimit>,
}

#[derive(Debug, Deserialize)]
struct GeminiOAuthCredsFile {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expiry_date: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct GeminiLoadCodeAssistResponse {
    #[serde(rename = "cloudaicompanionProject")]
    cloudaicompanion_project: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GeminiBucketInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
    #[serde(rename = "modelId")]
    model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiQuotaResponse {
    buckets: Option<Vec<GeminiBucketInfo>>,
}

const CLAUDE_KNOWN_TIERS: &[&str] = &[
    "five_hour",
    "seven_day",
    "seven_day_opus",
    "seven_day_sonnet",
];

pub(crate) const TIER_WEEKLY_LIMIT: &str = "weekly_limit";
pub(crate) const TIER_MONTHLY: &str = "monthly";
pub(crate) const TIER_CREDITS: &str = "credits";

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn gemini_oauth_client_credentials() -> Option<(String, String)> {
    let client_id = std::env::var("CC_SWITCH_GEMINI_OAUTH_CLIENT_ID").ok()?;
    let client_secret = std::env::var("CC_SWITCH_GEMINI_OAUTH_CLIENT_SECRET").ok()?;
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return None;
    }
    Some((client_id, client_secret))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn is_token_expired(expires_at: &serde_json::Value) -> bool {
    let now = now_secs();
    match expires_at {
        serde_json::Value::Number(number) => number.as_u64().is_some_and(|value| {
            let value = if value > 1_000_000_000_000 {
                value / 1000
            } else {
                value
            };
            value < now
        }),
        serde_json::Value::String(value) => {
            if let Ok(datetime) = chrono::DateTime::parse_from_rfc3339(value) {
                (datetime.timestamp() as u64) < now
            } else if let Ok(datetime) =
                chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
            {
                (datetime.and_utc().timestamp() as u64) < now
            } else {
                false
            }
        }
        _ => false,
    }
}

fn read_json_file(path: &std::path::Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| format!("Failed to read {}: {error}", path.display()))
}

fn read_claude_credentials() -> (Option<String>, CredentialStatus, Option<String>) {
    let path = config::get_claude_config_dir().join(".credentials.json");
    if !path.exists() {
        return (None, CredentialStatus::NotFound, None);
    }

    let content = match read_json_file(&path) {
        Ok(content) => content,
        Err(error) => return (None, CredentialStatus::ParseError, Some(error)),
    };

    let parsed: serde_json::Value = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(error) => {
            return (
                None,
                CredentialStatus::ParseError,
                Some(format!("Failed to parse Claude credentials JSON: {error}")),
            );
        }
    };

    let entry = parsed
        .get("claudeAiOauth")
        .or_else(|| parsed.get("claude.ai_oauth"))
        .cloned();

    let entry = match entry {
        Some(value) => value,
        None => {
            return (
                None,
                CredentialStatus::ParseError,
                Some("No Claude OAuth entry found".to_string()),
            );
        }
    };

    let entry: ClaudeOAuthEntry = match serde_json::from_value(entry) {
        Ok(value) => value,
        Err(error) => {
            return (
                None,
                CredentialStatus::ParseError,
                Some(format!("Failed to parse Claude OAuth entry: {error}")),
            );
        }
    };

    let token = match entry.access_token {
        Some(token) if !token.is_empty() => token,
        _ => {
            return (
                None,
                CredentialStatus::ParseError,
                Some("Claude accessToken is empty or missing".to_string()),
            );
        }
    };

    if entry.expires_at.as_ref().is_some_and(is_token_expired) {
        return (
            Some(token),
            CredentialStatus::Expired,
            Some("Claude OAuth token has expired".to_string()),
        );
    }

    (Some(token), CredentialStatus::Valid, None)
}

fn read_codex_credentials() -> (Option<String>, Option<String>, CredentialStatus, Option<String>) {
    let path = crate::codex_config::get_codex_auth_path();
    if !path.exists() {
        return (None, None, CredentialStatus::NotFound, None);
    }

    let content = match read_json_file(&path) {
        Ok(content) => content,
        Err(error) => return (None, None, CredentialStatus::ParseError, Some(error)),
    };

    let auth: CodexAuthJson = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(error) => {
            return (
                None,
                None,
                CredentialStatus::ParseError,
                Some(format!("Failed to parse Codex auth JSON: {error}")),
            );
        }
    };

    if auth.auth_mode.as_deref() != Some("chatgpt") {
        return (
            None,
            None,
            CredentialStatus::NotFound,
            Some("Codex not using OAuth mode".to_string()),
        );
    }

    let tokens = match auth.tokens {
        Some(tokens) => tokens,
        None => {
            return (
                None,
                None,
                CredentialStatus::ParseError,
                Some("No tokens in Codex auth".to_string()),
            );
        }
    };

    let access_token = match tokens.access_token {
        Some(token) if !token.is_empty() => token,
        _ => {
            return (
                None,
                None,
                CredentialStatus::ParseError,
                Some("Codex access_token is empty or missing".to_string()),
            );
        }
    };

    if let Some(last_refresh) = auth.last_refresh.as_deref() {
        if let Ok(datetime) = chrono::DateTime::parse_from_rfc3339(last_refresh) {
            let age_secs = now_secs().saturating_sub(datetime.timestamp() as u64);
            if age_secs > 8 * 24 * 3600 {
                return (
                    Some(access_token),
                    tokens.account_id,
                    CredentialStatus::Expired,
                    Some("Codex token may be stale (>8 days since last refresh)".to_string()),
                );
            }
        }
    }

    (
        Some(access_token),
        tokens.account_id,
        CredentialStatus::Valid,
        None,
    )
}

fn read_gemini_credentials() -> (Option<String>, Option<String>, CredentialStatus, Option<String>) {
    let path = crate::gemini_config::get_gemini_dir().join("oauth_creds.json");
    if !path.exists() {
        return (None, None, CredentialStatus::NotFound, None);
    }

    let content = match read_json_file(&path) {
        Ok(content) => content,
        Err(error) => return (None, None, CredentialStatus::ParseError, Some(error)),
    };

    let credentials: GeminiOAuthCredsFile = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(error) => {
            return (
                None,
                None,
                CredentialStatus::ParseError,
                Some(format!("Failed to parse Gemini credentials JSON: {error}")),
            );
        }
    };

    let access_token = match credentials.access_token {
        Some(token) if !token.is_empty() => token,
        _ => {
            return (
                None,
                credentials.refresh_token,
                CredentialStatus::ParseError,
                Some("Gemini access_token is empty or missing".to_string()),
            );
        }
    };

    if credentials.expiry_date.is_some_and(|value| value < now_millis()) {
        return (
            Some(access_token),
            credentials.refresh_token,
            CredentialStatus::Expired,
            Some("Gemini OAuth token has expired".to_string()),
        );
    }

    (
        Some(access_token),
        credentials.refresh_token,
        CredentialStatus::Valid,
        None,
    )
}

async fn query_claude_quota(access_token: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            return SubscriptionQuota::error(
                "claude",
                CredentialStatus::Valid,
                format!("Network error: {error}"),
            );
        }
    };

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota::error(
            "claude",
            CredentialStatus::Expired,
            format!("Authentication failed (HTTP {status}). Please re-login with Claude CLI."),
        );
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return SubscriptionQuota::error(
            "claude",
            CredentialStatus::Valid,
            format!("API error (HTTP {status}): {body}"),
        );
    }

    let body: serde_json::Value = match response.json().await {
        Ok(body) => body,
        Err(error) => {
            return SubscriptionQuota::error(
                "claude",
                CredentialStatus::Valid,
                format!("Failed to parse API response: {error}"),
            );
        }
    };

    let mut tiers = Vec::new();
    for &tier_name in CLAUDE_KNOWN_TIERS {
        if let Some(window) = body.get(tier_name) {
            if let Ok(window) = serde_json::from_value::<ApiUsageWindow>(window.clone()) {
                if let Some(utilization) = window.utilization {
                    tiers.push(QuotaTier {
                        name: tier_name.to_string(),
                        utilization,
                        resets_at: window.resets_at,
                    });
                }
            }
        }
    }
    if let Some(object) = body.as_object() {
        for (name, value) in object {
            if name == "extra_usage" || CLAUDE_KNOWN_TIERS.contains(&name.as_str()) {
                continue;
            }
            if let Ok(window) = serde_json::from_value::<ApiUsageWindow>(value.clone()) {
                if let Some(utilization) = window.utilization {
                    tiers.push(QuotaTier {
                        name: name.clone(),
                        utilization,
                        resets_at: window.resets_at,
                    });
                }
            }
        }
    }

    let extra_usage = body.get("extra_usage").and_then(|value| {
        serde_json::from_value::<ApiExtraUsage>(value.clone())
            .ok()
            .map(|usage| ExtraUsage {
                is_enabled: usage.is_enabled.unwrap_or(false),
                monthly_limit: usage.monthly_limit,
                used_credits: usage.used_credits,
                utilization: usage.utilization,
                currency: usage.currency,
            })
    });

    SubscriptionQuota {
        tool: "claude".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage,
        error: None,
        queried_at: Some(now_millis()),
    }
}

fn codex_window_name(seconds: i64) -> String {
    match seconds {
        18000 => "five_hour".to_string(),
        604800 => "seven_day".to_string(),
        value => {
            let hours = value / 3600;
            if hours >= 24 {
                format!("{}_day", hours / 24)
            } else {
                format!("{}_hour", hours)
            }
        }
    }
}

fn unix_ts_to_iso(timestamp: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|datetime| datetime.to_rfc3339())
}

pub async fn query_codex_quota(
    access_token: &str,
    account_id: Option<&str>,
    tool: &str,
    expired_hint: &str,
) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();
    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "codex-cli")
        .header("Accept", "application/json");

    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = match request.timeout(std::time::Duration::from_secs(10)).send().await {
        Ok(response) => response,
        Err(error) => {
            return SubscriptionQuota::error(
                tool,
                CredentialStatus::Valid,
                format!("Network error: {error}"),
            );
        }
    };

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota::error(
            tool,
            CredentialStatus::Expired,
            format!("Authentication failed (HTTP {status}). {expired_hint}"),
        );
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return SubscriptionQuota::error(
            tool,
            CredentialStatus::Valid,
            format!("API error (HTTP {status}): {body}"),
        );
    }

    let body: CodexUsageResponse = match response.json().await {
        Ok(body) => body,
        Err(error) => {
            return SubscriptionQuota::error(
                tool,
                CredentialStatus::Valid,
                format!("Failed to parse API response: {error}"),
            );
        }
    };

    let mut tiers = Vec::new();
    if let Some(rate_limit) = body.rate_limit {
        for window in [rate_limit.primary_window, rate_limit.secondary_window]
            .into_iter()
            .flatten()
        {
            if let Some(used_percent) = window.used_percent {
                tiers.push(QuotaTier {
                    name: window
                        .limit_window_seconds
                        .map(codex_window_name)
                        .unwrap_or_else(|| "unknown".to_string()),
                    utilization: used_percent,
                    resets_at: window.reset_at.and_then(unix_ts_to_iso),
                });
            }
        }
    }

    SubscriptionQuota {
        tool: tool.to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

async fn refresh_gemini_token(refresh_token: &str) -> Option<String> {
    let (client_id, client_secret) = gemini_oauth_client_credentials()?;
    let client = crate::proxy::http_client::get();
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body: serde_json::Value = response.json().await.ok()?;
    body.get("access_token")?.as_str().map(String::from)
}

fn extract_project_id(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Object(object) => object
            .get("id")
            .or_else(|| object.get("projectId"))
            .and_then(|value| value.as_str())
            .map(String::from),
        _ => None,
    }
}

fn classify_gemini_model(model_id: &str) -> &str {
    if model_id.contains("flash-lite") {
        "gemini_flash_lite"
    } else if model_id.contains("flash") {
        "gemini_flash"
    } else if model_id.contains("pro") {
        "gemini_pro"
    } else {
        model_id
    }
}

async fn query_gemini_quota(access_token: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();
    let load_response = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "metadata": {
                "ideType": "GEMINI_CLI",
                "pluginType": "GEMINI"
            }
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let load_response = match load_response {
        Ok(response) => response,
        Err(error) => {
            return SubscriptionQuota::error(
                "gemini",
                CredentialStatus::Valid,
                format!("Network error (loadCodeAssist): {error}"),
            );
        }
    };

    let load_status = load_response.status();
    if load_status == reqwest::StatusCode::UNAUTHORIZED
        || load_status == reqwest::StatusCode::FORBIDDEN
    {
        return SubscriptionQuota::error(
            "gemini",
            CredentialStatus::Expired,
            format!("Authentication failed (HTTP {load_status}). Please re-login with Gemini CLI."),
        );
    }
    if !load_status.is_success() {
        let body = load_response.text().await.unwrap_or_default();
        return SubscriptionQuota::error(
            "gemini",
            CredentialStatus::Valid,
            format!("loadCodeAssist failed (HTTP {load_status}): {body}"),
        );
    }

    let load_body: GeminiLoadCodeAssistResponse = match load_response.json().await {
        Ok(body) => body,
        Err(error) => {
            return SubscriptionQuota::error(
                "gemini",
                CredentialStatus::Valid,
                format!("Failed to parse loadCodeAssist response: {error}"),
            );
        }
    };

    let mut quota_request_body = serde_json::json!({});
    if let Some(project_id) = load_body
        .cloudaicompanion_project
        .as_ref()
        .and_then(extract_project_id)
    {
        quota_request_body["project"] = serde_json::Value::String(project_id);
    }

    let quota_response = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .json(&quota_request_body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let quota_response = match quota_response {
        Ok(response) => response,
        Err(error) => {
            return SubscriptionQuota::error(
                "gemini",
                CredentialStatus::Valid,
                format!("Network error (retrieveUserQuota): {error}"),
            );
        }
    };

    let quota_status = quota_response.status();
    if quota_status == reqwest::StatusCode::UNAUTHORIZED
        || quota_status == reqwest::StatusCode::FORBIDDEN
    {
        return SubscriptionQuota::error(
            "gemini",
            CredentialStatus::Expired,
            format!("Authentication failed (HTTP {quota_status})."),
        );
    }
    if !quota_status.is_success() {
        let body = quota_response.text().await.unwrap_or_default();
        return SubscriptionQuota::error(
            "gemini",
            CredentialStatus::Valid,
            format!("retrieveUserQuota failed (HTTP {quota_status}): {body}"),
        );
    }

    let quota_data: GeminiQuotaResponse = match quota_response.json().await {
        Ok(body) => body,
        Err(error) => {
            return SubscriptionQuota::error(
                "gemini",
                CredentialStatus::Valid,
                format!("Failed to parse quota response: {error}"),
            );
        }
    };

    let mut category_map: HashMap<String, (f64, Option<String>)> = HashMap::new();
    if let Some(buckets) = quota_data.buckets {
        for bucket in buckets {
            let model_id = bucket.model_id.as_deref().unwrap_or("unknown");
            let category = classify_gemini_model(model_id).to_string();
            let remaining = bucket.remaining_fraction.unwrap_or(1.0).clamp(0.0, 1.0);
            let entry = category_map
                .entry(category)
                .or_insert((remaining, bucket.reset_time.clone()));
            if remaining < entry.0 {
                entry.0 = remaining;
                if bucket.reset_time.is_some() {
                    entry.1.clone_from(&bucket.reset_time);
                }
            }
        }
    }

    let mut tiers = category_map
        .into_iter()
        .map(|(name, (remaining, reset_time))| QuotaTier {
            name,
            utilization: (1.0 - remaining) * 100.0,
            resets_at: reset_time,
        })
        .collect::<Vec<_>>();
    tiers.sort_by_key(|tier| match tier.name.as_str() {
        "gemini_pro" => 0,
        "gemini_flash" => 1,
        "gemini_flash_lite" => 2,
        _ => 3,
    });

    SubscriptionQuota {
        tool: "gemini".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

pub async fn get_subscription_quota(tool: &str) -> Result<SubscriptionQuota, String> {
    match tool {
        "claude" => {
            let (token, status, message) = read_claude_credentials();
            match status {
                CredentialStatus::NotFound => Ok(SubscriptionQuota::not_found("claude")),
                CredentialStatus::ParseError => Ok(SubscriptionQuota::error(
                    "claude",
                    CredentialStatus::ParseError,
                    message.unwrap_or_else(|| "Failed to parse credentials".to_string()),
                )),
                CredentialStatus::Expired => {
                    if let Some(token) = token {
                        let result = query_claude_quota(&token).await;
                        if result.success {
                            return Ok(result);
                        }
                    }
                    Ok(SubscriptionQuota::error(
                        "claude",
                        CredentialStatus::Expired,
                        message.unwrap_or_else(|| "Claude OAuth token has expired".to_string()),
                    ))
                }
                CredentialStatus::Valid => {
                    let token = token.expect("token must be Some when status is Valid");
                    Ok(query_claude_quota(&token).await)
                }
            }
        }
        "codex" => {
            let (token, account_id, status, message) = read_codex_credentials();
            match status {
                CredentialStatus::NotFound => Ok(SubscriptionQuota::not_found("codex")),
                CredentialStatus::ParseError => Ok(SubscriptionQuota::error(
                    "codex",
                    CredentialStatus::ParseError,
                    message.unwrap_or_else(|| "Failed to parse credentials".to_string()),
                )),
                CredentialStatus::Expired => {
                    if let Some(token) = token {
                        let result = query_codex_quota(
                            &token,
                            account_id.as_deref(),
                            "codex",
                            "Please re-login with Codex CLI.",
                        )
                        .await;
                        if result.success {
                            return Ok(result);
                        }
                    }
                    Ok(SubscriptionQuota::error(
                        "codex",
                        CredentialStatus::Expired,
                        message.unwrap_or_else(|| "Codex OAuth token may be stale".to_string()),
                    ))
                }
                CredentialStatus::Valid => {
                    let token = token.expect("token must be Some when status is Valid");
                    Ok(query_codex_quota(
                        &token,
                        account_id.as_deref(),
                        "codex",
                        "Please re-login with Codex CLI.",
                    )
                    .await)
                }
            }
        }
        "gemini" => {
            let (token, refresh_token, status, message) = read_gemini_credentials();
            match status {
                CredentialStatus::NotFound => Ok(SubscriptionQuota::not_found("gemini")),
                CredentialStatus::ParseError => Ok(SubscriptionQuota::error(
                    "gemini",
                    CredentialStatus::ParseError,
                    message.unwrap_or_else(|| "Failed to parse credentials".to_string()),
                )),
                CredentialStatus::Expired => {
                    if let Some(refresh_token) = refresh_token.as_ref() {
                        if let Some(new_token) = refresh_gemini_token(refresh_token).await {
                            return Ok(query_gemini_quota(&new_token).await);
                        }
                    }
                    if let Some(token) = token.as_ref() {
                        let result = query_gemini_quota(token).await;
                        if result.success {
                            return Ok(result);
                        }
                    }
                    Ok(SubscriptionQuota::error(
                        "gemini",
                        CredentialStatus::Expired,
                        message.unwrap_or_else(|| "Gemini OAuth token has expired".to_string()),
                    ))
                }
                CredentialStatus::Valid => {
                    let token = token.expect("token must be Some when status is Valid");
                    Ok(query_gemini_quota(&token).await)
                }
            }
        }
        "grokbuild" => crate::services::subscription_grok::get_grok_subscription_quota().await,
        _ => Ok(SubscriptionQuota::not_found(tool)),
    }
}
