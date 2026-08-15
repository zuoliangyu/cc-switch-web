use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCurrentState {
    pub enabled_provider_ids: Vec<String>,
    pub default_provider_id: Option<String>,
}

pub struct PiStateService;

impl PiStateService {
    pub fn current() -> Result<PiCurrentState, AppError> {
        let enabled_provider_ids = crate::pi_config::read_pi_native_providers()?
            .into_keys()
            .collect();
        let default_provider_id = crate::pi_config::read_pi_native_defaults()
            .map(|defaults| defaults.default_provider)
            .unwrap_or_else(|error| {
                log::warn!("读取 Pi 默认 Provider 失败，仅返回启用成员: {error}");
                None
            });
        Ok(PiCurrentState {
            enabled_provider_ids,
            default_provider_id,
        })
    }
}
