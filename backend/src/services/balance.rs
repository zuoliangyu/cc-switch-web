//! 供应商余额查询服务
//!
//! 支持 DeepSeek、StepFun、SiliconFlow、OpenRouter、Novita AI 的账户余额查询。

use crate::provider::{UsageData, UsageResult};
use std::time::Duration;

enum BalanceProvider {
    DeepSeek,
    StepFun,
    SiliconFlow,
    SiliconFlowEn,
    OpenRouter,
    NovitaAI,
}

fn detect_provider(base_url: &str) -> Option<BalanceProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.deepseek.com") {
        Some(BalanceProvider::DeepSeek)
    } else if url.contains("api.stepfun.ai") || url.contains("api.stepfun.com") {
        Some(BalanceProvider::StepFun)
    } else if url.contains("api.siliconflow.cn") {
        Some(BalanceProvider::SiliconFlow)
    } else if url.contains("api.siliconflow.com") {
        Some(BalanceProvider::SiliconFlowEn)
    } else if url.contains("openrouter.ai") {
        Some(BalanceProvider::OpenRouter)
    } else if url.contains("api.novita.ai") {
        Some(BalanceProvider::NovitaAI)
    } else {
        None
    }
}

fn make_error(msg: String) -> UsageResult {
    UsageResult {
        success: false,
        data: None,
        error: Some(msg),
    }
}

fn make_auth_error(status: reqwest::StatusCode) -> UsageResult {
    UsageResult {
        success: false,
        data: Some(vec![UsageData {
            plan_name: None,
            remaining: None,
            total: None,
            used: None,
            unit: None,
            is_valid: Some(false),
            invalid_message: Some(format!("Authentication failed (HTTP {status})")),
            extra: None,
        }]),
        error: Some(format!("Authentication failed (HTTP {status})")),
    }
}

async fn query_deepseek(api_key: &str) -> UsageResult {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.deepseek.com/user/balance")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return make_auth_error(status);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    parse_deepseek_balance(&body)
}

// `is_available` 只表示余额够不够调用，不代表 Key 失效（失效是 401/403，上面已处理），
// 所以不拿它判 is_valid，否则零余额 / 欠费会被显示成「套餐已过期」；交给 UI 按余额红字显示（#8812）。
fn parse_deepseek_balance(body: &serde_json::Value) -> UsageResult {
    let mut data = Vec::new();

    if let Some(infos) = body.get("balance_infos").and_then(|v| v.as_array()) {
        for info in infos {
            let currency = info
                .get("currency")
                .and_then(|v| v.as_str())
                .unwrap_or("CNY");
            let total = parse_f64_field(info, "total_balance");

            data.push(UsageData {
                plan_name: Some(currency.to_string()),
                remaining: total,
                total: None,
                used: None,
                unit: Some(currency.to_string()),
                is_valid: Some(true),
                invalid_message: None,
                extra: None,
            });
        }
    }

    // 同一账号会列出 CNY / USD 两个币种钱包，扣费走有钱的那个。只要还有币种有余额，
    // 就不再列出空钱包：否则空的那一行会显示一条红字余额，两行还会让卡片自动展开（#8170）。
    if data.iter().any(|d| d.remaining.is_some_and(|v| v > 0.0)) {
        data.retain(|d| d.remaining.is_none_or(|v| v > 0.0));
    }

    UsageResult {
        success: true,
        data: if data.is_empty() { None } else { Some(data) },
        error: None,
    }
}

async fn query_stepfun(api_key: &str) -> UsageResult {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.stepfun.com/v1/accounts")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return make_auth_error(status);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    let balance = parse_f64_field(&body, "balance").unwrap_or(0.0);

    UsageResult {
        success: true,
        data: Some(vec![UsageData {
            plan_name: Some("StepFun".to_string()),
            remaining: Some(balance),
            total: None,
            used: None,
            unit: Some("CNY".to_string()),
            is_valid: Some(true),
            invalid_message: None,
            extra: None,
        }]),
        error: None,
    }
}

async fn query_siliconflow(api_key: &str, is_cn: bool) -> UsageResult {
    let client = crate::proxy::http_client::get();
    let domain = if is_cn {
        "api.siliconflow.cn"
    } else {
        "api.siliconflow.com"
    };
    let url = format!("https://{domain}/v1/user/info");

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return make_auth_error(status);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    let data = match body.get("data") {
        Some(value) => value,
        None => return make_error("Missing 'data' field in response".to_string()),
    };
    let total_balance = parse_f64_field(data, "totalBalance").unwrap_or(0.0);

    let unit = if is_cn { "CNY" } else { "USD" };
    let plan_name = if is_cn {
        "SiliconFlow"
    } else {
        "SiliconFlow (EN)"
    };

    UsageResult {
        success: true,
        data: Some(vec![UsageData {
            plan_name: Some(plan_name.to_string()),
            remaining: Some(total_balance),
            total: None,
            used: None,
            unit: Some(unit.to_string()),
            is_valid: Some(true),
            invalid_message: None,
            extra: None,
        }]),
        error: None,
    }
}

