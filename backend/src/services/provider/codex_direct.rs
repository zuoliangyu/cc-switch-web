//! Codex 的关键字段、登录、目录、账号标记与暂存统一提交。
//! Web 保留现有账号管理器和代理接管锁，不使用桌面端数据路径。
use super::codex_login::AuthPlan;
use super::codex_login::{self, AuthInput, AuthTarget, LoginStash, STASH_FILENAME};
use super::codex_official_models::{self, NativeRows, OfficialLogin, OfficialSkip};
use super::ProviderService;
use crate::app_config::AppType;
use crate::codex_config::{
    codex_auth_has_credential_login_material, codex_config_auth_store_mode,
    codex_disables_web_search, codex_live_auth_is_managed_chatgpt_login,
    codex_managed_oauth_marker_bytes, extract_codex_auth_api_key, get_codex_auth_path,
    get_codex_config_path, get_codex_managed_oauth_live_auth_marker_path,
    get_codex_model_catalog_path, plan_codex_model_catalog, CodexAuthStoreMode,
};
use crate::codex_config::{
    plan_codex_stack_catalog, CodexCatalogRow, CodexStackCatalogMember, CodexStackRoute,
};
use crate::config::sorted_json_bytes;
use crate::database::Database;
use crate::error::AppError;
use crate::live::engine::{digest, read_current, DeviceStore, LiveFile};
use crate::live::patch::toml::{value_text, TomlDocPatch, TomlSteps};
use crate::live::patch::{Guarded, LivePatch, WholeFile};
use crate::live::project::codex::official_mirror_table;
use crate::live::project::codex::{
    proxy_route_table, requires_openai_auth, row_catalog_pointer, CodexConfigPatch,
    CodexProjection, KnownTable, Route, RouteAuth, RouteWrite, RowInput, ROUTE_ID,
    WEB_SEARCH_DISABLED,
};
use crate::mode::contract::CONTRACT_VERSION;
use crate::mode::operation::{AppWrite, FileChange, OperationReport};
use crate::mode::stack::Member;
use crate::mode::state::Contract;
use crate::mode::state::{self, op, PendingTarget, Written};
use crate::provider::Provider;
use crate::proxy::providers::codex_oauth_auth::CodexLiveAuthSwitchGuard;
use crate::services::subscription::CodexKeychainLogin;
use crate::store::AppState;
use serde_json::{Map, Value};
use toml_edit::{Item, Table, Value as TomlValue};
fn app() -> &'static str {
    AppType::Codex.as_str()
}

/// 官方卡：`category == "official"`，或按 `is_codex_official_provider` 认出来的（早期
/// 绑定托管账号时没存 category 的卡）。
pub(crate) fn is_official(provider: &Provider) -> bool {
    provider.category.as_deref() == Some("official")
        || crate::proxy::providers::is_codex_official_provider(provider)
}

fn managed_account(provider: &Provider) -> Option<String> {
    ProviderService::managed_codex_oauth_account_id(provider)
}

fn configured_proxy_base_url(db: &Database) -> Result<String, AppError> {
    let config = db.get_global_proxy_config_sync()?;
    let host = match config.listen_address.as_str() {
        "0.0.0.0" => "127.0.0.1",
        "::" => "[::1]",
        host => host,
    };
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Ok(format!("http://{}:{}/v1", host, config.listen_port))
}
/// 官方代理契约没有占位 Key，按监听地址识别，避免把其它本地网关误当接管残留。
pub(crate) fn routes_official_to_proxy(db: &Database, text: &str) -> bool {
    let Ok(base) = configured_proxy_base_url(db) else {
        return false;
    };
    crate::codex_config::codex_config_routes_official_to_proxy(text, |url| {
        if let Some(host) = base
            .strip_suffix("0/v1")
            .filter(|_| base.ends_with(":0/v1"))
        {
            url.strip_prefix(host)
                .and_then(|rest| rest.strip_suffix("/v1"))
                .is_some_and(|port| port.parse::<u16>().is_ok_and(|port| port != 0))
        } else {
            url == base
        }
    })
}
#[derive(Clone, Copy)]
pub(crate) enum Target<'a> {
    Direct(Option<&'a Provider>),
    Proxy {
        route: &'a Provider,
        base_url: &'a str,
        stack: &'a [Member],
    },
}
#[derive(Clone, Copy)]
pub(crate) enum Owner<'a> {
    Provider(&'a Provider),
    Contract {
        contract: &'a Contract,
        route: Option<&'a Provider>,
    },
    None,
}
impl<'a> Owner<'a> {
    fn provider(&self) -> Option<&'a Provider> {
        match self {
            Self::Provider(p) => Some(p),
            Self::Contract { route, .. } => *route,
            Self::None => None,
        }
    }
}
#[derive(Default)]
pub(crate) struct Prepared {
    target_login: Option<(String, Value)>,
    outgoing: Option<(String, CodexLiveAuthSwitchGuard)>,
    native: Option<NativeRows>,
    keychain: Option<CodexKeychainLogin>,
}
fn target_provider<'a>(target: &Target<'a>) -> Option<&'a Provider> {
    match target {
        Target::Direct(p) => *p,
        Target::Proxy { route, .. } => Some(route),
    }
}
pub(crate) fn prepare(
    state: &AppState,
    owner: &Owner<'_>,
    target: &Target<'_>,
) -> Result<Prepared, AppError> {
    let provider = target_provider(target);
    let target_account = provider.and_then(managed_account);
    let outgoing = owner
        .provider()
        .and_then(managed_account)
        .filter(|account| Some(account) != target_account.as_ref())
        .map(|account| {
            let guard =
                ProviderService::prepare_outgoing_managed_codex_live_auth(state, Some(&account))?
                    .expect("outgoing account");
            Ok::<_, AppError>((account, guard))
        })
        .transpose()?;
    let target_login = provider
        .map(|p| ProviderService::preflight_managed_codex_provider(state, &AppType::Codex, p))
        .transpose()?
        .flatten()
        .map(|p| (target_account.expect("managed account"), row_auth(&p)));
    Ok(Prepared {
        target_login,
        outgoing,
        ..Prepared::default()
    })
}
pub(crate) fn current_provider(db: &Database) -> Result<Option<Provider>, AppError> {
    crate::settings::get_effective_current_provider(db, &AppType::Codex)?
        .map(|id| db.get_provider_by_id(&id, app()))
        .transpose()
        .map(Option::flatten)
}
pub(crate) fn read_config_text() -> Result<String, AppError> {
    let path = get_codex_config_path();
    String::from_utf8(read_current(&path)?.unwrap_or_default())
        .map_err(|e| AppError::Message(format!("Codex config.toml 不是 UTF-8: {e}")))
}
fn live_is_managed(prepared: &Prepared, live: Option<&Value>) -> bool {
    let managed_accounts: Vec<&str> = prepared
        .outgoing
        .iter()
        .filter(|(_, guard)| !matches!(guard, CodexLiveAuthSwitchGuard::MissingAccount))
        .map(|(account, _)| account.as_str())
        .chain(
            prepared
                .target_login
                .iter()
                .map(|(account, _)| account.as_str()),
        )
        .collect();
    live.is_some_and(|auth| {
        managed_accounts
            .iter()
            .any(|account| codex_live_auth_is_managed_chatgpt_login(auth, account))
    })
}

