//! 上游 tests/copilot_commands.rs 的 GitHub Copilot CLI 用例（bd487e83），改为 Web 的单元测试：
//! 用临时目录隔离 HOME 与 COPILOT_HOME。
use super::ProviderService;
use crate::app_config::{AppType, McpApps, McpServer};
use crate::database::Database;
use crate::prompt::Prompt;
use crate::provider::Provider;
use crate::services::{mcp::McpService, prompt::PromptService};
use crate::store::AppState;
use serde_json::json;
use serial_test::serial;
use std::{ffi::OsString, fs, sync::Arc};

struct CopilotHome {
    directory: tempfile::TempDir,
    previous_env: Vec<(&'static str, Option<OsString>)>,
    state: AppState,
}
impl CopilotHome {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let previous_env = ["CC_SWITCH_TEST_HOME", "COPILOT_HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        std::env::set_var("CC_SWITCH_TEST_HOME", directory.path().join("home"));
        std::env::set_var("COPILOT_HOME", directory.path().join("copilot"));
        fs::create_dir_all(directory.path().join("copilot")).unwrap();
        Self {
            directory,
            previous_env,
            state: AppState::new(Arc::new(Database::memory().unwrap())),
        }
    }
    fn path(&self, name: &str) -> std::path::PathBuf {
        self.directory.path().join("copilot").join(name)
    }
}
impl Drop for CopilotHome {
    fn drop(&mut self) {
        for (key, value) in &self.previous_env {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

fn byok(id: &str) -> Provider {
    Provider::with_id(
        id.into(),
        id.into(),
        json!({"env":{
            "COPILOT_PROVIDER_BASE_URL":"https://example.com/v1",
            "COPILOT_PROVIDER_API_KEY":"fixture-key",
            "COPILOT_PROVIDER_TYPE":"openai",
            "COPILOT_MODEL":"gpt-5.4"
        }}),
        None,
    )
}

/// 递归找出目录里所有文件的内容里有没有 `needle`。
fn any_file_contains(dir: &std::path::Path, needle: &str) -> Option<std::path::PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = any_file_contains(&path, needle) {
                return Some(found);
            }
        } else if fs::read(&path)
            .map(|bytes| String::from_utf8_lossy(&bytes).contains(needle))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

#[test]
#[serial]
fn copilot_cards_launch_terminals_and_never_write_native_settings() {
    let home = CopilotHome::new();
    let state = &home.state;
    let original = "{\n  \"model\": \"claude-sonnet-4.6\",\n  \"theme\": \"dark\"\n}";
    fs::write(home.path("settings.json"), original).unwrap();

    assert!(ProviderService::add(state, AppType::Copilot, byok("relay"), true).unwrap());
    let error = ProviderService::switch(state, AppType::Copilot, "relay").unwrap_err();
    assert!(error.to_string().contains("Open terminal"), "{error}");

    // 保存前按 Copilot CLI 的环境变量约定校验，不合格的不进库。
    let mut missing_model = byok("broken");
    missing_model.settings_config["env"]
        .as_object_mut()
        .unwrap()
        .remove("COPILOT_MODEL");
    assert!(ProviderService::add(state, AppType::Copilot, missing_model, true).is_err());
    assert!(state
        .db
        .get_provider_by_id("broken", "copilot")
        .unwrap()
        .is_none());

    ProviderService::delete(state, AppType::Copilot, "relay").unwrap();
    assert_eq!(
        fs::read_to_string(home.path("settings.json")).unwrap(),
        original
    );
    // Key 不落到 Copilot 目录，也不落到 CC Switch 自己的数据目录（数据库在内存里）。
    assert_eq!(
        any_file_contains(home.directory.path(), "fixture-key"),
        None
    );
}

#[test]
#[serial]
fn copilot_import_uses_the_signed_in_model_only_when_present() {
    let home = CopilotHome::new();
    let state = &home.state;
    // 刚装好的 Copilot 还没有 settings.json：没什么可导入，不报错。
    assert!(!ProviderService::import_default_config(state, AppType::Copilot).unwrap());
    fs::write(home.path("settings.json"), "{\"theme\":\"dark\"}").unwrap();
    assert!(!ProviderService::import_default_config(state, AppType::Copilot).unwrap());

    fs::write(
        home.path("settings.json"),
        "// user comment\n{\"model\":\"gpt-5.6-terra\"}",
    )
    .unwrap();
    assert!(ProviderService::import_default_config(state, AppType::Copilot).unwrap());
    let providers = state.db.get_all_providers("copilot").unwrap();
    let imported = &providers["default"];
    assert_eq!(imported.category.as_deref(), Some("official"));
    assert_eq!(imported.name, "GitHub Copilot");
    assert_eq!(imported.icon.as_deref(), Some("githubcopilot"));
    assert_eq!(
        imported.settings_config["env"]["COPILOT_MODEL"],
        "gpt-5.6-terra"
    );
}

#[test]
#[serial]
fn copilot_mcp_skills_and_prompts_follow_the_native_home() {
    let home = CopilotHome::new();
    let state = &home.state;
    // 用户自己写的条目在 CC Switch 写入后保留。
    fs::write(
        home.path("mcp-config.json"),
        json!({"mcpServers":{"native":{"type":"local","command":"node","args":["x.js"],"tools":["*"]}}})
            .to_string(),
    )
    .unwrap();
    let server = McpServer {
        id: "test".into(),
        name: "Test".into(),
        server: json!({"type":"stdio","command":"npx","args":["-y","pkg"]}),
        apps: McpApps {
            copilot: true,
            ..Default::default()
        },
        description: None,
        homepage: None,
        docs: None,
        tags: vec![],
    };
    McpService::upsert_server(state, server).unwrap();
    let read = || -> serde_json::Value {
        serde_json::from_slice(&fs::read(home.path("mcp-config.json")).unwrap()).unwrap()
    };
    let value = read();
    assert_eq!(value["mcpServers"]["test"]["type"], "local");
    assert_eq!(value["mcpServers"]["test"]["tools"], json!(["*"]));
    assert_eq!(value["mcpServers"]["native"]["command"], "node");

    McpService::toggle_app(state, "test", AppType::Copilot, false).unwrap();
    let value = read();
    assert!(value["mcpServers"].get("test").is_none());
    assert!(value["mcpServers"].get("native").is_some());

    // 导入时 settings.json 的 disabledMcpServers 记为未启用。
    fs::write(
        home.path("settings.json"),
        json!({"disabledMcpServers":["native"]}).to_string(),
    )
    .unwrap();
    McpService::import_from_all_apps(state).ok();
    let servers = McpService::get_all_servers(state).unwrap();
    assert!(!servers["native"].apps.copilot);

    // Skills 目录跟随 COPILOT_HOME
    assert_eq!(
        crate::services::skill::SkillService::get_app_skills_dir(&AppType::Copilot).unwrap(),
        home.path("skills")
    );

    let prompt: Prompt = serde_json::from_value(
        json!({"id":"global","name":"Global","content":"Prefer small commits.","enabled":false}),
    )
    .unwrap();
    PromptService::upsert_prompt(state, AppType::Copilot, "global", prompt).unwrap();
    PromptService::enable_prompt(state, AppType::Copilot, "global").unwrap();
    assert_eq!(
        fs::read_to_string(home.path("copilot-instructions.md")).unwrap(),
        "Prefer small commits."
    );
}
