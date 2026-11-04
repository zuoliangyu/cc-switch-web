//! Web 模式控制：直连指针独立于代理路由，客户端文件与模式一起提交。
//! 所有生命周期入口先拿进程内服务锁，再拿应用切换锁，最后进入写入引擎。
use super::{
    contract, current, operation, stack,
    state::{self, op, Mode, ModeState, PendingTarget, StackState},
};
use crate::app_config::AppType;
use crate::claude_desktop_config::{self, DesktopTarget};
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::live::project::claude::{
    direct_patch, proxy_projection, ClaudeProjection, ProxyAuth, PROXY_TOKEN_PLACEHOLDER,
};
use crate::live::project::gemini::GeminiProjection;
use crate::live::project::grok::GrokProjection;
use crate::provider::Provider;
use crate::services::provider::{claude_direct, codex_direct, gemini_direct, grok_direct};
use crate::store::AppState;

static SERVICE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub(crate) async fn lock_service() -> tokio::sync::MutexGuard<'static, ()> {
    SERVICE_LOCK.lock().await
}

#[derive(Clone, Copy)]
pub(crate) enum EditorEdits<'a> {
    Claude(
        &'a [crate::services::provider::claude_editor::JsonChange],
        crate::services::provider::claude_editor::ConflictPolicy,
    ),
    Codex(&'a crate::services::provider::editor_toml::TomlEdits),
    Gemini(&'a crate::services::provider::gemini_editor::GeminiEdits),
    Grok(&'a crate::services::provider::editor_toml::TomlEdits),
}

/// 有路由模式的应用（[`AppType::has_route_mode`]）。Claude Desktop 也在内：它经同一个路由
/// 服务转发，只是没有故障转移。
pub const PROXY_APPS: [AppType; 5] = [
    AppType::Claude,
    AppType::Codex,
    AppType::Gemini,
    AppType::GrokBuild,
    AppType::ClaudeDesktop,
];
fn require_app(app: &AppType) -> Result<(), AppError> {
    if PROXY_APPS.contains(app) {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "{} 不支持本地路由",
            app.as_str()
        )))
    }
}
fn provider(state: &AppState, app: &AppType, id: &str) -> Result<Provider, AppError> {
    state
        .db
        .get_provider_by_id(id, app.as_str())?
        .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))
}
fn stored_mode(app: &AppType) -> Result<ModeState, AppError> {
    state::mode_state(&DeviceStore::for_device(), app.as_str())
}
fn reject_official(app: &AppType, row: &Provider) -> Result<(), AppError> {
    if row.category.as_deref() == Some("official")
        && !crate::services::provider::official_provider_supports_proxy_takeover(app, row)
    {
        Err(AppError::Message("该官方供应商不支持本地路由".into()))
    } else {
        Ok(())
    }
}
/// 写给客户端的代理地址（客户端地址优先，见 [`crate::services::proxy::client_origin`]）。
fn origin(address: &str, port: u16) -> String {
    crate::services::proxy::client_origin(address, port)
}
fn live_owner(
    state: &AppState,
    app: &AppType,
    mode: &ModeState,
) -> Result<Option<Provider>, AppError> {
    if mode.attached {
        mode.proxy_route
            .as_deref()
            .map(|id| state.db.get_provider_by_id(id, app.as_str()))
            .transpose()
            .map(Option::flatten)
    } else {
        current::direct_provider(&state.db, app)
    }
}
fn codex_owner<'a>(mode: &'a ModeState, owner: Option<&'a Provider>) -> codex_direct::Owner<'a> {
    match mode.contract.as_ref().filter(|_| mode.attached) {
        Some(contract) => codex_direct::Owner::Contract {
            contract,
            route: owner,
        },
        None => owner.map_or(codex_direct::Owner::None, codex_direct::Owner::Provider),
    }
}
/// 日志里的模式名。
fn mode_label(proxy: bool, stack: bool) -> &'static str {
    match (proxy, stack) {
        (false, _) => "直连",
        (true, false) => "路由",
        (true, true) => "聚合",
    }
}

/// 日志里写没写客户端文件。
fn rewrite_label(rewritten: bool) -> &'static str {
    if rewritten {
        "已重写"
    } else {
        "没变，未重写"
    }
}

/// 只给日志用：读不到 Stack 状态时按没开聚合记。
fn stack_enabled(app: &AppType) -> bool {
    state::stack(&DeviceStore::for_device(), app.as_str()).is_ok_and(|stack| stack.enabled)
}

/// 这次操作实际生效的是什么：在应用切换锁里算出来，不按界面上可能过时的模式推断。客户端
/// 文件有没有改写和代理当场换上游是两回事。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteSwitchResult {
    pub kind: RouteSwitchKind,
    pub client_config_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteSwitchKind {
    /// 直连（或代理模式但没接上）：只记下路由目标，下次接上路由 / 聚合时用。
    Remembered,
    Route,
    Stack,
}

impl RouteSwitchResult {
    fn remembered() -> Self {
        Self {
            kind: RouteSwitchKind::Remembered,
            client_config_changed: false,
        }
    }
}

