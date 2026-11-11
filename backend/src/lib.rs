mod agy_config;
#[cfg(all(test, unix))]
mod agy_smoke_tests;
mod app_config;
mod app_store;
mod auto_launch;
mod claude_desktop_config;
mod claude_mcp;
mod claude_plugin;
mod codex_config;
// 写回与同名路径接口随 8641cd1d 的会话管理、历史迁移部分接入（批次 5a）
mod codex_history_migration;
#[allow(dead_code)]
mod codex_rollout_file;
mod codex_state_db;
mod commands;
mod config;
mod copilot_config;
mod database;
mod dsh_config;
mod error;
mod events;
mod gemini_config;
mod gemini_mcp;
mod grok_config;
mod hermes_config;
mod jsonc_document;
mod kimi_config;
mod kimi_session;
mod live;
mod mcode_config;
mod mcp;
mod mode;
mod model_capabilities;
mod omp_config;
mod openclaw_config;
mod opencode_config;
mod pi_config;
mod prompt;
mod prompt_files;
mod provider;
mod proxy;
mod services;
mod session_manager;
mod settings;
mod store;
mod usage_script;
mod web_auth;
mod web_server;

pub(crate) use commands::*;
pub use web_server::{run_web_server, run_web_server_with_options, WebServerOptions};

/// 给日志用的错误文本：去掉 TOML 解析诊断里引用的源码行（`1 | key = "..."` 和它上下的
/// `|`、`^` 标注行）。那一行是用户配置原文，出错的可能正是密钥那一行；行列号和原因留着。
pub(crate) fn error_for_log(error: &str) -> String {
    error
        .lines()
        .filter(|line| {
            !line
                .trim_start()
                .trim_start_matches(|c: char| c.is_ascii_digit())
                .trim_start()
                .starts_with('|')
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::error_for_log;

    #[test]
    fn log_error_drops_toml_source_lines_but_keeps_position() {
        let secret = "sk-review-only-secret";
        let toml_edit_error = format!("experimental_bearer_token = \"{secret}\" !\n")
            .parse::<toml_edit::DocumentMut>()
            .unwrap_err()
            .to_string();
        let toml_error = toml::from_str::<toml::Table>(&format!("token = \"{secret}\" !\n"))
            .unwrap_err()
            .to_string();
        for error in [toml_edit_error, toml_error] {
            assert!(error.contains(secret), "前提：诊断里带源码行");
            let logged = error_for_log(&format!("无法解析：{error} (cannot parse: {error})"));
            assert!(!logged.contains(secret), "{logged}");
            assert!(logged.contains("line 1"), "{logged}");
        }
        // 普通错误原样保留。
        assert_eq!(error_for_log("供应商 a 不存在"), "供应商 a 不存在");
    }
}
