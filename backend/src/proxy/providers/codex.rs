//! Codex (OpenAI) Provider Adapter
//!
//! 仅透传模式，支持直连 OpenAI API
//!
//! ## 客户端检测
//! 支持检测官方 Codex 客户端 (codex_vscode, codex_cli_rs)

use super::{AuthInfo, AuthStrategy, ProviderAdapter};
use crate::provider::{CodexChatReasoningConfig, Provider};
use crate::proxy::error::ProxyError;
use serde_json::Value as JsonValue;
use toml::Value as TomlValue;

/// Codex 适配器
pub struct CodexAdapter;

/// 只有固定的内置官方条目可以复用 Codex 客户端携带的 ChatGPT 登录。
pub fn is_codex_official_provider(provider: &Provider) -> bool {
    provider.id == crate::database::CODEX_OFFICIAL_PROVIDER_ID
        && provider.category.as_deref() == Some("official")
}

// ---------------------------------------------------------------------------
// Codex Chat Completions 路由判定（跟随上游 cc-switch 1c82b8a3）
//
// Codex 客户端原生只和 OpenAI Responses API 协议对话，但很多第三方"Codex
// 兼容"供应商实际只暴露 OpenAI Chat Completions。让代理在中间做协议转换：
// 客户端 → Responses → 代理 → Chat Completions → 上游 → Chat → 代理 → Responses → 客户端。
//
// 是否需要做协议转换的四层 fallback 判定（顺序自顶向下）：
//   1. provider.meta.api_format == "openai_chat"
//   2. settings_config.api_format / apiFormat 字段
//   3. settings_config.config (TOML) 里的 wire_api 字段
//   4. base_url / settings_config.config 里的 base_url 是否以 /chat/completions 结尾
// ---------------------------------------------------------------------------

/// 该 Codex provider 的真实上游是否走 OpenAI Chat Completions，
/// 即使本地 Codex 客户端通过 Responses 协议跟 CC Switch 对话。
pub fn codex_provider_uses_chat_completions(provider: &Provider) -> bool {
    if let Some(api_format) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.api_format.as_deref())
        .or_else(|| {
            provider
                .settings_config
                .get("api_format")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            provider
                .settings_config
                .get("apiFormat")
                .and_then(|v| v.as_str())
        })
    {
        return is_chat_wire_api(api_format);
    }

    if let Some(wire_api) = provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .and_then(extract_codex_wire_api_from_toml)
    {
        return is_chat_wire_api(&wire_api);
    }

    if let Some(base_url) = provider
        .settings_config
        .get("base_url")
        .or_else(|| provider.settings_config.get("baseURL"))
        .and_then(|v| v.as_str())
    {
        return is_chat_completions_url(base_url);
    }

    provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .and_then(extract_codex_base_url_from_toml)
        .map(|url| is_chat_completions_url(&url))
        .unwrap_or(false)
}

/// 判断当前 Codex 请求是否需要做 Responses→Chat 转换：
/// 路径必须是 Responses 端点，且 provider 走 Chat Completions。
pub fn should_convert_codex_responses_to_chat(provider: &Provider, endpoint: &str) -> bool {
    let path = endpoint
        .split_once('?')
        .map_or(endpoint, |(path, _query)| path);

    matches!(
        path,
        "/responses" | "/v1/responses" | "/responses/compact" | "/v1/responses/compact"
    ) && codex_provider_uses_chat_completions(provider)
}

/// 只有明确支持的上游才发送 `prompt_cache_key`；未知兼容网关默认关闭。
pub fn should_send_codex_chat_prompt_cache_key(provider: &Provider) -> bool {
    match provider
        .meta
        .as_ref()
        .and_then(|meta| meta.prompt_cache_routing.as_deref())
        .unwrap_or("auto")
    {
        "enabled" => return true,
        "disabled" => return false,
        _ => {}
    }

    let base_url = provider
        .settings_config
        .get("base_url")
        .or_else(|| provider.settings_config.get("baseURL"))
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(|value| value.as_str())
                .and_then(extract_codex_base_url_from_toml)
        });
    let Some(base_url) = base_url else {
        return false;
    };
    let Ok(url) = url::Url::parse(&base_url) else {
        return false;
    };

    match url.host_str() {
        Some("api.openai.com") => true,
        Some("api.kimi.com") => {
            let path = url.path().trim_end_matches('/');
            path == "/coding" || path.starts_with("/coding/")
        }
        _ => false,
    }
}

