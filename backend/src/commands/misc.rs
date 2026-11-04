#![allow(non_snake_case)]

use crate::app_config::AppType;
use crate::config::get_home_dir;
use crate::services::provider::ProviderService;
use crate::store::AppState;
use once_cell::sync::Lazy;
use regex::Regex;
use semver::Version;
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const CLI_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(serde::Serialize)]
pub struct ToolVersion {
    name: String,
    version: Option<String>,
    latest_version: Option<String>, // 新增字段：最新版本
    error: Option<String>,
    /// 工具运行环境: "windows", "wsl", "macos", "linux", "unknown"
    env_type: String,
    /// 当 env_type 为 "wsl" 时，返回该工具绑定的 WSL distro（用于按 distro 探测 shells）
    wsl_distro: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestReleaseInfo {
    current_version: Option<String>,
    latest_version: String,
    tag_name: String,
    html_url: String,
    notes: Option<String>,
    published_at: Option<String>,
    has_update: bool,
}

#[derive(Debug, serde::Deserialize)]
struct GithubLatestReleaseResponse {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
}

const WEB_GITHUB_REPO: &str = "zuoliangyu/cc-switch-web";

const VALID_TOOLS: [&str; 5] = ["claude", "codex", "gemini", "mcode", "opencode"];

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub struct WslShellPreferenceInput {
    #[serde(default)]
    pub wsl_shell: Option<String>,
    #[serde(default)]
    pub wsl_shell_flag: Option<String>,
}

// Keep platform-specific env detection in one place to avoid repeating cfg blocks.
#[cfg(target_os = "macos")]
fn tool_env_type_and_wsl_distro(_tool: &str) -> (String, Option<String>) {
    ("macos".to_string(), None)
}

#[cfg(target_os = "linux")]
fn tool_env_type_and_wsl_distro(_tool: &str) -> (String, Option<String>) {
    ("linux".to_string(), None)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn tool_env_type_and_wsl_distro(_tool: &str) -> (String, Option<String>) {
    ("unknown".to_string(), None)
}

pub async fn get_tool_versions(
    tools: Option<Vec<String>>,
    wsl_shell_by_tool: Option<HashMap<String, WslShellPreferenceInput>>,
) -> Result<Vec<ToolVersion>, String> {
    let requested: Vec<&str> = if let Some(tools) = tools.as_ref() {
        let set: std::collections::HashSet<&str> = tools.iter().map(|s| s.as_str()).collect();
        VALID_TOOLS
            .iter()
            .copied()
            .filter(|t| set.contains(t))
            .collect()
    } else {
        VALID_TOOLS.to_vec()
    };
    let mut results = Vec::new();

    for tool in requested {
        #[cfg(target_os = "windows")]
        results.push(get_single_tool_version_impl(tool, None, None).await);

        #[cfg(not(target_os = "windows"))]
        {
            let pref = wsl_shell_by_tool.as_ref().and_then(|map| map.get(tool));
            let tool_wsl_shell = pref.and_then(|value| value.wsl_shell.as_deref());
            let tool_wsl_shell_flag = pref.and_then(|value| value.wsl_shell_flag.as_deref());
            results.push(
                get_single_tool_version_impl(tool, tool_wsl_shell, tool_wsl_shell_flag).await,
            );
        }
    }

    #[cfg(target_os = "windows")]
    let _ = wsl_shell_by_tool;

    Ok(results)
}

/// 获取单个工具的版本信息（内部实现）
async fn get_single_tool_version_impl(
    tool: &str,
    wsl_shell: Option<&str>,
    wsl_shell_flag: Option<&str>,
) -> ToolVersion {
    debug_assert!(
        VALID_TOOLS.contains(&tool),
        "unexpected tool name in get_single_tool_version_impl: {tool}"
    );

    // 判断该工具的运行环境 & WSL distro（如有）
    #[cfg(target_os = "windows")]
    let (env_type, wsl_distro) = ("windows".to_string(), None);
    #[cfg(not(target_os = "windows"))]
    let (env_type, wsl_distro) = tool_env_type_and_wsl_distro(tool);

    // 使用全局 HTTP 客户端（已包含代理配置）
    let client = crate::proxy::http_client::get();

    // 1. 获取本地版本
    let (local_version, local_error) = {
        #[cfg(target_os = "windows")]
        {
            let _ = (wsl_shell, wsl_shell_flag);
            let tool = tool.to_string();
            tokio::task::spawn_blocking(move || probe_windows_cli_version(&tool))
                .await
                .unwrap_or_else(|error| (None, Some(format!("CLI probe task failed: {error}"))))
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(distro) = wsl_distro.as_deref() {
                try_get_version_wsl(tool, distro, wsl_shell, wsl_shell_flag)
            } else {
                let direct_result = try_get_version(tool);
                if direct_result.0.is_some() {
                    direct_result
                } else {
                    scan_cli_version(tool)
                }
            }
        }
    };

    // 2. 获取远程最新版本
    let latest_version = match tool {
        "claude" => fetch_npm_latest_version(&client, "@anthropic-ai/claude-code").await,
        "codex" => fetch_npm_latest_version(&client, "@openai/codex").await,
        "gemini" => fetch_npm_latest_version(&client, "@google/gemini-cli").await,
        "mcode" => fetch_npm_latest_version(&client, "@minimax-ai/code").await,
        "opencode" => fetch_github_latest_version(&client, "anomalyco/opencode").await,
        _ => None,
    };

    ToolVersion {
        name: tool.to_string(),
        version: local_version,
        latest_version,
        error: local_error,
        env_type,
        wsl_distro,
    }
}

/// 最新版本探测的单次请求超时：取不到就返回 None 由前端显示「未知」，而不是沿用全局
/// 客户端的长超时让卡片一直「加载中」（上游 556bb2ca）。
const LATEST_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// npm 包 dist-tags 专用端点的 URL。响应体就是 dist-tags 对象本身；`/{package}` 返回
/// 含全部历史版本的 packument，高频发版的包可达几十 MB。scoped 包名的 `/` 转义为 `%2f`。
fn npm_dist_tags_url(package: &str) -> String {
    format!(
        "https://registry.npmjs.org/-/package/{}/dist-tags",
        package.replace('/', "%2f")
    )
}

/// Helper function to fetch latest version from npm registry
async fn fetch_npm_latest_version(client: &reqwest::Client, package: &str) -> Option<String> {
    let resp = client
        .get(npm_dist_tags_url(package))
        .timeout(LATEST_PROBE_TIMEOUT)
        .send()
        .await
        .ok()?;
    let tags = resp
        .json::<serde_json::Map<String, serde_json::Value>>()
        .await
        .ok()?;
    tags.get("latest")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Helper function to fetch latest version from GitHub releases
async fn fetch_github_latest_version(client: &reqwest::Client, repo: &str) -> Option<String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    match client
        .get(&url)
        .header("User-Agent", "cc-switch")
        .header("Accept", "application/vnd.github+json")
        .timeout(LATEST_PROBE_TIMEOUT)
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                json.get("tag_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.strip_prefix('v').unwrap_or(s).to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

pub async fn get_latest_release_info(
    current_version: Option<String>,
) -> Result<LatestReleaseInfo, String> {
    let client = crate::proxy::http_client::get();
    let url = format!("https://api.github.com/repos/{WEB_GITHUB_REPO}/releases/latest");

    let response = client
        .get(&url)
        .header("User-Agent", "cc-switch-web")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("请求 GitHub Releases 失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "请求 GitHub Releases 失败: HTTP {}",
            response.status()
        ));
    }

    let release = response
        .json::<GithubLatestReleaseResponse>()
        .await
        .map_err(|e| format!("解析 GitHub Releases 响应失败: {e}"))?;

    let latest_version = normalize_version_value(&release.tag_name);
    let normalized_current_version = current_version
        .as_deref()
        .map(normalize_version_value)
        .filter(|value| !value.is_empty());
    let has_update = normalized_current_version
        .as_deref()
        .map(|current| is_newer_version(current, &latest_version))
        .unwrap_or(false);

    Ok(LatestReleaseInfo {
        current_version: normalized_current_version,
        latest_version,
        tag_name: release.tag_name,
        html_url: release.html_url,
        notes: release
            .body
            .map(|body| body.trim().to_string())
            .filter(|body| !body.is_empty()),
        published_at: release
            .published_at
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        has_update,
    })
}

fn normalize_version_value(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .trim()
        .to_string()
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (Version::parse(current), Version::parse(latest)) {
        (Ok(current_version), Ok(latest_version)) => latest_version > current_version,
        _ => normalize_version_value(current) != normalize_version_value(latest),
    }
}

/// 预编译的版本号正则表达式
static VERSION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\d+\.\d+\.\d+(-[\w.]+)?").expect("Invalid version regex"));

/// 从版本输出中提取纯版本号
fn extract_version(raw: &str) -> String {
    VERSION_RE
        .find(raw)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| raw.to_string())
}

pub(crate) fn decode_command_output(bytes: &[u8]) -> String {
    #[cfg(target_os = "windows")]
    {
        decode_windows_command_output(bytes)
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_command_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }

    use windows_sys::Win32::Globalization::{GetACP, GetOEMCP, MultiByteToWideChar};

    fn decode_codepage(bytes: &[u8], codepage: u32) -> Option<String> {
        if codepage == 0 {
            return None;
        }
        let input_len = i32::try_from(bytes.len()).ok()?;
        // SAFETY: input and output buffers remain valid for both Win32 calls,
        // and their lengths are checked before constructing the UTF-16 slice.
        unsafe {
            let wide_len = MultiByteToWideChar(
                codepage,
                0,
                bytes.as_ptr(),
                input_len,
                std::ptr::null_mut(),
                0,
            );
            if wide_len <= 0 {
                return None;
            }
            let mut wide = vec![0u16; wide_len as usize];
            let written = MultiByteToWideChar(
                codepage,
                0,
                bytes.as_ptr(),
                input_len,
                wide.as_mut_ptr(),
                wide_len,
            );
            if written <= 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&wide[..written as usize]))
        }
    }

    let oem_codepage = unsafe { GetOEMCP() };
    if let Some(decoded) = decode_codepage(bytes, oem_codepage) {
        return decoded;
    }
    let ansi_codepage = unsafe { GetACP() };
    if ansi_codepage != oem_codepage {
        if let Some(decoded) = decode_codepage(bytes, ansi_codepage) {
            return decoded;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Windows 环境变量白名单：仅这些 `%NAME%` 占位符会被前端读取展开。
/// 与上游同名常量保持一致，覆盖 Claude Code 配置 JSON 里常见的路径变量。
const WINDOWS_ENV_WHITELIST: &[&str] = &[
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "TEMP",
    "TMP",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "PUBLIC",
    "ALLUSERSPROFILE",
];

/// 把当前后端进程能读到的、白名单内的 Windows 环境变量返回给前端。
/// 前端 `lib/windowsEnvPaths.ts` 会按此映射展开 `%USERPROFILE%` 这类占位符。
pub fn get_windows_env_paths_internal() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for name in WINDOWS_ENV_WHITELIST {
        if let Ok(val) = std::env::var(name) {
            map.insert((*name).to_string(), val);
        }
    }
    map
}

/// 尝试直接执行命令获取版本
#[cfg(not(target_os = "windows"))]
fn try_get_version(tool: &str) -> (Option<String>, Option<String>) {
    use std::process::{Command, Stdio};

    // 优先使用 $SHELL 指定的登录 shell，使其加载用户的 PATH/alias，
    // 否则像 fish/zsh 用户的检测会因 GUI 进程 PATH 缺失而误判。
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| is_valid_shell(s))
        .unwrap_or_else(|| "sh".to_string());
    let flag = default_flag_for_shell(&shell);
    let mut command = Command::new(shell);
    command
        .arg(flag)
        .arg(format!("{tool} --version"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate_child_process_group(&mut command);
    let output = command
        .spawn()
        .map_err(|error| error.to_string())
        .and_then(|child| wait_child_output(child, Some(CLI_PROBE_TIMEOUT)));

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if raw.is_empty() {
                    (None, Some("not installed or not executable".to_string()))
                } else {
                    (Some(extract_version(raw)), None)
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                (
                    None,
                    Some(if err.is_empty() {
                        "not installed or not executable".to_string()
                    } else {
                        err
                    }),
                )
            }
        }
        Err(e) => (None, Some(e)),
    }
}

