//! Token Plan / 编程套餐额度查询服务
//!
//! 支持 Kimi For Coding、智谱 GLM、MiniMax、OpenCode Go、Command Code 的套餐额度查询。

use super::subscription::{
    CredentialStatus, QuotaTier, SubscriptionQuota, TIER_FIVE_HOUR, TIER_MONTHLY, TIER_WEEKLY_LIMIT,
};
use std::time::{SystemTime, UNIX_EPOCH};

enum CodingPlanProvider {
    Kimi,
    ZhipuCn,
    ZhipuEn,
    MiniMaxCn,
    MiniMaxEn,
    /// OpenCode Go（$10/月订阅，美元额度三时间窗口）。base_url 分两个入口：
    /// `https://opencode.ai/inference/go/anthropic`（Anthropic 端，现行文档地址）
    /// 与 `https://opencode.ai/zen/go`（旧入口），OpenAI Chat 端在各自后面加 `/v1`。
    OpencodeGo,
    CommandCode,
}

fn detect_provider(base_url: &str) -> Option<CodingPlanProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.kimi.com/coding") {
        Some(CodingPlanProvider::Kimi)
    } else if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") {
        Some(CodingPlanProvider::ZhipuCn)
    } else if url.contains("api.z.ai") {
        Some(CodingPlanProvider::ZhipuEn)
    } else if crate::codex_config::codex_url_host_matches_any(
        base_url,
        &["api.minimaxi.com", "api.minimax.cn"],
    ) {
        // 额度接口只在 api.minimaxi.com / api.minimax.io 有公开出处；国内新推理域名
        // api.minimax.cn 未见该接口文档，沿用旧域名（同一账号体系与 Key）
        Some(CodingPlanProvider::MiniMaxCn)
    } else if crate::codex_config::codex_url_host_matches_any(base_url, &["api.minimax.io"]) {
        Some(CodingPlanProvider::MiniMaxEn)
    } else if url.contains("opencode.ai/zen/go") || url.contains("opencode.ai/inference/go") {
        // 同时覆盖 /zen/go 与 /zen/go/v1 两档 base；Zen 按量版（/zen/v1）
        // 没有任何用量/余额 API（实测 404），刻意不命中。
        Some(CodingPlanProvider::OpencodeGo)
    } else if url.contains("api.commandcode.ai/provider") {
        Some(CodingPlanProvider::CommandCode)
    } else {
        None
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn millis_to_iso8601(ms: i64) -> Option<String> {
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

fn extract_reset_time(value: &serde_json::Value) -> Option<String> {
    if let Some(raw) = value.as_str() {
        return Some(raw.to_string());
    }
    if let Some(raw) = value.as_i64() {
        // 未激活的窗口可能返回 0 或负数；它们不表示真实重置时间。
        if raw <= 0 {
            return None;
        }
        let ms = if raw < 1_000_000_000_000 {
            raw * 1000
        } else {
            raw
        };
        return millis_to_iso8601(ms);
    }
    None
}

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
}

fn make_error(message: String) -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
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

/// 套餐查询的结果。智谱个人版账户没有 Coding Plan（按量付费）时单独返回
/// `ZhipuNoPlan`（内含原来的失败结果），用量查询入口据此改查账户余额
/// （`commands::provider` 的 token_plan 分支）；不回落的调用方用 [`Self::into_quota`]。
pub(crate) enum CodingPlanOutcome {
    Quota(SubscriptionQuota),
    ZhipuNoPlan(SubscriptionQuota),
}

impl CodingPlanOutcome {
    pub(crate) fn into_quota(self) -> SubscriptionQuota {
        match self {
            Self::Quota(quota) | Self::ZhipuNoPlan(quota) => quota,
        }
    }
}

async fn query_kimi(api_key: &str) -> SubscriptionQuota {
    query_kimi_with_base("https://api.kimi.com/coding/v1", api_key).await
}

/// `base_url` is the Kimi Code API root (`https://api.kimi.ai/coding/v1` for
/// global accounts); `token` is an API key or an official OAuth access token.
pub(crate) async fn query_kimi_at(
    base_url: &str,
    token: &str,
) -> Result<SubscriptionQuota, String> {
    Ok(query_kimi_with_base(base_url, token).await)
}

async fn query_kimi_with_base(base_url: &str, api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get(format!("{}/usages", base_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
            queried_at: Some(now_millis()),
        };
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    let mut tiers = Vec::new();

    if let Some(limits) = body.get("limits").and_then(|value| value.as_array()) {
        for limit_item in limits {
            if let Some(detail) = limit_item.get("detail") {
                let limit = detail.get("limit").and_then(parse_f64).unwrap_or(1.0);
                let remaining = detail.get("remaining").and_then(parse_f64).unwrap_or(0.0);
                let resets_at = detail.get("resetTime").and_then(extract_reset_time);
                let used = (limit - remaining).max(0.0);
                let utilization = if limit > 0.0 {
                    (used / limit) * 100.0
                } else {
                    0.0
                };

                tiers.push(QuotaTier {
                    name: "five_hour".to_string(),
                    utilization,
                    resets_at,
                });
            }
        }
    }

    if let Some(usage) = body.get("usage") {
        let limit = usage.get("limit").and_then(parse_f64).unwrap_or(1.0);
        let remaining = usage.get("remaining").and_then(parse_f64).unwrap_or(0.0);
        let resets_at = usage.get("resetTime").and_then(extract_reset_time);
        let used = (limit - remaining).max(0.0);
        let utilization = if limit > 0.0 {
            (used / limit) * 100.0
        } else {
            0.0
        };

        tiers.push(QuotaTier {
            name: "weekly_limit".to_string(),
            utilization,
            resets_at,
        });
    }

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

// 智谱 GLM 的 tier 名称——与 subscription 渲染层使用同一份 i18n key。
const ZHIPU_TIER_FIVE_HOUR: &str = "five_hour";
const ZHIPU_TIER_WEEKLY_LIMIT: &str = "weekly_limit";

/// 把智谱 `data` 里的 `limits[]` 解析成 tier 列表。
///
/// 按 `nextResetTime` 升序后：第 0 条 = 五小时桶（`five_hour`）、
/// 第 1 条 = 每周桶（`weekly_limit`）。老套餐（2026-02-12 前订阅）只回 1 条
/// `TOKENS_LIMIT`，自然降级为仅展示 `five_hour`；新套餐回 2 条。
/// 缺失 `nextResetTime` 时按 `i64::MAX` 排到末位。
fn parse_zhipu_token_tiers(data: &serde_json::Value) -> Vec<QuotaTier> {
    let mut token_limits: Vec<(i64, f64, Option<String>)> = Vec::new();
    if let Some(limits) = data.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            let limit_type = limit_item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // 大小写不敏感比较：上游若把 "TOKENS_LIMIT" 改成小写或驼峰，依然能识别
            if !(limit_type.eq_ignore_ascii_case("TOKENS_LIMIT")
                || limit_type.eq_ignore_ascii_case("CREDIT_LIMIT"))
            {
                continue;
            }
            let percentage = limit_item
                .get("percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let reset_ms = limit_item
                .get("nextResetTime")
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MAX);
            let reset_iso = if reset_ms == i64::MAX {
                None
            } else {
                millis_to_iso8601(reset_ms)
            };
            token_limits.push((reset_ms, percentage, reset_iso));
        }
    }
    token_limits.sort_by_key(|(reset, _, _)| *reset);

    token_limits
        .into_iter()
        .enumerate()
        .filter_map(|(idx, (_, percentage, resets_at))| {
            let name = match idx {
                0 => ZHIPU_TIER_FIVE_HOUR,
                1 => ZHIPU_TIER_WEEKLY_LIMIT,
                _ => return None,
            };
            Some(QuotaTier {
                name: name.to_string(),
                utilization: percentage,
                resets_at,
            })
        })
        .collect()
}

/// Resolve the Zhipu quota endpoint from the user's configured `base_url`.
///
/// Zhipu ships as two distinct presets (Zhipu GLM = `open.bigmodel.cn`,
/// Zhipu GLM en = `api.z.ai`) that share the same quota path and JSON shape.
/// The quota endpoint lives on the same host as the user's coding endpoint,
/// so we route by `base_url` — no cross-host fallback, no auth-error heuristics.
fn zhipu_quota_base(base_url: &str) -> &'static str {
    if base_url.to_lowercase().contains("bigmodel.cn") {
        "https://open.bigmodel.cn"
    } else {
        "https://api.z.ai"
    }
}