/// 保存路由契约时不修改直连指针；相同契约仍允许更新实际请求路由。返回有没有改写客户端文件
/// （契约没变时只落定状态，不碰文件）。
async fn write_proxy(
    state: &AppState,
    app: &AppType,
    row: &Provider,
    url: &str,
    op_name: &str,
) -> Result<bool, AppError> {
    write_proxy_with_stack(state, app, row, url, op_name, None).await
}
async fn write_proxy_with_stack(
    state: &AppState,
    app: &AppType,
    row: &Provider,
    url: &str,
    op_name: &str,
    change: Option<StackState>,
) -> Result<bool, AppError> {
    write_proxy_with_edits(state, app, row, url, op_name, change, None).await
}
async fn write_proxy_with_edits(
    state: &AppState,
    app: &AppType,
    row: &Provider,
    url: &str,
    op_name: &str,
    change: Option<StackState>,
    edits: Option<EditorEdits<'_>>,
) -> Result<bool, AppError> {
    reject_official(app, row)?;
    let before = stored_mode(app)?;
    let owner = live_owner(state, app, &before)?;
    let mut stack_state = match change {
        Some(next) => next,
        None => state::stack(&DeviceStore::for_device(), app.as_str())?,
    };
    if stack_state.enabled {
        add_default(app, &mut stack_state, row);
    }
    let pending_mode = |mode| PendingTarget {
        state: Some(mode),
        stack: Some(stack_state.clone()),
        ..PendingTarget::default()
    };
    let members = super::stack::published_members(&state.db, app, &stack_state, Some(&row.id))?;
    let mut after = ModeState {
        mode: Some(Mode::Proxy),
        attached: true,
        proxy_route: Some(row.id.clone()),
        contract: None,
    };
    match app {
        AppType::Claude => {
            let auth = if row.uses_managed_account_auth() {
                ProxyAuth::Managed {
                    auth_token: !row.is_github_copilot()
                        || row
                            .settings_config
                            .pointer("/env/ANTHROPIC_API_KEY")
                            .is_none(),
                }
            } else {
                ProxyAuth::AuthToken
            };
            let default = stack::claude_route_default(&members);
            let mut projection = proxy_projection(
                &ClaudeProjection::of(&row.settings_config),
                &row.name,
                url,
                auth,
                default
                    .as_ref()
                    .map(|model| crate::live::project::claude::StackRoleModel {
                        id: &model.id,
                        name: &model.name,
                    }),
            );
            let published = stack::claude_published(&members);
            with_stack_models(&mut projection, &published);
            if !published.is_empty() {
                // 其余发布模型成员的兼容开关按性质并进契约，见 [`with_member_switches`]
                let others: Vec<_> = members
                    .iter()
                    .filter(|member| !member.route)
                    .map(|member| ClaudeProjection::of(&member.provider.settings_config).exclusive)
                    .collect();
                with_member_switches(&mut projection.exclusive, &others);
            }
            after.contract = Some(contract::claude(&projection));
            if edits.is_none() && before.attached && before.contract == after.contract {
                operation::commit_target(
                    &state.db,
                    &DeviceStore::for_device(),
                    app.as_str(),
                    &pending_mode(after),
                )?;
                return Ok(false);
            }
            let previous = claude_direct::previous_projection(&state.db, owner.as_ref())?;
            let mut patch = direct_patch(previous.as_ref(), &projection);
            crate::services::provider::claude_official::strip_from_patch(&mut patch);
            let mut pending = claude_direct::recorded_target(None, &projection);
            pending.state = Some(after);
            pending.stack = Some(stack_state.clone());
            if let Some(EditorEdits::Claude(changes, on_conflict)) = edits {
                let combined = crate::services::provider::claude_editor::EditorPatch {
                    changes,
                    on_conflict,
                    key_fields: Some(patch),
                };
                operation::AppWrite::begin(&state.db, app.as_str())?.run(
                    op_name,
                    &[operation::FileChange {
                        file: claude_direct::settings_file(),
                        patch: &combined,
                    }],
                    pending,
                )?;
            } else {
                claude_direct::run(&state.db, op_name, Some(&patch), pending)?;
            }
        }
        AppType::Codex => {
            let owner = codex_owner(&before, owner.as_ref());
            let base_url = format!("{url}/v1");
            let target = codex_direct::Target::Proxy {
                route: row,
                base_url: &base_url,
                stack: &members,
            };
            let mut prepared = codex_direct::prepare(state, &owner, &target)?;
            codex_direct::prepare_official_rows(&state.db, &owner, &target, &mut prepared).await?;
            let planned = codex_direct::plan(&state.db, &owner, &target, &prepared)?;
            after.contract = Some(planned.contract.clone());
            // 改用 CC Switch 的目录时契约可能没变，也要重写。
            if edits.is_none()
                && op_name != op::CATALOG
                && before.attached
                && before.contract == after.contract
            {
                operation::commit_target(
                    &state.db,
                    &DeviceStore::for_device(),
                    app.as_str(),
                    &pending_mode(after),
                )?;
                return Ok(false);
            }
            codex_direct::run_with_edits(
                &state.db,
                op_name,
                planned,
                &prepared,
                pending_mode(after),
                match edits {
                    Some(EditorEdits::Codex(edits)) => Some(edits),
                    _ => None,
                },
            )?;
        }
        AppType::Gemini => {
            let projection = GeminiProjection::proxy_contract(
                &gemini_direct::projection(row)?,
                url,
                PROXY_TOKEN_PLACEHOLDER,
            );
            after.contract = Some(contract::gemini(&projection));
            if edits.is_none() && before.attached && before.contract == after.contract {
                operation::commit_target(
                    &state.db,
                    &DeviceStore::for_device(),
                    app.as_str(),
                    &pending_mode(after),
                )?;
                return Ok(false);
            }
            gemini_direct::run_with_edits(
                &state.db,
                op_name,
                Some(&projection),
                pending_mode(after),
                match edits {
                    Some(EditorEdits::Gemini(edits)) => Some(edits),
                    _ => None,
                },
            )?;
        }
        AppType::GrokBuild => {
            let projection = GrokProjection::proxy_contract(
                &grok_direct::projection(row)?,
                &format!("{url}/grokbuild/v1"),
                PROXY_TOKEN_PLACEHOLDER,
            )?;
            after.contract = Some(contract::grok(&projection));
            if edits.is_none() && before.attached && before.contract == after.contract {
                operation::commit_target(
                    &state.db,
                    &DeviceStore::for_device(),
                    app.as_str(),
                    &pending_mode(after),
                )?;
                return Ok(false);
            }
            grok_direct::run_with_edits(
                &state.db,
                op_name,
                owner.as_ref(),
                Some(&projection),
                pending_mode(after),
                match edits {
                    Some(EditorEdits::Grok(edits)) => Some(edits),
                    _ => None,
                },
            )?;
        }
        AppType::ClaudeDesktop => {
            // 路由模式写指向本地路由 `/claude-desktop` 的网关 profile，模型列表是路由那家的映射表，
            // 聚合模式再跟上别家发布的模型。契约是 profile 的摘要：换路由时模型列表没变就不重写
            // 文件（Desktop 只在启动时读配置，重写就要重启它）。
            let profile = claude_desktop_config::route_profile(
                &state.db,
                row,
                url,
                &stack::desktop_published(&members),
            )?;
            after.contract = Some(contract::claude_desktop(&profile));
            let unchanged = before.attached && before.contract == after.contract;
            claude_desktop_config::run(
                &state.db,
                op_name,
                (!unchanged).then_some(DesktopTarget::Profile(&profile)),
                pending_mode(after),
            )?;
            return Ok(!unchanged);
        }
        _ => require_app(app)?,
    }
    Ok(true)
}
fn write_direct(state: &AppState, app: &AppType, detach: bool) -> Result<(), AppError> {
    let before = stored_mode(app)?;
    let owner = live_owner(state, app, &before)?;
    let direct = current::direct_provider(&state.db, app)?.filter(|row| {
        !crate::services::proxy::ProxyService::live_has_proxy_placeholder_for_app(
            &state.db,
            app,
            &row.settings_config,
        )
    });
    let after = ModeState {
        mode: Some(if detach { Mode::Proxy } else { Mode::Direct }),
        attached: false,
        contract: None,
        proxy_route: before.proxy_route.clone(),
    };
    let op_name = if detach { op::DETACH } else { op::EXIT };
    if !before.attached {
        return operation::commit_target(
            &state.db,
            &DeviceStore::for_device(),
            app.as_str(),
            &PendingTarget::mode(after),
        );
    }
    match app {
        AppType::Claude => {
            let previous = claude_direct::previous_projection(&state.db, owner.as_ref())?;
            let projection = direct
                .as_ref()
                .map(|p| ClaudeProjection::of(&p.settings_config))
                .unwrap_or_default();
            let mut patch = direct_patch(previous.as_ref(), &projection);
            crate::services::provider::claude_official::strip_from_patch(&mut patch);
            let mut pending = claude_direct::recorded_target(None, &projection);
            pending.state = Some(after);
            // 退出代理（不是退出 CC Switch 时的分离）回到直连的官方卡：和切换一样把它绑的
            // 账号换进 Claude Code 的登录（代理期间可能改过这张卡绑的号）
            let login_target = direct.as_ref().filter(|_| op_name == op::EXIT);
            crate::services::provider::claude_official::with_login_switch(login_target, || {
                claude_direct::run(&state.db, op_name, Some(&patch), pending)
            })?;
        }
        AppType::Codex => {
            let owner = codex_owner(&before, owner.as_ref());
            let write = |row: Option<&Provider>| -> Result<(), AppError> {
                let target = codex_direct::Target::Direct(row);
                let prepared = codex_direct::prepare(state, &owner, &target)?;
                let planned = codex_direct::plan(&state.db, &owner, &target, &prepared)?;
                codex_direct::run(
                    &state.db,
                    op_name,
                    planned,
                    &prepared,
                    PendingTarget::mode(after.clone()),
                )?;
                Ok(())
            };
            if let Err(error) = write(direct.as_ref()) {
                // 已开始发布的操作必须按原 pending 恢复，不能用兜底覆盖。
                if operation::has_pending(app.as_str()) {
                    return Err(error);
                }
                log::warn!("Codex 直连供应商不可用，撤回代理关键字段: {error}");
                write(None)?;
            }
        }
        AppType::Gemini => {
            let projection = direct
                .as_ref()
                .map(gemini_direct::projection)
                .transpose()
                .unwrap_or_else(|error| {
                    log::warn!("Gemini 直连配置不可用: {error}");
                    None
                })
                .unwrap_or_else(GeminiProjection::empty);
            gemini_direct::run(
                &state.db,
                op_name,
                Some(&projection),
                PendingTarget::mode(after),
            )?;
        }
        AppType::GrokBuild => {
            let projection = direct
                .as_ref()
                .map(grok_direct::projection)
                .transpose()
                .unwrap_or_else(|error| {
                    log::warn!("Grok 直连配置不可用: {error}");
                    None
                })
                .unwrap_or(GrokProjection { table: None });
            grok_direct::run(
                &state.db,
                op_name,
                owner.as_ref(),
                Some(&projection),
                PendingTarget::mode(after),
            )?;
        }
        AppType::ClaudeDesktop => {
            // 直连那家写不进去（模型映射卡、托管账号、配置不全）也不能让 Desktop 一直指着路由：
            // 退回官方。
            let profile =
                claude_desktop_config::direct_target(direct.as_ref()).unwrap_or_else(|error| {
                    log::warn!("写回直连的 Claude Desktop 配置失败，改为官方: {error}");
                    None
                });
            let write = match &profile {
                Some(profile) => DesktopTarget::Profile(profile),
                None => DesktopTarget::Official,
            };
            claude_desktop_config::run(
                &state.db,
                op_name,
                Some(write),
                PendingTarget::mode(after),
            )?;
        }
        _ => require_app(app)?,
    }
    Ok(())
}
/// 预选代理路由；处于直连时不启动服务，也不改客户端配置。
/// 拿这个应用的切换锁，并先补完上一次没写完的配置文件操作（补不完就什么都不做）。
pub(crate) async fn lock_settled(
    state: &AppState,
    app: &AppType,
) -> Result<tokio::sync::OwnedMutexGuard<()>, AppError> {
    let guard = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str()).map_err(|error| {
        AppError::localized(
            "mode.unsettled",
            format!(
                "{} 上一次写配置文件的操作没做完，现在也补不完：{error}。本次什么都没做，请排查后重试",
                app.as_str()
            ),
            format!(
                "The previous write to {}'s config files is unfinished and cannot be completed now: {error}. Nothing was done; fix the cause and retry",
                app.as_str()
            ),
        )
    })?;
    Ok(guard)
}

