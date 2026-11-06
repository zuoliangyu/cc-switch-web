//! 使用统计服务
//!
//! 提供使用量数据的聚合查询功能

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::calculator::ModelPricing;
use crate::services::sql_helpers::{fresh_input_sql, real_total_tokens_sql};
use chrono::{Local, NaiveDate, TimeZone, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

/// 使用量汇总
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_requests: u64,
    pub total_cost: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub success_rate: f32,
    /// input + output + cache_creation + cache_read — the total tokens
    /// actually processed by the model (including cache hits). Used as the
    /// headline "real consumption" number in the usage hero.
    pub real_total_tokens: u64,
    /// cache_read / (input + cache_creation + cache_read). Range 0.0–1.0.
    /// Reported as a fraction; multiply by 100 in UI for percentage display.
    pub cache_hit_rate: f64,
}

/// Per-app-type usage summary used by the dashboard breakdown rail.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryByApp {
    pub app_type: String,
    pub summary: UsageSummary,
}

/// Helper: compute (real_total, hit_rate) from the four token counters.
/// All inputs must already be cache-normalized (i.e. input excludes cache).
fn derive_real_total_and_hit_rate(
    fresh_input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
) -> (u64, f64) {
    let real_total = fresh_input + output + cache_creation + cache_read;
    let cacheable_input = fresh_input + cache_creation + cache_read;
    let hit_rate = if cacheable_input > 0 {
        cache_read as f64 / cacheable_input as f64
    } else {
        0.0
    };
    (real_total, hit_rate)
}

// 汇总查询的一行（请求数、花费、四类 Token、成功数）转成 [`UsageSummary`]。
/// 列顺序须与 `get_usage_summary` / `get_session_usage_summary` 的 SELECT 一致。
fn usage_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UsageSummary> {
    let total_requests: i64 = row.get(0)?;
    let total_cost: f64 = row.get(1)?;
    let total_input_tokens: i64 = row.get(2)?;
    let total_output_tokens: i64 = row.get(3)?;
    let total_cache_creation_tokens: i64 = row.get(4)?;
    let total_cache_read_tokens: i64 = row.get(5)?;
    let success_count: i64 = row.get(6)?;

    let success_rate = if total_requests > 0 {
        (success_count as f32 / total_requests as f32) * 100.0
    } else {
        0.0
    };

    let (real_total_tokens, cache_hit_rate) = derive_real_total_and_hit_rate(
        total_input_tokens as u64,
        total_output_tokens as u64,
        total_cache_creation_tokens as u64,
        total_cache_read_tokens as u64,
    );

    Ok(UsageSummary {
        total_requests: total_requests as u64,
        total_cost: format!("{total_cost:.6}"),
        total_input_tokens: total_input_tokens as u64,
        total_output_tokens: total_output_tokens as u64,
        total_cache_creation_tokens: total_cache_creation_tokens as u64,
        total_cache_read_tokens: total_cache_read_tokens as u64,
        success_rate,
        real_total_tokens,
        cache_hit_rate,
    })
}

/// 每日统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStats {
    pub date: String,
    pub request_count: u64,
    pub total_cost: String,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
}

/// Provider 统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStats {
    pub provider_id: String,
    pub app_type: String,
    pub provider_name: String,
    pub request_count: u64,
    /// 真实消耗 Tokens（新增输入 + 输出 + 缓存写入 + 缓存命中），与指标卡同口径。
    pub total_tokens: u64,
    pub total_cost: String,
    pub success_rate: f32,
    pub avg_latency_ms: u64,
    /// 速度的分子：满足条件（有首字、输出 >= 100 token、耗时 > 首字）的明细请求的输出 token 之和。
    /// 汇总速度 = speed_output_tokens / (speed_generation_ms / 1000)，不是逐条平均。
    /// 日汇总（rollup）没有逐条计时，不计入。
    pub speed_output_tokens: u64,
    /// 速度的分母：同一批请求的 (latency_ms - first_token_ms) 之和，单位毫秒。
    pub speed_generation_ms: u64,
    /// 估算速度的分子：会话日志导入的请求里，有估算耗时、输出 >= 200 token 的那些的输出之和。
    /// 和上面那组分开累计：估算的耗时含首字等待，口径不同，不能加在一起。
    pub est_speed_output_tokens: u64,
    /// 估算速度的分母：同一批请求的 latency_ms 之和，单位毫秒。
    pub est_speed_duration_ms: u64,
    /// 首字时间中位数（毫秒）：经路由服务、成功的流式明细请求；没有这样的请求时为 None。
    pub first_token_median_ms: Option<u64>,
    /// 估算首字中位数（毫秒）：会话日志导入、按时间戳推出了首字的明细请求。
    /// 和上面分开：口径不同，界面上只在没有精确值时显示，带 ≈。
    pub est_first_token_median_ms: Option<u64>,
}

/// 计速度的门槛：输出少于这个数的请求（工具调用这类）不算速度，避免 0.1 秒回 15 个 token 算出离谱的数。
pub const SPEED_MIN_OUTPUT_TOKENS: i64 = 100;

/// 生成窗口（耗时 − 首字）短于这个毫秒数时不算速度：中转站缓冲后一次性吐出、
/// 或短回复整段落在同一个网络包里，算出来的是传输突发而不是生成速度。
pub const SPEED_MIN_GENERATION_MS: i64 = 100;

/// 明细行能不能计速度的 SQL 条件（和前端 `isSpeedEligible` 同口径）。会话日志导入的行
/// 也可能有首字（按时间戳推出来的），所以先按来源分开，不能只看有没有首字。
fn speed_eligible_sql(alias: &str) -> String {
    let data_source = data_source_expr(alias);
    format!(
        "{data_source} = 'proxy' AND {alias}.first_token_ms IS NOT NULL \
         AND {alias}.output_tokens >= {SPEED_MIN_OUTPUT_TOKENS} \
         AND {alias}.latency_ms - {alias}.first_token_ms >= {SPEED_MIN_GENERATION_MS}"
    )
}

/// 估算速度的输出门槛：估算的耗时含首字等待，输出越少首字占比越大、算出来越偏低，
/// 所以比精确口径的门槛高。实测 200–300 token 的请求比长请求低约四分之一，
/// 100–200 的低约四成；而 Codex 的请求只有四分之一超过 500，门槛再高大半行都是空的。
pub const SPEED_ESTIMATE_MIN_OUTPUT_TOKENS: i64 = 200;

/// 估算耗时短于这个毫秒数时不估速度：输出 200 token 以上却不到 1 秒，多半是起点取晚了。
pub const SPEED_ESTIMATE_MIN_DURATION_MS: i64 = 1000;

/// 明细行能不能估速度的 SQL 条件（和前端 `isSpeedEstimateEligible` 同口径）：
/// 会话日志导入的行，耗时是导入时按日志时间戳估的。估算速度仍按整段耗时算（含首字
/// 等待），不减推出来的首字：只有部分请求推得出首字，减了会让同一行里两种算法混在一起。
fn speed_estimate_eligible_sql(alias: &str) -> String {
    let data_source = data_source_expr(alias);
    format!(
        "{data_source} <> 'proxy' \
         AND {alias}.output_tokens >= {SPEED_ESTIMATE_MIN_OUTPUT_TOKENS} \
         AND {alias}.latency_ms >= {SPEED_ESTIMATE_MIN_DURATION_MS}"
    )
}

/// 明细行能不能计首字时间的 SQL 条件：经路由服务、成功、有首字计时（流式请求）。
fn first_token_eligible_sql(alias: &str) -> String {
    let data_source = data_source_expr(alias);
    format!(
        "{data_source} = 'proxy' AND {alias}.first_token_ms IS NOT NULL \
         AND {alias}.status_code >= 200 AND {alias}.status_code < 300"
    )
}

/// 估算首字的 SQL 条件：会话日志导入、导入时按时间戳推出了首字的行。
/// 和路由的精确首字分开取中位数：估算的起点是上一条日志写盘的时刻，含客户端
/// 组装请求的时间，系统性偏高。
fn est_first_token_eligible_sql(alias: &str) -> String {
    let data_source = data_source_expr(alias);
    format!("{data_source} <> 'proxy' AND {alias}.first_token_ms IS NOT NULL")
}

/// 按分组键取首字时间的中位数（毫秒）。首字时间长尾明显，偶尔一次排队就是十几秒，
/// 平均值会被拉高，所以用中位数；SQLite 没有中位数函数，取出排好序的值在这里算。
/// `key_sql` 是分组键表达式，`from_sql` 是 `FROM ... JOIN ...`，`detail_where` 是统计查询
/// 明细部分的 `WHERE ...`（可为空），`params` 是它的参数。
fn first_token_medians(
    conn: &Connection,
    key_sql: &str,
    from_sql: &str,
    detail_where: &str,
    eligible_sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<HashMap<String, u64>, AppError> {
    let connector = if detail_where.is_empty() {
        "WHERE"
    } else {
        "AND"
    };
    let sql = format!(
        "SELECT {key_sql} AS k, l.first_token_ms {from_sql} {detail_where} {connector} {eligible_sql}
         ORDER BY k, l.first_token_ms"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?.max(0) as u64,
        ))
    })?;

    let mut grouped: HashMap<String, Vec<u64>> = HashMap::new();
    for row in rows {
        let (key, ms) = row?;
        grouped.entry(key).or_default().push(ms);
    }
    Ok(grouped
        .into_iter()
        .map(|(key, values)| {
            // 已按值升序取出
            let mid = values.len() / 2;
            let median = if values.len() % 2 == 0 {
                (values[mid - 1] + values[mid]) / 2
            } else {
                values[mid]
            };
            (key, median)
        })
        .collect())
}

/// 模型统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub model: String,
    pub request_count: u64,
    /// 真实消耗 Tokens（新增输入 + 输出 + 缓存写入 + 缓存命中），与指标卡同口径。
    pub total_tokens: u64,
    pub total_cost: String,
    pub avg_cost_per_request: String,
    pub success_rate: f32,
    /// 速度的分子分母，口径同 [`ProviderStats::speed_output_tokens`] 那四个字段。
    pub speed_output_tokens: u64,
    pub speed_generation_ms: u64,
    pub est_speed_output_tokens: u64,
    pub est_speed_duration_ms: u64,
    /// 首字时间中位数，口径同 [`ProviderStats`] 的那两个字段。
    pub first_token_median_ms: Option<u64>,
    pub est_first_token_median_ms: Option<u64>,
}

/// 请求日志过滤器
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilters {
    pub app_type: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
    pub status_code: Option<u16>,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
}

/// 分页请求日志响应
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedLogs {
    pub data: Vec<RequestLogDetail>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

/// 请求日志详情
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogDetail {
    pub request_id: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    pub app_type: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_model: Option<String>,
    pub cost_multiplier: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub input_cost_usd: String,
    pub output_cost_usd: String,
    pub cache_read_cost_usd: String,
    pub cache_creation_cost_usd: String,
    pub total_cost_usd: String,
    pub is_streaming: bool,
    pub latency_ms: u64,
    pub first_token_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub status_code: u16,
    pub error_message: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_source: Option<String>,
}

/// 把 24 列的查询结果映射为 `RequestLogDetail`。
///
/// 调用方的 SELECT **必须**按以下顺序返回 24 列：
/// `request_id, provider_id, provider_name, app_type, model, request_model,
///  cost_multiplier, input_tokens, output_tokens, cache_read_tokens,
///  cache_creation_tokens, input_cost_usd, output_cost_usd, cache_read_cost_usd,
///  cache_creation_cost_usd, total_cost_usd, is_streaming, latency_ms,
///  first_token_ms, duration_ms, status_code, error_message, created_at,
///  data_source`
///
/// Web 的请求日志没有上游的 `pricing_model`、`input_token_semantics` 列。
fn row_to_request_log_detail(row: &rusqlite::Row<'_>) -> rusqlite::Result<RequestLogDetail> {
    Ok(RequestLogDetail {
        request_id: row.get(0)?,
        provider_id: row.get(1)?,
        provider_name: row.get(2)?,
        app_type: row.get(3)?,
        model: row.get(4)?,
        request_model: row.get(5)?,
        cost_multiplier: row
            .get::<_, Option<String>>(6)?
            .unwrap_or_else(|| "1".to_string()),
        input_tokens: row.get::<_, i64>(7)? as u32,
        output_tokens: row.get::<_, i64>(8)? as u32,
        cache_read_tokens: row.get::<_, i64>(9)? as u32,
        cache_creation_tokens: row.get::<_, i64>(10)? as u32,
        input_cost_usd: row.get(11)?,
        output_cost_usd: row.get(12)?,
        cache_read_cost_usd: row.get(13)?,
        cache_creation_cost_usd: row.get(14)?,
        total_cost_usd: row.get(15)?,
        is_streaming: row.get::<_, i64>(16)? != 0,
        latency_ms: row.get::<_, i64>(17)? as u64,
        first_token_ms: row.get::<_, Option<i64>>(18)?.map(|v| v as u64),
        duration_ms: row.get::<_, Option<i64>>(19)?.map(|v| v as u64),
        status_code: row.get::<_, i64>(20)? as u16,
        error_message: row.get(21)?,
        created_at: row.get(22)?,
        data_source: row.get(23)?,
    })
}

/// SQL fragment: resolve provider_name with fallback for session-based entries.
/// Session logs use placeholder provider_ids (e.g., `_session`, `_<app>_session`)
/// that don't exist in the providers table — the CASE expression below is the
/// authoritative mapping from placeholder to readable name.
fn provider_name_coalesce(log_alias: &str, provider_alias: &str) -> String {
    format!(
        "COALESCE({provider_alias}.name, CASE {log_alias}.provider_id \
         WHEN '_session' THEN 'Claude (Session)' \
         WHEN '_codex_session' THEN 'Codex (Session)' \
         WHEN '_gemini_session' THEN 'Gemini (Session)' \
         WHEN '_opencode_session' THEN 'OpenCode (Session)' \
         WHEN '_grok_session' THEN 'Grok Build (Session)' \
         WHEN '_agy_session' THEN 'Antigravity (Session)' \
         WHEN '_kimi_session' THEN 'Kimi Code (Session)' \
         WHEN '_dsh_session' THEN 'DeepSeek Harness (Session)' \
         WHEN '_dsh_account_session' THEN 'DeepSeek Harness (OAuth)' \
         WHEN '_mcode_session' THEN 'MiniMax Code (Session)' \
         WHEN '_pi_session' THEN 'Pi (Session)' \
         WHEN '_omp_session' THEN 'Oh My Pi (Session)' \
         ELSE {log_alias}.provider_id END)"
    )
}

pub(crate) const SESSION_PROXY_DEDUP_WINDOW_SECONDS: i64 = 10 * 60;

/// SQL 片段：把指定别名的 `data_source` 包成 COALESCE，NULL 视作 'proxy'。
///
/// 防御 schema v9 之前可能写入的 NULL data_source 行（见
/// `tests::create_legacy_nullable_logs_table`）。所有用到 data_source 的查询
/// 都应通过此 helper 生成片段，避免遗漏。
fn data_source_expr(log_alias: &str) -> String {
    format!("COALESCE({log_alias}.data_source, 'proxy')")
}

fn dedup_app_type_match_sql(left: &str, right: &str) -> String {
    format!(
        "{left} IN ({right}, CASE WHEN {right} = 'claude' THEN 'claude-desktop' ELSE {right} END)"
    )
}

/// SQL 标量表达式：把 Claude Desktop 网关的 `claude-desktop` app_type 在“展示口径”
/// 上折叠进 `claude`，其余 app_type 原样返回。
///
/// 背景：Desktop 网关流量在记账层按各自入口写为 `app_type='claude-desktop'`，
/// 以保留路由接管的账单审计精度（不要回退这一点）。但 Dashboard 把它当作
/// Claude Code 呈现——它本质就是跑在 Desktop 壳里的内嵌 Claude Code 运行时，
/// 且 Desktop 聊天用量永远不经过本软件，单列只会让用户误以为是“桌面版全部用量”。
///
/// 用法：把任一参与“按应用筛选/分组”的 `app_type` 列包进此表达式即可，
/// 这样 `= 'claude'` 过滤会同时命中 `claude-desktop`、`GROUP BY` 会把两者合并，
/// 而不改动任何已存储的行（详情面板仍读原始 `app_type`）。
///
/// 注意：包裹后该列上的索引在此比较中失效，但这些都是已带时间过滤的聚合扫描，
/// app_type 本就不是主访问路径，可接受。仅用于读侧；跨源去重使用更窄的
/// [`dedup_app_type_match_sql`]，额度检查（`check_provider_limits`）仍保留原始精确比较。
fn folded_app_type_sql(column: &str) -> String {
    format!("CASE WHEN {column} = 'claude-desktop' THEN 'claude' ELSE {column} END")
}

/// SQL 片段：把日志/汇总行 LEFT JOIN 到 providers 表以取得供应商名称。
/// `proxy_request_logs` 与 `usage_daily_rollups` 的 (provider_id, app_type)
/// 形状相同，两者皆可作为 `log_alias`。providers 主键即 (id, app_type)，
/// 连接至多 1:1，不会放大行数。
fn providers_join(log_alias: &str, provider_alias: &str) -> String {
    format!(
        "LEFT JOIN providers {provider_alias} \
         ON {log_alias}.provider_id = {provider_alias}.id \
         AND {log_alias}.app_type = {provider_alias}.app_type"
    )
}

/// SQL 标量表达式：行的「有效计价模型」。这是 `get_model_stats` 的分组键，也是
/// Dashboard 模型筛选的匹配口径：筛选值来自模型统计列表，两边必须用同一表达式才能选得中。
/// 上游优先取 `pricing_model`；Web 的两张表没有这一列，就是 `model`。
fn effective_model_sql(alias: &str) -> String {
    format!("{alias}.model")
}

/// 把 Dashboard 顶部的 Provider/模型筛选追加到查询条件。
///
/// Provider 按展示名精确匹配（复用 [`provider_name_coalesce`]，会话占位行的
/// 可读名如 "Claude (Session)" 也能选中）；模型按 [`effective_model_sql`] 匹配。
/// 注意：传入 `provider_name` 时调用方必须把 [`providers_join`] 拼进 FROM，
/// 否则 `{provider_alias}.name` 无法解析。
fn push_provider_model_filters(
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
    log_alias: &str,
    provider_alias: &str,
    provider_name: Option<&str>,
    model: Option<&str>,
) {
    if let Some(name) = provider_name {
        conditions.push(format!(
            "{} = ?",
            provider_name_coalesce(log_alias, provider_alias)
        ));
        params.push(Box::new(name.to_string()));
    }
    if let Some(m) = model {
        conditions.push(format!("{} = ?", effective_model_sql(log_alias)));
        params.push(Box::new(m.to_string()));
    }
}

/// 跨来源去重的模型匹配条件。
///
/// 常规路径按上游回显模型匹配。仅 Codex 会话允许再匹配代理记录的请求模型：
/// Codex rollout 保留客户端别名，而代理 `model` 可能已被映射为实际上游模型。
/// 空白或 `unknown` 请求模型不能放宽匹配，避免无有效别名时扩大启发式去重范围。
fn session_proxy_model_match_sql(
    proxy_model: &str,
    proxy_request_model: &str,
    session_model: &str,
    session_app_type: &str,
    session_data_source: &str,
) -> String {
    format!(
        "(
            LOWER({proxy_model}) = LOWER({session_model})
            OR LOWER({proxy_model}) = 'unknown'
            OR LOWER({session_model}) = 'unknown'
            OR (
                {session_app_type} = 'codex'
                AND {session_data_source} = 'codex_session'
                AND NULLIF(TRIM({proxy_request_model}), '') IS NOT NULL
                AND LOWER(TRIM({proxy_request_model})) <> 'unknown'
                AND LOWER(TRIM({proxy_request_model})) = LOWER(TRIM({session_model}))
            )
        )"
    )
}