/// 这次操作切到第三方时是否保留 `auth.json` 里的登录。退出 CC Switch 时的分离只是临时
/// 指回直连，下次启动还要接上代理：照保留登录开关删掉登录，CC Switch 关着时 Codex 桌面版
/// 没有 ChatGPT 登录就续不了会话，接上后也回不来（#8431）。
fn preserve_login(op_name: &str) -> bool {
    op_name == op::DETACH || crate::settings::preserve_codex_official_auth_on_switch()
}

fn auth_target<'a>(goal: &'a AuthGoal, op_name: &str) -> AuthTarget<'a> {
    match goal {
        AuthGoal::ThirdParty => AuthTarget::ThirdParty {
            preserve: preserve_login(op_name),
        },
        AuthGoal::KeepNative => AuthTarget::ProxyThirdParty {
            restore_last: op_name == op::ENTER || op_name == op::ATTACH,
        },
        AuthGoal::Official(row_auth) => AuthTarget::Official { row_auth },
        AuthGoal::Managed(auth) => AuthTarget::Managed { auth },
    }
}

fn project(provider: &Provider) -> Result<CodexProjection, AppError> {
    CodexProjection::of(&RowInput {
        settings: &provider.settings_config,
        official: is_official(provider),
        proxy_injected_oauth: provider.uses_proxy_injected_oauth(),
    })
}

/// 这个供应商的独有字段，含 `web_search`（需要时为 `"disabled"`）。
fn exclusive_of(provider: &Provider, projection: &CodexProjection) -> Vec<(String, TomlValue)> {
    let mut exclusive = projection.exclusive.clone();
    let profile = crate::proxy::providers::resolve_codex_catalog_tool_profile(provider);
    if codex_disables_web_search(
        &provider.settings_config,
        &projection.catalog_input_text(),
        profile,
    ) {
        exclusive.retain(|(key, _)| key != "web_search");
        exclusive.push((
            "web_search".to_string(),
            TomlValue::from(WEB_SEARCH_DISABLED),
        ));
    }
    exclusive
}

pub(crate) fn outgoing_exclusive(owner: &Owner<'_>) -> Vec<(String, TomlValue)> {
    match owner {
        Owner::Provider(provider) => match project(provider) {
            Ok(projection) => {
                let mut fields = exclusive_of(provider, &projection);
                fields.extend(row_catalog_pointer(&projection.top).cloned());
                fields
            }
            Err(err) => {
                log::warn!(
                    "无法投影 Codex 供应商 {} 的独有字段，切走时不清理它们: {err}",
                    provider.id
                );
                Vec::new()
            }
        },
        Owner::Contract { contract, .. } => contract
            .exclusive
            .iter()
            .filter_map(|(key, value)| {
                Some((key.clone(), value.as_str()?.parse::<TomlValue>().ok()?))
            })
            .collect(),
        Owner::None => Vec::new(),
    }
}

struct RowFacts {
    retired: Vec<KnownTable>,
    third_party_keys: Vec<String>,
    official_logins: Vec<Value>,
}

fn row_facts(db: &Database) -> Result<RowFacts, AppError> {
    let mut facts = RowFacts {
        retired: Vec::new(),
        third_party_keys: Vec::new(),
        official_logins: Vec::new(),
    };
    for provider in db.get_all_providers(app())?.values() {
        let auth = provider.settings_config.get("auth");
        if is_official(provider) {
            if managed_account(provider).is_none() {
                if let Some(auth) =
                    auth.filter(|auth| codex_auth_has_credential_login_material(auth))
                {
                    facts.official_logins.push(auth.clone());
                }
            }
            continue;
        }
        if let Some(key) = auth.and_then(extract_codex_auth_api_key) {
            facts.third_party_keys.push(key);
        }
        let Some(doc) = provider
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok())
        else {
            continue;
        };
        let providers = doc.get("model_providers").and_then(Item::as_table_like);
        let base_url_of = |id: &str| {
            providers
                .and_then(|table| table.get(id))
                .and_then(Item::as_table_like)
                .and_then(|table| table.get("base_url"))
                .and_then(Item::as_str)
                .map(|url| url.trim().to_string())
        };
        // 旧版整份写入时，路由表用的是行自己的 id（custom 是 CC Switch 现在写的，不算）。
        let selector = doc
            .get("model_provider")
            .and_then(Item::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty() && *id != ROUTE_ID);
        if let Some((id, base_url)) = selector.and_then(|id| Some((id, base_url_of(id)?))) {
            facts.retired.push(KnownTable {
                id: id.to_string(),
                base_url,
            });
        }
        if let Some(base_url) = doc
            .get("openai_base_url")
            .and_then(Item::as_str)
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
        {
            facts.retired.push(KnownTable {
                id: "cc-switch".to_string(),
                base_url,
            });
        }
    }
    Ok(facts)
}

