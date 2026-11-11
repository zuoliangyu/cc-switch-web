use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

/// 获取用户主目录，带回退和日志
///
/// ## Windows 注意事项
///
/// - `dirs::home_dir()` 在 Windows 上使用 `SHGetKnownFolderPath(FOLDERID_Profile)`，
///   返回的是真实用户目录（类似 `C:\\Users\\Alice`），与 v3.10.2 行为一致。
/// - 不要直接使用 `HOME` 环境变量：它可能由 Git/Cygwin/MSYS 等第三方工具注入，
///   且不一定等于用户目录，可能导致 `.cc-switch-web/cc-switch.db` 路径变化，从而“看起来像数据丢失”。
///
/// ## 测试隔离
///
/// 为了让 Windows CI/本地测试能稳定隔离真实用户数据，可通过 `CC_SWITCH_TEST_HOME`
/// 显式覆盖 home dir（仅用于测试/调试场景）。
pub fn get_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("CC_SWITCH_TEST_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    dirs::home_dir().unwrap_or_else(|| {
        log::warn!("无法获取用户主目录，回退到当前目录");
        PathBuf::from(".")
    })
}

/// 路径是否位于 WSL 网络共享（`\\wsl$\...` 或 `\\wsl.localhost\...`）；9P 共享不支持部分系统调用。
#[cfg(windows)]
pub(crate) fn is_wsl_path(path: &Path) -> bool {
    use std::path::Prefix;
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        match prefix.kind() {
            Prefix::UNC(server, _) | Prefix::VerbatimUNC(server, _) => {
                let s = server.to_string_lossy();
                s.eq_ignore_ascii_case("wsl$") || s.eq_ignore_ascii_case("wsl.localhost")
            }
            _ => false,
        }
    } else {
        false
    }
}

#[cfg(not(windows))]
pub(crate) fn is_wsl_path(_path: &Path) -> bool {
    false
}

/// 临时目录在 WSL 共享路径上时（WSL2 夜间测试），SQLite 拿不到文件锁，
/// 在磁盘上建 SQLite 夹具的测试只能跳过。
#[cfg(test)]
pub(crate) fn sqlite_unsupported_in_temp_dir() -> bool {
    let temp = std::env::temp_dir();
    let unsupported = is_wsl_path(&temp);
    if unsupported {
        eprintln!(
            "temp dir {} is a WSL share where SQLite cannot lock; skipping",
            temp.display()
        );
    }
    unsupported
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

/// Derive the WSL-side home directory from a WSL UNC path inside a user's
/// home: `\\wsl$\<distro>\home\<user>\...` -> `\\wsl$\<distro>\home\<user>`,
/// and `\\wsl.localhost\<distro>\root\...` -> `\\wsl.localhost\<distro>\root`.
/// Returns None for non-WSL paths and for WSL paths outside a home directory
/// (e.g. `\\wsl$\<distro>\etc`), where no home can be derived safely.
/// 仅用于 OMO 统一配置的位置探测（上游 37d04760）。
#[cfg(windows)]
pub(crate) fn derive_wsl_home_dir(dir: &Path) -> Option<PathBuf> {
    use std::path::Prefix;

    let normalized = normalize_path_lexically(dir);
    let mut components = normalized.components();
    let prefix = match components.next()? {
        Component::Prefix(prefix) => prefix,
        _ => return None,
    };

    let server = match prefix.kind() {
        Prefix::UNC(server, _) | Prefix::VerbatimUNC(server, _) => server.to_string_lossy(),
        _ => return None,
    };

    if !server.eq_ignore_ascii_case("wsl$") && !server.eq_ignore_ascii_case("wsl.localhost") {
        return None;
    }

    let mut parts = Vec::new();
    for component in components {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::ParentDir | Component::Prefix(_) => return None,
        }
    }

    let home_len = match parts.as_slice() {
        [home, user, ..] if home == "home" && !user.is_empty() => 2,
        [root, ..] if root == "root" => 1,
        _ => return None,
    };

    // Rebuild prefix + root + the first `home_len` components.
    let mut home_dir = PathBuf::new();
    let mut normal_seen = 0usize;
    for component in normalized.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => home_dir.push(component.as_os_str()),
            Component::Normal(_) if normal_seen < home_len => {
                home_dir.push(component.as_os_str());
                normal_seen += 1;
            }
            _ => break,
        }
    }
    Some(home_dir)
}

