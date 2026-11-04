//! 代理服务相关命令
//!
//! 提供本地 Web API 复用的命令入口。

use crate::error::AppError;
use crate::proxy::circuit_breaker::CircuitBreakerConfig;
use crate::proxy::types::*;
use crate::store::AppState;
use crate::{app_config::AppType, mode::controller};
use std::str::FromStr;

fn circuit_breaker_config_from_app(config: &AppProxyConfig) -> CircuitBreakerConfig {
    CircuitBreakerConfig {
        failure_threshold: config.circuit_failure_threshold,
        success_threshold: config.circuit_success_threshold,
        timeout_seconds: config.circuit_timeout_seconds as u64,
        error_rate_threshold: config.circuit_error_rate_threshold,
        min_requests: config.circuit_min_requests,
    }
}

fn apply_circuit_breaker_config_to_app(
    app_config: &mut AppProxyConfig,
    config: &CircuitBreakerConfig,
) {
    app_config.circuit_failure_threshold = config.failure_threshold;
    app_config.circuit_success_threshold = config.success_threshold;
    app_config.circuit_timeout_seconds = config.timeout_seconds.min(u32::MAX as u64) as u32;
    app_config.circuit_error_rate_threshold = config.error_rate_threshold;
    app_config.circuit_min_requests = config.min_requests;
}

/// 启动代理服务器（仅启动服务，不接管 Live 配置）
pub(crate) async fn start_proxy_server_internal(
    state: &AppState,
) -> Result<ProxyServerInfo, String> {
    controller::start_service(state)
        .await
        .map_err(|e| e.to_string())
}

/// 停止代理服务器（恢复 Live 配置）
pub(crate) async fn stop_proxy_with_restore_internal(state: &AppState) -> Result<(), String> {
    controller::exit_all(state).await.map_err(|e| e.to_string())
}

/// 获取各应用接管状态
pub(crate) async fn get_proxy_takeover_status_internal(
    _state: &AppState,
) -> Result<ProxyTakeoverStatus, String> {
    let [claude, codex, gemini, grokbuild, claude_desktop] = crate::mode::state::mode_states(
        &crate::live::engine::DeviceStore::for_device(),
        ["claude", "codex", "gemini", "grokbuild", "claude-desktop"],
    )
    .map_err(|e| e.to_string())?
    .map(|mode| mode.is_proxy());
    Ok(ProxyTakeoverStatus {
        claude,
        codex,
        gemini,
        grokbuild,
        claude_desktop,
        ..Default::default()
    })
}

/// 为指定应用开启/关闭接管
pub(crate) async fn set_proxy_takeover_for_app_internal(
    state: &AppState,
    app_type: String,
    enabled: bool,
) -> Result<(), String> {
    let app = AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    if enabled {
        controller::enter(state, &app, None).await
    } else {
        controller::exit(state, &app).await
    }
    .map_err(|e| e.to_string())
}

/// 获取代理服务器状态
pub(crate) async fn get_proxy_status_internal(state: &AppState) -> Result<ProxyStatus, String> {
    state.proxy_service.get_status().await
}

/// 获取代理配置
pub(crate) async fn get_proxy_config_internal(state: &AppState) -> Result<ProxyConfig, String> {
    state.proxy_service.get_config().await
}

/// 更新代理配置
pub(crate) async fn update_proxy_config_internal(
    state: &AppState,
    config: ProxyConfig,
) -> Result<(), String> {
    let mut global = state
        .db
        .get_global_proxy_config()
        .await
        .map_err(|e| e.to_string())?;
    global.listen_address = config.listen_address;
    global.listen_port = config.listen_port;
    global.enable_logging = config.enable_logging;
    controller::configure_service(state, global, false)
        .await
        .map_err(|e| e.to_string())
}

// ==================== Global & Per-App Config ====================

/// 获取全局代理配置
///
/// 返回统一的全局配置字段（代理开关、监听地址、端口、日志开关）
pub(crate) async fn get_global_proxy_config_internal(
    state: &AppState,
) -> Result<GlobalProxyConfig, String> {
    let db = &state.db;
    db.get_global_proxy_config()
        .await
        .map_err(|e| e.to_string())
}

/// 更新全局代理配置
///
/// 更新统一的全局配置字段，会同时更新三行（claude/codex/gemini）
pub(crate) async fn update_global_proxy_config_internal(
    state: &AppState,
    config: GlobalProxyConfig,
) -> Result<(), String> {
    controller::configure_service(state, config, false)
        .await
        .map_err(|e| e.to_string())
}

/// 获取指定应用的代理配置
///
/// 返回应用级配置（enabled、auto_failover、超时、熔断器等）
pub(crate) async fn get_proxy_config_for_app_internal(
    state: &AppState,
    app_type: String,
) -> Result<AppProxyConfig, String> {
    let db = &state.db;
    db.get_proxy_config_for_app(&app_type)
        .await
        .map_err(|e| e.to_string())
}