/// `auth.json` 的去向（拥有所有权的版本，[`run`] 里转成 `codex_login::AuthTarget`）。
#[derive(Debug, Clone)]
enum AuthGoal {
    ThirdParty,
    /// 代理的第三方路由，或者没有直连供应商：不动原生登录，只清托管账号的登录。
    KeepNative,
    Official(Value),
    Managed(Value),
}

/// 行里的 `auth`（没有时是空对象）。
fn row_auth(provider: &Provider) -> Value {
    provider
        .settings_config
        .get("auth")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()))
}

pub(crate) struct Planned {
    pub contract: Contract,
    native_identity: Option<String>,
    config: CodexConfigPatch,
    stamp: Option<RouteAuth>,
    catalog: Option<Vec<u8>>,
    auth: AuthGoal,
    leaving_official: Option<Value>,
    retired_keys: Vec<String>,
    official_logins: Vec<Value>,
}
impl Planned {
    pub(crate) fn config(&self) -> &CodexConfigPatch {
        &self.config
    }
}
pub(crate) fn plan(
    db: &Database,
    owner: &Owner<'_>,
    target: &Target<'_>,
    prepared: &Prepared,
) -> Result<Planned, AppError> {
    let facts = row_facts(db)?;
    let provider = target_provider(target);
    let projection = provider.map(project).transpose()?;

    let (top, nested, mut exclusive) = match (&projection, provider) {
        (Some(projection), Some(provider)) => (
            projection.top.clone(),
            projection.nested.clone(),
            exclusive_of(provider, projection),
        ),
        _ => (Vec::new(), Vec::new(), Vec::new()),
    };

    let official = provider.is_some_and(is_official);
    let managed_login = prepared.target_login.as_ref().map(|(_, auth)| auth.clone());
    let (route, stamp, auth) = match (target, &projection) {
        (Target::Direct(None), _) | (_, None) => (RouteWrite::Default, None, AuthGoal::KeepNative),
        (Target::Direct(Some(provider)), Some(projection)) => {
            let auth = match &managed_login {
                Some(login) => AuthGoal::Managed(login.clone()),
                None if official => AuthGoal::Official(row_auth(provider)),
                None => AuthGoal::ThirdParty,
            };
            match &projection.route {
                Route::Official if crate::settings::unify_codex_session_history() => {
                    (RouteWrite::OfficialMirror, None, auth)
                }
                Route::Official => (
                    RouteWrite::Official {
                        dormant_base_url: configured_proxy_base_url(db)?,
                    },
                    None,
                    auth,
                ),
                Route::Custom { table, auth: kind } => {
                    (RouteWrite::Custom(table.clone()), Some(*kind), auth)
                }
                Route::BuiltIn { id, table } => (
                    RouteWrite::BuiltIn {
                        id: id.clone(),
                        table: table.clone(),
                    },
                    None,
                    auth,
                ),
                Route::Default => (RouteWrite::Default, None, auth),
            }
        }
        (
            Target::Proxy {
                route, base_url, ..
            },
            Some(_),
        ) => {
            if official {
                let auth = match &managed_login {
                    Some(login) => AuthGoal::Managed(login.clone()),
                    None => AuthGoal::Official(row_auth(route)),
                };
                (
                    RouteWrite::OfficialProxy {
                        base_url: base_url.to_string(),
                        unified: crate::settings::unify_codex_session_history(),
                    },
                    None,
                    auth,
                )
            } else {
                (
                    RouteWrite::Custom(proxy_route_table(ROUTE_ID, base_url, false)),
                    Some(RouteAuth::Bearer),
                    AuthGoal::KeepNative,
                )
            }
        }
    };

    let stack = match target {
        Target::Proxy { stack, .. } => *stack,
        Target::Direct(_) => &[],
    };
    let stack_catalog = match (provider, &projection) {
        (Some(provider), Some(projection)) => stack_catalog(provider, projection, stack, prepared)?,
        _ => None,
    };
    let catalog = match (stack_catalog, provider, &projection) {
        (Some(catalog), _, _) => {
            // 窗口类全局键会覆盖目录里的每一行，改由各家写进自己的行。
            exclusive.retain(|(key, _)| !STACK_SUNK_WINDOW_KEYS.contains(&key.as_str()));
            Some(catalog)
        }
        (None, Some(provider), Some(projection)) => {
            plan_codex_model_catalog(
                &provider.settings_config,
                &projection.catalog_input_text(),
                crate::proxy::providers::resolve_codex_catalog_tool_profile(provider),
            )?
            .catalog
        }
        _ => None,
    };
    let catalog = catalog
        .map(|catalog| sorted_json_bytes(&catalog))
        .transpose()?;

    let leaving_official = owner
        .provider()
        .filter(|provider| is_official(provider) && managed_account(provider).is_none())
        .map(row_auth);

    let config = CodexConfigPatch {
        top,
        nested,
        exclusive,
        outgoing: outgoing_exclusive(owner),
        route,
        catalog: catalog.is_some(),
        retired: facts.retired,
    };
    let official_login = match &auth {
        AuthGoal::Official(row_auth) => codex_login::official_login_requirement(row_auth),
        _ => None,
    };
    let contract = contract_of(
        target,
        &config,
        catalog.as_deref(),
        prepared,
        official_login.as_deref(),
    );
    Ok(Planned {
        native_identity: prepared
            .native
            .as_ref()
            .and_then(NativeRows::identity)
            .map(str::to_string),
        contract,
        config,
        stamp,
        catalog,
        auth,
        leaving_official,
        retired_keys: facts.third_party_keys,
        official_logins: facts.official_logins,
    })
}