fn comparable_path_key(path: &Path) -> String {
    let mut key = normalize_path_lexically(path).to_string_lossy().to_string();
    #[cfg(windows)]
    {
        key = key.replace('\\', "/");
        key.make_ascii_lowercase();
    }
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }
    key
}

/// 仅做词法路径边界判断；实际打开文件前仍需 canonicalize 后再次校验。
pub(crate) fn path_is_within(base: &Path, path: &Path) -> bool {
    let base_key = comparable_path_key(base);
    let path_key = comparable_path_key(path);
    path_key == base_key || path_key.starts_with(&format!("{base_key}/"))
}

/// 获取 Claude Code 配置目录路径
pub fn get_claude_config_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_claude_override_dir() {
        return custom;
    }

    get_default_claude_config_dir()
}

pub fn get_default_claude_config_dir() -> PathBuf {
    get_home_dir().join(".claude")
}

/// 默认 Claude MCP 配置文件路径 (~/.claude.json)
pub fn get_default_claude_mcp_path() -> PathBuf {
    get_home_dir().join(".claude.json")
}

fn derive_mcp_path_from_override(dir: &Path) -> Option<PathBuf> {
    let file_name = dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())?
        .trim()
        .to_string();
    if file_name.is_empty() {
        return None;
    }
    let parent = dir.parent().unwrap_or_else(|| Path::new(""));
    Some(parent.join(format!("{file_name}.json")))
}

/// 获取 Claude MCP 配置文件路径，若设置了目录覆盖则与覆盖目录同级
pub fn get_claude_mcp_path() -> PathBuf {
    if let Some(custom_dir) = crate::settings::get_claude_override_dir() {
        if let Some(path) = derive_mcp_path_from_override(&custom_dir) {
            return path;
        }
    }
    get_default_claude_mcp_path()
}

/// 获取 Claude Code 主配置文件路径
pub fn get_claude_settings_path() -> PathBuf {
    let dir = get_claude_config_dir();
    let settings = dir.join("settings.json");
    if settings.exists() {
        return settings;
    }
    // 兼容旧版命名：若存在旧文件则继续使用
    let legacy = dir.join("claude.json");
    if legacy.exists() {
        return legacy;
    }
    // 默认新建：回落到标准文件名 settings.json（不再生成 claude.json）
    settings
}

pub fn get_default_app_config_dir() -> PathBuf {
    get_home_dir().join(".cc-switch-web")
}

pub(crate) fn get_cc_switch_source_dir() -> PathBuf {
    get_home_dir().join(".cc-switch")
}

pub(crate) fn is_cc_switch_source_path(path: &Path) -> bool {
    let source = get_cc_switch_source_dir();
    if path_is_within(&source, path) {
        return true;
    }
    match (fs::canonicalize(&source), fs::canonicalize(path)) {
        (Ok(source), Ok(path)) => path_is_within(&source, &path),
        _ => false,
    }
}

/// 获取应用配置目录路径 (~/.cc-switch-web)
pub fn get_app_config_dir() -> PathBuf {
    if let Some(custom) = crate::app_store::get_app_config_dir_override() {
        return custom;
    }

    get_default_app_config_dir()
}

/// 获取应用配置文件路径
#[cfg(test)]
pub fn get_app_config_path() -> PathBuf {
    get_app_config_dir().join("config.json")
}

/// 清理供应商名称，确保可安全用于文件名。
pub fn sanitize_provider_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// 读取 JSON 配置文件
pub fn read_json_file<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T, AppError> {
    if !path.exists() {
        return Err(AppError::Config(format!("文件不存在: {}", path.display())));
    }

    let content = fs::read_to_string(path).map_err(|e| AppError::io(path, e))?;

    serde_json::from_str(&content).map_err(|e| AppError::json(path, e))
}

/// 递归排序 JSON 对象的键（按字母顺序），确保序列化输出是确定性的。
/// 数组顺序与原始类型按原样保留。
fn sort_json_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted_map = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted_map.insert(key.clone(), sort_json_keys(&map[key]));
            }
            Value::Object(sorted_map)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json_keys).collect()),
        other => other.clone(),
    }
}