pub async fn set_route(
    state: &AppState,
    app: &AppType,
    id: &str,
) -> Result<RouteSwitchResult, AppError> {
    let _service = SERVICE_LOCK.lock().await;
    set_route_locked(state, app, id).await
}

/// 指定代理路由（聚合模式下是默认那家）。已经接上路由时当场生效；直连（或代理模式但没接上）
/// 只记下来，下次进入路由 / 聚合模式时用，客户端文件不动。
pub(crate) async fn set_route_locked(
    state: &AppState,
    app: &AppType,
    id: &str,
) -> Result<RouteSwitchResult, AppError> {
    require_app(app)?;
    let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str())?;
    let row = provider(state, app, id)?;
    reject_official(app, &row)?;
    let mut mode = stored_mode(app)?;
    let previous = mode.proxy_route.clone();
    if mode.is_proxy() && mode.attached {
        let status = state
            .proxy_service
            .get_status()
            .await
            .map_err(AppError::Message)?;
        if !status.running {
            return Err(AppError::Message("路由服务未运行，请先恢复模式".into()));
        }
        let stack = stack_enabled(app);
        let rewritten = write_proxy(
            state,
            app,
            &row,
            &origin(&status.address, status.port),
            op::ROUTE,
        )
        .await?;
        // 编辑路由那家之后也走这里重算契约：路由没换、文件也没动的不记。
        if rewritten || previous.as_deref() != Some(id) {
            log::info!(
                "[MODE] {} {}：{}模式路由 {} → {id}，客户端配置{}",
                app.as_str(),
                op::ROUTE,
                mode_label(true, stack),
                previous.as_deref().unwrap_or("（无）"),
                rewrite_label(rewritten)
            );
        }
        Ok(RouteSwitchResult {
            kind: if stack {
                RouteSwitchKind::Stack
            } else {
                RouteSwitchKind::Route
            },
            client_config_changed: rewritten,
        })
    } else {
        if previous.as_deref() == Some(id) {
            return Ok(RouteSwitchResult::remembered());
        }
        mode.mode.get_or_insert(Mode::Direct);
        mode.proxy_route = Some(id.to_string());
        operation::commit_target(
            &state.db,
            &DeviceStore::for_device(),
            app.as_str(),
            &PendingTarget::mode(mode),
        )?;
        log::info!(
            "[MODE] {} 直连模式下记下路由 {} → {id}，下次进入路由 / 聚合模式时用",
            app.as_str(),
            previous.as_deref().unwrap_or("（无）")
        );
        Ok(RouteSwitchResult::remembered())
    }
}
/// 启动成功后才发布客户端契约；发布失败且没有 pending 时恢复服务总开关。
pub async fn enter(state: &AppState, app: &AppType, route: Option<&str>) -> Result<(), AppError> {
    enter_mode(state, app, route, false).await
}
pub async fn enter_mode(
    state: &AppState,
    app: &AppType,
    route: Option<&str>,
    aggregation: bool,
) -> Result<(), AppError> {
    if aggregation && !stack::supports_stack(app) {
        return Err(AppError::Message("该应用不支持聚合".into()));
    }
    require_app(app)?;
    let _service = SERVICE_LOCK.lock().await;
    let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str())?;
    let previous = stored_mode(app)?;
    let id = route
        .map(str::to_string)
        .or(previous.proxy_route.clone())
        .or(current::provider_for(
            &state.db,
            app,
            current::Purpose::Direct,
        )?)
        .ok_or_else(|| AppError::Message("请先选择供应商".into()))?;
    let row = provider(state, app, &id)?;
    reject_official(app, &row)?;
    let mut stack_state = state::stack(&DeviceStore::for_device(), app.as_str())?;
    // 只给日志用
    let was_stack = stack_state.enabled;
    stack_state.enabled = aggregation;
    let running = state.proxy_service.is_running().await;
    let global = state.db.get_global_proxy_config().await?;
    let started = state.proxy_service.start().await;
    let result = match started {
        Ok(info) => {
            write_proxy_with_stack(
                state,
                app,
                &row,
                &origin(&info.address, info.port),
                op::ENTER,
                Some(stack_state),
            )
            .await
        }
        Err(error) => Err(AppError::Message(error)),
    };
    if result.is_err() && !operation::has_pending(app.as_str()) && !running {
        if state.proxy_service.is_running().await {
            state
                .proxy_service
                .stop()
                .await
                .map_err(AppError::Message)?;
        }
        state.db.update_global_proxy_config(global).await?;
    }
    match &result {
        Ok(rewritten) => {
            log::info!(
                "[MODE] {} {}：{} → {}，路由 {id}，客户端配置{}",
                app.as_str(),
                op::ENTER,
                mode_label(previous.is_proxy() && previous.attached, was_stack),
                mode_label(true, aggregation),
                rewrite_label(*rewritten)
            );
            state.mode_startup_errors.write().await.remove(app.as_str());
        }
        Err(error) => log::error!(
            "[MODE] {} 进入{}模式失败（路由目标 {id}）: {}",
            app.as_str(),
            mode_label(true, aggregation),
            crate::error_for_log(&error.to_string())
        ),
    }
    result.map(|_| ())
}
pub async fn exit(state: &AppState, app: &AppType) -> Result<(), AppError> {
    require_app(app)?;
    let _service = SERVICE_LOCK.lock().await;
    let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str())?;
    let before = stored_mode(app)?;
    if !before.is_proxy() && !before.attached {
        log::debug!("[MODE] {} 已经是直连，不用退出", app.as_str());
    }
    let was_stack = stack_enabled(app);
    if let Err(error) = write_direct(state, app, false) {
        log::error!(
            "[MODE] {} {} 失败: {}",
            app.as_str(),
            op::EXIT,
            crate::error_for_log(&error.to_string())
        );
        return Err(error);
    }
    if before.is_proxy() || before.attached {
        log::info!(
            "[MODE] {} {}：{} → 直连，客户端配置写回直连供应商 {}",
            app.as_str(),
            op::EXIT,
            mode_label(before.is_proxy(), was_stack),
            current::provider_for(&state.db, app, current::Purpose::Direct)
                .ok()
                .flatten()
                .as_deref()
                .unwrap_or("（无）")
        );
    }
    state.mode_startup_errors.write().await.remove(app.as_str());
    // 没有应用接着路由（含 Claude Desktop 的路由模式）时停掉服务。
    let mut attached = false;
    for app in PROXY_APPS {
        attached |= stored_mode(&app)?.attached;
    }
    if !attached && state.proxy_service.is_running().await {
        state
            .proxy_service
            .stop()
            .await
            .map_err(AppError::Message)?;
    }
    Ok(())
}