/// 读登录暂存。`live` 是现在的 `auth.json`：升级更早版本的暂存时要用（见 `LoginStash::loaded`）。
fn load_stash(
    store: &DeviceStore,
    official_logins: &[Value],
    live: Option<&Value>,
) -> Result<(LoginStash, Option<Vec<u8>>), AppError> {
    let path = store.file(STASH_FILENAME);
    let pre = read_current(&path)?;
    let stash = match pre.as_deref() {
        Some(bytes) => serde_json::from_slice::<LoginStash>(bytes)
            .map_err(|e| {
                AppError::Message(format!(
                    "Codex 登录暂存 {} 无法解析，本次未写入: {e}",
                    path.display()
                ))
            })?
            .loaded(official_logins, live),
        None => LoginStash::seeded_from_rows(official_logins),
    };
    Ok((stash, pre))
}
fn guarded(pre: Option<&[u8]>, then: WholeFile) -> Guarded {
    Guarded {
        expected_pre: digest(pre),
        then,
    }
}

/// 执行一次 Codex 写入：拿写锁，决定 `auth.json` 的去向，和 `config.toml`、模型目录、
/// 托管账号标记、登录暂存一起提交，最后落定 `pending`（指针、模式状态）。
pub(crate) fn run(
    db: &Database,
    op: &str,
    planned: Planned,
    prepared: &Prepared,
    pending: PendingTarget,
) -> Result<OperationReport, AppError> {
    run_with_edits(db, op, planned, prepared, pending, None)
}

/// 同 [`run`]，另把编辑器里对全局设置的改动在同一次 `config.toml` 写入里应用。
pub(crate) fn run_with_edits(
    db: &Database,
    op: &str,
    planned: Planned,
    prepared: &Prepared,
    mut pending: PendingTarget,
    edits: Option<&super::editor_toml::TomlEdits>,
) -> Result<OperationReport, AppError> {
    // 先补完上一次的操作，再读 auth.json 和登录暂存：补完会改写它们，按补完前读到的内容
    // 写下去会被当成外部修改；`owner` 也是调用方按补完前的指针定的。
    let write = AppWrite::begin(db, app())?;
    let store = &write.store;

    // 切走的托管账号：采纳之后 CLI 又刷新了就停下，免得删掉新 token。
    if let Some((account, outgoing)) = &prepared.outgoing {
        outgoing.ensure_unchanged(account)?;
    }

    let auth_path = get_codex_auth_path();
    let auth_pre = read_current(&auth_path)?;
    let live_auth = auth_pre
        .as_deref()
        .map(|bytes| {
            serde_json::from_slice::<Value>(bytes).map_err(|e| {
                AppError::Message(format!("Codex auth.json 无法解析，本次未写入: {e}"))
            })
        })
        .transpose()?;
    if live_auth.as_ref().is_some_and(|auth| !auth.is_object()) {
        return Err(AppError::Message(
            "Codex auth.json 必须是 JSON 对象，本次未写入".into(),
        ));
    }
    let live_is_managed = live_is_managed(prepared, live_auth.as_ref());
    let outgoing_missing = prepared
        .outgoing
        .as_ref()
        .is_some_and(|(_, guard)| matches!(guard, CodexLiveAuthSwitchGuard::MissingAccount));

    let (stash, stash_pre) = load_stash(store, &planned.official_logins, live_auth.as_ref())?;
    let preserve = preserve_login(op);
    let auth_plan = codex_login::plan(AuthInput {
        live: live_auth.as_ref(),
        live_is_managed,
        third_party_keys: &planned.retired_keys,
        leaving_official: planned.leaving_official.as_ref(),
        target: auth_target(&planned.auth, op),
        stash,
        now: chrono::Utc::now().timestamp(),
    });
    let config_path = get_codex_config_path();
    let config_pre = read_current(&config_path)?;
    let config_text = match edits {
        Some(edits) => String::from_utf8(edits.apply(&config_path, config_pre.as_deref())?)
            .map_err(|e| AppError::Message(e.to_string()))?,
        None => read_config_text()?,
    };
    // 目录里的官方行是按拿锁前预测的登录取的：实际的目标登录换了人（Codex 恰好重新登录、
    // settle 补完了上一次操作），就停下，什么都不写。不能换成别的来源：目录已经算进契约。
    // 钥匙串用取完官方行后读到的那次（见 `prepare_official_rows`），不在锁里读。
    if let Some(expected) = &planned.native_identity {
        let keychain = || {
            prepared
                .keychain
                .clone()
                .unwrap_or(CodexKeychainLogin::Unknown)
        };
        let actual = login_after(&auth_plan, live_auth.as_ref(), &config_text, keychain)
            .and_then(|auth| OfficialLogin::of(&auth).ok())
            .map(|login| login.identity);
        if actual.as_deref() != Some(expected.as_str()) {
            return Err(AppError::localized(
                "codex.official_models_login_changed",
                "Codex 的登录在这次操作期间变了，官方模型列表对不上新的登录。本次没有写入任何文件，请重试",
                "The Codex login changed during this operation, so the official model list no longer matches it. Nothing was written; please try again",
            ));
        }
    }
    // Codex 把登录存在哪由 `cli_auth_credentials_store` 决定：只存 auth.json 时看它；
    // 存在系统钥匙串（keyring、auto）或认不出时看不到登录，直连按保留登录开关、代理按
    // 「登录不动」处理；ephemeral 从不落盘，当成没登录。
    let login = match codex_config_auth_store_mode(&config_text) {
        CodexAuthStoreMode::File => auth_plan.login_on_disk,
        CodexAuthStoreMode::Ephemeral => false,
        CodexAuthStoreMode::Keyring | CodexAuthStoreMode::Auto | CodexAuthStoreMode::Unknown => {
            !matches!(planned.auth, AuthGoal::ThirdParty) || preserve
        }
    };
    let mut config = planned.config;
    if let Some(exclusive) = state::written(store, app())?
        .and_then(|w| w.extra.get("codexExclusive").cloned())
        .and_then(|v| v.as_object().cloned())
    {
        config.outgoing = exclusive
            .into_iter()
            .filter_map(|(k, v)| Some((k, v.as_str()?.parse::<TomlValue>().ok()?)))
            .collect();
    }
    let mut written = Written::default();
    written.extra.insert(
        "codexExclusive".into(),
        Value::Object(
            config
                .exclusive
                .iter()
                .chain(row_catalog_pointer(&config.top))
                .map(|(k, v)| (k.clone(), Value::String(value_text(v))))
                .collect(),
        ),
    );
    pending.written = Some(written);
    if let (Some(kind), RouteWrite::Custom(table)) = (planned.stamp, &mut config.route) {
        if matches!(kind, RouteAuth::Bearer | RouteAuth::EnvKey) {
            table.insert(
                "requires_openai_auth",
                toml_edit::value(requires_openai_auth(kind, login)),
            );
        }
    }

    let auth_patch = auth_plan.auth.clone().map(|auth| {
        let then = match auth {
            Some(auth) => sorted_json_bytes(&auth).map(WholeFile::Write),
            None => Ok(WholeFile::Delete),
        };
        then.map(|then| guarded(auth_pre.as_deref(), then))
    });
    let auth_patch = auth_patch.transpose()?.or_else(|| {
        Some(guarded(
            auth_pre.as_deref(),
            match &auth_pre {
                Some(bytes) => WholeFile::Write(bytes.clone()),
                None => WholeFile::Delete,
            },
        ))
    });

    let marker_path = get_codex_managed_oauth_live_auth_marker_path();
    let marker_pre = read_current(&marker_path)?;
    let marker_patch = match (&prepared.target_login, &auth_plan.auth) {
        (Some((account, login)), Some(Some(written))) if written == login => {
            codex_managed_oauth_marker_bytes(login, account)?
                .map(|bytes| guarded(marker_pre.as_deref(), WholeFile::Write(bytes)))
        }
        _ if marker_pre.is_some()
            && ((live_is_managed && auth_plan.auth == Some(None)) || outgoing_missing) =>
        {
            Some(guarded(marker_pre.as_deref(), WholeFile::Delete))
        }
        _ => None,
    };

    let stash_patch = auth_plan
        .stash
        .as_ref()
        .map(|stash| {
            serde_json::to_vec_pretty(stash)
                .map(|bytes| guarded(stash_pre.as_deref(), WholeFile::Write(bytes)))
                .map_err(|e| AppError::Message(format!("序列化 Codex 登录暂存失败: {e}")))
        })
        .transpose()?;
    let catalog_patch = planned.catalog.map(WholeFile::Write);
    // 先应用编辑器里的全局改动（有的话），再换关键字段。
    let mut config_steps: Vec<&dyn TomlDocPatch> = Vec::new();
    if let Some(edits) = edits {
        config_steps.push(edits);
    }
    config_steps.push(&config);
    let config_patch = TomlSteps(config_steps);

    let mut changes: Vec<FileChange<'_>> = Vec::new();
    // auth.json 放第一个：Codex CLI 恰好在这时刷新了登录，就在发布任何文件之前停下。
    if let Some(patch) = &auth_patch {
        changes.push(FileChange {
            file: LiveFile::private(&auth_path),
            patch: patch as &dyn LivePatch,
        });
    }
    changes.push(FileChange {
        file: LiveFile::private(get_codex_config_path()),
        patch: &config_patch,
    });
    if let Some(patch) = &catalog_patch {
        changes.push(FileChange {
            file: LiveFile::shared(get_codex_model_catalog_path()),
            patch,
        });
    }
    if let Some(patch) = &marker_patch {
        changes.push(FileChange {
            file: LiveFile::private(&marker_path),
            patch,
        });
    }
    if let Some(patch) = &stash_patch {
        changes.push(FileChange {
            file: LiveFile::private(store.file(STASH_FILENAME)),
            patch,
        });
    }

    let report = write.run(op, &changes, pending)?;
    super::codex_client_catalog::observe(&DeviceStore::for_device());
    Ok(report)
}