pub(crate) fn effective_usage_log_filter(log_alias: &str) -> String {
    let app_type_match =
        dedup_app_type_match_sql("proxy_dedup.app_type", &format!("{log_alias}.app_type"));
    let model_match = session_proxy_model_match_sql(
        "proxy_dedup.model",
        "proxy_dedup.request_model",
        &format!("{log_alias}.model"),
        &format!("{log_alias}.app_type"),
        &format!("{log_alias}.data_source"),
    );
    format!(
        "NOT (
            {log_alias}.data_source IN ('session_log', 'codex_session', 'gemini_session')
            AND EXISTS (
                SELECT 1
                FROM proxy_request_logs proxy_dedup
                WHERE proxy_dedup.data_source = 'proxy'
                  AND {app_type_match}
                  AND proxy_dedup.status_code >= 200
                  AND proxy_dedup.status_code < 300
                  AND proxy_dedup.input_tokens = {log_alias}.input_tokens
                  AND proxy_dedup.output_tokens = {log_alias}.output_tokens
                  AND proxy_dedup.cache_read_tokens = {log_alias}.cache_read_tokens
                  AND (
                      proxy_dedup.cache_creation_tokens = {log_alias}.cache_creation_tokens
                      OR (
                          {log_alias}.cache_creation_tokens = 0
                          AND {log_alias}.data_source IN ('codex_session', 'gemini_session')
                      )
                      OR (
                          proxy_dedup.cache_creation_tokens = 0
                          AND {log_alias}.data_source = 'codex_session'
                      )
                  )
                  AND proxy_dedup.created_at BETWEEN
                      {log_alias}.created_at - {SESSION_PROXY_DEDUP_WINDOW_SECONDS}
                      AND {log_alias}.created_at + {SESSION_PROXY_DEDUP_WINDOW_SECONDS}
                  AND {model_match}
            )
        )"
    )
}

const DEDUP_SESSION_SOURCES_SQL: &str = "'session_log', 'codex_session', 'gemini_session'";

/// Dashboard 读路径用的去重条件：语义和 [`effective_usage_log_filter`] 完全一致，
/// 只是先看时间窗口里两类日志各有多少，再挑便宜的写法。
///
/// - 窗口里没有成功的代理日志、或没有会话日志：不可能有重复，直接不加条件。
/// - 代理日志更少：先从代理日志出发找出重复的会话行（一次性子查询），
///   主查询只做 `rowid NOT IN`，不再逐行关联。会话日志占绝大多数时快很多。
/// - 会话日志更少：保留原来的逐行 `EXISTS`。
///
/// 时间边界放宽 [`SESSION_PROXY_DEDUP_WINDOW_SECONDS`]，窗口外的代理行
/// 不可能匹配窗口内的会话行；边界是整数，直接拼进 SQL。
pub(crate) fn effective_usage_log_filter_for_range(
    conn: &Connection,
    log_alias: &str,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<String, AppError> {
    let lo = start_date
        .map(|v| v.saturating_sub(SESSION_PROXY_DEDUP_WINDOW_SECONDS))
        .unwrap_or(i64::MIN / 2);
    let hi = end_date
        .map(|v| v.saturating_add(SESSION_PROXY_DEDUP_WINDOW_SECONDS))
        .unwrap_or(i64::MAX / 2);
    let data_source = "c.data_source";
    let (proxy_count, session_count): (i64, i64) = conn.query_row(
        &format!(
            "SELECT
                COALESCE(SUM(CASE WHEN {data_source} = 'proxy'
                    AND c.status_code >= 200 AND c.status_code < 300 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN {data_source} IN ({DEDUP_SESSION_SOURCES_SQL})
                    THEN 1 ELSE 0 END), 0)
             FROM proxy_request_logs c
             WHERE c.created_at BETWEEN ?1 AND ?2"
        ),
        rusqlite::params![lo, hi],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    if proxy_count == 0 || session_count == 0 {
        return Ok("1 = 1".to_string());
    }
    if proxy_count > session_count {
        return Ok(effective_usage_log_filter(log_alias));
    }

    let dp_source = "dedup_p.data_source";
    let ds_source = "dedup_s.data_source";
    let model_match = session_proxy_model_match_sql(
        "dedup_p.model",
        "dedup_p.request_model",
        "dedup_s.model",
        "dedup_s.app_type",
        ds_source,
    );
    Ok(format!(
        "{log_alias}.rowid NOT IN (
            SELECT dedup_s.rowid
            FROM proxy_request_logs dedup_p
            JOIN proxy_request_logs dedup_s
              ON dedup_s.app_type IN (
                     dedup_p.app_type,
                     CASE WHEN dedup_p.app_type = 'claude-desktop' THEN 'claude' ELSE dedup_p.app_type END
                 )
             AND {ds_source} IN ({DEDUP_SESSION_SOURCES_SQL})
             AND dedup_s.input_tokens = dedup_p.input_tokens
             AND dedup_s.output_tokens = dedup_p.output_tokens
             AND dedup_s.cache_read_tokens = dedup_p.cache_read_tokens
             AND dedup_s.created_at BETWEEN
                 dedup_p.created_at - {SESSION_PROXY_DEDUP_WINDOW_SECONDS}
                 AND dedup_p.created_at + {SESSION_PROXY_DEDUP_WINDOW_SECONDS}
             AND (
                 dedup_p.cache_creation_tokens = dedup_s.cache_creation_tokens
                 OR (
                     dedup_s.cache_creation_tokens = 0
                     AND {ds_source} IN ('codex_session', 'gemini_session')
                 )
                 OR (
                     dedup_p.cache_creation_tokens = 0
                     AND {ds_source} = 'codex_session'
                 )
             )
             AND {model_match}
            WHERE {dp_source} = 'proxy'
              AND dedup_p.status_code >= 200
              AND dedup_p.status_code < 300
              AND dedup_p.created_at BETWEEN {lo} AND {hi}
        )"
    ))
}

/// 请求日志总数缓存：每次刷新都 `COUNT(*)` 一遍明细，大范围下最耗时。
/// 筛选条件、起点没变，且连接上没有任何写入（`total_changes` 没变，增删改都算）
/// 时复用上次的总数；结束时间往后推时（「当天」这类活动窗口每次刷新都会变），
/// 再确认新增的时间段里没有行。另设 [`LOG_COUNT_CACHE_TTL`] 兜底。
pub(crate) struct LogCountCache {
    key: String,
    end_date: Option<i64>,
    changes: u64,
    computed_at: std::time::Instant,
    total: u32,
}

const LOG_COUNT_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// 这条连接打开以来增删改过的总行数（SQLite 内置函数），任何写入都会让它变。
fn connection_total_changes(conn: &Connection) -> Result<u64, AppError> {
    Ok(conn.query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))? as u64)
}

fn log_count_cache_key(filters: &LogFilters) -> String {
    format!(
        "{:?}|{:?}|{:?}|{:?}|{:?}",
        filters.app_type,
        filters.provider_name,
        filters.model,
        filters.status_code,
        filters.start_date
    )
}

/// 能复用缓存时返回缓存的总数。
fn cached_log_count(
    cache: &Option<LogCountCache>,
    conn: &Connection,
    filters: &LogFilters,
) -> Result<Option<u32>, AppError> {
    let Some(entry) = cache.as_ref() else {
        return Ok(None);
    };
    if entry.key != log_count_cache_key(filters)
        || entry.changes != connection_total_changes(conn)?
        || entry.computed_at.elapsed() > LOG_COUNT_CACHE_TTL
    {
        return Ok(None);
    }
    match (entry.end_date, filters.end_date) {
        (cached, current) if cached == current => Ok(Some(entry.total)),
        (Some(cached), Some(current)) if current > cached => {
            // 结束时间往后推了：新增区间里没有任何行，总数就不变
            let has_new_rows: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM proxy_request_logs
                  WHERE created_at > ?1 AND created_at <= ?2)",
                params![cached, current],
                |row| row.get(0),
            )?;
            Ok((!has_new_rows).then_some(entry.total))
        }
        _ => Ok(None),
    }
}

/// 跨源去重指纹键。
///
/// `cache_creation_tokens`：Gemini 会话日志和旧版 Codex rollout 不暴露该字段，调用方传 0
/// 表示"未知"，匹配器会放行 proxy 侧任意 `cache_creation_tokens` 值。反过来，早期代理
/// 不记录 Codex 缓存写入，写入量为 0 的 Codex 代理行也放行任意 session 写入量。
#[derive(Debug, Clone, Copy)]
pub(crate) struct DedupKey<'a> {
    pub app_type: &'a str,
    /// 会话记录的实际来源；别名匹配只对 `app_type = codex` 且 `data_source = codex_session` 生效。
    pub data_source: &'a str,
    pub model: &'a str,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub created_at: i64,
}

/// session 日志写入前的统一去重判定。
///
/// 命中以下任一条件即跳过插入：
/// 1. `request_id` 已存在（主键碰撞，最常见的是 Claude 原生路径已经用了 `session:{msg_id}`）；
/// 2. 时间窗口内存在与 `key` 匹配的 proxy 日志（指纹去重，覆盖 Codex / Gemini /
///    Claude-through-OpenAI 这类 request_id 不共享的路径）。
pub(crate) fn should_skip_session_insert(
    conn: &Connection,
    request_id: &str,
    key: &DedupKey,
) -> Result<bool, AppError> {
    if proxy_request_id_exists(conn, request_id)? {
        return Ok(true);
    }
    has_matching_proxy_usage_log(conn, key)
}

fn proxy_request_id_exists(conn: &Connection, request_id: &str) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM proxy_request_logs WHERE request_id = ?1)",
        params![request_id],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| AppError::Database(format!("查询 request_id 失败: {e}")))
}

pub(crate) fn has_matching_proxy_usage_log(
    conn: &Connection,
    key: &DedupKey,
) -> Result<bool, AppError> {
    let allow_missing_cache_creation =
        matches!(key.app_type, "codex" | "gemini") && key.cache_creation_tokens == 0;
    // 早期代理不记录 Codex 缓存写入：写入量为 0 的 Codex 代理行放行任意 session 写入量
    let allow_legacy_proxy_cache_creation = key.app_type == "codex";

    let app_type_match = dedup_app_type_match_sql("l.app_type", "?1");
    let model_match =
        session_proxy_model_match_sql("l.model", "l.request_model", "?2", "?1", "?11");

    conn.query_row(
        &format!(
            "SELECT EXISTS (
            SELECT 1
            FROM proxy_request_logs l
            WHERE l.data_source = 'proxy'
              AND {app_type_match}
              AND l.status_code >= 200
              AND l.status_code < 300
              AND l.input_tokens = ?3
              AND l.output_tokens = ?4
              AND l.cache_read_tokens = ?5
              AND (
                  l.cache_creation_tokens = ?6
                  OR ?9 = 1
                  OR (
                      ?10 = 1
                      AND l.cache_creation_tokens = 0
                  )
              )
              AND l.created_at BETWEEN ?7 - ?8 AND ?7 + ?8
              AND {model_match}
        )"
        ),
        params![
            key.app_type,
            key.model,
            key.input_tokens as i64,
            key.output_tokens as i64,
            key.cache_read_tokens as i64,
            key.cache_creation_tokens as i64,
            key.created_at,
            SESSION_PROXY_DEDUP_WINDOW_SECONDS,
            allow_missing_cache_creation as i64,
            allow_legacy_proxy_cache_creation as i64,
            key.data_source,
        ],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| AppError::Database(format!("查询重复代理用量日志失败: {e}")))
}

/// Grok 会话事件是逐轮聚合值，无法和代理逐请求行按 token 指纹匹配。
/// 时间窗口内存在 Grok 代理记录即视为接管态，避免同一轮重复计费。
pub(crate) fn has_recent_grokbuild_proxy_activity(
    conn: &Connection,
    created_at: i64,
) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT EXISTS (
            SELECT 1 FROM proxy_request_logs
            WHERE data_source = 'proxy'
              AND app_type = 'grokbuild'
              AND created_at BETWEEN ?1 - ?2 AND ?1 + ?2
        )",
        params![created_at, SESSION_PROXY_DEDUP_WINDOW_SECONDS],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| AppError::Database(format!("查询 Grok 接管活动失败: {e}")))
}

pub(crate) fn has_suspected_codex_session_duplicate(
    conn: &Connection,
    request_id: &str,
    key: &DedupKey,
) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT EXISTS (
            SELECT 1
            FROM proxy_request_logs l
            WHERE l.app_type = 'codex'
              AND l.data_source = 'codex_session'
              AND l.request_id <> ?1
              AND LOWER(l.model) = LOWER(?2)
              AND l.input_tokens = ?3
              AND l.output_tokens = ?4
              AND l.cache_read_tokens = ?5
              AND l.created_at BETWEEN ?6 - ?7 AND ?6 + ?7
        )",
        params![
            request_id,
            key.model,
            key.input_tokens as i64,
            key.output_tokens as i64,
            key.cache_read_tokens as i64,
            key.created_at,
            SESSION_PROXY_DEDUP_WINDOW_SECONDS,
        ],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| AppError::Database(format!("查询疑似重复 Codex 会话用量失败: {e}")))
}

#[derive(Debug, Clone, Default)]
struct RollupDateBounds {
    start: Option<String>,
    end: Option<String>,
    is_empty: bool,
}

fn local_datetime_from_timestamp(ts: i64) -> Result<chrono::DateTime<Local>, AppError> {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .ok_or_else(|| AppError::Database(format!("无法解析本地时间戳: {ts}")))
}

fn compute_rollup_date_bounds(
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> Result<RollupDateBounds, AppError> {
    let start = match start_ts {
        Some(ts) => {
            let local = local_datetime_from_timestamp(ts)?;
            let day = local.date_naive();
            if local.time().num_seconds_from_midnight() == 0 {
                Some(day.format("%Y-%m-%d").to_string())
            } else {
                day.succ_opt()
                    .map(|next| next.format("%Y-%m-%d").to_string())
            }
        }
        None => None,
    };

    let end = match end_ts {
        Some(ts) => {
            let local = local_datetime_from_timestamp(ts)?;
            let day = local.date_naive();
            if local.time().hour() == 23 && local.time().minute() == 59 {
                Some(day.format("%Y-%m-%d").to_string())
            } else {
                day.pred_opt()
                    .map(|prev| prev.format("%Y-%m-%d").to_string())
            }
        }
        None => None,
    };

    let is_empty = matches!((&start, &end), (Some(start), Some(end)) if start > end);

    Ok(RollupDateBounds {
        start,
        end,
        is_empty,
    })
}

fn push_rollup_date_filters(
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
    column: &str,
    bounds: &RollupDateBounds,
) {
    if bounds.is_empty {
        conditions.push("1 = 0".to_string());
        return;
    }

    if let Some(start) = &bounds.start {
        conditions.push(format!("{column} >= ?"));
        params.push(Box::new(start.clone()));
    }

    if let Some(end) = &bounds.end {
        conditions.push(format!("{column} <= ?"));
        params.push(Box::new(end.clone()));
    }
}

fn local_day_start_rfc3339(day: NaiveDate) -> String {
    let local_midnight = day
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| match Local.from_local_datetime(&naive) {
            chrono::LocalResult::Single(dt) => Some(dt),
            chrono::LocalResult::Ambiguous(earliest, _) => Some(earliest),
            chrono::LocalResult::None => None,
        })
        .unwrap_or_else(Local::now);

    local_midnight.to_rfc3339()
}

impl Database {
    /// 获取使用量汇总
    pub fn get_usage_summary(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        app_type: Option<&str>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<UsageSummary, AppError> {
        let conn = lock_conn!(self.conn);

        // Build detail WHERE clause
        let mut conditions = vec![effective_usage_log_filter_for_range(
            &conn, "l", start_date, end_date,
        )?];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(start) = start_date {
            conditions.push("l.created_at >= ?".to_string());
            params_vec.push(Box::new(start));
        }
        if let Some(end) = end_date {
            conditions.push("l.created_at <= ?".to_string());
            params_vec.push(Box::new(end));
        }
        if let Some(at) = app_type {
            conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            params_vec.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut conditions,
            &mut params_vec,
            "l",
            "p",
            provider_name,
            model,
        );

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let detail_join = if provider_name.is_some() {
            providers_join("l", "p")
        } else {
            String::new()
        };

        // Only include rolled-up rows for full local days that are fully covered by the range.
        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;

        push_rollup_date_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r.date",
            &rollup_bounds,
        );
        if let Some(at) = app_type {
            rollup_conditions.push(format!("{} = ?", folded_app_type_sql("r.app_type")));
            rollup_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );

        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };
        let rollup_join = if provider_name.is_some() {
            providers_join("r", "p2")
        } else {
            String::new()
        };

