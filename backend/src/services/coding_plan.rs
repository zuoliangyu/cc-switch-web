//! 国产 Token Plan 额度查询服务
//!
//! 支持 Kimi For Coding、智谱 GLM、MiniMax 的 Token Plan 额度查询。

use super::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};
use std::time::{SystemTime, UNIX_EPOCH};

enum CodingPlanProvider {
    Kimi,
    ZhipuCn,
    ZhipuEn,
    MiniMaxCn,
    MiniMaxEn,
}

fn detect_provider(base_url: &str) -> Option<CodingPlanProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.kimi.com/coding") {
        Some(CodingPlanProvider::Kimi)
    } else if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") {
        Some(CodingPlanProvider::ZhipuCn)
    } else if url.contains("api.z.ai") {
        Some(CodingPlanProvider::ZhipuEn)
    } else if url.contains("api.minimaxi.com") {
        Some(CodingPlanProvider::MiniMaxCn)
    } else if url.contains("api.minimax.io") {
        Some(CodingPlanProvider::MiniMaxEn)
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
        let ms = if raw < 1_000_000_000_000 { raw * 1000 } else { raw };
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
/// 双桶响应中，5 小时桶在 0% 等状态下可能没有 `nextResetTime`；
/// 这类无 reset 条目应优先归为五小时桶。其余条目按 `nextResetTime` 升序。
/// 老套餐（2026-02-12 前订阅）只回 1 条 `TOKENS_LIMIT`，自然降级为仅展示
/// `five_hour`；新套餐回 2 条。（跟随上游 177eef66）
fn parse_zhipu_token_tiers(data: &serde_json::Value) -> Vec<QuotaTier> {
    let mut token_limits: Vec<(Option<i64>, f64, Option<String>)> = Vec::new();
    if let Some(limits) = data.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            let limit_type = limit_item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // 大小写不敏感比较：上游若把 "TOKENS_LIMIT" 改成小写或驼峰，依然能识别
            if !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
                continue;
            }
            let percentage = limit_item
                .get("percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let reset_ms = limit_item.get("nextResetTime").and_then(|v| v.as_i64());
            let reset_iso = reset_ms.and_then(millis_to_iso8601);
            token_limits.push((reset_ms, percentage, reset_iso));
        }
    }
    // 无 nextResetTime 的条目排在前（= five_hour 桶）；有 reset 的按时间升序。
    token_limits.sort_by_key(|(reset, _, _)| (reset.is_some(), reset.unwrap_or(i64::MIN)));

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

    // 提取纯函数便于无 mock 单元测试；新接口直接给"剩余百分比"，反转为已用百分比（跟随上游 43ae1e5f）
    let tiers = parse_minimax_tiers(&body);

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