async fn query_openrouter(api_key: &str) -> UsageResult {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://openrouter.ai/api/v1/credits")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return make_auth_error(status);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    parse_openrouter_balance(&body)
}

// /key 的 limit_remaining 是消费上限而不是账户余额，所以读 /credits。
fn parse_openrouter_balance(body: &serde_json::Value) -> UsageResult {
    let data = body.get("data").unwrap_or(body);
    let (Some(total_credits), Some(total_usage)) = (
        parse_f64_field(data, "total_credits").filter(|v| v.is_finite()),
        parse_f64_field(data, "total_usage").filter(|v| v.is_finite()),
    ) else {
        return make_error("Missing or invalid OpenRouter credit amounts".to_string());
    };
    let remaining = total_credits - total_usage;
    if !remaining.is_finite() {
        return make_error("Invalid OpenRouter credit balance".to_string());
    }

    UsageResult {
        success: true,
        data: Some(vec![UsageData {
            plan_name: Some("OpenRouter".to_string()),
            remaining: Some(remaining),
            total: Some(total_credits),
            used: Some(total_usage),
            unit: Some("USD".to_string()),
            // /credits reports purchased credits, not key expiration. A free
            // account can have no credits and still use free models; let the
            // UI show the balance without marking the key as expired.
            is_valid: Some(true),
            invalid_message: None,
            extra: None,
        }]),
        error: None,
    }
}

async fn query_novita(api_key: &str) -> UsageResult {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.novita.ai/v3/user/balance")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let resp = match resp {
        Ok(resp) => resp,
        Err(error) => return make_error(format!("Network error: {error}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return make_auth_error(status);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(value) => value,
        Err(error) => return make_error(format!("Failed to parse response: {error}")),
    };

    parse_novita_balance(&body)
}

fn parse_novita_balance(body: &serde_json::Value) -> UsageResult {
    // Novita 金额单位为 0.0001 USD，需除以 10000 转为 USD
    let Some(available) = parse_f64_field(body, "availableBalance")
        .map(|v| v / 10000.0)
        .filter(|v| v.is_finite())
    else {
        return make_error("Missing or invalid Novita AI balance".to_string());
    };

    UsageResult {
        success: true,
        data: Some(vec![UsageData {
            plan_name: Some("Novita AI".to_string()),
            remaining: Some(available),
            total: None,
            used: None,
            unit: Some("USD".to_string()),
            // 余额为 0 或负数不代表 key 失效：交给 UI 按余额红字显示，
            // 而不是标成套餐已过期（同 OpenRouter，#8175）
            is_valid: Some(true),
            invalid_message: None,
            extra: None,
        }]),
        error: None,
    }
}

fn parse_f64_field(obj: &serde_json::Value, field: &str) -> Option<f64> {
    obj.get(field).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
    })
}

