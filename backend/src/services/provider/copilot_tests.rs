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
        let previous_env = [
            "CC_SWITCH_TEST_HOME",
            "COPILOT_HOME",
            "COPILOT_PROVIDERS_CONFIG",
        ]
        .into_iter()
        .map(|key| (key, std::env::var_os(key)))
        .collect();
        std::env::set_var("CC_SWITCH_TEST_HOME", directory.path().join("home"));
        std::env::set_var("COPILOT_HOME", directory.path().join("copilot"));
        // providers.json 只在没有这个覆盖时跟着 COPILOT_HOME 走。
        std::env::remove_var("COPILOT_PROVIDERS_CONFIG");
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
        json!({
            "provider": {"type":"openai","baseUrl":"https://example.com/v1","apiKey":"fixture-key"},
            "models": [{"id":"gpt-5.4"}],
            "reasoningEffort": "high"
        }),
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

/// 上游 7b657e02：自带模型卡写进 providers.json（Copilot 自己的条目原样保留），官方卡只存行。
#[test]
#[serial]
fn copilot_byok_cards_live_in_providers_json_and_official_cards_never_write() {
    let home = CopilotHome::new();
    let state = &home.state;
    let original = "{\n  \"model\": \"claude-sonnet-4.6\",\n  \"theme\": \"dark\"\n}";
    fs::write(home.path("settings.json"), original).unwrap();
    // Copilot 自己写进去的条目（如 Foundry Local）在 CC Switch 写入后保留。
    let foreign = json!({
        "providers": [{"name":"foundry","baseUrl":"http://localhost:5272/v1"}],
        "models": [{"id":"phi","provider":"foundry"}]
    });
    fs::write(home.path("providers.json"), foreign.to_string()).unwrap();

    assert!(ProviderService::add(state, AppType::Copilot, byok("relay"), true).unwrap());
    let written: serde_json::Value =
        serde_json::from_slice(&fs::read(home.path("providers.json")).unwrap()).unwrap();
    assert_eq!(written["providers"][0], foreign["providers"][0]);
    assert_eq!(written["providers"][1]["name"], "relay");
    assert_eq!(
        written["models"][1],
        json!({"id":"gpt-5.4","provider":"relay"})
    );
    assert!(!written.to_string().contains("reasoningEffort"));
    // 列表从文件读回：已添加
    let listed = ProviderService::list(state, AppType::Copilot).unwrap();
    assert_eq!(
        ProviderService::provider_live_config_managed(&listed["relay"]),
        Some(true)
    );
    assert!(listed.contains_key("foundry"));

    // 保存前先校验卡片，不合格的不进库也不写文件。
    let mut missing_model = byok("broken");
    missing_model.settings_config["models"] = json!([]);
    assert!(ProviderService::add(state, AppType::Copilot, missing_model, true).is_err());
    assert!(ProviderService::list(state, AppType::Copilot)
        .unwrap()
        .get("broken")
        .is_none());

    // 官方卡只用来打开终端：存行、不写文件、不能「添加」。
    let mut official = Provider::with_id(
        "login".into(),
        "GitHub Copilot".into(),
        json!({"env":{"COPILOT_MODEL":"gpt-5-mini"}}),
        None,
    );
    official.category = Some("official".into());
    assert!(ProviderService::add(state, AppType::Copilot, official, true).unwrap());
    let error = ProviderService::switch(state, AppType::Copilot, "login").unwrap_err();
    assert!(error.to_string().contains("Open terminal"), "{error}");

    ProviderService::delete(state, AppType::Copilot, "relay").unwrap();
    let after: serde_json::Value =
        serde_json::from_slice(&fs::read(home.path("providers.json")).unwrap()).unwrap();
    assert_eq!(after, foreign);
    assert_eq!(
        fs::read_to_string(home.path("settings.json")).unwrap(),
        original
    );
    // 删掉之后 Key 不留在 Copilot 目录，也不落到 CC Switch 自己的数据目录（数据库在内存里）。
    assert_eq!(
        any_file_contains(home.directory.path(), "fixture-key"),
        None
    );
}

/// 旧版（环境变量形状）的自带模型卡在列表里就地转成新形状，未添加。
#[test]
#[serial]
fn copilot_legacy_env_cards_are_converted_on_list() {
    let home = CopilotHome::new();
    let state = &home.state;
    let legacy = Provider::with_id(
        "old".into(),
        "Old relay".into(),
        json!({"env":{
            "COPILOT_PROVIDER_BASE_URL":"https://example.com/v1",
            "COPILOT_PROVIDER_API_KEY":"fixture-key",
            "COPILOT_PROVIDER_WIRE_API":"responses",
            "COPILOT_MODEL":"gpt-5.4"
        },"reasoningEffort":"low"}),
        None,
    );
    state.db.save_provider("copilot", &legacy).unwrap();
    let listed = ProviderService::list(state, AppType::Copilot).unwrap();
    let card = &listed["old"].settings_config;
    assert_eq!(card["provider"]["baseUrl"], "https://example.com/v1");
    assert_eq!(card["provider"]["wireApi"], "responses");
    assert_eq!(card["models"], json!([{"id":"gpt-5.4"}]));
    assert_eq!(card["reasoningEffort"], "low");
    assert!(card.get("env").is_none());
    assert_eq!(
        ProviderService::provider_live_config_managed(&listed["old"]),
        Some(false)
    );
    // 转换结果写回库里，之后「添加」就写进 providers.json。
    let saved = state
        .db
        .get_provider_by_id("old", "copilot")
        .unwrap()
        .unwrap();
    assert_eq!(saved.settings_config, *card);
    ProviderService::add_to_live_config(state, AppType::Copilot, "old").unwrap();
    assert!(home.path("providers.json").exists());
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