/// Responses → Chat 后注入稳定缓存路由键；显式键优先于客户端会话 ID。
pub fn inject_codex_chat_prompt_cache_key(
    provider: &Provider,
    chat_body: &mut JsonValue,
    explicit_key: Option<&str>,
    client_session_id: Option<&str>,
) -> bool {
    if !should_send_codex_chat_prompt_cache_key(provider) {
        return false;
    }

    let key = explicit_key
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .or_else(|| {
            client_session_id
                .map(str::trim)
                .filter(|session_id| !session_id.is_empty())
        });
    let Some(key) = key else {
        return false;
    };

    chat_body["prompt_cache_key"] = JsonValue::String(key.to_string());
    true
}

/// Codex 供应商是否显式声明原生 Anthropic Messages 上游。
pub fn codex_provider_uses_anthropic(provider: &Provider) -> bool {
    if let Some(api_format) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.api_format.as_deref())
        .or_else(|| {
            provider
                .settings_config
                .get("api_format")
                .and_then(|value| value.as_str())
        })
        .or_else(|| {
            provider
                .settings_config
                .get("apiFormat")
                .and_then(|value| value.as_str())
        })
    {
        return is_anthropic_wire_api(api_format);
    }

    provider
        .settings_config
        .get("config")
        .and_then(|value| value.as_str())
        .and_then(extract_codex_wire_api_from_toml)
        .map(|wire_api| is_anthropic_wire_api(&wire_api))
        .unwrap_or(false)
}

pub fn should_convert_codex_responses_to_anthropic(provider: &Provider, endpoint: &str) -> bool {
    let path = endpoint
        .split_once('?')
        .map_or(endpoint, |(path, _query)| path);

    matches!(
        path,
        "/responses" | "/v1/responses" | "/responses/compact" | "/v1/responses/compact"
    ) && codex_provider_uses_anthropic(provider)
}

/// 原生 Responses 上游是否需要展开 Codex 私有 namespace 工具。
pub fn provider_needs_responses_namespace_flatten(provider: &Provider) -> bool {
    provider.is_xai_oauth()
}

/// 使用与代理路由相同的判定生成 Codex model catalog，避免目录声明的工具形态
/// 与实际转换协议不一致。
pub fn resolve_codex_catalog_tool_profile(
    provider: &Provider,
) -> crate::codex_config::CodexCatalogToolProfile {
    use crate::codex_config::CodexCatalogToolProfile;

    if is_codex_official_provider(provider) || provider.is_xai_oauth() {
        return CodexCatalogToolProfile::NativeResponses;
    }
    if codex_provider_uses_anthropic(provider) {
        return CodexCatalogToolProfile::Anthropic;
    }
    CodexCatalogToolProfile::from_api_format(
        provider
            .meta
            .as_ref()
            .and_then(|meta| meta.api_format.as_deref()),
    )
}

/// 提取 Codex 供应商实际使用的上游模型。
pub fn codex_provider_upstream_model(provider: &Provider) -> Option<String> {
    provider
        .settings_config
        .get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(|value| value.as_str())
                .and_then(|config| {
                    crate::grok_config::extract_model_config(config)
                        .map(|model| model.model)
                        .or_else(|| extract_codex_model_from_toml(config))
                })
        })
}

/// Chat 协议转换前，把 Codex 客户端兼容模型替换为供应商真实模型。
pub fn apply_codex_chat_upstream_model(
    provider: &Provider,
    body: &mut JsonValue,
) -> Option<String> {
    if !codex_provider_uses_chat_completions(provider) {
        return None;
    }
    apply_codex_upstream_model(provider, body)
}

/// 已经确认协议类型时复用同一模型替换逻辑（如 Anthropic bridge）。
pub fn apply_codex_upstream_model(provider: &Provider, body: &mut JsonValue) -> Option<String> {
    let upstream_model = codex_provider_upstream_model(provider)?;
    body["model"] = JsonValue::String(upstream_model.clone());
    Some(upstream_model)
}