pub async fn get_balance(base_url: &str, api_key: &str) -> Result<UsageResult, String> {
    if api_key.trim().is_empty() {
        return Ok(UsageResult {
            success: false,
            data: None,
            error: Some("API key is empty".to_string()),
        });
    }

    let provider = match detect_provider(base_url) {
        Some(provider) => provider,
        None => {
            return Ok(UsageResult {
                success: false,
                data: None,
                error: Some("Unknown balance provider".to_string()),
            });
        }
    };

    let result = match provider {
        BalanceProvider::DeepSeek => query_deepseek(api_key).await,
        BalanceProvider::StepFun => query_stepfun(api_key).await,
        BalanceProvider::SiliconFlow => query_siliconflow(api_key, true).await,
        BalanceProvider::SiliconFlowEn => query_siliconflow(api_key, false).await,
        BalanceProvider::OpenRouter => query_openrouter(api_key).await,
        BalanceProvider::NovitaAI => query_novita(api_key).await,
    };

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openrouter_balance_does_not_determine_key_validity() {
        // Free accounts, exhausted paid accounts, and overdrawn accounts do not
        // imply an expired key. Positive balances must retain their amounts too.
        for (credits, usage, remaining) in [
            (0.0, 0.0, 0.0),
            (100.0, 100.0, 0.0),
            (100.0, 105.0, -5.0),
            (100.0, 25.5, 74.5),
        ] {
            let result = parse_openrouter_balance(&json!({
                "data": { "total_credits": credits, "total_usage": usage }
            }));
            assert!(result.success);
            assert!(result.error.is_none());
            let data = result.data.unwrap();
            assert_eq!(data.len(), 1);
            let balance = &data[0];
            assert_eq!(balance.plan_name.as_deref(), Some("OpenRouter"));
            assert_eq!(balance.unit.as_deref(), Some("USD"));
            assert_eq!(balance.total, Some(credits));
            assert_eq!(balance.used, Some(usage));
            assert_eq!(balance.remaining, Some(remaining));
            assert_eq!(balance.is_valid, Some(true));
            assert!(balance.invalid_message.is_none());
        }
    }

    #[test]
    fn openrouter_balance_accepts_numeric_strings_and_unwrapped_response() {
        let result = parse_openrouter_balance(&json!({
            "total_credits": "100.00", "total_usage": "25.50"
        }));
        assert!(result.success);
        let balance = result.data.unwrap().remove(0);
        assert_eq!(balance.total, Some(100.0));
        assert_eq!(balance.used, Some(25.5));
        assert_eq!(balance.remaining, Some(74.5));
    }

    #[test]
    fn openrouter_balance_rejects_missing_or_invalid_amounts() {
        for body in [
            json!({}),
            json!({ "data": null }),
            json!({ "data": { "limit": 100, "limit_remaining": 100, "is_free_tier": true } }),
            json!({ "data": { "total_credits": 100 } }),
            json!({ "data": { "total_usage": 0 } }),
            json!({ "data": { "total_credits": null, "total_usage": 0 } }),
            json!({ "data": { "total_credits": 100, "total_usage": "invalid" } }),
            json!({ "data": { "total_credits": "NaN", "total_usage": 0 } }),
            json!({ "data": { "total_credits": 100, "total_usage": "inf" } }),
            json!({ "data": { "total_credits": 1e308, "total_usage": -1e308 } }),
        ] {
            let result = parse_openrouter_balance(&body);
            assert!(!result.success, "unexpected success for {body}");
            assert!(result.data.is_none());
            assert!(result.error.is_some());
        }
    }

    #[test]
    fn deepseek_balance_hides_empty_wallets_when_another_has_funds() {
        let result = parse_deepseek_balance(&json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "CNY", "total_balance": "0.00" },
                { "currency": "USD", "total_balance": "12.34" }
            ]
        }));
        assert!(result.success);
        let data = result.data.unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].unit.as_deref(), Some("USD"));
        assert_eq!(data[0].remaining, Some(12.34));
    }

    #[test]
    fn deepseek_balance_keeps_every_wallet_when_none_or_all_have_funds() {
        for (cny, usd, expected) in [("0.00", "0.00", 2), ("5.00", "1.00", 2)] {
            let result = parse_deepseek_balance(&json!({
                "is_available": cny != "0.00",
                "balance_infos": [
                    { "currency": "CNY", "total_balance": cny },
                    { "currency": "USD", "total_balance": usd }
                ]
            }));
            assert_eq!(result.data.unwrap().len(), expected);
        }

        let result = parse_deepseek_balance(&json!({
            "balance_infos": [{ "currency": "CNY", "total_balance": "0.00" }]
        }));
        assert_eq!(result.data.unwrap()[0].remaining, Some(0.0));
    }

    #[test]
    fn deepseek_unavailable_balance_does_not_determine_key_validity() {
        for (raw, expected) in [("-24.96", -24.96), ("-0.00", 0.0)] {
            let result = parse_deepseek_balance(&json!({
                "is_available": false,
                "balance_infos": [{ "currency": "CNY", "total_balance": raw }]
            }));
            assert!(result.success);
            let balance = result.data.unwrap().remove(0);
            assert_eq!(balance.remaining, Some(expected));
            assert_eq!(balance.is_valid, Some(true));
            assert!(balance.invalid_message.is_none());
        }
    }

    #[test]
    fn novita_balance_does_not_determine_key_validity() {
        for (raw, available) in [(0.0, 0.0), (-50000.0, -5.0), (255000.0, 25.5)] {
            let result = parse_novita_balance(&json!({ "availableBalance": raw }));
            assert!(result.success);
            let balance = result.data.unwrap().remove(0);
            assert_eq!(balance.remaining, Some(available));
            assert_eq!(balance.unit.as_deref(), Some("USD"));
            assert_eq!(balance.is_valid, Some(true));
            assert!(balance.invalid_message.is_none());
        }

        let result = parse_novita_balance(&json!({ "availableBalance": "10000" }));
        assert_eq!(result.data.unwrap()[0].remaining, Some(1.0));
    }

    #[test]
    fn novita_balance_rejects_missing_or_invalid_amount() {
        for body in [
            json!({}),
            json!({ "availableBalance": null }),
            json!({ "availableBalance": "invalid" }),
            json!({ "availableBalance": "inf" }),
            json!({ "cashBalance": 10000 }),
        ] {
            let result = parse_novita_balance(&body);
            assert!(!result.success, "unexpected success for {body}");
            assert!(result.data.is_none());
            assert!(result.error.is_some());
        }
    }
}