async fn query_zhipu(base_url: &str, api_key: &str) -> CodingPlanOutcome {
    let url = format!(
        "{}/api/monitor/usage/quota/limit",
        zhipu_quota_base(base_url)
    );
    query_zhipu_at(&url, api_key).await
}

/// 拆出 url 参数便于用本地 server 测试鉴权失败 / 没有套餐两条路径。
async fn query_zhipu_at(url: &str, api_key: &str) -> CodingPlanOutcome {
    use CodingPlanOutcome::Quota;
    let client = crate::proxy::http_client::get();

    let resp = client
        .get(url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .header("Accept-Language", "en-US,en")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return Quota(make_error(format!("Network error: {error}"))),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Quota(SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
            queried_at: Some(now_millis()),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Quota(make_error(format!("API error (HTTP {status}): {body}")));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return Quota(make_error(format!("Failed to parse response: {error}"))),
    };

    zhipu_outcome_from_body(&body)
}

/// 智谱个人版：账户没有 Coding Plan（按量付费）单独认出来，交给调用方改查余额。
fn zhipu_outcome_from_body(body: &serde_json::Value) -> CodingPlanOutcome {
    let quota = zhipu_quota_from_body(body);
    if zhipu_body_has_no_plan(body) {
        CodingPlanOutcome::ZhipuNoPlan(quota)
    } else {
        CodingPlanOutcome::Quota(quota)
    }
}

/// 按量账户查套餐时，接口回 HTTP 200 + 业务错误（2026-10-18 国内站实测）：
/// `{"code":500,"msg":"当前用户不存在coding plan","success":false}`。
/// 只认「msg 提到 coding plan 且说没有」，Key 无效（HTTP 401/403）、网络错误、
/// 其他业务错误都不算，免得把真故障显示成余额。英文站文案未实测，关键词放宽了几个说法。
fn zhipu_body_has_no_plan(body: &serde_json::Value) -> bool {
    if body.get("success").and_then(|v| v.as_bool()) != Some(false) {
        return false;
    }
    let msg = body
        .get("msg")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let compact: String = msg
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect();
    compact.contains("codingplan")
        && [
            "不存在",
            "没有",
            "未开通",
            "not exist",
            "not found",
            "not have",
            "doesn't have",
            "no coding plan",
            "not subscribed",
        ]
        .iter()
        .any(|kw| msg.contains(kw))
}

/// 解析智谱额度响应体。
fn zhipu_quota_from_body(body: &serde_json::Value) -> SubscriptionQuota {
    if body.get("success").and_then(|value| value.as_bool()) == Some(false) {
        let msg = body
            .get("msg")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error");
        return make_error(format!("API error: {msg}"));
    }

    let data = match body.get("data") {
        Some(value) => value,
        None => return make_error("Missing 'data' field in response".to_string()),
    };

    let tiers = parse_zhipu_token_tiers(data);

    let level = data
        .get("level")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: level,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

async fn query_minimax(api_key: &str, is_cn: bool) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();
    let api_domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{api_domain}/v1/api/openplatform/coding_plan/remains");

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
            queried_at: Some(now_millis()),
        };
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    if let Some(base_resp) = body.get("base_resp") {
        let status_code = base_resp
            .get("status_code")
            .and_then(|value| value.as_i64())
            .unwrap_or(-1);
        if status_code != 0 {
            let msg = base_resp
                .get("status_msg")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown error");
            return make_error(format!("API error (code {status_code}): {msg}"));
        }
    }

    let mut tiers = Vec::new();
    if let Some(model_remains) = body.get("model_remains").and_then(|value| value.as_array()) {
        if let Some(item) = model_remains.first() {
            let interval_total = item
                .get("current_interval_total_count")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let interval_remaining = item
                .get("current_interval_usage_count")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let end_time = item.get("end_time").and_then(|value| value.as_i64());

            if interval_total > 0.0 {
                tiers.push(QuotaTier {
                    name: "five_hour".to_string(),
                    utilization: ((interval_total - interval_remaining) / interval_total) * 100.0,
                    resets_at: end_time.and_then(millis_to_iso8601),
                });
            }

            let weekly_total = item
                .get("current_weekly_total_count")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let weekly_remaining = item
                .get("current_weekly_usage_count")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let weekly_end = item.get("weekly_end_time").and_then(|value| value.as_i64());

            if weekly_total > 0.0 {
                tiers.push(QuotaTier {
                    name: "weekly_limit".to_string(),
                    utilization: ((weekly_total - weekly_remaining) / weekly_total) * 100.0,
                    resets_at: weekly_end.and_then(millis_to_iso8601),
                });
            }
        }
    }

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

// ── OpenCode Go ─────────────────────────────────────────────

const OPENCODE_GO_TIER_FIVE_HOUR: &str = "five_hour";
const OPENCODE_GO_TIER_WEEKLY_LIMIT: &str = "weekly_limit";
const OPENCODE_GO_TIER_MONTHLY: &str = "monthly";

/// 解析 OpenCode Go usage 端点响应为 tier 列表。
///
/// 响应形态：`{"usage":{"rolling"|"weekly"|"monthly":{"status":"ok"|"rate-limited",
/// "percent":0-100 已用整数,"resetsAt":ISO8601}}}`，三窗口对应文档口径
/// $12/5h、$30/周、$60/月（端点不回传金额，仅百分比）。
///
/// 该端点是第一方但未文档化的路由，上线当天就改过一次形态，故逐窗口防御
/// 解析：缺失或 percent 不可解析的窗口跳过，不整体失败。percent 为 0 时上游的
/// `resetsAt` 是「now+窗口时长」的占位值，丢弃不展示倒计时。
fn parse_opencode_go_tiers(body: &serde_json::Value) -> Vec<QuotaTier> {
    const WINDOWS: [(&str, &str); 3] = [
        ("rolling", OPENCODE_GO_TIER_FIVE_HOUR),
        ("weekly", OPENCODE_GO_TIER_WEEKLY_LIMIT),
        ("monthly", OPENCODE_GO_TIER_MONTHLY),
    ];
    let Some(usage) = body.get("usage") else {
        return Vec::new();
    };
    let mut tiers = Vec::new();
    for (key, tier_name) in WINDOWS {
        let Some(window) = usage.get(key) else {
            continue;
        };
        let Some(percent) = window.get("percent").and_then(parse_f64) else {
            continue;
        };
        let resets_at = if percent > 0.0 {
            window.get("resetsAt").and_then(extract_reset_time)
        } else {
            None
        };
        tiers.push(QuotaTier {
            name: tier_name.to_string(),
            utilization: percent,
            resets_at,
        });
    }
    tiers
}

async fn query_opencode_go(api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    // 用量端点只认 `Authorization: Bearer`——与推理侧 /messages 只认
    // x-api-key 正好相反，不能互换。
    let resp = match client
        .get("https://opencode.ai/zen/go/v1/usage")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    // 403：key 本身有效（Zen 与 Go 共用同一把 workspace API key），但该 workspace
    // 没有 Go 订阅——与 401 认证失败分开提示。
    if status == reqwest::StatusCode::FORBIDDEN {
        return make_error(
            "API key is valid but has no OpenCode Go subscription (HTTP 403)".to_string(),
        );
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            reset_credits: None,
            credits_balance: None,
            plan_name: None,
            queried_at: Some(now_millis()),
        };
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    let tiers = parse_opencode_go_tiers(&body);
    // 三个窗口一个都没解析出来 = 响应形态不认识，明确报错而不是渲染一张空卡片。
    if tiers.is_empty() {
        return make_error("Unexpected usage response shape".to_string());
    }

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

// ── Command Code ─────────────────────────────────────────────

/// Command Code 的 `/alpha` 控制面接口固定在根域名；推理数据面才使用
/// `/provider` / `/provider/v1`。不要复用 provider 的 base_url。
const COMMAND_CODE_API_BASE: &str = "https://api.commandcode.ai";

enum CommandCodeFetch {
    Body(serde_json::Value),
    AuthExpired,
    Error(String),
}

fn command_code_url(base_url: &str, path: &str, params: &[(&str, &str)]) -> Result<String, String> {
    let mut url = url::Url::parse(&format!("{}{}", base_url.trim_end_matches('/'), path))
        .map_err(|e| format!("Invalid Command Code endpoint: {e}"))?;
    if !params.is_empty() {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    Ok(url.into())
}

/// `/alpha` 是官方 CLI 使用的私有路由，未公开文档化；保持宽松解析。
async fn fetch_command_code_json(
    client: &reqwest::Client,
    base_url: &str,
    path: &str,
    params: &[(&str, &str)],
    api_key: &str,
) -> Result<CommandCodeFetch, String> {
    let url = command_code_url(base_url, path, params)?;
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(CommandCodeFetch::AuthExpired);
    }

    let raw = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&raw);
        return Ok(CommandCodeFetch::Error(format!(
            "API error (HTTP {status}): {body}"
        )));
    }

    match serde_json::from_slice(&raw) {
        Ok(body) => Ok(CommandCodeFetch::Body(body)),
        Err(e) => Ok(CommandCodeFetch::Error(format!(
            "Failed to parse response: {e}"
        ))),
    }
}

