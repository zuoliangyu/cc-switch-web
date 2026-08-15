//! MCP 服务器数据访问对象
//!
//! 提供 MCP 服务器的 CRUD 操作。

use crate::app_config::{AppType, McpApps, McpServer};
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use indexmap::IndexMap;
use rusqlite::{params, OptionalExtension, Row};

const MCP_SERVER_SELECT: &str =
    "SELECT id, name, server_config, description, homepage, docs, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes FROM mcp_servers";

fn row_to_mcp_server(row: &Row<'_>) -> rusqlite::Result<(String, McpServer)> {
    let id: String = row.get(0)?;
    let server_config: String = row.get(2)?;
    let tags: String = row.get(6)?;
    Ok((
        id.clone(),
        McpServer {
            id,
            name: row.get(1)?,
            server: serde_json::from_str(&server_config).unwrap_or_default(),
            description: row.get(3)?,
            homepage: row.get(4)?,
            docs: row.get(5)?,
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            apps: McpApps {
                claude: row.get(7)?,
                codex: row.get(8)?,
                gemini: row.get(9)?,
                grokbuild: row.get(10)?,
                opencode: row.get(11)?,
                hermes: row.get(12)?,
            },
        },
    ))
}

impl Database {
    /// 获取所有 MCP 服务器
    pub fn get_all_mcp_servers(&self) -> Result<IndexMap<String, McpServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(&format!("{MCP_SERVER_SELECT} ORDER BY name ASC, id ASC"))
            .map_err(|e| AppError::Database(e.to_string()))?;

        let server_iter = stmt
            .query_map([], row_to_mcp_server)
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut servers = IndexMap::new();
        for server_res in server_iter {
            let (id, server) = server_res.map_err(|e| AppError::Database(e.to_string()))?;
            servers.insert(id, server);
        }
        Ok(servers)
    }

    /// 原子更新单个应用列，避免并发开关用陈旧整行快照互相覆盖。
    pub fn update_mcp_server_app_enabled(
        &self,
        id: &str,
        app: &AppType,
        enabled: bool,
    ) -> Result<Option<McpServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let column = match app {
            AppType::Claude => Some("enabled_claude"),
            AppType::Codex => Some("enabled_codex"),
            AppType::Gemini => Some("enabled_gemini"),
            AppType::GrokBuild => Some("enabled_grokbuild"),
            AppType::OpenCode => Some("enabled_opencode"),
            AppType::Hermes => Some("enabled_hermes"),
            AppType::ClaudeDesktop | AppType::OpenClaw | AppType::Pi => None,
        };

        if let Some(column) = column {
            let affected = conn
                .execute(
                    &format!("UPDATE mcp_servers SET {column} = ?1 WHERE id = ?2"),
                    params![enabled, id],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            if affected == 0 {
                return Ok(None);
            }
        }

        conn.query_row(
            &format!("{MCP_SERVER_SELECT} WHERE id = ?1"),
            params![id],
            |row| row_to_mcp_server(row).map(|(_, server)| server),
        )
        .optional()
        .map_err(|e| AppError::Database(e.to_string()))
    }

    /// 保存 MCP 服务器
    pub fn save_mcp_server(&self, server: &McpServer) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO mcp_servers (
                id, name, server_config, description, homepage, docs, tags,
                enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                server.id,
                server.name,
                serde_json::to_string(&server.server).map_err(|e| AppError::Database(format!(
                    "Failed to serialize server config: {e}"
                )))?,
                server.description,
                server.homepage,
                server.docs,
                serde_json::to_string(&server.tags)
                    .map_err(|e| AppError::Database(format!("Failed to serialize tags: {e}")))?,
                server.apps.claude,
                server.apps.codex,
                server.apps.gemini,
                server.apps.grokbuild,
                server.apps.opencode,
                server.apps.hermes,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 删除 MCP 服务器
    pub fn delete_mcp_server(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn test_server() -> McpServer {
        McpServer {
            id: "shared-server".to_string(),
            name: "Shared Server".to_string(),
            server: json!({ "command": "echo", "args": ["hello"] }),
            apps: McpApps {
                gemini: true,
                ..McpApps::default()
            },
            description: Some("description".to_string()),
            homepage: None,
            docs: None,
            tags: vec!["shared".to_string()],
        }
    }

    #[test]
    fn app_flag_update_preserves_other_flags() {
        let db = Database::memory().expect("create memory db");
        db.save_mcp_server(&test_server()).expect("seed server");

        let updated = db
            .update_mcp_server_app_enabled("shared-server", &AppType::Claude, true)
            .expect("enable Claude")
            .expect("server exists");

        assert!(updated.apps.claude);
        assert!(updated.apps.gemini);
    }

    #[test]
    fn concurrent_app_flag_updates_do_not_lose_each_other() {
        let db = Arc::new(Database::memory().expect("create memory db"));
        db.save_mcp_server(&test_server()).expect("seed server");
        let barrier = Arc::new(Barrier::new(3));
        let handles = [AppType::Claude, AppType::Codex].map(|app| {
            let db = Arc::clone(&db);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                db.update_mcp_server_app_enabled("shared-server", &app, true)
                    .expect("update flag");
            })
        });

        barrier.wait();
        for handle in handles {
            handle.join().expect("join toggle");
        }

        let stored = db
            .get_all_mcp_servers()
            .expect("read servers")
            .shift_remove("shared-server")
            .expect("stored server");
        assert!(stored.apps.claude);
        assert!(stored.apps.codex);
        assert!(stored.apps.gemini);
    }
}
