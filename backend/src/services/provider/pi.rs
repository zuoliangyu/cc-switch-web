use super::{ProviderService, SwitchResult};
use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::{Provider, ProviderMeta};
use crate::store::AppState;
use indexmap::IndexMap;
use serde_json::Value;
use std::sync::{LazyLock, Mutex, MutexGuard};

const PI_APP: &str = "pi";
static PI_PROVIDER_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn lock() -> Result<MutexGuard<'static, ()>, AppError> {
    PI_PROVIDER_LOCK.lock().map_err(AppError::from)
}

pub(super) fn list(state: &AppState) -> Result<IndexMap<String, Provider>, AppError> {
    let _guard = lock()?;
    match crate::pi_config::read_pi_native_providers() {
        Ok(native) => {
            if let Err(error) = sync_native_locked(state, &native) {
                log::warn!("同步 Pi 原生供应商失败: {error}");
            }
        }
        Err(error) => log::warn!("读取 Pi 原生供应商失败，保留数据库目录: {error}"),
    }
    state.db.get_all_providers(PI_APP)
}

pub(super) fn import_from_live(state: &AppState) -> Result<usize, AppError> {
    let _guard = lock()?;
    sync_native_locked(state, &crate::pi_config::read_pi_native_providers()?)
}

pub(super) fn add(
    state: &AppState,
    mut provider: Provider,
    add_to_live: bool,
) -> Result<bool, AppError> {
    let _guard = lock()?;
    strip_unsupported_metadata(&mut provider);
    ProviderService::validate_provider_settings(&AppType::Pi, &provider)?;
    align_native_display_name(&mut provider);

    if state.db.get_provider_by_id(&provider.id, PI_APP)?.is_some() {
        return Err(AppError::InvalidInput(format!(
            "Pi provider '{}' already exists",
            provider.id
        )));
    }
    if !add_to_live && crate::pi_config::pi_provider_exists(&provider.id)? {
        return Err(AppError::InvalidInput(format!(
            "Pi provider key '{}' already exists in models.json",
            provider.id
        )));
    }

    let inserted = add_to_live
        && crate::pi_config::insert_pi_provider(&provider.id, &provider.settings_config)?;
    if let Err(error) = state.db.save_provider(PI_APP, &provider) {
        if inserted {
            crate::pi_config::remove_pi_provider_if_matches(
                &provider.id,
                &provider.settings_config,
            )?;
        }
        return Err(error);
    }
    Ok(true)
}

pub(super) fn update(
    state: &AppState,
    original_id: Option<&str>,
    mut provider: Provider,
) -> Result<bool, AppError> {
    let _guard = lock()?;
    let original_id = original_id.unwrap_or(&provider.id).to_string();
    if original_id != provider.id {
        return Err(AppError::InvalidInput(
            "Pi provider keys cannot be renamed".to_string(),
        ));
    }
    if state.db.get_provider_by_id(&original_id, PI_APP)?.is_none() {
        return Err(AppError::InvalidInput(format!(
            "Pi provider '{original_id}' not found"
        )));
    }

    strip_unsupported_metadata(&mut provider);
    ProviderService::validate_provider_settings(&AppType::Pi, &provider)?;
    let previous_native =
        crate::pi_config::replace_pi_provider_if_present(&original_id, &provider.settings_config)?;
    if let Err(error) = state.db.save_provider(PI_APP, &provider) {
        if let Some(previous) = previous_native.as_ref() {
            crate::pi_config::replace_pi_provider(
                &original_id,
                &provider.settings_config,
                previous,
            )?;
        }
        return Err(error);
    }
    Ok(true)
}

pub(super) fn delete(state: &AppState, id: &str) -> Result<(), AppError> {
    let _guard = lock()?;
    if state.db.get_provider_by_id(id, PI_APP)?.is_none() {
        return Ok(());
    }
    let removed = crate::pi_config::remove_pi_provider(id)?;
    if let Err(error) = state.db.delete_provider(PI_APP, id) {
        if let Some(config) = removed.as_ref() {
            crate::pi_config::restore_pi_provider_if_missing(id, config)?;
        }
        return Err(error);
    }
    Ok(())
}

pub(super) fn remove(state: &AppState, id: &str) -> Result<(), AppError> {
    let _guard = lock()?;
    let mut provider = state
        .db
        .get_provider_by_id(id, PI_APP)?
        .ok_or_else(|| AppError::InvalidInput(format!("Pi provider '{id}' not found")))?;
    let Some(native) = crate::pi_config::remove_pi_provider(id)? else {
        return Ok(());
    };
    merge_native_config(&mut provider, native.clone());
    if let Err(error) = state.db.save_provider(PI_APP, &provider) {
        crate::pi_config::restore_pi_provider_if_missing(id, &native)?;
        return Err(error);
    }
    Ok(())
}

