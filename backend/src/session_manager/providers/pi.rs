use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::session_manager::{SessionMessage, SessionMeta};

use super::utils::{extract_text, parse_timestamp_to_ms, path_basename, truncate_summary};

pub(crate) const MAX_SESSION_BYTES: u64 = 128 * 1024 * 1024;
pub(crate) const MAX_TREE_ENTRIES: usize = 500_000;
const MAX_TREE_ID_BYTES: usize = 256;
const TITLE_MAX_CHARS: usize = 80;

#[derive(Clone, Copy, PartialEq, Eq)]
enum SessionLayout {
    Flat,
    ProjectDirectories,
}

enum SessionRootResolution {
    Available {
        root: PathBuf,
        layout: SessionLayout,
    },
    RequiresProjectContext {
        configured_path: String,
    },
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PiSessionDiscovery {
    Available,
    RequiresProjectContext {
        #[serde(rename = "configuredPath")]
        configured_path: String,
    },
    Unavailable {
        reason: String,
    },
}

struct SessionHeader {
    id: String,
    cwd: String,
    timestamp: Option<i64>,
    version: u64,
}

struct SessionTree {
    header: SessionHeader,
    active_indexes: HashSet<usize>,
    first_user_message: Option<String>,
    last_message: Option<String>,
    explicit_name: Option<Option<String>>,
    last_active_at: Option<i64>,
}

pub fn session_roots() -> Vec<PathBuf> {
    match resolve_session_root() {
        SessionRootResolution::Available { root, .. } => vec![root],
        _ => Vec::new(),
    }
}

pub(crate) fn session_files() -> Result<Vec<PathBuf>, String> {
    match resolve_session_root() {
        SessionRootResolution::Available { root, layout } => {
            let mut files = Vec::new();
            collect_jsonl_files(&root, layout, &mut files, false);
            files.sort();
            Ok(files)
        }
        SessionRootResolution::RequiresProjectContext { configured_path } => Err(format!(
            "Pi sessionDir '{configured_path}' requires a project cwd and cannot be globally enumerated"
        )),
        SessionRootResolution::Unavailable { reason } => Err(reason),
    }
}

pub fn session_discovery() -> PiSessionDiscovery {
    match resolve_session_root() {
        SessionRootResolution::Available { .. } => PiSessionDiscovery::Available,
        SessionRootResolution::RequiresProjectContext { configured_path } => {
            PiSessionDiscovery::RequiresProjectContext { configured_path }
        }
        SessionRootResolution::Unavailable { reason } => PiSessionDiscovery::Unavailable { reason },
    }
}

fn resolve_session_root() -> SessionRootResolution {
    let home = crate::config::get_home_dir();
    if let Some(raw) = std::env::var_os("PI_CODING_AGENT_SESSION_DIR").filter(|v| !v.is_empty()) {
        return classify_configured_dir(raw.to_string_lossy().as_ref(), &home, "environment");
    }
    match crate::pi_config::read_pi_native_defaults() {
        Ok(defaults) => {
            if let Some(value) = defaults.session_dir.filter(|value| !value.is_empty()) {
                return classify_configured_dir(&value, &home, "settings");
            }
        }
        Err(error) => {
            return SessionRootResolution::Unavailable {
                reason: error.to_string(),
            };
        }
    }
    match crate::pi_config::get_pi_agent_dir() {
        Ok(agent_dir) => SessionRootResolution::Available {
            root: agent_dir.join("sessions"),
            layout: SessionLayout::ProjectDirectories,
        },
        Err(error) => SessionRootResolution::Unavailable {
            reason: error.to_string(),
        },
    }
}

fn classify_configured_dir(value: &str, home: &Path, source: &str) -> SessionRootResolution {
    let Some(root) = resolve_global_dir(value, home) else {
        return SessionRootResolution::RequiresProjectContext {
            configured_path: value.to_string(),
        };
    };
    match fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => SessionRootResolution::Available {
            root,
            layout: SessionLayout::Flat,
        },
        Ok(_) => SessionRootResolution::Unavailable {
            reason: format!(
                "Configured Pi session directory from {source} is not a directory: {}",
                root.display()
            ),
        },
        Err(error) => SessionRootResolution::Unavailable {
            reason: format!(
                "Configured Pi session directory from {source} is unavailable ({}): {error}",
                root.display()
            ),
        },
    }
}

