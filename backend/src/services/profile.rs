//! 项目 Profile 编排模块。
//!
//! Profile 是全应用共享实体，但配置快照与当前指针按 scope 独立维护。
//! 应用快照时复用现有 Provider、MCP、Skill、Prompt 模块，并以 warning
//! 汇总单项失败，避免一个已删除的条目阻断整个项目切换。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::app_config::AppType;
use crate::database::Profile;
use crate::error::AppError;
use crate::services::skill::SkillService;
use crate::services::{mcp::McpService, prompt::PromptService, provider::ProviderService};
use crate::store::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProfileScope {
    Claude,
    #[serde(rename = "claude-desktop")]
    ClaudeDesktop,
    Codex,
}

impl ProfileScope {
    pub(crate) const ALL: [Self; 3] = [Self::Claude, Self::ClaudeDesktop, Self::Codex];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::ClaudeDesktop => "claude-desktop",
            Self::Codex => "codex",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "claude" => Ok(Self::Claude),
            "claude-desktop" => Ok(Self::ClaudeDesktop),
            "codex" => Ok(Self::Codex),
            other => Err(AppError::InvalidInput(format!(
                "Unknown profile scope: {other}"
            ))),
        }
    }

    fn apps(self) -> &'static [AppType] {
        match self {
            Self::Claude => &[AppType::Claude],
            Self::ClaudeDesktop => &[AppType::ClaudeDesktop],
            Self::Codex => &[AppType::Codex],
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct PerApp<T> {
    pub(crate) claude: T,
    #[serde(rename = "claude-desktop")]
    pub(crate) claude_desktop: T,
    pub(crate) codex: T,
}

impl<T> PerApp<T> {
    fn get(&self, app: &AppType) -> Option<&T> {
        match app {
            AppType::Claude => Some(&self.claude),
            AppType::ClaudeDesktop => Some(&self.claude_desktop),
            AppType::Codex => Some(&self.codex),
            _ => None,
        }
    }

    fn get_mut(&mut self, app: &AppType) -> Option<&mut T> {
        match app {
            AppType::Claude => Some(&mut self.claude),
            AppType::ClaudeDesktop => Some(&mut self.claude_desktop),
            AppType::Codex => Some(&mut self.codex),
            _ => None,
        }
    }
}

/// `None` 表示该应用从未拍过快照；`Some(empty)` 表示明确拍到空集合。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct ProfilePayload {
    pub(crate) providers: PerApp<Option<String>>,
    pub(crate) mcp: PerApp<Option<Vec<String>>>,
    pub(crate) skills: PerApp<Option<Vec<String>>>,
    pub(crate) prompts: PerApp<Option<String>>,
}

impl ProfilePayload {
    fn merge_scope_from(&mut self, other: &Self, scope: ProfileScope) {
        for app in scope.apps() {
            if let (Some(target), Some(source)) =
                (self.providers.get_mut(app), other.providers.get(app))
            {
                *target = source.clone();
            }
            if let (Some(target), Some(source)) = (self.mcp.get_mut(app), other.mcp.get(app)) {
                *target = source.clone();
            }
            if let (Some(target), Some(source)) =
                (self.skills.get_mut(app), other.skills.get(app))
            {
                *target = source.clone();
            }
            if let (Some(target), Some(source)) =
                (self.prompts.get_mut(app), other.prompts.get(app))
            {
                *target = source.clone();
            }
        }
    }

    fn scope_captured(&self, scope: ProfileScope) -> bool {
        scope.apps().iter().any(|app| {
            self.providers.get(app).is_some_and(Option::is_some)
                || self.mcp.get(app).is_some_and(Option::is_some)
                || self.skills.get(app).is_some_and(Option::is_some)
                || self.prompts.get(app).is_some_and(Option::is_some)
        })
    }
}

fn plan_toggles(
    current: &[(String, bool)],
    target_ids: &[String],
) -> (Vec<(String, bool)>, Vec<String>) {
    let existing: HashSet<&str> = current.iter().map(|(id, _)| id.as_str()).collect();
    let target: HashSet<&str> = target_ids.iter().map(String::as_str).collect();
    let toggles = current
        .iter()
        .filter(|(id, enabled)| target.contains(id.as_str()) != *enabled)
        .map(|(id, enabled)| (id.clone(), !enabled))
        .collect();
    let dangling = target_ids
        .iter()
        .filter(|id| !existing.contains(id.as_str()))
        .cloned()
        .collect();
    (toggles, dangling)
}

pub(crate) struct ProfileService;

