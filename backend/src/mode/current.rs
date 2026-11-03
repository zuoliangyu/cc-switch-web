//! 「当前供应商」有两个：直连指针和代理路由，互相独立。
//!
//! 请求与界面逐步迁移到 [`provider_for`]，并说明读它做什么。直接读直连指针
//! （`settings::get_effective_current_provider`、`Database::get_current_provider`）
//! 仅表示直连目标；旧 Web 控制器在切换到新模式前保留兼容读取。

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::provider::Provider;

use super::state::{self, ModeState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// 直连指针：直连模式下写进客户端文件的那家，代理模式下退出代理时写回它。
    Direct,
    /// 请求实际发往的那家：代理模式下是代理路由，直连模式下是直连指针。界面上的
    /// 「当前」、用量、测速、项目快照都按它。
    InUse,
}

/// 这个应用的模式状态；不支持本地路由的应用恒为直连。
fn supports_proxy(app: &AppType) -> bool {
    matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    )
}

pub fn mode_state(app: &AppType) -> ModeState {
    if !supports_proxy(app) {
        return ModeState::default();
    }
    state::mode_state(&DeviceStore::for_device(), app.as_str()).unwrap_or_else(|err| {
        log::warn!("读取 {} 的模式状态失败，按直连处理: {err}", app.as_str());
        ModeState::default()
    })
}

pub fn is_proxy(app: &AppType) -> bool {
    mode_state(app).is_proxy()
}

pub fn provider_for(
    db: &Database,
    app: &AppType,
    purpose: Purpose,
) -> Result<Option<String>, AppError> {
    if purpose == Purpose::InUse {
        if let Some(route) = proxy_route_row(db, app)? {
            return Ok(Some(route.id));
        }
    }
    crate::settings::get_effective_current_provider(db, app)
}

/// 正在用的那一行（见 [`Purpose::InUse`]）。
pub fn provider_in_use(db: &Database, app: &AppType) -> Result<Option<Provider>, AppError> {
    match proxy_route_row(db, app)? {
        Some(route) => Ok(Some(route)),
        None => direct_provider(db, app),
    }
}

/// 代理模式下代理路由那一行；不在代理模式、或者路由那家在库里不存在（按直连处理）时
/// 为 `None`。
fn proxy_route_row(db: &Database, app: &AppType) -> Result<Option<Provider>, AppError> {
    let mode = mode_state(app);
    if !mode.is_proxy() {
        return Ok(None);
    }
    let Some(route) = mode.proxy_route else {
        return Ok(None);
    };
    let row = db.get_provider_by_id(&route, app.as_str())?;
    if row.is_none() {
        log::warn!(
            "{} 的代理路由 {route} 在数据库中不存在，按直连指针处理",
            app.as_str()
        );
    }
    Ok(row)
}

/// 直连指针指向的那一行。
pub fn direct_provider(db: &Database, app: &AppType) -> Result<Option<Provider>, AppError> {
    match provider_for(db, app, Purpose::Direct)? {
        Some(id) => db.get_provider_by_id(&id, app.as_str()),
        None => Ok(None),
    }
}

/// 删除前检查：直连指针（同 [`provider_for`] 的 `Direct`）或代理路由指着它，就算正在用。
///
/// 和界面上禁用删除的判断是同一个集合。不再单独看 DB 的 `is_current`：本地记录有效时
/// 它只是回退值，可能停在别的卡上，单独看它会让一张界面上可删的卡点了删除却被拒绝。
pub fn is_referenced(db: &Database, app: &AppType, id: &str) -> Result<bool, AppError> {
    if provider_for(db, app, Purpose::Direct)?.as_deref() == Some(id) {
        return Ok(true);
    }
    Ok(mode_state(app).routes_to(id))
}