fn resolve_global_dir(value: &str, home: &Path) -> Option<PathBuf> {
    let path = if value == "~" {
        home.to_path_buf()
    } else if let Some(suffix) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        home.join(suffix)
    } else {
        PathBuf::from(value)
    };
    path.is_absolute().then_some(path)
}

pub fn scan_sessions() -> Vec<SessionMeta> {
    let SessionRootResolution::Available { root, layout } = resolve_session_root() else {
        return Vec::new();
    };
    let mut files = Vec::new();
    collect_jsonl_files(&root, layout, &mut files, true);
    files
        .into_iter()
        .filter_map(|path| parse_session(&path).ok())
        .collect()
}

pub fn load_messages(path: &Path) -> Result<Vec<SessionMessage>, String> {
    let SessionRootResolution::Available { root, layout } = resolve_session_root() else {
        return Err("Pi session directory cannot be globally resolved".to_string());
    };
    let source = validate_source(&root, path, layout)?;
    let tree = read_tree(&source)?;
    read_active_messages(&source, &tree)
}

pub fn delete_session(root: &Path, path: &Path, session_id: &str) -> Result<bool, String> {
    if !is_valid_tree_id(session_id) {
        return Err("Invalid Pi session ID".to_string());
    }
    let SessionRootResolution::Available {
        root: configured_root,
        layout,
    } = resolve_session_root()
    else {
        return Err("Pi session directory cannot be globally resolved".to_string());
    };
    if root.canonicalize().map_err(|e| e.to_string())?
        != configured_root.canonicalize().map_err(|e| e.to_string())?
    {
        return Err("Pi session root changed before deletion".to_string());
    }
    let source = validate_source(root, path, layout)?;
    let tree = read_tree(&source)?;
    if tree.header.id != session_id {
        return Err(format!(
            "Pi session ID mismatch: expected {session_id}, found {}",
            tree.header.id
        ));
    }
    fs::remove_file(&source)
        .map_err(|error| format!("Failed to delete Pi session {}: {error}", source.display()))?;
    Ok(true)
}

fn parse_session(path: &Path) -> Result<SessionMeta, String> {
    let source = path.canonicalize().map_err(|e| e.to_string())?;
    let source_path = source
        .to_str()
        .ok_or_else(|| "Pi session path is not valid UTF-8".to_string())?
        .to_string();
    let tree = read_tree(&source)?;
    let title = tree.explicit_name.flatten().or_else(|| {
        tree.first_user_message
            .as_deref()
            .map(|value| truncate_summary(value, TITLE_MAX_CHARS))
            .filter(|value| !value.is_empty())
            .or_else(|| path_basename(&tree.header.cwd))
    });
    Ok(SessionMeta {
        provider_id: "pi".to_string(),
        session_id: tree.header.id,
        title,
        summary: tree
            .last_message
            .as_deref()
            .map(|value| truncate_summary(value, 160))
            .filter(|value| !value.is_empty()),
        project_dir: (!tree.header.cwd.trim().is_empty()).then_some(tree.header.cwd),
        created_at: tree.header.timestamp,
        last_active_at: tree.last_active_at.or(tree.header.timestamp),
        source_path: Some(source_path.clone()),
        resume_command: Some(format!(
            "pi --session \"{}\"",
            source_path.replace('"', "\\\"")
        )),
    })
}