fn command_code_auth_error() -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Expired,
        credential_message: Some("Invalid API key".to_string()),
        success: false,
        tiers: vec![],
        extra_usage: None,
        error: Some("Authentication failed (HTTP 401 Unauthorized)".to_string()),
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

fn command_code_window_tier(window: Option<&serde_json::Value>, name: &str) -> Option<QuotaTier> {
    let window = window?;
    let used = window.get("used").and_then(parse_f64)?;
    let cap = window.get("cap").and_then(parse_f64)?;
    if cap <= 0.0 {
        return None;
    }
    Some(QuotaTier {
        name: name.to_string(),
        utilization: used / cap * 100.0,
        resets_at: window.get("resetAt").and_then(extract_reset_time),
    })
}

fn parse_command_code_quota(
    credits_response: &serde_json::Value,
    subscription_response: Option<&serde_json::Value>,
    summary_response: &serde_json::Value,
) -> SubscriptionQuota {
    let Some(credit_root) = credits_response.get("credits") else {
        return make_error("Missing 'credits' field in response".to_string());
    };
    let credit_values = credit_root;

    // Command Code 的 monthly tier 是套餐级月度额度；purchased/free credits
    // 只参与月度百分比计算，不参与 5h/weekly rolling window。与 OpenCode Go
    // 一致，frontend 只展示三类窗口的百分比和重置倒计时。
    let monthly_remaining = credit_values
        .get("monthlyCredits")
        .and_then(parse_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let purchased_remaining = credit_values
        .get("purchasedCredits")
        .and_then(parse_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let free_remaining = credit_values
        .get("freeCredits")
        .and_then(parse_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let total_remaining = monthly_remaining + purchased_remaining + free_remaining;
    let Some(total_spent) = summary_response.get("totalCost").and_then(parse_f64) else {
        return make_error("Missing 'totalCost' field in response".to_string());
    };
    let total_spent = total_spent.max(0.0);
    let total_pool = total_spent + total_remaining;

    let subscription = subscription_response.and_then(|body| body.get("data"));
    let period_end = subscription
        .and_then(|data| data.get("currentPeriodEnd"))
        .and_then(extract_reset_time);
    let plan_id = subscription
        .and_then(|data| data.get("planId"))
        .and_then(|value| value.as_str())
        .or_else(|| credit_root.get("planId").and_then(|value| value.as_str()))
        .map(str::to_string);

    let mut tiers = Vec::new();
    // 实际 credits 响应把 windowLimits 放在 credits 同级；保留嵌套位置兼容
    // 已出现过的响应变体。
    if let Some(window_limits) = credits_response
        .get("windowLimits")
        .or_else(|| credit_root.get("windowLimits"))
    {
        if window_limits
            .get("limited")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            if let Some(tier) =
                command_code_window_tier(window_limits.get("fiveHour"), TIER_FIVE_HOUR)
            {
                tiers.push(tier);
            }
            if let Some(tier) =
                command_code_window_tier(window_limits.get("weekly"), TIER_WEEKLY_LIMIT)
            {
                tiers.push(tier);
            }
        }
    }

    tiers.push(QuotaTier {
        name: TIER_MONTHLY.to_string(),
        utilization: if total_pool > 0.0 {
            total_spent / total_pool * 100.0
        } else {
            0.0
        },
        resets_at: period_end,
    });

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: plan_id,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        reset_credits: None,
        credits_balance: None,
        plan_name: None,
        queried_at: Some(now_millis()),
    }
}

async fn query_command_code_at(base_url: &str, api_key: &str) -> Result<SubscriptionQuota, String> {
    let client = crate::proxy::http_client::get();

    let whoami = match fetch_command_code_json(
        &client,
        base_url,
        "/alpha/whoami",
        &[("limits", "1")],
        api_key,
    )
    .await?
    {
        CommandCodeFetch::Body(body) => body,
        CommandCodeFetch::AuthExpired => return Ok(command_code_auth_error()),
        CommandCodeFetch::Error(error) => return Ok(make_error(error)),
    };

    let org_id = whoami
        .get("org")
        .and_then(|org| org.get("id"))
        .and_then(|id| id.as_str())
        .map(str::to_string);
    let org_params: Vec<(&str, &str)> = org_id
        .as_deref()
        .map(|id| vec![("orgId", id)])
        .unwrap_or_default();

    let credits = match fetch_command_code_json(
        &client,
        base_url,
        "/alpha/billing/credits",
        &org_params,
        api_key,
    )
    .await?
    {
        CommandCodeFetch::Body(body) => body,
        CommandCodeFetch::AuthExpired => return Ok(command_code_auth_error()),
        CommandCodeFetch::Error(error) => return Ok(make_error(error)),
    };

    let subscription = match fetch_command_code_json(
        &client,
        base_url,
        "/alpha/billing/subscriptions",
        &org_params,
        api_key,
    )
    .await?
    {
        CommandCodeFetch::Body(body) => Some(body),
        CommandCodeFetch::AuthExpired => return Ok(command_code_auth_error()),
        CommandCodeFetch::Error(error) => return Ok(make_error(error)),
    };

    let period_start = subscription
        .as_ref()
        .and_then(|body| body.get("data"))
        .and_then(|data| data.get("currentPeriodStart"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let mut summary_params: Vec<(&str, &str)> = Vec::new();
    if let Some(period_start) = period_start.as_deref() {
        summary_params.push(("since", period_start));
    }
    if let Some(org_id) = org_id.as_deref() {
        summary_params.push(("orgId", org_id));
    }
    let summary = match fetch_command_code_json(
        &client,
        base_url,
        "/alpha/usage/summary",
        &summary_params,
        api_key,
    )
    .await?
    {
        CommandCodeFetch::Body(body) => body,
        CommandCodeFetch::AuthExpired => return Ok(command_code_auth_error()),
        CommandCodeFetch::Error(error) => return Ok(make_error(error)),
    };

    Ok(parse_command_code_quota(
        &credits,
        subscription.as_ref(),
        &summary,
    ))
}

async fn query_command_code(api_key: &str) -> Result<SubscriptionQuota, String> {
    query_command_code_at(COMMAND_CODE_API_BASE, api_key).await
}

pub async fn get_coding_plan_quota(
    base_url: &str,
    api_key: &str,
) -> Result<SubscriptionQuota, String> {
    query_coding_plan(base_url, api_key)
        .await
        .map(CodingPlanOutcome::into_quota)
}

/// 同 [`get_coding_plan_quota`]，但把「智谱账户没有 Coding Plan」单独返回，
/// 供用量查询入口改查余额。
pub(crate) async fn query_coding_plan(
    base_url: &str,
    api_key: &str,
) -> Result<CodingPlanOutcome, String> {
    use CodingPlanOutcome::Quota;

    if api_key.trim().is_empty() {
        return Ok(Quota(SubscriptionQuota::not_found("coding_plan")));
    }

    let provider = match detect_provider(base_url) {
        Some(provider) => provider,
        None => return Ok(Quota(SubscriptionQuota::not_found("coding_plan"))),
    };

    let quota = match provider {
        CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => {
            return Ok(query_zhipu(base_url, api_key).await)
        }
        CodingPlanProvider::Kimi => query_kimi(api_key).await,
        CodingPlanProvider::MiniMaxCn => query_minimax(api_key, true).await,
        CodingPlanProvider::MiniMaxEn => query_minimax(api_key, false).await,
        CodingPlanProvider::OpencodeGo => query_opencode_go(api_key).await,
        CodingPlanProvider::CommandCode => query_command_code(api_key).await?,
    };

    Ok(Quota(quota))
}

#[cfg(test)]
mod tests {
    use super::{
        detect_provider, parse_opencode_go_tiers, parse_zhipu_token_tiers, CodingPlanProvider,
        OPENCODE_GO_TIER_FIVE_HOUR, OPENCODE_GO_TIER_MONTHLY, OPENCODE_GO_TIER_WEEKLY_LIMIT,
        ZHIPU_TIER_FIVE_HOUR, ZHIPU_TIER_WEEKLY_LIMIT,
    };
    use super::{
        parse_command_code_quota, query_command_code_at, query_zhipu_at, zhipu_outcome_from_body,
        zhipu_quota_base, CodingPlanOutcome, CredentialStatus, TIER_FIVE_HOUR, TIER_MONTHLY,
        TIER_WEEKLY_LIMIT,
    };
    use serde_json::json;
    use std::io::{Read, Write};

    #[test]
    fn minimax_cn_detects_current_and_legacy_hosts() {
        for base_url in [
            "https://api.minimax.cn/v1",
            "https://API.MINIMAX.CN/anthropic",
            "https://api.minimaxi.com/v1",
        ] {
            assert!(matches!(
                detect_provider(base_url),
                Some(CodingPlanProvider::MiniMaxCn)
            ));
        }
        assert!(matches!(
            detect_provider("https://api.minimax.io/v1"),
            Some(CodingPlanProvider::MiniMaxEn)
        ));
        assert!(detect_provider("https://api.minimax.cn.example.com/v1").is_none());
        assert!(detect_provider("https://api.minimax.io.example.com/v1").is_none());
    }

    #[test]
    fn opencode_go_detects_current_and_legacy_bases_but_not_zen() {
        // Claude Desktop 预设 base 是 /inference/go/anthropic，Codex/OpenCode/Pi
        // 是 /inference/go/v1；旧入口 /zen/go[/v1] 仍可用，也要命中（上游 6837f361）。
        assert!(matches!(
            detect_provider("https://opencode.ai/inference/go/anthropic"),
            Some(CodingPlanProvider::OpencodeGo)
        ));
        assert!(matches!(
            detect_provider("https://opencode.ai/inference/go/v1"),
            Some(CodingPlanProvider::OpencodeGo)
        ));
        assert!(detect_provider("https://opencode.ai/inference/v1").is_none());
        // claude/claude-desktop 预设 base 是 /zen/go，codex/opencode/pi 是
        // /zen/go/v1，两档都要命中；Zen 按量版（/zen/v1）无用量 API，不得命中。
        assert!(matches!(
            detect_provider("https://opencode.ai/zen/go"),
            Some(CodingPlanProvider::OpencodeGo)
        ));
        assert!(matches!(
            detect_provider("https://opencode.ai/zen/go/v1"),
            Some(CodingPlanProvider::OpencodeGo)
        ));
        assert!(detect_provider("https://opencode.ai/zen/v1").is_none());
    }

    #[test]
    fn opencode_go_three_windows_map_to_known_tiers() {
        let body = json!({
            "usage": {
                "rolling": { "status": "ok", "percent": 37, "resetsAt": "2026-08-26T14:12:03.000Z" },
                "weekly":  { "status": "ok", "percent": 62, "resetsAt": "2026-08-31T00:00:00.000Z" },
                "monthly": { "status": "rate-limited", "percent": 100, "resetsAt": "2026-09-11T00:00:00.000Z" }
            }
        });
        let tiers = parse_opencode_go_tiers(&body);
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0].name, OPENCODE_GO_TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 37.0);
        assert_eq!(
            tiers[0].resets_at.as_deref(),
            Some("2026-08-26T14:12:03.000Z")
        );
        assert_eq!(tiers[1].name, OPENCODE_GO_TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 62.0);
        assert_eq!(tiers[2].name, OPENCODE_GO_TIER_MONTHLY);
        assert_eq!(tiers[2].utilization, 100.0);
    }

    #[test]
    fn opencode_go_zero_percent_drops_placeholder_reset_time() {
        let body = json!({
            "usage": {
                "rolling": { "status": "ok", "percent": 0, "resetsAt": "2026-08-26T15:00:00.000Z" }
            }
        });
        let tiers = parse_opencode_go_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].utilization, 0.0);
        assert!(tiers[0].resets_at.is_none());
    }

    #[test]
    fn opencode_go_partial_windows_skip_malformed() {
        let body = json!({
            "usage": {
                "rolling": { "status": "ok" },
                "weekly":  { "status": "ok", "percent": "12" },
                "monthly": null
            }
        });
        let tiers = parse_opencode_go_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, OPENCODE_GO_TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[0].utilization, 12.0);
    }

    #[test]
    fn opencode_go_legacy_flat_shape_returns_empty() {
        let body = json!({
            "useBalance": false,
            "rollingUsage": { "status": "ok", "usagePercent": 37, "resetInSec": 3600 }
        });
        assert!(parse_opencode_go_tiers(&body).is_empty());
    }

    #[test]
    fn zhipu_new_plan_two_tiers_sorted_by_reset_time() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 53.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 44.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TIME_LIMIT",   "percentage":  7.0 },
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, ZHIPU_TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 44.0);
        assert_eq!(tiers[1].name, ZHIPU_TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 53.0);
    }

    #[test]
    fn zhipu_old_plan_single_tier_falls_back_to_five_hour() {
        let data = json!({
            "limits": [
                {
                    "type": "TOKENS_LIMIT",
                    "percentage": 2.0,
                    "nextResetTime": 1_774_967_594_803_i64
                },
                { "type": "TIME_LIMIT", "percentage": 0.0 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, ZHIPU_TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 2.0);
    }

    #[test]
    fn zhipu_no_token_limits_returns_empty() {
        let data = json!({ "limits": [{ "type": "TIME_LIMIT", "percentage": 5.0 }] });
        assert!(parse_zhipu_token_tiers(&data).is_empty());
    }

    #[test]
    fn zhipu_missing_reset_time_sorts_last() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 99.0 },
                { "type": "TOKENS_LIMIT", "percentage": 10.0, "nextResetTime": 1_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, ZHIPU_TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 10.0);
        assert_eq!(tiers[1].name, ZHIPU_TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 99.0);
        assert!(tiers[1].resets_at.is_none());
    }

    #[test]
    fn zhipu_type_is_case_insensitive() {
        let data = json!({
            "limits": [
                { "type": "tokens_limit", "percentage": 12.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "Tokens_Limit", "percentage": 34.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 12.0);
        assert_eq!(tiers[1].utilization, 34.0);
    }

    #[test]
    fn zhipu_accepts_credit_limit_entries() {
        let data = json!({
            "limits": [
                { "type": "CREDIT_LIMIT", "percentage": 21.0, "nextResetTime": 1_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].utilization, 21.0);
    }

    #[test]
    fn zhipu_invalid_percentage_falls_back_to_zero() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": "invalid", "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": null,      "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 0.0);
        assert_eq!(tiers[1].utilization, 0.0);
    }

    #[test]
    fn zhipu_extreme_percentage_values_pass_through() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": -5.0,  "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 150.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, -5.0);
        assert_eq!(tiers[1].utilization, 150.0);
    }

    #[test]
    fn zhipu_more_than_two_token_tiers_keeps_first_two() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 1.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 2.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 3.0, "nextResetTime": 3_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 1.0);
        assert_eq!(tiers[1].utilization, 2.0);
    }

    #[test]
    fn command_code_detects_both_provider_base_variants() {
        assert!(matches!(
            detect_provider("https://api.commandcode.ai/provider"),
            Some(CodingPlanProvider::CommandCode)
        ));
        assert!(matches!(
            detect_provider("https://api.commandcode.ai/provider/v1"),
            Some(CodingPlanProvider::CommandCode)
        ));
        assert!(detect_provider("https://commandcode.ai/provider").is_none());
    }

    #[test]
    fn command_code_maps_balance_and_window_limits() {
        let credits = json!({
            "credits": {
                "planId": "provider",
                "monthlyCredits": 12.5,
                "purchasedCredits": 3.0,
                "freeCredits": 0.5,
                "windowLimits": {
                    "limited": true,
                    "fiveHour": {
                        "used": 4.0,
                        "cap": 14.0,
                        "resetAt": "2026-09-12T18:00:00.000Z"
                    },
                    "weekly": {
                        "used": 12.0,
                        "cap": 40.0,
                        "resetAt": "2026-09-16T00:00:00.000Z"
                    }
                }
            }
        });
        let subscription = json!({
            "data": {
                "planId": "goat",
                "status": "active",
                "currentPeriodStart": "2026-09-01T00:00:00.000Z",
                "currentPeriodEnd": "2026-10-01T00:00:00.000Z"
            }
        });
        let summary = json!({ "totalCost": 7.0 });

        let quota = parse_command_code_quota(&credits, Some(&subscription), &summary);

        assert!(quota.success);
        assert!(matches!(quota.credential_status, CredentialStatus::Valid));
        assert_eq!(quota.credential_message.as_deref(), Some("goat"));
        assert_eq!(quota.tiers.len(), 3);
        assert_eq!(quota.tiers[0].name, TIER_FIVE_HOUR);
        assert!((quota.tiers[0].utilization - (4.0 / 14.0 * 100.0)).abs() < 1e-9);
        assert_eq!(
            quota.tiers[0].resets_at.as_deref(),
            Some("2026-09-12T18:00:00.000Z")
        );
        assert_eq!(quota.tiers[1].name, TIER_WEEKLY_LIMIT);
        assert!((quota.tiers[1].utilization - 30.0).abs() < 1e-9);
        assert_eq!(quota.tiers[2].name, TIER_MONTHLY);
        assert!((quota.tiers[2].utilization - (7.0 / 23.0 * 100.0)).abs() < 1e-9);
        assert_eq!(
            quota.tiers[2].resets_at.as_deref(),
            Some("2026-10-01T00:00:00.000Z")
        );
    }

    #[test]
    fn command_code_parses_real_goat_subscription_shape() {
        let credits = json!({
            "credits": {
                "belowThreshold": false,
                "creditThreshold": 0,
                "monthlyCredits": 70,
                "purchasedCredits": 0,
                "freeCredits": 0
            },
            "windowLimits": {
                "limited": true,
                "exceeded": null,
                "fiveHour": {
                    "used": 0,
                    "cap": 14,
                    "exceeded": false,
                    "resetAt": 0
                },
                "weekly": {
                    "used": 0,
                    "cap": 35,
                    "exceeded": false,
                    "resetAt": 0
                }
            }
        });
        let subscription = json!({
            "success": true,
            "data": {
                "status": "active",
                "currentPeriodStart": "2026-09-13T01:01:27.000Z",
                "currentPeriodEnd": "2026-10-13T01:01:27.000Z",
                "planId": "individual-goat"
            }
        });
        let summary = json!({
            "totalCost": 0,
            "periodBasis": "billing-period"
        });

        let quota = parse_command_code_quota(&credits, Some(&subscription), &summary);

        assert!(quota.success);
        assert!(matches!(quota.credential_status, CredentialStatus::Valid));
        assert_eq!(quota.credential_message.as_deref(), Some("individual-goat"));
        assert_eq!(quota.tiers.len(), 3);
        assert_eq!(quota.tiers[0].name, TIER_FIVE_HOUR);
        assert!((quota.tiers[0].utilization - 0.0).abs() < 1e-9);
        assert!(quota.tiers[0].resets_at.is_none());
        assert_eq!(quota.tiers[1].name, TIER_WEEKLY_LIMIT);
        assert!((quota.tiers[1].utilization - 0.0).abs() < 1e-9);
        assert!(quota.tiers[1].resets_at.is_none());
        assert_eq!(quota.tiers[2].name, TIER_MONTHLY);
        assert!((quota.tiers[2].utilization - 0.0).abs() < 1e-9);
        assert_eq!(
            quota.tiers[2].resets_at.as_deref(),
            Some("2026-10-13T01:01:27.000Z")
        );
    }

    #[test]
    fn command_code_pay_as_you_go_has_balance_without_subscription() {
        let credits = json!({
            "credits": {
                "planId": "provider",
                "monthlyCredits": 0,
                "purchasedCredits": 18.25,
                "freeCredits": 0,
                "windowLimits": { "limited": false }
            }
        });

        let quota = parse_command_code_quota(
            &credits,
            None,
            &json!({
                "totalCost": 0
            }),
        );

        assert!(quota.success);
        assert_eq!(quota.credential_message.as_deref(), Some("provider"));
        assert_eq!(quota.tiers.len(), 1);
        assert_eq!(quota.tiers[0].name, TIER_MONTHLY);
        assert!(quota.tiers[0].resets_at.is_none());
    }

    #[test]
    fn command_code_skips_malformed_windows() {
        let credits = json!({
            "credits": {
                "monthlyCredits": 1,
                "purchasedCredits": 0,
                "freeCredits": 0,
                "windowLimits": {
                    "limited": true,
                    "fiveHour": { "used": 1, "cap": 0 },
                    "weekly": { "used": 1, "cap": 10, "resetAt": "2026-09-16T00:00:00Z" }
                }
            }
        });

        let quota = parse_command_code_quota(
            &credits,
            None,
            &json!({
                "totalCost": 1
            }),
        );

        assert!(quota.success);
        assert_eq!(quota.tiers.len(), 2);
        assert_eq!(quota.tiers[0].name, TIER_WEEKLY_LIMIT);
        assert_eq!(quota.tiers[1].name, TIER_MONTHLY);
    }

    #[test]
    fn command_code_missing_credits_is_deterministic_error() {
        let quota = parse_command_code_quota(&json!({}), None, &json!({}));
        assert!(!quota.success);
        assert!(quota
            .error
            .expect("error")
            .contains("Missing 'credits' field"));
    }

    #[test]
    fn command_code_missing_total_cost_is_deterministic_error() {
        let quota = parse_command_code_quota(&json!({ "credits": {} }), None, &json!({}));

        assert!(!quota.success);
        assert!(quota
            .error
            .expect("error")
            .contains("Missing 'totalCost' field"));
    }

    #[tokio::test]
    async fn command_code_401_maps_to_expired_credentials() {
        ensure_no_proxy_for_loopback();
        let (base_url, handle) = spawn_once_server(Some(http_response("401 Unauthorized", "{}")));

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("auth failure must be deterministic");

        assert!(!quota.success);
        assert!(matches!(quota.credential_status, CredentialStatus::Expired));
        assert!(quota
            .error
            .expect("error")
            .contains("Authentication failed (HTTP 401"));
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_403_is_reported_with_body() {
        ensure_no_proxy_for_loopback();
        let (base_url, handle) = spawn_once_server(Some(http_response(
            "403 Forbidden",
            r#"{"error":{"code":"upgrade_required"}}"#,
        )));

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("403 must be deterministic");

        assert!(!quota.success);
        assert!(quota.error.expect("error").contains("HTTP 403"));
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_429_is_reported_as_deterministic_error() {
        ensure_no_proxy_for_loopback();
        let (base_url, handle) =
            spawn_once_server(Some(http_response("429 Too Many Requests", "slow down")));

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("non-2xx must remain a deterministic result");

        assert!(!quota.success);
        assert!(quota.error.expect("error").contains("HTTP 429"));
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_invalid_json_is_deterministic_parse_error() {
        ensure_no_proxy_for_loopback();
        let (base_url, handle) = spawn_once_server(Some(http_response("200 OK", "not-json")));

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("invalid JSON must be deterministic");

        assert!(!quota.success);
        assert!(quota
            .error
            .expect("error")
            .contains("Failed to parse response"));
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_subscription_transient_is_err() {
        ensure_no_proxy_for_loopback();
        let responses = vec![
            Some(http_response(
                "200 OK",
                r#"{"success":true,"user":{"id":"u-1"},"org":{"id":"org-1"}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"credits":{"monthlyCredits":70,"purchasedCredits":0,"freeCredits":0},"windowLimits":{"limited":true,"fiveHour":{"used":0,"cap":14},"weekly":{"used":0,"cap":35}}}"#,
            )),
            None,
        ];
        let (base_url, _, handle) = spawn_sequence_server(responses);

        query_command_code_at(&base_url, "k")
            .await
            .expect_err("subscription 传输失败必须返回 Err，不能降级成无订阅");
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_summary_transient_is_err() {
        ensure_no_proxy_for_loopback();
        let responses = vec![
            Some(http_response(
                "200 OK",
                r#"{"success":true,"user":{"id":"u-1"},"org":{"id":"org-1"}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"credits":{"monthlyCredits":70,"purchasedCredits":0,"freeCredits":0},"windowLimits":{"limited":true,"fiveHour":{"used":0,"cap":14},"weekly":{"used":0,"cap":35}}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"success":true,"data":{"status":"active","currentPeriodStart":"2026-09-13T01:01:27.000Z","currentPeriodEnd":"2026-10-13T01:01:27.000Z","planId":"individual-goat"}}"#,
            )),
            None,
        ];
        let (base_url, _, handle) = spawn_sequence_server(responses);

        query_command_code_at(&base_url, "k")
            .await
            .expect_err("summary 传输失败必须返回 Err，不能把已用量降级成 0");
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_summary_http_error_is_deterministic() {
        ensure_no_proxy_for_loopback();
        let responses = vec![
            Some(http_response(
                "200 OK",
                r#"{"success":true,"user":{"id":"u-1"},"org":{"id":"org-1"}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"credits":{"monthlyCredits":70,"purchasedCredits":0,"freeCredits":0},"windowLimits":{"limited":true,"fiveHour":{"used":0,"cap":14},"weekly":{"used":0,"cap":35}}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"success":true,"data":{"status":"active","currentPeriodStart":"2026-09-13T01:01:27.000Z","currentPeriodEnd":"2026-10-13T01:01:27.000Z","planId":"individual-goat"}}"#,
            )),
            Some(http_response("500 Internal Server Error", "{}")),
        ];
        let (base_url, _, handle) = spawn_sequence_server(responses);

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("summary 非 2xx 必须是确定性结果");
        assert!(!quota.success);
        assert!(quota.error.expect("error").contains("HTTP 500"));
        handle.join().expect("server thread");
    }

    #[tokio::test]
    async fn command_code_queries_all_four_alpha_endpoints_in_order() {
        ensure_no_proxy_for_loopback();
        let responses = vec![
            Some(http_response(
                "200 OK",
                r#"{"success":true,"user":{"id":"u-1"},"org":{"id":"org-1"}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"credits":{"belowThreshold":false,"creditThreshold":0,"monthlyCredits":70,"purchasedCredits":0,"freeCredits":0},"windowLimits":{"limited":true,"exceeded":null,"fiveHour":{"used":0,"cap":14,"exceeded":false,"resetAt":0},"weekly":{"used":0,"cap":35,"exceeded":false,"resetAt":0}}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"success":true,"data":{"status":"active","currentPeriodStart":"2026-09-13T01:01:27.000Z","currentPeriodEnd":"2026-10-13T01:01:27.000Z","planId":"individual-goat"}}"#,
            )),
            Some(http_response(
                "200 OK",
                r#"{"totalCost":0,"periodBasis":"billing-period"}"#,
            )),
        ];
        let (base_url, captured_paths, handle) = spawn_sequence_server(responses);

        let quota = query_command_code_at(&base_url, "k")
            .await
            .expect("完整链路必须返回成功");

        let paths = captured_paths.lock().unwrap().clone();
        assert_eq!(
            paths,
            vec![
                "/alpha/whoami?limits=1",
                "/alpha/billing/credits?orgId=org-1",
                "/alpha/billing/subscriptions?orgId=org-1",
                "/alpha/usage/summary?since=2026-09-13T01%3A01%3A27.000Z&orgId=org-1"
            ]
        );
        assert!(quota.success);
        assert_eq!(quota.tiers.len(), 3);
        assert_eq!(quota.tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(quota.tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(quota.tiers[2].name, TIER_MONTHLY);
        handle.join().expect("server thread");
    }

    fn ensure_no_proxy_for_loopback() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            std::env::set_var("NO_PROXY", "127.0.0.1,localhost");
            std::env::set_var("no_proxy", "127.0.0.1,localhost");
        });
    }

    fn http_response(status_line: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn spawn_once_server(response: Option<String>) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local listener");
        let port = listener.local_addr().expect("local addr").port();
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                if let Some(resp) = response {
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.flush();
                }
            }
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    fn spawn_sequence_server(
        responses: Vec<Option<String>>,
    ) -> (
        String,
        std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local listener");
        let port = listener.local_addr().expect("local addr").port();
        let captured_paths = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let captured_paths_clone = captured_paths.clone();
        let handle = std::thread::spawn(move || {
            for response in responses {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 2048];
                    let _ = stream.read(&mut buf);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    let path = text
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .map(|path| path.to_string())
                        .unwrap_or_default();
                    captured_paths_clone.lock().unwrap().push(path);
                    if let Some(response) = response {
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                    }
                }
            }
        });
        (format!("http://127.0.0.1:{port}"), captured_paths, handle)
    }

    #[test]
    fn zhipu_quota_base_routes_by_configured_host() {
        assert_eq!(
            zhipu_quota_base("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn"
        );
        // 大小写不敏感，与 detect_provider 一致
        assert_eq!(
            zhipu_quota_base("HTTPS://OPEN.BIGMODEL.CN/api/anthropic"),
            "https://open.bigmodel.cn"
        );
        assert_eq!(
            zhipu_quota_base("https://api.z.ai/api/paas/v4"),
            "https://api.z.ai"
        );
        // 没有明显智谱域名特征时默认走国际站
        assert_eq!(
            zhipu_quota_base("https://example.com/zhipu"),
            "https://api.z.ai"
        );
    }

    // ── 智谱个人版：没有套餐单独返回，交给用量入口改查余额（#8465）──

    /// 2026-10-18 国内站无套餐按量 Key 实测原文。
    const ZHIPU_NO_PLAN_BODY: &str =
        r#"{"code":500,"msg":"当前用户不存在coding plan","success":false}"#;

    #[test]
    fn zhipu_no_plan_body_is_told_apart_from_other_errors() {
        let no_plan: serde_json::Value = serde_json::from_str(ZHIPU_NO_PLAN_BODY).unwrap();
        match zhipu_outcome_from_body(&no_plan) {
            CodingPlanOutcome::ZhipuNoPlan(quota) => {
                // 不回落的调用方（弹窗测试）拿到的仍是原来的失败文案
                assert!(!quota.success);
                assert!(quota.error.unwrap().contains("coding plan"));
            }
            CodingPlanOutcome::Quota(_) => panic!("无套餐应单独返回"),
        }

        for body in [
            json!({ "code": 500, "msg": "The current user does not have a coding plan", "success": false }),
            json!({ "code": 500, "msg": "Coding Plan not exist", "success": false }),
        ] {
            assert!(
                matches!(
                    zhipu_outcome_from_body(&body),
                    CodingPlanOutcome::ZhipuNoPlan(_)
                ),
                "{body}"
            );
        }

        // 其他业务错误、提到套餐但不是「没有」、success 不是 false 都不算没套餐
        for body in [
            json!({ "code": 1001, "msg": "令牌已过期或验证不正确", "success": false }),
            json!({ "code": 500, "msg": "coding plan 查询超时", "success": false }),
            json!({ "code": 500, "msg": "当前用户不存在coding plan" }),
            json!({ "success": true, "data": { "limits": [] } }),
        ] {
            assert!(
                matches!(zhipu_outcome_from_body(&body), CodingPlanOutcome::Quota(_)),
                "{body}"
            );
        }
    }

    #[tokio::test]
    async fn zhipu_personal_query_routes_plan_no_plan_and_auth_failure() {
        ensure_no_proxy_for_loopback();

        // 有套餐 → 套餐档位
        let plan_body = json!({
            "success": true,
            "data": {
                "level": "pro",
                "limits": [{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 12.0 }]
            }
        })
        .to_string();
        let (base, handle) = spawn_once_server(Some(http_response("200 OK", &plan_body)));
        let outcome = query_zhipu_at(&base, "key").await;
        handle.join().unwrap();
        let CodingPlanOutcome::Quota(quota) = outcome else {
            panic!("有套餐不应回落余额");
        };
        assert!(quota.success);
        assert_eq!(quota.tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(quota.tiers[0].utilization, 12.0);

        // 没有套餐（HTTP 200 + 业务错误）→ ZhipuNoPlan
        let (base, handle) = spawn_once_server(Some(http_response("200 OK", ZHIPU_NO_PLAN_BODY)));
        let outcome = query_zhipu_at(&base, "key").await;
        handle.join().unwrap();
        assert!(matches!(outcome, CodingPlanOutcome::ZhipuNoPlan(_)));

        // Key 无效 → 仍报鉴权失败，不回落余额
        let (base, handle) = spawn_once_server(Some(http_response(
            "401 Unauthorized",
            r#"{"error":{"code":"1000","message":"身份验证失败。"}}"#,
        )));
        let outcome = query_zhipu_at(&base, "bad").await;
        handle.join().unwrap();
        let CodingPlanOutcome::Quota(quota) = outcome else {
            panic!("鉴权失败不应回落余额");
        };
        assert!(!quota.success);
        assert!(matches!(quota.credential_status, CredentialStatus::Expired));
        assert!(quota.error.unwrap().contains("Authentication failed"));
    }
}
