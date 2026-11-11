//! Gemini MCP 同步和导入模块

use serde_json::Value;

use crate::error::AppError;

use super::validation::validate_server_spec;
use super::{merge_imported_server, ImportedMcpServers};

fn should_sync_gemini_mcp() -> bool {
    // Gemini 未安装/未初始化时：~/.gemini 目录不存在。
    // 按用户偏好：目录缺失时跳过写入/删除，不创建任何文件或目录。
    crate::gemini_config::get_gemini_dir().exists()
}

/// 从 Gemini MCP 配置导入到统一结构（v3.7.0+）
/// 已存在的服务器将启用 Gemini 应用，不覆盖其他字段和应用状态
pub fn import_from_gemini(servers: &mut ImportedMcpServers) -> Result<usize, AppError> {
    let map = crate::gemini_mcp::read_mcp_servers_map()?;
    if map.is_empty() {
        return Ok(0);
    }

    let mut changed = 0;
    let mut errors = Vec::new();

    for (id, spec) in map.iter() {
        // 校验：单项失败不中止，收集错误继续处理
        if let Err(e) = validate_server_spec(spec) {
            log::warn!("跳过无效 MCP 服务器 '{id}': {e}");
            errors.push(format!("{id}: {e}"));
            continue;
        }

        if merge_imported_server(
            servers,
            id,
            spec.clone(),
            crate::app_config::AppType::Gemini,
        ) {
            changed += 1;
            log::info!("导入或启用 Gemini MCP 服务器 '{id}'");
        }
    }

    if !errors.is_empty() {
        log::warn!("导入完成，但有 {} 项失败: {:?}", errors.len(), errors);
    }

    Ok(changed)
}

/// 将单个 MCP 服务器同步到 Gemini live 配置
pub fn sync_single_server_to_gemini(id: &str, server_spec: &Value) -> Result<(), AppError> {
    if !should_sync_gemini_mcp() {
        return Ok(());
    }
    // 读取现有的 MCP 配置
    let mut current = crate::gemini_mcp::read_mcp_servers_map()?;

    // 添加/更新当前服务器
    current.insert(id.to_string(), server_spec.clone());

    // 写回
    crate::gemini_mcp::set_mcp_servers_map(&current)
}

/// 从 Gemini live 配置中移除单个 MCP 服务器
pub fn remove_server_from_gemini(id: &str) -> Result<(), AppError> {
    if !should_sync_gemini_mcp() {
        return Ok(());
    }
    // 读取现有的 MCP 配置
    let mut current = crate::gemini_mcp::read_mcp_servers_map()?;

    // 移除指定服务器
    current.remove(id);

    // 写回
    crate::gemini_mcp::set_mcp_servers_map(&current)
}
