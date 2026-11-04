//! Claude Code 官方订阅账号的状态与专用命令（加号、列表、删号走授权中心的通用 `auth_*` 接口）。
//!
//! Web 版按进程单例管理账号（Tauri 版放在托管状态里）。登录在服务端跑 `claude auth login`：
//! 服务端不替用户开浏览器，授权页地址交给前端；浏览器回不到服务端本机时，用户把落地页地址
//! 或登录页上的代码贴回来（[`claude_account_submit_paste_internal`]）。

use std::sync::{Arc, LazyLock};

use crate::services::claude_account::ClaudeAccountManager;

static CLAUDE_ACCOUNT_MANAGER: LazyLock<Arc<ClaudeAccountManager>> = LazyLock::new(|| {
    Arc::new(ClaudeAccountManager::new(
        crate::config::get_app_config_dir(),
    ))
});

pub(crate) fn claude_account_manager() -> Arc<ClaudeAccountManager> {
    CLAUDE_ACCOUNT_MANAGER.clone()
}

/// 启动时：上次切换登录时崩溃、断电先补完；默认目录的设置、MCP 可能在 CC Switch 没运行时改过。
pub(crate) fn claude_account_startup(db: Arc<crate::database::Database>) {
    let data_dir = crate::config::get_app_config_dir();
    std::thread::spawn(move || {
        crate::services::provider::claude_official::recover_login_switch(&db);
        crate::services::claude_account::sync_all_shared(&data_dir)
    });
}

/// 浏览器回不到服务端本机时，把落地页地址或登录页上的代码交给正在等待的 `claude auth login`。
pub(crate) async fn claude_account_submit_paste_internal(
    flow_id: &str,
    pasted: &str,
) -> Result<(), String> {
    claude_account_manager()
        .submit_paste(flow_id, pasted)
        .await
        .map_err(|error| error.to_string())
}

/// 绑了账号的 Claude 官方卡的额度：按那个账号自己的登录查，带上它的套餐。
pub(crate) async fn get_claude_account_quota_internal(
    account_id: &str,
) -> Result<crate::services::subscription::ClaudeAccountQuota, String> {
    crate::services::subscription::get_claude_account_quota(
        crate::config::get_app_config_dir(),
        account_id.trim().to_string(),
    )
    .await
}

/// Claude Code 默认登录的套餐（没绑账号的官方卡显示）；没登录或凭据里没写时为 `None`。
pub(crate) async fn get_claude_default_plan_internal(
) -> Result<Option<crate::services::claude_account::AccountPlan>, String> {
    tokio::task::spawn_blocking(crate::services::subscription::read_claude_default_plan)
        .await
        .map_err(|error| error.to_string())
}

/// 切卡时切换 Claude Code 登录的状态。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLoginSwitchStatus {
    /// 切到绑号卡时会切换登录（没被挡住）
    pub active: bool,
    /// 不切换登录的原因：`"wsl"`（Claude 配置目录在 WSL 里，账号功能不可用）或
    /// `"overrideDir"`（设了别的 Claude 配置目录覆盖）
    pub blocked: Option<String>,
    /// Claude Code 现在登录的账号 key（按 `~/.claude.json` 的资料）
    pub live: Option<String>,
}

fn login_switch_status() -> ClaudeLoginSwitchStatus {
    use crate::services::claude_account::snapshot;
    let blocked = snapshot::blocked_reason();
    ClaudeLoginSwitchStatus {
        active: blocked.is_none(),
        blocked: blocked.map(str::to_string),
        live: snapshot::default_owner(&snapshot::store::Slot::default_slot()),
    }
}

pub(crate) async fn get_claude_login_switch_internal() -> Result<ClaudeLoginSwitchStatus, String> {
    tokio::task::spawn_blocking(login_switch_status)
        .await
        .map_err(|error| error.to_string())
}