/// 关掉某个功能的兼容开关：任何一家要关，契约就关（值取第一个要关的那家的）。上游不支持的
/// 功能开着会让那家每个请求都报错，关掉对别家只是少一个功能。
const CLAUDE_STACK_ANY_MEMBER_SWITCHES: &[&str] = &[
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
    "CLAUDE_CODE_DISABLE_ARTIFACT",
    "CLAUDE_CODE_AUTO_MODE_SERVER",
];

/// 打开某个功能的兼容开关：每一家都开了才开，有一家没开就去掉。
const CLAUDE_STACK_ALL_MEMBER_SWITCHES: &[&str] = &[
    "ENABLE_TOOL_SEARCH",
    "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT",
    "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING",
];

/// 环境变量当开关读：`1` / `true` / `yes` / `on` 为开，`0` / `false` / `no` / `off` / 空为关。
fn env_switch_on(value: &serde_json::Value) -> Option<bool> {
    match value {
        serde_json::Value::Bool(on) => Some(*on),
        serde_json::Value::Number(number) => number.as_f64().map(|n| n != 0.0),
        serde_json::Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" | "" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// 这一家要的是关掉功能的那一边：`CLAUDE_CODE_AUTO_MODE_SERVER` 设成关，其余开关设成开。
fn asks_to_turn_off(key: &str, value: &serde_json::Value) -> bool {
    let on = env_switch_on(value);
    if key == "CLAUDE_CODE_AUTO_MODE_SERVER" {
        on == Some(false)
    } else {
        on == Some(true)
    }
}

/// Stack 模式下其余成员的兼容开关。Claude Code 只有一份 `settings.json`，这些开关在客户端发
/// 请求时生效、代理补不上，只写默认那家的话，选中别家的模型就带着那家不支持的功能出去。按
/// 开关的性质合并（[`CLAUDE_STACK_ANY_MEMBER_SWITCHES`]、[`CLAUDE_STACK_ALL_MEMBER_SWITCHES`]）；
/// `CLAUDE_CODE_EXTRA_BODY`、关思考这类和窗口类的仍只跟默认那家（窗口由 Stack 模型决定）。
fn with_member_switches(
    exclusive: &mut serde_json::Map<String, serde_json::Value>,
    others: &[serde_json::Map<String, serde_json::Value>],
) {
    if others.is_empty() {
        return;
    }
    for key in CLAUDE_STACK_ANY_MEMBER_SWITCHES {
        if exclusive
            .get(*key)
            .is_some_and(|value| asks_to_turn_off(key, value))
        {
            continue;
        }
        if let Some(value) = others
            .iter()
            .filter_map(|member| member.get(*key))
            .find(|value| asks_to_turn_off(key, value))
        {
            exclusive.insert(key.to_string(), value.clone());
        }
    }
    for key in CLAUDE_STACK_ALL_MEMBER_SWITCHES {
        let everyone_on = others
            .iter()
            .all(|member| member.get(*key).and_then(env_switch_on).unwrap_or(false));
        if !everyone_on {
            exclusive.shift_remove(*key);
        }
    }
}

#[cfg(test)]
#[path = "controller_tests.rs"]
pub(crate) mod tests;

/// 官方缓存更新只重投影当前接入的路由；失败保留重试标记。
pub async fn resync_codex_if_behind(state: &AppState) {
    use crate::services::provider::codex_official_models as models;
    if !models::take_client_behind() {
        return;
    }
    let result = async {
        let _service = SERVICE_LOCK.lock().await;
        let _app = state.proxy_service.lock_switch_for_app("codex").await;
        operation::settle(&state.db, "codex")?;
        let mode = stored_mode(&AppType::Codex)?;
        if !mode.is_proxy() || !mode.attached {
            return Ok::<_, AppError>(());
        }
        let Some(id) = mode.proxy_route else {
            return Ok(());
        };
        let row = provider(state, &AppType::Codex, &id)?;
        let status = state
            .proxy_service
            .get_status()
            .await
            .map_err(AppError::Message)?;
        if !status.running {
            return Err(AppError::Message("路由服务未运行".into()));
        }
        write_proxy(
            state,
            &AppType::Codex,
            &row,
            &origin(&status.address, status.port),
            op::APPLY,
        )
        .await
        .map(|_| ())
    }
    .await;
    if let Err(error) = result {
        models::mark_client_behind();
        log::warn!("Codex 官方模型更新后重写失败，下次重试: {error}");
    }
}

pub async fn check_codex_official_models(state: &AppState) {
    use crate::services::provider::codex_official_models as models;
    let snapshot = state.clone();
    let result = codex_direct::off_runtime(move || -> Result<(), AppError> {
        let mode = stored_mode(&AppType::Codex)?;
        if !mode.is_proxy() || !mode.attached {
            return Ok(());
        }
        let Some(id) = mode.proxy_route.as_deref() else {
            return Ok(());
        };
        let row = provider(&snapshot, &AppType::Codex, id)?;
        let stack = state::stack(&DeviceStore::for_device(), "codex")?;
        let members =
            super::stack::published_members(&snapshot.db, &AppType::Codex, &stack, Some(id))?;
        if !codex_direct::needs_official_rows(&row, &members) {
            return Ok(());
        }
        let owner = codex_owner(&mode, Some(&row));
        let target = codex_direct::Target::Proxy {
            route: &row,
            base_url: "",
            stack: &members,
        };
        let prepared = codex_direct::prepare(&snapshot, &owner, &target)?;
        if let Ok(login) =
            codex_direct::predicted_official_login(&snapshot.db, &owner, &target, &prepared)?
        {
            match models::needs_refresh(&login) {
                Some(version) => {
                    models::refresh(&login, &version).map_err(AppError::Message)?;
                }
                // 条目还新：上次写目录时回落了的话按它重写，不必等过了新鲜期。
                None => models::catch_up_after_fallback(&login),
            }
        }
        Ok(())
    })
    .await;
    if let Err(error) = result.and_then(|r| r) {
        log::debug!("检查 Codex 官方模型列表失败: {error}");
    }
    resync_codex_if_behind(state).await;
}

/// Claude Desktop 的卡要能做路由、映射表要完整，才发布得出模型（做默认时写入也会失败）。
/// 没存映射表、靠默认档位进路由的原生卡不算。
fn check_desktop_member(row: &Provider) -> Result<(), AppError> {
    claude_desktop_config::validate_proxy_provider(row)?;
    claude_desktop_config::configured_proxy_model_routes(row)?;
    Ok(())
}

fn add_default(app: &AppType, roster: &mut StackState, row: &Provider) {
    if !stack::supports_stack(app)
        || (matches!(app, AppType::Codex) && codex_direct::is_official(row))
        || (matches!(app, AppType::ClaudeDesktop)
            && (row.category.as_deref() == Some("official") || check_desktop_member(row).is_err()))
    {
        return;
    }
    stack::allocate_key(roster, row);
    if !roster.members.contains(&row.id) {
        roster.members.push(row.id.clone());
    }
}

/// 成员变化与客户端目录一起提交，旧 key 永久保留，不会转给另一家。
pub async fn set_stack_member(
    state: &AppState,
    app: &AppType,
    id: &str,
    present: bool,
) -> Result<(), AppError> {
    if !stack::supports_stack(app) {
        return Err(AppError::Message("该应用不支持聚合".into()));
    }
    let _service = SERVICE_LOCK.lock().await;
    let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str())?;
    let mode = stored_mode(app)?;
    let mut roster = state::stack(&DeviceStore::for_device(), app.as_str())?;
    if present {
        let row = provider(state, app, id)?;
        if row.category.as_deref() == Some("official")
            || (matches!(app, AppType::Codex) && codex_direct::is_official(&row))
        {
            return Err(AppError::Message(
                "官方账号可作为默认路由，不能作为聚合成员".into(),
            ));
        }
        match app {
            AppType::Codex => codex_direct::check_stack_member(&row)?,
            AppType::ClaudeDesktop => check_desktop_member(&row)?,
            _ => {}
        }
        add_default(app, &mut roster, &row);
    } else {
        if mode.is_proxy() && roster.enabled && mode.proxy_route.as_deref() == Some(id) {
            return Err(AppError::Message("请先更换默认供应商，再移除此成员".into()));
        }
        roster.members.retain(|member| member != id);
    }
    if mode.is_proxy() && mode.attached && roster.enabled {
        let id = mode
            .proxy_route
            .as_deref()
            .ok_or_else(|| AppError::Message("尚未设置默认供应商".into()))?;
        let row = provider(state, app, id)?;
        let status = state
            .proxy_service
            .get_status()
            .await
            .map_err(AppError::Message)?;
        if !status.running {
            return Err(AppError::Message("路由服务未运行".into()));
        }
        write_proxy_with_stack(
            state,
            app,
            &row,
            &origin(&status.address, status.port),
            op::STACK,
            Some(roster),
        )
        .await
        .map(|_| ())
    } else {
        operation::commit_target(
            &state.db,
            &DeviceStore::for_device(),
            app.as_str(),
            &PendingTarget {
                stack: Some(roster),
                ..PendingTarget::default()
            },
        )
    }
}

/// 给 Web 的聚合名单与客户端目录提示；供应商展示按名称 A–Z。
///
/// Codex 还带上客户端是否可能缓存旧登录或模型列表（要读进程表，放到阻塞线程池里）。账号与
/// 目录检测都不分模式：切换账号、直连↔路由切换也会让已启动的客户端拿着旧登录或旧目录，同样
/// 要重启。路由那家自己管理目录时，重启也看不到 CC Switch 的目录，已经有 `notice` 说明，不再
/// 查目录。没有目录时（直连、路由那家没配目录）照样查：之前在 CC Switch 的目录时启动的客户端
/// 还拿着它。
pub async fn stack_view(state: &AppState, app: &AppType) -> Result<stack::StackView, AppError> {
    let mode = stored_mode(app)?;
    let roster = state::stack(&DeviceStore::for_device(), app.as_str())?;
    let route = mode.proxy_route.as_deref().filter(|_| mode.is_proxy());
    let members = stack::members(&state.db, app, &roster, route)?;
    let mut view = stack::StackView {
        active: mode.is_proxy() && roster.enabled,
        members: stack::member_views(app, &members),
        ..stack::StackView::default()
    };
    if matches!(app, AppType::Codex) {
        if let Some((notice, reasons)) = codex_stack_notice(state, &mode, &roster)? {
            view.notice = Some(notice);
            view.notice_reasons = reasons;
        }
        // 名单里每一家都列上（含路由那家）：切换到聚合的确认框里还能换默认那家，由前端按默认
        // 那家去掉它的模型（默认那家不发布 `ccs-*` 模型，选了也写不进去）。
        view.subagent_models = codex_direct::stack_subagent_choices(&members);
        let check_catalog = view.notice != Some("routeOwnsCatalog");
        (view.stale_clients, view.stale_revision) = codex_direct::off_runtime(move || {
            use crate::services::provider::codex_client_catalog;
            let stale =
                codex_client_catalog::stale_clients(&DeviceStore::for_device(), check_catalog);
            let revision = stale.map(|_| codex_client_catalog::revision());
            (stale, revision)
        })
        .await?;
    }
    Ok(view)
}

/// Codex 在 Stack 模式下有要发布的 Stack 模型，客户端却看不到或看不全：路由那家自己管理模型
/// 目录文件（Stack 模型不发布）；或者官方做默认、最近一次写目录时没拿到官方列表，或者拿到的
/// 列表里没有能选的模型（本机 Codex 太旧）。带上没取到列表的原因码（见
/// [`stack::StackView::notice_reasons`]）。
fn codex_stack_notice(
    state: &AppState,
    mode: &ModeState,
    roster: &StackState,
) -> Result<Option<(&'static str, Vec<&'static str>)>, AppError> {
    use crate::services::provider::codex_official_models::{self as models, NativeSource};
    if !mode.is_proxy() || !mode.attached {
        return Ok(None);
    }
    let Some(route) = mode
        .proxy_route
        .as_deref()
        .map(|id| state.db.get_provider_by_id(id, AppType::Codex.as_str()))
        .transpose()?
        .flatten()
    else {
        return Ok(None);
    };
    let published = stack::published_members(&state.db, &AppType::Codex, roster, Some(&route.id))?;
    if published.is_empty() {
        return Ok(None);
    }
    if codex_direct::route_owns_catalog(&route) {
        return Ok(Some(("routeOwnsCatalog", Vec::new())));
    }
    if !codex_direct::is_official(&route) {
        return Ok(None);
    }
    Ok(match models::last_source() {
        None | Some(NativeSource::Fetched) => None,
        source @ Some(NativeSource::Bundled(_)) => {
            Some(("officialModelsBundled", official_models_reasons(source)))
        }
        source @ Some(NativeSource::Unavailable { .. }) => {
            Some(("officialModelsUnavailable", official_models_reasons(source)))
        }
        Some(NativeSource::Outdated) => Some(("officialModelsOutdated", Vec::new())),
    })
}

/// Codex Stack 模式下聚合的模型被路由那家自己的模型目录挡住（`routeOwnsCatalog`，用户在提示
/// 上点了才调）：去掉它行里指向别的文件的 `model_catalog_json`，按当前路由重写，改用 CC Switch
/// 生成的目录。返回之后还剩的提示。
///
/// 先改行再写客户端：写失败时下一次重写按新的行投影，指针照样清掉。
pub async fn adopt_codex_stack_catalog(state: &AppState) -> Result<Option<&'static str>, AppError> {
    let app = AppType::Codex;
    let _service = SERVICE_LOCK.lock().await;
    let _app = lock_settled(state, &app).await?;
    let mode = stored_mode(&app)?;
    if !mode.is_proxy() || !mode.attached {
        return Ok(None);
    }
    let Some(id) = mode.proxy_route.clone() else {
        return Ok(None);
    };
    let mut route = provider(state, &app, &id)?;
    if let Some(settings) = codex_direct::settings_without_row_catalog(&route) {
        state
            .db
            .update_provider_settings_config(app.as_str(), &route.id, &settings)?;
        route.settings_config = settings;
    }
    let status = state
        .proxy_service
        .get_status()
        .await
        .map_err(AppError::Message)?;
    if !status.running {
        return Err(AppError::Message("路由服务未运行，请先恢复模式".into()));
    }
    write_proxy(
        state,
        &app,
        &route,
        &origin(&status.address, status.port),
        op::CATALOG,
    )
    .await?;
    let roster = state::stack(&DeviceStore::for_device(), app.as_str())?;
    Ok(codex_stack_notice(state, &stored_mode(&app)?, &roster)?.map(|(notice, _)| notice))
}