pub fn resolve_codex_chat_reasoning_config(
    provider: &Provider,
    body: &JsonValue,
) -> Option<CodexChatReasoningConfig> {
    let mut config = if let Some(config) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.codex_chat_reasoning.clone())
    {
        normalize_codex_chat_reasoning_config(config)
    } else {
        infer_codex_chat_reasoning_config(provider, body)?
    };

    // zen 的合法 effort 档位是逐模型的（models.dev：glm-5.2 仅 high|max、
    // kimi-k3 仅 max、qwen/glm-5.1 等为 toggle 型无 effort），opencode 客户端
    // 也严格按模型声明发值。按请求模型从 modelCatalog 的 reasoningLevels
    // （#6228 引入的逐模型声明）查表附上；查不到（模型未收录 / 条目未声明
    // effort）→ None，转换层将完全不发 reasoning_effort。
    if config.effort_value_mode.as_deref() == Some("zen") {
        config.effort_levels = zen_catalog_effort_levels(provider, body);
    }

    Some(config)
}

/// 按请求模型从供应商 modelCatalog 查 Zen 合法 effort 档位（逐模型数据镜像
/// models.dev 的 reasoning_options effort values）。仅做档位查表，不参与平台
/// 判定——平台身份仍只由 name/base_url 决定（见 infer_aggregator_platform_config）。
/// DB SSOT 为 camelCase，手写/旧数据可能为 snake_case，双格式兼容（与表单加载侧一致）。
fn zen_catalog_effort_levels(provider: &Provider, body: &JsonValue) -> Option<Vec<String>> {
    let model = body.get("model")?.as_str()?.trim();
    if model.is_empty() {
        return None;
    }
    let entries = provider
        .settings_config
        .get("modelCatalog")?
        .get("models")?
        .as_array()?;
    let entry = entries.iter().find(|entry| {
        entry
            .get("model")
            .and_then(|value| value.as_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(model))
    })?;
    let levels_value = entry
        .get("reasoningLevels")
        .or_else(|| entry.get("reasoning_levels"))?;
    let levels: Vec<String> = levels_value
        .as_array()?
        .iter()
        .filter_map(|level| level.as_str().map(str::to_string))
        .collect();
    (!levels.is_empty()).then_some(levels)
}

fn normalize_codex_chat_reasoning_config(
    mut config: CodexChatReasoningConfig,
) -> CodexChatReasoningConfig {
    if config.supports_effort.unwrap_or(false) && config.supports_thinking.is_none() {
        config.supports_thinking = Some(true);
    }
    config
}

fn infer_codex_chat_reasoning_config(
    provider: &Provider,
    body: &JsonValue,
) -> Option<CodexChatReasoningConfig> {
    let model = body
        .get("model")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| codex_provider_upstream_model(provider))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let base_url = provider
        .settings_config
        .get("base_url")
        .or_else(|| provider.settings_config.get("baseURL"))
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
        .or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(|v| v.as_str())
                .and_then(extract_codex_base_url_from_toml)
        })
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = provider.name.to_ascii_lowercase();

    // 平台优先：聚合 / 托管平台的 reasoning 接口由平台的推理框架决定，而非模型官方实现，
    // 因此先按平台标识（仅 name + base_url，不含 model 名）判定并覆盖模型规则。
    if let Some(config) = infer_aggregator_platform_config(&name, &base_url) {
        return Some(config);
    }

    let haystack = format!("{name} {base_url} {model}");

    if haystack.contains("deepseek") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(true),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("reasoning_effort".to_string()),
            effort_value_mode: Some("deepseek".to_string()),
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    // StepFun：step-3.5-flash-2603 支持 low/high；step-3.7-flash 支持
    // low/medium/high。3.7 必须透传，否则 medium 会被 low_high 映射压成 high。
    // 第二个 OR 分支覆盖「经中转/聚合跑该模型、但平台 name/base_url 不含 stepfun」的情况。
    if haystack.contains("stepfun") || haystack.contains("step-3.5-flash-2603") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(model.contains("2603") || model.contains("step-3.7-flash")),
            thinking_param: Some("none".to_string()),
            effort_param: Some("reasoning_effort".to_string()),
            effort_value_mode: Some(
                if model.contains("2603") {
                    "low_high"
                } else {
                    "passthrough"
                }
                .to_string(),
            ),
            output_format: Some("reasoning".to_string()),
            effort_levels: None,
        });
    }

    if haystack.contains("kimi") || haystack.contains("moonshot") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    if haystack.contains("glm") || haystack.contains("zhipu") || haystack.contains("z.ai") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    if haystack.contains("qwen") || haystack.contains("dashscope") || haystack.contains("bailian") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("enable_thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    if haystack.contains("minimax") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("reasoning_split".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_details".to_string()),
            effort_levels: None,
        });
    }

    if haystack.contains("mimo") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    None
}