        let fresh_input_detail = fresh_input_sql("l");
        let fresh_input_rollup = fresh_input_sql("r");
        let sql = format!(
            "SELECT
                COALESCE(d.total_requests, 0) + COALESCE(r.total_requests, 0),
                COALESCE(d.total_cost, 0) + COALESCE(r.total_cost, 0),
                COALESCE(d.total_input_tokens, 0) + COALESCE(r.total_input_tokens, 0),
                COALESCE(d.total_output_tokens, 0) + COALESCE(r.total_output_tokens, 0),
                COALESCE(d.total_cache_creation_tokens, 0) + COALESCE(r.total_cache_creation_tokens, 0),
                COALESCE(d.total_cache_read_tokens, 0) + COALESCE(r.total_cache_read_tokens, 0),
                COALESCE(d.success_count, 0) + COALESCE(r.success_count, 0)
            FROM
                (SELECT
                    COUNT(*) as total_requests,
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as total_cost,
                    COALESCE(SUM({fresh_input_detail}), 0) as total_input_tokens,
                    COALESCE(SUM(l.output_tokens), 0) as total_output_tokens,
                    COALESCE(SUM(l.cache_creation_tokens), 0) as total_cache_creation_tokens,
                    COALESCE(SUM(l.cache_read_tokens), 0) as total_cache_read_tokens,
                    COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0) as success_count
                 FROM proxy_request_logs l {detail_join} {where_clause}) d,
                (SELECT
                    COALESCE(SUM(r.request_count), 0) as total_requests,
                    COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0) as total_cost,
                    COALESCE(SUM({fresh_input_rollup}), 0) as total_input_tokens,
                    COALESCE(SUM(r.output_tokens), 0) as total_output_tokens,
                    COALESCE(SUM(r.cache_creation_tokens), 0) as total_cache_creation_tokens,
                    COALESCE(SUM(r.cache_read_tokens), 0) as total_cache_read_tokens,
                    COALESCE(SUM(r.success_count), 0) as success_count
                 FROM usage_daily_rollups r {rollup_join} {rollup_where}) r"
        );

        // Combine params: detail params first, then rollup params
        let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = params_vec;
        all_params.extend(rollup_params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

        let result = conn.query_row(&sql, param_refs.as_slice(), usage_summary_from_row)?;

        Ok(result)
    }

    /// 单个会话的用量汇总（会话阅读页头部）：总 Token 和花费的口径同 Dashboard。
    ///
    /// 只数会话日志导入的行：它们带客户端自己的会话 ID，经不经过路由都会导入；
    /// 代理行的会话 ID 是代理侧推断的，未必对得上，两边都数还会重复。
    /// 明细 30 天后汇总进按天表并删除（按天表没有会话维度），更早的会话查不到。
    pub fn get_session_usage_summary(
        &self,
        app_type: &str,
        session_id: &str,
    ) -> Result<UsageSummary, AppError> {
        let conn = lock_conn!(self.conn);
        let fresh_input = fresh_input_sql("l");
        let app_type_expr = folded_app_type_sql("l.app_type");
        let data_source = data_source_expr("l");
        let sql = format!(
            "SELECT
                COUNT(*),
                COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0),
                COALESCE(SUM({fresh_input}), 0),
                COALESCE(SUM(l.output_tokens), 0),
                COALESCE(SUM(l.cache_creation_tokens), 0),
                COALESCE(SUM(l.cache_read_tokens), 0),
                COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0)
             FROM proxy_request_logs l
             WHERE l.session_id = ?1 AND {app_type_expr} = ?2 AND {data_source} <> 'proxy'"
        );

        let result = conn.query_row(
            &sql,
            rusqlite::params![session_id, app_type],
            usage_summary_from_row,
        )?;

        Ok(result)
    }

    /// 按 app_type 维度拆分的使用量汇总，用于 Dashboard 的分应用展示条。
    /// 返回所有有数据的 app_type，按 real_total_tokens 降序。
    ///
    /// Single SQL with `GROUP BY app_type` — avoids the N+1 round-trip that
    /// would result from invoking `get_usage_summary` once per app_type.
    pub fn get_usage_summary_by_app(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<Vec<UsageSummaryByApp>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter_for_range(
            &conn, "l", start_date, end_date,
        )?];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(start) = start_date {
            detail_conditions.push("l.created_at >= ?".to_string());
            detail_params.push(Box::new(start));
        }
        if let Some(end) = end_date {
            detail_conditions.push("l.created_at <= ?".to_string());
            detail_params.push(Box::new(end));
        }
        push_provider_model_filters(
            &mut detail_conditions,
            &mut detail_params,
            "l",
            "p",
            provider_name,
            model,
        );
        let detail_where = format!("WHERE {}", detail_conditions.join(" AND "));
        let detail_join = if provider_name.is_some() {
            providers_join("l", "p")
        } else {
            String::new()
        };

        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;
        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_rollup_date_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r.date",
            &rollup_bounds,
        );
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };
        let rollup_join = if provider_name.is_some() {
            providers_join("r", "p2")
        } else {
            String::new()
        };

        let fresh_input_detail = fresh_input_sql("l");
        let fresh_input_rollup = fresh_input_sql("r");
        // 折叠 claude-desktop → claude：内层投影成同一桶名，外层 GROUP BY 自然合并。
        let detail_app_type = folded_app_type_sql("l.app_type");
        let rollup_app_type = folded_app_type_sql("r.app_type");

        let sql = format!(
            "SELECT app_type,
                SUM(req_count) as req_count,
                SUM(cost) as cost,
                SUM(input_t) as input_t,
                SUM(output_t) as output_t,
                SUM(cache_create_t) as cache_create_t,
                SUM(cache_read_t) as cache_read_t,
                SUM(success_count) as success_count
            FROM (
                SELECT {detail_app_type} as app_type,
                    COUNT(*) as req_count,
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as cost,
                    COALESCE(SUM({fresh_input_detail}), 0) as input_t,
                    COALESCE(SUM(l.output_tokens), 0) as output_t,
                    COALESCE(SUM(l.cache_creation_tokens), 0) as cache_create_t,
                    COALESCE(SUM(l.cache_read_tokens), 0) as cache_read_t,
                    COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0) as success_count
                FROM proxy_request_logs l {detail_join} {detail_where}
                GROUP BY l.app_type
                UNION ALL
                SELECT {rollup_app_type} as app_type,
                    COALESCE(SUM(r.request_count), 0),
                    COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0),
                    COALESCE(SUM({fresh_input_rollup}), 0),
                    COALESCE(SUM(r.output_tokens), 0),
                    COALESCE(SUM(r.cache_creation_tokens), 0),
                    COALESCE(SUM(r.cache_read_tokens), 0),
                    COALESCE(SUM(r.success_count), 0)
                FROM usage_daily_rollups r {rollup_join} {rollup_where}
                GROUP BY r.app_type
            )
            GROUP BY app_type"
        );

        let mut combined: Vec<Box<dyn rusqlite::ToSql>> = detail_params;
        combined.extend(rollup_params);
        let refs: Vec<&dyn rusqlite::ToSql> = combined.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(refs.as_slice(), |row| {
            let app_type: String = row.get(0)?;
            let total_requests: i64 = row.get(1)?;
            let total_cost: f64 = row.get(2)?;
            let total_input_tokens: i64 = row.get(3)?;
            let total_output_tokens: i64 = row.get(4)?;
            let total_cache_creation_tokens: i64 = row.get(5)?;
            let total_cache_read_tokens: i64 = row.get(6)?;
            let success_count: i64 = row.get(7)?;

            let success_rate = if total_requests > 0 {
                (success_count as f32 / total_requests as f32) * 100.0
            } else {
                0.0
            };
            let (real_total_tokens, cache_hit_rate) = derive_real_total_and_hit_rate(
                total_input_tokens as u64,
                total_output_tokens as u64,
                total_cache_creation_tokens as u64,
                total_cache_read_tokens as u64,
            );

            Ok(UsageSummaryByApp {
                app_type,
                summary: UsageSummary {
                    total_requests: total_requests as u64,
                    total_cost: format!("{total_cost:.6}"),
                    total_input_tokens: total_input_tokens as u64,
                    total_output_tokens: total_output_tokens as u64,
                    total_cache_creation_tokens: total_cache_creation_tokens as u64,
                    total_cache_read_tokens: total_cache_read_tokens as u64,
                    success_rate,
                    real_total_tokens,
                    cache_hit_rate,
                },
            })
        })?;

        let mut summaries = Vec::new();
        for row in rows {
            let item = row?;
            if item.summary.total_requests == 0 && item.summary.real_total_tokens == 0 {
                continue;
            }
            summaries.push(item);
        }
        summaries.sort_by(|a, b| {
            b.summary
                .real_total_tokens
                .cmp(&a.summary.real_total_tokens)
        });
        Ok(summaries)
    }

    /// 获取每日趋势（滑动窗口，<=24h 按小时，>24h 按天，窗口与汇总一致）
    pub fn get_daily_trends(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        app_type: Option<&str>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<Vec<DailyStats>, AppError> {
        let conn = lock_conn!(self.conn);

        let end_ts = end_date.unwrap_or_else(|| Local::now().timestamp());
        let mut start_ts = start_date.unwrap_or_else(|| end_ts - 24 * 60 * 60);

        if start_ts >= end_ts {
            start_ts = end_ts - 24 * 60 * 60;
        }

        let duration = end_ts - start_ts;
        if duration <= 24 * 60 * 60 {
            let bucket_seconds: i64 = 60 * 60;
            let mut bucket_count: i64 = if duration <= 0 {
                1
            } else {
                (duration + bucket_seconds - 1) / bucket_seconds
            };

            if bucket_count < 1 {
                bucket_count = 1;
            }

            let mut extra_conditions: Vec<String> = Vec::new();
            let mut extra_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            if let Some(at) = app_type {
                extra_conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
                extra_params.push(Box::new(at.to_string()));
            }
            push_provider_model_filters(
                &mut extra_conditions,
                &mut extra_params,
                "l",
                "p",
                provider_name,
                model,
            );
            let extra_filter = extra_conditions
                .iter()
                .map(|c| format!("AND {c}"))
                .collect::<Vec<_>>()
                .join(" ");
            let detail_join = if provider_name.is_some() {
                providers_join("l", "p")
            } else {
                String::new()
            };

            let effective_filter =
                effective_usage_log_filter_for_range(&conn, "l", Some(start_ts), Some(end_ts))?;
            let fresh_input = fresh_input_sql("l");
            let sql = format!(
                "SELECT
                    CAST((l.created_at - ?1) / ?3 AS INTEGER) as bucket_idx,
                    COUNT(*) as request_count,
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as total_cost,
                    COALESCE(SUM({fresh_input} + l.output_tokens), 0) as total_tokens,
                    COALESCE(SUM({fresh_input}), 0) as total_input_tokens,
                    COALESCE(SUM(l.output_tokens), 0) as total_output_tokens,
                    COALESCE(SUM(l.cache_creation_tokens), 0) as total_cache_creation_tokens,
                    COALESCE(SUM(l.cache_read_tokens), 0) as total_cache_read_tokens
                FROM proxy_request_logs l {detail_join}
                WHERE l.created_at >= ?1 AND l.created_at <= ?2
                  AND {effective_filter} {extra_filter}
                GROUP BY bucket_idx
                ORDER BY bucket_idx ASC"
            );

            let mut stmt = conn.prepare(&sql)?;
            let row_mapper = |row: &rusqlite::Row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    DailyStats {
                        date: String::new(),
                        request_count: row.get::<_, i64>(1)? as u64,
                        total_cost: format!("{:.6}", row.get::<_, f64>(2)?),
                        total_tokens: row.get::<_, i64>(3)? as u64,
                        total_input_tokens: row.get::<_, i64>(4)? as u64,
                        total_output_tokens: row.get::<_, i64>(5)? as u64,
                        total_cache_creation_tokens: row.get::<_, i64>(6)? as u64,
                        total_cache_read_tokens: row.get::<_, i64>(7)? as u64,
                    },
                ))
            };

            let mut map: HashMap<i64, DailyStats> = HashMap::new();

            let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = vec![
                Box::new(start_ts),
                Box::new(end_ts),
                Box::new(bucket_seconds),
            ];
            all_params.extend(extra_params);
            let param_refs: Vec<&dyn rusqlite::ToSql> =
                all_params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt.query_map(param_refs.as_slice(), row_mapper)?;
            for row in rows {
                let (mut bucket_idx, stat) = row?;
                if bucket_idx < 0 {
                    continue;
                }
                if bucket_idx >= bucket_count {
                    bucket_idx = bucket_count - 1;
                }
                map.insert(bucket_idx, stat);
            }

            let mut stats = Vec::with_capacity(bucket_count as usize);
            for i in 0..bucket_count {
                let bucket_start_ts = start_ts + i * bucket_seconds;
                let bucket_start = local_datetime_from_timestamp(bucket_start_ts)?;
                let date = bucket_start.to_rfc3339();

                if let Some(mut stat) = map.remove(&i) {
                    stat.date = date;
                    stats.push(stat);
                } else {
                    stats.push(DailyStats {
                        date,
                        request_count: 0,
                        total_cost: "0.000000".to_string(),
                        total_tokens: 0,
                        total_input_tokens: 0,
                        total_output_tokens: 0,
                        total_cache_creation_tokens: 0,
                        total_cache_read_tokens: 0,
                    });
                }
            }

            return Ok(stats);
        }

        let start_day = local_datetime_from_timestamp(start_ts)?.date_naive();
        let end_day = local_datetime_from_timestamp(end_ts)?.date_naive();
        let bucket_count = (end_day.signed_duration_since(start_day).num_days() + 1) as usize;

        let mut extra_conditions: Vec<String> = Vec::new();
        let mut extra_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(at) = app_type {
            extra_conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            extra_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut extra_conditions,
            &mut extra_params,
            "l",
            "p",
            provider_name,
            model,
        );
        let extra_filter = extra_conditions
            .iter()
            .map(|c| format!("AND {c}"))
            .collect::<Vec<_>>()
            .join(" ");
        let detail_join = if provider_name.is_some() {
            providers_join("l", "p")
        } else {
            String::new()
        };

        let effective_filter =
            effective_usage_log_filter_for_range(&conn, "l", Some(start_ts), Some(end_ts))?;
        let fresh_input = fresh_input_sql("l");
        let detail_sql = format!(
            "SELECT
                date(l.created_at, 'unixepoch', 'localtime') as bucket_date,
                COUNT(*) as request_count,
                COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as total_cost,
                COALESCE(SUM({fresh_input} + l.output_tokens), 0) as total_tokens,
                COALESCE(SUM({fresh_input}), 0) as total_input_tokens,
                COALESCE(SUM(l.output_tokens), 0) as total_output_tokens,
                COALESCE(SUM(l.cache_creation_tokens), 0) as total_cache_creation_tokens,
                COALESCE(SUM(l.cache_read_tokens), 0) as total_cache_read_tokens
            FROM proxy_request_logs l {detail_join}
            WHERE l.created_at >= ?1 AND l.created_at <= ?2
              AND {effective_filter} {extra_filter}
            GROUP BY bucket_date
            ORDER BY bucket_date ASC"
        );

        let mut detail_stmt = conn.prepare(&detail_sql)?;
        let detail_row_mapper = |row: &rusqlite::Row| {
            Ok((
                row.get::<_, String>(0)?,
                DailyStats {
                    date: String::new(),
                    request_count: row.get::<_, i64>(1)? as u64,
                    total_cost: format!("{:.6}", row.get::<_, f64>(2)?),
                    total_tokens: row.get::<_, i64>(3)? as u64,
                    total_input_tokens: row.get::<_, i64>(4)? as u64,
                    total_output_tokens: row.get::<_, i64>(5)? as u64,
                    total_cache_creation_tokens: row.get::<_, i64>(6)? as u64,
                    total_cache_read_tokens: row.get::<_, i64>(7)? as u64,
                },
            ))
        };

        let mut map: HashMap<NaiveDate, DailyStats> = HashMap::new();
        let mut detail_all_params: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(start_ts), Box::new(end_ts)];
        detail_all_params.extend(extra_params);
        let detail_param_refs: Vec<&dyn rusqlite::ToSql> =
            detail_all_params.iter().map(|p| p.as_ref()).collect();
        let detail_rows = detail_stmt.query_map(detail_param_refs.as_slice(), detail_row_mapper)?;

        for row in detail_rows {
            let (bucket_date, stat) = row?;
            let date = NaiveDate::parse_from_str(&bucket_date, "%Y-%m-%d")
                .map_err(|err| AppError::Database(format!("解析趋势日期失败: {err}")))?;
            map.insert(date, stat);
        }

        let rollup_bounds = compute_rollup_date_bounds(Some(start_ts), Some(end_ts))?;
        let mut rollup_conditions = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_rollup_date_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r.date",
            &rollup_bounds,
        );
        if let Some(at) = app_type {
            rollup_conditions.push(format!("{} = ?", folded_app_type_sql("r.app_type")));
            rollup_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );

        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };
        let rollup_join = if provider_name.is_some() {
            providers_join("r", "p2")
        } else {
            String::new()
        };

        let fresh_input_rollup = fresh_input_sql("r");
        let rollup_sql = format!(
            "SELECT
                r.date,
                COALESCE(SUM(r.request_count), 0),
                COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0),
                COALESCE(SUM({fresh_input_rollup} + r.output_tokens), 0),
                COALESCE(SUM({fresh_input_rollup}), 0),
                COALESCE(SUM(r.output_tokens), 0),
                COALESCE(SUM(r.cache_creation_tokens), 0),
                COALESCE(SUM(r.cache_read_tokens), 0)
            FROM usage_daily_rollups r {rollup_join}
            {rollup_where}
            GROUP BY r.date
            ORDER BY r.date ASC"
        );

        let mut rollup_stmt = conn.prepare(&rollup_sql)?;
        let rollup_row_mapper = |row: &rusqlite::Row| {
            Ok((
                row.get::<_, String>(0)?,
                (
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, f64>(2)?,
                    row.get::<_, i64>(3)? as u64,
                    row.get::<_, i64>(4)? as u64,
                    row.get::<_, i64>(5)? as u64,
                    row.get::<_, i64>(6)? as u64,
                    row.get::<_, i64>(7)? as u64,
                ),
            ))
        };
        let rollup_param_refs: Vec<&dyn rusqlite::ToSql> =
            rollup_params.iter().map(|param| param.as_ref()).collect();
        let rollup_rows = rollup_stmt.query_map(rollup_param_refs.as_slice(), rollup_row_mapper)?;

        for row in rollup_rows {
            let (bucket_date, (req, cost, tok, inp, out, cc, cr)) = row?;
            let date = NaiveDate::parse_from_str(&bucket_date, "%Y-%m-%d")
                .map_err(|err| AppError::Database(format!("解析 rollup 趋势日期失败: {err}")))?;
            let entry = map.entry(date).or_insert_with(|| DailyStats {
                date: String::new(),
                request_count: 0,
                total_cost: "0.000000".to_string(),
                total_tokens: 0,
                total_input_tokens: 0,
                total_output_tokens: 0,
                total_cache_creation_tokens: 0,
                total_cache_read_tokens: 0,
            });
            entry.request_count += req;
            let existing_cost: f64 = entry.total_cost.parse().unwrap_or(0.0);
            entry.total_cost = format!("{:.6}", existing_cost + cost);
            entry.total_tokens += tok;
            entry.total_input_tokens += inp;
            entry.total_output_tokens += out;
            entry.total_cache_creation_tokens += cc;
            entry.total_cache_read_tokens += cr;
        }

        let mut stats = Vec::with_capacity(bucket_count);
        let mut current_day = start_day;
        for _ in 0..bucket_count {
            let date = local_day_start_rfc3339(current_day);

            if let Some(mut stat) = map.remove(&current_day) {
                stat.date = date;
                stats.push(stat);
            } else {
                stats.push(DailyStats {
                    date,
                    request_count: 0,
                    total_cost: "0.000000".to_string(),
                    total_tokens: 0,
                    total_input_tokens: 0,
                    total_output_tokens: 0,
                    total_cache_creation_tokens: 0,
                    total_cache_read_tokens: 0,
                });
            }

            current_day = current_day.succ_opt().unwrap_or(current_day);
        }

        Ok(stats)
    }

    /// 最早有用量记录的那一天（本地日期 `YYYY-MM-DD`），明细和日聚合一起看；没有记录时为 `None`。
    ///
    /// 给「全部」的按年热力图定起始年份用，所以不套跨源去重：被去重掉的会话行
    /// 和对应的代理行只差几分钟，不会改变最早的日期。
    pub fn get_first_usage_date(
        &self,
        app_type: Option<&str>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = Vec::new();
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(at) = app_type {
            detail_conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            detail_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut detail_conditions,
            &mut detail_params,
            "l",
            "p",
            provider_name,
            model,
        );
        let detail_where = if detail_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", detail_conditions.join(" AND "))
        };
        let detail_join = if provider_name.is_some() {
            providers_join("l", "p")
        } else {
            String::new()
        };
        let detail_param_refs: Vec<&dyn rusqlite::ToSql> =
            detail_params.iter().map(|p| p.as_ref()).collect();
        let first_detail_ts: Option<i64> = conn.query_row(
            &format!(
                "SELECT MIN(l.created_at) FROM proxy_request_logs l {detail_join} {detail_where}"
            ),
            detail_param_refs.as_slice(),
            |row| row.get(0),
        )?;
        let first_detail = first_detail_ts
            .map(|ts| local_datetime_from_timestamp(ts).map(|dt| dt.date_naive()))
            .transpose()?;

        let mut rollup_conditions = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(at) = app_type {
            rollup_conditions.push(format!("{} = ?", folded_app_type_sql("r.app_type")));
            rollup_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };
        let rollup_join = if provider_name.is_some() {
            providers_join("r", "p2")
        } else {
            String::new()
        };
        let rollup_param_refs: Vec<&dyn rusqlite::ToSql> =
            rollup_params.iter().map(|p| p.as_ref()).collect();
        let first_rollup_raw: Option<String> = conn.query_row(
            &format!("SELECT MIN(r.date) FROM usage_daily_rollups r {rollup_join} {rollup_where}"),
            rollup_param_refs.as_slice(),
            |row| row.get(0),
        )?;
        let first_rollup = first_rollup_raw
            .map(|raw| {
                NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
                    .map_err(|err| AppError::Database(format!("解析 rollup 日期失败: {err}")))
            })
            .transpose()?;

        let first = match (first_detail, first_rollup) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        Ok(first.map(|day| day.format("%Y-%m-%d").to_string()))
    }

    /// 获取 Provider 统计
    pub fn get_provider_stats(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        app_type: Option<&str>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<Vec<ProviderStats>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter_for_range(
            &conn, "l", start_date, end_date,
        )?];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(start) = start_date {
            detail_conditions.push("l.created_at >= ?".to_string());
            detail_params.push(Box::new(start));
        }
        if let Some(end) = end_date {
            detail_conditions.push("l.created_at <= ?".to_string());
            detail_params.push(Box::new(end));
        }
        if let Some(at) = app_type {
            detail_conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            detail_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut detail_conditions,
            &mut detail_params,
            "l",
            "p",
            provider_name,
            model,
        );
        let detail_where = if detail_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", detail_conditions.join(" AND "))
        };

        let mut rollup_conditions = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;
        push_rollup_date_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r.date",
            &rollup_bounds,
        );
        if let Some(at) = app_type {
            rollup_conditions.push(format!("{} = ?", folded_app_type_sql("r.app_type")));
            rollup_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };

        // UNION detail logs + rollup data, then aggregate
        let detail_pname = provider_name_coalesce("l", "p");
        let rollup_pname = provider_name_coalesce("r", "p2");
        let real_total_detail = real_total_tokens_sql("l");
        let real_total_rollup = real_total_tokens_sql("r");
        let speed_ok = speed_eligible_sql("l");
        let est_ok = speed_estimate_eligible_sql("l");
        let sql = format!(
            "SELECT
                provider_id, app_type, provider_name,
                SUM(request_count) as request_count,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost) as total_cost,
                SUM(success_count) as success_count,
                CASE WHEN SUM(request_count) > 0
                    THEN SUM(latency_sum) / SUM(request_count)
                    ELSE 0 END as avg_latency,
                SUM(speed_output) as speed_output,
                SUM(speed_gen_ms) as speed_gen_ms,
                SUM(est_output) as est_output,
                SUM(est_ms) as est_ms
            FROM (
                SELECT l.provider_id, l.app_type,
                    {detail_pname} as provider_name,
                    COUNT(*) as request_count,
                    COALESCE(SUM({real_total_detail}), 0) as total_tokens,
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as total_cost,
                    COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0) as success_count,
                    COALESCE(SUM(l.latency_ms), 0) as latency_sum,
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.output_tokens ELSE 0 END), 0) as speed_output,
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.latency_ms - l.first_token_ms ELSE 0 END), 0) as speed_gen_ms,
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.output_tokens ELSE 0 END), 0) as est_output,
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.latency_ms ELSE 0 END), 0) as est_ms
                FROM proxy_request_logs l
                LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
                {detail_where}
                GROUP BY l.provider_id, l.app_type
                UNION ALL
                SELECT r.provider_id, r.app_type,
                    {rollup_pname} as provider_name,
                    COALESCE(SUM(r.request_count), 0),
                    COALESCE(SUM({real_total_rollup}), 0),
                    COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0),
                    COALESCE(SUM(r.success_count), 0),
                    COALESCE(SUM(r.avg_latency_ms * r.request_count), 0),
                    0,
                    0,
                    0,
                    0
                FROM usage_daily_rollups r
                LEFT JOIN providers p2 ON r.provider_id = p2.id AND r.app_type = p2.app_type
                {rollup_where}
                GROUP BY r.provider_id, r.app_type
            )
            GROUP BY provider_id, app_type
            ORDER BY provider_name COLLATE NOCASE ASC, provider_id ASC"
        );

        // 分组键用不会出现在 ID 里的 0x1F 拼接，和下面主查询的 (provider_id, app_type) 对上
        let (first_token_ms, est_first_token_ms) = {
            let detail_refs: Vec<&dyn rusqlite::ToSql> =
                detail_params.iter().map(|p| p.as_ref()).collect();
            let medians = |eligible_sql: String| {
                first_token_medians(
                    &conn,
                    "l.provider_id || char(31) || l.app_type",
                    "FROM proxy_request_logs l
                     LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type",
                    &detail_where,
                    &eligible_sql,
                    &detail_refs,
                )
            };
            (
                medians(first_token_eligible_sql("l"))?,
                medians(est_first_token_eligible_sql("l"))?,
            )
        };

        let mut stmt = conn.prepare(&sql)?;
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = detail_params;
        params.extend(rollup_params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let row_mapper = |row: &rusqlite::Row| {
            let request_count: i64 = row.get(3)?;
            let provider_id: String = row.get(0)?;
            let app_type: String = row.get(1)?;
            let key = format!("{provider_id}\u{1f}{app_type}");
            let first_token_median_ms = first_token_ms.get(&key).copied();
            let est_first_token_median_ms = est_first_token_ms.get(&key).copied();
            let success_count: i64 = row.get(6)?;
            let success_rate = if request_count > 0 {
                (success_count as f32 / request_count as f32) * 100.0
            } else {
                0.0
            };

            Ok(ProviderStats {
                provider_id,
                app_type,
                provider_name: row.get(2)?,
                request_count: request_count as u64,
                total_tokens: row.get::<_, i64>(4)? as u64,
                total_cost: format!("{:.6}", row.get::<_, f64>(5)?),
                success_rate,
                avg_latency_ms: row.get::<_, f64>(7)? as u64,
                speed_output_tokens: row.get::<_, i64>(8)?.max(0) as u64,
                speed_generation_ms: row.get::<_, i64>(9)?.max(0) as u64,
                est_speed_output_tokens: row.get::<_, i64>(10)?.max(0) as u64,
                est_speed_duration_ms: row.get::<_, i64>(11)?.max(0) as u64,
                first_token_median_ms,
                est_first_token_median_ms,
            })
        };

        let rows = stmt.query_map(param_refs.as_slice(), row_mapper)?;

        let mut stats = Vec::new();
        for row in rows {
            stats.push(row?);
        }

        Ok(stats)
    }

    /// 获取模型统计
    pub fn get_model_stats(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        app_type: Option<&str>,
        provider_name: Option<&str>,
        model: Option<&str>,
    ) -> Result<Vec<ModelStats>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter_for_range(
            &conn, "l", start_date, end_date,
        )?];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(start) = start_date {
            detail_conditions.push("l.created_at >= ?".to_string());
            detail_params.push(Box::new(start));
        }
        if let Some(end) = end_date {
            detail_conditions.push("l.created_at <= ?".to_string());
            detail_params.push(Box::new(end));
        }
        if let Some(at) = app_type {
            detail_conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            detail_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut detail_conditions,
            &mut detail_params,
            "l",
            "p",
            provider_name,
            model,
        );
        let detail_where = if detail_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", detail_conditions.join(" AND "))
        };
        let detail_join = if provider_name.is_some() {
            providers_join("l", "p")
        } else {
            String::new()
        };

        let mut rollup_conditions = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;
        push_rollup_date_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r.date",
            &rollup_bounds,
        );
        if let Some(at) = app_type {
            rollup_conditions.push(format!("{} = ?", folded_app_type_sql("r.app_type")));
            rollup_params.push(Box::new(at.to_string()));
        }
        push_provider_model_filters(
            &mut rollup_conditions,
            &mut rollup_params,
            "r",
            "p2",
            provider_name,
            model,
        );
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };
        let rollup_join = if provider_name.is_some() {
            providers_join("r", "p2")
        } else {
            String::new()
        };

        // UNION detail logs + rollup data，分组键用「有效计价模型」（见 effective_model_sql）
        let real_total_detail = real_total_tokens_sql("l");
        let real_total_rollup = real_total_tokens_sql("r");
        let detail_model = effective_model_sql("l");
        let rollup_model = effective_model_sql("r");
        let speed_ok = speed_eligible_sql("l");
        let est_ok = speed_estimate_eligible_sql("l");
        let sql = format!(
            "SELECT
                model,
                SUM(request_count) as request_count,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost) as total_cost,
                SUM(success_count) as success_count,
                SUM(speed_output) as speed_output,
                SUM(speed_gen_ms) as speed_gen_ms,
                SUM(est_output) as est_output,
                SUM(est_ms) as est_ms
            FROM (
                SELECT {detail_model} as model,
                    COUNT(*) as request_count,
                    COALESCE(SUM({real_total_detail}), 0) as total_tokens,
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as total_cost,
                    COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0) as success_count,
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.output_tokens ELSE 0 END), 0) as speed_output,
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.latency_ms - l.first_token_ms ELSE 0 END), 0) as speed_gen_ms,
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.output_tokens ELSE 0 END), 0) as est_output,
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.latency_ms ELSE 0 END), 0) as est_ms
                FROM proxy_request_logs l
                {detail_join}
                {detail_where}
                GROUP BY {detail_model}
                UNION ALL
                SELECT {rollup_model},
                    COALESCE(SUM(r.request_count), 0),
                    COALESCE(SUM({real_total_rollup}), 0),
                    COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0),
                    COALESCE(SUM(r.success_count), 0),
                    0,
                    0,
                    0,
                    0
                FROM usage_daily_rollups r
                {rollup_join}
                {rollup_where}
                GROUP BY {rollup_model}
            )
            GROUP BY model
            ORDER BY total_cost DESC"
        );

        let (first_token_ms, est_first_token_ms) = {
            let detail_refs: Vec<&dyn rusqlite::ToSql> =
                detail_params.iter().map(|p| p.as_ref()).collect();
            let from_sql = format!("FROM proxy_request_logs l {detail_join}");
            let medians = |eligible_sql: String| {
                first_token_medians(
                    &conn,
                    &detail_model,
                    &from_sql,
                    &detail_where,
                    &eligible_sql,
                    &detail_refs,
                )
            };
            (
                medians(first_token_eligible_sql("l"))?,
                medians(est_first_token_eligible_sql("l"))?,
            )
        };

        let mut stmt = conn.prepare(&sql)?;
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = detail_params;
        params.extend(rollup_params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let row_mapper = |row: &rusqlite::Row| {
            let request_count: i64 = row.get(1)?;
            let model: String = row.get(0)?;
            let first_token_median_ms = first_token_ms.get(&model).copied();
            let est_first_token_median_ms = est_first_token_ms.get(&model).copied();
            let total_cost: f64 = row.get(3)?;
            let avg_cost = if request_count > 0 {
                total_cost / request_count as f64
            } else {
                0.0
            };
            let success_count: i64 = row.get(4)?;
            let success_rate = if request_count > 0 {
                (success_count as f32 / request_count as f32) * 100.0
            } else {
                0.0
            };

            Ok(ModelStats {
                model,
                request_count: request_count as u64,
                total_tokens: row.get::<_, i64>(2)? as u64,
                total_cost: format!("{total_cost:.6}"),
                avg_cost_per_request: format!("{avg_cost:.6}"),
                success_rate,
                speed_output_tokens: row.get::<_, i64>(5)?.max(0) as u64,
                speed_generation_ms: row.get::<_, i64>(6)?.max(0) as u64,
                est_speed_output_tokens: row.get::<_, i64>(7)?.max(0) as u64,
                est_speed_duration_ms: row.get::<_, i64>(8)?.max(0) as u64,
                first_token_median_ms,
                est_first_token_median_ms,
            })
        };

        let rows = stmt.query_map(param_refs.as_slice(), row_mapper)?;

        let mut stats = Vec::new();
        for row in rows {
            stats.push(row?);
        }

        Ok(stats)
    }

    /// 获取请求日志列表（分页）
    pub fn get_request_logs(
        &self,
        filters: &LogFilters,
        page: u32,
        page_size: u32,
    ) -> Result<PaginatedLogs, AppError> {
        let conn = lock_conn!(self.conn);

        let mut conditions = vec![effective_usage_log_filter_for_range(
            &conn,
            "l",
            filters.start_date,
            filters.end_date,
        )?];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref app_type) = filters.app_type {
            // 仅过滤口径折叠 claude-desktop→claude；行投影仍返回原始 app_type，
            // 详情面板据此展示真实入口（路由接管账单审计需要）。
            conditions.push(format!("{} = ?", folded_app_type_sql("l.app_type")));
            params.push(Box::new(app_type.clone()));
        }
        // 与 Dashboard 顶部下拉筛选同口径：Provider 按展示名精确匹配（会话占位
        // 行如 "Claude (Session)" 也能命中），模型按有效计价模型匹配。
        push_provider_model_filters(
            &mut conditions,
            &mut params,
            "l",
            "p",
            filters.provider_name.as_deref(),
            filters.model.as_deref(),
        );
        if let Some(status) = filters.status_code {
            conditions.push("l.status_code = ?".to_string());
            params.push(Box::new(status as i64));
        }
        if let Some(start) = filters.start_date {
            conditions.push("l.created_at >= ?".to_string());
            params.push(Box::new(start));
        }
        if let Some(end) = filters.end_date {
            conditions.push("l.created_at <= ?".to_string());
            params.push(Box::new(end));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // 获取总数
        let count_sql = format!(
            "SELECT COUNT(*) FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}"
        );
        let mut count_cache = lock_conn!(self.log_count_cache);
        let total: u32 = match cached_log_count(&count_cache, &conn, filters)? {
            Some(total) => total,
            None => {
                let count_params: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                let total = conn.query_row(&count_sql, count_params.as_slice(), |row| {
                    row.get::<_, i64>(0).map(|v| v as u32)
                })?;
                *count_cache = Some(LogCountCache {
                    key: log_count_cache_key(filters),
                    end_date: filters.end_date,
                    changes: connection_total_changes(&conn)?,
                    computed_at: std::time::Instant::now(),
                    total,
                });
                total
            }
        };
        drop(count_cache);

        // 获取数据
        let offset = page * page_size;
        params.push(Box::new(page_size as i64));
        params.push(Box::new(offset as i64));

        let logs_pname = provider_name_coalesce("l", "p");
        let sql = format!(
            "SELECT l.request_id, l.provider_id, {logs_pname} as provider_name, l.app_type, l.model,
                    l.request_model, l.cost_multiplier,
                    l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_creation_tokens,
                    l.input_cost_usd, l.output_cost_usd, l.cache_read_cost_usd, l.cache_creation_cost_usd, l.total_cost_usd,
                    l.is_streaming, l.latency_ms, l.first_token_ms, l.duration_ms,
                    l.status_code, l.error_message, l.created_at, l.data_source
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}
             ORDER BY l.created_at DESC
             LIMIT ? OFFSET ?"
        );

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), row_to_request_log_detail)?;

        let mut logs = Vec::new();
        let mut pricing_cache = HashMap::new();

        for row in rows {
            let mut log = row?;
            Self::maybe_backfill_log_costs(&conn, &mut log, &mut pricing_cache)?;
            logs.push(log);
        }

        Ok(PaginatedLogs {
            data: logs,
            total,
            page,
            page_size,
        })
    }

    /// 获取单个请求详情
    pub fn get_request_detail(
        &self,
        request_id: &str,
    ) -> Result<Option<RequestLogDetail>, AppError> {
        let conn = lock_conn!(self.conn);

        let detail_pname = provider_name_coalesce("l", "p");
        let detail_sql = format!(
            "SELECT l.request_id, l.provider_id, {detail_pname} as provider_name, l.app_type, l.model,
                    l.request_model, l.cost_multiplier,
                    l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_creation_tokens,
                    l.input_cost_usd, l.output_cost_usd, l.cache_read_cost_usd, l.cache_creation_cost_usd, l.total_cost_usd,
                    l.is_streaming, l.latency_ms, l.first_token_ms, l.duration_ms,
                    l.status_code, l.error_message, l.created_at, l.data_source
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             WHERE l.request_id = ?"
        );
        let result = conn.query_row(&detail_sql, [request_id], row_to_request_log_detail);

        match result {
            Ok(mut detail) => {
                let mut pricing_cache = HashMap::new();
                Self::maybe_backfill_log_costs(&conn, &mut detail, &mut pricing_cache)?;
                Ok(Some(detail))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 检查 Provider 使用限额
    pub fn check_provider_limits(
        &self,
        provider_id: &str,
        app_type: &str,
    ) -> Result<ProviderLimitStatus, AppError> {
        let conn = lock_conn!(self.conn);

        // 获取 provider 的限额设置
        let (limit_daily, limit_monthly) = conn
            .query_row(
                "SELECT meta FROM providers WHERE id = ? AND app_type = ?",
                params![provider_id, app_type],
                |row| {
                    let meta_str: String = row.get(0)?;
                    Ok(meta_str)
                },
            )
            .ok()
            .and_then(|meta_str| serde_json::from_str::<serde_json::Value>(&meta_str).ok())
            .map(|meta| {
                let daily = meta
                    .get("limitDailyUsd")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok());
                let monthly = meta
                    .get("limitMonthlyUsd")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok());
                (daily, monthly)
            })
            .unwrap_or((None, None));

        let effective_filter = effective_usage_log_filter("l");

        // 计算今日使用量 (detail logs + rollup)
        let daily_sql = format!(
            "SELECT COALESCE(SUM(cost), 0) FROM (
                SELECT CAST(l.total_cost_usd AS REAL) as cost
                FROM proxy_request_logs l
                WHERE l.provider_id = ? AND l.app_type = ?
                  AND date(datetime(l.created_at, 'unixepoch', 'localtime')) = date('now', 'localtime')
                  AND {effective_filter}
                UNION ALL
                SELECT CAST(total_cost_usd AS REAL)
                FROM usage_daily_rollups
                WHERE provider_id = ? AND app_type = ?
                  AND date = date('now', 'localtime')
            )"
        );
        let daily_usage: f64 = conn
            .query_row(
                &daily_sql,
                params![provider_id, app_type, provider_id, app_type],
                |row| row.get(0),
            )
            .unwrap_or(0.0);

        // 计算本月使用量 (detail logs + rollup)
        let monthly_sql = format!(
            "SELECT COALESCE(SUM(cost), 0) FROM (
                SELECT CAST(l.total_cost_usd AS REAL) as cost
                FROM proxy_request_logs l
                WHERE l.provider_id = ? AND l.app_type = ?
                  AND strftime('%Y-%m', datetime(l.created_at, 'unixepoch', 'localtime')) = strftime('%Y-%m', 'now', 'localtime')
                  AND {effective_filter}
                UNION ALL
                SELECT CAST(total_cost_usd AS REAL)
                FROM usage_daily_rollups
                WHERE provider_id = ? AND app_type = ?
                  AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime')
            )"
        );
        let monthly_usage: f64 = conn
            .query_row(
                &monthly_sql,
                params![provider_id, app_type, provider_id, app_type],
                |row| row.get(0),
            )
            .unwrap_or(0.0);

        let daily_exceeded = limit_daily
            .map(|limit| daily_usage >= limit)
            .unwrap_or(false);
        let monthly_exceeded = limit_monthly
            .map(|limit| monthly_usage >= limit)
            .unwrap_or(false);

        Ok(ProviderLimitStatus {
            provider_id: provider_id.to_string(),
            daily_usage: format!("{daily_usage:.6}"),
            daily_limit: limit_daily.map(|l| format!("{l:.2}")),
            daily_exceeded,
            monthly_usage: format!("{monthly_usage:.6}"),
            monthly_limit: limit_monthly.map(|l| format!("{l:.2}")),
            monthly_exceeded,
        })
    }
}