/// 聚合设置（经典子 agent 工具、子 agent 模型和推理强度、自动审批模型）变了：Codex 在 Stack
/// 模式下按新的合并目录和 `[agents]` 重写客户端（契约没变就什么都不做）。不在 Stack 模式时
/// 这些设置不起作用，等进 Stack 时自然按设置写。
pub async fn resync_codex_stack_catalog(state: &AppState) -> Result<(), AppError> {
    let app = AppType::Codex;
    let _service = SERVICE_LOCK.lock().await;
    let _app = lock_settled(state, &app).await?;
    if !state::stack(&DeviceStore::for_device(), app.as_str())?.enabled {
        return Ok(());
    }
    reapply_after_save_locked(state, &app, None)
        .await
        .map(|_| ())
}

/// 没取到官方模型列表的原因码（见 [`stack::StackView::notice_reasons`]）：先是官方列表的，
/// 两个来源都没取到时再跟自带列表的。
fn official_models_reasons(
    source: Option<crate::services::provider::codex_official_models::NativeSource>,
) -> Vec<&'static str> {
    use crate::services::provider::codex_official_models::NativeSource;
    match source {
        Some(NativeSource::Bundled(official)) => vec![official.code()],
        Some(NativeSource::Unavailable { official, bundled }) => {
            vec![official.code(), bundled.code()]
        }
        Some(NativeSource::Fetched) | Some(NativeSource::Outdated) | None => Vec::new(),
    }
}