pub(crate) fn write_direct(
    state: &AppState,
    previous: Option<&Provider>,
    provider: &Provider,
    pointer: bool,
    edits: Option<&super::editor_toml::TomlEdits>,
) -> Result<OperationReport, AppError> {
    let owner = previous.map(Owner::Provider).unwrap_or(Owner::None);
    let target = Target::Direct(Some(provider));
    let prepared = prepare(state, &owner, &target)?;
    let planned = plan(&state.db, &owner, &target, &prepared)?;
    run_with_edits(
        &state.db,
        if pointer { op::SWITCH } else { op::APPLY },
        planned,
        &prepared,
        PendingTarget::pointer(pointer.then(|| provider.id.clone())),
        edits,
    )
}
pub(crate) fn preflight(db: &Database, provider: &Provider) -> Result<(), AppError> {
    plan(
        db,
        &Owner::None,
        &Target::Direct(Some(provider)),
        &Prepared::default(),
    )
    .map(|_| ())
}

/// 仅 Database 的恢复入口，托管凭据须由调用方预先刷新，不能把空行当成官方登录写入。
pub(crate) fn reapply_prepared(db: &Database, provider: &Provider) -> Result<(), AppError> {
    crate::mode::operation::settle(db, app())?;
    let previous = current_provider(db)?;
    let owner = previous.as_ref().map_or(Owner::None, Owner::Provider);
    let mut prepared = Prepared::default();
    if let Some(account) = managed_account(provider) {
        let auth = row_auth(provider);
        if !codex_auth_has_credential_login_material(&auth) {
            return Err(AppError::Message(
                "Codex 托管登录必须由账号管理器预先刷新".into(),
            ));
        }
        codex_managed_oauth_marker_bytes(&auth, &account)?;
        prepared.target_login = Some((account, auth));
    }
    let planned = plan(db, &owner, &Target::Direct(Some(provider)), &prepared)?;
    run(db, op::APPLY, planned, &prepared, PendingTarget::default())?;
    Ok(())
}