/// Provider 限额状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimitStatus {
    pub provider_id: String,
    pub daily_usage: String,
    pub daily_limit: Option<String>,
    pub daily_exceeded: bool,
    pub monthly_usage: String,
    pub monthly_limit: Option<String>,
    pub monthly_exceeded: bool,
}

#[derive(Clone)]
struct PricingInfo {
    input: rust_decimal::Decimal,
    output: rust_decimal::Decimal,
    cache_read: rust_decimal::Decimal,
    cache_creation: rust_decimal::Decimal,
}

impl Database {
    pub(crate) fn backfill_missing_usage_costs(&self) -> Result<usize, AppError> {
        self.backfill_missing_usage_costs_inner(None)
    }

    pub(crate) fn backfill_missing_usage_costs_for_model(
        &self,
        model_id: &str,
    ) -> Result<usize, AppError> {
        self.backfill_missing_usage_costs_inner(Some(model_id))
    }

    fn backfill_missing_usage_costs_inner(
        &self,
        only_model_id: Option<&str>,
    ) -> Result<usize, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn.prepare(
            "SELECT l.request_id, l.provider_id, p.name, l.app_type, l.model,
                    l.request_model, l.cost_multiplier,
                    l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_creation_tokens,
                    l.input_cost_usd, l.output_cost_usd, l.cache_read_cost_usd,
                    l.cache_creation_cost_usd, l.total_cost_usd,
                    l.is_streaming, l.latency_ms, l.first_token_ms, l.duration_ms,
                    l.status_code, l.error_message, l.created_at, l.data_source
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             WHERE CAST(l.total_cost_usd AS REAL) <= 0
               AND (l.input_tokens > 0 OR l.output_tokens > 0
                    OR l.cache_read_tokens > 0 OR l.cache_creation_tokens > 0)",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(RequestLogDetail {
                request_id: row.get(0)?,
                provider_id: row.get(1)?,
                provider_name: row.get(2)?,
                app_type: row.get(3)?,
                model: row.get(4)?,
                request_model: row.get(5)?,
                cost_multiplier: row
                    .get::<_, Option<String>>(6)?
                    .unwrap_or_else(|| "1".to_string()),
                input_tokens: row.get::<_, i64>(7)? as u32,
                output_tokens: row.get::<_, i64>(8)? as u32,
                cache_read_tokens: row.get::<_, i64>(9)? as u32,
                cache_creation_tokens: row.get::<_, i64>(10)? as u32,
                input_cost_usd: row.get(11)?,
                output_cost_usd: row.get(12)?,
                cache_read_cost_usd: row.get(13)?,
                cache_creation_cost_usd: row.get(14)?,
                total_cost_usd: row.get(15)?,
                is_streaming: row.get::<_, i64>(16)? != 0,
                latency_ms: row.get::<_, i64>(17)? as u64,
                first_token_ms: row.get::<_, Option<i64>>(18)?.map(|value| value as u64),
                duration_ms: row.get::<_, Option<i64>>(19)?.map(|value| value as u64),
                status_code: row.get::<_, i64>(20)? as u16,
                error_message: row.get(21)?,
                created_at: row.get(22)?,
                data_source: row.get(23)?,
            })
        })?;
        let mut logs = rows.collect::<Result<Vec<_>, _>>()?;

        if let Some(model_id) = only_model_id {
            let target = clean_model_id_for_pricing(model_id);
            logs.retain(|log| {
                clean_model_id_for_pricing(&log.model) == target
                    || log
                        .request_model
                        .as_deref()
                        .is_some_and(|model| clean_model_id_for_pricing(model) == target)
            });
        }

        let mut pricing_cache = HashMap::new();
        let mut updated = 0;
        for mut log in logs {
            let previous_total = log.total_cost_usd.clone();
            Self::maybe_backfill_log_costs(&conn, &mut log, &mut pricing_cache)?;
            if log.total_cost_usd != previous_total {
                updated += 1;
            }
        }
        Ok(updated)
    }

    fn maybe_backfill_log_costs(
        conn: &Connection,
        log: &mut RequestLogDetail,
        pricing_cache: &mut HashMap<String, PricingInfo>,
    ) -> Result<(), AppError> {
        let total_cost = rust_decimal::Decimal::from_str(&log.total_cost_usd)
            .unwrap_or(rust_decimal::Decimal::ZERO);
        let has_cost = total_cost > rust_decimal::Decimal::ZERO;
        let has_usage = log.input_tokens > 0
            || log.output_tokens > 0
            || log.cache_read_tokens > 0
            || log.cache_creation_tokens > 0;

        if has_cost || !has_usage {
            return Ok(());
        }

        let pricing = match Self::get_model_pricing_cached(conn, pricing_cache, &log.model)? {
            Some(info) => info,
            None => return Ok(()),
        };
        let multiplier = rust_decimal::Decimal::from_str(&log.cost_multiplier)
            .unwrap_or(rust_decimal::Decimal::ONE);

        let million = rust_decimal::Decimal::from(1_000_000u64);

        // 与 CostCalculator::calculate 保持一致的计算逻辑：
        // 1. input_cost 需要扣除 cache_read_tokens（避免缓存部分被重复计费）
        // 2. 各项成本是基础成本（不含倍率）
        // 3. 倍率只作用于最终总价
        let billable_input_tokens =
            (log.input_tokens as u64).saturating_sub(log.cache_read_tokens as u64);
        let input_cost =
            rust_decimal::Decimal::from(billable_input_tokens) * pricing.input / million;
        let output_cost =
            rust_decimal::Decimal::from(log.output_tokens as u64) * pricing.output / million;
        let cache_read_cost = rust_decimal::Decimal::from(log.cache_read_tokens as u64)
            * pricing.cache_read
            / million;
        let cache_creation_cost = rust_decimal::Decimal::from(log.cache_creation_tokens as u64)
            * pricing.cache_creation
            / million;
        // 总成本 = 基础成本之和 × 倍率
        let base_total = input_cost + output_cost + cache_read_cost + cache_creation_cost;
        let total_cost = base_total * multiplier;

        log.input_cost_usd = format!("{input_cost:.6}");
        log.output_cost_usd = format!("{output_cost:.6}");
        log.cache_read_cost_usd = format!("{cache_read_cost:.6}");
        log.cache_creation_cost_usd = format!("{cache_creation_cost:.6}");
        log.total_cost_usd = format!("{total_cost:.6}");

        conn.execute(
            "UPDATE proxy_request_logs
             SET input_cost_usd = ?1,
                 output_cost_usd = ?2,
                 cache_read_cost_usd = ?3,
                 cache_creation_cost_usd = ?4,
                 total_cost_usd = ?5
             WHERE request_id = ?6",
            params![
                log.input_cost_usd,
                log.output_cost_usd,
                log.cache_read_cost_usd,
                log.cache_creation_cost_usd,
                log.total_cost_usd,
                log.request_id
            ],
        )
        .map_err(|e| AppError::Database(format!("更新请求成本失败: {e}")))?;

        Ok(())
    }

    fn get_model_pricing_cached(
        conn: &Connection,
        cache: &mut HashMap<String, PricingInfo>,
        model: &str,
    ) -> Result<Option<PricingInfo>, AppError> {
        if let Some(info) = cache.get(model) {
            return Ok(Some(info.clone()));
        }

        let row = find_model_pricing_row(conn, model)?;
        let Some((input, output, cache_read, cache_creation)) = row else {
            return Ok(None);
        };

        let pricing = PricingInfo {
            input: rust_decimal::Decimal::from_str(&input)
                .map_err(|e| AppError::Database(format!("解析输入价格失败: {e}")))?,
            output: rust_decimal::Decimal::from_str(&output)
                .map_err(|e| AppError::Database(format!("解析输出价格失败: {e}")))?,
            cache_read: rust_decimal::Decimal::from_str(&cache_read)
                .map_err(|e| AppError::Database(format!("解析缓存读取价格失败: {e}")))?,
            cache_creation: rust_decimal::Decimal::from_str(&cache_creation)
                .map_err(|e| AppError::Database(format!("解析缓存写入价格失败: {e}")))?,
        };

        cache.insert(model.to_string(), pricing.clone());
        Ok(Some(pricing))
    }
}