/// 从 `/coding_plan/remains` 响应中解析 MiniMax 编程套餐的额度 tier（跟随上游 43ae1e5f）。
///
/// 新接口语义：`current_*_remaining_percent` 是"剩余百分比"(0-100)，
/// `model_remains` 数组里有 `general`(编程套餐)和 `video` 等其他模型，这里只取
/// `general`、跳过 video。5h 桶始终存在；周桶并非所有套餐都有，靠
/// `current_weekly_status == 1` 判定激活（无周限额套餐该字段为 3，不应展示）。
fn parse_minimax_tiers(body: &serde_json::Value) -> Vec<QuotaTier> {
    let mut tiers = Vec::new();

    let Some(model_remains) = body.get("model_remains").and_then(|v| v.as_array()) else {
        return tiers;
    };

    // 只取 model_name == "general" 的条目，跳过 video 等非编程模型
    let Some(item) = model_remains.iter().find(|item| {
        item.get("model_name")
            .and_then(|v| v.as_str())
            .map(|s| s == "general")
            .unwrap_or(false)
    }) else {
        return tiers;
    };

    // 5h 桶：剩余百分比 → 已用百分比
    if let Some(remain_pct) = item
        .get("current_interval_remaining_percent")
        .and_then(|v| v.as_f64())
    {
        let resets_at = item
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_iso8601);
        tiers.push(QuotaTier {
            name: "five_hour".to_string(),
            utilization: 100.0 - remain_pct,
            resets_at,
        });
    }

    // 周桶：仅当 status=1 时激活；status=3 等表示该套餐无周限额，跳过
    if item.get("current_weekly_status").and_then(|v| v.as_i64()) == Some(1) {
        if let Some(remain_pct) = item
            .get("current_weekly_remaining_percent")
            .and_then(|v| v.as_f64())
        {
            let resets_at = item
                .get("weekly_end_time")
                .and_then(|v| v.as_i64())
                .and_then(millis_to_iso8601);
            tiers.push(QuotaTier {
                name: "weekly_limit".to_string(),
                utilization: 100.0 - remain_pct,
                resets_at,
            });
        }
    }

    tiers
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
    };

    Ok(quota)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_minimax_tiers, parse_zhipu_token_tiers, ZHIPU_TIER_FIVE_HOUR, ZHIPU_TIER_WEEKLY_LIMIT,
    };
    use serde_json::json;

    // ── MiniMax（跟随上游 43ae1e5f；web 用字面量 "five_hour"/"weekly_limit"）──

    #[test]
    fn minimax_general_two_tiers_from_remaining_percent() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 98.0,
                    "current_weekly_remaining_percent": 95.0,
                    "current_interval_status": 1,
                    "current_weekly_status": 1,
                    "end_time": 1_780_329_600_000_i64,
                    "weekly_end_time": 1_780_848_000_000_i64
                },
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100.0,
                    "current_weekly_remaining_percent": 100.0
                }
            ],
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, "five_hour");
        assert_eq!(tiers[0].utilization, 2.0);
        assert!(tiers[0].resets_at.is_some());
        assert_eq!(tiers[1].name, "weekly_limit");
        assert_eq!(tiers[1].utilization, 5.0);
        assert!(tiers[1].resets_at.is_some());
    }

    #[test]
    fn minimax_skips_video_and_finds_general_in_any_position() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 50.0,
                    "current_weekly_remaining_percent": 50.0
                },
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 80.0,
                    "current_weekly_remaining_percent": 70.0,
                    "current_interval_status": 1,
                    "current_weekly_status": 1
                }
            ]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 20.0);
        assert_eq!(tiers[1].utilization, 30.0);
    }

    #[test]
    fn minimax_missing_general_returns_empty() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100.0,
                    "current_weekly_remaining_percent": 100.0
                }
            ]
        });
        assert!(parse_minimax_tiers(&body).is_empty());

        let body_empty: serde_json::Value = json!({ "model_remains": [] });
        assert!(parse_minimax_tiers(&body_empty).is_empty());

        let body_no_field = json!({});
        assert!(parse_minimax_tiers(&body_no_field).is_empty());
    }

    #[test]
    fn minimax_missing_percent_fields_skips_tier() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 60.0,
                "current_weekly_status": 1
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, "five_hour");
        assert_eq!(tiers[0].utilization, 40.0);
    }

    #[test]
    fn minimax_negative_percent_passes_through() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": -5.0,
                "current_weekly_remaining_percent": 150.0,
                "current_interval_status": 1,
                "current_weekly_status": 1
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 105.0);
        assert_eq!(tiers[1].utilization, -50.0);
    }

    #[test]
    fn minimax_weekly_status_3_skips_weekly_tier() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "general",
                    "end_time": 1_780_365_600_000_i64,
                    "current_interval_remaining_percent": 99,
                    "current_interval_status": 1,
                    "weekly_end_time": 1_780_848_000_000_i64,
                    "current_weekly_status": 3,
                    "current_weekly_remaining_percent": 100
                },
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100,
                    "current_weekly_status": 3,
                    "current_weekly_remaining_percent": 100
                }
            ],
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, "five_hour");
        assert_eq!(tiers[0].utilization, 1.0);
        assert!(tiers[0].resets_at.is_some());
    }

    #[test]
    fn minimax_weekly_status_2_also_skips_weekly_tier() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 80.0,
                "current_weekly_remaining_percent": 50.0,
                "current_weekly_status": 2
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, "five_hour");
        assert_eq!(tiers[0].utilization, 20.0);
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
    fn zhipu_missing_reset_time_is_five_hour_when_weekly_has_reset() {
        // 真实反馈：5 小时桶为 0% 时可能没有 nextResetTime；每周桶带 reset。
        // 这种形态不能按 reset 升序把每周桶误判为 five_hour（跟随上游 177eef66）。
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 25.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 0.0 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, ZHIPU_TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 0.0);
        assert!(tiers[0].resets_at.is_none());
        assert_eq!(tiers[1].name, ZHIPU_TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 25.0);
        assert!(tiers[1].resets_at.is_some());
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