const CLAUDE_MAX_CONTEXT_ENV: &str = "CLAUDE_CODE_MAX_CONTEXT_TOKENS";

/// `/model` 选择器的配置（顶层关键字段）。`replaceBuiltInOptions` 让选择器只剩 Default 和
/// 这里列的行：内置的 Opus / Sonnet / Haiku 行都指向默认那家的模型，留着就是几行重复，
/// 还会把那个模型自己的行去重吃掉。四档别名仍然要写，Default、`--model opus` 和子代理靠它们。
const CLAUDE_MODEL_PICKER: &str = "modelPicker";

/// 发布了 Stack 模型时：`/model` 换成 Stack 模型列表；`CLAUDE_CODE_MAX_CONTEXT_TOKENS` 改由
/// Stack 模型决定，取非 1M 模型里最小的窗口（等于默认 200K 时不写）。四档别名也写成 Stack id，
/// 同样受 MAX 约束；1M 的 Stack 模型不受 MAX 影响。没有发布 Stack 模型时契约和原来逐字节一致。
/// 旧契约写过的 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` 是独有字段，下次重写时按记录删。
fn with_stack_models(projection: &mut ClaudeProjection, stack: &[stack::StackModel]) {
    if stack.is_empty() {
        return;
    }
    let options: Vec<serde_json::Value> = stack
        .iter()
        .map(|model| {
            serde_json::json!({
                "model": model.id,
                "label": model.display_name,
                "description": model.description,
            })
        })
        .collect();
    projection.top.insert(
        CLAUDE_MODEL_PICKER.to_string(),
        serde_json::json!({ "replaceBuiltInOptions": true, "options": options }),
    );
    projection.exclusive.shift_remove(CLAUDE_MAX_CONTEXT_ENV);
    let smallest = stack
        .iter()
        .filter(|model| !model.one_m)
        .map(|model| model.window)
        .min();
    if let Some(window) = smallest.filter(|window| *window != stack::CLAUDE_DEFAULT_WINDOW) {
        projection.exclusive.insert(
            CLAUDE_MAX_CONTEXT_ENV.to_string(),
            serde_json::Value::String(window.to_string()),
        );
    }
}

/// Web 服务正常退出时撤回客户端代理地址，保留代理/聚合模式供下次启动接回。
/// 任一应用撤回失败时保持服务运行，避免留下指向已停止端口的配置。
pub async fn detach_all(state: &AppState) -> Result<(), AppError> {
    let _service = SERVICE_LOCK.lock().await;
    exit_all_locked(state, true).await
}

/// 手动关闭路由：成功撤回所有客户端后才停止服务，模式持久化为直连。
pub async fn exit_all(state: &AppState) -> Result<(), AppError> {
    let _service = SERVICE_LOCK.lock().await;
    exit_all_locked(state, false).await
}

async fn exit_all_locked(state: &AppState, detach: bool) -> Result<(), AppError> {
    let mut errors = Vec::new();
    // Claude Desktop 不分离：它只在启动时读配置，运行中的 Desktop 改了文件也照样连着路由；
    // 分离反而会在 CC Switch 关着时把 Desktop 换成直连那家（映射卡写不进去时是官方登录），
    // 下次打开 CC Switch 又换回来，每次都要重启 Desktop。
    for app in PROXY_APPS
        .into_iter()
        .filter(|app| !detach || *app != AppType::ClaudeDesktop)
    {
        let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
        let result = operation::settle(&state.db, app.as_str()).and_then(|_| {
            if stored_mode(&app)?.attached || !detach {
                write_direct(state, &app, detach)
            } else {
                Ok(())
            }
        });
        if let Err(error) = result {
            errors.push(format!("{}: {error}", app.as_str()));
        }
    }
    if !errors.is_empty() {
        return Err(AppError::Message(errors.join("; ")));
    }
    if state.proxy_service.is_running().await {
        state
            .proxy_service
            .stop()
            .await
            .map_err(AppError::Message)?;
    }
    Ok(())
}

/// 模式启动恢复：旧备份只归档，永不以陈旧快照覆盖客户端全局设置。
/// 返回逐应用失败信息供 Web 展示；一个失败不会阻止其它应用恢复。
pub async fn startup(state: &AppState) -> Vec<(String, String)> {
    let mut failures = Vec::new();
    for app in PROXY_APPS {
        let result = startup_app(state, &app).await;
        if let Err(error) = result {
            log::error!("恢复 {} 模式失败: {error}", app.as_str());
            failures.push((app.as_str().to_string(), error.to_string()));
        }
    }
    crate::services::provider::codex_client_catalog::observe(&DeviceStore::for_device());
    *state.mode_startup_errors.write().await = failures.iter().cloned().collect();
    failures
}

