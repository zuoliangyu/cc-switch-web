use super::{desktop_needs_routing_error, ProviderService, SwitchResult};
use crate::claude_desktop_config::{self, needs_routing};
use crate::mode::state::{op, PendingTarget};
use crate::{app_config::AppType, error::AppError, provider::Provider, store::AppState};

const APP: &str = "claude-desktop";

impl ProviderService {
    /// 保存 Claude Desktop 的卡。Desktop 的直连 / 路由模式是设备级的（见 `mode::controller`），
    /// 卡上的 `claudeDesktopMode` 只说明这张卡是哪种：
    ///
    /// - 直连模式下第一张卡、编辑直连那家：按新行写直连 profile，和指针在同一个操作里提交。
    ///   要经路由的卡（模型映射、托管账号）直连写不进去：新增时只存行，编辑正在用的那张时
    ///   拒绝，先进入路由模式再改。
    /// - 路由模式下按新行重写路由契约（路由那家或聚合成员改了才真正写文件）。
    ///
    /// 写失败、且没留下要前滚的操作时把行恢复原样。
    pub(crate) fn save_desktop(
        state: &AppState,
        provider: Provider,
        add: bool,
    ) -> Result<bool, AppError> {
        let _service = futures::executor::block_on(crate::mode::controller::lock_service());
        let _app = futures::executor::block_on(state.proxy_service.lock_switch_for_app(APP));
        crate::mode::operation::settle(&state.db, APP)?;
        Self::validate_provider_settings(&AppType::ClaudeDesktop, &provider)?;
        let previous = state.db.get_provider_by_id(&provider.id, APP)?;
        if !add && previous.is_none() {
            return Err(AppError::Message(format!("供应商 {} 不存在", provider.id)));
        }
        let mode = crate::mode::current::mode_state(&AppType::ClaudeDesktop);
        let direct = crate::mode::current::provider_for(
            &state.db,
            &AppType::ClaudeDesktop,
            crate::mode::current::Purpose::Direct,
        )?;
        let is_direct_current = direct.as_deref() == Some(provider.id.as_str());
        if !add && is_direct_current && !mode.is_proxy() && needs_routing(&provider) {
            return Err(desktop_needs_routing_error());
        }
        state.db.save_provider(APP, &provider)?;
        let written = if mode.is_proxy() {
            futures::executor::block_on(crate::mode::controller::reapply_after_save_locked(
                state,
                &AppType::ClaudeDesktop,
                None,
            ))
            .map(|_| ())
        } else if add && direct.is_none() {
            if needs_routing(&provider) {
                Ok(())
            } else {
                claude_desktop_config::write_direct(
                    &state.db,
                    op::SWITCH,
                    Some(&provider),
                    PendingTarget::pointer(Some(provider.id.clone())),
                )
            }
        } else if is_direct_current {
            claude_desktop_config::write_direct(
                &state.db,
                op::APPLY,
                Some(&provider),
                PendingTarget::default(),
            )
        } else {
            Ok(())
        };
        if let Err(error) = written {
            if !crate::mode::operation::has_pending(APP) {
                match previous {
                    Some(row) => state.db.save_provider(APP, &row)?,
                    None => state.db.delete_provider(APP, &provider.id)?,
                }
            }
            return Err(error);
        }
        Ok(true)
    }

    /// 切换 Claude Desktop：路由模式下换的是路由那家；直连模式下配置文件和指针在同一个操作里
    /// 提交，要经本地路由的卡（模型映射、托管 OAuth）直连写不进去。调用方（`switch`）已持有
    /// 服务锁。
    pub(crate) fn switch_desktop(
        state: &AppState,
        provider: &Provider,
    ) -> Result<SwitchResult, AppError> {
        if crate::mode::current::is_proxy(&AppType::ClaudeDesktop) {
            let route = futures::executor::block_on(crate::mode::controller::set_route_locked(
                state,
                &AppType::ClaudeDesktop,
                &provider.id,
            ))?;
            return Ok(SwitchResult {
                route: Some(route),
                ..Default::default()
            });
        }
        let _app = futures::executor::block_on(state.proxy_service.lock_switch_for_app(APP));
        crate::mode::operation::settle(&state.db, APP)?;
        if needs_routing(provider) {
            return Err(desktop_needs_routing_error());
        }
        claude_desktop_config::write_direct(
            &state.db,
            op::SWITCH,
            Some(provider),
            PendingTarget::pointer(Some(provider.id.clone())),
        )?;
        Ok(SwitchResult::default())
    }
}