/// 更新指定应用的代理配置
///
/// 更新应用级配置（enabled、auto_failover、超时、熔断器等）
pub(crate) async fn update_proxy_config_for_app_internal(
    state: &AppState,
    config: AppProxyConfig,
) -> Result<(), String> {
    let db = &state.db;
    db.update_proxy_config_for_app(config)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn get_pricing_model_source_internal(
    state: &AppState,
    app_type: &str,
) -> Result<String, AppError> {
    let db = &state.db;
    db.get_pricing_model_source(app_type).await
}

pub(crate) async fn set_pricing_model_source_internal(
    state: &AppState,
    app_type: &str,
    value: &str,
) -> Result<(), AppError> {
    let db = &state.db;
    db.set_pricing_model_source(app_type, value).await
}

/// 检查代理服务器是否正在运行
pub(crate) async fn is_proxy_running_internal(state: &AppState) -> Result<bool, String> {
    Ok(state.proxy_service.is_running().await)
}

/// 检查是否处于 Live 接管模式
pub(crate) async fn is_live_takeover_active_internal(state: &AppState) -> Result<bool, String> {
    let status = get_proxy_takeover_status_internal(state).await?;
    Ok(status.claude || status.codex || status.gemini || status.grokbuild)
}

/// 代理模式下切换供应商（热切换）
pub(crate) async fn switch_proxy_provider_internal(
    state: &AppState,
    app_type: String,
    provider_id: String,
) -> Result<(), String> {
    let app = AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    controller::set_route(state, &app, &provider_id)
        .await
        .map_err(|e| e.to_string())
}

// ==================== 故障转移相关命令 ====================

/// 获取供应商健康状态
pub(crate) async fn get_provider_health_internal(
    state: &AppState,
    provider_id: String,
    app_type: String,
) -> Result<ProviderHealth, String> {
    let db = &state.db;
    db.get_provider_health(&provider_id, &app_type)
        .await
        .map_err(|e| e.to_string())
}

/// 重置熔断器
///
/// 重置后会检查是否应该切回队列中优先级更高的供应商：
/// 1. 检查自动故障转移是否开启
/// 2. 如果恢复的供应商在队列中优先级更高（queue_order 更小），则自动切换
pub(crate) async fn reset_circuit_breaker_internal(
    state: &AppState,
    provider_id: String,
    app_type: String,
) -> Result<(), String> {
    // 1. 重置数据库健康状态
    let db = &state.db;
    db.update_provider_health(&provider_id, &app_type, true, None)
        .await
        .map_err(|e| e.to_string())?;

    // 2. 如果代理正在运行，重置内存中的熔断器状态
    state
        .proxy_service
        .reset_provider_circuit_breaker(&provider_id, &app_type)
        .await?;

    // 3. 检查是否应该切回优先级更高的供应商（从 proxy_config 表读取）
    // 只有当该应用已被代理接管（enabled=true）且开启了自动故障转移时才执行
    let (app_enabled, auto_failover_enabled) = match db.get_proxy_config_for_app(&app_type).await {
        Ok(config) => (config.enabled, config.auto_failover_enabled),
        Err(e) => {
            log::error!("[{app_type}] Failed to read proxy_config: {e}, defaulting to disabled");
            (false, false)
        }
    };

    if app_enabled && auto_failover_enabled && state.proxy_service.is_running().await {
        // 获取当前供应商 ID
        let app = AppType::from_str(&app_type).map_err(|e| e.to_string())?;
        let current_id =
            crate::mode::current::provider_for(db, &app, crate::mode::current::Purpose::InUse)
                .map_err(|e| e.to_string())?;

        if let Some(current_id) = current_id {
            // 获取故障转移队列
            let queue = db
                .get_failover_queue(&app_type)
                .map_err(|e| e.to_string())?;

            // 找到恢复的供应商和当前供应商在队列中的位置（使用 sort_index）
            let restored_order = queue
                .iter()
                .find(|item| item.provider_id == provider_id)
                .and_then(|item| item.sort_index);

            let current_order = queue
                .iter()
                .find(|item| item.provider_id == current_id)
                .and_then(|item| item.sort_index);

            // 如果恢复的供应商优先级更高（sort_index 更小），则切换
            if let (Some(restored), Some(current)) = (restored_order, current_order) {
                if restored < current {
                    log::info!(
                        "[Recovery] 供应商 {provider_id} 已恢复且优先级更高 (P{restored} vs P{current})，自动切换"
                    );

                    // 获取供应商名称用于日志和事件
                    let provider_name = db
                        .get_all_providers(&app_type)
                        .ok()
                        .and_then(|providers| providers.get(&provider_id).map(|p| p.name.clone()))
                        .unwrap_or_else(|| provider_id.clone());

                    // 创建故障转移切换管理器并执行切换
                    let switch_manager =
                        crate::proxy::failover_switch::FailoverSwitchManager::new(db.clone());
                    if let Err(e) = switch_manager
                        .try_switch(&app_type, &provider_id, &provider_name)
                        .await
                    {
                        log::error!("[Recovery] 自动切换失败: {e}");
                    }
                }
            }
        }
    }

    Ok(())
}

/// 获取熔断器配置
pub(crate) async fn get_circuit_breaker_config_internal(
    state: &AppState,
) -> Result<CircuitBreakerConfig, String> {
    let db = &state.db;
    db.get_proxy_config_for_app("claude")
        .await
        .map(|config| circuit_breaker_config_from_app(&config))
        .map_err(|e| e.to_string())
}

/// 更新熔断器配置
pub(crate) async fn update_circuit_breaker_config_internal(
    state: &AppState,
    config: CircuitBreakerConfig,
) -> Result<(), String> {
    let db = &state.db;

    // 1. 更新数据库配置
    let mut app_config = db
        .get_proxy_config_for_app("claude")
        .await
        .map_err(|e| e.to_string())?;
    apply_circuit_breaker_config_to_app(&mut app_config, &config);
    db.update_proxy_config_for_app(app_config)
        .await
        .map_err(|e| e.to_string())?;

    // 2. 如果代理正在运行，热更新内存中的熔断器配置
    state
        .proxy_service
        .update_circuit_breaker_configs(config)
        .await?;

    Ok(())
}