pub(super) fn enable(state: &AppState, id: &str) -> Result<SwitchResult, AppError> {
    let _guard = lock()?;
    let mut provider = state
        .db
        .get_provider_by_id(id, PI_APP)?
        .ok_or_else(|| AppError::InvalidInput(format!("Pi provider '{id}' not found")))?;
    if let Some(native) = crate::pi_config::read_pi_native_provider(id)? {
        merge_native_config(&mut provider, native);
        state.db.save_provider(PI_APP, &provider)?;
        return Ok(SwitchResult::default());
    }
    ProviderService::validate_provider_settings(&AppType::Pi, &provider)?;
    crate::pi_config::insert_pi_provider(id, &provider.settings_config)?;
    Ok(SwitchResult::default())
}

fn sync_native_locked(
    state: &AppState,
    native: &IndexMap<String, Value>,
) -> Result<usize, AppError> {
    let saved = state.db.get_all_providers(PI_APP)?;
    let mut changed = 0;
    for (id, config) in native {
        let mut provider = saved.get(id).cloned().unwrap_or_else(|| {
            let name = native_name(config).unwrap_or(id).to_string();
            let mut imported = Provider::with_id(id.clone(), name, config.clone(), None);
            imported.category = Some("custom".to_string());
            imported.icon = Some("pi".to_string());
            imported
        });
        let old_name = provider.name.clone();
        let old_config = provider.settings_config.clone();
        merge_native_config(&mut provider, config.clone());
        if saved.contains_key(id)
            && provider.name == old_name
            && provider.settings_config == old_config
        {
            continue;
        }
        state.db.save_provider(PI_APP, &provider)?;
        changed += 1;
    }
    Ok(changed)
}

fn merge_native_config(provider: &mut Provider, config: Value) {
    if let Some(name) = native_name(&config) {
        provider.name = name.to_string();
    }
    provider.settings_config = config;
}

fn native_name(config: &Value) -> Option<&str> {
    config
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

fn align_native_display_name(provider: &mut Provider) {
    if let Some(config) = provider.settings_config.as_object_mut() {
        if config.contains_key("name") {
            config.insert("name".to_string(), Value::String(provider.name.clone()));
        }
    }
}

fn strip_unsupported_metadata(provider: &mut Provider) {
    provider.in_failover_queue = false;
    let Some(meta) = provider.meta.take() else {
        return;
    };
    provider.meta = Some(ProviderMeta {
        usage_script: meta.usage_script,
        is_partner: meta.is_partner,
        partner_promotion_key: meta.partner_promotion_key,
        ..ProviderMeta::default()
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::pi_config::test_support::TestAgentDir;
    use serde_json::json;
    use serial_test::serial;
    use std::fs;
    use std::sync::Arc;

    fn state() -> AppState {
        AppState::new(Arc::new(Database::memory().expect("database")))
    }

    fn provider(id: &str) -> Provider {
        Provider::with_id(
            id.to_string(),
            "Example".to_string(),
            json!({
                "name": "Example",
                "baseUrl": "https://api.example.com/v1",
                "apiKey": "secret",
                "api": "openai-completions",
                "models": [{"id": "model-a"}],
                "futureField": {"keep": true}
            }),
            None,
        )
    }

    #[test]
    #[serial]
    fn explicit_nodes_sync_and_membership_does_not_touch_auth_or_defaults() {
        let _agent = TestAgentDir::new();
        let state = state();
        let agent = crate::pi_config::get_pi_agent_dir().unwrap();
        fs::create_dir_all(&agent).unwrap();
        fs::write(agent.join("auth.json"), b"native-secret").unwrap();
        fs::write(
            agent.join("settings.json"),
            br#"{"defaultProvider":"anthropic","defaultModel":"claude"}"#,
        )
        .unwrap();
        fs::write(
            agent.join("models.json"),
            br#"{"providers":{"anthropic":{"futureField":{"keep":true}}}}"#,
        )
        .unwrap();

        let providers = list(&state).expect("sync native");
        assert!(providers.contains_key("anthropic"));
        remove(&state, "anthropic").expect("remove native node");
        enable(&state, "anthropic").expect("restore native node");

        assert_eq!(fs::read(agent.join("auth.json")).unwrap(), b"native-secret");
        assert_eq!(
            fs::read(agent.join("settings.json")).unwrap(),
            br#"{"defaultProvider":"anthropic","defaultModel":"claude"}"#
        );
    }

    #[test]
    #[serial]
    fn disabled_provider_can_be_enabled_and_removed_without_losing_config() {
        let _agent = TestAgentDir::new();
        let state = state();
        add(&state, provider("custom"), false).expect("save catalog");
        assert!(!crate::pi_config::pi_provider_exists("custom").unwrap());
        enable(&state, "custom").expect("enable");
        remove(&state, "custom").expect("remove");
        assert_eq!(
            state
                .db
                .get_provider_by_id("custom", PI_APP)
                .unwrap()
                .unwrap()
                .settings_config["futureField"],
            json!({"keep": true})
        );
    }
}