fn read_tree(path: &Path) -> Result<SessionTree, String> {
    validate_size(path)?;
    let reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut header = None;
    let mut parents = HashMap::<String, (Option<String>, usize)>::new();
    let mut latest_id = None;
    let mut legacy_previous_id = None;
    let mut entry_index = 0;
    let mut first_user_message = None;
    let mut last_message = None;
    let mut explicit_name = None;
    let mut last_active_at: Option<i64> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if header.is_none() {
            header = Some(parse_header(&value)?);
            continue;
        }
        entry_index += 1;
        if entry_index > MAX_TREE_ENTRIES {
            return Err("Pi session has too many entries".to_string());
        }
        if value.get("type").and_then(Value::as_str) == Some("session_info") {
            explicit_name = Some(
                value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            );
        } else if let Some((role, content)) = value
            .get("message")
            .filter(|_| value.get("type").and_then(Value::as_str) == Some("message"))
            .and_then(parse_message)
        {
            if matches!(role.as_str(), "user" | "assistant") {
                let timestamp = value
                    .get("message")
                    .and_then(|message| message.get("timestamp"))
                    .and_then(parse_timestamp_to_ms)
                    .or_else(|| value.get("timestamp").and_then(parse_timestamp_to_ms));
                if let Some(timestamp) = timestamp {
                    last_active_at = Some(last_active_at.map_or(timestamp, |v| v.max(timestamp)));
                }
                if role == "user" && first_user_message.is_none() {
                    first_user_message = Some(content.clone());
                }
                last_message = Some(content);
            }
        }
        let version = header.as_ref().map_or(1, |header| header.version);
        let Some((id, parent)) =
            entry_identity(&value, version, entry_index, legacy_previous_id.as_deref())
        else {
            continue;
        };
        parents.insert(id.clone(), (parent, entry_index));
        latest_id = Some(id.clone());
        legacy_previous_id = Some(id);
    }

    let header = header.ok_or_else(|| "Pi session has no valid header".to_string())?;
    let mut active_indexes = HashSet::new();
    let mut visited = HashSet::new();
    let mut current = latest_id;
    while let Some(id) = current {
        if !visited.insert(id.clone()) {
            break;
        }
        let Some((parent, index)) = parents.get(&id) else {
            break;
        };
        active_indexes.insert(*index);
        current = parent.clone();
    }
    Ok(SessionTree {
        header,
        active_indexes,
        first_user_message,
        last_message,
        explicit_name,
        last_active_at,
    })
}

fn read_active_messages(path: &Path, tree: &SessionTree) -> Result<Vec<SessionMessage>, String> {
    let reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut messages = Vec::new();
    let mut saw_header = false;
    let mut index = 0;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if !saw_header {
            saw_header = value.get("type").and_then(Value::as_str) == Some("session");
            continue;
        }
        index += 1;
        if !tree.active_indexes.contains(&index) {
            continue;
        }
        let timestamp = value
            .get("message")
            .and_then(|message| message.get("timestamp"))
            .and_then(parse_timestamp_to_ms)
            .or_else(|| value.get("timestamp").and_then(parse_timestamp_to_ms));
        if let Some((role, content)) = value.get("message").and_then(parse_message) {
            messages.push(SessionMessage {
                role,
                content,
                ts: timestamp,
            });
        } else if matches!(
            value.get("type").and_then(Value::as_str),
            Some("compaction" | "branch_summary")
        ) {
            let content = value
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                messages.push(SessionMessage {
                    role: "system".to_string(),
                    content: content.to_string(),
                    ts: timestamp,
                });
            }
        }
    }
    Ok(messages)
}

fn parse_header(value: &Value) -> Result<SessionHeader, String> {
    if value.get("type").and_then(Value::as_str) != Some("session") {
        return Err("Pi session header must be the first valid JSON entry".to_string());
    }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_tree_id(id))
        .ok_or_else(|| "Pi session header has an invalid ID".to_string())?
        .to_string();
    let version = value.get("version").and_then(Value::as_u64).unwrap_or(1);
    if version == 0 {
        return Err("Unsupported Pi session version".to_string());
    }
    Ok(SessionHeader {
        id,
        cwd: value
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        timestamp: value.get("timestamp").and_then(parse_timestamp_to_ms),
        version,
    })
}

fn entry_identity(
    value: &Value,
    version: u64,
    index: usize,
    previous: Option<&str>,
) -> Option<(String, Option<String>)> {
    if version < 2 {
        return Some((format!("legacy-{index}"), previous.map(str::to_string)));
    }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_tree_id(id))?
        .to_string();
    let parent = match value.get("parentId") {
        None | Some(Value::Null) => None,
        Some(Value::String(parent)) if is_valid_tree_id(parent) => Some(parent.clone()),
        _ => return None,
    };
    Some((id, parent))
}

