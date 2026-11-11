use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Valid,
    Expired,
    /// 访问令牌过期，但刷新令牌还能用：客户端下次运行时自己会换新的，不用重新登录。
    RefreshPending,
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

/// ChatGPT 订阅存下的限额重置次数（Codex「存下重置、需要时再用」）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredits {
    /// 每一次可用重置的到期时间（ISO 8601），先到期的在前，不过期的是 None 排最后；
    /// 长度就是可用次数（只收 available 且查询时还没过期的）
    pub expires_at: Vec<Option<String>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_credits: Option<ResetCredits>,
    /// ChatGPT 订阅买的 Codex Credits 余额（额度用完后才扣）；没有、不限量或为 0 时为 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_balance: Option<f64>,
    /// 套餐显示名（「Pro 200」「Google AI Pro」「SuperGrok Heavy」…），授权中心的账号行显示；
    /// 只有能顺带查到套餐的服务填，认不出或查不到时为 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
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
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
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
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
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
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "refreshTokenExpiresAt")]
    refresh_token_expires_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiUsageWindow {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

/// `limits[]` 中的窗口使用 `percent`，而非旧顶层窗口的 `utilization`。
#[derive(Debug, Deserialize)]
struct ApiScopedUsageWindow {
    percent: f64,
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
    /// 原样收下再挑字段：形状不对时只是不显示余额，不能让整份额度解析失败
    credits: Option<serde_json::Value>,
    #[serde(default)]
    plan_type: Option<String>,
}

/// `wham/usage` 的 `plan_type` → 套餐名，照 Codex 自己 `/status` 的叫法
/// （codex-rs/tui/src/subscription.rs：`business` 在那里也叫 Enterprise）。认不出的首字母大写照写
fn codex_plan_label(plan_type: &str) -> Option<String> {
    let plan = plan_type.trim().to_ascii_lowercase();
    let label = match plan.as_str() {
        "" | "unknown" => return None,
        "free" => "Free",
        "go" => "Go",
        "plus" => "Plus",
        "prolite" => "Pro 100",
        "pro" => "Pro 200",
        "promax" => "Pro 500",
        "team" | "self_serve_business_usage_based" => "Business",
        "self_serve_business_prolite" => "Business Premium",
        "edu" => "Edu",
        "edu_plus" => "Edu Plus",
        "edu_pro" => "Edu Pro",
        p if p == "business" || p == "ent26" || p.starts_with("enterprise") => "Enterprise",
        _ => return Some(title_case_words(&plan)),
    };
    Some(label.to_string())
}

/// `free_workspace` → `Free Workspace`
pub(crate) fn title_case_words(raw: &str) -> String {
    raw.split(['_', '-', ' '])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `wham/usage` 的 `credits`：`{has_credits, unlimited, balance}`，balance 实测是字符串
/// （"62500"），也收数字（同 CodexBar）。不限量、没有或为 0 时不显示
fn parse_codex_credits_balance(credits: &serde_json::Value) -> Option<f64> {
    if credits.get("has_credits").and_then(|v| v.as_bool()) != Some(true)
        || credits.get("unlimited").and_then(|v| v.as_bool()) == Some(true)
    {
        return None;
    }
    let balance = match credits.get("balance")? {
        serde_json::Value::Number(n) => n.as_f64()?,
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (balance.is_finite() && balance > 0.0).then_some(balance)
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

pub(crate) const TIER_FIVE_HOUR: &str = "five_hour";
pub(crate) const TIER_SEVEN_DAY: &str = "seven_day";
/// 内部统一名称：Fable 实际由 `limits[].scope.model` 标识。
pub(crate) const TIER_SEVEN_DAY_FABLE: &str = "seven_day_fable";
pub(crate) const TIER_SEVEN_DAY_OPUS: &str = "seven_day_opus";
pub(crate) const TIER_SEVEN_DAY_SONNET: &str = "seven_day_sonnet";

/// 已知的 Claude 用量窗口名称（也决定展示顺序）；未知的旧格式窗口仍保留原名称。
const CLAUDE_KNOWN_TIERS: &[&str] = &[
    TIER_FIVE_HOUR,
    TIER_SEVEN_DAY,
    TIER_SEVEN_DAY_FABLE,
    TIER_SEVEN_DAY_OPUS,
    TIER_SEVEN_DAY_SONNET,
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
    std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))
}

/// macOS `security` 找不到钥匙串条目时的退出码。
#[cfg(target_os = "macos")]
const SECURITY_ITEM_NOT_FOUND: i32 = 44;

/// 钥匙串里带 Claude 登录的那条凭据（JSON）；读不了钥匙串或没有时为 `None`（交给文件）。
#[cfg(target_os = "macos")]
fn claude_keychain_json_with(
    account: Option<&str>,
    mut run: impl FnMut(&mut std::process::Command) -> std::io::Result<std::process::Output>,
) -> Option<String> {
    for account in account.into_iter().map(Some).chain(std::iter::once(None)) {
        let mut command = std::process::Command::new("security");
        command.args(["find-generic-password", "-s", "Claude Code-credentials"]);
        if let Some(account) = account {
            command.args(["-a", account]);
        }
        command.arg("-w");

        let output = match run(&mut command) {
            Ok(output) if output.status.success() => output,
            Ok(output) if output.status.code() == Some(SECURITY_ITEM_NOT_FOUND) => continue,
            _ => return None,
        };
        let Ok(json_str) = String::from_utf8(output.stdout) else {
            continue;
        };
        let json = json_str.trim();
        // 同名条目可能只存了 mcpOAuth；没有 Claude token 时继续找，最后回退到文件。
        if parse_claude_credentials_json(json).0.is_some() {
            return Some(json.to_string());
        }
    }
    None
}

/// 默认登录的套餐：和默认登录的额度读同一份凭据（macOS 钥匙串优先，再是 Claude 配置目录里的文件）。
pub fn read_claude_default_plan() -> Option<crate::services::claude_account::AccountPlan> {
    #[cfg(target_os = "macos")]
    {
        let account = std::env::var("USER").ok().filter(|user| !user.is_empty());
        if let Some(json) =
            claude_keychain_json_with(account.as_deref(), |command| command.output())
        {
            return plan_from_credentials_json(&json);
        }
    }
    let json =
        std::fs::read_to_string(config::get_claude_config_dir().join(".credentials.json")).ok()?;
    plan_from_credentials_json(&json)
}

/// 凭据 JSON 里 Claude Code 记的套餐；没写套餐时为 `None`。
fn plan_from_credentials_json(json: &str) -> Option<crate::services::claude_account::AccountPlan> {
    use crate::services::claude_account::snapshot;

    let serde_json::Value::Object(map) = serde_json::from_str(json).ok()? else {
        return None;
    };
    Some(snapshot::credential_plan(&snapshot::store::Secret(map)))
        .filter(|plan| plan.subscription_type.is_some())
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

    parse_claude_credentials_json(&content)
}

fn parse_claude_credentials_json(
    content: &str,
) -> (Option<String>, CredentialStatus, Option<String>) {
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

    // 检查 token 是否过期
    if let Some(expires_at) = entry.expires_at {
        if is_token_expired(&expires_at) {
            // 访问令牌几小时一换，Claude Code 下次运行时用刷新令牌换新的；
            // 刷新令牌还在就不算登录过期。
            let refreshable = entry.refresh_token.is_some_and(|t| !t.is_empty())
                && !entry
                    .refresh_token_expires_at
                    .as_ref()
                    .is_some_and(is_token_expired);
            return if refreshable {
                (
                    Some(token),
                    CredentialStatus::RefreshPending,
                    Some(
                        "Access token has expired; Claude Code refreshes it the next time it runs"
                            .to_string(),
                    ),
                )
            } else {
                (
                    Some(token),
                    CredentialStatus::Expired,
                    Some("OAuth token has expired".to_string()),
                )
            };
        }
    }

    (Some(token), CredentialStatus::Valid, None)
}

fn read_codex_credentials() -> (
    Option<String>,
    Option<String>,
    CredentialStatus,
    Option<String>,
) {
    let path = crate::codex_config::get_codex_auth_path();
    if !path.exists() {
        return (None, None, CredentialStatus::NotFound, None);
    }

    let content = match read_json_file(&path) {
        Ok(content) => content,
        Err(error) => return (None, None, CredentialStatus::ParseError, Some(error)),
    };

    parse_codex_credentials_json(&content)
}

pub(crate) fn parse_codex_credentials_json(
    content: &str,
) -> (
    Option<String>,
    Option<String>,
    CredentialStatus,
    Option<String>,
) {
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

fn read_gemini_credentials() -> (
    Option<String>,
    Option<String>,
    CredentialStatus,
    Option<String>,
) {
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

    if credentials
        .expiry_date
        .is_some_and(|value| value < now_millis())
    {
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

    parse_claude_quota(&body)
}

/// 兼容旧顶层窗口与新版模型专属周限额（上游 cc-switch bfbbf15c），保持查询、
/// 缓存和 UI 共用 QuotaTier。
fn parse_claude_quota(body: &serde_json::Value) -> SubscriptionQuota {
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
            if name == "extra_usage"
                || name == "limits"
                || CLAUDE_KNOWN_TIERS.contains(&name.as_str())
            {
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

    // 新版模型专属额度覆盖同名旧窗口。逐条解析，单个异常项目不影响其余额度。
    let mut scoped_tiers = std::collections::HashSet::new();
    if let Some(limits) = body.get("limits").and_then(serde_json::Value::as_array) {
        for limit in limits {
            if limit.get("kind").and_then(serde_json::Value::as_str) != Some("weekly_scoped")
                || limit.get("group").and_then(serde_json::Value::as_str) != Some("weekly")
                // 不把特定使用场景的子限额合并进整个模型的周限额。
                || limit.pointer("/scope/surface").is_some_and(|v| !v.is_null())
            {
                continue;
            }
            let Some(model) = limit
                .pointer("/scope/model/display_name")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            let tier_name = match model.trim().to_ascii_lowercase().as_str() {
                "fable" => TIER_SEVEN_DAY_FABLE,
                "opus" => TIER_SEVEN_DAY_OPUS,
                "sonnet" => TIER_SEVEN_DAY_SONNET,
                _ => continue,
            };
            let Ok(window) = serde_json::from_value::<ApiScopedUsageWindow>(limit.clone()) else {
                continue;
            };
            if !window.percent.is_finite()
                || window.percent < 0.0
                || !scoped_tiers.insert(tier_name)
            {
                continue;
            }
            // 与 Claude Code 一致：不按 is_active 过滤。0% / resets_at:null
            // 也可能是有效的模型额度；不存在的额度由接口省略。
            let tier = QuotaTier {
                name: tier_name.to_string(),
                utilization: window.percent,
                resets_at: window.resets_at,
            };
            if let Some(existing) = tiers.iter_mut().find(|t| t.name == tier_name) {
                *existing = tier;
            } else {
                tiers.push(tier);
            }
        }
    }
    tiers.sort_by_key(|tier| {
        CLAUDE_KNOWN_TIERS
            .iter()
            .position(|&name| name == tier.name)
            .unwrap_or(CLAUDE_KNOWN_TIERS.len())
    });

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
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
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

#[derive(Deserialize)]
struct CodexResetCreditsResponse {
    #[serde(default)]
    credits: Vec<CodexResetCreditEntry>,
}

#[derive(Deserialize)]
struct CodexResetCreditEntry {
    status: Option<String>,
    expires_at: Option<String>,
}

/// 解析 `wham/rate-limit-reset-credits`：不信 `available_count`，自己按
/// status == "available" 且没过期来数（同 CodexBar），先到期的排前面
fn parse_codex_reset_credits(
    raw: &[u8],
    now: chrono::DateTime<chrono::Utc>,
) -> Option<ResetCredits> {
    let body: CodexResetCreditsResponse = serde_json::from_slice(raw).ok()?;
    let mut expiries: Vec<Option<chrono::DateTime<chrono::Utc>>> = body
        .credits
        .into_iter()
        .filter(|credit| credit.status.as_deref() == Some("available"))
        .filter_map(|credit| match credit.expires_at {
            None => Some(None),
            // 认不出的到期时间当作不过期，宁可多显示一次也不吞掉
            Some(raw) => match chrono::DateTime::parse_from_rfc3339(&raw) {
                Ok(at) => {
                    let at = at.with_timezone(&chrono::Utc);
                    (at > now).then_some(Some(at))
                }
                Err(_) => Some(None),
            },
        })
        .collect();
    // None（不过期）排最后
    expiries.sort_by_key(|at| (at.is_none(), *at));
    Some(ResetCredits {
        expires_at: expiries
            .into_iter()
            .map(|at| at.map(|at| at.to_rfc3339()))
            .collect(),
    })
}

/// 查存下的限额重置次数。附带查询：任何失败都只返回 None，不连累额度本身
async fn query_codex_reset_credits(
    access_token: &str,
    account_id: Option<&str>,
) -> Option<ResetCredits> {
    let mut req = crate::proxy::http_client::get()
        .get("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "codex-cli")
        .header("Accept", "application/json")
        .header("OpenAI-Beta", "codex-1");
    if let Some(id) = account_id {
        req = req.header("ChatGPT-Account-Id", id);
    }
    let resp = req
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        log::debug!("Codex reset credits query failed: HTTP {}", resp.status());
        return None;
    }
    let raw = resp.bytes().await.ok()?;
    parse_codex_reset_credits(&raw, chrono::Utc::now())
}

pub async fn query_codex_quota(
    access_token: &str,
    account_id: Option<&str>,
    tool: &str,
    expired_hint: &str,
) -> SubscriptionQuota {
    let (mut quota, reset_credits) = tokio::join!(
        query_codex_usage(access_token, account_id, tool, expired_hint),
        query_codex_reset_credits(access_token, account_id),
    );
    if quota.success {
        quota.reset_credits = reset_credits;
    }
    quota
}

pub(crate) async fn query_codex_usage(
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

    let response = match request
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
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
                    // 已用额度为 0 时，上游可能返回当前时间加窗口时长；
                    // 隐藏该占位时间，避免产生虚假的倒计时。
                    // 使用原始用量，保留非零用量取整后仍剩余 100% 的倒计时。
                    resets_at: if used_percent == 0.0 {
                        None
                    } else {
                        window.reset_at.and_then(unix_ts_to_iso)
                    },
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
        reset_credits: None,
        credits_balance: body.credits.as_ref().and_then(parse_codex_credits_balance),
        plan_name: body.plan_type.as_deref().and_then(codex_plan_label),
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

    // 原始响应留着：套餐名用 Antigravity 同一个解析器从这里取
    let load_raw = match load_response.bytes().await {
        Ok(raw) => raw,
        Err(error) => {
            return SubscriptionQuota::error(
                "gemini",
                CredentialStatus::Valid,
                format!("Failed to read loadCodeAssist response: {error}"),
            );
        }
    };
    let load_body: GeminiLoadCodeAssistResponse = match serde_json::from_slice(&load_raw) {
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
        reset_credits: None,
        credits_balance: None,
        plan_name: crate::services::agy_account::quota::code_assist_plan(&load_raw),
        queried_at: Some(now_millis()),
    }
}

/// 按读到的 Claude 凭据查额度：访问令牌过期也先试一次（可能实际上还有效）。
async fn claude_quota_from(
    (token, status, message): (Option<String>, CredentialStatus, Option<String>),
) -> SubscriptionQuota {
    match status {
        CredentialStatus::NotFound => SubscriptionQuota::not_found("claude"),
        CredentialStatus::ParseError => SubscriptionQuota::error(
            "claude",
            CredentialStatus::ParseError,
            message.unwrap_or_else(|| "Failed to parse credentials".to_string()),
        ),
        CredentialStatus::Expired | CredentialStatus::RefreshPending => {
            if let Some(token) = token {
                let result = query_claude_quota(&token).await;
                if result.success {
                    return result;
                }
            }
            SubscriptionQuota::error(
                "claude",
                status,
                message.unwrap_or_else(|| "OAuth token has expired".to_string()),
            )
        }
        CredentialStatus::Valid => {
            let token = token.expect("token must be Some when status is Valid");
            query_claude_quota(&token).await
        }
    }
}

/// 绑了账号的 Claude 官方卡：按那个账号自己的登录查额度（在用的号读默认槽位，没在用的读它
/// 的账号目录）。令牌有效就直接查；过期了（没在用的号放几个小时就会这样）在那个目录里跑一次
/// `claude -p /usage`，由 Claude Code 自己刷新并缓存额度，再读它的缓存。CC Switch 不刷新令牌。
pub async fn get_claude_account_quota(
    data_dir: std::path::PathBuf,
    account: String,
) -> Result<ClaudeAccountQuota, String> {
    use crate::services::claude_account::{note_plan, snapshot, usage};

    let data_dir_for_expiry = data_dir.clone();
    let found = {
        let account = account.clone();
        tokio::task::spawn_blocking(move || {
            let slot = snapshot::account_slot(&data_dir, &account)?;
            let secret = snapshot::store::platform_store().read(&slot);
            // 套餐顺手记进账号：授权中心和没开额度的卡片也能显示
            let plan = secret
                .as_ref()
                .ok()
                .and_then(Option::as_ref)
                .map(snapshot::credential_plan);
            if let Some(plan) = &plan {
                note_plan(&data_dir, &account, plan);
            }
            Some((slot, secret, plan))
        })
        .await
        .map_err(|error| error.to_string())?
    };
    let Some((slot, secret, plan)) = found else {
        return Ok(ClaudeAccountQuota::without_plan(
            SubscriptionQuota::not_found("claude"),
        ));
    };
    let Some(secret) = secret.map_err(|error| error.to_string())? else {
        return Ok(ClaudeAccountQuota::without_plan(
            SubscriptionQuota::not_found("claude"),
        ));
    };
    let with_plan = |quota| ClaudeAccountQuota {
        quota,
        plan: plan.clone().filter(|plan| plan.subscription_type.is_some()),
    };
    let json = String::from_utf8_lossy(&secret.to_bytes()).into_owned();
    let direct = claude_quota_from(parse_claude_credentials_json(&json)).await;
    if !needs_cli_usage(&direct) {
        return Ok(with_plan(direct));
    }

    let account_uuid = account_uuid_of(&account).to_string();
    let profile = slot.global_config();
    let config_dir = match &slot {
        snapshot::store::Slot::Default { .. } => None,
        snapshot::store::Slot::Account(dir) => Some(dir.clone()),
    };
    let cached = tokio::task::spawn_blocking(move || {
        let ran = usage::refresh_via_cli(&account, config_dir.as_deref());
        // Claude Code 刷新时会续上登录：记下新的过期时间，免得界面按旧的报「要重新登录」
        if let Some(dir) = config_dir.filter(|_| ran && !snapshot::is_live(&account)) {
            snapshot::note_login_expiry(&data_dir_for_expiry, &account, &dir);
        }
        usage::read_cached(&profile, &account_uuid)
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(with_plan(account_quota_with_cache(
        direct,
        cached,
        now_millis(),
    )))
}

/// 跟随本地登录的 Claude 官方卡：按 `~/.claude` 现在的登录查额度。令牌过期了（几个小时没用
/// Claude Code 就会这样）和绑号卡一样，在默认槽位里跑一次 `claude -p /usage`，读它缓存的额度。
async fn get_local_claude_quota() -> SubscriptionQuota {
    use crate::services::claude_account::{snapshot, usage};

    let direct = claude_quota_from(read_claude_credentials()).await;
    // 改了配置目录时登录不一定在 ~/.claude，在那里跑会拿到别的号的额度
    if !needs_cli_usage(&direct) || crate::settings::get_claude_override_dir().is_some() {
        return direct;
    }
    let cached = tokio::task::spawn_blocking(|| {
        let slot = snapshot::store::Slot::default_slot();
        let account = snapshot::default_owner(&slot)?;
        usage::refresh_via_cli(&account, None);
        usage::read_cached(&slot.global_config(), account_uuid_of(&account))
    })
    .await
    .ok()
    .flatten();
    account_quota_with_cache(direct, cached, now_millis())
}

/// 账号 key（`<accountUuid>:<organizationUuid>`）里的 `accountUuid`。
fn account_uuid_of(account: &str) -> &str {
    account.split_once(':').map_or(account, |(uuid, _)| uuid)
}

/// 绑号卡的额度，带上这个号的套餐（凭据里记的；读不到时缺省）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountQuota {
    #[serde(flatten)]
    pub quota: SubscriptionQuota,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<crate::services::claude_account::AccountPlan>,
}

impl ClaudeAccountQuota {
    fn without_plan(quota: SubscriptionQuota) -> Self {
        Self { quota, plan: None }
    }
}

/// 直接查的结果是令牌过期：要在槽位里跑 `claude -p /usage`，让 Claude Code 自己刷新。
fn needs_cli_usage(direct: &SubscriptionQuota) -> bool {
    !direct.success
        && matches!(
            direct.credential_status,
            CredentialStatus::Expired | CredentialStatus::RefreshPending
        )
}

/// 令牌过期时用 Claude Code 缓存的额度；缓存太旧（`/usage` 一直没跑成）就还是报过期。
fn account_quota_with_cache(
    direct: SubscriptionQuota,
    cached: Option<crate::services::claude_account::usage::CachedUsage>,
    now_ms: i64,
) -> SubscriptionQuota {
    use crate::services::claude_account::usage::CACHE_MAX_AGE;

    match cached {
        Some(cached) if now_ms - cached.fetched_at_ms <= CACHE_MAX_AGE.as_millis() as i64 => {
            SubscriptionQuota {
                queried_at: Some(cached.fetched_at_ms),
                ..parse_claude_quota(&cached.utilization)
            }
        }
        _ => direct,
    }
}

pub async fn get_subscription_quota(tool: &str) -> Result<SubscriptionQuota, String> {
    match tool {
        "claude" => Ok(get_local_claude_quota().await),
        "codex" => {
            let (token, account_id, status, message) = read_codex_credentials();
            match status {
                CredentialStatus::NotFound => Ok(SubscriptionQuota::not_found("codex")),
                CredentialStatus::ParseError => Ok(SubscriptionQuota::error(
                    "codex",
                    CredentialStatus::ParseError,
                    message.unwrap_or_else(|| "Failed to parse credentials".to_string()),
                )),
                CredentialStatus::Expired | CredentialStatus::RefreshPending => {
                    // 即使可能过期也尝试调用 API
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
                CredentialStatus::Expired | CredentialStatus::RefreshPending => {
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── 绑号卡额度：令牌过期时才借 Claude Code 的缓存，太旧的缓存不用（上游 0d6386ed、e29968f5、88c878ac） ──

    fn expired_claude_quota() -> SubscriptionQuota {
        SubscriptionQuota::error(
            "claude",
            CredentialStatus::Expired,
            "OAuth token has expired".to_string(),
        )
    }

    fn cached_usage(fetched_at_ms: i64) -> crate::services::claude_account::usage::CachedUsage {
        crate::services::claude_account::usage::CachedUsage {
            fetched_at_ms,
            utilization: serde_json::json!({
                "five_hour": {"utilization": 13.0, "resets_at": null}
            }),
        }
    }

    #[test]
    fn default_plan_reads_the_plan_next_to_the_login() {
        let plan = plan_from_credentials_json(
            r#"{"claudeAiOauth":{"accessToken":"at","subscriptionType":"team","rateLimitTier":"default_claude_max_5x"}}"#,
        )
        .unwrap();
        assert_eq!(plan.subscription_type.as_deref(), Some("team"));
        assert_eq!(
            plan.rate_limit_tier.as_deref(),
            Some("default_claude_max_5x")
        );
        assert_eq!(plan_from_credentials_json(r#"{"claudeAiOauth":{}}"#), None);
        assert_eq!(plan_from_credentials_json("not json"), None);
    }

    #[test]
    fn only_an_expired_token_runs_claude_usage() {
        assert!(needs_cli_usage(&expired_claude_quota()));
        let pending = SubscriptionQuota::error(
            "claude",
            CredentialStatus::RefreshPending,
            "pending".to_string(),
        );
        assert!(needs_cli_usage(&pending));
        // 查成功、凭据坏了、或接口别的错误（令牌有效）都不跑
        assert!(!needs_cli_usage(&parse_claude_quota(
            &serde_json::json!({})
        )));
        assert!(!needs_cli_usage(&SubscriptionQuota::not_found("claude")));
        assert!(!needs_cli_usage(&SubscriptionQuota::error(
            "claude",
            CredentialStatus::Valid,
            "HTTP 500".to_string(),
        )));
    }

    #[test]
    fn expired_token_uses_a_fresh_cache_but_not_a_stale_one() {
        let now = 1_700_000_000_000_i64;
        let fresh =
            account_quota_with_cache(expired_claude_quota(), Some(cached_usage(now - 1_000)), now);
        assert!(fresh.success);
        assert_eq!(fresh.queried_at, Some(now - 1_000));
        assert_eq!(fresh.tiers.len(), 1);

        // /usage 一直没跑成：几天前的缓存不能当成查到了，照样报过期
        let stale_at = now - 3 * 24 * 60 * 60 * 1000;
        let stale =
            account_quota_with_cache(expired_claude_quota(), Some(cached_usage(stale_at)), now);
        assert!(!stale.success);
        assert!(matches!(stale.credential_status, CredentialStatus::Expired));

        let none = account_quota_with_cache(expired_claude_quota(), None, now);
        assert!(!none.success);
    }

    #[test]
    fn account_uuid_is_the_part_before_the_organization() {
        assert_eq!(account_uuid_of("acc-1:org-1"), "acc-1");
        assert_eq!(account_uuid_of("acc-1:"), "acc-1");
        assert_eq!(account_uuid_of("acc-1"), "acc-1");
    }

    #[test]
    fn claude_expired_access_token_with_live_refresh_token_is_refresh_pending() {
        let past = now_millis() - 60_000;
        let future = now_millis() + 3_600_000;
        let status = |entry: serde_json::Value| {
            parse_claude_credentials_json(
                &serde_json::json!({ "claudeAiOauth": entry }).to_string(),
            )
            .1
        };

        assert!(matches!(
            status(serde_json::json!({
                "accessToken": "a", "expiresAt": past,
                "refreshToken": "r", "refreshTokenExpiresAt": future
            })),
            CredentialStatus::RefreshPending
        ));
        // 旧版凭据没有刷新令牌的过期时间：有刷新令牌就按能刷新算。
        assert!(matches!(
            status(serde_json::json!({
                "accessToken": "a", "expiresAt": past, "refreshToken": "r"
            })),
            CredentialStatus::RefreshPending
        ));
        // 刷新令牌也过期了 / 根本没有：真的要重新登录。
        assert!(matches!(
            status(serde_json::json!({
                "accessToken": "a", "expiresAt": past,
                "refreshToken": "r", "refreshTokenExpiresAt": past
            })),
            CredentialStatus::Expired
        ));
        assert!(matches!(
            status(serde_json::json!({ "accessToken": "a", "expiresAt": past })),
            CredentialStatus::Expired
        ));
        assert!(matches!(
            status(serde_json::json!({
                "accessToken": "a", "expiresAt": future, "refreshToken": "r"
            })),
            CredentialStatus::Valid
        ));
    }

    fn scoped_limit(model: &str, percent: f64) -> serde_json::Value {
        serde_json::json!({
            "kind": "weekly_scoped",
            "group": "weekly",
            "percent": percent,
            "resets_at": "2026-09-12T00:00:00Z",
            "is_active": true,
            "scope": { "model": { "id": null, "display_name": model }, "surface": null }
        })
    }

    #[test]
    fn claude_quota_preserves_legacy_windows_and_extra_usage() {
        let quota = parse_claude_quota(&serde_json::json!({
            "five_hour": { "utilization": 12.0, "resets_at": "2026-09-09T15:00:00Z" },
            "seven_day": { "utilization": 25.0, "resets_at": null },
            "seven_day_opus": { "utilization": 8.0 },
            "seven_day_sonnet": null,
            "other_window": { "utilization": 4.0 },
            "extra_usage": { "is_enabled": true, "monthly_limit": 100.0,
                "used_credits": 9.0, "utilization": 9.0, "currency": "USD" }
        }));
        assert!(quota.success);
        assert_eq!(quota.tool, "claude");
        assert_eq!(
            quota
                .tiers
                .iter()
                .map(|t| (t.name.as_str(), t.utilization))
                .collect::<Vec<_>>(),
            vec![
                (TIER_FIVE_HOUR, 12.0),
                (TIER_SEVEN_DAY, 25.0),
                (TIER_SEVEN_DAY_OPUS, 8.0),
                ("other_window", 4.0)
            ]
        );
        assert_eq!(
            quota.tiers[0].resets_at.as_deref(),
            Some("2026-09-09T15:00:00Z")
        );
        let extra = quota.extra_usage.unwrap();
        assert!(extra.is_enabled);
        assert_eq!(extra.used_credits, Some(9.0));
        assert_eq!(extra.monthly_limit, Some(100.0));
        assert_eq!(extra.currency.as_deref(), Some("USD"));
    }

    #[test]
    fn claude_quota_adds_fable_from_limits_array() {
        let quota = parse_claude_quota(&serde_json::json!({
            "five_hour": { "utilization": 12.0 },
            "seven_day": { "utilization": 25.0 },
            "seven_day_opus": null,
            "seven_day_sonnet": null,
            "limits": [scoped_limit("Fable", 37.5)]
        }));
        assert_eq!(quota.tiers.len(), 3);
        let tier = &quota.tiers[2];
        assert_eq!(tier.name, TIER_SEVEN_DAY_FABLE);
        assert_eq!(tier.utilization, 37.5);
        assert_eq!(tier.resets_at.as_deref(), Some("2026-09-12T00:00:00Z"));
        // 前端与缓存使用同一份 camelCase 数据，无需额外字段。
        let serialized = serde_json::to_value(&quota).unwrap();
        assert_eq!(serialized["tiers"][2]["resetsAt"], "2026-09-12T00:00:00Z");
    }

    #[test]
    fn claude_quota_scoped_windows_override_legacy_and_deduplicate() {
        let mut fable = scoped_limit("  fAbLe  ", 0.0);
        fable["is_active"] = serde_json::json!(false);
        fable["resets_at"] = serde_json::Value::Null;
        let quota = parse_claude_quota(&serde_json::json!({
            "seven_day_fable": { "utilization": 80.0, "resets_at": "2026-09-11T00:00:00Z" },
            "seven_day_opus": { "utilization": 20.0 },
            "seven_day_sonnet": { "utilization": 30.0 },
            "limits": [scoped_limit("Sonnet", 5.0), fable, scoped_limit("Fable", 90.0), scoped_limit("Opus", 6.0)]
        }));
        assert_eq!(
            quota
                .tiers
                .iter()
                .map(|t| (t.name.as_str(), t.utilization))
                .collect::<Vec<_>>(),
            vec![
                (TIER_SEVEN_DAY_FABLE, 0.0),
                (TIER_SEVEN_DAY_OPUS, 6.0),
                (TIER_SEVEN_DAY_SONNET, 5.0)
            ]
        );
        assert_eq!(quota.tiers[0].resets_at, None);
    }

    #[test]
    fn claude_quota_skips_invalid_or_unrelated_scoped_rows() {
        let valid = scoped_limit("Fable", 37.0);
        let mut invalid = vec![serde_json::Value::Null, serde_json::json!("invalid")];
        for (pointer, value) in [
            ("/kind", serde_json::json!("spend")),
            ("/group", serde_json::json!("daily")),
            ("/percent", serde_json::Value::Null),
            ("/percent", serde_json::json!("37")),
            ("/percent", serde_json::json!(-1)),
            ("/resets_at", serde_json::json!(123)),
            ("/scope/model/display_name", serde_json::Value::Null),
            ("/scope/model/display_name", serde_json::json!("Unknown")),
            ("/scope/surface", serde_json::json!("claude_code")),
        ] {
            let mut row = valid.clone();
            *row.pointer_mut(pointer).unwrap() = value;
            invalid.push(row);
        }
        let mut body = serde_json::json!({
            "five_hour": { "utilization": 12.0 },
            "seven_day_fable": { "utilization": 8.0 },
            "limits": invalid
        });
        let fallback = parse_claude_quota(&body);
        assert_eq!(fallback.tiers.len(), 2);
        assert_eq!(fallback.tiers[1].utilization, 8.0);
        body["limits"].as_array_mut().unwrap().push(valid);
        let quota = parse_claude_quota(&body);
        assert_eq!(quota.tiers.len(), 2);
        assert_eq!(quota.tiers[0].utilization, 12.0);
        assert_eq!(quota.tiers[1].utilization, 37.0);
    }

    #[test]
    fn claude_quota_does_not_invent_missing_fable_usage() {
        for limits in [
            serde_json::Value::Null,
            serde_json::json!([]),
            serde_json::json!({}),
        ] {
            let quota = parse_claude_quota(&serde_json::json!({
                "five_hour": { "utilization": 12.0 },
                "limits": limits
            }));
            assert_eq!(quota.tiers.len(), 1);
            assert_eq!(quota.tiers[0].name, TIER_FIVE_HOUR);
        }
        let quota =
            parse_claude_quota(&serde_json::json!({ "limits": [scoped_limit("Fable", 100.0)] }));
        assert_eq!(quota.tiers.len(), 1);
        assert_eq!(quota.tiers[0].name, TIER_SEVEN_DAY_FABLE);
        assert_eq!(quota.tiers[0].utilization, 100.0);
    }
    #[test]
    fn codex_reset_credits_count_only_unexpired_available() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-04T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let raw = br#"{
            "available_count": 9,
            "credits": [
                {"id":"a","reset_type":"weekly","status":"available","granted_at":"2026-09-20T00:00:00Z","expires_at":"2026-10-20T00:00:00Z"},
                {"id":"b","reset_type":"weekly","status":"available","granted_at":"2026-09-01T00:00:00Z","expires_at":"2026-10-03T00:00:00Z"},
                {"id":"c","reset_type":"weekly","status":"redeemed","granted_at":"2026-09-01T00:00:00Z","expires_at":"2026-10-30T00:00:00Z"},
                {"id":"d","reset_type":"weekly","status":"available","granted_at":"2026-09-01T00:00:00Z","expires_at":null},
                {"id":"e","reset_type":"weekly","status":"available","granted_at":"2026-09-25T00:00:00.123Z","expires_at":"2026-10-08T12:00:00.123Z"}
            ]
        }"#;
        let credits = parse_codex_reset_credits(raw, now).unwrap();
        // b 已过期、c 已用掉；剩下按到期先后，不过期的排最后
        assert_eq!(credits.expires_at.len(), 3);
        assert!(credits.expires_at[0]
            .as_deref()
            .unwrap()
            .starts_with("2026-10-08T12:00:00.123"));
        assert!(credits.expires_at[1]
            .as_deref()
            .unwrap()
            .starts_with("2026-10-20"));
        assert_eq!(credits.expires_at[2], None);
    }

    #[test]
    fn codex_reset_credits_empty_and_malformed() {
        let now = chrono::Utc::now();
        let empty = parse_codex_reset_credits(br#"{"available_count":0,"credits":[]}"#, now);
        assert_eq!(empty.unwrap().expires_at.len(), 0);
        assert!(parse_codex_reset_credits(b"<html>", now).is_none());
        // 新序列化的字段对旧缓存是可选的
        let quota: SubscriptionQuota = serde_json::from_str(
            r#"{"tool":"codex","credentialStatus":"valid","credentialMessage":null,
                "success":true,"tiers":[],"extraUsage":null,"error":null,"queriedAt":1}"#,
        )
        .unwrap();
        assert!(quota.reset_credits.is_none());
        assert!(quota.credits_balance.is_none());
    }

    #[test]
    fn codex_plan_label_follows_codex_status_names() {
        let label = |raw: &str| {
            let body: CodexUsageResponse = serde_json::from_str(raw).unwrap();
            body.plan_type.as_deref().and_then(codex_plan_label)
        };
        assert_eq!(label(r#"{"plan_type":"pro"}"#).as_deref(), Some("Pro 200"));
        assert_eq!(
            label(r#"{"plan_type":"prolite"}"#).as_deref(),
            Some("Pro 100")
        );
        assert_eq!(
            label(r#"{"plan_type":"team"}"#).as_deref(),
            Some("Business")
        );
        assert_eq!(
            label(r#"{"plan_type":"business"}"#).as_deref(),
            Some("Enterprise")
        );
        assert_eq!(
            label(r#"{"plan_type":"enterprise_cbp_usage_based"}"#).as_deref(),
            Some("Enterprise")
        );
        assert_eq!(
            label(r#"{"plan_type":"free_workspace"}"#).as_deref(),
            Some("Free Workspace")
        );
        assert_eq!(label(r#"{"plan_type":"unknown"}"#), None);
        assert_eq!(label(r#"{"rate_limit":null}"#), None);
    }

    #[test]
    fn codex_credits_balance_from_usage_response() {
        let parse = |raw: &str| {
            let body: CodexUsageResponse = serde_json::from_str(raw).unwrap();
            body.credits.as_ref().and_then(parse_codex_credits_balance)
        };
        // 实测形状：balance 是字符串
        assert_eq!(
            parse(
                r#"{"credits":{"has_credits":true,"unlimited":false,"overage_limit_reached":false,
                    "balance":"62500","approx_local_messages":[15625,81250]}}"#
            ),
            Some(62500.0)
        );
        assert_eq!(
            parse(r#"{"credits":{"has_credits":true,"unlimited":false,"balance":42.5}}"#),
            Some(42.5)
        );
        // 0、不限量、没有、缺字段、形状不对：都不显示，也不让额度解析失败
        assert_eq!(
            parse(r#"{"credits":{"has_credits":true,"unlimited":false,"balance":"0"}}"#),
            None
        );
        assert_eq!(
            parse(r#"{"credits":{"has_credits":true,"unlimited":true,"balance":"10"}}"#),
            None
        );
        assert_eq!(
            parse(r#"{"credits":{"has_credits":false,"unlimited":false,"balance":"10"}}"#),
            None
        );
        assert_eq!(parse(r#"{"credits":{"has_credits":true}}"#), None);
        assert_eq!(parse(r#"{"credits":"weird","rate_limit":null}"#), None);
        assert_eq!(parse(r#"{}"#), None);
    }
}

/// Codex 在 Keychain 里存登录用的账户名：`cli|` 加规范化后的 Codex 配置目录路径的
/// SHA-256 十六进制前 16 位（codex-rs `login/src/auth/storage.rs` 的 `compute_store_key`）。
/// 规范化失败时用原路径，和上游一致。
#[cfg(target_os = "macos")]
fn codex_keychain_account(codex_home: &std::path::Path) -> String {
    let canonical = codex_home
        .canonicalize()
        .unwrap_or_else(|_| codex_home.to_path_buf());
    let hex = crate::live::engine::sha256_hex(canonical.to_string_lossy().as_bytes());
    format!("cli|{}", &hex[..16])
}

/// Keychain 里当前 Codex 配置目录的登录 JSON。服务名所有配置目录共用，必须带上账户名：
/// 只按服务名查，本机有别的配置目录的登录时 `security` 返回第一条匹配的。
///
/// `Ok(None)`：确定没有这一条。`Err`：读不出来（访问被拒、`security` 跑不起来），
/// 不知道里面有什么。
#[cfg(target_os = "macos")]
fn read_codex_keychain_secret() -> Result<Option<String>, String> {
    let account = codex_keychain_account(&crate::codex_config::get_codex_config_dir());
    let output = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Codex Auth",
            "-a",
            &account,
            "-w",
        ])
        .output()
        .map_err(|error| format!("运行 security 失败: {error}"))?;
    if output.status.code() == Some(SECURITY_ITEM_NOT_FOUND) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err(format!(
            "security 退出码 {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let secret = String::from_utf8_lossy(&output.stdout);
    let secret = secret.trim();
    Ok((!secret.is_empty()).then(|| secret.to_string()))
}

/// 系统钥匙串里 Codex 的登录（`cli_auth_credentials_store` 为 keyring / auto 时 Codex 存在
/// 这里）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CodexKeychainLogin {
    // 只有 macOS 读得到钥匙串，其他平台的正式构建里只会出现 Unknown。
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Found(serde_json::Value),
    /// 确定没有，或者内容不是 JSON（Codex 自己也读不了，auto 模式同样退回 `auth.json`）。
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Missing,
    /// 读不出来：不是 macOS（Windows、Linux 的凭据库 CC Switch 读不了），或者 macOS 上
    /// 访问被拒。Codex 看到的可能是另一个登录，不能拿 `auth.json` 顶替。
    Unknown,
}

pub(crate) fn read_codex_keychain_login() -> CodexKeychainLogin {
    #[cfg(target_os = "macos")]
    {
        match read_codex_keychain_secret() {
            Ok(Some(secret)) => serde_json::from_str(&secret)
                .map_or(CodexKeychainLogin::Missing, CodexKeychainLogin::Found),
            Ok(None) => CodexKeychainLogin::Missing,
            Err(error) => {
                log::warn!("读取 Keychain 里的 Codex 登录失败: {error}");
                CodexKeychainLogin::Unknown
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        CodexKeychainLogin::Unknown
    }
}