/// 旧 Web 代理的配置形状已完成安全校验；保留其选路契约，只替换关键字段。
/// 新模式控制器接入前，不能把旧官方代理路由当作第三方重新推断凭据。
pub(crate) fn apply_takeover_settings(db: &Database, settings: &Value) -> Result<(), AppError> {
    crate::mode::operation::settle(db, app())?;
    let write = AppWrite::begin(db, app())?;
    let text = settings
        .get("config")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Config("Codex 配置缺少 config 字段".into()))?;
    let doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| AppError::Config(e.to_string()))?;
    let mut input = settings.clone();
    input
        .as_object_mut()
        .ok_or_else(|| AppError::Config("Codex 配置必须是对象".into()))?
        .entry("auth")
        .or_insert_with(|| serde_json::json!({}));
    let projection = CodexProjection::of(&RowInput {
        settings: &input,
        official: true,
        proxy_injected_oauth: false,
    })?;
    let route = match doc.get("model_provider").and_then(Item::as_str) {
        Some(id) => RouteWrite::BuiltIn {
            id: id.to_string(),
            table: doc
                .get("model_providers")
                .and_then(|v| v.get(id))
                .and_then(Item::as_table_like)
                .map(|table| {
                    table
                        .iter()
                        .map(|(key, value)| (key.to_string(), value.clone()))
                        .collect()
                }),
        },
        None => RouteWrite::Default,
    };
    let previous = current_provider(db)?;
    let mut outgoing = outgoing_exclusive(&previous.as_ref().map_or(Owner::None, Owner::Provider));
    if let Some(exclusive) = state::written(&write.store, app())?
        .and_then(|w| w.extra.get("codexExclusive").cloned())
        .and_then(|v| v.as_object().cloned())
    {
        outgoing = exclusive
            .into_iter()
            .filter_map(|(k, v)| Some((k, v.as_str()?.parse::<TomlValue>().ok()?)))
            .collect();
    }
    let config = CodexConfigPatch {
        top: projection.top,
        nested: projection.nested,
        exclusive: projection.exclusive,
        outgoing,
        route,
        catalog: doc
            .get("model_catalog_json")
            .and_then(Item::as_str)
            .is_some_and(|p| p.ends_with(crate::live::project::codex::CATALOG_FILENAME)),
        retired: row_facts(db)?.retired,
    };
    let mut written = Written::default();
    written.extra.insert(
        "codexExclusive".into(),
        Value::Object(
            config
                .exclusive
                .iter()
                .chain(row_catalog_pointer(&config.top))
                .map(|(k, v)| (k.clone(), Value::String(value_text(v))))
                .collect(),
        ),
    );
    write.run(
        op::APPLY,
        &[FileChange {
            file: LiveFile::private(get_codex_config_path()),
            patch: &TomlSteps(vec![&config]),
        }],
        PendingTarget {
            written: Some(written),
            ..Default::default()
        },
    )?;
    Ok(())
}
/// 旧代理恢复已经解析的备份；全局设置继续以 live 为准，账号标记同凭据一起提交。
pub(crate) fn restore_settings(
    db: &Database,
    settings: &Value,
    managed_id: Option<&str>,
) -> Result<(), AppError> {
    crate::mode::operation::settle(db, app())?;
    let keep_native = settings.get("auth").is_none();
    let mut settings = settings.clone();
    settings
        .as_object_mut()
        .ok_or_else(|| AppError::Config("Codex 配置必须是对象".into()))?
        .entry("auth")
        .or_insert_with(|| serde_json::json!({}));
    let previous = current_provider(db)?;
    let mut provider = Provider::with_id(String::new(), String::new(), settings.clone(), None);
    if previous.as_ref().is_some_and(is_official) {
        provider.category = Some("official".into());
    }
    let owner = previous.as_ref().map_or(Owner::None, Owner::Provider);
    let mut prepared = Prepared::default();
    if let Some(id) = managed_id {
        prepared.target_login = Some((id.to_string(), row_auth(&provider)));
    }
    let mut planned = plan(db, &owner, &Target::Direct(Some(&provider)), &prepared)?;
    if keep_native && managed_id.is_none() {
        planned.auth = AuthGoal::KeepNative;
    }
    run(db, op::APPLY, planned, &prepared, PendingTarget::default())?;
    Ok(())
}

fn table_text(table: &Table) -> String {
    let mut table = table.clone();
    table.remove("requires_openai_auth");
    let mut doc = toml_edit::DocumentMut::new();
    doc.insert("t", Item::Table(table));
    doc.to_string()
}