async fn startup_app(state: &AppState, app: &AppType) -> Result<(), AppError> {
    operation::settle(&state.db, app.as_str())?;
    let store = DeviceStore::for_device();
    let backup = state.db.get_live_backup(app.as_str()).await?;
    let mut mode = stored_mode(app)?;
    let placeholder = !mode.attached
        && crate::services::provider::ProviderService::read_live_settings(app.clone()).is_ok_and(
            |live| {
                crate::services::proxy::ProxyService::live_has_proxy_placeholder_for_app(
                    &state.db, app, &live,
                )
            },
        );
    let legacy_enabled = if *app == AppType::ClaudeDesktop {
        // 旧版按卡片决定 Desktop 走不走路由：直连指针是模型映射卡就是在用路由。只在第一次
        // （模式还没有值）时看。
        let card = mode
            .mode
            .is_none()
            .then(|| claude_desktop_config::legacy_mapping_card(&state.db))
            .flatten();
        if let Some(card) = &card {
            adopt_legacy_desktop_card(state, &mut mode, card)?;
        }
        card.is_some()
    } else {
        state.db.get_proxy_flags_sync(app.as_str()).0
    };
    let want_proxy = if backup.is_some() || placeholder {
        legacy_enabled
    } else {
        mode.mode.map_or(legacy_enabled, |mode| mode == Mode::Proxy)
    };
    if placeholder {
        mode.attached = true;
        operation::commit_target(
            &state.db,
            &store,
            app.as_str(),
            &PendingTarget::mode(mode.clone()),
        )?;
    }
    if want_proxy {
        let aggregation = state::stack(&store, app.as_str())?.enabled;
        if let Err(error) = enter_mode(state, app, mode.proxy_route.as_deref(), aggregation).await {
            if !operation::has_pending(app.as_str()) {
                // 无写入意图时才撤回；已有 pending 保留原目标，由下一次恢复补完。
                let _service = SERVICE_LOCK.lock().await;
                let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
                write_direct(state, app, false)?;
            }
            return Err(error);
        }
    } else if mode.mode != Some(Mode::Direct) || mode.attached {
        exit(state, app).await?;
    }
    if let Some(backup) = backup {
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.9fZ");
        let path = crate::config::get_app_config_dir()
            .join("backups")
            .join("proxy-live-backup")
            .join(format!("{}-{stamp}.json", app.as_str()));
        crate::config::write_json_file_private(
            &path,
            &serde_json::json!({
                "app": app.as_str(), "backedUpAt": backup.backed_up_at,
                "originalConfig": serde_json::from_str::<serde_json::Value>(&backup.original_config).unwrap_or(serde_json::Value::String(backup.original_config)),
            }),
        )?;
        state.db.delete_live_backup(app.as_str()).await?;
    }
    Ok(())
}

/// 旧版的 Desktop 映射卡拆成新版的三样：旧版给映射卡写的一律是本地路由地址，所以客户端
/// 已经接上（`attached`，接不上退回直连时才会把它写回去）；路由那家是这张卡；直连指针改成
/// 官方卡（映射卡直连写不进去，退出路由时 Desktop 本来就会回到官方，指针要跟着一致）。
/// 指针只改本机记录：`provider_for` 先读它，库里的 `is_current` 会随云同步到别的设备。
/// 先落定模式再改指针：中途崩了，下次启动按已落定的路由模式接上，不会因为指针已经不是
/// 映射卡而认不出旧版状态。
fn adopt_legacy_desktop_card(
    state: &AppState,
    mode: &mut ModeState,
    card: &Provider,
) -> Result<(), AppError> {
    let app = AppType::ClaudeDesktop;
    mode.mode = Some(Mode::Proxy);
    mode.attached = true;
    mode.proxy_route = Some(card.id.clone());
    operation::commit_target(
        &state.db,
        &DeviceStore::for_device(),
        app.as_str(),
        &PendingTarget::mode(mode.clone()),
    )?;
    ensure_desktop_official_row(state)?;
    crate::settings::set_current_provider(
        &app,
        Some(crate::database::CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID),
    )?;
    log::info!(
        "Claude Desktop 旧版映射卡 {} 迁移为路由模式：路由到这张卡，直连指针改为官方",
        card.id
    );
    Ok(())
}

/// Web 不预置官方卡：迁移要把直连指针指到官方卡时，没有就按上游的官方种子补一行（已有的
/// 不动，尊重用户改过的名字和图标）。
fn ensure_desktop_official_row(state: &AppState) -> Result<(), AppError> {
    let id = crate::database::CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID;
    let app = AppType::ClaudeDesktop.as_str();
    if state.db.get_provider_by_id(id, app)?.is_some() {
        return Ok(());
    }
    let mut official = Provider::with_id(
        id.to_string(),
        "Claude Desktop Official".to_string(),
        serde_json::json!({ "env": {} }),
        Some("https://claude.ai/download".to_string()),
    );
    official.category = Some("official".to_string());
    official.icon = Some("claude".to_string());
    official.icon_color = Some("#D97757".to_string());
    official.created_at = Some(chrono::Utc::now().timestamp_millis());
    state.db.save_provider(app, &official)
}

/// 新模式的故障转移只记代理路由；None 表示尚未迁移的旧设备状态。
/// 服务锁使迟到的转移结果在进入聚合或退出代理之后失效。
pub async fn record_failover(
    db: &crate::database::Database,
    app: &AppType,
    id: &str,
) -> Result<Option<bool>, AppError> {
    let _service = SERVICE_LOCK.lock().await;
    operation::settle(db, app.as_str())?;
    let mut mode = stored_mode(app)?;
    if mode.mode.is_none() {
        return Ok(None);
    }
    if !mode.is_proxy()
        || !mode.attached
        || mode.proxy_route.as_deref() == Some(id)
        || state::stack(&DeviceStore::for_device(), app.as_str())?.enabled
    {
        return Ok(Some(false));
    }
    if db.get_provider_by_id(id, app.as_str())?.is_none() {
        return Err(AppError::Message(format!("供应商 {id} 不存在")));
    }
    mode.proxy_route = Some(id.to_string());
    let write = operation::AppWrite::begin(db, app.as_str())?;
    write.run(op::ROUTE, &[], PendingTarget::mode(mode))?;
    Ok(Some(true))
}

/// 调用方已持有服务锁和应用切换锁，供应商行已暂存；全局编辑与代理契约同事务发布。
pub(crate) async fn reapply_after_save_locked(
    state: &AppState,
    app: &AppType,
    edits: Option<EditorEdits<'_>>,
) -> Result<bool, AppError> {
    let mode = stored_mode(app)?;
    if !mode.is_proxy() || !mode.attached {
        return Ok(false);
    }
    let id = mode
        .proxy_route
        .as_deref()
        .ok_or_else(|| AppError::Message("代理模式缺少路由".into()))?;
    let row = provider(state, app, id)?;
    let status = state
        .proxy_service
        .get_status()
        .await
        .map_err(AppError::Message)?;
    if !status.running {
        return Err(AppError::Message("路由服务未运行，请先恢复模式".into()));
    }
    write_proxy_with_edits(
        state,
        app,
        &row,
        &origin(&status.address, status.port),
        op::APPLY,
        None,
        edits,
    )
    .await?;
    Ok(true)
}