/// 聚合 / 托管平台的 reasoning 接口由平台决定：同一个模型在不同平台参数可能完全不同
/// （DeepSeek 官方用 `thinking:{type}`、SiliconFlow 用 `enable_thinking`、
/// OpenRouter 用原生 `reasoning:{effort}` 对象）。仅以平台标识（name / base_url）判定，
/// 绝不掺入 model 名——model 名属于模型厂商，会把托管平台误判成模型官方接口。
fn infer_aggregator_platform_config(
    name: &str,
    base_url: &str,
) -> Option<CodexChatReasoningConfig> {
    let platform = format!("{name} {base_url}");

    // OpenRouter：用原生归一化对象 `reasoning: { effort }`（由 OpenRouter 翻译成各底层
    // 模型的正确推理参数，比顶层 OpenAI 别名 reasoning_effort 覆盖面更全）。effort 走
    // "openrouter" 值映射：枚举为 xhigh|high|medium|low|minimal，无 max——max 会触发
    // `400 reasoning_effort: Invalid option`（见 openclaw#77350），故钳到 xhigh。
    // 安全降级：不发 `thinking:{type}`（OpenRouter 不认该字段），避免误配导致请求被拒。
    if platform.contains("openrouter") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(false),
            supports_effort: Some(true),
            thinking_param: Some("none".to_string()),
            effort_param: Some("reasoning.effort".to_string()),
            effort_value_mode: Some("openrouter".to_string()),
            output_format: Some("auto".to_string()),
            effort_levels: None,
        });
    }

    // SiliconFlow：平台级统一 `enable_thinking`，思维回传 reasoning_content。
    // 安全降级：不按 reasoning_effort 发 effort（平台用 thinking_budget 控制深度，
    // 发 reasoning_effort 反而可能不被接受）。
    if platform.contains("siliconflow") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("enable_thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    // ModelScope 与 SiliconFlow 同样使用平台级 enable_thinking；不能因为
    // 托管的是 GLM 模型而误发智谱官方端点的 thinking:{type} 方言。
    if platform.contains("modelscope") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("enable_thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    // OpenCode Zen（opencode.ai 网关，issue #6112）：其自家客户端对该传输发顶层
    // `reasoning_effort`（provider/transform.ts），平台归一参数；不发厂商原生
    // thinking 形状（glm 模型走 zen 时套智谱 thinking:{type} 网关不认）。
    // 合法档位逐模型（models.dev 的 reasoning_options，opencode 客户端同样严格
    // 按模型声明发值）：具体档位表见供应商 modelCatalog 各条目的 reasoningLevels，
    // 代理由此按请求模型查表钳制（resolve 处附上 effort_levels），无表不发字段。
    // 匹配域名而非裸 "opencode"，避免误伤名字含 opencode 的无关供应商。
    if platform.contains("opencode.ai") {
        return Some(CodexChatReasoningConfig {
            supports_thinking: Some(true),
            supports_effort: Some(true),
            thinking_param: Some("none".to_string()),
            effort_param: Some("reasoning_effort".to_string()),
            effort_value_mode: Some("zen".to_string()),
            output_format: Some("reasoning_content".to_string()),
            effort_levels: None,
        });
    }

    None
}

fn is_chat_wire_api(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "chat"
            | "chat_completions"
            | "chat-completions"
            | "openai_chat"
            | "openai-chat"
            | "openai_chat_completions"
    )
}

fn is_anthropic_wire_api(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "anthropic" | "anthropic_messages" | "anthropic-messages" | "claude" | "messages"
    )
}

fn is_chat_completions_url(value: &str) -> bool {
    value
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .ends_with("/chat/completions")
}

fn extract_codex_wire_api_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    if let Some(active_provider) = doc.get("model_provider").and_then(|v| v.as_str()) {
        if let Some(wire_api) = doc
            .get("model_providers")
            .and_then(|providers| providers.get(active_provider))
            .and_then(|provider| provider.get("wire_api"))
            .and_then(|v| v.as_str())
        {
            return Some(wire_api.to_string());
        }
    }

    doc.get("wire_api")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn extract_codex_model_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    doc.get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToString::to_string)
}

