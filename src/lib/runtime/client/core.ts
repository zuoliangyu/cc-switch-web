import { getDefaultAppProxyConfig } from "./defaults";
import {
  addWebProviderToFailoverQueue,
  addWebProvider,
  extractWebCommonConfigSnippet,
  getWebCopilotModels,
  getWebCopilotModelsForAccount,
  getWebCopilotToken,
  getWebCopilotTokenForAccount,
  getWebCopilotUsage,
  getWebCopilotUsageForAccount,
  getWebCodingPlanQuota,
  getWebCodexOauthQuota,
  getWebSubscriptionQuota,
  getWebBalance,
  createWebDbBackup,
  deleteWebEnvVars,
  downloadWebConfigExport,
  deleteWebProvider,
  deleteWebDbBackup,
  getWebEnvConflicts,
  getWebCommonConfigSnippet,
  getWebLiveProviderIds,
  getWebAutoFailoverEnabled,
  getWebAppConfigDir,
  getWebAppConfigDirOverride,
  getWebAvailableProvidersForFailover,
  getWebCircuitBreakerConfig,
  getWebDefaultAppConfigDir,
  getWebDefaultConfigDir,
  getWebDefaultCostMultiplier,
  getWebFailoverQueue,
  getWebGlobalProxyConfig,
  getWebGlobalProxyUrl,
  getWebIsLiveTakeoverActive,
  getWebIsProxyRunning,
  getWebLogConfig,
  getWebConfigDir,
  getWebToolVersions,
  getWebLatestReleaseInfo,
  getWebAutoLaunchStatus,
  setWebAutoLaunch,
  applyWebClaudePluginConfig,
  applyWebClaudeOnboardingSkip,
  clearWebClaudeOnboardingSkip,
  getWebUniversalProvider,
  getWebUniversalProviders,
  getWebOpenClawAgentsDefaults,
  getWebOpenClawDefaultModel,
  getWebOpenClawEnv,
  getWebOpenClawHealth,
  getWebOpenClawLiveProvider,
  getWebOpenClawModelCatalog,
  getWebOpenClawTools,
  getWebHermesHealth,
  getWebHermesLiveProviderIds,
  getWebHermesModelConfig,
  getWebHermesWebUiUrl,
  getWebHermesMemory,
  getWebHermesMemoryLimits,
  getWebOmoLocalFile,
  getWebCurrentOmoProviderId,
  disableWebCurrentOmo,
  getWebOmoSlimLocalFile,
  getWebCurrentOmoSlimProviderId,
  disableWebCurrentOmoSlim,
  getWebPricingModelSource,
  getWebMcpServers,
  getWebProviderHealth,
  getWebProviderUsage,
  fetchWebProviderModels,
  fetchWebWindowsEnvPaths,
  getWebProxyConfig,
  getWebProxyConfigForApp,
  getWebProxyStatus,
  getWebProxyTakeoverStatus,
  getWebClaudeDesktopStatus,
  getWebClaudeDesktopDefaultRoutes,
  getWebPrompts,
  getWebProviders,
  getWebSettings,
  getWebCurrentPromptFileContent,
  getWebCustomEndpoints,
  getWebInstalledSkills,
  checkWebSkillUpdates,
  getWebLiveProviderSettings,
  getWebStreamCheckConfig,
  getWebSkillRepos,
  getWebSkillBackups,
  getWebManagedAuthStatus,
  getWebUnmanagedSkills,
  getWebOptimizerConfig,
  getWebUpstreamProxyStatus,
  listWebManagedAuthAccounts,
  listWebDbBackups,
  logoutWebManagedAuth,
  pollWebManagedAuthAccount,
  renameWebDbBackup,
  removeWebProviderFromFailoverQueue,
  removeWebManagedAuthAccount,
  resetWebCircuitBreaker,
  restoreWebDbBackup,
  restoreWebEnvBackup,
  saveWebSettings,
  scanWebLocalProxies,
  getWebRectifierConfig,
  setWebAutoFailoverEnabled,
  setWebAppConfigDirOverride,
  setWebCommonConfigSnippet,
  setWebDefaultCostMultiplier,
  setWebLogConfig,
  setWebManagedAuthDefaultAccount,
  setWebOptimizerConfig,
  setWebPricingModelSource,
  setWebGlobalProxyUrl,
  setWebRectifierConfig,
  setWebStreamCheckConfig,
  startWebManagedAuthLogin,
  syncWebCurrentProvidersLive,
  syncWebUniversalProvider,
  testWebProxyUrl,
  toggleWebMcpApp,
  launchWebHermesDashboard,
  setWebProxyTakeoverForApp,
  startWebProxyServer,
  stopWebProxyWithRestore,
  openWebProviderTerminal,
  switchWebProvider,
  switchWebProxyProvider,
  importWebMcpFromApps,
  importWebConfigUpload,
  importWebDefaultProviderConfig,
  streamCheckAllWebProviders,
  streamCheckWebProvider,
  importWebPromptFromFile,
  importWebSkillsFromApps,
  installWebSkillUnified,
  migrateWebSkillStorage,
  updateWebSkill,
  upsertWebMcpServer,
  upsertWebPrompt,
  restoreWebSkillBackup,
  searchWebSkillsSh,
  uninstallWebSkillUnified,
  updateWebCircuitBreakerConfig,
  updateWebGlobalProxyConfig,
  deleteWebMcpServer,
  deleteWebPrompt,
  deleteWebSkillBackup,
  addWebSkillRepo,
  discoverWebAvailableSkills,
  deleteWebDailyMemoryFile,
  getWebDailyMemoryFile,
  getWebSessionMessages,
  getWebSessions,
  launchWebSessionTerminal,
  getWebModelPricing,
  getWebModelStats,
  getWebProviderLimits,
  getWebProviderStats,
  getWebRequestDetail,
  getWebRequestLogs,
  getWebUsageDataSources,
  getWebUsageSummary,
  getWebUsageTrends,
  fetchWebdavRemoteInfo,
  addWebCustomEndpoint,
  getWebWorkspaceDirectoryPath,
  getWebWorkspaceFile,
  importWebProvidersFromLive,
  installWebSkillArchives,
  downloadWebdavSync,
  listWebDailyMemoryFiles,
  removeWebSkillRepo,
  removeWebCustomEndpoint,
  removeWebProviderFromLiveConfig,
  saveWebDailyMemoryFile,
  setWebHermesMemory,
  setWebHermesMemoryEnabled,
  saveWebdavSyncSettings,
  setWebOpenClawAgentsDefaults,
  setWebOpenClawDefaultModel,
  setWebOpenClawEnv,
  setWebOpenClawModelCatalog,
  setWebOpenClawTools,
  saveWebWorkspaceFile,
  searchWebDailyMemoryFiles,
  deleteWebSession,
  deleteWebSessions,
  deleteWebModelPricing,
  testWebApiEndpoints,
  testWebdavConnection,
  testWebUsageScript,
  toggleWebSkillApp,
  syncWebSessionUsage,
  uploadWebdavSync,
  updateWebModelPricing,
  updateWebProvider,
  updateWebProvidersSortOrder,
  updateWebProxyConfig,
  updateWebProxyConfigForApp,
  updateWebEndpointLastUsed,
  enableWebPrompt,
  upsertWebUniversalProvider,
  deleteWebUniversalProvider,
} from "./web";