/// 校验 WSL 发行版名称是否合法
/// WSL 发行版名称只允许字母、数字、连字符和下划线
#[cfg(all(target_os = "windows", test))]
fn is_valid_wsl_distro_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Validate that the given shell name is one of the allowed shells.
#[cfg(any(not(target_os = "windows"), test))]
fn is_valid_shell(shell: &str) -> bool {
    matches!(
        shell.rsplit('/').next().unwrap_or(shell),
        "sh" | "bash" | "zsh" | "fish" | "dash"
    )
}

/// Validate that the given shell flag is one of the allowed flags.
#[cfg(all(target_os = "windows", test))]
fn is_valid_shell_flag(flag: &str) -> bool {
    matches!(flag, "-c" | "-lc" | "-lic")
}

/// Return the default invocation flag for the given shell.
#[cfg(any(not(target_os = "windows"), test))]
fn default_flag_for_shell(shell: &str) -> &'static str {
    match shell.rsplit('/').next().unwrap_or(shell) {
        "dash" | "sh" => "-c",
        "fish" => "-lc",
        _ => "-lic",
    }
}

/// 非 Windows 平台的 WSL 版本检测存根
/// 注意：此函数实际上不会被调用，因为 `wsl_distro_from_path` 在非 Windows 平台总是返回 None。
/// 保留此函数是为了保持 API 一致性，防止未来重构时遗漏。
#[cfg(not(target_os = "windows"))]
fn try_get_version_wsl(
    _tool: &str,
    _distro: &str,
    _force_shell: Option<&str>,
    _force_shell_flag: Option<&str>,
) -> (Option<String>, Option<String>) {
    (
        None,
        Some("WSL check not supported on this platform".to_string()),
    )
}

fn push_unique_path(paths: &mut Vec<std::path::PathBuf>, path: std::path::PathBuf) {
    if path.as_os_str().is_empty() {
        return;
    }

    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn push_env_single_dir(paths: &mut Vec<std::path::PathBuf>, value: Option<std::ffi::OsString>) {
    if let Some(raw) = value {
        push_unique_path(paths, std::path::PathBuf::from(raw));
    }
}

fn extend_from_path_list(
    paths: &mut Vec<std::path::PathBuf>,
    value: Option<std::ffi::OsString>,
    suffix: Option<&str>,
) {
    if let Some(raw) = value {
        for p in std::env::split_paths(&raw) {
            let dir = match suffix {
                Some(s) => p.join(s),
                None => p,
            };
            push_unique_path(paths, dir);
        }
    }
}

/// OpenCode install.sh 路径优先级（见 https://github.com/anomalyco/opencode README）:
///   $OPENCODE_INSTALL_DIR > $XDG_BIN_DIR > $HOME/bin > $HOME/.opencode/bin
/// 额外扫描 Bun 默认全局安装路径（~/.bun/bin）
/// 和 Go 安装路径（~/go/bin、$GOPATH/*/bin）。
fn opencode_extra_search_paths(
    home: &Path,
    opencode_install_dir: Option<std::ffi::OsString>,
    xdg_bin_dir: Option<std::ffi::OsString>,
    gopath: Option<std::ffi::OsString>,
) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    push_env_single_dir(&mut paths, opencode_install_dir);
    push_env_single_dir(&mut paths, xdg_bin_dir);

    if !home.as_os_str().is_empty() {
        push_unique_path(&mut paths, home.join("bin"));
        push_unique_path(&mut paths, home.join(".opencode").join("bin"));
        push_unique_path(&mut paths, home.join(".bun").join("bin"));
        push_unique_path(&mut paths, home.join("go").join("bin"));
    }

    extend_from_path_list(&mut paths, gopath, Some("bin"));

    paths
}

/// MiniMax's installer uses the root on Windows and its bin directory on POSIX.
fn mcode_extra_search_paths(home: &Path, install_dir: Option<std::ffi::OsString>) -> Vec<PathBuf> {
    let launcher_dir = |root: PathBuf| {
        if cfg!(target_os = "windows") {
            root
        } else {
            root.join("bin")
        }
    };
    let mut paths = Vec::new();
    if let Some(root) = install_dir.filter(|value| !value.is_empty()) {
        push_unique_path(&mut paths, launcher_dir(PathBuf::from(root)));
    }
    if !home.as_os_str().is_empty() {
        push_unique_path(&mut paths, launcher_dir(home.join(".minimax-code")));
    }
    paths
}

fn tool_executable_candidates(tool: &str, dir: &Path) -> Vec<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            dir.join(format!("{tool}.cmd")),
            dir.join(format!("{tool}.exe")),
            dir.join(tool),
        ]
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![dir.join(tool)]
    }
}

#[cfg(target_os = "windows")]
fn effective_path_string() -> String {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let process = std::env::var("PATH").unwrap_or_default();
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .and_then(|key| key.get_value::<String, &str>("Path"))
        .map(|raw| expand_env_chars(&raw))
        .unwrap_or_default();
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        .and_then(|key| key.get_value::<String, &str>("Path"))
        .map(|raw| expand_env_chars(&raw))
        .unwrap_or_default();
    // fnm 的默认 Node 别名排在最后：只在 `fnm env` shell 里可见的 Node 也能找到，显式 PATH 仍优先。
    let fnm = fnm_default_alias_dir_candidates(
        std::env::var_os("FNM_DIR"),
        &dirs::home_dir().unwrap_or_default(),
        dirs::data_dir(),
    )
    .into_iter()
    .filter(|dir| dir.is_dir())
    .map(|dir| dir.to_string_lossy().into_owned())
    .collect::<Vec<_>>()
    .join(";");
    merge_path_segments_win(&[&process, &user, &machine, &fnm])
}

/// fnm only puts Node on PATH through `fnm env`, which prepends a per-shell
/// `%LOCALAPPDATA%\fnm_multishells\<id>` link to that shell's PATH. Nothing is
/// written to the registry PATH, so a service launched outside that shell sees neither
/// node, npm nor the npm global CLIs (#8484). `<fnm dir>\aliases\default` is a
/// stable link to the default Node installation; on Windows node.exe, npm.cmd
/// and npm global commands live directly in that directory (no `bin`).
///
/// Mirrors fnm's own base-dir lookup: `FNM_DIR`, then the legacy `~\.fnm`, then
/// `%APPDATA%\fnm`. Callers keep only the directories that exist.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn fnm_default_alias_dir_candidates(
    fnm_dir: Option<std::ffi::OsString>,
    home: &Path,
    data_dir: Option<std::path::PathBuf>,
) -> Vec<std::path::PathBuf> {
    let mut bases = Vec::new();
    if let Some(dir) = fnm_dir.filter(|value| !value.is_empty()) {
        push_unique_path(&mut bases, std::path::PathBuf::from(dir));
    }
    if !home.as_os_str().is_empty() {
        push_unique_path(&mut bases, home.join(".fnm"));
    }
    if let Some(data_dir) = data_dir {
        push_unique_path(&mut bases, data_dir.join("fnm"));
    }
    bases
        .into_iter()
        .map(|base| base.join("aliases").join("default"))
        .collect()
}

#[cfg(target_os = "windows")]
fn effective_path_os() -> Option<std::ffi::OsString> {
    Some(std::ffi::OsString::from(effective_path_string()))
}

#[cfg(not(target_os = "windows"))]
fn effective_path_os() -> Option<std::ffi::OsString> {
    std::env::var_os("PATH")
}