pub(crate) fn find_model_pricing(conn: &Connection, model_id: &str) -> Option<ModelPricing> {
    find_model_pricing_row(conn, model_id)
        .ok()
        .flatten()
        .and_then(|(input, output, cache_read, cache_creation)| {
            ModelPricing::from_strings(&input, &output, &cache_read, &cache_creation).ok()
        })
}

pub(crate) fn find_model_pricing_row(
    conn: &Connection,
    model_id: &str,
) -> Result<Option<(String, String, String, String)>, AppError> {
    let candidates = model_pricing_candidates(model_id);
    if candidates.is_empty() {
        return Ok(None);
    }

    for candidate in &candidates {
        if let Some(row) = query_model_pricing_exact(conn, candidate)? {
            return Ok(Some(row));
        }
    }

    for candidate in &candidates {
        if should_try_pricing_prefix_match(candidate) {
            if let Some(row) = query_model_pricing_prefix(conn, candidate)? {
                return Ok(Some(row));
            }
        }
    }

    Ok(None)
}

fn model_pricing_candidates(model_id: &str) -> Vec<String> {
    let cleaned = clean_model_id_for_pricing(model_id);
    if is_placeholder_pricing_model(&cleaned) {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    let mut queue = vec![cleaned];

    while let Some(candidate) = queue.pop() {
        if !push_unique_candidate(&mut candidates, candidate.clone()) {
            continue;
        }

        if let Some(stripped) = strip_known_model_namespace(&candidate) {
            queue.push(stripped);
        }
        if let Some(stripped) = strip_claude_desktop_non_anthropic_prefix(&candidate) {
            queue.push(stripped);
        }
        if let Some(stripped) = strip_bedrock_model_version_suffix(&candidate) {
            queue.push(stripped);
        }
        if let Some(stripped) = strip_model_date_suffix(&candidate) {
            queue.push(stripped);
        }
        if let Some(stripped) = strip_reasoning_effort_suffix(&candidate) {
            queue.push(stripped);
        }
        if candidate.starts_with("claude-") && candidate.contains('.') {
            queue.push(candidate.replace('.', "-"));
        }
    }

    candidates
}

pub(crate) fn is_placeholder_pricing_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    normalized.is_empty() || matches!(normalized.as_str(), "unknown" | "null" | "none")
}

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: String) -> bool {
    if candidate.is_empty() || candidates.iter().any(|existing| existing == &candidate) {
        return false;
    }
    candidates.push(candidate);
    true
}

fn strip_known_model_namespace(model_id: &str) -> Option<String> {
    if let Some(pos) = model_id.rfind("claude-") {
        if pos > 0 {
            return Some(model_id[pos..].to_string());
        }
    }

    for marker in [
        "openai.",
        "anthropic.",
        "google.",
        "moonshot.",
        "moonshotai.",
        "bedrock.",
        "global.",
    ] {
        if let Some(stripped) = model_id.strip_prefix(marker) {
            return Some(stripped.to_string());
        }
    }

    None
}

fn strip_claude_desktop_non_anthropic_prefix(model_id: &str) -> Option<String> {
    const NON_ANTHROPIC_MARKERS: &[&str] = &[
        "abab",
        "ark-code",
        "arctic",
        "astron",
        "codex",
        "command-r",
        "deepseek",
        "doubao",
        "ernie",
        "gemini",
        "gemma",
        "glm",
        "gpt",
        "grok",
        "hermes",
        "hy3",
        "hunyuan",
        "jamba",
        "kimi",
        "lfm",
        "llama",
        "longcat",
        "mercury",
        "mimo",
        "minimax",
        "mistral",
        "mixtral",
        "moonshot",
        "nemotron",
        "nova-",
        "openai",
        "qianfan",
        "qwen",
        "seed-",
        "solar",
        "stepfun",
    ];

    let rest = model_id.strip_prefix("claude-")?;
    NON_ANTHROPIC_MARKERS
        .iter()
        .any(|marker| rest.starts_with(marker))
        .then(|| rest.to_string())
}

