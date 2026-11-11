//! 故障转移切换模块
//!
//! 处理故障转移成功后的供应商切换逻辑，包括：
//! - 去重控制（避免多个请求同时触发）
//! - 数据库更新
//! - Live 备份更新

use crate::database::Database;
use crate::error::AppError;
use crate::services::proxy::ProxyService;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 故障转移切换管理器
///
/// 负责处理故障转移成功后的供应商切换，并同步恢复用的 Live 备份。
#[derive(Clone)]
pub struct FailoverSwitchManager {
    /// 正在处理中的切换（key = "app_type:provider_id"）
    pending_switches: Arc<RwLock<HashSet<String>>>,
    db: Arc<Database>,
}

impl FailoverSwitchManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            pending_switches: Arc::new(RwLock::new(HashSet::new())),
            db,
        }
    }

    /// 尝试执行故障转移切换
    ///
    /// 如果相同的切换已在进行中，则跳过；否则执行切换逻辑。
    ///
    /// # Returns
    /// - `Ok(true)` - 切换成功执行
    /// - `Ok(false)` - 切换已在进行中，跳过
    /// - `Err(e)` - 切换过程中发生错误
    pub async fn try_switch(
        &self,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let switch_key = format!("{app_type}:{provider_id}");

        // 去重检查：如果相同切换已在进行中，跳过
        {
            let mut pending = self.pending_switches.write().await;
            if pending.contains(&switch_key) {
                log::debug!("[Failover] 切换已在进行中，跳过: {app_type} -> {provider_id}");
                return Ok(false);
            }
            pending.insert(switch_key.clone());
        }

        // 执行切换（确保最后清理 pending 标记）
        let result = self.do_switch(app_type, provider_id, provider_name).await;

        // 清理 pending 标记
        {
            let mut pending = self.pending_switches.write().await;
            pending.remove(&switch_key);
        }

        if matches!(result, Ok(true)) {
            // 通知前端刷新列表与模式视图（「路由中」标记跟着换到新的那家）
            crate::events::emit(
                "provider-switched",
                serde_json::json!({
                    "appType": app_type,
                    "providerId": provider_id,
                    "source": "failover",
                }),
            );
        }

        result
    }

    async fn do_switch(
        &self,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let app = crate::app_config::AppType::from_str(app_type)?;
        if let Some(switched) = crate::mode::controller::record_failover(&self.db, &app, provider_id).await? {
            return Ok(switched);
        }
        // 检查该应用是否已被代理接管（enabled=true）
        // 只有被接管的应用才允许执行故障转移切换
        let app_enabled = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(config) => config.enabled,
            Err(e) => {
                log::warn!("[FO-002] 无法读取 {app_type} 配置: {e}，跳过切换");
                return Ok(false);
            }
        };

        if !app_enabled {
            log::debug!("[Failover] {app_type} 未启用代理，跳过切换");
            return Ok(false);
        }

        log::info!("[FO-001] 切换: {app_type} → {provider_name}");

        // 1. 更新数据库 is_current
        self.db.set_current_provider(app_type, provider_id)?;

        // 2. 更新本地 settings（设备级）
        let app_type_enum = crate::app_config::AppType::from_str(app_type)
            .map_err(|_| AppError::Message(format!("无效的应用类型: {app_type}")))?;
        crate::settings::set_current_provider(&app_type_enum, Some(provider_id))?;

        // 3. 更新 Live 备份（确保代理停止时恢复正确配置）
        if let Ok(Some(provider)) = self.db.get_provider_by_id(provider_id, app_type) {
            if let Err(e) = ProxyService::update_live_backup_from_provider_for_db(
                self.db.as_ref(),
                app_type,
                &provider,
            )
            .await
            {
                log::warn!("[FO-003] Live 备份更新失败: {e}");
            }
        }

        Ok(true)
    }
}
