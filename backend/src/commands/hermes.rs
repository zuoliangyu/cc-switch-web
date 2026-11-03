use std::time::Duration;

const HERMES_WEB_OFFLINE_ERROR: &str = "hermes_web_offline";

pub(crate) fn get_hermes_memory_internal(
    kind: crate::hermes_config::MemoryKind,
) -> Result<String, String> {
    crate::hermes_config::read_memory(kind).map_err(|e| e.to_string())
}

pub(crate) fn get_hermes_web_ui_url_internal(path: Option<String>) -> Result<String, String> {
    let port = std::env::var("HERMES_WEB_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(9119);

    let base = format!("http://127.0.0.1:{port}");
    let probe_url = format!("{base}/api/status");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1200))
        .no_proxy()
        .build()
        .map_err(|e| format!("failed to build hermes probe client: {e}"))?;

    match client.get(&probe_url).send() {
        Ok(_) => {}
        Err(_) => return Err(HERMES_WEB_OFFLINE_ERROR.to_string()),
    }

    let target = match path.as_deref() {
        Some(p) if p.starts_with('/') => format!("{base}{p}"),
        Some(p) if !p.is_empty() => format!("{base}/{p}"),
        _ => format!("{base}/"),
    };

    Ok(target)
}

pub(crate) fn launch_hermes_dashboard_internal() -> Result<bool, String> {
    let command_line = crate::commands::tool_management::hermes_dashboard_command_line()?;
    crate::commands::launch_terminal_command_internal(command_line, None, None)
}

pub(crate) fn get_hermes_model_config_internal(
) -> Result<Option<crate::hermes_config::HermesModelConfig>, String> {
    crate::hermes_config::get_model_config().map_err(|e| e.to_string())
}

pub(crate) fn get_hermes_live_provider_ids_internal() -> Result<Vec<String>, String> {
    crate::hermes_config::get_live_provider_ids().map_err(|e| e.to_string())
}

pub(crate) fn scan_hermes_config_health_internal(
) -> Result<Vec<crate::hermes_config::HermesHealthWarning>, String> {
    crate::hermes_config::scan_hermes_config_health().map_err(|e| e.to_string())
}

pub(crate) fn set_hermes_memory_internal(
    kind: crate::hermes_config::MemoryKind,
    content: String,
) -> Result<(), String> {
    crate::hermes_config::write_memory(kind, &content).map_err(|e| e.to_string())
}

pub(crate) fn get_hermes_memory_limits_internal(
) -> Result<crate::hermes_config::HermesMemoryLimits, String> {
    crate::hermes_config::read_memory_limits().map_err(|e| e.to_string())
}

pub(crate) fn set_hermes_memory_enabled_internal(
    kind: crate::hermes_config::MemoryKind,
    enabled: bool,
) -> Result<(), String> {
    crate::hermes_config::set_memory_enabled(kind, enabled).map_err(|e| e.to_string())
}