#[cfg(target_os = "windows")]
fn expand_env_chars(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(open) = rest.find('%') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('%') {
            None => {
                out.push('%');
                out.push_str(after);
                rest = "";
                break;
            }
            Some(close) => {
                let name = &after[..close];
                let is_ident = !name.is_empty()
                    && name
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == '_');
                if is_ident {
                    match std::env::var(name) {
                        Ok(value) => out.push_str(&value),
                        Err(_) => {
                            out.push('%');
                            out.push_str(name);
                            out.push('%');
                        }
                    }
                } else {
                    out.push('%');
                    out.push_str(name);
                    out.push('%');
                }
                rest = &after[close + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(target_os = "windows")]
fn merge_path_segments_win(parts: &[&str]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();
    for part in parts {
        for segment in part.split(';') {
            let segment = segment.trim();
            if !segment.is_empty() && seen.insert(segment.to_ascii_lowercase()) {
                merged.push(segment);
            }
        }
    }
    merged.join(";")
}

#[cfg(not(target_os = "windows"))]
fn prepend_search_dir_to_path(dir: &Path, current_path: &std::ffi::OsStr) -> std::ffi::OsString {
    let mut path = dir.as_os_str().to_os_string();
    if !current_path.is_empty() {
        path.push(":");
        path.push(current_path);
    }
    path
}

fn extend_from_cli_path_env(
    paths: &mut Vec<std::path::PathBuf>,
    value: Option<std::ffi::OsString>,
) {
    if let Some(raw) = value {
        for path in std::env::split_paths(&raw) {
            #[cfg(target_os = "windows")]
            if is_windows_app_execution_alias_dir(&path) {
                continue;
            }
            push_unique_path(paths, path);
        }
    }
}

#[cfg(target_os = "windows")]
fn extend_windows_cli_manager_search_paths(paths: &mut Vec<std::path::PathBuf>, home: &Path) {
    if let Some(nvm_home) = std::env::var_os("NVM_HOME") {
        push_unique_path(paths, std::path::PathBuf::from(nvm_home));
    }
    if let Some(appdata) = dirs::data_dir() {
        push_unique_path(paths, appdata.join("nvm"));
    }
    if !home.as_os_str().is_empty() {
        push_unique_path(paths, home.join("scoop").join("shims"));
    }
    if let Some(local_data) = dirs::data_local_dir() {
        push_unique_path(paths, local_data.join("pnpm"));
        push_unique_path(paths, local_data.join("Volta").join("bin"));
        push_unique_path(paths, local_data.join("Yarn").join("bin"));
    }
}

#[cfg(target_os = "windows")]
fn windows_standalone_search_paths(
    tool: &str,
    local_data: Option<std::path::PathBuf>,
) -> Vec<std::path::PathBuf> {
    let Some(local_data) = local_data else {
        return Vec::new();
    };
    match tool {
        "codex" => vec![local_data
            .join("Programs")
            .join("OpenAI")
            .join("Codex")
            .join("bin")],
        "claude" => vec![local_data.join("Programs").join("claude")],
        _ => Vec::new(),
    }
}

fn build_tool_search_paths(tool: &str) -> Vec<std::path::PathBuf> {
    let home = get_home_dir();
    let mut search_paths = Vec::new();

    if tool == "mcode" {
        for path in mcode_extra_search_paths(&home, std::env::var_os("MCODE_INSTALL_DIR")) {
            push_unique_path(&mut search_paths, path);
        }
    }

    if !home.as_os_str().is_empty() {
        push_unique_path(&mut search_paths, home.join(".local/bin"));
        push_unique_path(&mut search_paths, home.join(".npm-global/bin"));
        push_unique_path(&mut search_paths, home.join("n/bin"));
        push_unique_path(&mut search_paths, home.join(".volta/bin"));
    }

    #[cfg(target_os = "macos")]
    {
        push_unique_path(
            &mut search_paths,
            std::path::PathBuf::from("/opt/homebrew/bin"),
        );
        push_unique_path(
            &mut search_paths,
            std::path::PathBuf::from("/usr/local/bin"),
        );
    }

    #[cfg(target_os = "linux")]
    {
        push_unique_path(
            &mut search_paths,
            std::path::PathBuf::from("/usr/local/bin"),
        );
        push_unique_path(&mut search_paths, std::path::PathBuf::from("/usr/bin"));
    }

    #[cfg(target_os = "windows")]
    {
        for path in windows_standalone_search_paths(tool, dirs::data_local_dir()) {
            push_unique_path(&mut search_paths, path);
        }
        if let Some(appdata) = dirs::data_dir() {
            push_unique_path(&mut search_paths, appdata.join("npm"));
        }
        push_unique_path(
            &mut search_paths,
            std::path::PathBuf::from("C:\\Program Files\\nodejs"),
        );
        extend_windows_cli_manager_search_paths(&mut search_paths, &home);
    }

    let fnm_base = home.join(".local/state/fnm_multishells");
    if let Ok(entries) = std::fs::read_dir(&fnm_base) {
        for entry in entries.flatten() {
            let bin_path = entry.path().join("bin");
            if bin_path.exists() {
                push_unique_path(&mut search_paths, bin_path);
            }
        }
    }

    let nvm_base = home.join(".nvm/versions/node");
    if let Ok(entries) = std::fs::read_dir(&nvm_base) {
        for entry in entries.flatten() {
            let bin_path = entry.path().join("bin");
            if bin_path.exists() {
                push_unique_path(&mut search_paths, bin_path);
            }
        }
    }

    if tool == "opencode" {
        for path in opencode_extra_search_paths(
            &home,
            std::env::var_os("OPENCODE_INSTALL_DIR"),
            std::env::var_os("XDG_BIN_DIR"),
            std::env::var_os("GOPATH"),
        ) {
            push_unique_path(&mut search_paths, path);
        }
    }

    extend_from_cli_path_env(&mut search_paths, effective_path_os());
    search_paths
}

#[cfg(target_os = "windows")]
fn is_windows_app_execution_alias_dir(path: &Path) -> bool {
    path.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
        .trim_end_matches('\\')
        .ends_with("\\microsoft\\windowsapps")
}

#[cfg(target_os = "windows")]
fn windows_shell_compatible_path(path: &Path) -> std::path::PathBuf {
    let raw = path.to_string_lossy();
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        std::path::PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(local) = raw.strip_prefix(r"\\?\") {
        std::path::PathBuf::from(local)
    } else {
        path.to_path_buf()
    }
}

#[cfg(target_os = "windows")]
fn windows_runnable_sibling_for_extensionless_tool(path: &Path) -> Option<std::path::PathBuf> {
    if path.extension().is_some() {
        return None;
    }
    ["cmd", "exe"]
        .iter()
        .map(|extension| path.with_extension(extension))
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn windows_system_executable(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| std::ffi::OsString::from(r"C:\Windows")),
    )
    .join("System32")
    .join(name)
}

#[cfg(target_os = "windows")]
fn build_windows_tool_version_command(tool_path: &Path, new_path: &str) -> std::process::Command {
    use std::process::Command;

    if tool_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
    {
        let shell_path = windows_shell_compatible_path(tool_path);
        let escaped = shell_path.to_string_lossy().replace('%', "%%%%");
        let mut command = Command::new(windows_system_executable("cmd.exe"));
        command
            .args(["/D", "/S", "/C"])
            .raw_arg(format!("call \"{escaped}\" --version"))
            .env("PATH", new_path)
            .creation_flags(CREATE_NO_WINDOW);
        return command;
    }

    let mut command = Command::new(tool_path);
    command
        .arg("--version")
        .env("PATH", new_path)
        .creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn windows_path_lookup_command(
    tool: &str,
    effective_path: &std::ffi::OsStr,
) -> std::process::Command {
    use std::process::Command;

    let mut command = Command::new(windows_system_executable("where.exe"));
    command
        .arg(format!("$PATH:{tool}"))
        .env("PATH", effective_path)
        .creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn resolve_windows_path_default(tool: &str) -> Result<Option<std::path::PathBuf>, String> {
    use std::process::Stdio;

    let current_path = effective_path_os().unwrap_or_default();
    let mut command = windows_path_lookup_command(tool, &current_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .spawn()
        .map_err(|error| format!("Failed to locate {tool}: {error}"))
        .and_then(|child| wait_child_output(child, Some(CLI_PROBE_TIMEOUT)))?;
    if !output.status.success() {
        return Ok(None);
    }

    let raw = decode_command_output(&output.stdout);
    let Some(first) = raw.lines().map(str::trim).find(|line| {
        !line.is_empty()
            && !is_windows_app_execution_alias_dir(
                Path::new(line).parent().unwrap_or_else(|| Path::new("")),
            )
    }) else {
        return Ok(None);
    };
    let path = Path::new(first);
    let preferred =
        windows_runnable_sibling_for_extensionless_tool(path).unwrap_or_else(|| path.to_path_buf());
    Ok(std::fs::canonicalize(preferred).ok())
}

fn output_to_version_result(output: std::process::Output) -> (Option<String>, Option<String>) {
    let stdout = decode_command_output(&output.stdout).trim().to_string();
    let stderr = decode_command_output(&output.stderr).trim().to_string();
    if output.status.success() {
        let raw = if stdout.is_empty() { &stderr } else { &stdout };
        if raw.is_empty() {
            (None, Some("not installed or not executable".to_string()))
        } else {
            (Some(extract_version(raw)), None)
        }
    } else {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        (
            None,
            Some(if detail.is_empty() {
                "not installed or not executable".to_string()
            } else {
                detail
            }),
        )
    }
}

#[cfg(target_os = "windows")]
fn run_windows_version_probe(
    tool_path: &Path,
    new_path: &str,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;

    let mut command = build_windows_tool_version_command(tool_path, new_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|error| error.to_string())
        .and_then(|child| wait_child_output(child, Some(CLI_PROBE_TIMEOUT)))
}

#[cfg(not(target_os = "windows"))]
fn run_non_windows_version_probe(
    tool_path: &Path,
    new_path: &std::ffi::OsStr,
) -> Result<std::process::Output, String> {
    use std::process::{Command, Stdio};

    let mut command = Command::new(tool_path);
    command
        .arg("--version")
        .env("PATH", new_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate_child_process_group(&mut command);
    command
        .spawn()
        .map_err(|error| error.to_string())
        .and_then(|child| wait_child_output(child, Some(CLI_PROBE_TIMEOUT)))
}

#[cfg(target_os = "windows")]
fn probe_windows_cli_version(tool: &str) -> (Option<String>, Option<String>) {
    match resolve_windows_path_default(tool) {
        Ok(Some(path)) => {
            let current_path = effective_path_string();
            match run_windows_version_probe(&path, &current_path) {
                Ok(output) => {
                    let result = output_to_version_result(output);
                    if result.0.is_some()
                        || result.1.as_deref() != Some("not installed or not executable")
                    {
                        return result;
                    }
                }
                Err(error) => return (None, Some(error)),
            }
        }
        Ok(None) => {}
        Err(error) => log::debug!("Windows PATH lookup for {tool} failed: {error}"),
    }
    scan_cli_version(tool)
}

/// 扫描常见路径查找 CLI，所有候选探测均有明确超时。
fn scan_cli_version(tool: &str) -> (Option<String>, Option<String>) {
    let search_paths = build_tool_search_paths(tool);
    #[cfg(target_os = "windows")]
    let current_path = effective_path_string();
    #[cfg(not(target_os = "windows"))]
    let current_path = effective_path_os().unwrap_or_default();
    let mut diagnostic = None;

    for path in &search_paths {
        #[cfg(target_os = "windows")]
        let new_path = format!("{};{}", path.display(), current_path);
        #[cfg(not(target_os = "windows"))]
        let new_path = prepend_search_dir_to_path(path, &current_path);

        for tool_path in tool_executable_candidates(tool, path) {
            if !tool_path.is_file() {
                continue;
            }
            #[cfg(target_os = "windows")]
            let output = run_windows_version_probe(&tool_path, &new_path);
            #[cfg(not(target_os = "windows"))]
            let output = run_non_windows_version_probe(&tool_path, &new_path);

            match output {
                Ok(output) => {
                    let result = output_to_version_result(output);
                    if result.0.is_some() {
                        return result;
                    }
                    if diagnostic.is_none() {
                        diagnostic = result.1;
                    }
                }
                Err(error) if diagnostic.is_none() => diagnostic = Some(error),
                Err(_) => {}
            }
        }
    }

    (
        None,
        Some(diagnostic.unwrap_or_else(|| "not installed or not executable".to_string())),
    )
}

#[cfg(target_os = "windows")]
fn terminate_child_tree(child: &mut std::process::Child) -> bool {
    use std::process::{Command, Stdio};

    let status = Command::new(windows_system_executable("taskkill.exe"))
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    matches!(status, Ok(status) if status.success()) || child.kill().is_ok()
}

#[cfg(not(target_os = "windows"))]
fn terminate_child_tree(child: &mut std::process::Child) -> bool {
    let process_group = -(child.id() as libc::pid_t);
    // SAFETY: probe commands enter a dedicated session before spawn.
    (unsafe { libc::kill(process_group, libc::SIGKILL) == 0 }) || child.kill().is_ok()
}

#[cfg(not(target_os = "windows"))]
fn isolate_child_process_group(command: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;

    // SAFETY: setsid is async-signal-safe and the freshly forked child is not
    // a process-group leader, so creating a detached probe session is valid.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

fn wait_child_output(
    mut child: std::process::Child,
    timeout: Option<std::time::Duration>,
) -> Result<std::process::Output, String> {
    use std::io::Read;

    let started_at = std::time::Instant::now();
    let stdout_handle = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    });
    let stderr_handle = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    });

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if timeout.is_some_and(|limit| started_at.elapsed() >= limit) {
                    if terminate_child_tree(&mut child) {
                        let _ = child.wait();
                    }
                    drop(stdout_handle);
                    drop(stderr_handle);
                    return Err(format!(
                        "Command timed out after {}s",
                        timeout.unwrap_or_default().as_secs()
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => {
                if terminate_child_tree(&mut child) {
                    let _ = child.wait();
                }
                return Err(format!("Failed to wait for command: {error}"));
            }
        }
    };

    if let Some(limit) = timeout {
        while stdout_handle
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
            || stderr_handle
                .as_ref()
                .is_some_and(|handle| !handle.is_finished())
        {
            if started_at.elapsed() >= limit {
                let _ = terminate_child_tree(&mut child);
                drop(stdout_handle);
                drop(stderr_handle);
                return Err(format!("Command timed out after {}s", limit.as_secs()));
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    let stdout = stdout_handle
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_handle
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

pub(crate) fn open_provider_terminal_internal(
    state: &AppState,
    app: String,
    provider_id: String,
    cwd: Option<String>,
) -> Result<bool, String> {
    let app_type = AppType::from_str(&app).map_err(|e| e.to_string())?;
    let launch_cwd = resolve_launch_cwd(cwd)?;

    let providers = ProviderService::list(state, app_type.clone())
        .map_err(|e| format!("获取提供商列表失败: {e}"))?;
    let provider = providers
        .get(&provider_id)
        .ok_or_else(|| format!("提供商 {provider_id} 不存在"))?;

    if app_type == AppType::Agy {
        futures::executor::block_on(switch_agy_to_bound_account(provider))?;
        open_agy_terminal(provider, None, launch_cwd.as_deref())?;
        return Ok(true);
    }

    if app_type == AppType::Claude {
        use crate::services::provider::claude_official::{terminal_account, AccountTerminal};
        let config_dir = match terminal_account(provider).map_err(|e| e.to_string())? {
            Some(AccountTerminal::Dir(config_dir)) => {
                crate::services::claude_account::sync_shared(&config_dir);
                Some(Some(config_dir))
            }
            Some(AccountTerminal::Default) => {
                crate::services::provider::claude_official::ensure_default_terminal_is_official(
                    &state.db,
                )
                .map_err(|e| e.to_string())?;
                Some(None)
            }
            None => None,
        };
        if let Some(config_dir) = config_dir {
            let command = claude_account_launch_command(&provider.id, config_dir)?;
            launch_terminal_command(&command, launch_cwd.as_deref(), None)
                .map_err(|e| format!("启动终端失败: {e}"))?;
            return Ok(true);
        }
    }

    let env_vars = extract_env_vars_from_config(&provider.settings_config, &app_type);
    // Claude Code 的临时 settings 叠在用户级 settings.json 上：切到这张卡会清掉、卡上又没有的
    // 键要挡住，路由 / 聚合模式的占位凭据和别家的模型名才不会漏进这个终端。
    let drops = if app_type == AppType::Claude {
        crate::services::provider::claude_switch_drops(state, &provider.settings_config)
            .unwrap_or_else(|e| {
                log::warn!("计算终端要挡住的 live 键失败，按原样启动: {e}");
                Default::default()
            })
    } else {
        Default::default()
    };
    launch_terminal_with_env(
        env_vars,
        &provider_id,
        &provider.name,
        &drops,
        launch_cwd.as_deref(),
    )
    .map_err(|e| format!("启动终端失败: {e}"))?;

    Ok(true)
}

/// 绑了 Antigravity 账号的官方卡：打开终端前先把 agy 的全局登录切到那个账号（只支持 macOS 钥匙串，
/// 其他平台忽略绑定，与上游一致）。
async fn switch_agy_to_bound_account(provider: &crate::provider::Provider) -> Result<(), String> {
    if !crate::services::provider::agy_direct::is_official(provider) {
        return Ok(());
    }
    let Some(account_id) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("agy_oauth"))
        .filter(|id| !id.trim().is_empty())
    else {
        return Ok(());
    };
    if !crate::services::agy_account::keychain::supported() {
        log::info!("[AgyAccount] 这个平台不能切号，忽略卡片绑定的账号");
        return Ok(());
    }
    let accounts = crate::commands::agy_account_manager();
    if !accounts
        .list()
        .await
        .iter()
        .any(|account| account.id == account_id)
    {
        return Err(crate::error::AppError::localized(
            "agy.account.bound_missing",
            format!(
                "「{}」绑定的 Antigravity 账号不在这台电脑的授权中心里：请先在授权中心添加它，或编辑这张卡改选账号",
                provider.name
            ),
            format!(
                "The Antigravity account bound to \"{}\" is not in this computer's Auth Center. Add it there, or edit the card to choose another account.",
                provider.name
            ),
        )
        .to_string());
    }
    accounts
        .switch_to(&account_id)
        .await
        .map_err(|error| error.to_string())
}

/// Antigravity CLI 的「打开终端」（上游 agy_terminal_launch 的 Web 版）：官方登录卡跑 `agy`，
/// 卡上设了模型就加 `--model`（只对这次会话生效）；Key 卡用它的私有 `--gemini_dir`，Key 和
/// 地址只经这一个 agy 进程的环境传入，不进命令行。`conversation` 用来恢复 Key 卡的会话。
pub(crate) fn open_agy_terminal(
    provider: &crate::provider::Provider,
    conversation: Option<&str>,
    cwd: Option<&Path>,
) -> Result<(), String> {
    let launch = crate::services::provider::agy_direct::terminal_launch(provider)
        .map_err(|e| e.to_string())?;
    // 只有 Key 卡有私有目录；卡上已经没有 Key 时私有目录对不上，不退回官方登录。
    if conversation.is_some() && launch.gemini_dir.is_none() {
        return Err(format!(
            "「{}」已不再带 API Key，无法恢复它在私有目录里的会话",
            provider.name
        ));
    }
    let mut args = Vec::new();
    if let Some(dir) = &launch.gemini_dir {
        args.push(format!("--gemini_dir={}", dir.to_string_lossy()));
    }
    if let Some(model) = &launch.model {
        args.push(format!("--model={model}"));
    }
    if let Some(conversation) = conversation {
        args.push(format!("--conversation={conversation}"));
    }
    let command = env_launch_command("agy", &provider.id, &args, &launch.env)?;
    launch_terminal_command(&command, cwd, None).map_err(|e| format!("启动终端失败: {e}"))
}

/// 恢复 Antigravity 第三方 Key 模式的会话：和「打开终端」同样带私有目录和 Key，再接上
/// `--conversation`。
pub(crate) fn open_agy_resume_terminal(
    provider: &crate::provider::Provider,
    conversation: &str,
    cwd: Option<String>,
) -> Result<(), String> {
    let cwd = resolve_launch_cwd(cwd)?;
    open_agy_terminal(provider, Some(conversation), cwd.as_deref())
}

/// macOS / Linux：环境变量写进只有本人可读的临时文件，命令里先读入再删掉（启动脚本本身是 0755，
/// 不能直接写 Key）。
#[cfg(not(target_os = "windows"))]
fn env_launch_command(
    program: &str,
    provider_id: &str,
    args: &[String],
    env: &[(&'static str, Option<String>)],
) -> Result<String, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut command = String::new();
    if !env.is_empty() {
        let safe_id: String = provider_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .take(32)
            .collect();
        let env_file = std::env::temp_dir().join(format!(
            "cc_switch_{program}_env_{safe_id}_{}_{}.sh",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        let mut content = String::new();
        for (key, value) in env {
            match value {
                Some(value) => {
                    content.push_str(&format!("export {key}={}\n", shell_single_quote(value)))
                }
                None => content.push_str(&format!("unset {key}\n")),
            }
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&env_file)
            .map_err(|e| format!("写入 {program} 环境文件失败: {e}"))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("写入 {program} 环境文件失败: {e}"))?;
        let path = shell_single_quote(&env_file.to_string_lossy());
        command.push_str(&format!(". {path}; rm -f {path}; "));
    }
    command.push_str(program);
    for arg in args {
        command.push(' ');
        command.push_str(&shell_single_quote(arg));
    }
    Ok(command)
}

/// Windows：环境变量用 `set` 写进 %TEMP% 下的启动批处理（运行后自删），只作用于这个终端。
#[cfg(target_os = "windows")]
fn env_launch_command(
    program: &str,
    _provider_id: &str,
    args: &[String],
    env: &[(&'static str, Option<String>)],
) -> Result<String, String> {
    let batch_value = |value: &str| -> Result<String, String> {
        if value.contains('"') || value.contains('\r') || value.contains('\n') {
            return Err(format!("{program} 启动参数不能包含引号或换行"));
        }
        Ok(value.replace('%', "%%"))
    };
    let mut lines = Vec::new();
    for (key, value) in env {
        match value {
            Some(value) => lines.push(format!("set \"{key}={}\"", batch_value(value)?)),
            None => lines.push(format!("set \"{key}=\"")),
        }
    }
    let mut command = String::from(program);
    for arg in args {
        command.push_str(&format!(" \"{}\"", batch_value(arg)?));
    }
    lines.push(command);
    Ok(lines.join("\r\n"))
}

/// Claude 官方卡绑了账号：`CLAUDE_CONFIG_DIR` 放在启动环境里（不用 `--settings`）。
/// 变量在进程启动前就设好，Claude Code 一开始预取钥匙串读的就是这个账号的条目
/// （写在 settings 里的话 macOS 上前 30 秒会用默认登录的令牌）。会把它指向别处的变量一并清掉；
/// `None` 是账号正在默认槽位里，去掉 `CLAUDE_CONFIG_DIR` 用默认目录。
fn claude_account_launch_command(
    provider_id: &str,
    config_dir: Option<std::path::PathBuf>,
) -> Result<String, String> {
    let mut env: Vec<(&'static str, Option<String>)> =
        crate::services::claude_account::login::CLAUDE_ACCOUNT_UNSET
            .iter()
            .map(|name| (*name, None))
            .collect();
    env.push((
        "CLAUDE_CONFIG_DIR",
        config_dir.map(|dir| dir.to_string_lossy().into_owned()),
    ));
    env_launch_command("claude", provider_id, &[], &env)
}

pub(crate) fn launch_terminal_command_internal(
    command: String,
    cwd: Option<String>,
    custom_config: Option<String>,
) -> Result<bool, String> {
    let launch_command = sanitize_terminal_command(command)?;
    let launch_cwd = resolve_launch_cwd(cwd)?;

    launch_terminal_command(
        &launch_command,
        launch_cwd.as_deref(),
        custom_config.as_deref(),
    )
    .map_err(|e| format!("启动终端失败: {e}"))?;

    Ok(true)
}

fn extract_env_vars_from_config(
    config: &serde_json::Value,
    app_type: &AppType,
) -> Vec<(String, String)> {
    let mut env_vars = Vec::new();

    let Some(obj) = config.as_object() else {
        return env_vars;
    };

    if let Some(env) = obj.get("env").and_then(|value| value.as_object()) {
        for (key, value) in env {
            if let Some(str_val) = value.as_str() {
                env_vars.push((key.clone(), str_val.to_string()));
            }
        }

        let base_url_key = match app_type {
            AppType::Claude => Some("ANTHROPIC_BASE_URL"),
            AppType::Gemini => Some("GOOGLE_GEMINI_BASE_URL"),
            _ => None,
        };

        if let Some(key) = base_url_key {
            if let Some(url_str) = env.get(key).and_then(|value| value.as_str()) {
                env_vars.push((key.to_string(), url_str.to_string()));
            }
        }
    }

    if *app_type == AppType::Codex {
        if let Some(auth) = obj.get("auth").and_then(|value| value.as_str()) {
            env_vars.push(("OPENAI_API_KEY".to_string(), auth.to_string()));
        }
    }

    if *app_type == AppType::Gemini {
        if let Some(api_key) = obj.get("api_key").and_then(|value| value.as_str()) {
            env_vars.push(("GEMINI_API_KEY".to_string(), api_key.to_string()));
        }
    }

    env_vars
}

fn resolve_launch_cwd(cwd: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(raw_path) = cwd.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };

    if raw_path.contains('\n') || raw_path.contains('\r') {
        return Err("目录路径包含非法换行符".to_string());
    }

    let path = Path::new(&raw_path);
    if !path.exists() {
        return Err(format!("目录不存在: {raw_path}"));
    }

    let resolved = std::fs::canonicalize(path).map_err(|e| format!("解析目录失败: {e}"))?;
    if !resolved.is_dir() {
        return Err(format!("选择的路径不是文件夹: {}", resolved.display()));
    }

    #[cfg(target_os = "windows")]
    let resolved = {
        let raw = resolved.to_string_lossy();
        if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{unc}"))
        } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            PathBuf::from(stripped)
        } else {
            resolved
        }
    };

    Ok(Some(resolved))
}

fn sanitize_terminal_command(command: String) -> Result<String, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("命令不能为空".to_string());
    }

    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("命令包含非法换行符".to_string());
    }

    Ok(trimmed.to_string())
}

fn launch_terminal_command(
    command: &str,
    cwd: Option<&Path>,
    _custom_config: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        launch_macos_command_terminal(command, cwd)?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        launch_linux_command_terminal(command, cwd)?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        launch_windows_command_terminal(command, cwd)?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("不支持的操作系统".to_string())
}

fn launch_terminal_with_env(
    env_vars: Vec<(String, String)>,
    provider_id: &str,
    provider_name: &str,
    drops: &crate::services::provider::SwitchDrops,
    cwd: Option<&Path>,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let config_file = temp_dir.join(format!(
        "claude_{}_{}.json",
        provider_id,
        std::process::id()
    ));

    write_claude_config(&config_file, &env_vars, provider_name, drops)?;

    #[cfg(target_os = "macos")]
    {
        launch_macos_terminal(&config_file, cwd)?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        launch_linux_terminal(&config_file, cwd)?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        launch_windows_terminal(&temp_dir, &config_file, cwd)?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("不支持的操作系统".to_string())
}

/// 写入 claude 配置文件。
///
/// 这个文件叠在用户级 `settings.json` 上：`env` 按键合并、顶层按键覆盖。所以：
/// - `modelPicker` 一定要写：它按层级整个胜出，不写的话路由 / 聚合模式的菜单会漏进这个
///   终端，选了就把别家的模型发给这张卡；
/// - 切换会清掉、卡上又没有的键（`drops`）写成空值挡住：Claude Code 把空串当没设（代理的
///   占位凭据不再随请求发出，没配的档位回到内置模型）。
fn write_claude_config(
    config_file: &Path,
    env_vars: &[(String, String)],
    provider_name: &str,
    drops: &crate::services::provider::SwitchDrops,
) -> Result<(), String> {
    use serde_json::Value;
    let mut config_obj = serde_json::Map::new();
    let mut env_obj = serde_json::Map::new();

    for (key, value) in env_vars {
        env_obj.insert(key.clone(), Value::String(value.clone()));
    }

    let model_picker = crate::live::project::claude::terminal_model_picker(&env_obj, provider_name);
    for key in drops.env.keys() {
        env_obj
            .entry(key.clone())
            .or_insert_with(|| Value::String(String::new()));
    }
    for (key, value) in &drops.top {
        let empty = match value {
            Value::String(_) => Value::String(String::new()),
            Value::Object(_) => Value::Object(serde_json::Map::new()),
            Value::Array(_) => Value::Array(Vec::new()),
            _ => continue,
        };
        config_obj.insert(key.clone(), empty);
    }
    config_obj.insert("env".to_string(), Value::Object(env_obj));
    config_obj.insert("modelPicker".to_string(), model_picker);

    let config_json =
        serde_json::to_string_pretty(&config_obj).map_err(|e| format!("序列化配置失败: {e}"))?;

    std::fs::write(config_file, config_json).map_err(|e| format!("写入配置文件失败: {e}"))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_shell_launcher_script(
    script_file: &Path,
    command: &str,
    cwd: Option<&Path>,
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let cd_command = build_shell_cd_command(cwd);
    let script_content = format!(
        r#"#!/bin/bash
trap 'rm -f "{script_file}"' EXIT
{cd_command}
{command}
exec bash --norc --noprofile
"#,
        script_file = script_file.display(),
        cd_command = cd_command,
        command = command,
    );

    std::fs::write(script_file, &script_content).map_err(|e| format!("写入启动脚本失败: {e}"))?;
    std::fs::set_permissions(script_file, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("设置脚本权限失败: {e}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_macos_command_terminal(command: &str, cwd: Option<&Path>) -> Result<(), String> {
    let preferred = crate::settings::get_preferred_terminal();
    let terminal = preferred.as_deref().unwrap_or("terminal");

    let temp_dir = std::env::temp_dir();
    let script_file = temp_dir.join(format!(
        "cc_switch_session_launcher_{}.sh",
        std::process::id()
    ));
    write_shell_launcher_script(&script_file, command, cwd)?;

    let result = match terminal {
        "iterm2" => launch_macos_iterm2(&script_file),
        "alacritty" => launch_macos_open_app("Alacritty", &script_file, true),
        "kitty" => launch_macos_open_app("kitty", &script_file, false),
        "ghostty" => launch_macos_open_app("Ghostty", &script_file, true),
        "otty" => launch_macos_otty(&script_file),
        "wezterm" => launch_macos_open_app("WezTerm", &script_file, true),
        "kaku" => launch_macos_open_app("Kaku", &script_file, true),
        _ => launch_macos_terminal_app(&script_file),
    };

    if result.is_err() && terminal != "terminal" {
        log::warn!(
            "首选终端 {} 启动失败，回退到 Terminal.app: {:?}",
            terminal,
            result.as_ref().err()
        );
        return launch_macos_terminal_app(&script_file);
    }

    result
}

#[cfg(target_os = "linux")]
fn launch_linux_command_terminal(command: &str, cwd: Option<&Path>) -> Result<(), String> {
    use std::process::Command;

    let preferred = crate::settings::get_preferred_terminal();
    let default_terminals = [
        ("gnome-terminal", vec!["--"]),
        ("konsole", vec!["-e"]),
        ("xfce4-terminal", vec!["-e"]),
        ("mate-terminal", vec!["--"]),
        ("lxterminal", vec!["-e"]),
        ("alacritty", vec!["-e"]),
        ("kitty", vec!["-e"]),
        ("ghostty", vec!["-e"]),
    ];

    let temp_dir = std::env::temp_dir();
    let script_file = temp_dir.join(format!(
        "cc_switch_session_launcher_{}.sh",
        std::process::id()
    ));
    write_shell_launcher_script(&script_file, command, cwd)?;

    let terminals_to_try: Vec<(&str, Vec<&str>)> = if let Some(ref pref) = preferred {
        let pref_args = default_terminals
            .iter()
            .find(|(name, _)| *name == pref.as_str())
            .map(|(_, args)| args.to_vec())
            .unwrap_or_else(|| vec!["-e"]);

        let mut list = vec![(pref.as_str(), pref_args)];
        for (name, args) in &default_terminals {
            if *name != pref.as_str() {
                list.push((*name, args.to_vec()));
            }
        }
        list
    } else {
        default_terminals
            .iter()
            .map(|(name, args)| (*name, args.to_vec()))
            .collect()
    };

    let mut last_error = String::from("未找到可用的终端");

    for (terminal, args) in terminals_to_try {
        let terminal_exists = Path::new(&format!("/usr/bin/{terminal}")).exists()
            || Path::new(&format!("/bin/{terminal}")).exists()
            || Path::new(&format!("/usr/local/bin/{terminal}")).exists()
            || which_command(terminal);

        if !terminal_exists {
            continue;
        }

        match Command::new(terminal)
            .args(args)
            .arg("bash")
            .arg(script_file.to_string_lossy().as_ref())
            .spawn()
        {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = format!("执行 {terminal} 失败: {error}");
            }
        }
    }

    let _ = std::fs::remove_file(&script_file);
    Err(last_error)
}

#[cfg(target_os = "windows")]
fn launch_windows_command_terminal(command: &str, cwd: Option<&Path>) -> Result<(), String> {
    let preferred = crate::settings::get_preferred_terminal();
    let terminal = preferred.as_deref().unwrap_or("cmd");

    let temp_dir = std::env::temp_dir();
    let bat_file = temp_dir.join(format!(
        "cc_switch_session_launcher_{}.bat",
        std::process::id()
    ));
    let (cwd_command, cwd_env) = build_windows_cwd_command(cwd);
    let launch_env: Vec<(&str, &str)> = cwd_env
        .as_deref()
        .map(|value| (WINDOWS_CWD_ENV, value))
        .into_iter()
        .collect();
    let content = format!(
        "@echo off\r\n{cwd_command}{command}\r\ndel \"%~f0\" >nul 2>&1\r\n",
        cwd_command = cwd_command,
        command = command,
    );

    std::fs::write(&bat_file, &content).map_err(|e| format!("写入批处理文件失败: {e}"))?;

    let bat_path = bat_file.to_string_lossy();
    let ps_cmd = format!("& '{}'", bat_path);

    let result = match terminal {
        "powershell" => run_windows_start_command_with_env(
            &[
                windows_powershell_program(&effective_path_string()),
                "-NoExit",
                "-Command",
                &ps_cmd,
            ],
            "PowerShell",
            &launch_env,
        ),
        "wt" => run_windows_start_command_with_env(
            &["wt", "cmd", "/K", &bat_path],
            "Windows Terminal",
            &launch_env,
        ),
        _ => run_windows_start_command_with_env(&["cmd", "/K", &bat_path], "cmd", &launch_env),
    };

    if result.is_err() && terminal != "cmd" {
        log::warn!(
            "首选终端 {} 启动失败，回退到 cmd: {:?}",
            terminal,
            result.as_ref().err()
        );
        return run_windows_start_command_with_env(&["cmd", "/K", &bat_path], "cmd", &launch_env);
    }

    result
}

#[cfg(target_os = "macos")]
fn launch_macos_terminal(config_file: &Path, cwd: Option<&Path>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let preferred = crate::settings::get_preferred_terminal();
    let terminal = preferred.as_deref().unwrap_or("terminal");

    let temp_dir = std::env::temp_dir();
    let script_file = temp_dir.join(format!("cc_switch_launcher_{}.sh", std::process::id()));
    let config_path = config_file.to_string_lossy();
    let cd_command = build_shell_cd_command(cwd);

    let script_content = format!(
        r#"#!/bin/bash
trap 'rm -f "{config_path}" "{script_file}"' EXIT
{cd_command}
echo "Using provider-specific claude config:"
echo "{config_path}"
claude --settings "{config_path}"
exec bash --norc --noprofile
"#,
        config_path = config_path,
        script_file = script_file.display(),
        cd_command = cd_command,
    );

    std::fs::write(&script_file, &script_content).map_err(|e| format!("写入启动脚本失败: {e}"))?;
    std::fs::set_permissions(&script_file, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("设置脚本权限失败: {e}"))?;

    let result = match terminal {
        "iterm2" => launch_macos_iterm2(&script_file),
        "alacritty" => launch_macos_open_app("Alacritty", &script_file, true),
        "kitty" => launch_macos_open_app("kitty", &script_file, false),
        "ghostty" => launch_macos_open_app("Ghostty", &script_file, true),
        "otty" => launch_macos_otty(&script_file),
        "wezterm" => launch_macos_open_app("WezTerm", &script_file, true),
        "kaku" => launch_macos_open_app("Kaku", &script_file, true),
        _ => launch_macos_terminal_app(&script_file),
    };

    if result.is_err() && terminal != "terminal" {
        log::warn!(
            "首选终端 {} 启动失败，回退到 Terminal.app: {:?}",
            terminal,
            result.as_ref().err()
        );
        return launch_macos_terminal_app(&script_file);
    }

    result
}

#[cfg(target_os = "macos")]
fn launch_macos_terminal_app(script_file: &Path) -> Result<(), String> {
    use std::process::Command;

    let applescript = format!(
        r#"tell application "Terminal"
    activate
    do script "bash '{}'"
end tell"#,
        script_file.display()
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&applescript)
        .output()
        .map_err(|e| format!("执行 osascript 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Terminal.app 执行失败 (exit code: {:?}): {}",
            output.status.code(),
            stderr
        ));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn launch_linux_terminal(config_file: &Path, cwd: Option<&Path>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    let preferred = crate::settings::get_preferred_terminal();

    let default_terminals = [
        ("gnome-terminal", vec!["--"]),
        ("konsole", vec!["-e"]),
        ("xfce4-terminal", vec!["-e"]),
        ("mate-terminal", vec!["--"]),
        ("lxterminal", vec!["-e"]),
        ("alacritty", vec!["-e"]),
        ("kitty", vec!["-e"]),
        ("ghostty", vec!["-e"]),
    ];

    let temp_dir = std::env::temp_dir();
    let script_file = temp_dir.join(format!("cc_switch_launcher_{}.sh", std::process::id()));
    let config_path = config_file.to_string_lossy();
    let cd_command = build_shell_cd_command(cwd);

    let script_content = format!(
        r#"#!/bin/bash
trap 'rm -f "{config_path}" "{script_file}"' EXIT
{cd_command}
echo "Using provider-specific claude config:"
echo "{config_path}"
claude --settings "{config_path}"
exec bash --norc --noprofile
"#,
        config_path = config_path,
        script_file = script_file.display(),
        cd_command = cd_command,
    );

    std::fs::write(&script_file, &script_content).map_err(|e| format!("写入启动脚本失败: {e}"))?;
    std::fs::set_permissions(&script_file, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("设置脚本权限失败: {e}"))?;

    let terminals_to_try: Vec<(&str, Vec<&str>)> = if let Some(ref pref) = preferred {
        let pref_args = default_terminals
            .iter()
            .find(|(name, _)| *name == pref.as_str())
            .map(|(_, args)| args.to_vec())
            .unwrap_or_else(|| vec!["-e"]);

        let mut list = vec![(pref.as_str(), pref_args)];
        for (name, args) in &default_terminals {
            if *name != pref.as_str() {
                list.push((*name, args.to_vec()));
            }
        }
        list
    } else {
        default_terminals
            .iter()
            .map(|(name, args)| (*name, args.to_vec()))
            .collect()
    };

    let mut last_error = String::from("未找到可用的终端");

    for (terminal, args) in terminals_to_try {
        let terminal_exists = Path::new(&format!("/usr/bin/{terminal}")).exists()
            || Path::new(&format!("/bin/{terminal}")).exists()
            || Path::new(&format!("/usr/local/bin/{terminal}")).exists()
            || which_command(terminal);

        if !terminal_exists {
            continue;
        }

        match Command::new(terminal)
            .args(args)
            .arg("bash")
            .arg(script_file.to_string_lossy().as_ref())
            .spawn()
        {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = format!("执行 {terminal} 失败: {error}");
            }
        }
    }

    let _ = std::fs::remove_file(&script_file);
    let _ = std::fs::remove_file(config_file);
    Err(last_error)
}

#[cfg(target_os = "linux")]
fn which_command(cmd: &str) -> bool {
    use std::process::Command;

    Command::new("which")
        .arg(cmd)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn launch_windows_terminal(
    temp_dir: &Path,
    config_file: &Path,
    cwd: Option<&Path>,
) -> Result<(), String> {
    let preferred = crate::settings::get_preferred_terminal();
    let terminal = preferred.as_deref().unwrap_or("cmd");

    let bat_file = temp_dir.join(format!("cc_switch_claude_{}.bat", std::process::id()));
    // 配置文件和 .bat 同在 temp_dir（%TEMP% 含用户名），用 %~dp0 引用：目录由 cmd
    // 运行时展开，不进 .bat 字节，非 ASCII 用户名下也不会乱码（#8034）。
    let config_name = config_file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let config_path_for_batch = format!("%~dp0{}", escape_windows_batch_value(&config_name));
    let (cwd_command, cwd_env) = build_windows_cwd_command(cwd);
    let launch_env: Vec<(&str, &str)> = cwd_env
        .as_deref()
        .map(|value| (WINDOWS_CWD_ENV, value))
        .into_iter()
        .collect();

    let content = format!(
        "@echo off\r\n{cwd_command}echo Using provider-specific claude config:\r\necho \"{config_path}\"\r\nclaude --settings \"{config_path}\"\r\ndel \"{config_path}\" >nul 2>&1\r\ndel \"%~f0\" >nul 2>&1\r\n",
        cwd_command = cwd_command,
        config_path = config_path_for_batch,
    );

    std::fs::write(&bat_file, &content).map_err(|e| format!("写入批处理文件失败: {e}"))?;

    let bat_path = bat_file.to_string_lossy();
    let ps_cmd = format!("& '{}'", bat_path);

    let result = match terminal {
        "powershell" => run_windows_start_command_with_env(
            &[
                windows_powershell_program(&effective_path_string()),
                "-NoExit",
                "-Command",
                &ps_cmd,
            ],
            "PowerShell",
            &launch_env,
        ),
        "wt" => run_windows_start_command_with_env(
            &["wt", "cmd", "/K", &bat_path],
            "Windows Terminal",
            &launch_env,
        ),
        _ => run_windows_start_command_with_env(&["cmd", "/K", &bat_path], "cmd", &launch_env),
    };

    if result.is_err() && terminal != "cmd" {
        log::warn!(
            "首选终端 {} 启动失败，回退到 cmd: {:?}",
            terminal,
            result.as_ref().err()
        );
        return run_windows_start_command_with_env(&["cmd", "/K", &bat_path], "cmd", &launch_env);
    }

    result
}

#[cfg(target_os = "macos")]
fn launch_macos_iterm2(script_file: &Path) -> Result<(), String> {
    use std::process::Command;

    let applescript = format!(
        r#"tell application "iTerm"
    activate
    tell current window
        create tab with default profile
        tell current session
            write text "bash '{}'"
        end tell
    end tell
end tell"#,
        script_file.display()
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&applescript)
        .output()
        .map_err(|e| format!("执行 osascript 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "iTerm2 执行失败 (exit code: {:?}): {}",
            output.status.code(),
            stderr
        ));
    }

    Ok(())
}

/// macOS: Otty。优先在现有窗口新建 Tab，失败再新建窗口（上游 bd15ea11）。
#[cfg(target_os = "macos")]
fn launch_macos_otty(script_file: &Path) -> Result<(), String> {
    use std::process::Command;

    let otty_cli = find_macos_otty_cli().ok_or_else(|| {
        "未找到 Otty CLI。请将 Otty 安装到 /Applications 或 ~/Applications。".to_string()
    })?;

    let command = build_macos_dash_c_command(script_file);
    let tab_result = Command::new(&otty_cli)
        .args(["tab", "new", "--window", "0", "--command", &command])
        .output()
        .map_err(|e| format!("启动 Otty CLI 失败: {e}"))?;

    if tab_result.status.success() {
        return Ok(());
    }

    log::debug!(
        "Otty 新建 Tab 失败，改为新建窗口: {}",
        decode_command_output(&tab_result.stderr)
    );

    let window_result = Command::new(&otty_cli)
        .args(["open", "--command", &command])
        .output()
        .map_err(|e| format!("启动 Otty CLI 失败: {e}"))?;

    if window_result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Otty 新建窗口失败 (exit code: {:?}): {}",
            window_result.status.code(),
            decode_command_output(&window_result.stderr)
        ))
    }
}

/// Web 端启动脚本统一由 bash 执行（与其它 macOS 终端一致）。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_macos_dash_c_command(script_file: &Path) -> String {
    format!(
        "exec bash {}",
        shell_single_quote(&script_file.to_string_lossy())
    )
}

#[cfg(target_os = "macos")]
fn find_macos_otty_cli() -> Option<std::path::PathBuf> {
    macos_otty_cli_candidates()
        .into_iter()
        .find(|path| path.is_file() && is_executable_file(path))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_otty_cli_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from(
        "/Applications/Otty.app/Contents/MacOS/otty-cli",
    )];

    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(
            std::path::PathBuf::from(home).join("Applications/Otty.app/Contents/MacOS/otty-cli"),
        );
    }

    candidates.push(std::path::PathBuf::from("/usr/local/bin/otty"));
    candidates.push(std::path::PathBuf::from("/opt/homebrew/bin/otty"));

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            candidates.push(directory.join("otty"));
            candidates.push(directory.join("otty-cli"));
        }
    }

    candidates
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_open_app(
    app_name: &str,
    script_file: &Path,
    use_e_flag: bool,
) -> Result<(), String> {
    use std::process::Command;

    let mut cmd = Command::new("open");
    cmd.arg("-a").arg(app_name).arg("--args");

    if use_e_flag {
        cmd.arg("-e");
    }
    cmd.arg("bash").arg(script_file);

    let output = cmd
        .output()
        .map_err(|e| format!("启动 {app_name} 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} 启动失败 (exit code: {:?}): {}",
            app_name,
            output.status.code(),
            stderr
        ));
    }

    Ok(())
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn build_shell_cd_command(cwd: Option<&Path>) -> String {
    cwd.map(|dir| {
        format!(
            "cd {} || exit 1\n",
            shell_single_quote(&dir.to_string_lossy())
        )
    })
    .unwrap_or_default()
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn is_windows_unc_path(path: &str) -> bool {
    path.starts_with(r"\\")
}

/// 非 ASCII 的项目目录经这个环境变量传给 Claude 启动 .bat。
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const WINDOWS_CWD_ENV: &str = "CC_SWITCH_INTERNAL_CWD";

/// 生成切到项目目录的 .bat 行，第二项是需要给启动进程设置的 `WINDOWS_CWD_ENV` 值。
///
/// cmd 按控制台代码页解码 .bat 字节，非 ASCII 路径以 UTF-8 写进文件会乱码（#8034）；
/// 环境变量在 Windows 内部保持 Unicode，所以这类路径改由环境变量传入。纯 ASCII
/// 路径照旧写进文件，不依赖终端继承环境变量（旧版 Windows Terminal 不继承）。
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn build_windows_cwd_command_str(path: &str) -> (String, Option<String>) {
    let (target, env_value, cleanup) = if path.is_ascii() {
        (escape_windows_batch_value(path), None, String::new())
    } else {
        (
            format!("%{WINDOWS_CWD_ENV}%"),
            Some(path.to_string()),
            format!("set \"{WINDOWS_CWD_ENV}=\"\r\n"),
        )
    };

    let command = if is_windows_unc_path(path) {
        // `cmd.exe` cannot make a UNC path current via `cd`; `pushd` maps it first.
        format!("pushd \"{target}\" || exit /b 1\r\n{cleanup}")
    } else {
        format!("cd /d \"{target}\" || exit /b 1\r\n{cleanup}")
    };
    (command, env_value)
}

#[cfg(target_os = "windows")]
fn build_windows_cwd_command(cwd: Option<&Path>) -> (String, Option<String>) {
    cwd.map(|dir| build_windows_cwd_command_str(&dir.to_string_lossy()))
        .unwrap_or_default()
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn escape_windows_batch_value(value: &str) -> String {
    value
        .replace('^', "^^")
        .replace('%', "%%")
        .replace('&', "^&")
        .replace('|', "^|")
        .replace('<', "^<")
        .replace('>', "^>")
        .replace('(', "^(")
        .replace(')', "^)")
}

/// 组装 `cmd /C start ...`。终端里跑的 `claude` 等命令按这里的 PATH 查找：CC Switch
/// 被 MSI 自动重启后只剩机器级 PATH（#6061），或是在装 CLI 之前就已启动，进程 PATH
/// 都会缺用户级条目（#3877、#8446）。和检测、生命周期命令（#8173）一样用补全后的 PATH，
/// 只影响启动的终端，不改 CC Switch 自身的环境；Windows Terminal 从命令行开新标签时
/// 也沿用调用方的环境。
#[cfg(target_os = "windows")]
fn windows_start_command(
    args: &[&str],
    envs: &[(&str, &str)],
    effective_path: &str,
) -> std::process::Command {
    let mut command = std::process::Command::new("cmd");
    command
        .arg("/C")
        .arg("start")
        .args(args)
        .env("PATH", effective_path)
        .envs(envs.iter().copied())
        .creation_flags(CREATE_NO_WINDOW);
    command
}

/// 首选终端为 PowerShell 时启动哪个程序。`powershell` 永远是系统自带的 Windows
/// PowerShell 5.1；装了 PowerShell 7+ 的用户默认用的是 `pwsh`，所以补全后的 PATH 里
/// 有 `pwsh.exe` 就用它，没有才退回 `powershell`。Microsoft Store 版的 `pwsh.exe` 是
/// App Execution Alias（跟随不了的重解析点），`Path::exists` 会判成不存在，这里用
/// `symlink_metadata`。
#[cfg(target_os = "windows")]
fn windows_powershell_program(path: &str) -> &'static str {
    let has_pwsh = std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .any(|dir| std::fs::symlink_metadata(dir.join("pwsh.exe")).is_ok());
    if has_pwsh {
        "pwsh"
    } else {
        "powershell"
    }
}

/// 同 `run_windows_start_command`，额外给启动的终端设置环境变量（`start` 会继承）。
///
/// stdio 指向 NUL、只等 `cmd` 的退出码，不能用 `output()` 捕获：`start` 打开的终端会
/// 继承这里的 stdout/stderr 管道句柄，管道要等那个窗口和里面的进程全部退出才到 EOF，
/// 调用就一直挂到用户关掉终端，界面也一直转圈（#6712）。启动失败仍能从退出码看出来。
#[cfg(target_os = "windows")]
fn run_windows_start_command_with_env(
    args: &[&str],
    terminal_name: &str,
    envs: &[(&str, &str)],
) -> Result<(), String> {
    use std::process::Stdio;

    let status = windows_start_command(args, envs, &effective_path_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("启动 {} 失败: {e}", terminal_name))?;

    if !status.success() {
        return Err(format!(
            "{} 启动失败 (exit code: {:?})",
            terminal_name,
            status.code()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    /// 写出临时 settings 并读回（上游 3071cae9 的终端配置用例，Web 直接测写文件这一步）。
    fn written_claude_config(
        env: &[(&str, &str)],
        drops: &crate::services::provider::SwitchDrops,
    ) -> serde_json::Value {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("claude.json");
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        super::write_claude_config(&file, &env, "DeepSeek", drops).unwrap();
        serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
    }

    #[test]
    fn claude_terminal_config_writes_the_cards_own_model_picker() {
        // 卡上显式配了档位：只列这几档，`model` 写档位别名。
        let value = written_claude_config(
            &[
                ("ANTHROPIC_MODEL", "deepseek-v4-pro"),
                ("ANTHROPIC_DEFAULT_OPUS_MODEL", "deepseek-v4-pro[1M]"),
                ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "deepseek-v4-flash"),
                ("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", "Flash"),
            ],
            &Default::default(),
        );
        assert_eq!(
            value["modelPicker"],
            serde_json::json!({
                "replaceBuiltInOptions": true,
                "options": [
                    {
                        "model": "opus",
                        "label": "Opus · deepseek-v4-pro",
                        "description": "DeepSeek · deepseek-v4-pro · 1M",
                    },
                    {
                        "model": "haiku",
                        "label": "Haiku · Flash",
                        "description": "DeepSeek · deepseek-v4-flash",
                    },
                ],
            })
        );

        // 一档都没配：空菜单，挡住用户级菜单，显示内置的；没有要挡的键时只写卡上的。
        let value = written_claude_config(
            &[("ANTHROPIC_MODEL", "deepseek-v4-pro")],
            &Default::default(),
        );
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["env", "modelPicker"]);
        assert_eq!(
            value["modelPicker"],
            serde_json::json!({ "replaceBuiltInOptions": false, "options": [] })
        );
    }

    #[test]
    fn claude_terminal_config_shadows_what_the_switch_clears() {
        let drops = crate::services::provider::SwitchDrops {
            env: serde_json::json!({
                "ANTHROPIC_AUTH_TOKEN": "PROXY_MANAGED",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "ccs-claude-kimi--k3[1M]",
            })
            .as_object()
            .unwrap()
            .clone(),
            top: serde_json::json!({
                "model": "ccs-claude-kimi--k3[1M]",
                "modelOverrides": { "a": "b" },
                "modelPicker": { "replaceBuiltInOptions": true, "options": [] },
            })
            .as_object()
            .unwrap()
            .clone(),
        };
        let value = written_claude_config(
            &[
                ("ANTHROPIC_API_KEY", "sk"),
                ("ANTHROPIC_DEFAULT_OPUS_MODEL", "deepseek-v4-pro"),
            ],
            &drops,
        );
        // 卡上有的照写，没有的写空值挡住用户级的。
        assert_eq!(value["env"]["ANTHROPIC_API_KEY"], "sk");
        assert_eq!(
            value["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"],
            "deepseek-v4-pro"
        );
        assert_eq!(value["env"]["ANTHROPIC_AUTH_TOKEN"], "");
        assert_eq!(value["model"], "");
        assert_eq!(value["modelOverrides"], serde_json::json!({}));
        // 菜单写卡自己的，不是空对象。
        assert_eq!(value["modelPicker"]["options"][0]["model"], "opus");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_powershell_program_prefers_pwsh_on_path() {
        let root = tempfile::tempdir().unwrap();
        let empty = root.path().join("empty");
        let pwsh_dir = root.path().join("PowerShell 7");
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::create_dir_all(&pwsh_dir).unwrap();
        std::fs::write(pwsh_dir.join("pwsh.exe"), "").unwrap();

        let without = empty.to_str().unwrap();
        assert_eq!(windows_powershell_program(without), "powershell");
        assert_eq!(windows_powershell_program(""), "powershell");

        let with = format!("{};{}", empty.display(), pwsh_dir.display());
        assert_eq!(windows_powershell_program(&with), "pwsh");
    }

    use super::*;

    #[test]
    fn fnm_default_alias_dir_candidates_follow_fnm_base_dir_order() {
        let home = Path::new("/home/tester");
        let data_dir = std::path::PathBuf::from("/home/tester/AppData/Roaming");
        let alias = |base: &str| {
            std::path::PathBuf::from(base)
                .join("aliases")
                .join("default")
        };

        assert_eq!(
            fnm_default_alias_dir_candidates(Some("/opt/fnm".into()), home, Some(data_dir.clone())),
            vec![
                alias("/opt/fnm"),
                alias("/home/tester/.fnm"),
                alias("/home/tester/AppData/Roaming/fnm"),
            ]
        );
        // Empty FNM_DIR / home are ignored instead of becoming relative paths.
        assert_eq!(
            fnm_default_alias_dir_candidates(Some("".into()), Path::new(""), Some(data_dir)),
            vec![alias("/home/tester/AppData/Roaming/fnm")]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_start_command_passes_restored_path_to_the_terminal() {
        let root = tempfile::tempdir().unwrap();
        let tool_dir = root.path().join("claude 用户 & bin");
        std::fs::create_dir_all(&tool_dir).unwrap();
        std::fs::write(
            tool_dir.join("cc_switch_start_test_tool.cmd"),
            "@echo restored-terminal-path\r\n@exit /b 0\r\n",
        )
        .unwrap();

        // `start /B /WAIT` runs the child in the same hidden console, so the
        // test observes what the launched terminal would resolve.
        let args = [
            "/B",
            "/WAIT",
            "cmd",
            "/D",
            "/C",
            "cc_switch_start_test_tool",
        ];
        let system_path = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
        let inherited = system_path.to_str().unwrap();
        let effective = merge_path_segments_win(&[inherited, tool_dir.to_str().unwrap()]);
        let parent_path = std::env::var_os("PATH");

        let missing = windows_start_command(&args, &[], inherited)
            .current_dir(root.path())
            .output()
            .unwrap();
        assert!(
            !decode_command_output(&missing.stdout).contains("restored-terminal-path"),
            "the tool must be absent on the narrow PATH: {missing:?}"
        );

        let restored = windows_start_command(&args, &[], &effective)
            .current_dir(root.path())
            .output()
            .unwrap();
        assert!(
            decode_command_output(&restored.stdout).contains("restored-terminal-path"),
            "{restored:?}"
        );
        assert_eq!(std::env::var_os("PATH"), parent_path);
    }

    #[test]
    fn mcode_installer_search_paths_preserve_override_priority_and_deduplicate() {
        use super::*;
        let home = PathBuf::from("test-home");
        let root = PathBuf::from("custom-mcode");
        let launcher = |path: PathBuf| {
            if cfg!(target_os = "windows") {
                path
            } else {
                path.join("bin")
            }
        };
        let default = launcher(home.join(".minimax-code"));
        assert_eq!(
            mcode_extra_search_paths(&home, Some(root.clone().into_os_string())),
            vec![launcher(root), default.clone()]
        );
        assert_eq!(
            mcode_extra_search_paths(&home, Some(home.join(".minimax-code").into_os_string())),
            vec![default.clone()]
        );
        assert_eq!(
            mcode_extra_search_paths(&home, Some(std::ffi::OsString::new())),
            vec![default]
        );
        assert!(mcode_extra_search_paths(Path::new(""), None).is_empty());
        assert!(VALID_TOOLS.contains(&"mcode"));
    }
    use std::path::PathBuf;

    // 上游 bd15ea11：Otty 启动命令与 CLI 查找路径。
    #[test]
    fn otty_launcher_command_executes_the_temporary_script() {
        assert_eq!(
            build_macos_dash_c_command(Path::new("/tmp/cc_switch_launcher.sh")),
            "exec bash '/tmp/cc_switch_launcher.sh'"
        );
        assert_eq!(
            build_macos_dash_c_command(Path::new("/tmp/it's.sh")),
            "exec bash '/tmp/it'\"'\"'s.sh'"
        );
    }

    #[test]
    fn otty_cli_candidates_include_bundle_and_installed_cli_locations() {
        let candidates = macos_otty_cli_candidates();

        assert!(candidates.contains(&PathBuf::from(
            "/Applications/Otty.app/Contents/MacOS/otty-cli"
        )));
        assert!(candidates.contains(&PathBuf::from("/usr/local/bin/otty")));
        assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin/otty")));
    }

    #[test]
    fn test_npm_dist_tags_url() {
        assert_eq!(
            npm_dist_tags_url("openclaw"),
            "https://registry.npmjs.org/-/package/openclaw/dist-tags"
        );
        assert_eq!(
            npm_dist_tags_url("@openai/codex"),
            "https://registry.npmjs.org/-/package/@openai%2fcodex/dist-tags"
        );
    }

    #[test]
    fn test_extract_version() {
        assert_eq!(extract_version("claude 1.0.20"), "1.0.20");
        assert_eq!(extract_version("v2.3.4-beta.1"), "2.3.4-beta.1");
        assert_eq!(extract_version("no version here"), "no version here");
    }

    #[cfg(target_os = "windows")]
    mod wsl_helpers {
        use super::super::*;

        #[test]
        fn test_is_valid_shell() {
            assert!(is_valid_shell("bash"));
            assert!(is_valid_shell("zsh"));
            assert!(is_valid_shell("sh"));
            assert!(is_valid_shell("fish"));
            assert!(is_valid_shell("dash"));
            assert!(is_valid_shell("/usr/bin/bash"));
            assert!(is_valid_shell("/bin/zsh"));
            assert!(!is_valid_shell("powershell"));
            assert!(!is_valid_shell("cmd"));
            assert!(!is_valid_shell(""));
        }

        #[test]
        fn test_is_valid_shell_flag() {
            assert!(is_valid_shell_flag("-c"));
            assert!(is_valid_shell_flag("-lc"));
            assert!(is_valid_shell_flag("-lic"));
            assert!(!is_valid_shell_flag("-x"));
            assert!(!is_valid_shell_flag(""));
            assert!(!is_valid_shell_flag("--login"));
        }

        #[test]
        fn test_default_flag_for_shell() {
            assert_eq!(default_flag_for_shell("sh"), "-c");
            assert_eq!(default_flag_for_shell("dash"), "-c");
            assert_eq!(default_flag_for_shell("/bin/dash"), "-c");
            assert_eq!(default_flag_for_shell("fish"), "-lc");
            assert_eq!(default_flag_for_shell("bash"), "-lic");
            assert_eq!(default_flag_for_shell("zsh"), "-lic");
            assert_eq!(default_flag_for_shell("/usr/bin/zsh"), "-lic");
        }

        #[test]
        fn test_is_valid_wsl_distro_name() {
            assert!(is_valid_wsl_distro_name("Ubuntu"));
            assert!(is_valid_wsl_distro_name("Ubuntu-22.04"));
            assert!(is_valid_wsl_distro_name("my_distro"));
            assert!(!is_valid_wsl_distro_name(""));
            assert!(!is_valid_wsl_distro_name("distro with spaces"));
            assert!(!is_valid_wsl_distro_name(&"a".repeat(65)));
        }
    }

    #[test]
    fn opencode_extra_search_paths_includes_install_and_fallback_dirs() {
        let home = PathBuf::from("/home/tester");
        let install_dir = Some(std::ffi::OsString::from("/custom/opencode/bin"));
        let xdg_bin_dir = Some(std::ffi::OsString::from("/xdg/bin"));
        let gopath =
            std::env::join_paths([PathBuf::from("/go/path1"), PathBuf::from("/go/path2")]).ok();

        let paths = opencode_extra_search_paths(&home, install_dir, xdg_bin_dir, gopath);

        assert_eq!(paths[0], PathBuf::from("/custom/opencode/bin"));
        assert_eq!(paths[1], PathBuf::from("/xdg/bin"));
        assert!(paths.contains(&PathBuf::from("/home/tester/bin")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.opencode/bin")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.bun/bin")));
        assert!(paths.contains(&PathBuf::from("/home/tester/go/bin")));
        assert!(paths.contains(&PathBuf::from("/go/path1/bin")));
        assert!(paths.contains(&PathBuf::from("/go/path2/bin")));
    }

    #[test]
    fn opencode_extra_search_paths_deduplicates_repeated_entries() {
        let home = PathBuf::from("/home/tester");
        let same_dir = Some(std::ffi::OsString::from("/same/path"));

        let paths = opencode_extra_search_paths(&home, same_dir.clone(), same_dir, None);

        let count = paths
            .iter()
            .filter(|path| **path == PathBuf::from("/same/path"))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn opencode_extra_search_paths_deduplicates_bun_default_dir() {
        let home = PathBuf::from("/home/tester");
        let paths = opencode_extra_search_paths(&home, None, None, None);

        let count = paths
            .iter()
            .filter(|path| **path == PathBuf::from("/home/tester/.bun/bin"))
            .count();
        assert_eq!(count, 1);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn tool_executable_candidates_non_windows_uses_plain_binary_name() {
        let dir = PathBuf::from("/usr/local/bin");
        let candidates = tool_executable_candidates("opencode", &dir);

        assert_eq!(candidates, vec![PathBuf::from("/usr/local/bin/opencode")]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn tool_executable_candidates_windows_includes_cmd_exe_and_plain_name() {
        let dir = PathBuf::from("C:\\tools");
        let candidates = tool_executable_candidates("opencode", &dir);

        assert_eq!(
            candidates,
            vec![
                PathBuf::from("C:\\tools\\opencode.cmd"),
                PathBuf::from("C:\\tools\\opencode.exe"),
                PathBuf::from("C:\\tools\\opencode"),
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn merge_windows_path_keeps_priority_and_deduplicates_case_insensitively() {
        let merged = merge_path_segments_win(&[
            r"C:\Runtime;D:\Tools",
            r"c:\runtime;E:\User Bin",
            r"D:\TOOLS;C:\Windows\System32",
        ]);

        assert_eq!(
            merged,
            r"C:\Runtime;D:\Tools;E:\User Bin;C:\Windows\System32"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_alias_directory_is_filtered_without_matching_similar_names() {
        assert!(is_windows_app_execution_alias_dir(Path::new(
            r"C:\Users\tester\AppData\Local\Microsoft\WindowsApps"
        )));
        assert!(is_windows_app_execution_alias_dir(Path::new(
            r"C:/Users/tester/AppData/Local/Microsoft/WindowsApps/"
        )));
        assert!(!is_windows_app_execution_alias_dir(Path::new(
            r"C:\tools\WindowsApps"
        )));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_standalone_paths_cover_codex_and_claude_installers() {
        let local_data = PathBuf::from(r"C:\Users\tester\AppData\Local");

        assert_eq!(
            windows_standalone_search_paths("codex", Some(local_data.clone())),
            vec![local_data
                .join("Programs")
                .join("OpenAI")
                .join("Codex")
                .join("bin")]
        );
        assert_eq!(
            windows_standalone_search_paths("claude", Some(local_data.clone())),
            vec![local_data.join("Programs").join("claude")]
        );
        assert!(windows_standalone_search_paths("gemini", Some(local_data)).is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_shell_path_removes_verbatim_prefixes() {
        assert_eq!(
            windows_shell_compatible_path(Path::new(r"\\?\C:\Tools\codex.cmd")),
            PathBuf::from(r"C:\Tools\codex.cmd")
        );
        assert_eq!(
            windows_shell_compatible_path(Path::new(r"\\?\UNC\server\share\claude.cmd")),
            PathBuf::from(r"\\server\share\claude.cmd")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_probe_timeout_terminates_hung_process() {
        use std::process::{Command, Stdio};

        let mut command = Command::new(windows_system_executable("ping.exe"));
        command
            .args(["-n", "6", "127.0.0.1"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let child = command.spawn().expect("ping probe should start");
        let started = std::time::Instant::now();
        let error = wait_child_output(child, Some(std::time::Duration::from_secs(1)))
            .expect_err("hung probe should time out");

        assert!(error.contains("timed out after 1s"));
        assert!(started.elapsed() < std::time::Duration::from_secs(4));
    }

    #[test]
    fn resolve_launch_cwd_accepts_existing_directory() {
        let resolved =
            resolve_launch_cwd(Some(std::env::temp_dir().to_string_lossy().into_owned()))
                .expect("temp dir should resolve")
                .expect("temp dir should be present");

        assert!(resolved.is_dir());
    }

    #[test]
    fn resolve_launch_cwd_rejects_missing_directory() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let missing = std::env::temp_dir().join(format!("cc-switch-missing-{unique}"));

        let error = resolve_launch_cwd(Some(missing.to_string_lossy().into_owned()))
            .expect_err("missing directory should fail");

        assert!(error.contains("目录不存在"));
    }

    #[test]
    fn sanitize_terminal_command_rejects_empty_command() {
        let error = sanitize_terminal_command("   ".to_string()).expect_err("empty should fail");

        assert!(error.contains("命令不能为空"));
    }

    #[test]
    fn sanitize_terminal_command_rejects_newlines() {
        let error = sanitize_terminal_command("claude --resume abc\npwd".to_string())
            .expect_err("newlines should fail");

        assert!(error.contains("非法换行符"));
    }

    #[test]
    fn sanitize_terminal_command_trims_surrounding_whitespace() {
        let command = sanitize_terminal_command("  claude --resume abc  ".to_string())
            .expect("trimmed command should pass");

        assert_eq!(command, "claude --resume abc");
    }

    #[test]
    fn build_shell_cd_command_quotes_spaces_and_single_quotes() {
        let command = build_shell_cd_command(Some(Path::new("/tmp/project O'Brien")));

        assert_eq!(command, "cd '/tmp/project O'\"'\"'Brien' || exit 1\n");
    }

    #[test]
    fn build_windows_cwd_command_str_uses_cd_for_drive_paths() {
        let (command, env) = build_windows_cwd_command_str(r"C:\work\repo");

        assert_eq!(command, "cd /d \"C:\\work\\repo\" || exit /b 1\r\n");
        assert_eq!(env, None);
    }

    #[test]
    fn build_windows_cwd_command_str_uses_pushd_for_unc_paths() {
        let (command, _) = build_windows_cwd_command_str(r"\\wsl$\Ubuntu\home\coder\repo");

        assert_eq!(
            command,
            "pushd \"\\\\wsl$\\Ubuntu\\home\\coder\\repo\" || exit /b 1\r\n"
        );
    }

    #[test]
    fn build_windows_cwd_command_str_escapes_batch_metacharacters() {
        let (command, _) = build_windows_cwd_command_str(r"\\server\share\100%&(test)");

        assert_eq!(
            command,
            "pushd \"\\\\server\\share\\100%%^&^(test^)\" || exit /b 1\r\n"
        );
    }

    #[test]
    fn build_windows_cwd_command_str_passes_non_ascii_paths_via_env() {
        // cmd 按控制台代码页解码 .bat，中文路径不能写进文件（#8034）。
        let path = r"C:\Users\林增文\项目";
        let (command, env) = build_windows_cwd_command_str(path);

        assert!(command.is_ascii(), "batch line must stay ASCII: {command}");
        assert_eq!(
            command,
            "cd /d \"%CC_SWITCH_INTERNAL_CWD%\" || exit /b 1\r\nset \"CC_SWITCH_INTERNAL_CWD=\"\r\n"
        );
        assert_eq!(env.as_deref(), Some(path));

        let (unc_command, unc_env) = build_windows_cwd_command_str(r"\\server\共享\repo");
        assert!(unc_command.starts_with("pushd \"%CC_SWITCH_INTERNAL_CWD%\" || exit /b 1\r\n"));
        assert_eq!(unc_env.as_deref(), Some(r"\\server\共享\repo"));
    }

    #[test]
    fn normalize_version_value_strips_v_prefix_and_whitespace() {
        assert_eq!(normalize_version_value(" v1.2.3 "), "1.2.3");
        assert_eq!(normalize_version_value("V0.1.3"), "0.1.3");
    }

    #[test]
    fn is_newer_version_recognizes_semver_order() {
        assert!(is_newer_version("0.1.3", "0.2.0"));
        assert!(!is_newer_version("0.1.3", "0.1.3"));
        assert!(!is_newer_version("0.2.0", "0.1.3"));
    }
}

pub(crate) use super::tool_management::{
    run_detected_tool_command_with_timeout, run_program_with_timeout,
};

pub(crate) fn local_tool_version(tool: &str) -> Option<String> {
    let output = run_detected_tool_command_with_timeout(
        tool,
        &["--version"],
        Some(CLI_PROBE_TIMEOUT),
        &[],
        &crate::config::get_home_dir(),
    )
    .ok()?;
    output
        .status
        .success()
        .then(|| extract_version(&decode_command_output(&output.stdout)))
}