type AppId =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes";

type InvokeArgs = Record<string, unknown> | undefined;

const webUnsupportedError = (command: string): Error =>
  new Error(`[runtime:web] command not available in web runtime: ${command}`);

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  switch (command) {
    case "get_settings":
      return (await getWebSettings()) as T;
    case "save_settings":
      return (await saveWebSettings(args?.settings as any)) as T;
    case "get_common_config_snippet":
      return (await getWebCommonConfigSnippet(args?.appType as string)) as T;
    case "set_common_config_snippet":
      return (await setWebCommonConfigSnippet(
        args?.appType as string,
        (args?.snippet as string | undefined) ?? "",
      )) as T;
    case "extract_common_config_snippet":
      return (await extractWebCommonConfigSnippet(
        args?.appType as string,
        args?.settingsConfig as string | undefined,
      )) as T;
    case "sync_current_providers_live":
      return (await syncWebCurrentProvidersLive()) as T;
    case "webdav_test_connection":
      return (await testWebdavConnection(
        args?.settings as any,
        (args?.preserveEmptyPassword as boolean | undefined) ?? true,
      )) as T;
    case "webdav_sync_upload":
      return (await uploadWebdavSync()) as T;
    case "webdav_sync_download":
      return (await downloadWebdavSync()) as T;
    case "webdav_sync_save_settings":
      return (await saveWebdavSyncSettings(
        args?.settings as any,
        (args?.passwordTouched as boolean | undefined) ?? false,
      )) as T;
    case "webdav_sync_fetch_remote_info":
      return (await fetchWebdavRemoteInfo()) as T;
    case "export_config_download":
      return (await downloadWebConfigExport(args?.defaultName as string)) as T;
    case "import_config_upload":
      return (await importWebConfigUpload(args?.file as File)) as T;
    case "get_rectifier_config":
      return (await getWebRectifierConfig()) as T;
    case "set_rectifier_config":
      return (await setWebRectifierConfig(args?.config as any)) as T;
    case "get_optimizer_config":
      return (await getWebOptimizerConfig()) as T;
    case "set_optimizer_config":
      return (await setWebOptimizerConfig(args?.config as any)) as T;
    case "get_log_config":
      return (await getWebLogConfig()) as T;
    case "set_log_config":
      return (await setWebLogConfig(args?.config as any)) as T;
    case "get_stream_check_config":
      return (await getWebStreamCheckConfig()) as T;
    case "save_stream_check_config":
      return (await setWebStreamCheckConfig(args?.config as any)) as T;
    case "read_omo_local_file":
      return (await getWebOmoLocalFile()) as T;
    case "get_current_omo_provider_id":
      return (await getWebCurrentOmoProviderId()) as T;
    case "disable_current_omo":
      return (await disableWebCurrentOmo()) as T;
    case "read_omo_slim_local_file":
      return (await getWebOmoSlimLocalFile()) as T;
    case "get_current_omo_slim_provider_id":
      return (await getWebCurrentOmoSlimProviderId()) as T;
    case "disable_current_omo_slim":
      return (await disableWebCurrentOmoSlim()) as T;
    case "stream_check_provider":
      return (await streamCheckWebProvider(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "stream_check_all_providers":
      return (await streamCheckAllWebProviders(
        args?.appType as AppId,
        Boolean(args?.proxyTargetsOnly),
      )) as T;
    case "queryProviderUsage":
      return (await getWebProviderUsage(
        args?.app as AppId,
        args?.providerId as string,
      )) as T;
    case "fetch_models_for_config":
      return (await fetchWebProviderModels(
        args?.baseUrl as string,
        args?.apiKey as string,
        args?.isFullUrl as boolean | undefined,
        args?.modelsUrl as string | undefined,
      )) as T;
    case "get_windows_env_paths":
      return (await fetchWebWindowsEnvPaths()) as T;
    case "testUsageScript":
      return (await testWebUsageScript(
        args?.app as AppId,
        args?.providerId as string,
        {
          scriptCode: args?.scriptCode as string,
          timeout: args?.timeout as number | undefined,
          apiKey: args?.apiKey as string | undefined,
          baseUrl: args?.baseUrl as string | undefined,
          accessToken: args?.accessToken as string | undefined,
          userId: args?.userId as string | undefined,
          templateType: args?.templateType as string | undefined,
        },
      )) as T;
    case "read_live_provider_settings":
      return (await getWebLiveProviderSettings(args?.app as AppId)) as T;
    case "test_api_endpoints":
      return (await testWebApiEndpoints(
        (args?.urls as string[]) ?? [],
        args?.timeoutSecs as number | undefined,
      )) as T;
    case "get_custom_endpoints":
      return (await getWebCustomEndpoints(
        args?.app as AppId,
        args?.providerId as string,
      )) as T;
    case "add_custom_endpoint":
      return (await addWebCustomEndpoint(
        args?.app as AppId,
        args?.providerId as string,
        args?.url as string,
      )) as T;
    case "remove_custom_endpoint":
      return (await removeWebCustomEndpoint(
        args?.app as AppId,
        args?.providerId as string,
        args?.url as string,
      )) as T;
    case "update_endpoint_last_used":
      return (await updateWebEndpointLastUsed(
        args?.app as AppId,
        args?.providerId as string,
        args?.url as string,
      )) as T;
    case "create_db_backup":
      return (await createWebDbBackup()) as T;
    case "list_db_backups":
      return (await listWebDbBackups()) as T;
    case "restore_db_backup":
      return (await restoreWebDbBackup(args?.filename as string)) as T;
    case "rename_db_backup":
      return (await renameWebDbBackup(
        args?.oldFilename as string,
        args?.newName as string,
      )) as T;
    case "delete_db_backup":
      return (await deleteWebDbBackup(args?.filename as string)) as T;
    case "get_providers": {
      const appId = args?.app as AppId | undefined;
      if (!appId) {
        return {} as T;
      }
      const result = await getWebProviders(appId);
      return result.providers as T;
    }
    case "get_current_provider": {
      const appId = args?.app as AppId | undefined;
      if (!appId) {
        return "" as T;
      }
      const result = await getWebProviders(appId);
      return result.currentProviderId as T;
    }
    case "add_provider":
      return (await addWebProvider(
        args?.app as AppId,
        args?.provider as any,
        args?.addToLive as boolean | undefined,
      )) as T;
    case "update_provider":
      return (await updateWebProvider(
        args?.app as AppId,
        args?.provider as any,
        args?.originalId as string | undefined,
      )) as T;
    case "delete_provider":
      return (await deleteWebProvider(
        args?.app as AppId,
        args?.id as string,
      )) as T;
    case "update_providers_sort_order":
      return (await updateWebProvidersSortOrder(
        args?.app as AppId,
        (args?.updates as any[]) ?? [],
      )) as T;
    case "switch_provider":
      return (await switchWebProvider(
        args?.app as AppId,
        args?.id as string,
      )) as T;
    case "open_provider_terminal":
      return (await openWebProviderTerminal(
        args?.app as AppId,
        args?.providerId as string,
        args?.cwd as string | undefined,
      )) as T;
    case "get_universal_providers":
      return (await getWebUniversalProviders()) as T;
    case "get_universal_provider":
      return (await getWebUniversalProvider(args?.id as string)) as T;
    case "upsert_universal_provider":
      return (await upsertWebUniversalProvider(args?.provider as any)) as T;
    case "delete_universal_provider":
      return (await deleteWebUniversalProvider(args?.id as string)) as T;
    case "sync_universal_provider":
      return (await syncWebUniversalProvider(args?.id as string)) as T;
    case "get_opencode_live_provider_ids":
      return (await getWebLiveProviderIds("opencode")) as T;
    case "get_openclaw_live_provider_ids":
      return (await getWebLiveProviderIds("openclaw")) as T;
    case "import_opencode_providers_from_live":
      return (await importWebProvidersFromLive("opencode")) as T;
    case "import_openclaw_providers_from_live":
      return (await importWebProvidersFromLive("openclaw")) as T;
    case "import_default_config":
      return (await importWebDefaultProviderConfig(args?.app as AppId)) as T;
    case "remove_provider_from_live_config":
      return (await removeWebProviderFromLiveConfig(
        args?.app as AppId,
        args?.id as string,
      )) as T;
    case "get_openclaw_default_model":
      return (await getWebOpenClawDefaultModel()) as T;
    case "set_openclaw_default_model":
      return (await setWebOpenClawDefaultModel(args?.model as any)) as T;
    case "get_openclaw_model_catalog":
      return (await getWebOpenClawModelCatalog()) as T;
    case "set_openclaw_model_catalog":
      return (await setWebOpenClawModelCatalog(args?.catalog as any)) as T;
    case "get_openclaw_agents_defaults":
      return (await getWebOpenClawAgentsDefaults()) as T;
    case "set_openclaw_agents_defaults":
      return (await setWebOpenClawAgentsDefaults(args?.defaults as any)) as T;
    case "get_openclaw_env":
      return (await getWebOpenClawEnv()) as T;
    case "set_openclaw_env":
      return (await setWebOpenClawEnv(args?.env as any)) as T;
    case "get_openclaw_tools":
      return (await getWebOpenClawTools()) as T;
    case "set_openclaw_tools":
      return (await setWebOpenClawTools(args?.tools as any)) as T;
    case "scan_openclaw_config_health":
      return (await getWebOpenClawHealth()) as T;
    case "get_openclaw_live_provider":
      return (await getWebOpenClawLiveProvider(
        args?.providerId as string,
      )) as T;
    case "scan_hermes_config_health":
      return (await getWebHermesHealth()) as T;
    case "get_hermes_live_provider_ids":
      return (await getWebHermesLiveProviderIds()) as T;
    case "get_hermes_model_config":
      return (await getWebHermesModelConfig()) as T;
    case "get_hermes_web_ui_url":
      return (await getWebHermesWebUiUrl(
        args?.path as string | null | undefined,
      )) as T;
    case "launch_hermes_dashboard":
      return (await launchWebHermesDashboard()) as T;
    case "get_hermes_memory":
      return (await getWebHermesMemory(args?.kind as any)) as T;
    case "set_hermes_memory":
      return (await setWebHermesMemory(
        args?.kind as any,
        args?.content as string,
      )) as T;
    case "get_hermes_memory_limits":
      return (await getWebHermesMemoryLimits()) as T;
    case "set_hermes_memory_enabled":
      return (await setWebHermesMemoryEnabled(
        args?.kind as any,
        Boolean(args?.enabled),
      )) as T;
    case "get_tool_versions":
      return (await getWebToolVersions(
        args?.tools as string[] | undefined,
        args?.wslShellByTool as
          | Record<
              string,
              { wslShell?: string | null; wslShellFlag?: string | null }
            >
          | undefined,
      )) as T;
    case "get_latest_release_info":
      return (await getWebLatestReleaseInfo(
        args?.currentVersion as string | undefined,
      )) as T;
    case "set_auto_launch":
      return (await setWebAutoLaunch(Boolean(args?.enabled))) as T;
    case "get_auto_launch_status":
      return (await getWebAutoLaunchStatus()) as T;
    case "apply_claude_plugin_config":
      return (await applyWebClaudePluginConfig(Boolean(args?.official))) as T;
    case "apply_claude_onboarding_skip":
      return (await applyWebClaudeOnboardingSkip()) as T;
    case "clear_claude_onboarding_skip":
      return (await clearWebClaudeOnboardingSkip()) as T;
    case "auth_start_login":
      return (await startWebManagedAuthLogin(
        args?.authProvider as string,
      )) as T;
    case "auth_poll_for_account":
      return (await pollWebManagedAuthAccount(
        args?.authProvider as string,
        args?.deviceCode as string,
      )) as T;
    case "auth_list_accounts":
      return (await listWebManagedAuthAccounts(
        args?.authProvider as string,
      )) as T;
    case "auth_get_status":
      return (await getWebManagedAuthStatus(args?.authProvider as string)) as T;
    case "auth_remove_account":
      return (await removeWebManagedAuthAccount(
        args?.authProvider as string,
        args?.accountId as string,
      )) as T;
    case "auth_set_default_account":
      return (await setWebManagedAuthDefaultAccount(
        args?.authProvider as string,
        args?.accountId as string,
      )) as T;
    case "auth_logout":
      return (await logoutWebManagedAuth(args?.authProvider as string)) as T;
    case "copilot_get_token":
      return (await getWebCopilotToken()) as T;
    case "copilot_get_token_for_account":
      return (await getWebCopilotTokenForAccount(
        args?.accountId as string,
      )) as T;
    case "copilot_get_models":
      return (await getWebCopilotModels()) as T;
    case "copilot_get_models_for_account":
      return (await getWebCopilotModelsForAccount(
        args?.accountId as string,
      )) as T;
    case "copilot_get_usage":
      return (await getWebCopilotUsage()) as T;
    case "copilot_get_usage_for_account":
      return (await getWebCopilotUsageForAccount(
        args?.accountId as string,
      )) as T;
    case "get_subscription_quota":
      return (await getWebSubscriptionQuota(args?.tool as string)) as T;
    case "get_codex_oauth_quota":
      return (await getWebCodexOauthQuota(
        (args?.accountId as string | null | undefined) ?? null,
      )) as T;
    case "get_coding_plan_quota":
      return (await getWebCodingPlanQuota(
        args?.baseUrl as string,
        args?.apiKey as string,
      )) as T;
    case "get_balance":
      return (await getWebBalance(
        args?.baseUrl as string,
        args?.apiKey as string,
      )) as T;
    case "check_env_conflicts":
      return (await getWebEnvConflicts(args?.app as string)) as T;
    case "delete_env_vars":
      return (await deleteWebEnvVars(
        (args?.conflicts as import("@/types/env").EnvConflict[]) ?? [],
      )) as T;
    case "restore_env_backup":
      return (await restoreWebEnvBackup(args?.backupPath as string)) as T;
    case "get_mcp_servers":
      return (await getWebMcpServers()) as T;
    case "upsert_mcp_server":
      return (await upsertWebMcpServer(args?.server as any)) as T;
    case "delete_mcp_server":
      return (await deleteWebMcpServer(args?.id as string)) as T;
    case "toggle_mcp_app":
      return (await toggleWebMcpApp(
        args?.serverId as string,
        args?.app as AppId,
        Boolean(args?.enabled),
      )) as T;
    case "import_mcp_from_apps":
      return (await importWebMcpFromApps()) as T;
    case "get_prompts":
      return (await getWebPrompts(args?.app as AppId)) as T;
    case "upsert_prompt":
      return (await upsertWebPrompt(
        args?.app as AppId,
        args?.id as string,
        args?.prompt as any,
      )) as T;
    case "delete_prompt":
      return (await deleteWebPrompt(
        args?.app as AppId,
        args?.id as string,
      )) as T;
    case "enable_prompt":
      return (await enableWebPrompt(
        args?.app as AppId,
        args?.id as string,
      )) as T;
    case "import_prompt_from_file":
      return (await importWebPromptFromFile(args?.app as AppId)) as T;
    case "get_current_prompt_file_content":
      return (await getWebCurrentPromptFileContent(args?.app as AppId)) as T;
    case "get_installed_skills":
      return (await getWebInstalledSkills()) as T;
    case "get_skill_backups":
      return (await getWebSkillBackups()) as T;
    case "discover_available_skills":
      return (await discoverWebAvailableSkills()) as T;
    case "check_skill_updates":
      return (await checkWebSkillUpdates()) as T;
    case "install_skill_unified":
      return (await installWebSkillUnified(
        args?.skill as any,
        args?.currentApp as AppId,
      )) as T;
    case "update_skill":
      return (await updateWebSkill(args?.id as string)) as T;
    case "migrate_skill_storage":
      return (await migrateWebSkillStorage(args?.target as any)) as T;
    case "search_skills_sh":
      return (await searchWebSkillsSh(
        args?.query as string,
        args?.limit as number,
        args?.offset as number,
      )) as T;
    case "restore_skill_backup":
      return (await restoreWebSkillBackup(
        args?.backupId as string,
        args?.currentApp as AppId,
      )) as T;
    case "scan_unmanaged_skills":
      return (await getWebUnmanagedSkills()) as T;
    case "import_skills_from_apps":
      return (await importWebSkillsFromApps(args?.imports as any[])) as T;
    case "get_skill_repos":
      return (await getWebSkillRepos()) as T;
    case "add_skill_repo":
      return (await addWebSkillRepo(args?.repo as any)) as T;
    case "remove_skill_repo":
      return (await removeWebSkillRepo(
        args?.owner as string,
        args?.name as string,
      )) as T;
    case "delete_skill_backup":
      return (await deleteWebSkillBackup(args?.backupId as string)) as T;
    case "install_skills_from_archives":
      return (await installWebSkillArchives(
        (args?.files as File[]) ?? [],
        args?.currentApp as AppId,
      )) as T;
    case "uninstall_skill_unified":
      return (await uninstallWebSkillUnified(args?.id as string)) as T;
    case "toggle_skill_app":
      return (await toggleWebSkillApp(
        args?.id as string,
        args?.app as AppId,
        Boolean(args?.enabled),
      )) as T;
    case "read_workspace_file":
      return (await getWebWorkspaceFile(args?.filename as string)) as T;
    case "write_workspace_file":
      return (await saveWebWorkspaceFile(
        args?.filename as string,
        args?.content as string,
      )) as T;
    case "list_daily_memory_files":
      return (await listWebDailyMemoryFiles()) as T;
    case "read_daily_memory_file":
      return (await getWebDailyMemoryFile(args?.filename as string)) as T;
    case "write_daily_memory_file":
      return (await saveWebDailyMemoryFile(
        args?.filename as string,
        args?.content as string,
      )) as T;
    case "delete_daily_memory_file":
      return (await deleteWebDailyMemoryFile(args?.filename as string)) as T;
    case "search_daily_memory_files":
      return (await searchWebDailyMemoryFiles(args?.query as string)) as T;
    case "get_workspace_directory_path":
      return (await getWebWorkspaceDirectoryPath(
        args?.subdir as "workspace" | "memory",
      )) as T;
    case "list_sessions":
      return (await getWebSessions()) as T;
    case "get_session_messages":
      return (await getWebSessionMessages(
        args?.providerId as string,
        args?.sourcePath as string,
      )) as T;
    case "launch_session_terminal":
      return (await launchWebSessionTerminal({
        command: args?.command as string,
        cwd: args?.cwd as string | null | undefined,
        customConfig: args?.customConfig as string | null | undefined,
      })) as T;
    case "delete_session":
      return (await deleteWebSession({
        providerId: args?.providerId as string,
        sessionId: args?.sessionId as string,
        sourcePath: args?.sourcePath as string,
      })) as T;
    case "delete_sessions":
      return (await deleteWebSessions(
        (args?.items as {
          providerId: string;
          sessionId: string;
          sourcePath: string;
        }[]) ?? [],
      )) as T;
    case "get_usage_summary":
      return (await getWebUsageSummary(
        args?.startDate as number | undefined,
        args?.endDate as number | undefined,
        args?.appType as string | undefined,
      )) as T;
    case "get_usage_trends":
      return (await getWebUsageTrends(
        args?.startDate as number | undefined,
        args?.endDate as number | undefined,
        args?.appType as string | undefined,
      )) as T;
    case "get_provider_stats":
      return (await getWebProviderStats(
        args?.startDate as number | undefined,
        args?.endDate as number | undefined,
        args?.appType as string | undefined,
      )) as T;
    case "get_model_stats":
      return (await getWebModelStats(
        args?.startDate as number | undefined,
        args?.endDate as number | undefined,
        args?.appType as string | undefined,
      )) as T;
    case "get_request_logs":
      return (await getWebRequestLogs(
        args?.filters as any,
        (args?.page as number | undefined) ?? 0,
        (args?.pageSize as number | undefined) ?? 20,
      )) as T;
    case "get_request_detail":
      return (await getWebRequestDetail(args?.requestId as string)) as T;
    case "get_model_pricing":
      return (await getWebModelPricing()) as T;
    case "update_model_pricing":
      return (await updateWebModelPricing(
        args?.modelId as string,
        args?.displayName as string,
        args?.inputCost as string,
        args?.outputCost as string,
        args?.cacheReadCost as string,
        args?.cacheCreationCost as string,
      )) as T;
    case "delete_model_pricing":
      return (await deleteWebModelPricing(args?.modelId as string)) as T;
    case "check_provider_limits":
      return (await getWebProviderLimits(
        args?.providerId as string,
        args?.appType as string,
      )) as T;
    case "sync_session_usage":
      return (await syncWebSessionUsage()) as T;
    case "get_usage_data_sources":
      return (await getWebUsageDataSources()) as T;
    case "start_proxy_server":
      return (await startWebProxyServer()) as T;
    case "stop_proxy_with_restore":
      return (await stopWebProxyWithRestore()) as T;
    case "get_proxy_status":
      return (await getWebProxyStatus()) as T;
    case "get_proxy_takeover_status":
      return (await getWebProxyTakeoverStatus()) as T;
    case "get_claude_desktop_status":
      return (await getWebClaudeDesktopStatus()) as T;
    case "get_claude_desktop_default_routes":
      return (await getWebClaudeDesktopDefaultRoutes()) as T;
    case "set_proxy_takeover_for_app":
      return (await setWebProxyTakeoverForApp(
        args?.appType as AppId,
        Boolean(args?.enabled),
      )) as T;
    case "get_proxy_config":
      return (await getWebProxyConfig()) as T;
    case "update_proxy_config":
      return (await updateWebProxyConfig(args?.config as any)) as T;
    case "get_global_proxy_url":
      return (await getWebGlobalProxyUrl()) as T;
    case "set_global_proxy_url":
      return (await setWebGlobalProxyUrl(
        (args?.url as string | undefined) ?? "",
      )) as T;
    case "test_proxy_url":
      return (await testWebProxyUrl(
        (args?.url as string | undefined) ?? "",
      )) as T;
    case "get_upstream_proxy_status":
      return (await getWebUpstreamProxyStatus()) as T;
    case "scan_local_proxies":
      return (await scanWebLocalProxies()) as T;
    case "get_global_proxy_config":
      return (await getWebGlobalProxyConfig()) as T;
    case "update_global_proxy_config":
      return (await updateWebGlobalProxyConfig(args?.config as any)) as T;
    case "get_proxy_config_for_app": {
      const appType = args?.appType as AppId | undefined;
      return (
        appType
          ? await getWebProxyConfigForApp(appType)
          : getDefaultAppProxyConfig()
      ) as T;
    }
    case "update_proxy_config_for_app":
      return (await updateWebProxyConfigForApp(args?.config as any)) as T;
    case "get_default_cost_multiplier":
      return (await getWebDefaultCostMultiplier(args?.appType as AppId)) as T;
    case "set_default_cost_multiplier":
      return (await setWebDefaultCostMultiplier(
        args?.appType as AppId,
        args?.value as string,
      )) as T;
    case "get_pricing_model_source":
      return (await getWebPricingModelSource(args?.appType as AppId)) as T;
    case "set_pricing_model_source":
      return (await setWebPricingModelSource(
        args?.appType as AppId,
        args?.value as string,
      )) as T;
    case "is_proxy_running":
      return (await getWebIsProxyRunning()) as T;
    case "is_live_takeover_active":
      return (await getWebIsLiveTakeoverActive()) as T;
    case "switch_proxy_provider":
      return (await switchWebProxyProvider(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "get_provider_health":
      return (await getWebProviderHealth(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "reset_circuit_breaker":
      return (await resetWebCircuitBreaker(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "get_circuit_breaker_config":
      return (await getWebCircuitBreakerConfig()) as T;
    case "update_circuit_breaker_config":
      return (await updateWebCircuitBreakerConfig(args?.config as any)) as T;
    case "get_failover_queue":
      return (await getWebFailoverQueue(args?.appType as AppId)) as T;
    case "get_available_providers_for_failover":
      return (await getWebAvailableProvidersForFailover(
        args?.appType as AppId,
      )) as T;
    case "add_to_failover_queue":
      return (await addWebProviderToFailoverQueue(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "remove_from_failover_queue":
      return (await removeWebProviderFromFailoverQueue(
        args?.appType as AppId,
        args?.providerId as string,
      )) as T;
    case "get_auto_failover_enabled":
      return (await getWebAutoFailoverEnabled(args?.appType as AppId)) as T;
    case "set_auto_failover_enabled":
      return (await setWebAutoFailoverEnabled(
        args?.appType as AppId,
        Boolean(args?.enabled),
      )) as T;
    case "get_app_config_dir_override":
      return (await getWebAppConfigDirOverride()) as T;
    case "get_app_config_dir":
      return (await getWebAppConfigDir()) as T;
    case "get_default_app_config_dir":
      return (await getWebDefaultAppConfigDir()) as T;
    case "set_app_config_dir_override":
      return (await setWebAppConfigDirOverride(
        (args?.path as string | null | undefined) ?? null,
      )) as T;
    case "get_config_dir":
      return (await getWebConfigDir(args?.app as AppId)) as T;
    case "get_default_config_dir":
      return (await getWebDefaultConfigDir(args?.app as AppId)) as T;
    case "open_external": {
      const url = typeof args?.url === "string" ? args.url : undefined;
      if (typeof window !== "undefined" && url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return undefined as T;
    }
    default:
      throw webUnsupportedError(command);
  }
}
