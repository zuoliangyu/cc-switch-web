//! 写 Claude Code 的 `settings.json`：只替换关键字段和独有字段，保留其它设置（JSON 序列化可能规范化空白）。
//!
//! 写 Claude live 的入口（切换、新增第一个供应商、编辑当前供应商、同步、统一供应商、
//! 进入 / 退出代理）都走这里：先拿应用写锁，再经 `mode::operation` 记下 pending、发布。
//! 不回填、不合并通用配置片段、不注入上下文默认值：用户的设置本来就留在 live 里。

use crate::app_config::AppType;
use crate::config::get_claude_settings_path;
use crate::database::Database;
use crate::error::AppError;
use crate::live::engine::LiveFile;
use crate::live::patch::json::JsonPatch;
use crate::live::project::claude::{direct_patch, ClaudeProjection};
use crate::mode::operation::{AppWrite, FileChange, OperationReport};
use crate::mode::state::{self, op, PendingTarget, Written};
use crate::provider::Provider;

fn app() -> &'static str {
    AppType::Claude.as_str()
}

/// `settings.json`（旧安装可能是 `claude.json`）。里面有 Key，按 0600 写。
pub(crate) fn settings_file() -> LiveFile {
    LiveFile::private(get_claude_settings_path())
}

/// 从 `prev` 切到 `target`：同一个操作里写 live、再把当前供应商改成 `target`。
///
/// `prev` 是 live 现在对应的供应商（直连指针指向的那家），用来删它带进来的独有字段。
pub(crate) fn switch_to(
    db: &Database,
    prev: Option<&Provider>,
    target: &Provider,
) -> Result<OperationReport, AppError> {
    write(db, prev, target, Some(&target.id))
}

/// 把当前供应商 `target` 重新投影到 live，不改指针。`prev` 是 live 现在对应的那一版
/// 行（编辑前的行；没改过就是它自己）。
pub(crate) fn reapply(
    db: &Database,
    prev: Option<&Provider>,
    target: &Provider,
) -> Result<OperationReport, AppError> {
    write(db, prev, target, None)
}

fn write(
    db: &Database,
    prev: Option<&Provider>,
    target: &Provider,
    pointer: Option<&str>,
) -> Result<OperationReport, AppError> {
    let prev = previous_projection(db, prev)?;
    let projection = ClaudeProjection::of(&target.settings_config);
    let mut patch = direct_patch(prev.as_ref(), &projection);
    // 删掉以前开发版写进去的账号目录（见 claude_official）
    super::claude_official::strip_from_patch(&mut patch);
    // 先换登录（卡绑了本机账号、没设配置目录覆盖时）：失败就整个不切，指针和
    // settings.json 都不动；登录换了、后面写失败时再换回去
    super::claude_official::with_login_switch(Some(target), || {
        run(
            db,
            if pointer.is_some() {
                op::SWITCH
            } else {
                op::APPLY
            },
            Some(&patch),
            recorded_target(pointer.map(str::to_string), &projection),
        )
    })
}

// Web 仍用旧代理接管控制器。记录最近写入的独有字段，避免代理路由/供应商行已
// 更新后按新行误判上一家写入的值；记录与文件发布由同一 pending 提交。
pub(crate) fn recorded_target(
    pointer: Option<String>,
    projection: &ClaudeProjection,
) -> PendingTarget {
    let mut written = Written::default();
    written.extra.insert(
        "claudeExclusive".into(),
        serde_json::Value::Object(projection.exclusive.clone()),
    );
    PendingTarget {
        written: Some(written),
        ..PendingTarget::pointer(pointer)
    }
}

pub(crate) fn previous_projection(
    db: &Database,
    previous: Option<&Provider>,
) -> Result<Option<ClaudeProjection>, AppError> {
    let state = state::load(&crate::live::engine::DeviceStore::for_device())?;
    if let Some(exclusive) = state
        .apps
        .get(app())
        .and_then(|app| app.written.as_ref())
        .and_then(|written| written.extra.get("claudeExclusive"))
        .and_then(serde_json::Value::as_object)
    {
        return Ok(Some(ClaudeProjection {
            exclusive: exclusive.clone(),
            ..Default::default()
        }));
    }
    if let Some(previous) = previous {
        return Ok(Some(ClaudeProjection::of(&previous.settings_config)));
    }
    let current = crate::settings::get_effective_current_provider(db, &AppType::Claude)?;
    Ok(current
        .map(|id| db.get_provider_by_id(&id, app()))
        .transpose()?
        .flatten()
        .map(|row| ClaudeProjection::of(&row.settings_config)))
}

/// 旧代理入口只提交关键字段；用户在接管期间修改的全局设置继续留在 live。
pub(crate) fn apply_settings(db: &Database, settings: &serde_json::Value) -> Result<(), AppError> {
    crate::mode::operation::settle(db, app())?;
    let prev = previous_projection(db, None)?;
    let target = ClaudeProjection::of(settings);
    let patch = direct_patch(prev.as_ref(), &target);
    run(db, op::APPLY, Some(&patch), recorded_target(None, &target))?;
    Ok(())
}

/// 用 `patch` 改写 `settings.json`，和 `target` 在同一个操作里提交；`patch` 为空时只
/// 落定状态、不读也不写文件。
pub(crate) fn run(
    db: &Database,
    op: &str,
    patch: Option<&JsonPatch>,
    target: PendingTarget,
) -> Result<OperationReport, AppError> {
    // 补丁是按调用方读到的指针算的（要删上一家的独有字段）：先补完上一次的操作。
    let write = AppWrite::begin(db, app())?;
    let changes: Vec<FileChange<'_>> = patch
        .into_iter()
        .map(|patch| FileChange {
            file: settings_file(),
            patch,
        })
        .collect();
    write.run(op, &changes, target)
}