fn parse_message(message: &Value) -> Option<(String, String)> {
    let role = message.get("role").and_then(Value::as_str)?;
    let (role, content) = match role {
        "user" | "assistant" => (
            role.to_string(),
            message.get("content").map(extract_text).unwrap_or_default(),
        ),
        "toolResult" => (
            "tool".to_string(),
            message.get("content").map(extract_text).unwrap_or_default(),
        ),
        "bashExecution" => (
            "tool".to_string(),
            format!(
                "$ {}\n{}",
                message
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                message
                    .get("output")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            ),
        ),
        "branchSummary" | "compactionSummary" => (
            "system".to_string(),
            message
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        ),
        _ => return None,
    };
    (!content.trim().is_empty()).then_some((role, content))
}

fn validate_source(root: &Path, path: &Path, layout: SessionLayout) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let source = path.canonicalize().map_err(|e| e.to_string())?;
    let relative = source
        .strip_prefix(&root)
        .map_err(|_| "Pi session source is outside the session root".to_string())?;
    let expected_depth = match layout {
        SessionLayout::Flat => 1,
        SessionLayout::ProjectDirectories => 2,
    };
    let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if relative.components().count() != expected_depth
        || !metadata.file_type().is_file()
        || source.extension().and_then(|value| value.to_str()) != Some("jsonl")
        || metadata.len() > MAX_SESSION_BYTES
    {
        return Err("Invalid Pi session file".to_string());
    }
    Ok(source)
}

fn validate_size(path: &Path) -> Result<(), String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_SESSION_BYTES {
        Err("Pi session exceeds the 128 MiB safety limit".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn is_valid_tree_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_TREE_ID_BYTES
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn collect_jsonl_files(
    root: &Path,
    layout: SessionLayout,
    output: &mut Vec<PathBuf>,
    enforce_size_limit: bool,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        match layout {
            SessionLayout::Flat if entry.file_type().is_ok_and(|kind| kind.is_file()) => {
                push_jsonl(entry.path(), output, enforce_size_limit);
            }
            SessionLayout::ProjectDirectories
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) =>
            {
                if let Ok(children) = fs::read_dir(entry.path()) {
                    for child in children.flatten() {
                        if child.file_type().is_ok_and(|kind| kind.is_file()) {
                            push_jsonl(child.path(), output, enforce_size_limit);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn push_jsonl(path: PathBuf, output: &mut Vec<PathBuf>, enforce_size_limit: bool) {
    if path.extension().and_then(|value| value.to_str()) == Some("jsonl")
        && (!enforce_size_limit
            || fs::metadata(&path).is_ok_and(|metadata| metadata.len() <= MAX_SESSION_BYTES))
    {
        output.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_config::test_support::TestAgentDir;
    use serial_test::serial;

    #[test]
    fn relative_session_dir_requires_project_context() {
        assert!(resolve_global_dir(".pi/sessions", Path::new("C:\\Users\\test")).is_none());
    }

    #[test]
    fn pi_tool_calls_are_visible() {
        let message = serde_json::json!({
            "role": "assistant",
            "content": [{"type": "toolCall", "name": "read"}]
        });
        assert_eq!(parse_message(&message).unwrap().1, "[Tool: read]");
    }

    #[test]
    fn usage_discovery_reports_oversized_files() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path = temp.path().join("oversized.jsonl");
        File::create(&path)
            .expect("create session")
            .set_len(MAX_SESSION_BYTES + 1)
            .expect("size session");

        let mut browser_files = Vec::new();
        collect_jsonl_files(temp.path(), SessionLayout::Flat, &mut browser_files, true);
        assert!(browser_files.is_empty());

        let mut usage_files = Vec::new();
        collect_jsonl_files(temp.path(), SessionLayout::Flat, &mut usage_files, false);
        assert_eq!(usage_files, vec![path]);
    }

    #[test]
    #[serial]
    fn deletion_checks_header_id_and_root() {
        let _agent = TestAgentDir::new();
        let root = crate::pi_config::get_pi_agent_dir()
            .unwrap()
            .join("sessions");
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let path = project.join("session.jsonl");
        fs::write(
            &path,
            "{\"type\":\"session\",\"version\":3,\"id\":\"session-1\",\"cwd\":\"/work\"}\n",
        )
        .unwrap();
        assert!(delete_session(&root, &path, "wrong-id").is_err());
        assert!(path.exists());
        assert!(delete_session(&root, &path, "session-1").unwrap());
    }
}