/// 写入 JSON 配置文件并返回实际写入的字节。
pub fn write_json_file_with_contents<T: Serialize>(
    path: &Path,
    data: &T,
) -> Result<Vec<u8>, AppError> {
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let contents = sorted_json_bytes(data)?;
    atomic_write(path, &contents)?;
    Ok(contents)
}

pub(crate) fn sorted_json_bytes<T: Serialize>(data: &T) -> Result<Vec<u8>, AppError> {
    let value = serde_json::to_value(data).map_err(|e| AppError::JsonSerialize { source: e })?;
    let sorted_value = sort_json_keys(&value);
    let json = serde_json::to_string_pretty(&sorted_value)
        .map_err(|e| AppError::JsonSerialize { source: e })?;

    Ok(json.into_bytes())
}

/// 写入 JSON 配置文件（键按字母排序，确保确定性输出）
pub fn write_json_file<T: Serialize>(path: &Path, data: &T) -> Result<(), AppError> {
    write_json_file_with_contents(path, data).map(|_| ())
}

/// 含凭据的 JSON live 文件；Unix 上新建和替换均使用 0600。
pub fn write_json_file_private<T: Serialize>(path: &Path, data: &T) -> Result<(), AppError> {
    atomic_write_private(path, &sorted_json_bytes(data)?)
}

/// 含凭据的 TOML live 文件；Unix 上新建和替换均使用 0600。
pub fn write_text_file_private(path: &Path, data: &str) -> Result<(), AppError> {
    atomic_write_private(path, data.as_bytes())
}

/// 原子写入文本文件（用于 TOML/纯文本）
pub fn write_text_file(path: &Path, data: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    atomic_write(path, data.as_bytes())
}

/// 原子写入：写入临时文件后 rename 替换，避免半写状态
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), AppError> {
    atomic_write_with_unix_mode(path, data, None)
}

/// 原子写入包含凭据的文件。Unix 上固定使用 0600。
pub fn atomic_write_private(path: &Path, data: &[u8]) -> Result<(), AppError> {
    atomic_write_with_unix_mode(path, data, Some(0o600))
}

fn atomic_write_with_unix_mode(
    path: &Path,
    data: &[u8],
    unix_mode: Option<u32>,
) -> Result<(), AppError> {
    stage_write(path, data, unix_mode, false)?.commit()
}

/// 已写好、还没替换目标的临时文件。原子写的前半步：写入引擎先把一次操作涉及的
/// 所有文件都备好临时文件、记下写前意图，再逐个 [`StagedWrite::commit`]。
#[derive(Debug)]
pub struct StagedWrite {
    tmp: PathBuf,
    path: PathBuf,
}

impl StagedWrite {
    pub fn tmp_path(&self) -> &Path {
        &self.tmp
    }

    /// 用临时文件替换目标（失败时删掉临时文件）。
    pub fn commit(self) -> Result<(), AppError> {
        commit_staged(&self.tmp, &self.path).inspect_err(|_| {
            let _ = fs::remove_file(&self.tmp);
        })
    }
}

/// 写入临时文件：Unix 下 `unix_mode` 为 `None` 时沿用目标文件现有的权限位。
/// `durable` 为真时写完先 fsync，崩溃恢复要靠这份临时文件前滚。
pub(crate) fn stage_write(
    path: &Path,
    data: &[u8],
    unix_mode: Option<u32>,
    durable: bool,
) -> Result<StagedWrite, AppError> {
    #[cfg(not(unix))]
    let _ = unix_mode;

    let resolved = resolve_symlink_target(path);
    let path = resolved.as_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("无效的路径".to_string()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Config("无效的文件名".to_string()))?
        .to_string_lossy()
        .to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (tmp, mut file) = (|| -> Result<(PathBuf, fs::File), AppError> {
        let mut last_collision = None;
        for _ in 0..16 {
            let counter = TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let candidate = parent.join(format!(
                "{file_name}.tmp.{}.{ts}.{counter}",
                std::process::id()
            ));
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            if let Some(mode) = unix_mode {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(mode);
            }
            match options.open(&candidate) {
                Ok(file) => return Ok((candidate, file)),
                Err(source) if source.kind() == std::io::ErrorKind::AlreadyExists => {
                    last_collision = Some((candidate, source));
                }
                Err(source) => return Err(AppError::io(&candidate, source)),
            }
        }

        let (candidate, source) = last_collision.expect("temporary filename loop must run");
        Err(AppError::io(&candidate, source))
    })()?;

    let written = file
        .write_all(data)
        .and_then(|_| file.flush())
        .and_then(|_| if durable { file.sync_all() } else { Ok(()) });
    if let Err(source) = written {
        drop(file);
        let _ = fs::remove_file(&tmp);
        return Err(AppError::io(&tmp, source));
    }
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = unix_mode {
            if let Err(source) = fs::set_permissions(&tmp, fs::Permissions::from_mode(mode)) {
                let _ = fs::remove_file(&tmp);
                return Err(AppError::io(&tmp, source));
            }
        } else if let Ok(meta) = fs::metadata(path) {
            let perm = meta.permissions().mode();
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(perm));
        }
    }

    Ok(StagedWrite {
        tmp,
        path: path.to_path_buf(),
    })
}