fn extract_codex_base_url_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    if let Some(active_provider) = doc.get("model_provider").and_then(|v| v.as_str()) {
        if let Some(base_url) = doc
            .get("model_providers")
            .and_then(|providers| providers.get(active_provider))
            .and_then(|provider| provider.get("base_url"))
            .and_then(|v| v.as_str())
        {
            return Some(base_url.to_string());
        }
    }

    doc.get("base_url")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }

    /// 从 Provider 配置中提取 API Key
    fn extract_key(&self, provider: &Provider) -> Option<String> {
        // 1. 尝试从 env 中获取
        if let Some(env) = provider.settings_config.get("env") {
            if let Some(key) = env.get("OPENAI_API_KEY").and_then(|v| v.as_str()) {
                return Some(key.to_string());
            }
        }

        // 2. 尝试从 auth 中获取 (Codex CLI 格式)
        if let Some(auth) = provider.settings_config.get("auth") {
            if let Some(key) = auth.get("OPENAI_API_KEY").and_then(|v| v.as_str()) {
                return Some(key.to_string());
            }
        }

        // 3. 尝试直接获取
        if let Some(key) = provider
            .settings_config
            .get("apiKey")
            .or_else(|| provider.settings_config.get("api_key"))
            .and_then(|v| v.as_str())
        {
            return Some(key.to_string());
        }

        // 4. 尝试从 config 对象中获取
        if let Some(config) = provider.settings_config.get("config") {
            if let Some(key) = config
                .get("api_key")
                .or_else(|| config.get("apiKey"))
                .and_then(|v| v.as_str())
            {
                return Some(key.to_string());
            }
            if let Some(config_str) = config.as_str() {
                if let Some((_, key)) = crate::grok_config::extract_credentials(config_str) {
                    return Some(key);
                }
            }
        }

        None
    }
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderAdapter for CodexAdapter {
    fn name(&self) -> &'static str {
        "Codex"
    }

    fn extract_base_url(&self, provider: &Provider) -> Result<String, ProxyError> {
        if is_codex_official_provider(provider) {
            return Ok(super::CHATGPT_CODEX_BASE_URL.to_string());
        }

        if provider.is_xai_oauth() {
            return Ok(super::XAI_API_BASE_URL.to_string());
        }

        // 1. 尝试直接获取 base_url 字段
        if let Some(url) = provider
            .settings_config
            .get("base_url")
            .and_then(|v| v.as_str())
        {
            return Ok(url.trim_end_matches('/').to_string());
        }

        // 2. 尝试 baseURL
        if let Some(url) = provider
            .settings_config
            .get("baseURL")
            .and_then(|v| v.as_str())
        {
            return Ok(url.trim_end_matches('/').to_string());
        }

        // 3. 尝试从 config 对象中获取
        if let Some(config) = provider.settings_config.get("config") {
            if let Some(url) = config.get("base_url").and_then(|v| v.as_str()) {
                return Ok(url.trim_end_matches('/').to_string());
            }

            // 尝试解析 TOML 字符串格式
            if let Some(config_str) = config.as_str() {
                if let Some(url) = crate::grok_config::extract_base_url(config_str) {
                    return Ok(url);
                }
                if let Some(start) = config_str.find("base_url = \"") {
                    let rest = &config_str[start + 12..];
                    if let Some(end) = rest.find('"') {
                        return Ok(rest[..end].trim_end_matches('/').to_string());
                    }
                }
                if let Some(start) = config_str.find("base_url = '") {
                    let rest = &config_str[start + 12..];
                    if let Some(end) = rest.find('\'') {
                        return Ok(rest[..end].trim_end_matches('/').to_string());
                    }
                }
            }
        }

        Err(ProxyError::ConfigError(
            "Codex Provider 缺少 base_url 配置".to_string(),
        ))
    }

    fn extract_auth(&self, provider: &Provider) -> Option<AuthInfo> {
        if provider.is_xai_oauth() {
            return Some(AuthInfo::new(
                "xai_oauth_placeholder".to_string(),
                AuthStrategy::XaiOAuth,
            ));
        }

        let strategy = if codex_provider_uses_anthropic(provider)
            && provider
                .meta
                .as_ref()
                .and_then(|meta| meta.api_key_field.as_deref())
                .is_some_and(|field| field.eq_ignore_ascii_case("ANTHROPIC_API_KEY"))
        {
            AuthStrategy::Anthropic
        } else {
            AuthStrategy::Bearer
        };
        self.extract_key(provider)
            .map(|key| AuthInfo::new(key, strategy))
    }

    fn build_url(&self, base_url: &str, endpoint: &str) -> String {
        let base_trimmed = base_url.trim_end_matches('/');
        let endpoint_trimmed = endpoint.trim_start_matches('/');

        // OpenAI/Codex 的 base_url 可能是：
        // - 纯 origin: https://api.openai.com  (需要自动补 /v1)
        // - 已含 /v1: https://api.openai.com/v1 (直接拼接)
        // - 自定义前缀: https://xxx/openai (不添加 /v1，直接拼接)

        // 检查 base_url 是否已经包含 /v1
        let already_has_v1 = base_trimmed.ends_with("/v1");

        // 检查是否是纯 origin（没有路径部分）
        let origin_only = match base_trimmed.split_once("://") {
            Some((_scheme, rest)) => !rest.contains('/'),
            None => !base_trimmed.contains('/'),
        };

        let mut url = if already_has_v1 {
            // 已经有 /v1，直接拼接
            format!("{base_trimmed}/{endpoint_trimmed}")
        } else if origin_only {
            // 纯 origin，添加 /v1
            format!("{base_trimmed}/v1/{endpoint_trimmed}")
        } else {
            // 自定义前缀，不添加 /v1，直接拼接
            format!("{base_trimmed}/{endpoint_trimmed}")
        };

        // 去除重复的 /v1/v1（可能由 base_url 与 endpoint 都带版本导致）
        while url.contains("/v1/v1") {
            url = url.replace("/v1/v1", "/v1");
        }

        url
    }

    fn get_auth_headers(&self, auth: &AuthInfo) -> Vec<(http::HeaderName, http::HeaderValue)> {
        if auth.strategy == AuthStrategy::Anthropic {
            return vec![(
                http::HeaderName::from_static("x-api-key"),
                http::HeaderValue::from_str(&auth.api_key).unwrap(),
            )];
        }
        let bearer = format!("Bearer {}", auth.api_key);
        vec![(
            http::HeaderName::from_static("authorization"),
            http::HeaderValue::from_str(&bearer).unwrap(),
        )]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;
    use serde_json::json;
    use std::sync::LazyLock;

    static CODEX_CLIENT_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(codex_vscode|codex_cli_rs)/[\d.]+").unwrap());

    fn is_official_client(user_agent: &str) -> bool {
        CODEX_CLIENT_REGEX.is_match(user_agent)
    }

    fn create_provider(config: serde_json::Value) -> Provider {
        Provider {
            id: "test".to_string(),
            name: "Test Codex".to_string(),
            settings_config: config,
            website_url: None,
            category: Some("codex".to_string()),
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        }
    }

    #[test]
    fn test_extract_base_url_direct() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "base_url": "https://api.openai.com/v1"
        }));

        let url = adapter.extract_base_url(&provider).unwrap();
        assert_eq!(url, "https://api.openai.com/v1");
    }

    #[test]
    fn test_extract_auth_from_auth_field() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {
                "OPENAI_API_KEY": "sk-test-key-12345678"
            }
        }));

        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "sk-test-key-12345678");
        assert_eq!(auth.strategy, AuthStrategy::Bearer);
    }

    #[test]
    fn test_extract_auth_from_env() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "env": {
                "OPENAI_API_KEY": "sk-env-key-12345678"
            }
        }));

        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "sk-env-key-12345678");
    }

    #[test]
    fn xai_oauth_invariants_ignore_editable_base_url_and_auth() {
        let adapter = CodexAdapter::new();
        let mut provider = create_provider(json!({
            "auth": { "OPENAI_API_KEY": "user-edited" },
            "config": "base_url = \"https://attacker.example/v1\"\nwire_api = \"responses\""
        }));
        provider.meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("xai_oauth".to_string()),
            ..Default::default()
        });

        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            super::super::XAI_API_BASE_URL
        );
        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "xai_oauth_placeholder");
        assert_eq!(auth.strategy, AuthStrategy::XaiOAuth);
    }

    #[test]
    fn namespace_flatten_gate_only_fires_for_xai_oauth() {
        let mut xai = create_provider(json!({ "auth": {}, "config": "" }));
        xai.meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("xai_oauth".to_string()),
            ..Default::default()
        });
        assert!(provider_needs_responses_namespace_flatten(&xai));

        let plain = create_provider(json!({
            "auth": { "OPENAI_API_KEY": "sk-x" },
            "config": "base_url = \"https://api.x.ai/v1\"\nwire_api = \"responses\""
        }));
        assert!(!provider_needs_responses_namespace_flatten(&plain));
    }

    #[test]
    fn grok_build_toml_exposes_upstream_connection() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "config": r#"[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "upstream-grok-model"