impl ProfileService {
    fn snapshot_current(state: &AppState, scope: ProfileScope) -> Result<ProfilePayload, AppError> {
        let mut payload = ProfilePayload::default();
        let mcp_servers = state.db.get_all_mcp_servers()?;
        let skills = state.db.get_all_installed_skills()?;

        for app in scope.apps() {
            if let Some(slot) = payload.providers.get_mut(app) {
                *slot = crate::settings::get_effective_current_provider(&state.db, app)?;
            }
            if let Some(slot) = payload.mcp.get_mut(app) {
                *slot = Some(
                    mcp_servers
                        .values()
                        .filter(|server| server.apps.is_enabled_for(app))
                        .map(|server| server.id.clone())
                        .collect(),
                );
            }
            if let Some(slot) = payload.skills.get_mut(app) {
                *slot = Some(
                    skills
                        .values()
                        .filter(|skill| skill.apps.is_enabled_for(app))
                        .map(|skill| skill.id.clone())
                        .collect(),
                );
            }
            if let Some(slot) = payload.prompts.get_mut(app) {
                *slot = state
                    .db
                    .get_prompts(app.as_str())?
                    .values()
                    .find(|prompt| prompt.enabled)
                    .map(|prompt| prompt.id.clone());
            }
        }
        Ok(payload)
    }

    pub(crate) fn list(state: &AppState) -> Result<Vec<Profile>, AppError> {
        state.db.get_all_profiles()
    }