/// 目标是软链接时返回它最终指向的文件（逐跳 `read_link`，相对目标按链接所在目录解析），
/// 否则原样返回。原子写要替换的是这个最终文件：rename 到软链接本身会把链接换成普通
/// 文件（Unix），Windows 的 `ReplaceFileW` 则直接报 os error 1464。只解析最后一段，
/// 不碰路径里的目录软链；除相对目标带 `..` 外不做 `canonicalize`（Windows 上会把路径
/// 改写成 `\\?\` 形式），普通文件原样返回。
/// 悬空链接照样返回它指向的路径，写入时会在那里新建文件、链接保留。
fn resolve_symlink_target(path: &Path) -> PathBuf {
    // 与 Linux 的 MAXSYMLINKS 一致，防止链接成环时死循环。
    const MAX_HOPS: usize = 40;
    let mut current = path.to_path_buf();
    for _ in 0..MAX_HOPS {
        let is_link = fs::symlink_metadata(&current)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false);
        if !is_link {
            return current;
        }
        let Ok(target) = fs::read_link(&current) else {
            return current;
        };
        current = if target.is_absolute() {
            target
        } else {
            match current.parent() {
                Some(parent) => join_link_target(parent, &target),
                None => target,
            }
        };
    }
    log::warn!("软链接层数过多，按原路径写入: {}", path.display());
    path.to_path_buf()
}