/// 代理契约：路由供应商在客户端那一侧的全部要求。摘要相同，换路由时客户端文件就不读
/// 也不写。`requires_openai_auth` 跟着盘上的登录走，不算进契约；官方路由要的是谁的登录
/// （托管账号，或 `official_login`：没绑托管账号的官方卡行里的账号）算进去。
fn contract_of(
    target: &Target<'_>,
    config: &CodexConfigPatch,
    catalog: Option<&[u8]>,
    prepared: &Prepared,
    official_login: Option<&str>,
) -> Contract {
    let base_url = match target {
        Target::Proxy { base_url, .. } => *base_url,
        Target::Direct(_) => "",
    };
    let (selector, table) = match &config.route {
        RouteWrite::Custom(table) => (ROUTE_ID, table_text(table)),
        RouteWrite::OfficialProxy {
            base_url,
            unified: true,
        } => (
            ROUTE_ID,
            table_text(&official_mirror_table(Some(base_url), false)),
        ),
        // 不写选路，改道写在顶层（地址已经在 `url` 里）。
        RouteWrite::OfficialProxy { unified: false, .. } => ("", "openai_base_url".to_string()),
        _ => ("", String::new()),
    };
    let pairs = |entries: &[(String, TomlValue)]| -> Vec<Value> {
        let mut pairs: Vec<Value> = entries
            .iter()
            .map(|(key, value)| serde_json::json!([key, value_text(value)]))
            .collect();
        pairs.sort_by_key(|pair| pair[0].as_str().unwrap_or_default().to_string());
        pairs
    };
    let nested: Vec<Value> = config
        .nested
        .iter()
        .map(|(path, value)| serde_json::json!([path.join("."), value_text(value)]))
        .collect();
    let parts = serde_json::json!({
        "app": "codex",
        "version": CONTRACT_VERSION,
        "url": base_url,
        "top": pairs(&config.top),
        "nested": nested,
        "exclusive": pairs(&config.exclusive),
        "selector": selector,
        "table": table,
        "catalog": digest(catalog),
        "managed": prepared.target_login.as_ref().map(|(account, _)| account),
        "login": official_login,
    });
    let key = digest(Some(
        &serde_json::to_vec(&parts).expect("contract parts serialize"),
    ))
    .expect("digest");
    Contract {
        version: CONTRACT_VERSION,
        key,
        exclusive: config
            .exclusive
            .iter()
            .chain(row_catalog_pointer(&config.top))
            .map(|(key, value)| (key.clone(), Value::String(value_text(value))))
            .collect(),
    }
}

/// 官方做路由、又发布了 Stack 模型时，按操作之后 Codex 会用的登录取官方模型行。可能联网，
/// 所以和 [`prepare`] 一样在拿写锁之前做；登录是按未加锁读到的内容预测的，拿锁后在
/// [`run_with_edits`] 里按真实输入再核对一次。
///
/// 读钥匙串（`security` 可能等用户点授权框）和取官方行（跑 Codex 子进程、联网最多
/// 10 秒）放到阻塞线程池里做，不占异步运行时的工作线程。
pub(crate) async fn prepare_official_rows(
    db: &Database,
    owner: &Owner<'_>,
    target: &Target<'_>,
    prepared: &mut Prepared,
) -> Result<(), AppError> {
    let Target::Proxy { route, stack, .. } = target else {
        return Ok(());
    };
    if !needs_official_rows(route, stack) {
        return Ok(());
    }
    if matches!(
        codex_config_auth_store_mode(&read_config_text()?),
        CodexAuthStoreMode::Keyring | CodexAuthStoreMode::Auto
    ) {
        prepared.keychain = Some(off_runtime(codex_official_models::keychain_login).await?);
    }
    let login = predicted_official_login(db, owner, target, prepared)?;
    let rows = off_runtime(move || codex_official_models::rows_for_switch(&login)).await?;
    // 取官方行最多要 10 秒，这期间 Codex 可能在钥匙串里换了号。取完再读一次，拿锁后按
    // 这次读到的核对（见 `run_with_edits`），换了号就停下。
    if rows.identity().is_some() && prepared.keychain.is_some() {
        prepared.keychain = Some(off_runtime(codex_official_models::keychain_login).await?);
    }
    prepared.native = Some(rows);
    Ok(())
}

/// 放到阻塞线程池里做，不占异步运行时的工作线程。
pub(crate) async fn off_runtime<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| AppError::Message(format!("后台线程异常退出: {error}")))
}

/// 官方做路由、发布了 Stack 模型：目录里要写全官方模型。
pub(crate) fn needs_official_rows(route: &Provider, stack: &[Member]) -> bool {
    !stack.is_empty() && is_official(route)
}

/// 按未加锁读到的内容预测这次操作之后 Codex 会用的登录（能取官方列表的才是 `Ok`，否则带
/// 着取不到的原因）。钥匙串没预先读过（[`prepare_official_rows`] 之外的调用方）就在用到时
/// 读，调用方要在阻塞线程里。
pub(crate) fn predicted_official_login(
    db: &Database,
    owner: &Owner<'_>,
    target: &Target<'_>,
    prepared: &Prepared,
) -> Result<Result<OfficialLogin, OfficialSkip>, AppError> {
    let (auth_plan, live) = predicted_auth(db, owner, target, prepared)?;
    let keychain = || {
        prepared
            .keychain
            .clone()
            .unwrap_or_else(codex_official_models::keychain_login)
    };
    Ok(
        login_after(&auth_plan, live.as_ref(), &read_config_text()?, keychain)
            .ok_or(OfficialSkip::NoLogin)
            .and_then(|auth| OfficialLogin::of(&auth)),
    )
}

/// 按未加锁读到的内容预测这次操作对 `auth.json` 的去向，和读到的 live `auth.json`。只读。
fn predicted_auth(
    db: &Database,
    owner: &Owner<'_>,
    target: &Target<'_>,
    prepared: &Prepared,
) -> Result<(AuthPlan, Option<Value>), AppError> {
    // 先按没有官方行算一遍，拿到这次对 auth.json 的去向（目录在第二遍才算）。
    let planned = plan(db, owner, target, prepared)?;
    let live = read_current(&get_codex_auth_path())?
        .map(|bytes| {
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|e| AppError::Message(format!("Codex auth.json 无法解析: {e}")))
        })
        .transpose()?;
    let stash = load_stash(
        &DeviceStore::for_device(),
        &planned.official_logins,
        live.as_ref(),
    )?
    .0;
    let auth_plan = codex_login::plan(AuthInput {
        live: live.as_ref(),
        live_is_managed: live_is_managed(prepared, live.as_ref()),
        third_party_keys: &planned.retired_keys,
        leaving_official: planned.leaving_official.as_ref(),
        target: auth_target(&planned.auth, op::SWITCH),
        stash,
        now: chrono::Utc::now().timestamp(),
    });
    Ok((auth_plan, live))
}