    pub(crate) fn create(
        state: &AppState,
        name: &str,
        scope: ProfileScope,
    ) -> Result<Profile, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput("Profile name is empty".to_string()));
        }
        let now = chrono::Utc::now().timestamp();
        let profile = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            payload: serde_json::to_string(&Self::snapshot_current(state, scope)?)
                .map_err(|e| AppError::Config(format!("序列化 profile payload 失败: {e}")))?,
            sort_order: None,
            created_at: Some(now),
            updated_at: Some(now),
        };
        state.db.save_profile(&profile)?;
        Ok(profile)
    }

    pub(crate) fn update(
        state: &AppState,
        id: &str,
        name: Option<String>,
        resnapshot: bool,
        scope: Option<ProfileScope>,
    ) -> Result<Profile, AppError> {
        let mut profile = state
            .db
            .get_profile(id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Profile not found: {id}")))?;
        if let Some(name) = name {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::InvalidInput("Profile name is empty".to_string()));
            }
            profile.name = name;
        }
        if resnapshot {
            let scope = scope.ok_or_else(|| {
                AppError::InvalidInput("Resnapshot requires a profile scope".to_string())
            })?;
            let mut payload: ProfilePayload = serde_json::from_str(&profile.payload)
                .map_err(|e| AppError::Config(format!("解析 profile payload 失败: {e}")))?;
            payload.merge_scope_from(&Self::snapshot_current(state, scope)?, scope);
            profile.payload = serde_json::to_string(&payload)
                .map_err(|e| AppError::Config(format!("序列化 profile payload 失败: {e}")))?;
        }
        profile.updated_at = Some(chrono::Utc::now().timestamp());
        state.db.save_profile(&profile)?;
        Ok(profile)
    }

    pub(crate) fn delete(state: &AppState, id: &str) -> Result<(), AppError> {
        state.db.delete_profile(id)?;
        for scope in ProfileScope::ALL {
            if state.db.get_current_profile_id(scope.as_str())?.as_deref() == Some(id) {
                state.db.set_current_profile_id(scope.as_str(), None)?;
            }
        }
        Ok(())
    }

    pub(crate) async fn apply(
        state: &AppState,
        profile_id: &str,
        scope: ProfileScope,
    ) -> Result<Vec<String>, AppError> {
        let mut warnings = Vec::new();

        if let Some(current_id) = state.db.get_current_profile_id(scope.as_str())? {
            if current_id != profile_id {
                if let Err(error) = Self::update(state, &current_id, None, true, Some(scope)) {
                    warnings.push(format!(
                        "autosave profile '{current_id}' before switch failed: {error}"
                    ));
                }
            }
        }

        let profile = state
            .db
            .get_profile(profile_id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Profile not found: {profile_id}")))?;
        let payload: ProfilePayload = serde_json::from_str(&profile.payload)
            .map_err(|e| AppError::Config(format!("解析 profile payload 失败: {e}")))?;
        if !payload.scope_captured(scope) {
            warnings.push(format!(
                "no {} configuration captured in this project yet; marked as current without changes (it will be saved automatically when you switch away)",
                scope.as_str()
            ));
        }

        for app in scope.apps() {
            let app_str = app.as_str();

            if matches!(app, AppType::Claude | AppType::Codex) {
                if let Err(error) = state.proxy_service.disable_takeover_for_app(app).await {
                    warnings.push(format!(
                        "[{app_str}] auto-disable proxy takeover before profile switch failed: {error}"
                    ));
                }
            }

            if let Some(Some(target_id)) = payload.providers.get(app) {
                let providers = state.db.get_all_providers(app_str)?;
                if !providers.contains_key(target_id) {
                    warnings.push(format!(
                        "[{app_str}] provider '{target_id}' no longer exists, skipped"
                    ));
                } else {
                    let current = crate::settings::get_effective_current_provider(&state.db, app)?;
                    if current.as_deref() != Some(target_id) {
                        match ProviderService::switch(state, app.clone(), target_id) {
                            Ok(result) => warnings.extend(result.warnings),
                            Err(error) => warnings.push(format!(
                                "[{app_str}] switch provider '{target_id}' failed: {error}"
                            )),
                        }
                    }
                }
            }

            if let Some(Some(target_ids)) = payload.mcp.get(app) {
                let current = state
                    .db
                    .get_all_mcp_servers()?
                    .values()
                    .map(|server| (server.id.clone(), server.apps.is_enabled_for(app)))
                    .collect::<Vec<_>>();
                let (toggles, dangling) = plan_toggles(&current, target_ids);
                warnings.extend(
                    dangling
                        .into_iter()
                        .map(|id| format!("[{app_str}] MCP '{id}' no longer exists, skipped")),
                );
                for (id, enabled) in toggles {
                    if let Err(error) = McpService::toggle_app(state, &id, app.clone(), enabled) {
                        warnings.push(format!(
                            "[{app_str}] toggle MCP '{id}' -> {enabled} failed: {error}"
                        ));
                    }
                }
            }

            if let Some(Some(target_ids)) = payload.skills.get(app) {
                let current = state
                    .db
                    .get_all_installed_skills()?
                    .values()
                    .map(|skill| (skill.id.clone(), skill.apps.is_enabled_for(app)))
                    .collect::<Vec<_>>();
                let (toggles, dangling) = plan_toggles(&current, target_ids);
                warnings.extend(
                    dangling
                        .into_iter()
                        .map(|id| format!("[{app_str}] skill '{id}' no longer exists, skipped")),
                );
                for (id, enabled) in toggles {
                    if let Err(error) = SkillService::toggle_app(&state.db, &id, app, enabled) {
                        warnings.push(format!(
                            "[{app_str}] toggle skill '{id}' -> {enabled} failed: {error}"
                        ));
                    }
                }
            }

            if let Some(Some(target_prompt)) = payload.prompts.get(app) {
                match state.db.get_prompts(app_str)?.get(target_prompt) {
                    None => warnings.push(format!(
                        "[{app_str}] prompt '{target_prompt}' no longer exists, skipped"
                    )),
                    Some(prompt) if prompt.enabled => {}
                    Some(_) => {
                        if let Err(error) =
                            PromptService::enable_prompt(state, app.clone(), target_prompt)
                        {
                            warnings.push(format!(
                                "[{app_str}] enable prompt '{target_prompt}' failed: {error}"
                            ));
                        }
                    }
                }
            }
        }

        state
            .db
            .set_current_profile_id(scope.as_str(), Some(profile_id))?;
        Ok(warnings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn scope_roundtrips_and_rejects_unsupported_apps() {
        for scope in ProfileScope::ALL {
            assert_eq!(ProfileScope::parse(scope.as_str()).unwrap(), scope);
            assert_eq!(
                serde_json::to_string(&scope).unwrap(),
                format!("\"{}\"", scope.as_str())
            );
        }
        assert!(ProfileScope::parse("gemini").is_err());
    }

    #[test]
    fn payload_distinguishes_uncaptured_from_captured_empty() {
        let mut payload: ProfilePayload =
            serde_json::from_str(r#"{"providers":{"claude":"p1"},"mcp":{"claude":[]}}"#).unwrap();
        assert!(payload.scope_captured(ProfileScope::Claude));
        assert!(!payload.scope_captured(ProfileScope::Codex));
        assert_eq!(payload.mcp.claude, Some(vec![]));
        assert_eq!(payload.mcp.codex, None);

        let fresh = ProfilePayload {
            providers: PerApp {
                claude: Some("p2".into()),
                codex: Some("must-not-leak".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        payload.providers.codex = Some("c1".into());
        payload.merge_scope_from(&fresh, ProfileScope::Claude);
        assert_eq!(payload.providers.claude.as_deref(), Some("p2"));
        assert_eq!(payload.providers.codex.as_deref(), Some("c1"));
    }

    #[test]
    fn toggle_plan_only_changes_differences_and_reports_dangling_ids() {
        let current = vec![
            ("a".to_string(), true),
            ("b".to_string(), false),
            ("c".to_string(), true),
            ("d".to_string(), false),
        ];
        let (toggles, dangling) = plan_toggles(&current, &ids(&["a", "b", "ghost"]));
        assert_eq!(
            toggles,
            vec![("b".to_string(), true), ("c".to_string(), false)]
        );
        assert_eq!(dangling, ids(&["ghost"]));
    }
}
