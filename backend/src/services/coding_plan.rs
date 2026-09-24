//! Token Plan / 编程套餐额度查询服务
//!
//! 支持 Kimi For Coding、智谱 GLM、MiniMax、OpenCode Go 的套餐额度查询。

use super::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};
use std::time::{SystemTime, UNIX_EPOCH};

enum CodingPlanProvider {
    Kimi,
    ZhipuCn,
    ZhipuEn,
    MiniMaxCn,
    MiniMaxEn,
    /// OpenCode Go（$10/月订阅，美元额度三时间窗口）。base_url 分两档：
    /// `https://opencode.ai/zen/go`（claude/claude-desktop 直连 /messages）
    /// 与 `https://opencode.ai/zen/go/v1`（codex/opencode/pi 走 Chat）。
    OpencodeGo,
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
    } else if url.contains("opencode.ai/zen/go") {
        // 同时覆盖 /zen/go 与 /zen/go/v1 两档 base；Zen 按量版（/zen/v1）
        // 没有任何用量/余额 API（实测 404），刻意不命中。
        Some(CodingPlanProvider::OpencodeGo)
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
        queried_at: Some(now_millis()),
    }
}

async fn query_kimi(api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.kimi.com/coding/v1/usages")
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

async fn query_zhipu(api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.z.ai/api/monitor/usage/quota/limit")
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .header("Accept-Language", "en-US,en")
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
        queried_at: Some(now_millis()),
    }
}

pub async fn get_coding_plan_quota(
    base_url: &str,
    api_key: &str,
) -> Result<SubscriptionQuota, String> {
    if api_key.trim().is_empty() {
        return Ok(SubscriptionQuota::not_found("coding_plan"));
    }

    let provider = match detect_provider(base_url) {
        Some(provider) => provider,
        None => return Ok(SubscriptionQuota::not_found("coding_plan")),
    };

    let quota = match provider {
        CodingPlanProvider::Kimi => query_kimi(api_key).await,
        CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => query_zhipu(api_key).await,
        CodingPlanProvider::MiniMaxCn => query_minimax(api_key, true).await,
        CodingPlanProvider::MiniMaxEn => query_minimax(api_key, false).await,
        CodingPlanProvider::OpencodeGo => query_opencode_go(api_key).await,
    };

    Ok(quota)
}

#[cfg(test)]
mod tests {
    use super::{
        detect_provider, parse_opencode_go_tiers, parse_zhipu_token_tiers, CodingPlanProvider,
        OPENCODE_GO_TIER_FIVE_HOUR, OPENCODE_GO_TIER_MONTHLY, OPENCODE_GO_TIER_WEEKLY_LIMIT,
        ZHIPU_TIER_FIVE_HOUR, ZHIPU_TIER_WEEKLY_LIMIT,
    };
    use serde_json::json;

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
    fn opencode_go_detects_both_base_variants_but_not_zen() {
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
}