base_url = "https://relay.example.com/v1/"
name = "Example Relay"
api_key = "grok-secret"
api_backend = "responses"
context_window = 500000
"#
        }));

        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            "https://relay.example.com/v1"
        );
        assert_eq!(
            adapter.extract_auth(&provider).unwrap().api_key,
            "grok-secret"
        );
        assert_eq!(
            codex_provider_upstream_model(&provider).as_deref(),
            Some("upstream-grok-model")
        );
    }

    #[test]
    fn test_build_url() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://api.openai.com/v1", "/responses");
        assert_eq!(url, "https://api.openai.com/v1/responses");
    }

    #[test]
    fn test_build_url_origin_adds_v1() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://api.openai.com", "/responses");
        assert_eq!(url, "https://api.openai.com/v1/responses");
    }

    #[test]
    fn test_build_url_custom_prefix_no_v1() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://example.com/openai", "/responses");
        assert_eq!(url, "https://example.com/openai/responses");
    }

    #[test]
    fn test_build_url_dedup_v1() {
        let adapter = CodexAdapter::new();
        // base_url 已包含 /v1，endpoint 也包含 /v1
        let url = adapter.build_url("https://www.packyapi.com/v1", "/v1/responses");
        assert_eq!(url, "https://www.packyapi.com/v1/responses");
    }

    // 官方客户端检测测试
    #[test]
    fn test_is_official_client_vscode() {
        assert!(is_official_client("codex_vscode/1.0.0"));
        assert!(is_official_client("codex_vscode/2.3.4"));
        assert!(is_official_client("codex_vscode/0.1"));
    }

    #[test]
    fn test_is_official_client_cli() {
        assert!(is_official_client("codex_cli_rs/1.0.0"));
        assert!(is_official_client("codex_cli_rs/0.5.2"));
    }

    #[test]
    fn test_is_not_official_client() {
        assert!(!is_official_client("Mozilla/5.0"));
        assert!(!is_official_client("curl/7.68.0"));
        assert!(!is_official_client("python-requests/2.25.1"));
        assert!(!is_official_client("codex_other/1.0.0"));
        assert!(!is_official_client(""));
    }

    #[test]
    fn test_is_official_client_partial_match() {
        // 必须从开头匹配
        assert!(!is_official_client("some codex_vscode/1.0.0"));
        assert!(!is_official_client("prefix_codex_cli_rs/1.0.0"));
    }

    #[test]
    fn test_codex_provider_uses_chat_completions_from_active_wire_api() {
        let provider = create_provider(json!({
            "config": r#"
model_provider = "chat_only"
model = "gpt-5"

[model_providers.chat_only]
name = "Chat Only"
base_url = "https://example.com/v1"
wire_api = "chat"
"#
        }));

        assert!(codex_provider_uses_chat_completions(&provider));
        assert!(should_convert_codex_responses_to_chat(
            &provider,
            "/responses?stream=true"
        ));
        assert!(!should_convert_codex_responses_to_chat(
            &provider,
            "/chat/completions"
        ));
    }

    #[test]
    fn test_codex_provider_uses_chat_completions_from_full_chat_url() {
        let provider = create_provider(json!({
            "base_url": "https://example.com/v1/chat/completions"
        }));

        assert!(codex_provider_uses_chat_completions(&provider));
        assert!(should_convert_codex_responses_to_chat(
            &provider,
            "/v1/responses/compact"
        ));
    }

    #[test]
    fn test_codex_provider_uses_chat_completions_default_responses() {
        let provider = create_provider(json!({
            "base_url": "https://api.openai.com/v1"
        }));

        // 默认 Responses 端点不应误判
        assert!(!codex_provider_uses_chat_completions(&provider));
        assert!(!should_convert_codex_responses_to_chat(
            &provider,
            "/responses"
        ));
    }

    #[test]
    fn anthropic_bridge_requires_explicit_wire_format() {
        let anthropic = create_provider(json!({
            "apiFormat": "anthropic",
            "base_url": "https://example.com/v1/messages"
        }));
        let unknown = create_provider(json!({
            "base_url": "https://example.com/v1/messages"
        }));

        assert!(should_convert_codex_responses_to_anthropic(
            &anthropic,
            "/v1/responses?stream=true"
        ));
        assert!(!should_convert_codex_responses_to_anthropic(
            &unknown,
            "/v1/responses"
        ));
    }

    #[test]
    fn catalog_profile_uses_same_anthropic_detection_as_proxy() {
        let provider = create_provider(json!({
            "apiFormat": "anthropic",
            "base_url": "https://example.com/v1/messages"
        }));

        assert_eq!(
            resolve_codex_catalog_tool_profile(&provider),
            crate::codex_config::CodexCatalogToolProfile::Anthropic
        );
    }

    #[test]
    fn prompt_cache_key_uses_explicit_key_then_client_session() {
        let provider = create_provider(json!({
            "base_url": "https://api.openai.com/v1"
        }));
        let mut body = json!({});
        assert!(inject_codex_chat_prompt_cache_key(
            &provider,
            &mut body,
            Some("request-key"),
            Some("session-key")
        ));
        assert_eq!(body["prompt_cache_key"], "request-key");

        let mut body = json!({});
        assert!(inject_codex_chat_prompt_cache_key(
            &provider,
            &mut body,
            None,
            Some("session-key")
        ));
        assert_eq!(body["prompt_cache_key"], "session-key");
    }

    #[test]
    fn reasoning_config_prefers_platform_over_model_name() {
        let provider = create_provider(json!({
            "base_url": "https://openrouter.ai/api/v1",
            "model": "deepseek/deepseek-chat"
        }));
        let config =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "deepseek-chat"}))
                .unwrap();
        assert_eq!(config.effort_param.as_deref(), Some("reasoning.effort"));
        assert_eq!(config.thinking_param.as_deref(), Some("none"));
    }

    #[test]
    fn stepfun_reasoning_effort_is_resolved_per_model() {
        let provider = create_provider(json!({
            "base_url": "https://api.stepfun.com/step_plan/v1"
        }));

        let v37 =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "step-3.7-flash"}))
                .unwrap();
        assert_eq!(v37.supports_effort, Some(true));
        assert_eq!(v37.effort_value_mode.as_deref(), Some("passthrough"));

        let v35 = resolve_codex_chat_reasoning_config(
            &provider,
            &json!({"model": "step-3.5-flash-2603"}),
        )
        .unwrap();
        assert_eq!(v35.supports_effort, Some(true));
        assert_eq!(v35.effort_value_mode.as_deref(), Some("low_high"));

        let legacy =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "step-3.5-flash"}))
                .unwrap();
        assert_eq!(legacy.supports_effort, Some(false));
    }

    #[test]
    fn modelscope_platform_overrides_glm_vendor_dialect() {
        let provider = create_provider(json!({
            "base_url": "https://api-inference.modelscope.cn/v1"
        }));

        let config =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "ZhipuAI/GLM-5.2"}))
                .unwrap();
        assert_eq!(config.thinking_param.as_deref(), Some("enable_thinking"));
        assert_eq!(config.supports_effort, Some(false));
        assert_eq!(config.output_format.as_deref(), Some("reasoning_content"));
    }

    #[test]
    fn opencode_zen_uses_platform_dialect_and_model_levels() {
        let provider = create_provider(json!({
            "base_url": "https://opencode.ai/zen/go/v1",
            "modelCatalog": {
                "models": [
                    {"model": "glm-5.2", "reasoningLevels": ["high", "max"]},
                    {"model": "glm-5.1"}
                ]
            }
        }));

        let config =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "GLM-5.2"})).unwrap();
        assert_eq!(config.thinking_param.as_deref(), Some("none"));
        assert_eq!(config.effort_param.as_deref(), Some("reasoning_effort"));
        assert_eq!(config.effort_value_mode.as_deref(), Some("zen"));
        assert_eq!(
            config.effort_levels,
            Some(vec!["high".to_string(), "max".to_string()])
        );

        let toggle =
            resolve_codex_chat_reasoning_config(&provider, &json!({"model": "glm-5.1"})).unwrap();
        assert!(toggle.effort_levels.is_none());
    }

    #[test]
    fn official_provider_uses_fixed_chatgpt_backend_without_stored_key() {
        let mut provider = create_provider(json!({ "auth": {}, "config": "" }));
        provider.id = crate::database::CODEX_OFFICIAL_PROVIDER_ID.to_string();
        provider.category = Some("official".to_string());
        let adapter = CodexAdapter::new();

        assert!(is_codex_official_provider(&provider));
        assert_eq!(
            adapter.extract_base_url(&provider).expect("official URL"),
            crate::proxy::providers::CHATGPT_CODEX_BASE_URL
        );
        assert!(adapter.extract_auth(&provider).is_none());
    }
}