/// 保存客户端地址（只存在本机 settings.json，不随数据库同步），再按新地址重写接上路由的
/// 客户端，不用重启服务。每次保存都重写一遍：上次重写失败、改好客户端文件后原样再保存就是
/// 重试；契约没变的应用不碰文件。
pub async fn set_proxy_client_host(state: &AppState, host: &str) -> Result<(), AppError> {
    let _service = SERVICE_LOCK.lock().await;
    crate::settings::set_proxy_client_host(host)?;
    let mut failures = Vec::new();
    for app in PROXY_APPS {
        let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
        let result = match operation::settle(&state.db, app.as_str()) {
            Ok(_) => reapply_after_save_locked(state, &app, None)
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            failures.push(format!("{}: {error}", app.as_str()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::Message(failures.join("; ")))
    }
}

/// 独立启动服务（尚不接管应用），失败时恢复总开关。
pub async fn start_service(
    state: &AppState,
) -> Result<crate::proxy::types::ProxyServerInfo, AppError> {
    let _service = SERVICE_LOCK.lock().await;
    let previous = state.db.get_global_proxy_config().await?;
    match state.proxy_service.start().await {
        Ok(info) => Ok(info),
        Err(error) => {
            state.db.update_global_proxy_config(previous).await?;
            Err(AppError::Message(error))
        }
    }
}

/// 全局设置只改监听与日志；每应用的重试、超时和队列设置保持独立。
/// 重启绑定失败时回滚配置并恢复原服务，客户端地址在绑定成功前不动。
pub async fn configure_service(
    state: &AppState,
    mut config: crate::proxy::types::GlobalProxyConfig,
    restart: bool,
) -> Result<(), AppError> {
    let _service = SERVICE_LOCK.lock().await;
    let previous = state.db.get_global_proxy_config().await?;
    let running = state.proxy_service.is_running().await;
    config.proxy_enabled = previous.proxy_enabled;
    let old_status = state
        .proxy_service
        .get_status()
        .await
        .map_err(AppError::Message)?;
    let rebind = restart
        || config.listen_address != previous.listen_address
        || config.listen_port != previous.listen_port;
    if running && rebind {
        state
            .proxy_service
            .stop()
            .await
            .map_err(AppError::Message)?;
    }
    if let Err(error) = state.db.update_global_proxy_config(config).await {
        if running && rebind {
            let _ = state.proxy_service.start().await;
        }
        return Err(error);
    }
    if (running && rebind) || (restart && !running) {
        if let Err(error) = state.proxy_service.start().await {
            let mut restore_config = previous.clone();
            if running {
                restore_config.listen_port = old_status.port;
            }
            state.db.update_global_proxy_config(restore_config).await?;
            let restored = if running {
                state.proxy_service.start().await.map(|_| ())
            } else {
                Ok(())
            };
            state.db.update_global_proxy_config(previous).await?;
            return Err(AppError::Message(match restored {
                Ok(()) => format!("新监听地址不可用，已恢复原配置: {error}"),
                Err(restore) => format!("新监听地址不可用: {error}；恢复原服务失败: {restore}"),
            }));
        }
        for app in PROXY_APPS {
            let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
            operation::settle(&state.db, app.as_str())?;
            reapply_after_save_locked(state, &app, None).await?;
        }
    } else if running {
        state
            .proxy_service
            .refresh_runtime_config()
            .await
            .map_err(AppError::Message)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeView {
    pub startup_error: Option<String>,
    pub mode: &'static str,
    pub attached: bool,
    pub direct_provider_id: Option<String>,
    pub route_provider_id: Option<String>,
    pub aggregation: stack::StackView,
    pub eligible_provider_ids: Vec<String>,
}

pub async fn view(state: &AppState, app: &AppType) -> Result<ModeView, AppError> {
    require_app(app)?;
    let _service = SERVICE_LOCK.lock().await;
    let _app = state.proxy_service.lock_switch_for_app(app.as_str()).await;
    operation::settle(&state.db, app.as_str())?;
    let mode = stored_mode(app)?;
    let aggregation = stack_view(state, app).await?;
    Ok(ModeView {
        startup_error: state
            .mode_startup_errors
            .read()
            .await
            .get(app.as_str())
            .cloned(),
        mode: if mode.is_proxy() {
            if aggregation.active {
                "aggregation"
            } else {
                "routing"
            }
        } else {
            "direct"
        },
        attached: mode.attached,
        direct_provider_id: current::provider_for(&state.db, app, current::Purpose::Direct)?,
        route_provider_id: mode.proxy_route,
        aggregation,
        eligible_provider_ids: state
            .db
            .get_all_providers(app.as_str())?
            .values()
            .filter(|row| reject_official(app, row).is_ok())
            .map(|row| row.id.clone())
            .collect(),
    })
}

#[cfg(test)]
mod official_models_reason_tests {
    use super::official_models_reasons;
    use crate::services::provider::codex_official_models::{
        BundledSkip, NativeSource, OfficialSkip,
    };

    /// 提示里列出没取到官方列表的原因：回落到自带列表时只有官方的，都没取到时再跟自带的。
    #[test]
    fn notice_reasons_follow_the_last_source() {
        assert!(official_models_reasons(None).is_empty());
        assert!(official_models_reasons(Some(NativeSource::Fetched)).is_empty());
        assert_eq!(
            official_models_reasons(Some(NativeSource::Bundled(OfficialSkip::LoginStale))),
            vec!["loginStale"]
        );
        assert_eq!(
            official_models_reasons(Some(NativeSource::Unavailable {
                official: OfficialSkip::NoLogin,
                bundled: BundledSkip::NoCli,
            })),
            vec!["noLogin", "noCli"]
        );
    }
}

#[cfg(test)]
mod member_switch_tests {
    use super::with_member_switches;
    use serde_json::{json, Map, Value};

    fn env(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn stack_turns_off_a_feature_when_any_member_needs_it_off() {
        let mut exclusive = Map::new();
        let atlas = env(json!({
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
            "CLAUDE_CODE_AUTO_MODE_SERVER": "0",
            "CLAUDE_CODE_EXTRA_BODY": "{\"x\":1}",
            "CLAUDE_CODE_DISABLE_THINKING": "1"
        }));
        with_member_switches(&mut exclusive, &[atlas]);
        assert_eq!(exclusive["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"], "1");
        assert_eq!(exclusive["CLAUDE_CODE_AUTO_MODE_SERVER"], "0");
        // 请求体附加、关思考只跟默认那家，不并进来。
        assert!(exclusive.get("CLAUDE_CODE_EXTRA_BODY").is_none());
        assert!(exclusive.get("CLAUDE_CODE_DISABLE_THINKING").is_none());
    }

    #[test]
    fn stack_does_not_take_a_member_switch_that_keeps_the_feature_on() {
        let mut exclusive = Map::new();
        let other = env(json!({
            "CLAUDE_CODE_AUTO_MODE_SERVER": "1",
            "CLAUDE_CODE_DISABLE_ARTIFACT": "0"
        }));
        with_member_switches(&mut exclusive, &[other]);
        assert!(exclusive.get("CLAUDE_CODE_AUTO_MODE_SERVER").is_none());
        assert!(exclusive.get("CLAUDE_CODE_DISABLE_ARTIFACT").is_none());
    }

    #[test]
    fn stack_keeps_a_feature_on_only_when_every_member_turns_it_on() {
        let route = env(json!({ "ENABLE_TOOL_SEARCH": "true" }));
        let with = env(json!({ "ENABLE_TOOL_SEARCH": "1" }));
        let without = env(json!({}));

        let mut exclusive = route.clone();
        with_member_switches(&mut exclusive, &[with.clone()]);
        assert_eq!(exclusive["ENABLE_TOOL_SEARCH"], "true");

        let mut exclusive = route.clone();
        with_member_switches(&mut exclusive, &[with, without]);
        assert!(exclusive.get("ENABLE_TOOL_SEARCH").is_none());

        // 没有其他成员（路由模式）时只保留默认那家的开关
        let mut exclusive = route;
        with_member_switches(&mut exclusive, &[]);
        assert_eq!(exclusive["ENABLE_TOOL_SEARCH"], "true");
    }
}