/// 切到 `target` 之后盘上 `auth.json` 的内容（没有文件为 `None`），按未加锁读到的内容
/// 预测、不写任何东西：编辑器显示用。官方卡行里存的登录是旧版留下的快照，Codex 轮换过
/// token 就和盘上的对不上，显示它会误导。
pub(crate) fn predicted_auth_file(
    db: &Database,
    owner: &Owner<'_>,
    target: &Target<'_>,
) -> Result<Option<Value>, AppError> {
    let (auth_plan, live) = predicted_auth(db, owner, target, &Prepared::default())?;
    Ok(file_after(&auth_plan, live.as_ref()))
}

/// 操作之后的 `auth.json`（没有文件为 `None`）。
fn file_after(auth_plan: &AuthPlan, live: Option<&Value>) -> Option<Value> {
    match &auth_plan.auth {
        None => live.cloned(),
        Some(None) => None,
        Some(Some(auth)) => Some(auth.clone()),
    }
}

/// 操作之后 Codex 实际会用的登录，按 `cli_auth_credentials_store`：file 看操作之后的
/// `auth.json`；keyring 看系统钥匙串（CC Switch 不改它）；auto 钥匙串里有就用它，确定
/// 没有才同 file（读不出钥匙串时 Codex 可能用着另一个登录，`auth.json` 不能顶替）；
/// ephemeral 和认不出的没有。`keychain` 只在要看钥匙串时调用。
fn login_after(
    auth_plan: &AuthPlan,
    live: Option<&Value>,
    config_text: &str,
    keychain: impl FnOnce() -> CodexKeychainLogin,
) -> Option<Value> {
    let from_file = || file_after(auth_plan, live);
    match codex_config_auth_store_mode(config_text) {
        CodexAuthStoreMode::File => from_file(),
        CodexAuthStoreMode::Keyring => match keychain() {
            CodexKeychainLogin::Found(login) => Some(login),
            CodexKeychainLogin::Missing | CodexKeychainLogin::Unknown => None,
        },
        CodexAuthStoreMode::Auto => match keychain() {
            CodexKeychainLogin::Found(login) => Some(login),
            CodexKeychainLogin::Missing => from_file(),
            CodexKeychainLogin::Unknown => None,
        },
        CodexAuthStoreMode::Ephemeral | CodexAuthStoreMode::Unknown => None,
    }
}

/// 能不能加进 Stack：配置要能解析。之后才坏掉的成员在目录里跳过（见 [`stack_catalog`]）。
pub(crate) fn check_stack_member(provider: &Provider) -> Result<(), AppError> {
    project(provider).map(|_| ()).map_err(|error| {
        AppError::Message(format!(
            "「{name}」的配置有问题，不能加入聚合 (The configuration of \"{name}\" is invalid, so it cannot join the aggregation): {error}",
            name = provider.name
        ))
    })
}

/// 路由那家的行指定了自己管理的模型目录文件（`model_catalog_json`）：Codex 只读那个
/// 文件，Stack 模型合并不进去。
pub(crate) fn route_owns_catalog(route: &Provider) -> bool {
    project(route).is_ok_and(|projection| row_catalog_pointer(&projection.top).is_some())
}

/// 发布了 Stack 模型时不写进 `config.toml` 的全局键：Codex 拿它们覆盖目录里的每一行。
const STACK_SUNK_WINDOW_KEYS: &[&str] = &["model_context_window", "model_auto_compact_token_limit"];

/// 发布了 Stack 模型时的合并目录（路由那家的行在前，Stack 里的在后）；没有要发布的 Stack 模型，
/// 或者这次发布不了时为 `None`，目录照原来的规则算。
fn stack_catalog(
    route: &Provider,
    projection: &CodexProjection,
    stack: &[Member],
    prepared: &Prepared,
) -> Result<Option<serde_json::Value>, AppError> {
    if stack.is_empty() {
        return Ok(None);
    }
    // 路由那家的行指定了自己管理的目录文件：Codex 只读那个文件，合并不进去（界面上
    // 由 `route_owns_catalog` 给出提示）。
    if row_catalog_pointer(&projection.top).is_some() {
        log::warn!(
            "Codex 路由供应商 {} 使用自己的模型目录文件，Stack 模型不发布",
            route.id
        );
        return Ok(None);
    }
    let route_text = projection.catalog_input_text();
    let route_row = if is_official(route) {
        // 写了目录之后 Codex 只认文件里的模型：拿不到官方行时不能写出只有 Stack 模型的目录。
        match prepared.native.as_ref().and_then(NativeRows::rows) {
            Some(rows) => CodexStackRoute::Official {
                native: rows.to_vec(),
                config_text: &route_text,
            },
            None => {
                if prepared.native.is_some() {
                    log::warn!("读取不到 Codex 模型列表，Stack 模型暂不发布");
                }
                return Ok(None);
            }
        }
    } else {
        CodexStackRoute::ThirdParty(CodexCatalogRow {
            settings: &route.settings_config,
            config_text: &route_text,
            profile: crate::proxy::providers::resolve_codex_catalog_tool_profile(route),
        })
    };

    // 一家的配置坏了（比如云同步带来的行解析不了）只跳过这一家：报错会让进出代理、换
    // 路由、启动时接上这些 Codex 写入全部失败。
    let inputs: Vec<_> = stack
        .iter()
        .filter_map(|member| match project(&member.provider) {
            Ok(projection) => Some((
                member,
                projection.catalog_input_text(),
                crate::proxy::providers::resolve_codex_catalog_tool_profile(&member.provider),
            )),
            Err(error) => {
                log::warn!(
                    "Stack 模型「{}」的配置有问题，这次不发布它: {error}",
                    member.provider.name
                );
                None
            }
        })
        .collect();
    let members: Vec<CodexStackCatalogMember<'_>> = inputs
        .iter()
        .map(|(member, config_text, profile)| CodexStackCatalogMember {
            key: &member.key,
            provider_name: &member.provider.name,
            row: CodexCatalogRow {
                settings: &member.provider.settings_config,
                config_text,
                profile: *profile,
            },
        })
        .collect();
    plan_codex_stack_catalog(route_row, &members).map(Some)
}