/// 把相对链接目标接到链接所在目录上。目标里有 `..` 时先把目录解析成真实路径再逐段
/// 回退：Windows 按字面折叠 `..`，链接所在目录本身是 junction / 目录软链时会退到
/// 错误的上级目录（Unix 内核按真实路径解析，结果一样）。
fn join_link_target(parent: &Path, target: &Path) -> PathBuf {
    if !target
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return parent.join(target);
    }
    let Ok(mut resolved) = fs::canonicalize(parent) else {
        return parent.join(target);
    };
    for component in target.components() {
        match component {
            Component::ParentDir => {
                // 已走过的段里也可能有目录软链，回退前先解析成真实路径。
                if let Ok(real) = fs::canonicalize(&resolved) {
                    resolved = real;
                }
                resolved.pop();
            }
            Component::CurDir => {}
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// 原子写的后半步：用 `tmp` 替换 `path`。崩溃恢复也用它提交上次留下的临时文件。
/// `path` 是软链接时替换它指向的文件，链接本身保留。
///
/// 失败时临时文件留在原处：写入引擎的 pending 指着它，下次恢复要靠它前滚（目标文件被
/// 占用、只读这类失败，过后多半能补完）。只做一次性原子写的调用方自己删。
pub(crate) fn commit_staged(tmp: &Path, path: &Path) -> Result<(), AppError> {
    let resolved = resolve_symlink_target(path);
    let path = resolved.as_path();
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::ERROR_NOT_SUPPORTED, Storage::FileSystem::ReplaceFileW,
        };

        // WSL UNC paths reject ReplaceFileW with ERROR_NOT_SUPPORTED (50) on
        // every attempt; treat it as failed up front and let the rename
        // fallback below do the work, instead of burning the syscall (and the
        // retry loop) on each write.
        let skip_replace = is_wsl_path(path);

        let replaced: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let replacement: Vec<u16> = tmp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut completed = false;
        let mut last_error = None;

        for _ in 0..3 {
            // SAFETY: both path buffers are NUL-terminated UTF-16 and remain alive for the
            // duration of the call. Backup, exclusion, and reserved pointers are intentionally null.
            let replaced_ok = if skip_replace {
                0
            } else {
                unsafe {
                    ReplaceFileW(
                        replaced.as_ptr(),
                        replacement.as_ptr(),
                        std::ptr::null(),
                        0,
                        std::ptr::null(),
                        std::ptr::null(),
                    )
                }
            };
            if replaced_ok != 0 {
                completed = true;
                break;
            }

            let replace_error = std::io::Error::last_os_error();
            // WSL UNC paths reject ReplaceFileW with ERROR_NOT_SUPPORTED (50).
            // std::fs::rename uses a different replace-existing API on Windows.
            let replace_not_supported =
                skip_replace || replace_error.raw_os_error() == Some(ERROR_NOT_SUPPORTED as i32);
            if replace_error.kind() != std::io::ErrorKind::NotFound && !replace_not_supported {
                last_error = Some(replace_error);
                break;
            }

            match fs::rename(tmp, path) {
                Ok(()) => {
                    completed = true;
                    break;
                }
                Err(source)
                    if matches!(
                        source.kind(),
                        std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                    ) =>
                {
                    last_error = Some(source);
                }
                Err(source) => {
                    last_error = Some(source);
                    break;
                }
            }
        }

        if !completed {
            let source = last_error.unwrap_or_else(std::io::Error::last_os_error);
            return Err(AppError::IoContext {
                context: format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
                source,
            });
        }
    }

    #[cfg(not(windows))]
    {
        if let Err(source) = fs::rename(tmp, path) {
            return Err(AppError::IoContext {
                context: format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
                source,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn private_live_writes_restrict_new_and_existing_files() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let json_path = dir.path().join("nested/auth.json");
        let toml_path = dir.path().join("nested/config.toml");
        for existing in [false, true] {
            if existing {
                for path in [&json_path, &toml_path] {
                    fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
                }
            }
            write_json_file_private(&json_path, &serde_json::json!({"key":"test"})).unwrap();
            write_text_file_private(&toml_path, "key = \"test\"\n").unwrap();
            for path in [&json_path, &toml_path] {
                assert_eq!(
                    fs::metadata(path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn atomic_write_preserves_destination_when_windows_replace_fails() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, b"old contents").unwrap();
        let held_file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)
            .unwrap();

        let result = atomic_write(&path, b"new contents");

        assert!(result.is_err());
        drop(held_file);
        assert_eq!(std::fs::read(&path).unwrap(), b"old contents");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    fn assert_atomic_write_replaces_existing_file(dir: &Path) {
        let path = dir.join("atomic-write-contract.json");
        std::fs::write(&path, b"old contents").unwrap();

        atomic_write(&path, b"new contents").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new contents");
        let tmp_prefix = "atomic-write-contract.json.tmp.";
        let leftovers: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(tmp_prefix))
            .map(|entry| entry.path())
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_atomic_write_replaces_existing_file(dir.path());
    }

    #[test]
    fn a_failed_replace_keeps_the_staged_file_for_recovery() {
        let dir = tempfile::tempdir().unwrap();
        // 目标是个非空目录：替换一定失败。
        let path = dir.path().join("target");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("occupied"), b"x").unwrap();
        let staged = stage_write(&path, b"new contents", Some(0o600), false).unwrap();
        let tmp = staged.tmp_path().to_path_buf();

        assert!(commit_staged(&tmp, &path).is_err());
        assert_eq!(std::fs::read(&tmp).unwrap(), b"new contents");

        // 一次性的原子写不留临时文件。
        assert!(staged.commit().is_err());
        assert!(!tmp.exists());
    }

    /// dotfiles 用户把 settings.json 等配置软链到别的目录（#6764 / #9283）：原子写要
    /// 写透到链接指向的文件，链接本身保留，临时文件建在目标旁边、不留残留。
    #[cfg(unix)]
    #[test]
    fn atomic_write_writes_through_symlinks_and_keeps_them() {
        let dir = tempfile::tempdir().unwrap();
        let dotfiles = dir.path().join("dotfiles");
        let home = dir.path().join("home");
        std::fs::create_dir_all(&dotfiles).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        let real = dotfiles.join("settings.json");
        std::fs::write(&real, b"old contents").unwrap();
        // 相对链接 + 两跳：home/settings.json -> home/hop.json -> ../dotfiles/settings.json
        let hop = home.join("hop.json");
        let link = home.join("settings.json");
        std::os::unix::fs::symlink("../dotfiles/settings.json", &hop).unwrap();
        std::os::unix::fs::symlink("hop.json", &link).unwrap();

        atomic_write_private(&link, b"new contents").unwrap();

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(std::fs::symlink_metadata(&hop)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"new contents");
        for d in [&dotfiles, &home] {
            let leftovers: Vec<_> = std::fs::read_dir(d)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
                .filter(|name| name.contains(".tmp."))
                .collect();
            assert!(
                leftovers.is_empty(),
                "temporary files remain: {leftovers:?}"
            );
        }

        // 写入引擎的两步写（以及崩溃前滚）拿的也是链接路径。
        let staged = stage_write(&link, b"engine contents", None, false).unwrap();
        assert_eq!(
            staged.tmp_path().parent().unwrap().canonicalize().unwrap(),
            dotfiles.canonicalize().unwrap()
        );
        let tmp = staged.tmp_path().to_path_buf();
        commit_staged(&tmp, &link).unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"engine contents");
    }

    /// 链接所在目录本身是目录软链、相对目标带 `..` 时，`..` 要按真实目录回退。
    #[cfg(unix)]
    #[test]
    fn symlink_parent_dir_is_resolved_before_walking_up() {
        let dir = tempfile::tempdir().unwrap();
        let sync = dir.path().join("sync");
        let real_dir = sync.join("claude");
        std::fs::create_dir_all(&real_dir).unwrap();
        let real = sync.join("settings.json");
        std::fs::write(&real, b"old").unwrap();
        std::os::unix::fs::symlink("../settings.json", real_dir.join("settings.json")).unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        std::os::unix::fs::symlink(&real_dir, home.join(".claude")).unwrap();
        let link = home.join(".claude").join("settings.json");

        assert_eq!(resolve_symlink_target(&link), real.canonicalize().unwrap());
        atomic_write(&link, b"new").unwrap();
        assert_eq!(std::fs::read(&real).unwrap(), b"new");

        // 目标里先经过一个目录软链再回退：`sub/../other.json`，sub -> sync/claude。
        let other = sync.join("other.json");
        std::fs::write(&other, b"old").unwrap();
        std::os::unix::fs::symlink(&real_dir, home.join("sub")).unwrap();
        let link2 = home.join("other.json");
        std::os::unix::fs::symlink("sub/../other.json", &link2).unwrap();
        assert_eq!(
            resolve_symlink_target(&link2),
            other.canonicalize().unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_creates_the_target_of_a_dangling_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.json");
        let link = dir.path().join("link.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        atomic_write(&link, b"contents").unwrap();

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"contents");
    }

    #[cfg(windows)]
    #[test]
    fn derive_wsl_home_dir_from_opencode_config_dir() {
        let dir = PathBuf::from(r"\\wsl.localhost\Ubuntu-24.04\home\user\.config\opencode");
        let home = derive_wsl_home_dir(&dir).expect("WSL home should be derived");
        assert_eq!(
            home,
            PathBuf::from(r"\\wsl.localhost\Ubuntu-24.04\home\user")
        );
    }

    #[cfg(windows)]
    #[test]
    fn derive_wsl_home_dir_supports_wsl_dollar_and_root() {
        let dir = PathBuf::from(r"\\wsl$\Ubuntu\root\.config\opencode");
        let home = derive_wsl_home_dir(&dir).expect("WSL root home should be derived");
        assert_eq!(home, PathBuf::from(r"\\wsl$\Ubuntu\root"));
    }

    #[cfg(windows)]
    #[test]
    fn derive_wsl_home_dir_rejects_non_home_and_non_wsl_paths() {
        assert_eq!(
            derive_wsl_home_dir(&PathBuf::from(r"\\wsl$\Ubuntu\etc\opencode")),
            None
        );
        assert_eq!(
            derive_wsl_home_dir(&PathBuf::from(r"C:\Users\user\.config\opencode")),
            None
        );
    }

    #[test]
    fn atomic_write_replaces_existing_file_without_temp_residue() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("atomic-write-contract.json");
        std::fs::write(&path, b"old contents").unwrap();

        atomic_write(&path, b"new contents").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new contents");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("atomic-write-contract.json.tmp.")
            })
            .map(|entry| entry.path())
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );
    }

    #[test]
    fn derive_mcp_path_from_override_preserves_folder_name() {
        let override_dir = PathBuf::from("/tmp/profile/.claude");
        let derived = derive_mcp_path_from_override(&override_dir)
            .expect("should derive path for nested dir");
        assert_eq!(derived, PathBuf::from("/tmp/profile/.claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_override_handles_non_hidden_folder() {
        let override_dir = PathBuf::from("/data/claude-config");
        let derived = derive_mcp_path_from_override(&override_dir)
            .expect("should derive path for standard dir");
        assert_eq!(derived, PathBuf::from("/data/claude-config.json"));
    }

    #[test]
    fn derive_mcp_path_from_override_supports_relative_rootless_dir() {
        let override_dir = PathBuf::from("claude");
        let derived = derive_mcp_path_from_override(&override_dir)
            .expect("should derive path for single segment");
        assert_eq!(derived, PathBuf::from("claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_root_like_dir_returns_none() {
        let override_dir = PathBuf::from("/");
        assert!(derive_mcp_path_from_override(&override_dir).is_none());
    }

    #[test]
    fn sort_json_keys_sorts_top_level_object() {
        let input = serde_json::json!({
            "z": 1,
            "a": 2,
            "m": 3,
        });
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn sort_json_keys_recurses_into_nested_objects() {
        let input = serde_json::json!({
            "outer_b": {"z": 1, "a": 2},
            "outer_a": {"y": 3, "b": 4},
        });
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(
            serialized,
            r#"{"outer_a":{"b":4,"y":3},"outer_b":{"a":2,"z":1}}"#
        );
    }

    #[test]
    fn sort_json_keys_preserves_array_order() {
        let input = serde_json::json!([3, 1, 2]);
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, "[3,1,2]");
    }

    #[test]
    fn sort_json_keys_sorts_objects_inside_arrays_but_keeps_array_order() {
        let input = serde_json::json!([
            {"z": 1, "a": 2},
            {"y": 3, "b": 4},
        ]);
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, r#"[{"a":2,"z":1},{"b":4,"y":3}]"#);
    }

    #[test]
    fn sort_json_keys_passes_through_primitives() {
        let cases = vec![
            serde_json::json!("hello"),
            serde_json::json!(42),
            serde_json::json!(3.14),
            serde_json::json!(true),
            serde_json::json!(null),
        ];
        for value in cases {
            let sorted = sort_json_keys(&value);
            assert_eq!(sorted, value);
        }
    }

    #[test]
    fn sort_json_keys_handles_empty_collections() {
        let empty_obj = serde_json::json!({});
        assert_eq!(
            serde_json::to_string(&sort_json_keys(&empty_obj)).unwrap(),
            "{}"
        );

        let empty_arr = serde_json::json!([]);
        assert_eq!(
            serde_json::to_string(&sort_json_keys(&empty_arr)).unwrap(),
            "[]"
        );
    }

    #[test]
    fn sort_json_keys_produces_identical_output_for_different_insertion_orders() {
        // 核心保证：同一逻辑配置无论键的插入顺序如何，写出的字节序列必须一致。
        let mut a = Map::new();
        a.insert("env".to_string(), serde_json::json!({"PATH": "/usr/bin"}));
        a.insert("model".to_string(), serde_json::json!("claude-sonnet-4-5"));
        a.insert("permissions".to_string(), serde_json::json!({"allow": []}));

        let mut b = Map::new();
        b.insert("permissions".to_string(), serde_json::json!({"allow": []}));
        b.insert("model".to_string(), serde_json::json!("claude-sonnet-4-5"));
        b.insert("env".to_string(), serde_json::json!({"PATH": "/usr/bin"}));

        let sorted_a = sort_json_keys(&Value::Object(a));
        let sorted_b = sort_json_keys(&Value::Object(b));

        assert_eq!(
            serde_json::to_string(&sorted_a).unwrap(),
            serde_json::to_string(&sorted_b).unwrap(),
        );
    }
}

/// 复制文件
#[cfg(test)]
pub fn copy_file(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::copy(from, to).map_err(|e| AppError::IoContext {
        context: format!("复制文件失败 ({} -> {})", from.display(), to.display()),
        source: e,
    })?;
    Ok(())
}

/// 删除文件
pub fn delete_file(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
    }
    Ok(())
}