fn strip_bedrock_model_version_suffix(model_id: &str) -> Option<String> {
    let (base, suffix) = model_id.rsplit_once("-v")?;
    (!base.is_empty() && !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        .then(|| base.to_string())
}

fn strip_model_date_suffix(model_id: &str) -> Option<String> {
    let bytes = model_id.as_bytes();
    if bytes.len() > 11 {
        let start = bytes.len() - 11;
        let suffix = &bytes[start..];
        let is_iso_date = suffix[0] == b'-'
            && suffix[1..5].iter().all(|b| b.is_ascii_digit())
            && suffix[5] == b'-'
            && suffix[6..8].iter().all(|b| b.is_ascii_digit())
            && suffix[8] == b'-'
            && suffix[9..11].iter().all(|b| b.is_ascii_digit());
        if is_iso_date {
            return Some(model_id[..start].to_string());
        }
    }

    let (base, suffix) = model_id.rsplit_once('-')?;
    if base.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // 8 位 YYYYMMDD（如 -20250615；OpenAI / Claude / 通义千问等）。
    if suffix.len() == 8 {
        return Some(base.to_string());
    }
    // 6 位 YYMMDD（如 -260628；火山方舟 doubao-seed-*、部分国产厂商）。
    // 6 位比 8 位更易误伤非日期尾巴（如 -123456 的版本号），故额外校验
    // 月 01-12、日 01-31 才剥离；剥不动时退回 None 由上层精确匹配兜底。
    if suffix.len() == 6 {
        let month: u32 = suffix[2..4].parse().unwrap_or(0);
        let day: u32 = suffix[4..6].parse().unwrap_or(0);
        if (1..=12).contains(&month) && (1..=31).contains(&day) {
            return Some(base.to_string());
        }
    }
    None
}

fn strip_reasoning_effort_suffix(model_id: &str) -> Option<String> {
    for suffix in ["-minimal", "-low", "-medium", "-high", "-xhigh"] {
        if let Some(stripped) = model_id.strip_suffix(suffix) {
            if !stripped.is_empty() {
                return Some(stripped.to_string());
            }
        }
    }
    None
}

fn should_try_pricing_prefix_match(model_id: &str) -> bool {
    let dash_count = model_id.matches('-').count();

    if model_id.starts_with("claude-") {
        return dash_count >= 3;
    }

    if ["o1", "o3", "o4", "o5"]
        .iter()
        .any(|prefix| model_id.starts_with(prefix))
    {
        return dash_count >= 1;
    }

    const PREFIX_MATCH_FAMILIES: &[&str] = &[
        "gpt-",
        "gemini-",
        "deepseek-",
        "qwen-",
        "glm-",
        "kimi-",
        "minimax-",
    ];

    PREFIX_MATCH_FAMILIES
        .iter()
        .any(|prefix| model_id.starts_with(prefix))
        && dash_count >= 2
}

fn query_model_pricing_exact(
    conn: &Connection,
    model_id: &str,
) -> Result<Option<(String, String, String, String)>, AppError> {
    conn.query_row(
        "SELECT input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
         FROM model_pricing
         WHERE model_id = ?1 COLLATE NOCASE",
        [model_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    )
    .optional()
    .map_err(|e| AppError::Database(format!("查询模型定价失败: {e}")))
}

fn query_model_pricing_prefix(
    conn: &Connection,
    model_id: &str,
) -> Result<Option<(String, String, String, String)>, AppError> {
    let pattern = format!("{model_id}-%");
    conn.query_row(
        "SELECT input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
         FROM model_pricing
         WHERE model_id LIKE ?1
         ORDER BY LENGTH(model_id) ASC
         LIMIT 1",
        [pattern],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    )
    .optional()
    .map_err(|e| AppError::Database(format!("查询模型前缀定价失败: {e}")))
}

fn clean_model_id_for_pricing(model_id: &str) -> String {
    let normalized = model_id
        .rsplit_once('/')
        .map_or(model_id, |(_, r)| r)
        .split(':')
        .next()
        .unwrap_or(model_id)
        .trim()
        .replace('@', "-")
        .to_ascii_lowercase();

    normalized
        .trim_end_matches(crate::claude_desktop_config::ONE_M_CONTEXT_MARKER)
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_session_matches_claude_desktop_proxy_usage() -> Result<(), AppError> {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model, input_tokens, output_tokens,
                cache_read_tokens, cache_creation_tokens, latency_ms, status_code, created_at, data_source
             ) VALUES ('desktop-proxy', 'p1', 'claude-desktop', 'claude-sonnet-4-5',
                100, 20, 10, 5, 0, 200, 1000, 'proxy')",
            [],
        )?;
        let key = DedupKey {
            app_type: "claude",
            data_source: "session_log",
            model: "claude-sonnet-4-5",
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 10,
            cache_creation_tokens: 5,
            created_at: 1060,
        };
        assert!(has_matching_proxy_usage_log(&conn, &key)?);
        Ok(())
    }

    #[test]
    fn test_get_usage_summary() -> Result<(), AppError> {
        let db = Database::memory()?;

        // 插入测试数据
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params!["req1", "p1", "claude", "claude-3", 100, 50, "0.01", 100, 200, 1000],
            )?;
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params!["req2", "p1", "claude", "claude-3", 200, 100, "0.02", 150, 200, 2000],
            )?;
        }

        let summary = db.get_usage_summary(None, None, None, None, None)?;
        assert_eq!(summary.total_requests, 2);
        assert_eq!(summary.success_rate, 100.0);

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    fn insert_usage_log(
        conn: &Connection,
        request_id: &str,
        app_type: &str,
        provider_id: &str,
        model: &str,
        data_source: &str,
        created_at: i64,
        input_tokens: i64,
        output_tokens: i64,
        cache_read_tokens: i64,
        cache_creation_tokens: i64,
        status_code: i64,
        total_cost_usd: &str,
    ) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd,
                total_cost_usd, latency_ms, status_code, created_at, data_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '0', '0', '0', '0', ?, 100, ?, ?, ?)",
            params![
                request_id,
                provider_id,
                app_type,
                model,
                model,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                total_cost_usd,
                status_code,
                created_at,
                data_source
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_effective_usage_dedup_matches_legacy_codex_proxy_without_cache_writes(
    ) -> Result<(), AppError> {
        // v3.17.0 之前的代理不记录 Codex 缓存写入；新语义代理行仍要求写入量一致。
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            for (request_id, provider_id, data_source, created_at, cache_creation) in [
                ("legacy-proxy", "openai", "proxy", 10_000, 0),
                (
                    "session-vs-legacy",
                    "_codex_session",
                    "codex_session",
                    10_060,
                    600,
                ),
                ("total-proxy", "openai", "proxy", 20_000, 0),
                (
                    "session-vs-total",
                    "_codex_session",
                    "codex_session",
                    20_060,
                    600,
                ),
            ] {
                insert_usage_log(
                    &conn,
                    request_id,
                    "codex",
                    provider_id,
                    "gpt-5.6",
                    data_source,
                    created_at,
                    1000,
                    50,
                    300,
                    cache_creation,
                    200,
                    "0.01",
                )?;
            }
        }

        // 逐行 EXISTS 和按窗口的 rowid NOT IN 两种写法都要去掉 session-vs-legacy。
        let conn = lock_conn!(db.conn);
        let ranged = effective_usage_log_filter_for_range(&conn, "l", None, None)?;
        assert!(ranged.contains("NOT IN"));
        for filter in [effective_usage_log_filter("l"), ranged] {
            let mut stmt = conn.prepare(&format!(
                "SELECT request_id FROM proxy_request_logs l WHERE {filter} ORDER BY request_id"
            ))?;
            let request_ids = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            assert_eq!(request_ids, ["legacy-proxy", "total-proxy"]);
        }

        Ok(())
    }

    #[test]
    fn test_get_model_stats() -> Result<(), AppError> {
        let db = Database::memory()?;

        // 插入测试数据
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "req1",
                    "p1",
                    "claude",
                    "claude-3-sonnet",
                    100,
                    50,
                    "0.01",
                    100,
                    200,
                    1000
                ],
            )?;
        }

        let stats = db.get_model_stats(None, None, None, None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].model, "claude-3-sonnet");
        assert_eq!(stats[0].request_count, 1);

        Ok(())
    }

    #[test]
    fn test_model_pricing_matching() -> Result<(), AppError> {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);

        // 准备额外定价数据，覆盖前缀/后缀清洗场景
        conn.execute(
            "INSERT OR REPLACE INTO model_pricing (
                model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
            ) VALUES (?, ?, ?, ?, ?, ?)",
            params![
                "claude-haiku-4.5",
                "Claude Haiku 4.5",
                "1.0",
                "2.0",
                "0.0",
                "0.0"
            ],
        )?;

        // 测试精确匹配（seed_model_pricing 已预置 claude-sonnet-4-5-20250929）
        let result = find_model_pricing_row(&conn, "claude-sonnet-4-5-20250929")?;
        assert!(
            result.is_some(),
            "应该能精确匹配 claude-sonnet-4-5-20250929"
        );

        // 清洗：去除前缀和冒号后缀
        let result = find_model_pricing_row(&conn, "anthropic/claude-haiku-4.5")?;
        assert!(
            result.is_some(),
            "带前缀的模型 anthropic/claude-haiku-4.5 应能匹配到 claude-haiku-4.5"
        );
        let result = find_model_pricing_row(&conn, "moonshotai/kimi-k2-0905:exa")?;
        assert!(
            result.is_some(),
            "带前缀+冒号后缀的模型应清洗后匹配到 kimi-k2-0905"
        );

        // 清洗：@ 替换为 -（seed_model_pricing 已预置 gpt-5.2-codex-low）
        let result = find_model_pricing_row(&conn, "gpt-5.2-codex@low")?;
        assert!(
            result.is_some(),
            "带 @ 分隔符的模型 gpt-5.2-codex@low 应能匹配到 gpt-5.2-codex-low"
        );

        // 测试不存在的模型
        let result = find_model_pricing_row(&conn, "unknown-model-123")?;
        assert!(result.is_none(), "不应该匹配不存在的模型");

        // 大小写不敏感（来自上游 zero-cost 修复）：
        // OpenAI/GPT-5.2-Codex@LOW → 清洗后 gpt-5.2-codex-low，能命中 seed
        let result = find_model_pricing_row(&conn, "OpenAI/GPT-5.2-Codex@LOW")?;
        assert!(
            result.is_some(),
            "大小写不一致的模型 OpenAI/GPT-5.2-Codex@LOW 应能命中 gpt-5.2-codex-low"
        );

        Ok(())
    }

    #[test]
    fn scoped_backfill_uses_models_dev_normalization() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT OR REPLACE INTO model_pricing (
                    model_id, display_name, input_cost_per_million, output_cost_per_million,
                    cache_read_cost_per_million, cache_creation_cost_per_million
                ) VALUES ('custom-model', 'Custom Model', '1.25', '5', '0.1', '1.5')",
                [],
            )?;
            insert_dedup_test_log(
                &conn,
                "models-dev-backfill",
                "codex",
                "provider-1",
                "openrouter/vendor/CUSTOM-MODEL[1m]:free",
                "proxy",
                1,
                1_000_000,
                0,
                0,
                0,
                200,
                "0",
            )?;
        }

        assert_eq!(
            db.backfill_missing_usage_costs_for_model("custom-model")?,
            1
        );
        let conn = lock_conn!(db.conn);
        let total_cost: String = conn.query_row(
            "SELECT total_cost_usd FROM proxy_request_logs WHERE request_id = ?1",
            ["models-dev-backfill"],
            |row| row.get(0),
        )?;
        assert_eq!(total_cost, "1.250000");
        Ok(())
    }

    #[test]
    fn historical_backfill_uses_recorded_multiplier_not_provider_meta() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT OR REPLACE INTO model_pricing (
                    model_id, display_name, input_cost_per_million, output_cost_per_million,
                    cache_read_cost_per_million, cache_creation_cost_per_million
                ) VALUES ('custom-model', 'Custom Model', '1.25', '5', '0.1', '1.5')",
                [],
            )?;
            insert_dedup_test_log(
                &conn,
                "models-dev-backfill",
                "codex",
                "provider-1",
                "openrouter/vendor/CUSTOM-MODEL[1m]:free",
                "proxy",
                1,
                1_000_000,
                0,
                0,
                0,
                200,
                "0",
            )?;
        }

        {
            let conn = lock_conn!(db.conn);
            conn.execute("UPDATE proxy_request_logs SET cost_multiplier = '2' WHERE request_id = 'models-dev-backfill'", [])?;
            conn.execute("INSERT INTO providers (id, app_type, name, settings_config, meta) VALUES ('provider-1', 'codex', 'Old', '{}', '{\"costMultiplier\":\"9\"}')", [])?;
        }
        assert_eq!(
            db.backfill_missing_usage_costs_for_model("custom-model")?,
            1
        );
        let conn = lock_conn!(db.conn);
        let total_cost: String = conn.query_row(
            "SELECT total_cost_usd FROM proxy_request_logs WHERE request_id = ?1",
            ["models-dev-backfill"],
            |row| row.get(0),
        )?;
        assert_eq!(total_cost, "2.500000");
        Ok(())
    }

    /// 插入测试用 proxy_request_logs 行，参数列表精简到本组测试需要的列。
    #[allow(clippy::too_many_arguments)]
    fn insert_dedup_test_log(
        conn: &Connection,
        request_id: &str,
        app_type: &str,
        provider_id: &str,
        model: &str,
        data_source: &str,
        created_at: i64,
        input_tokens: u32,
        output_tokens: u32,
        cache_read_tokens: u32,
        cache_creation_tokens: u32,
        status_code: i64,
        total_cost_usd: &str,
    ) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                total_cost_usd, latency_ms, status_code, created_at, data_source
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                request_id,
                provider_id,
                app_type,
                model,
                input_tokens as i64,
                output_tokens as i64,
                cache_read_tokens as i64,
                cache_creation_tokens as i64,
                total_cost_usd,
                100i64,
                status_code,
                created_at,
                data_source,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    #[test]
    fn dedup_filter_excludes_session_rows_already_covered_by_proxy() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            // codex / gemini 各一条 proxy + 一条 session（session 应被 filter 排除）
            insert_dedup_test_log(
                &conn,
                "codex-proxy",
                "codex",
                "openai",
                "gpt-5.4",
                "proxy",
                10_000,
                100,
                20,
                10,
                0,
                200,
                "0.10",
            )?;
            insert_dedup_test_log(
                &conn,
                "codex-session-dup",
                "codex",
                "_codex_session",
                "gpt-5.4",
                "codex_session",
                10_120, // 在 ±10min 窗口内
                100,
                20,
                10,
                0, // session 不带 cache_creation：filter 内部对 codex/gemini 放行 proxy 任意值
                200,
                "0.10",
            )?;
            insert_dedup_test_log(
                &conn,
                "gemini-proxy",
                "gemini",
                "google",
                "gemini-2.5-flash",
                "proxy",
                10_500,
                200,
                50,
                0,
                0,
                200,
                "0.05",
            )?;
            insert_dedup_test_log(
                &conn,
                "gemini-session-dup",
                "gemini",
                "_gemini_session",
                "gemini-2.5-flash",
                "gemini_session",
                10_400,
                200,
                50,
                0,
                0,
                200,
                "0.05",
            )?;
            // 仅 session、没有匹配 proxy 行，应该保留
            insert_dedup_test_log(
                &conn,
                "codex-session-only",
                "codex",
                "_codex_session",
                "gpt-5.4",
                "codex_session",
                20_000,
                300,
                30,
                0,
                0,
                200,
                "0.20",
            )?;
        }

        let logs = db.get_request_logs(&LogFilters::default(), 0, 20)?;
        let request_ids: Vec<&str> = logs
            .data
            .iter()
            .map(|log| log.request_id.as_str())
            .collect();
        assert_eq!(logs.total, 3, "session-dup 行应被 filter 排除");
        assert!(request_ids.contains(&"codex-proxy"));
        assert!(request_ids.contains(&"gemini-proxy"));
        assert!(request_ids.contains(&"codex-session-only"));
        assert!(!request_ids.contains(&"codex-session-dup"));
        assert!(!request_ids.contains(&"gemini-session-dup"));

        // summary 计数也要排除被覆盖的 session 行
        let summary = db.get_usage_summary(None, None, None, None, None)?;
        assert_eq!(summary.total_requests, 3);

        Ok(())
    }

    #[test]
    fn dedup_filter_keeps_session_rows_outside_window_or_with_mismatched_tokens(
    ) -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            insert_dedup_test_log(
                &conn,
                "proxy-base",
                "codex",
                "openai",
                "gpt-5.4",
                "proxy",
                10_000,
                100,
                20,
                10,
                0,
                200,
                "0.10",
            )?;
            // 时间窗口外（超过 10 分钟），不应被 dedup 命中
            insert_dedup_test_log(
                &conn,
                "session-outside-window",
                "codex",
                "_codex_session",
                "gpt-5.4",
                "codex_session",
                10_000 + 600 + 1,
                100,
                20,
                10,
                0,
                200,
                "0.10",
            )?;
            // token 不匹配，不应被 dedup 命中
            insert_dedup_test_log(
                &conn,
                "session-token-mismatch",
                "codex",
                "_codex_session",
                "gpt-5.4",
                "codex_session",
                10_120,
                999,
                20,
                10,
                0,
                200,
                "0.10",
            )?;
        }

        let logs = db.get_request_logs(&LogFilters::default(), 0, 20)?;
        let request_ids: Vec<&str> = logs
            .data
            .iter()
            .map(|log| log.request_id.as_str())
            .collect();
        assert!(request_ids.contains(&"proxy-base"));
        assert!(request_ids.contains(&"session-outside-window"));
        assert!(request_ids.contains(&"session-token-mismatch"));

        Ok(())
    }

    #[test]
    fn should_skip_session_insert_returns_true_for_matching_proxy_row() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            insert_dedup_test_log(
                &conn,
                "proxy-id-1",
                "codex",
                "openai",
                "gpt-5.4",
                "proxy",
                10_000,
                100,
                20,
                10,
                0,
                200,
                "0.10",
            )?;
        }

        let conn = lock_conn!(db.conn);
        let key = DedupKey {
            app_type: "codex",
            data_source: "codex_session",
            model: "gpt-5.4",
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 10,
            cache_creation_tokens: 0,
            created_at: 10_120,
        };
        assert!(should_skip_session_insert(&conn, "fresh-id", &key)?);

        let mismatched = DedupKey {
            input_tokens: 999,
            ..key
        };
        assert!(!should_skip_session_insert(&conn, "fresh-id", &mismatched)?);

        Ok(())
    }
    #[test]
    fn test_get_provider_stats_speed_sums_only_eligible_requests() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            let insert = |id: &str, output: i64, latency: i64, first: Option<i64>| {
                conn.execute(
                    "INSERT INTO proxy_request_logs (
                        request_id, provider_id, app_type, model,
                        input_tokens, output_tokens, total_cost_usd,
                        latency_ms, first_token_ms, status_code, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![id, "p1", "claude", "m", 10, output, "0", latency, first, 200, 1000],
                )
            };
            // 计入：1000 token / (11000 - 1000) ms
            insert("ok-a", 1000, 11_000, Some(1_000))?;
            // 计入：300 token / (4000 - 1000) ms
            insert("ok-b", 300, 4_000, Some(1_000))?;
            // 不计：输出不到 100
            insert("short", 50, 2_000, Some(100))?;
            // 不计：没有首字（会话日志 / 非流式）
            insert("no-ttft", 5_000, 9_000, None)?;
            // 不计：耗时不大于首字
            insert("zero-gen", 500, 1_000, Some(1_000))?;
            // 不计：生成窗口不到 100ms，是传输突发
            insert("burst", 500, 1_050, Some(1_000))?;
        }

        let stats = db.get_provider_stats(None, None, None, None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].request_count, 6);
        assert_eq!(stats[0].speed_output_tokens, 1_300);
        assert_eq!(stats[0].speed_generation_ms, 13_000);
        // 路由服务的行没有首字（非流式）也不算估算速度
        assert_eq!(stats[0].est_speed_output_tokens, 0);
        assert_eq!(stats[0].est_speed_duration_ms, 0);

        // providers 也有 created_at：真实 JOIN 的详情查询必须限定日志列。
        {
            let conn = lock_conn!(db.conn);
            conn.execute("INSERT INTO providers (id, app_type, name, settings_config, created_at) VALUES ('p1','claude','Test','{}',1)", [])?;
        }
        let detail = db.get_request_detail("ok-a")?.expect("request detail");
        assert_eq!(detail.provider_name.as_deref(), Some("Test"));
        assert_eq!(detail.created_at, 1000);
        assert!(db.get_request_detail("missing")?.is_none());

        Ok(())
    }

    #[test]
    fn test_get_provider_stats_estimated_speed_sums_session_rows() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            let insert = |id: &str, output: i64, latency: i64, source: &str| {
                conn.execute(
                    "INSERT INTO proxy_request_logs (
                        request_id, provider_id, app_type, model,
                        input_tokens, output_tokens, total_cost_usd,
                        latency_ms, status_code, created_at, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![
                        id, "_session", "claude", "m", 10, output, "0", latency, 200, 1000, source
                    ],
                )
            };
            // 计入：2000 token / 20000 ms
            insert("ok-a", 2_000, 20_000, "session_log")?;
            // 计入：500 token / 5000 ms
            insert("ok-b", 200, 5_000, "session_log")?;
            // 不计：输出不到 200
            insert("short", 199, 5_000, "session_log")?;
            // 不计：没估出耗时
            insert("no-timing", 3_000, 0, "session_log")?;
            // 不计：耗时不到 1 秒
            insert("too-fast", 800, 900, "session_log")?;
        }

        let stats = db.get_provider_stats(None, None, None, None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].est_speed_output_tokens, 2_200);
        assert_eq!(stats[0].est_speed_duration_ms, 25_000);
        // 估算的不混进精确口径
        assert_eq!(stats[0].speed_output_tokens, 0);
        assert_eq!(stats[0].speed_generation_ms, 0);

        Ok(())
    }
    #[test]
    fn ranged_dedup_matches_original_at_boundaries_and_with_skewed_sources() -> Result<(), AppError>
    {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);
        insert_dedup_test_log(
            &conn,
            "p",
            "claude-desktop",
            "a",
            "unknown",
            "proxy",
            1000,
            10,
            20,
            0,
            0,
            200,
            "1",
        )?;
        insert_dedup_test_log(
            &conn,
            "s",
            "claude",
            "a",
            "model",
            "session_log",
            1100,
            10,
            20,
            0,
            0,
            200,
            "1",
        )?;
        for n in 0..8 {
            insert_dedup_test_log(
                &conn,
                &format!("extra-{n}"),
                "codex",
                "a",
                "model",
                "codex_session",
                4000 + n,
                1,
                2,
                0,
                0,
                200,
                "1",
            )?;
        }
        let ids = |filter: &str, lo: i64, hi: i64| -> Result<Vec<String>, AppError> {
            let mut stmt = conn.prepare(&format!("SELECT request_id FROM proxy_request_logs l WHERE created_at BETWEEN ?1 AND ?2 AND {filter} ORDER BY request_id"))?;
            let rows = stmt
                .query_map(params![lo, hi], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        };
        for (lo, hi) in [(0, 5000), (1100, 1100), (4000, 5000), (0, 1000)] {
            let fast = effective_usage_log_filter_for_range(&conn, "l", Some(lo), Some(hi))?;
            assert_eq!(
                ids(&fast, lo, hi)?,
                ids(&effective_usage_log_filter("l"), lo, hi)?
            );
        }
        assert!(effective_usage_log_filter_for_range(&conn, "l", None, None)?.contains("NOT IN"));
        Ok(())
    }

    #[test]
    fn count_cache_invalidates_after_writes_and_live_window_growth() -> Result<(), AppError> {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);
        let mut filters = LogFilters::default();
        filters.end_date = Some(100);
        let cache = Some(LogCountCache {
            key: log_count_cache_key(&filters),
            end_date: filters.end_date,
            changes: connection_total_changes(&conn)?,
            computed_at: std::time::Instant::now(),
            total: 7,
        });
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, Some(7));
        filters.end_date = Some(200);
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, Some(7));
        insert_dedup_test_log(
            &conn, "new", "codex", "a", "model", "proxy", 150, 10, 20, 0, 0, 200, "1",
        )?;
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, None);
        let cache = Some(LogCountCache {
            changes: connection_total_changes(&conn)?,
            ..cache.unwrap()
        });
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, None);
        filters.end_date = Some(100);
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, Some(7));
        filters.model = Some("different".to_string());
        assert_eq!(cached_log_count(&cache, &conn, &filters)?, None);
        Ok(())
    }

    #[test]
    fn test_matching_proxy_log_matches_codex_request_model_alias() -> Result<(), AppError> {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);
        insert_usage_log(
            &conn,
            "codex-proxy-alias",
            "codex",
            "provider-1",
            "gpt-5.6-sol",
            "proxy",
            1_000,
            100,
            20,
            10,
            0,
            200,
            "0.10",
        )?;
        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
            params!["gpt-5.6-sol-joybuilder", "codex-proxy-alias"],
        )?;

        let key = DedupKey {
            app_type: "codex",
            data_source: "codex_session",
            model: "GPT-5.6-Sol-JoyBuilder",
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 10,
            cache_creation_tokens: 0,
            created_at: 1_060,
        };
        assert!(has_matching_proxy_usage_log(&conn, &key)?);
        assert!(should_skip_session_insert(
            &conn,
            "codex-session-alias",
            &key
        )?);

        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
            params![" gpt-5.6-sol-joybuilder ", "codex-proxy-alias"],
        )?;
        assert!(has_matching_proxy_usage_log(&conn, &key)?);
        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
            params!["gpt-5.6-sol-joybuilder", "codex-proxy-alias"],
        )?;

        let mut outside_window = key;
        outside_window.created_at = 1_601;
        assert!(!has_matching_proxy_usage_log(&conn, &outside_window)?);

        let mut different_tokens = key;
        different_tokens.input_tokens += 1;
        assert!(!has_matching_proxy_usage_log(&conn, &different_tokens)?);

        let mut different_app = key;
        different_app.app_type = "gemini";
        assert!(!has_matching_proxy_usage_log(&conn, &different_app)?);

        let mut mismatched_codex_source = key;
        mismatched_codex_source.app_type = "gemini";
        mismatched_codex_source.data_source = "codex_session";
        assert!(!has_matching_proxy_usage_log(
            &conn,
            &mismatched_codex_source
        )?);

        let mut non_codex_session = key;
        non_codex_session.data_source = "session_log";
        assert!(!has_matching_proxy_usage_log(&conn, &non_codex_session)?);

        for invalid_request_model in [
            None,
            Some(""),
            Some("  "),
            Some("unknown"),
            Some(" UNKNOWN "),
        ] {
            conn.execute(
                "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
                params![invalid_request_model, "codex-proxy-alias"],
            )?;
            assert!(!has_matching_proxy_usage_log(&conn, &key)?);
        }

        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1, status_code = 400 WHERE request_id = ?2",
            params!["gpt-5.6-sol-joybuilder", "codex-proxy-alias"],
        )?;
        assert!(!has_matching_proxy_usage_log(&conn, &key)?);

        Ok(())
    }

    #[test]
    fn test_effective_filter_dedups_only_codex_request_model_alias() -> Result<(), AppError> {
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);
        insert_usage_log(
            &conn,
            "codex-proxy-alias",
            "codex",
            "provider-1",
            "gpt-5.6-sol",
            "proxy",
            1_000,
            100,
            20,
            10,
            0,
            200,
            "0.10",
        )?;
        insert_usage_log(
            &conn,
            "codex-session-alias",
            "codex",
            "_codex_session",
            "gpt-5.6-sol-joybuilder",
            "codex_session",
            1_060,
            100,
            20,
            10,
            0,
            200,
            "0.10",
        )?;
        insert_usage_log(
            &conn,
            "gemini-proxy-alias",
            "gemini",
            "provider-2",
            "gemini-2.5-pro",
            "proxy",
            2_000,
            200,
            40,
            30,
            0,
            200,
            "0.20",
        )?;
        insert_usage_log(
            &conn,
            "gemini-session-alias",
            "gemini",
            "_gemini_session",
            "gemini-logical-alias",
            "gemini_session",
            2_060,
            200,
            40,
            30,
            0,
            200,
            "0.20",
        )?;
        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
            params![" gpt-5.6-sol-joybuilder ", "codex-proxy-alias"],
        )?;
        conn.execute(
            "UPDATE proxy_request_logs SET request_model = ?1 WHERE request_id = ?2",
            params!["gemini-logical-alias", "gemini-proxy-alias"],
        )?;

        let filter = effective_usage_log_filter("l");
        let sql = format!(
            "SELECT request_id FROM proxy_request_logs l WHERE {filter} ORDER BY request_id"
        );
        let request_ids = conn
            .prepare(&sql)?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(
            request_ids,
            vec![
                "codex-proxy-alias".to_string(),
                "gemini-proxy-alias".to_string(),
                "gemini-session-alias".to_string(),
            ]
        );

        Ok(())
    }

    #[test]
    fn test_scoped_backfill_matches_raw_alias_rows() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            // 代理日志按上游原文落库：带路由前缀和 :free 后缀的别名形式。
            // 精准回填的筛选必须归一化后匹配，否则这类行要等全量回填才更新。
            insert_usage_log(
                &conn,
                "openrouter-alias-zero-cost",
                "claude",
                "provider-1",
                "openrouter/moonshot/kimi-k2-novel:free",
                "proxy",
                1000,
                1_000_000,
                0,
                0,
                0,
                200,
                "0",
            )?;
        }

        // 定价缺失时不应回填
        assert_eq!(db.backfill_missing_usage_costs()?, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million)
                 VALUES ('kimi-k2-novel', 'Kimi K2 Novel', '0.6', '2.5')",
                [],
            )?;
        }

        // 按归一化 ID 精准回填，应命中以原始别名落库的行
        assert_eq!(
            db.backfill_missing_usage_costs_for_model("kimi-k2-novel")?,
            1
        );

        let conn = lock_conn!(db.conn);
        let total_cost: String = conn.query_row(
            "SELECT total_cost_usd
             FROM proxy_request_logs WHERE request_id = 'openrouter-alias-zero-cost'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(total_cost, "0.600000");

        Ok(())
    }

    #[test]
    fn test_range_filter_dedups_codex_request_model_alias() -> Result<(), AppError> {
        // 会话行不少于代理行时走 JOIN 写法，同样要认 Codex 的请求模型别名。
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            insert_usage_log(
                &conn,
                "proxy",
                "codex",
                "provider-1",
                "glm-5.3",
                "proxy",
                10_000,
                19_472,
                165,
                16_704,
                0,
                200,
                "0.10",
            )?;
            conn.execute(
                "UPDATE proxy_request_logs SET request_model = 'ccswitch-live-alpha'
                 WHERE request_id = 'proxy'",
                [],
            )?;
            insert_usage_log(
                &conn,
                "session-alias",
                "codex",
                "_codex_session",
                "ccswitch-live-alpha",
                "codex_session",
                10_001,
                19_472,
                165,
                16_704,
                0,
                200,
                "0.10",
            )?;
            insert_usage_log(
                &conn,
                "session-other-alias",
                "codex",
                "_codex_session",
                "other-alias",
                "codex_session",
                10_002,
                19_472,
                165,
                16_704,
                0,
                200,
                "0.10",
            )?;

            let filter = effective_usage_log_filter_for_range(&conn, "l", None, None)?;
            assert!(filter.contains("rowid NOT IN"), "应走 JOIN 写法: {filter}");
            let kept: Vec<String> = conn
                .prepare(&format!(
                    "SELECT request_id FROM proxy_request_logs l WHERE {filter} ORDER BY request_id"
                ))?
                .query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?;
            assert_eq!(kept, ["proxy", "session-other-alias"]);
        }
        assert_eq!(
            db.get_usage_summary(None, None, Some("codex"), None, None)?
                .total_requests,
            2
        );
        Ok(())
    }

    #[test]
    fn test_pricing_lookup_matches_custom_rows_with_uppercase_model_id() -> Result<(), AppError> {
        // 回归 #8413：自定义定价常按界面显示名原样入库（如 GLM-5.3-Flash-EXL3），
        // 而查价候选会被 clean_model_id_for_pricing 小写归一化；若精确匹配大小写
        // 敏感，这类行永远命中不了，成本恒为 0。查价必须大小写不敏感。
        let db = Database::memory()?;
        let conn = lock_conn!(db.conn);

        conn.execute(
            "INSERT OR REPLACE INTO model_pricing (
                model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
            ) VALUES ('GLM-5.3-Flash-EXL3', 'GLM-5.3-Flash-EXL3', '1.4', '4.4', '0.26', '0')",
            [],
        )?;

        let row = find_model_pricing_row(&conn, "GLM-5.3-Flash-EXL3")?;
        assert!(row.is_some(), "小写候选应能命中按大写入库的自定义定价行");
        let (input, output, ..) = row.unwrap();
        assert_eq!(input, "1.4");
        assert_eq!(output, "4.4");

        Ok(())
    }

    fn local_ts(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> i64 {
        match Local.with_ymd_and_hms(year, month, day, hour, minute, second) {
            chrono::LocalResult::Single(dt) => dt.timestamp(),
            chrono::LocalResult::Ambiguous(earliest, _) => earliest.timestamp(),
            chrono::LocalResult::None => panic!("valid local datetime"),
        }
    }

    #[test]
    fn test_claude_desktop_folds_into_claude_for_display() -> Result<(), AppError> {
        let db = Database::memory()?;
        let ts = local_ts(2026, 6, 10, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            // 一条 Claude Code 行 + 一条 Claude Desktop 网关行，同一时间窗。
            insert_usage_log(
                &conn,
                "cc-1",
                "claude",
                "p-claude",
                "claude-sonnet-4-5",
                "proxy",
                ts,
                100,
                10,
                0,
                0,
                200,
                "0.5",
            )?;
            insert_usage_log(
                &conn,
                "cd-1",
                "claude-desktop",
                "p-desktop",
                "claude-opus-4-8",
                "proxy",
                ts,
                200,
                20,
                0,
                0,
                200,
                "1.5",
            )?;
        }

        // ① 分应用汇总：desktop 折叠进 claude，不再单列 claude-desktop 桶。
        let by_app = db.get_usage_summary_by_app(None, None, None, None)?;
        assert_eq!(by_app.len(), 1, "应只剩一个合并后的 claude 桶");
        assert_eq!(by_app[0].app_type, "claude");
        assert_eq!(by_app[0].summary.total_requests, 2, "两条行都计入 claude");
        assert!(
            !by_app.iter().any(|a| a.app_type == "claude-desktop"),
            "不应再出现 claude-desktop 桶"
        );

        // ② 选中 claude 过滤：汇总应同时覆盖 desktop 行。
        let claude_summary = db.get_usage_summary(None, None, Some("claude"), None, None)?;
        assert_eq!(claude_summary.total_requests, 2);

        // ③ 请求日志按 claude 过滤返回两行，且 desktop 行投影仍是原始 app_type。
        let logs = db.get_request_logs(
            &LogFilters {
                app_type: Some("claude".to_string()),
                ..Default::default()
            },
            0, // 页码从 0 开始
            50,
        )?;
        assert_eq!(logs.total, 2, "claude 过滤含 desktop 行");
        assert!(
            logs.data.iter().any(|r| r.app_type == "claude-desktop"),
            "详情面板需要看到真实入口，行投影不可被折叠"
        );

        // ④ 折叠不外溢：codex 过滤为空。
        let codex_summary = db.get_usage_summary(None, None, Some("codex"), None, None)?;
        assert_eq!(codex_summary.total_requests, 0);

        Ok(())
    }

    /// 最早日期：明细和日聚合取较早的一天，筛选与 Dashboard 同口径（claude 包含 claude-desktop）。
    #[test]
    fn test_get_first_usage_date_spans_rollups_and_logs() -> Result<(), AppError> {
        let db = Database::memory()?;
        assert_eq!(db.get_first_usage_date(None, None, None)?, None);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES ('2024-03-05', 'claude', 'p1', 'claude-3', 1, 1, 10, 5, 0, 0, '0', 100)",
                [],
            )?;
            insert_usage_log(
                &conn,
                "codex-1",
                "codex",
                "p2",
                "gpt-5.5",
                "proxy",
                local_ts(2025, 1, 2, 10, 0, 0),
                10,
                5,
                0,
                0,
                200,
                "0",
            )?;
            insert_usage_log(
                &conn,
                "desktop-1",
                "claude-desktop",
                "p3",
                "claude-3",
                "proxy",
                local_ts(2023, 12, 31, 23, 30, 0),
                10,
                5,
                0,
                0,
                200,
                "0",
            )?;
        }

        assert_eq!(
            db.get_first_usage_date(None, None, None)?.as_deref(),
            Some("2023-12-31")
        );
        assert_eq!(
            db.get_first_usage_date(Some("claude"), None, None)?
                .as_deref(),
            Some("2023-12-31")
        );
        assert_eq!(
            db.get_first_usage_date(Some("codex"), None, None)?
                .as_deref(),
            Some("2025-01-02")
        );
        assert_eq!(
            db.get_first_usage_date(None, None, Some("claude-3"))?
                .as_deref(),
            Some("2023-12-31")
        );
        assert_eq!(db.get_first_usage_date(Some("gemini"), None, None)?, None);

        Ok(())
    }

    #[test]
    fn test_get_usage_summary_excludes_partial_rollup_boundary_days() -> Result<(), AppError> {
        let db = Database::memory()?;
        let start = local_ts(2024, 1, 1, 12, 0, 0);
        let end = local_ts(2024, 1, 3, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-01-01",
                    "claude",
                    "p1",
                    "claude-3",
                    10,
                    10,
                    1000,
                    500,
                    0,
                    0,
                    "1.00",
                    100
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-01-02",
                    "claude",
                    "p1",
                    "claude-3",
                    20,
                    19,
                    2000,
                    1000,
                    0,
                    0,
                    "2.00",
                    120
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-01-03",
                    "claude",
                    "p1",
                    "claude-3",
                    30,
                    29,
                    3000,
                    1500,
                    0,
                    0,
                    "3.00",
                    140
                ],
            )?;
        }

        let summary = db.get_usage_summary(Some(start), Some(end), Some("claude"), None, None)?;
        assert_eq!(summary.total_requests, 20);
        assert_eq!(summary.total_input_tokens, 2000);
        assert_eq!(summary.total_output_tokens, 1000);

        Ok(())
    }

    #[test]
    fn test_get_request_detail_reads_proxy_and_session_rows() -> Result<(), AppError> {
        let db = Database::memory()?;
        let ts = local_ts(2026, 6, 10, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            // providers 也有 created_at / cost_multiplier 列：详情查询的列必须带表别名，
            // 否则 SQLite 报 ambiguous column name，整个命令失败。
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, created_at) VALUES
                 ('prov-a', 'claude', 'Packy', '{}', 1)",
                [],
            )?;
            insert_usage_log(
                &conn,
                "a-1",
                "claude",
                "prov-a",
                "claude-sonnet-4-6",
                "proxy",
                ts,
                100,
                10,
                0,
                0,
                200,
                "1.0",
            )?;
            insert_usage_log(
                &conn,
                "session:msg_1",
                "claude",
                "_session",
                "claude-sonnet-4-6",
                "session_log",
                ts,
                999,
                99,
                0,
                0,
                200,
                "0.5",
            )?;
        }

        let proxy = db.get_request_detail("a-1")?.expect("proxy row");
        assert_eq!(proxy.provider_name.as_deref(), Some("Packy"));
        assert_eq!(proxy.created_at, ts);
        assert_eq!(proxy.input_tokens, 100);

        let session = db
            .get_request_detail("session:msg_1")?
            .expect("session row");
        assert_eq!(session.provider_name.as_deref(), Some("Claude (Session)"));
        assert_eq!(session.created_at, ts);

        assert!(db.get_request_detail("missing")?.is_none());

        Ok(())
    }

    #[test]
    fn test_provider_and_model_filters_cover_detail_and_rollup() -> Result<(), AppError> {
        let db = Database::memory()?;
        let detail_ts = local_ts(2026, 6, 10, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config) VALUES
                 ('prov-a', 'claude', 'Packy', '{}'),
                 ('prov-b', 'claude', 'DeepSeek', '{}')",
                [],
            )?;

            insert_usage_log(
                &conn,
                "a-1",
                "claude",
                "prov-a",
                "claude-sonnet-4-6",
                "proxy",
                detail_ts,
                100,
                10,
                0,
                0,
                200,
                "1.0",
            )?;
            insert_usage_log(
                &conn,
                "b-1",
                "claude",
                "prov-b",
                "deepseek-v3",
                "proxy",
                detail_ts,
                200,
                20,
                0,
                0,
                200,
                "2.0",
            )?;
            // 会话占位行：providers 表无此 id，展示名走 CASE 映射。
            insert_usage_log(
                &conn,
                "s-1",
                "claude",
                "_session",
                "claude-sonnet-4-6",
                "session_log",
                detail_ts,
                999,
                99,
                0,
                0,
                200,
                "0.5",
            )?;
            // 同一 Provider 下的另一个模型（Web 没有 pricing_model 列，有效计价模型就是 model）
            insert_usage_log(
                &conn,
                "a-2",
                "claude",
                "prov-a",
                "other-model",
                "proxy",
                detail_ts,
                50,
                5,
                0,
                0,
                200,
                "0.3",
            )?;

            // rollup 历史日行：无范围过滤时全部计入。
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES
                ('2026-06-08', 'claude', 'prov-a', 'claude-sonnet-4-6', 5, 5, 500, 50, 0, 0, '5.0', 100),
                ('2026-06-08', 'claude', 'prov-b', 'deepseek-v3', 7, 7, 700, 70, 0, 0, '7.0', 100)",
                [],
            )?;
        }

        // ① 汇总按 Provider 展示名过滤：明细 + rollup 都命中。
        let packy = db.get_usage_summary(None, None, None, Some("Packy"), None)?;
        assert_eq!(packy.total_requests, 7, "a-1 + a-2 + rollup 5");

        // ② 汇总按模型过滤（有效计价模型口径）。
        let deepseek = db.get_usage_summary(None, None, None, None, Some("deepseek-v3"))?;
        assert_eq!(deepseek.total_requests, 8, "b-1 + rollup 7");

        // ③ 模型按精确名匹配：前缀查不到，全名查得到。
        let by_prefix = db.get_usage_summary(None, None, None, None, Some("other"))?;
        assert_eq!(by_prefix.total_requests, 0);
        let by_name = db.get_usage_summary(None, None, None, None, Some("other-model"))?;
        assert_eq!(by_name.total_requests, 1);

        // ④ 会话占位行可按可读名选中。
        let session = db.get_usage_summary(None, None, None, Some("Claude (Session)"), None)?;
        assert_eq!(session.total_requests, 1);

        // ⑤ Provider 统计 + 模型过滤：只剩 DeepSeek 一行。
        let provider_stats = db.get_provider_stats(None, None, None, None, Some("deepseek-v3"))?;
        assert_eq!(provider_stats.len(), 1);
        assert_eq!(provider_stats[0].provider_name, "DeepSeek");
        assert_eq!(provider_stats[0].request_count, 8);

        // ⑥ 模型统计 + Provider 过滤：只剩 Packy 名下的模型。
        let model_stats = db.get_model_stats(None, None, None, Some("Packy"), None)?;
        let models: Vec<&str> = model_stats.iter().map(|m| m.model.as_str()).collect();
        assert!(models.contains(&"claude-sonnet-4-6"));
        assert!(models.contains(&"other-model"));
        assert!(!models.contains(&"deepseek-v3"));

        // ⑦ 分应用汇总（Hero 卡片数据源）同样受过滤影响。
        let by_app = db.get_usage_summary_by_app(None, None, Some("Packy"), None)?;
        assert_eq!(by_app.len(), 1);
        assert_eq!(by_app[0].app_type, "claude");
        assert_eq!(by_app[0].summary.total_requests, 7);

        // ⑧ 趋势（>24h 走天分桶 + rollup 分支）。
        let t_start = local_ts(2026, 6, 8, 0, 0, 0);
        let t_end = local_ts(2026, 6, 10, 23, 59, 0);
        let trends = db.get_daily_trends(Some(t_start), Some(t_end), None, Some("Packy"), None)?;
        let total_req: u64 = trends.iter().map(|d| d.request_count).sum();
        assert_eq!(total_req, 7, "明细 2 + rollup 5");

        // ⑨ 趋势 ≤24h 走小时分桶分支（?1/?2/?3 编号参数与追加过滤混用的路径），
        //    同时验证 Provider + 模型组合过滤。
        let h_start = local_ts(2026, 6, 10, 0, 0, 0);
        let h_end = local_ts(2026, 6, 10, 20, 0, 0);
        let hourly = db.get_daily_trends(
            Some(h_start),
            Some(h_end),
            None,
            Some("Packy"),
            Some("claude-sonnet-4-6"),
        )?;
        let hourly_req: u64 = hourly.iter().map(|d| d.request_count).sum();
        assert_eq!(hourly_req, 1, "仅 a-1 命中（a-2 模型不同）");

        // ⑩ 请求日志列表与下拉同口径：精确名 + 有效计价模型（不再是模糊匹配）。
        let logs = db.get_request_logs(
            &LogFilters {
                provider_name: Some("Packy".to_string()),
                model: Some("other-model".to_string()),
                ..Default::default()
            },
            0,
            10,
        )?;
        assert_eq!(logs.total, 1);
        assert_eq!(logs.data[0].request_id, "a-2");

        Ok(())
    }

    #[test]
    fn test_get_usage_summary_includes_end_day_rollup_for_minute_precision_end_time(
    ) -> Result<(), AppError> {
        let db = Database::memory()?;
        let start = local_ts(2024, 1, 1, 0, 0, 0);
        let end = local_ts(2024, 1, 2, 23, 59, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-01-01",
                    "claude",
                    "p1",
                    "claude-3",
                    10,
                    10,
                    1000,
                    500,
                    0,
                    0,
                    "1.00",
                    100
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-01-02",
                    "claude",
                    "p1",
                    "claude-3",
                    20,
                    19,
                    2000,
                    1000,
                    0,
                    0,
                    "2.00",
                    120
                ],
            )?;
        }

        let summary = db.get_usage_summary(Some(start), Some(end), Some("claude"), None, None)?;
        assert_eq!(summary.total_requests, 30);
        assert_eq!(summary.total_input_tokens, 3000);
        assert_eq!(summary.total_output_tokens, 1500);

        Ok(())
    }

    #[test]
    fn test_get_model_stats_success_rate_and_speed_per_model() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            let insert = |id: &str,
                          model: &str,
                          output: i64,
                          latency: i64,
                          first: Option<i64>,
                          status: i64,
                          source: &str| {
                conn.execute(
                    "INSERT INTO proxy_request_logs (
                        request_id, provider_id, app_type, model,
                        input_tokens, output_tokens, total_cost_usd,
                        latency_ms, first_token_ms, status_code, created_at, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![
                        id, "p1", "claude", model, 10, output, "0", latency, first, status, 1000,
                        source
                    ],
                )
            };
            // fast：精确速度 1000 token / 10000 ms，另有一条失败请求
            insert("fast-ok", "fast", 1_000, 11_000, Some(1_000), 200, "proxy")?;
            insert("fast-err", "fast", 0, 500, None, 500, "proxy")?;
            // slow：只有会话日志，估算速度 400 token / 8000 ms
            insert("slow-a", "slow", 400, 8_000, None, 200, "session_log")?;
        }

        let stats = db.get_model_stats(None, None, None, None, None)?;
        let fast = stats.iter().find(|s| s.model == "fast").expect("fast");
        assert_eq!(fast.request_count, 2);
        assert!((fast.success_rate - 50.0).abs() < f32::EPSILON);
        assert_eq!(fast.speed_output_tokens, 1_000);
        assert_eq!(fast.speed_generation_ms, 10_000);
        assert_eq!(fast.est_speed_output_tokens, 0);

        let slow = stats.iter().find(|s| s.model == "slow").expect("slow");
        assert!((slow.success_rate - 100.0).abs() < f32::EPSILON);
        assert_eq!(slow.speed_output_tokens, 0);
        assert_eq!(slow.est_speed_output_tokens, 400);
        assert_eq!(slow.est_speed_duration_ms, 8_000);

        Ok(())
    }

    #[test]
    fn test_stats_first_token_median_only_counts_successful_proxy_streams() -> Result<(), AppError>
    {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            let insert = |id: &str,
                          provider: &str,
                          model: &str,
                          first: Option<i64>,
                          status: i64,
                          source: &str| {
                conn.execute(
                    "INSERT INTO proxy_request_logs (
                        request_id, provider_id, app_type, model,
                        input_tokens, output_tokens, total_cost_usd,
                        latency_ms, first_token_ms, status_code, created_at, data_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![
                        id,
                        provider,
                        "codex",
                        model,
                        10,
                        // 会话日志的用量和路由的一样会被当成重复记录滤掉，错开
                        if source == "proxy" { 500 } else { 777 },
                        "0",
                        20_000,
                        first,
                        status,
                        1000,
                        source
                    ],
                )
            };
            // p1 / m1：奇数个样本取中间那个，长尾不拉高
            insert("a", "p1", "m1", Some(1_000), 200, "proxy")?;
            insert("b", "p1", "m1", Some(2_000), 200, "proxy")?;
            insert("c", "p1", "m1", Some(15_000), 200, "proxy")?;
            // 不计：失败、非流式、会话日志
            insert("err", "p1", "m1", Some(100), 500, "proxy")?;
            insert("non-stream", "p1", "m1", None, 200, "proxy")?;
            insert("session", "p1", "m1", Some(50), 200, "codex_session")?;
            // 会话日志推出来的首字：单独取中位数
            insert("est-a", "p1", "m1", Some(3_000), 200, "codex_session")?;
            // p2 / m2：偶数个样本取中间两个的平均
            insert("d", "p2", "m2", Some(1_000), 200, "proxy")?;
            insert("e", "p2", "m2", Some(3_000), 200, "proxy")?;
            // p3 / m3：没有可计的请求
            insert("f", "p3", "m3", None, 200, "proxy")?;
        }

        let providers = db.get_provider_stats(None, None, None, None, None)?;
        let median_of = |id: &str| {
            providers
                .iter()
                .find(|s| s.provider_id == id)
                .expect(id)
                .first_token_median_ms
        };
        assert_eq!(median_of("p1"), Some(2_000));
        assert_eq!(median_of("p2"), Some(2_000));
        assert_eq!(median_of("p3"), None);
        let p1 = providers.iter().find(|s| s.provider_id == "p1").unwrap();
        // 会话日志两条：50 和 3000
        assert_eq!(p1.est_first_token_median_ms, Some(1_525));
        // 会话日志推出来的首字不算精确速度：进速度的只有路由的 a、b、c、err 四条
        assert_eq!(p1.speed_output_tokens, 2_000);

        let models = db.get_model_stats(None, None, None, None, None)?;
        let median_of = |m: &str| {
            models
                .iter()
                .find(|s| s.model == m)
                .expect(m)
                .first_token_median_ms
        };
        assert_eq!(median_of("m1"), Some(2_000));
        assert_eq!(median_of("m2"), Some(2_000));
        assert_eq!(median_of("m3"), None);

        // 带筛选条件时 WHERE 要接上，不能拼出两个 WHERE
        let filtered = db.get_provider_stats(None, None, Some("codex"), None, Some("m2"))?;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].first_token_median_ms, Some(2_000));

        Ok(())
    }

    #[test]
    fn test_get_provider_stats_with_time_filter() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params!["old", "p1", "claude", "claude-3", 100, 50, "0.01", 100, 200, 1000],
            )?;
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params!["new", "p1", "claude", "claude-3", 200, 75, "0.02", 120, 200, 2000],
            )?;
        }

        let stats = db.get_provider_stats(Some(1500), Some(2500), Some("claude"), None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].provider_id, "p1");
        assert_eq!(stats[0].app_type, "claude");
        assert_eq!(stats[0].request_count, 1);
        assert_eq!(stats[0].total_tokens, 275);

        Ok(())
    }

    #[test]
    fn test_get_provider_stats_preserves_app_type_identity_across_apps() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config) VALUES (?, ?, ?, '{}')",
                params!["shared-p1", "claude", "Shared Provider"],
            )?;
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config) VALUES (?, ?, ?, '{}')",
                params!["shared-p1", "claude-desktop", "Shared Provider"],
            )?;

            // Detail log under claude
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "req-1",
                    "shared-p1",
                    "claude",
                    "m1",
                    100,
                    50,
                    "0.01",
                    100,
                    200,
                    1000
                ],
            )?;

            // Rollup under claude-desktop
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, input_tokens, output_tokens,
                    cache_creation_tokens, cache_read_tokens, total_cost_usd,
                    success_count, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2026-10-08",
                    "claude-desktop",
                    "shared-p1",
                    "m1",
                    10,
                    1000,
                    500,
                    0,
                    0,
                    "0.10",
                    10,
                    120
                ],
            )?;
        }

        // Folded query for "claude" matches both claude and claude-desktop
        let stats = db.get_provider_stats(None, None, Some("claude"), None, None)?;
        assert_eq!(stats.len(), 2);

        let claude_stat = stats
            .iter()
            .find(|s| s.app_type == "claude")
            .expect("claude stat");
        assert_eq!(claude_stat.provider_id, "shared-p1");
        assert_eq!(claude_stat.provider_name, "Shared Provider");
        assert_eq!(claude_stat.request_count, 1);

        let desktop_stat = stats
            .iter()
            .find(|s| s.app_type == "claude-desktop")
            .expect("claude-desktop stat");
        assert_eq!(desktop_stat.provider_id, "shared-p1");
        assert_eq!(desktop_stat.provider_name, "Shared Provider");
        assert_eq!(desktop_stat.request_count, 10);

        Ok(())
    }

    #[test]
    fn test_get_provider_stats_labels_opencode_session_provider() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            insert_usage_log(
                &conn,
                "opencode-session",
                "opencode",
                "_opencode_session",
                "opencode-model",
                "opencode_session",
                1000,
                100,
                50,
                0,
                0,
                200,
                "0.01",
            )?;
        }

        let stats = db.get_provider_stats(None, None, Some("opencode"), None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].provider_id, "_opencode_session");
        assert_eq!(stats[0].provider_name, "OpenCode (Session)");

        Ok(())
    }

    #[test]
    fn test_get_provider_stats_excludes_partial_rollup_boundary_days() -> Result<(), AppError> {
        let db = Database::memory()?;
        let start = local_ts(2024, 2, 1, 12, 0, 0);
        let end = local_ts(2024, 2, 3, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-02-01",
                    "claude",
                    "p-rollup",
                    "claude-3",
                    5,
                    5,
                    500,
                    250,
                    0,
                    0,
                    "0.50",
                    100
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-02-02",
                    "claude",
                    "p-rollup",
                    "claude-3",
                    8,
                    7,
                    800,
                    400,
                    0,
                    0,
                    "0.80",
                    120
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-02-03",
                    "claude",
                    "p-rollup",
                    "claude-3",
                    12,
                    11,
                    1200,
                    600,
                    0,
                    0,
                    "1.20",
                    140
                ],
            )?;
        }

        let stats = db.get_provider_stats(Some(start), Some(end), Some("claude"), None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].provider_id, "p-rollup");
        assert_eq!(stats[0].request_count, 8);
        assert_eq!(stats[0].total_tokens, 1200);

        Ok(())
    }

    #[test]
    fn test_get_daily_trends_respects_shorter_than_24_hours() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "req-short",
                    "p1",
                    "claude",
                    "claude-3",
                    100,
                    50,
                    "0.01",
                    100,
                    200,
                    10_800
                ],
            )?;
        }

        let stats = db.get_daily_trends(Some(0), Some(15 * 60 * 60), Some("claude"), None, None)?;
        assert_eq!(stats.len(), 15);
        assert_eq!(stats[3].request_count, 1);

        Ok(())
    }

    #[test]
    fn test_get_daily_trends_groups_ranges_longer_than_24_hours_by_local_day(
    ) -> Result<(), AppError> {
        let db = Database::memory()?;
        let start = local_ts(2024, 3, 1, 12, 0, 0);
        let end = local_ts(2024, 3, 3, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "day-1-detail",
                    "p1",
                    "claude",
                    "claude-3",
                    100,
                    50,
                    "0.01",
                    100,
                    200,
                    local_ts(2024, 3, 1, 13, 0, 0)
                ],
            )?;
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "day-3-detail",
                    "p1",
                    "claude",
                    "claude-3",
                    200,
                    75,
                    "0.02",
                    110,
                    200,
                    local_ts(2024, 3, 3, 10, 0, 0)
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-03-02",
                    "claude",
                    "p1",
                    "claude-3",
                    4,
                    4,
                    400,
                    200,
                    0,
                    0,
                    "0.40",
                    120
                ],
            )?;
        }

        let stats = db.get_daily_trends(Some(start), Some(end), Some("claude"), None, None)?;
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].request_count, 1);
        assert_eq!(stats[0].total_tokens, 150);
        assert_eq!(stats[1].request_count, 4);
        assert_eq!(stats[1].total_tokens, 600);
        assert_eq!(stats[2].request_count, 1);
        assert_eq!(stats[2].total_tokens, 275);

        Ok(())
    }

    #[test]
    fn test_provider_and_model_stats_tokens_sum_to_summary_real_total() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            // Claude：input 不含缓存。真实消耗 = 100 + 200 + 1000 + 5000
            insert_usage_log(
                &conn,
                "claude-1",
                "claude",
                "p-claude",
                "claude-x",
                "session_log",
                1000,
                100,
                200,
                5000,
                1000,
                200,
                "0.10",
            )?;
            // Codex：input 已含缓存命中 600。真实消耗 = (1000 - 600) + 50 + 600
            insert_usage_log(
                &conn,
                "codex-1",
                "codex",
                "p-codex",
                "gpt-x",
                "codex_session",
                1000,
                1000,
                50,
                600,
                0,
                200,
                "0.05",
            )?;
            // 日汇总行同样要带上缓存。真实消耗 = (900 - 300) + 40 + 300 + 0
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2020-01-01",
                    "codex",
                    "p-codex",
                    "gpt-x",
                    3,
                    3,
                    900,
                    40,
                    300,
                    0,
                    "0.30",
                    100
                ],
            )?;
        }

        let summary = db.get_usage_summary(None, None, None, None, None)?;
        assert_eq!(summary.real_total_tokens, 6300 + 1050 + 940);

        let providers = db.get_provider_stats(None, None, None, None, None)?;
        let tokens_of = |id: &str| {
            providers
                .iter()
                .find(|s| s.provider_id == id)
                .map(|s| s.total_tokens)
        };
        assert_eq!(tokens_of("p-claude"), Some(6300));
        assert_eq!(tokens_of("p-codex"), Some(1050 + 940));
        let provider_sum: u64 = providers.iter().map(|s| s.total_tokens).sum();
        assert_eq!(provider_sum, summary.real_total_tokens);

        let models = db.get_model_stats(None, None, None, None, None)?;
        let model_sum: u64 = models.iter().map(|s| s.total_tokens).sum();
        assert_eq!(model_sum, summary.real_total_tokens);

        Ok(())
    }

    #[test]
    fn test_get_model_stats_excludes_partial_rollup_boundary_days() -> Result<(), AppError> {
        let db = Database::memory()?;
        let start = local_ts(2024, 4, 1, 12, 0, 0);
        let end = local_ts(2024, 4, 3, 12, 0, 0);

        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-04-01",
                    "claude",
                    "p1",
                    "claude-3-haiku",
                    6,
                    6,
                    600,
                    300,
                    0,
                    0,
                    "0.60",
                    100
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-04-02",
                    "claude",
                    "p1",
                    "claude-3-haiku",
                    9,
                    8,
                    900,
                    450,
                    0,
                    0,
                    "0.90",
                    110
                ],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model,
                    request_count, success_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "2024-04-03",
                    "claude",
                    "p1",
                    "claude-3-haiku",
                    12,
                    11,
                    1200,
                    600,
                    0,
                    0,
                    "1.20",
                    130
                ],
            )?;
        }

        let stats = db.get_model_stats(Some(start), Some(end), Some("claude"), None, None)?;
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].model, "claude-3-haiku");
        assert_eq!(stats[0].request_count, 9);
        assert_eq!(stats[0].total_tokens, 1350);

        Ok(())
    }

    #[test]
    fn test_get_session_usage_summary_counts_only_session_log_rows() -> Result<(), AppError> {
        let db = Database::memory()?;

        {
            let conn = lock_conn!(db.conn);
            // (request_id, app_type, session_id, data_source, input, output, cache_read, cost)
            let rows = [
                (
                    "s1",
                    "claude",
                    "sess-a",
                    "session_log",
                    10,
                    200,
                    5000,
                    "0.10",
                ),
                (
                    "s2",
                    "claude-desktop",
                    "sess-a",
                    "session_log",
                    20,
                    300,
                    7000,
                    "0.20",
                ),
                // 代理行即便会话 ID 相同也不数，避免与会话日志重复
                ("p1", "claude", "sess-a", "proxy", 10, 200, 5000, "0.10"),
                ("s3", "claude", "sess-b", "session_log", 1, 1, 1, "9.00"),
                ("s4", "codex", "sess-a", "codex_session", 1, 1, 0, "9.00"),
            ];
            for (id, app, session, source, input, output, cache_read, cost) in rows {
                conn.execute(
                    "INSERT INTO proxy_request_logs (
                        request_id, provider_id, app_type, model,
                        input_tokens, output_tokens, cache_read_tokens, total_cost_usd,
                        latency_ms, status_code, created_at, session_id, data_source
                    ) VALUES (?, 'p1', ?, 'claude-x', ?, ?, ?, ?, 0, 200, 1000, ?, ?)",
                    params![id, app, input, output, cache_read, cost, session, source],
                )?;
            }
        }

        let summary = db.get_session_usage_summary("claude", "sess-a")?;
        assert_eq!(summary.total_requests, 2);
        assert_eq!(summary.real_total_tokens, 10 + 200 + 5000 + 20 + 300 + 7000);
        assert_eq!(summary.total_cost, "0.300000");

        let empty = db.get_session_usage_summary("claude", "missing")?;
        assert_eq!(empty.total_requests, 0);

        Ok(())
    }
}
