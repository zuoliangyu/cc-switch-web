import type { Settings } from "@/types";
import type {
  CustomEndpoint,
  Provider,
  UniversalProvider,
  UniversalProvidersMap,
  UsageResult,
} from "@/types";
import type { McpServer, McpServersMap } from "@/types";
import type { RemoteSnapshotInfo, WebDavSyncSettings } from "@/types";
import type {
  HermesHealthWarning,
  HermesModelConfig,
  HermesMemoryKind,
  HermesMemoryLimits,
  OpenClawAgentsDefaults,
  OpenClawDefaultModel,
  OpenClawEnvConfig,
  OpenClawHealthWarning,
  OpenClawModelCatalogEntry,
  OpenClawToolsConfig,
  OpenClawWriteOutcome,
} from "@/types";
import type { SessionMessage, SessionMeta } from "@/types";
import type { AppId } from "@/lib/api";
import type { Prompt } from "@/lib/api";
import type {
  BackupEntry,
  ConfigDownloadResult,
  ConfigTransferResult,
  LogConfig,
  OptimizerConfig,
  RectifierConfig,
} from "@/lib/api/settings";
import type { StreamCheckConfig } from "@/lib/api/model-test";
import type { OmoLocalFileData } from "@/types/omo";
import type {
  DeleteSessionOptions,
  DeleteSessionResult,
  LaunchSessionTerminalOptions,
} from "@/lib/api/sessions";
import type { ProviderSortUpdate } from "@/lib/api/providers";
import type {
  DiscoverableSkill,
  MigrationResult,
  SkillArchiveInstallResult,
  ImportSkillSelection,
  InstalledSkill,
  SkillBackupEntry,
  SkillRepo,
  SkillsShSearchResult,
  SkillUninstallResult,
  SkillUpdateInfo,
  UnmanagedSkill,
} from "@/lib/api/skills";
import type { SwitchResult } from "@/lib/api/providers";
import type {
  AppProxyConfig,
  CircuitBreakerConfig,
  FailoverQueueItem,
  GlobalProxyConfig,
  ProviderHealth,
  ProxyConfig,
  ProxyServerInfo,
  ProxyStatus,
  ProxyTakeoverStatus,
} from "@/types/proxy";
import type {
  DailyMemoryFileInfo,
  DailyMemorySearchResult,
} from "@/lib/api/workspace";
import type {
  DataSourceSummary,
  DailyStats,
  LogFilters,
  ModelPricing,
  ModelStats,
  PaginatedLogs,
  ProviderLimitStatus,
  ProviderStats,
  RequestLog,
  SessionSyncResult,
  UsageSummary,
} from "@/types/usage";
import {
  getDefaultAppProxyConfig,
  getDefaultGlobalProxyConfig,
  getDefaultProxyConfig,
  getDefaultProxyStatus,
  getDefaultProxyTakeoverStatus,
  getDefaultSettings,
} from "./defaults";

interface ProvidersResponse {
  providers: Record<string, Provider>;
  currentProviderId: string;
}

const DEFAULT_WEB_API_BASE = "http://127.0.0.1:8890";

export const getWebApiBase = (): string => {
  const configured = import.meta.env.VITE_LOCAL_API_BASE?.trim();
  return configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : DEFAULT_WEB_API_BASE;
};

const isWebRuntimeDebugEnabled = (): boolean =>
  import.meta.env.DEV ||
  String(import.meta.env.VITE_RUNTIME_DEBUG_REQUESTS || "")
    .trim()
    .toLowerCase() === "1" ||
  String(import.meta.env.VITE_RUNTIME_DEBUG_REQUESTS || "")
    .trim()
    .toLowerCase() === "true";

function sanitizeDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => {
        const lowered = key.toLowerCase();
        if (
          lowered.includes("password") ||
          lowered.includes("token") ||
          lowered.includes("secret") ||
          lowered.includes("apikey") ||
          lowered.includes("api_key") ||
          lowered.includes("authorization")
        ) {
          return [key, "[REDACTED]"];
        }
        return [key, sanitizeDebugValue(item)];
      },
    );
    return Object.fromEntries(entries);
  }

  return value;
}

function formatDebugBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  if (body instanceof FormData) {
    return Array.from(body.entries()).map(([key, value]) => [
      key,
      value instanceof File
        ? {
            fileName: value.name,
            size: value.size,
            type: value.type,
          }
        : value,
    ]);
  }
  return sanitizeDebugValue(body);
}

function logWebRequest(method: string, path: string, body?: unknown) {
  if (!isWebRuntimeDebugEnabled()) return;

  if (body === undefined) {
    console.info(`[runtime:web] --> ${method} ${path}`);
    return;
  }

  console.info(`[runtime:web] --> ${method} ${path}`, formatDebugBody(body));
}

async function logWebResponse(
  method: string,
  path: string,
  response: Response,
): Promise<void> {
  if (!isWebRuntimeDebugEnabled()) return;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.info(`[runtime:web] <-- ${method} ${path} ${response.status}`);
    return;
  }

  try {
    const cloned = response.clone();
    const payload = await cloned.json();
    console.info(
      `[runtime:web] <-- ${method} ${path} ${response.status}`,
      sanitizeDebugValue(payload),
    );
  } catch {
    console.info(`[runtime:web] <-- ${method} ${path} ${response.status}`);
  }
}

async function getErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        detail?: string;
      };
      const detail = payload.error || payload.message || payload.detail;
      if (detail && detail.trim()) {
        return detail;
      }
    } else {
      const text = await response.text();
      if (text.trim()) {
        return text.trim();
      }
    }
  } catch (error) {
    console.warn("[runtime:web] failed to parse error response", error);
  }

  return fallback;
}

async function requestJson<T>(path: string): Promise<T> {
  logWebRequest("GET", path);
  const response = await fetch(`${getWebApiBase()}${path}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const fallback = `HTTP ${response.status} for ${path}`;
    throw new Error(await getErrorMessage(response, fallback));
  }

  await logWebResponse("GET", path, response);
  return (await response.json()) as T;
}

async function requestWithBody<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  logWebRequest(method, path, body);
  const response = await fetch(`${getWebApiBase()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const fallback = `HTTP ${response.status} for ${method} ${path}`;
    throw new Error(await getErrorMessage(response, fallback));
  }

  if (response.status === 204) {
    await logWebResponse(method, path, response);
    return undefined as T;
  }

  await logWebResponse(method, path, response);
  return (await response.json()) as T;
}

async function requestFormData<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  logWebRequest("POST", path, formData);
  const response = await fetch(`${getWebApiBase()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: formData,
  });

  if (!response.ok) {
    const fallback = `HTTP ${response.status} for POST ${path}`;
    throw new Error(await getErrorMessage(response, fallback));
  }

  await logWebResponse("POST", path, response);
  return (await response.json()) as T;
}

function parseDownloadFilename(
  contentDisposition: string | null,
  fallback: string,
): string {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export async function getWebSettings(): Promise<Settings> {
  try {
    return await requestJson<Settings>("/api/settings");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load settings from local service",
      error,
    );
    return getDefaultSettings();
  }
}

export async function getWebProviders(
  appId: AppId,
): Promise<ProvidersResponse> {
  try {
    return await requestJson<ProvidersResponse>(`/api/providers/${appId}`);
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load providers for ${appId} from local service`,
      error,
    );
    return {
      providers: {},
      currentProviderId: "",
    };
  }
}

export async function getWebConfigDir(appId: AppId): Promise<string> {
  return requestJson<string>(`/api/settings/config-dir/${appId}`);
}

export async function getWebDefaultConfigDir(appId: AppId): Promise<string> {
  return requestJson<string>(`/api/settings/default-config-dir/${appId}`);
}

export async function getWebCommonConfigSnippet(
  appType: string,
): Promise<string | null> {
  return requestJson<string | null>(
    `/api/settings/common-config/${encodeURIComponent(appType)}`,
  );
}

export async function setWebCommonConfigSnippet(
  appType: string,
  snippet: string,
): Promise<void> {
  await requestWithBody<void>(
    `/api/settings/common-config/${encodeURIComponent(appType)}`,
    "PUT",
    { snippet },
  );
}

export async function extractWebCommonConfigSnippet(
  appType: string,
  settingsConfig?: string,
): Promise<string> {
  return requestWithBody<string>(
    `/api/settings/common-config/${encodeURIComponent(appType)}/extract`,
    "POST",
    { settingsConfig },
  );
}

export async function syncWebCurrentProvidersLive(): Promise<{
  success?: boolean;
  message?: string;
}> {
  return requestWithBody<{ success?: boolean; message?: string }>(
    "/api/settings/sync-current-providers-live",
    "POST",
  );
}

export async function getWebAppConfigDirOverride(): Promise<string | null> {
  return requestJson<string | null>("/api/settings/app-config-dir-override");
}

export async function getWebAppConfigDir(): Promise<string> {
  return requestJson<string>("/api/settings/app-config-dir");
}

export async function getWebDefaultAppConfigDir(): Promise<string> {
  return requestJson<string>("/api/settings/default-app-config-dir");
}

export async function setWebAppConfigDirOverride(
  path: string | null,
): Promise<boolean> {
  return requestWithBody<boolean>(
    "/api/settings/app-config-dir-override",
    "PUT",
    {
      path,
    },
  );
}

export async function getWebToolVersions(
  tools?: string[],
  wslShellByTool?: Record<
    string,
    { wslShell?: string | null; wslShellFlag?: string | null }
  >,
): Promise<
  Array<{
    name: string;
    version: string | null;
    latest_version: string | null;
    error: string | null;
    env_type: "windows" | "wsl" | "macos" | "linux" | "unknown";
    wsl_distro: string | null;
  }>
> {
  return requestWithBody("/api/settings/tool-versions", "POST", {
    tools,
    wslShellByTool,
  });
}

export async function getWebLatestReleaseInfo(
  currentVersion?: string,
): Promise<import("@/lib/api/settings").LatestReleaseInfo> {
  const params = new URLSearchParams();
  if (currentVersion?.trim()) {
    params.set("currentVersion", currentVersion.trim());
  }
  const query = params.toString();
  return requestJson<import("@/lib/api/settings").LatestReleaseInfo>(
    `/api/settings/latest-release${query ? `?${query}` : ""}`,
  );
}

export async function getWebAutoLaunchStatus(): Promise<boolean> {
  return requestJson<boolean>("/api/settings/auto-launch");
}

export async function setWebAutoLaunch(enabled: boolean): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings/auto-launch", "PUT", {
    enabled,
  });
}

export async function applyWebClaudePluginConfig(
  official: boolean,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings/claude-plugin", "POST", {
    official,
  });
}

export async function applyWebClaudeOnboardingSkip(): Promise<boolean> {
  return requestWithBody<boolean>(
    "/api/settings/claude-onboarding-skip",
    "POST",
  );
}

export async function clearWebClaudeOnboardingSkip(): Promise<boolean> {
  return requestWithBody<boolean>(
    "/api/settings/claude-onboarding-skip",
    "DELETE",
  );
}

export async function getWebOmoLocalFile(): Promise<OmoLocalFileData> {
  return requestJson<OmoLocalFileData>("/api/omo/local-file");
}

export async function getWebCurrentOmoProviderId(): Promise<string> {
  return requestJson<string>("/api/omo/current-provider-id");
}

export async function disableWebCurrentOmo(): Promise<void> {
  await requestWithBody<void>("/api/omo/disable", "POST");
}

export async function getWebOmoSlimLocalFile(): Promise<OmoLocalFileData> {
  return requestJson<OmoLocalFileData>("/api/omo-slim/local-file");
}

export async function getWebCurrentOmoSlimProviderId(): Promise<string> {
  return requestJson<string>("/api/omo-slim/current-provider-id");
}

export async function disableWebCurrentOmoSlim(): Promise<void> {
  await requestWithBody<void>("/api/omo-slim/disable", "POST");
}

export async function startWebManagedAuthLogin(
  authProvider: string,
): Promise<import("@/lib/api/auth").ManagedAuthDeviceCodeResponse> {
  return requestWithBody("/api/auth/start-login", "POST", { authProvider });
}

export async function pollWebManagedAuthAccount(
  authProvider: string,
  deviceCode: string,
): Promise<import("@/lib/api/auth").ManagedAuthAccount | null> {
  return requestWithBody("/api/auth/poll-for-account", "POST", {
    authProvider,
    deviceCode,
  });
}

export async function listWebManagedAuthAccounts(
  authProvider: string,
): Promise<import("@/lib/api/auth").ManagedAuthAccount[]> {
  return requestJson(`/api/auth/${encodeURIComponent(authProvider)}/accounts`);
}

export async function getWebManagedAuthStatus(
  authProvider: string,
): Promise<import("@/lib/api/auth").ManagedAuthStatus> {
  return requestJson(`/api/auth/${encodeURIComponent(authProvider)}/status`);
}

export async function removeWebManagedAuthAccount(
  authProvider: string,
  accountId: string,
): Promise<void> {
  await requestWithBody("/api/auth/remove-account", "POST", {
    authProvider,
    accountId,
  });
}

export async function setWebManagedAuthDefaultAccount(
  authProvider: string,
  accountId: string,
): Promise<void> {
  await requestWithBody("/api/auth/set-default-account", "POST", {
    authProvider,
    accountId,
  });
}

export async function logoutWebManagedAuth(
  authProvider: string,
): Promise<void> {
  await requestWithBody("/api/auth/logout", "POST", { authProvider });
}

export async function getWebCopilotToken(): Promise<string> {
  return requestJson<string>("/api/copilot/token");
}

export async function getWebCopilotTokenForAccount(
  accountId: string,
): Promise<string> {
  return requestJson<string>(
    `/api/copilot/accounts/${encodeURIComponent(accountId)}/token`,
  );
}

export async function getWebCopilotModels(): Promise<
  import("@/lib/api/copilot").CopilotModel[]
> {
  return requestJson<import("@/lib/api/copilot").CopilotModel[]>(
    "/api/copilot/models",
  );
}

export async function getWebCopilotModelsForAccount(
  accountId: string,
): Promise<import("@/lib/api/copilot").CopilotModel[]> {
  return requestJson<import("@/lib/api/copilot").CopilotModel[]>(
    `/api/copilot/accounts/${encodeURIComponent(accountId)}/models`,
  );
}

export async function getWebCopilotUsage(): Promise<
  import("@/lib/api/copilot").CopilotUsageResponse
> {
  return requestJson<import("@/lib/api/copilot").CopilotUsageResponse>(
    "/api/copilot/usage",
  );
}

export async function getWebCopilotUsageForAccount(
  accountId: string,
): Promise<import("@/lib/api/copilot").CopilotUsageResponse> {
  return requestJson<import("@/lib/api/copilot").CopilotUsageResponse>(
    `/api/copilot/accounts/${encodeURIComponent(accountId)}/usage`,
  );
}

export async function getWebSubscriptionQuota(
  tool: string,
): Promise<import("@/types/subscription").SubscriptionQuota> {
  return requestJson<import("@/types/subscription").SubscriptionQuota>(
    `/api/subscription/${encodeURIComponent(tool)}`,
  );
}

export async function getWebCodexOauthQuota(
  accountId: string | null,
): Promise<import("@/types/subscription").SubscriptionQuota> {
  const params = new URLSearchParams();
  if (accountId) {
    params.set("accountId", accountId);
  }
  const query = params.toString();
  return requestJson<import("@/types/subscription").SubscriptionQuota>(
    `/api/subscription/codex-oauth${query ? `?${query}` : ""}`,
  );
}

export async function getWebCodingPlanQuota(
  baseUrl: string,
  apiKey: string,
): Promise<import("@/types/subscription").SubscriptionQuota> {
  return requestWithBody<import("@/types/subscription").SubscriptionQuota>(
    "/api/subscription/coding-plan",
    "POST",
    { baseUrl, apiKey },
  );
}

export async function getWebBalance(
  baseUrl: string,
  apiKey: string,
): Promise<import("@/types").UsageResult> {
  return requestWithBody<import("@/types").UsageResult>(
    "/api/subscription/balance",
    "POST",
    { baseUrl, apiKey },
  );
}

export async function getWebEnvConflicts(
  app: string,
): Promise<import("@/types/env").EnvConflict[]> {
  return requestJson<import("@/types/env").EnvConflict[]>(
    `/api/env/conflicts/${encodeURIComponent(app)}`,
  );
}

export async function deleteWebEnvVars(
  conflicts: import("@/types/env").EnvConflict[],
): Promise<import("@/types/env").BackupInfo> {
  return requestWithBody<import("@/types/env").BackupInfo>(
    "/api/env/delete",
    "POST",
    { conflicts },
  );
}

export async function restoreWebEnvBackup(backupPath: string): Promise<void> {
  return requestWithBody<void>("/api/env/restore", "POST", { backupPath });
}

export async function getWebLiveProviderIds(appId: AppId): Promise<string[]> {
  try {
    return await requestJson<string[]>(
      `/api/providers/${appId}/live-provider-ids`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load live provider ids for ${appId} from local service`,
      error,
    );
    return [];
  }
}

export async function importWebProvidersFromLive(
  appId: AppId,
): Promise<number> {
  return requestWithBody<number>(`/api/providers/${appId}/import-live`, "POST");
}

export async function importWebDefaultProviderConfig(
  appId: AppId,
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/providers/${appId}/import-default`,
    "POST",
  );
}

export async function streamCheckWebProvider(
  appId: AppId,
  providerId: string,
): Promise<import("@/lib/api/model-test").StreamCheckResult> {
  return requestWithBody<import("@/lib/api/model-test").StreamCheckResult>(
    `/api/providers/${appId}/stream-check/${encodeURIComponent(providerId)}`,
    "POST",
  );
}

export async function streamCheckAllWebProviders(
  appId: AppId,
  proxyTargetsOnly: boolean,
): Promise<Array<[string, import("@/lib/api/model-test").StreamCheckResult]>> {
  return requestWithBody<
    Array<[string, import("@/lib/api/model-test").StreamCheckResult]>
  >(`/api/providers/${appId}/stream-check-all`, "POST", {
    proxyTargetsOnly,
  });
}

export async function getWebLiveProviderSettings(
  appId: AppId,
): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(
    `/api/providers/${appId}/live-settings`,
  );
}

export async function getWebProviderUsage(
  appId: AppId,
  providerId: string,
): Promise<UsageResult> {
  return requestJson<UsageResult>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/usage`,
  );
}

export async function fetchWebProviderModels(
  baseUrl: string,
  apiKey: string,
  isFullUrl?: boolean,
  modelsUrl?: string,
): Promise<import("@/lib/api/model-fetch").FetchedModel[]> {
  return requestWithBody<import("@/lib/api/model-fetch").FetchedModel[]>(
    "/api/providers/models/fetch",
    "POST",
    {
      baseUrl,
      apiKey,
      isFullUrl,
      modelsUrl,
    },
  );
}

/// 取后端进程能读到的 Windows 环境变量白名单映射，供前端展开 %USERPROFILE% 类占位符。
export async function fetchWebWindowsEnvPaths(): Promise<
  Record<string, string>
> {
  const path = "/api/settings/windows-env-paths";
  logWebRequest("GET", path, undefined);
  const response = await fetch(`${getWebApiBase()}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const fallback = `HTTP ${response.status} for GET ${path}`;
    throw new Error(await getErrorMessage(response, fallback));
  }
  await logWebResponse("GET", path, response);
  return (await response.json()) as Record<string, string>;
}

export async function testWebUsageScript(
  appId: AppId,
  providerId: string,
  payload: {
    scriptCode: string;
    timeout?: number;
    apiKey?: string;
    baseUrl?: string;
    accessToken?: string;
    userId?: string;
    templateType?: string;
  },
): Promise<UsageResult> {
  return requestWithBody<UsageResult>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/usage/test`,
    "POST",
    payload,
  );
}

export async function testWebApiEndpoints(
  urls: string[],
  timeoutSecs?: number,
): Promise<import("@/lib/api/providerRuntime").EndpointLatencyResult[]> {
  return requestWithBody<
    import("@/lib/api/providerRuntime").EndpointLatencyResult[]
  >("/api/providers/endpoints/test", "POST", {
    urls,
    timeoutSecs,
  });
}

export async function getWebCustomEndpoints(
  appId: AppId,
  providerId: string,
): Promise<CustomEndpoint[]> {
  return requestJson<CustomEndpoint[]>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/custom-endpoints`,
  );
}

export async function addWebCustomEndpoint(
  appId: AppId,
  providerId: string,
  url: string,
): Promise<void> {
  await requestWithBody<void>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/custom-endpoints`,
    "POST",
    { url },
  );
}

export async function removeWebCustomEndpoint(
  appId: AppId,
  providerId: string,
  url: string,
): Promise<void> {
  await requestWithBody<void>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/custom-endpoints`,
    "DELETE",
    { url },
  );
}

export async function updateWebEndpointLastUsed(
  appId: AppId,
  providerId: string,
  url: string,
): Promise<void> {
  await requestWithBody<void>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/custom-endpoints/last-used`,
    "POST",
    { url },
  );
}

export async function getWebUniversalProviders(): Promise<UniversalProvidersMap> {
  return requestJson<UniversalProvidersMap>("/api/universal-providers");
}

export async function getWebUniversalProvider(
  id: string,
): Promise<UniversalProvider | null> {
  return requestJson<UniversalProvider | null>(
    `/api/universal-providers/${encodeURIComponent(id)}`,
  );
}

export async function upsertWebUniversalProvider(
  provider: UniversalProvider,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/universal-providers", "POST", provider);
}

export async function deleteWebUniversalProvider(id: string): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/universal-providers/${encodeURIComponent(id)}`,
    "DELETE",
  );
}

export async function syncWebUniversalProvider(id: string): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/universal-providers/${encodeURIComponent(id)}/sync`,
    "POST",
  );
}

export async function updateWebProvidersSortOrder(
  appId: AppId,
  updates: ProviderSortUpdate[],
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/providers/${appId}/sort-order`,
    "PUT",
    updates,
  );
}

export async function removeWebProviderFromLiveConfig(
  appId: AppId,
  id: string,
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/providers/${appId}/live-config/${encodeURIComponent(id)}`,
    "DELETE",
  );
}

export async function getWebProxyStatus(): Promise<ProxyStatus> {
  try {
    return await requestJson<ProxyStatus>("/api/proxy/status");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load proxy status from local service",
      error,
    );
    return getDefaultProxyStatus();
  }
}

export async function getWebProxyTakeoverStatus(): Promise<ProxyTakeoverStatus> {
  try {
    return await requestJson<ProxyTakeoverStatus>("/api/proxy/takeover-status");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load proxy takeover status from local service",
      error,
    );
    return getDefaultProxyTakeoverStatus();
  }
}

export async function getWebClaudeDesktopStatus(): Promise<
  import("@/types/claudeDesktop").ClaudeDesktopStatus
> {
  const { getDefaultClaudeDesktopStatus } = await import(
    "@/types/claudeDesktop"
  );
  try {
    return await requestJson("/api/claude-desktop/status");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load claude-desktop status from local service",
      error,
    );
    return getDefaultClaudeDesktopStatus();
  }
}

export async function getWebClaudeDesktopDefaultRoutes(): Promise<
  import("@/types/claudeDesktop").ClaudeDesktopDefaultRoute[]
> {
  try {
    return await requestJson("/api/claude-desktop/default-routes");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load claude-desktop default routes",
      error,
    );
    return [];
  }
}

export async function getWebProxyConfig(): Promise<ProxyConfig> {
  try {
    return await requestJson<ProxyConfig>("/api/proxy/config");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load proxy config from local service",
      error,
    );
    return getDefaultProxyConfig();
  }
}

export async function getWebGlobalProxyConfig(): Promise<GlobalProxyConfig> {
  try {
    return await requestJson<GlobalProxyConfig>("/api/proxy/global-config");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load global proxy config from local service",
      error,
    );
    return getDefaultGlobalProxyConfig();
  }
}

export async function getWebGlobalProxyUrl(): Promise<string | null> {
  return requestJson<string | null>("/api/proxy/global-url");
}

export async function setWebGlobalProxyUrl(url: string): Promise<void> {
  return requestWithBody<void>("/api/proxy/global-url", "PUT", { value: url });
}

export async function testWebProxyUrl(
  url: string,
): Promise<import("@/lib/api/globalProxy").ProxyTestResult> {
  return requestWithBody<import("@/lib/api/globalProxy").ProxyTestResult>(
    "/api/proxy/test",
    "POST",
    { value: url },
  );
}

export async function getWebUpstreamProxyStatus(): Promise<
  import("@/lib/api/globalProxy").UpstreamProxyStatus
> {
  return requestJson<import("@/lib/api/globalProxy").UpstreamProxyStatus>(
    "/api/proxy/upstream-status",
  );
}

export async function scanWebLocalProxies(): Promise<
  import("@/lib/api/globalProxy").DetectedProxy[]
> {
  return requestJson<import("@/lib/api/globalProxy").DetectedProxy[]>(
    "/api/proxy/scan-local",
  );
}

export async function getWebProxyConfigForApp(
  appId: AppId,
): Promise<AppProxyConfig> {
  try {
    return await requestJson<AppProxyConfig>(`/api/proxy/apps/${appId}/config`);
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load proxy config for ${appId} from local service`,
      error,
    );
    return getDefaultAppProxyConfig(appId);
  }
}

export async function getWebIsProxyRunning(): Promise<boolean> {
  try {
    return await requestJson<boolean>("/api/proxy/running");
  } catch (error) {
    console.warn("[runtime:web] failed to load proxy running state", error);
    return false;
  }
}

export async function getWebIsLiveTakeoverActive(): Promise<boolean> {
  try {
    return await requestJson<boolean>("/api/proxy/live-takeover-active");
  } catch (error) {
    console.warn("[runtime:web] failed to load live takeover state", error);
    return false;
  }
}

export async function startWebProxyServer(): Promise<ProxyServerInfo> {
  return requestWithBody<ProxyServerInfo>("/api/proxy/start", "POST");
}

export async function stopWebProxyWithRestore(): Promise<void> {
  return requestWithBody<void>("/api/proxy/stop-with-restore", "POST");
}

export async function setWebProxyTakeoverForApp(
  appId: AppId,
  enabled: boolean,
): Promise<void> {
  return requestWithBody<void>(`/api/proxy/apps/${appId}/takeover`, "PUT", {
    enabled,
  });
}

export async function switchWebProxyProvider(
  appId: AppId,
  providerId: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/proxy/apps/${appId}/providers/${providerId}/switch`,
    "POST",
  );
}

export async function updateWebProxyConfig(config: ProxyConfig): Promise<void> {
  return requestWithBody<void>("/api/proxy/config", "PUT", config);
}

export async function updateWebGlobalProxyConfig(
  config: GlobalProxyConfig,
): Promise<void> {
  return requestWithBody<void>("/api/proxy/global-config", "PUT", config);
}

export async function updateWebProxyConfigForApp(
  config: AppProxyConfig,
): Promise<void> {
  return requestWithBody<void>(
    `/api/proxy/apps/${config.appType}/config`,
    "PUT",
    config,
  );
}

export async function getWebDefaultCostMultiplier(
  appId: AppId,
): Promise<string> {
  return requestJson<string>(
    `/api/proxy/apps/${appId}/default-cost-multiplier`,
  );
}

export async function setWebDefaultCostMultiplier(
  appId: AppId,
  value: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/proxy/apps/${appId}/default-cost-multiplier`,
    "PUT",
    { value },
  );
}

export async function getWebPricingModelSource(appId: AppId): Promise<string> {
  return requestJson<string>(`/api/proxy/apps/${appId}/pricing-model-source`);
}

export async function setWebPricingModelSource(
  appId: AppId,
  value: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/proxy/apps/${appId}/pricing-model-source`,
    "PUT",
    { value },
  );
}

export async function getWebProviderHealth(
  appId: AppId,
  providerId: string,
): Promise<ProviderHealth> {
  try {
    return await requestJson<ProviderHealth>(
      `/api/failover/apps/${appId}/providers/${providerId}/health`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load provider health for ${appId}/${providerId}`,
      error,
    );
    return {
      provider_id: providerId,
      app_type: appId,
      is_healthy: true,
      consecutive_failures: 0,
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
  }
}

export async function resetWebCircuitBreaker(
  appId: AppId,
  providerId: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/failover/apps/${appId}/providers/${encodeURIComponent(providerId)}/reset-circuit-breaker`,
    "POST",
  );
}

export async function getWebCircuitBreakerConfig(): Promise<CircuitBreakerConfig> {
  try {
    return await requestJson<CircuitBreakerConfig>(
      "/api/failover/circuit-breaker-config",
    );
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load circuit breaker config from local service",
      error,
    );
    return {
      failureThreshold: 4,
      successThreshold: 2,
      timeoutSeconds: 60,
      errorRateThreshold: 0.6,
      minRequests: 10,
    };
  }
}

export async function updateWebCircuitBreakerConfig(
  config: CircuitBreakerConfig,
): Promise<void> {
  return requestWithBody<void>(
    "/api/failover/circuit-breaker-config",
    "PUT",
    config,
  );
}

export async function getWebFailoverQueue(
  appId: AppId,
): Promise<FailoverQueueItem[]> {
  try {
    return await requestJson<FailoverQueueItem[]>(
      `/api/failover/apps/${appId}/queue`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load failover queue for ${appId} from local service`,
      error,
    );
    return [];
  }
}

export async function getWebAvailableProvidersForFailover(
  appId: AppId,
): Promise<Provider[]> {
  try {
    return await requestJson<Provider[]>(
      `/api/failover/apps/${appId}/available-providers`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load available failover providers for ${appId}`,
      error,
    );
    return [];
  }
}

export async function addWebProviderToFailoverQueue(
  appId: AppId,
  providerId: string,
): Promise<void> {
  return requestWithBody<void>(`/api/failover/apps/${appId}/queue`, "POST", {
    providerId,
  });
}

export async function removeWebProviderFromFailoverQueue(
  appId: AppId,
  providerId: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/failover/apps/${appId}/queue/${providerId}`,
    "DELETE",
  );
}

export async function getWebAutoFailoverEnabled(
  appId: AppId,
): Promise<boolean> {
  try {
    return await requestJson<boolean>(
      `/api/failover/apps/${appId}/auto-enabled`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load auto failover flag for ${appId}`,
      error,
    );
    return false;
  }
}

export async function setWebAutoFailoverEnabled(
  appId: AppId,
  enabled: boolean,
): Promise<void> {
  return requestWithBody<void>(
    `/api/failover/apps/${appId}/auto-enabled`,
    "PUT",
    { enabled },
  );
}

export async function saveWebSettings(settings: Settings): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings", "PUT", settings);
}

export async function testWebdavConnection(
  settings: WebDavSyncSettings,
  preserveEmptyPassword = true,
): Promise<{ success: boolean; message?: string }> {
  return requestWithBody<{ success: boolean; message?: string }>(
    "/api/webdav/test",
    "POST",
    {
      settings,
      preserveEmptyPassword,
    },
  );
}

export async function uploadWebdavSync(): Promise<{
  status: string;
  warning?: string;
}> {
  return requestWithBody<{ status: string; warning?: string }>(
    "/api/webdav/upload",
    "POST",
  );
}

export async function downloadWebdavSync(): Promise<{
  status: string;
  warning?: string;
}> {
  return requestWithBody<{ status: string; warning?: string }>(
    "/api/webdav/download",
    "POST",
  );
}

export async function saveWebdavSyncSettings(
  settings: WebDavSyncSettings,
  passwordTouched = false,
): Promise<{ success: boolean }> {
  return requestWithBody<{ success: boolean }>("/api/webdav/settings", "POST", {
    settings,
    passwordTouched,
  });
}

export async function fetchWebdavRemoteInfo(): Promise<
  RemoteSnapshotInfo | { empty: true }
> {
  return requestJson<RemoteSnapshotInfo | { empty: true }>(
    "/api/webdav/remote-info",
  );
}

export async function downloadWebConfigExport(
  defaultName: string,
): Promise<ConfigDownloadResult> {
  const response = await fetch(
    `${getWebApiBase()}/api/config/export?filename=${encodeURIComponent(defaultName)}`,
    {
      headers: {
        Accept: "application/sql,text/plain,*/*",
      },
    },
  );

  if (!response.ok) {
    const fallback = `HTTP ${response.status} for GET /api/config/export`;
    throw new Error(await getErrorMessage(response, fallback));
  }

  return {
    fileName: parseDownloadFilename(
      response.headers.get("content-disposition"),
      defaultName,
    ),
    blob: await response.blob(),
  };
}

export async function importWebConfigUpload(
  file: File,
): Promise<ConfigTransferResult> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return requestFormData<ConfigTransferResult>("/api/config/import", formData);
}

export async function getWebRectifierConfig(): Promise<RectifierConfig> {
  return requestJson<RectifierConfig>("/api/settings/rectifier");
}

export async function setWebRectifierConfig(
  config: RectifierConfig,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings/rectifier", "PUT", config);
}

export async function getWebOptimizerConfig(): Promise<OptimizerConfig> {
  return requestJson<OptimizerConfig>("/api/settings/optimizer");
}

export async function setWebOptimizerConfig(
  config: OptimizerConfig,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings/optimizer", "PUT", config);
}

export async function getWebLogConfig(): Promise<LogConfig> {
  return requestJson<LogConfig>("/api/settings/log-config");
}

export async function setWebLogConfig(config: LogConfig): Promise<boolean> {
  return requestWithBody<boolean>("/api/settings/log-config", "PUT", config);
}

export async function getWebStreamCheckConfig(): Promise<StreamCheckConfig> {
  return requestJson<StreamCheckConfig>("/api/settings/stream-check-config");
}

export async function setWebStreamCheckConfig(
  config: StreamCheckConfig,
): Promise<void> {
  return requestWithBody<void>(
    "/api/settings/stream-check-config",
    "PUT",
    config,
  );
}

export async function createWebDbBackup(): Promise<string> {
  return requestWithBody<string>("/api/backups/db", "POST");
}

export async function listWebDbBackups(): Promise<BackupEntry[]> {
  return requestJson<BackupEntry[]>("/api/backups/db");
}

export async function restoreWebDbBackup(filename: string): Promise<string> {
  return requestWithBody<string>(
    `/api/backups/db/${encodeURIComponent(filename)}/restore`,
    "POST",
  );
}

export async function renameWebDbBackup(
  oldFilename: string,
  newName: string,
): Promise<string> {
  return requestWithBody<string>("/api/backups/db/rename", "PUT", {
    oldFilename,
    newName,
  });
}

export async function deleteWebDbBackup(filename: string): Promise<void> {
  return requestWithBody<void>(
    `/api/backups/db/${encodeURIComponent(filename)}`,
    "DELETE",
  );
}

export async function addWebProvider(
  appId: AppId,
  provider: Provider,
  addToLive?: boolean,
): Promise<boolean> {
  return requestWithBody<boolean>(`/api/providers/${appId}`, "POST", {
    provider,
    addToLive,
  });
}

export async function updateWebProvider(
  appId: AppId,
  provider: Provider,
  originalId?: string,
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/providers/${appId}/${encodeURIComponent(originalId ?? provider.id)}`,
    "PUT",
    provider,
  );
}

export async function deleteWebProvider(
  appId: AppId,
  id: string,
): Promise<boolean> {
  return requestWithBody<boolean>(`/api/providers/${appId}/${id}`, "DELETE");
}

export async function switchWebProvider(
  appId: AppId,
  id: string,
): Promise<SwitchResult> {
  return requestWithBody<SwitchResult>(
    `/api/providers/${appId}/${id}/switch`,
    "POST",
  );
}

export async function openWebProviderTerminal(
  appId: AppId,
  providerId: string,
  cwd?: string,
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/providers/${appId}/${encodeURIComponent(providerId)}/open-terminal`,
    "POST",
    { cwd },
  );
}

export async function getWebMcpServers(): Promise<McpServersMap> {
  try {
    return await requestJson<McpServersMap>("/api/mcp/servers");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load mcp servers from local service",
      error,
    );
    return {};
  }
}

export async function upsertWebMcpServer(server: McpServer): Promise<void> {
  return requestWithBody<void>("/api/mcp/servers", "POST", server);
}

export async function deleteWebMcpServer(id: string): Promise<boolean> {
  return requestWithBody<boolean>(`/api/mcp/servers/${id}`, "DELETE");
}

export async function toggleWebMcpApp(
  serverId: string,
  appId: AppId,
  enabled: boolean,
): Promise<void> {
  return requestWithBody<void>(
    `/api/mcp/servers/${serverId}/apps/${appId}`,
    "PUT",
    {
      enabled,
    },
  );
}

export async function importWebMcpFromApps(): Promise<number> {
  return requestWithBody<number>("/api/mcp/servers/import", "POST");
}

export async function getWebPrompts(
  appId: AppId,
): Promise<Record<string, Prompt>> {
  try {
    return await requestJson<Record<string, Prompt>>(`/api/prompts/${appId}`);
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load prompts for ${appId} from local service`,
      error,
    );
    return {};
  }
}

export async function upsertWebPrompt(
  appId: AppId,
  id: string,
  prompt: Prompt,
): Promise<void> {
  return requestWithBody<void>(`/api/prompts/${appId}/${id}`, "PUT", prompt);
}

export async function deleteWebPrompt(appId: AppId, id: string): Promise<void> {
  return requestWithBody<void>(`/api/prompts/${appId}/${id}`, "DELETE");
}

export async function enableWebPrompt(appId: AppId, id: string): Promise<void> {
  return requestWithBody<void>(`/api/prompts/${appId}/${id}/enable`, "POST");
}

export async function importWebPromptFromFile(appId: AppId): Promise<string> {
  return requestWithBody<string>(`/api/prompts/${appId}/import`, "POST");
}

export async function getWebCurrentPromptFileContent(
  appId: AppId,
): Promise<string | null> {
  try {
    return await requestJson<string | null>(
      `/api/prompts/${appId}/current-file`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load current prompt file for ${appId} from local service`,
      error,
    );
    return null;
  }
}

export async function getWebInstalledSkills(): Promise<InstalledSkill[]> {
  try {
    return await requestJson<InstalledSkill[]>("/api/skills/installed");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load installed skills from local service",
      error,
    );
    return [];
  }
}

export async function getWebSkillBackups(): Promise<SkillBackupEntry[]> {
  try {
    return await requestJson<SkillBackupEntry[]>("/api/skills/backups");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load skill backups from local service",
      error,
    );
    return [];
  }
}

export async function uninstallWebSkillUnified(
  id: string,
): Promise<SkillUninstallResult> {
  return requestWithBody<SkillUninstallResult>(
    "/api/skills/uninstall",
    "POST",
    {
      id,
    },
  );
}

export async function toggleWebSkillApp(
  id: string,
  app: AppId,
  enabled: boolean,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/skills/apps/toggle", "PUT", {
    id,
    app,
    enabled,
  });
}

export async function getWebUnmanagedSkills(): Promise<UnmanagedSkill[]> {
  try {
    return await requestJson<UnmanagedSkill[]>("/api/skills/unmanaged");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to scan unmanaged skills from local service",
      error,
    );
    return [];
  }
}

export async function importWebSkillsFromApps(
  imports: ImportSkillSelection[],
): Promise<InstalledSkill[]> {
  return requestWithBody<InstalledSkill[]>(
    "/api/skills/import",
    "POST",
    imports,
  );
}

export async function getWebSkillRepos(): Promise<SkillRepo[]> {
  try {
    return await requestJson<SkillRepo[]>("/api/skills/repos");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load skill repos from local service",
      error,
    );
    return [];
  }
}

export async function addWebSkillRepo(repo: SkillRepo): Promise<boolean> {
  return requestWithBody<boolean>("/api/skills/repos", "POST", repo);
}

export async function removeWebSkillRepo(
  owner: string,
  name: string,
): Promise<boolean> {
  return requestWithBody<boolean>(
    `/api/skills/repos/${owner}/${name}`,
    "DELETE",
  );
}

export async function discoverWebAvailableSkills(): Promise<
  DiscoverableSkill[]
> {
  try {
    return await requestJson<DiscoverableSkill[]>("/api/skills/discover");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to discover skills from local service",
      error,
    );
    return [];
  }
}

export async function checkWebSkillUpdates(): Promise<SkillUpdateInfo[]> {
  try {
    return await requestJson<SkillUpdateInfo[]>("/api/skills/updates");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to check skill updates from local service",
      error,
    );
    return [];
  }
}

export async function installWebSkillUnified(
  skill: DiscoverableSkill,
  currentApp: AppId,
): Promise<InstalledSkill> {
  return requestWithBody<InstalledSkill>("/api/skills/install", "POST", {
    skill,
    currentApp,
  });
}

export async function updateWebSkill(id: string): Promise<InstalledSkill> {
  return requestWithBody<InstalledSkill>("/api/skills/update", "POST", { id });
}

export async function migrateWebSkillStorage(
  target: import("@/types").SkillStorageLocation,
): Promise<MigrationResult> {
  return requestWithBody<MigrationResult>(
    "/api/skills/storage/migrate",
    "POST",
    { target },
  );
}

export async function searchWebSkillsSh(
  query: string,
  limit: number,
  offset: number,
): Promise<SkillsShSearchResult> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    offset: String(offset),
  });
  return requestJson<SkillsShSearchResult>(
    `/api/skills/skillssh/search?${params.toString()}`,
  );
}

export async function deleteWebSkillBackup(backupId: string): Promise<boolean> {
  return requestWithBody<boolean>(`/api/skills/backups/${backupId}`, "DELETE");
}

export async function restoreWebSkillBackup(
  backupId: string,
  currentApp: AppId,
): Promise<InstalledSkill> {
  return requestWithBody<InstalledSkill>(
    `/api/skills/backups/${backupId}`,
    "POST",
    {
      currentApp,
    },
  );
}

export async function installWebSkillArchives(
  files: File[],
  currentApp: AppId,
): Promise<SkillArchiveInstallResult[]> {
  const formData = new FormData();
  formData.append("currentApp", currentApp);
  files.forEach((file) => {
    formData.append("archives", file, file.name);
  });
  return requestFormData<SkillArchiveInstallResult[]>(
    "/api/skills/install-archives",
    formData,
  );
}

export async function getWebWorkspaceFile(
  filename: string,
): Promise<string | null> {
  return requestJson<string | null>(
    `/api/workspace/files/${encodeURIComponent(filename)}`,
  );
}

export async function saveWebWorkspaceFile(
  filename: string,
  content: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/workspace/files/${encodeURIComponent(filename)}`,
    "PUT",
    { content },
  );
}

export async function listWebDailyMemoryFiles(): Promise<
  DailyMemoryFileInfo[]
> {
  return requestJson<DailyMemoryFileInfo[]>("/api/workspace/daily-memory");
}

export async function getWebDailyMemoryFile(
  filename: string,
): Promise<string | null> {
  return requestJson<string | null>(
    `/api/workspace/daily-memory/${encodeURIComponent(filename)}`,
  );
}

export async function saveWebDailyMemoryFile(
  filename: string,
  content: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/workspace/daily-memory/${encodeURIComponent(filename)}`,
    "PUT",
    { content },
  );
}

export async function deleteWebDailyMemoryFile(
  filename: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/workspace/daily-memory/${encodeURIComponent(filename)}`,
    "DELETE",
  );
}

export async function searchWebDailyMemoryFiles(
  query: string,
): Promise<DailyMemorySearchResult[]> {
  return requestJson<DailyMemorySearchResult[]>(
    `/api/workspace/daily-memory/search?query=${encodeURIComponent(query)}`,
  );
}

export async function getWebWorkspaceDirectoryPath(
  subdir: "workspace" | "memory",
): Promise<string> {
  return requestJson<string>(
    `/api/workspace/directories/${encodeURIComponent(subdir)}/path`,
  );
}

export async function getWebOpenClawDefaultModel(): Promise<OpenClawDefaultModel | null> {
  try {
    return await requestJson<OpenClawDefaultModel | null>(
      "/api/openclaw/default-model",
    );
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw default model from local service",
      error,
    );
    return null;
  }
}

export async function setWebOpenClawDefaultModel(
  model: OpenClawDefaultModel,
): Promise<OpenClawWriteOutcome> {
  return requestWithBody<OpenClawWriteOutcome>(
    "/api/openclaw/default-model",
    "PUT",
    model,
  );
}

export async function getWebOpenClawModelCatalog(): Promise<Record<
  string,
  OpenClawModelCatalogEntry
> | null> {
  try {
    return await requestJson<Record<string, OpenClawModelCatalogEntry> | null>(
      "/api/openclaw/model-catalog",
    );
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw model catalog from local service",
      error,
    );
    return null;
  }
}

export async function setWebOpenClawModelCatalog(
  catalog: Record<string, OpenClawModelCatalogEntry>,
): Promise<OpenClawWriteOutcome> {
  return requestWithBody<OpenClawWriteOutcome>(
    "/api/openclaw/model-catalog",
    "PUT",
    catalog,
  );
}

export async function getWebOpenClawAgentsDefaults(): Promise<OpenClawAgentsDefaults | null> {
  try {
    return await requestJson<OpenClawAgentsDefaults | null>(
      "/api/openclaw/agents-defaults",
    );
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw agents defaults from local service",
      error,
    );
    return null;
  }
}

export async function setWebOpenClawAgentsDefaults(
  defaults: OpenClawAgentsDefaults,
): Promise<OpenClawWriteOutcome> {
  return requestWithBody<OpenClawWriteOutcome>(
    "/api/openclaw/agents-defaults",
    "PUT",
    defaults,
  );
}

export async function getWebOpenClawEnv(): Promise<OpenClawEnvConfig> {
  try {
    return await requestJson<OpenClawEnvConfig>("/api/openclaw/env");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw env config from local service",
      error,
    );
    return {};
  }
}

export async function setWebOpenClawEnv(
  env: OpenClawEnvConfig,
): Promise<OpenClawWriteOutcome> {
  return requestWithBody<OpenClawWriteOutcome>("/api/openclaw/env", "PUT", env);
}

export async function getWebOpenClawTools(): Promise<OpenClawToolsConfig> {
  try {
    return await requestJson<OpenClawToolsConfig>("/api/openclaw/tools");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw tools config from local service",
      error,
    );
    return {};
  }
}

export async function setWebOpenClawTools(
  tools: OpenClawToolsConfig,
): Promise<OpenClawWriteOutcome> {
  return requestWithBody<OpenClawWriteOutcome>(
    "/api/openclaw/tools",
    "PUT",
    tools,
  );
}

export async function getWebOpenClawHealth(): Promise<OpenClawHealthWarning[]> {
  try {
    return await requestJson<OpenClawHealthWarning[]>("/api/openclaw/health");
  } catch (error) {
    console.warn(
      "[runtime:web] failed to load openclaw health warnings from local service",
      error,
    );
    return [];
  }
}

export async function getWebOpenClawLiveProvider(
  providerId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await requestJson<Record<string, unknown> | null>(
      `/api/openclaw/live-provider/${encodeURIComponent(providerId)}`,
    );
  } catch (error) {
    console.warn(
      `[runtime:web] failed to load openclaw live provider ${providerId} from local service`,
      error,
    );
    return null;
  }
}

export async function getWebHermesMemory(
  kind: HermesMemoryKind,
): Promise<string> {
  return requestJson<string>(`/api/hermes/memory/${encodeURIComponent(kind)}`);
}

export async function getWebHermesHealth(): Promise<HermesHealthWarning[]> {
  return requestJson<HermesHealthWarning[]>("/api/hermes/health");
}

export async function getWebHermesModelConfig(): Promise<HermesModelConfig | null> {
  return requestJson<HermesModelConfig | null>("/api/hermes/model");
}

export async function getWebHermesLiveProviderIds(): Promise<string[]> {
  return requestJson<string[]>("/api/hermes/live-provider-ids");
}

export async function getWebHermesWebUiUrl(
  path?: string | null,
): Promise<string> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return requestJson<string>(`/api/hermes/web-ui-url${query}`);
}

export async function launchWebHermesDashboard(): Promise<void> {
  return requestWithBody<void>("/api/hermes/dashboard", "POST");
}

export async function setWebHermesMemory(
  kind: HermesMemoryKind,
  content: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/hermes/memory/${encodeURIComponent(kind)}`,
    "PUT",
    { content },
  );
}

export async function getWebHermesMemoryLimits(): Promise<HermesMemoryLimits> {
  return requestJson<HermesMemoryLimits>("/api/hermes/memory-limits");
}

export async function setWebHermesMemoryEnabled(
  kind: HermesMemoryKind,
  enabled: boolean,
): Promise<void> {
  return requestWithBody<void>(
    `/api/hermes/memory/${encodeURIComponent(kind)}/enabled`,
    "PUT",
    { enabled },
  );
}

export async function getWebSessions(): Promise<SessionMeta[]> {
  return requestJson<SessionMeta[]>("/api/sessions");
}

export async function getWebSessionMessages(
  providerId: string,
  sourcePath: string,
): Promise<SessionMessage[]> {
  return requestJson<SessionMessage[]>(
    `/api/sessions/messages?providerId=${encodeURIComponent(providerId)}&sourcePath=${encodeURIComponent(sourcePath)}`,
  );
}

export async function launchWebSessionTerminal(
  options: LaunchSessionTerminalOptions,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/sessions/launch-terminal", "POST", {
    command: options.command,
    cwd: options.cwd ?? undefined,
    customConfig: options.customConfig ?? undefined,
  });
}

export async function deleteWebSession(
  options: DeleteSessionOptions,
): Promise<boolean> {
  return requestWithBody<boolean>("/api/sessions", "DELETE", options);
}

export async function deleteWebSessions(
  items: DeleteSessionOptions[],
): Promise<DeleteSessionResult[]> {
  return requestWithBody<DeleteSessionResult[]>(
    "/api/sessions/delete-batch",
    "POST",
    items,
  );
}

export async function getWebUsageSummary(
  startDate?: number,
  endDate?: number,
  appType?: string,
): Promise<UsageSummary> {
  const params = new URLSearchParams();
  if (typeof startDate === "number") params.set("startDate", String(startDate));
  if (typeof endDate === "number") params.set("endDate", String(endDate));
  if (appType) params.set("appType", appType);
  const query = params.toString();
  return requestJson<UsageSummary>(
    `/api/usage/summary${query ? `?${query}` : ""}`,
  );
}

export async function getWebUsageTrends(
  startDate?: number,
  endDate?: number,
  appType?: string,
): Promise<DailyStats[]> {
  const params = new URLSearchParams();
  if (typeof startDate === "number") params.set("startDate", String(startDate));
  if (typeof endDate === "number") params.set("endDate", String(endDate));
  if (appType) params.set("appType", appType);
  const query = params.toString();
  return requestJson<DailyStats[]>(
    `/api/usage/trends${query ? `?${query}` : ""}`,
  );
}

export async function getWebProviderStats(
  startDate?: number,
  endDate?: number,
  appType?: string,
): Promise<ProviderStats[]> {
  const params = new URLSearchParams();
  if (typeof startDate === "number") params.set("startDate", String(startDate));
  if (typeof endDate === "number") params.set("endDate", String(endDate));
  if (appType) params.set("appType", appType);
  const query = params.toString();
  return requestJson<ProviderStats[]>(
    `/api/usage/provider-stats${query ? `?${query}` : ""}`,
  );
}

export async function getWebModelStats(
  startDate?: number,
  endDate?: number,
  appType?: string,
): Promise<ModelStats[]> {
  const params = new URLSearchParams();
  if (typeof startDate === "number") params.set("startDate", String(startDate));
  if (typeof endDate === "number") params.set("endDate", String(endDate));
  if (appType) params.set("appType", appType);
  const query = params.toString();
  return requestJson<ModelStats[]>(
    `/api/usage/model-stats${query ? `?${query}` : ""}`,
  );
}

export async function getWebRequestLogs(
  filters: LogFilters,
  page: number,
  pageSize: number,
): Promise<PaginatedLogs> {
  return requestWithBody<PaginatedLogs>("/api/usage/request-logs", "POST", {
    filters,
    page,
    pageSize,
  });
}

export async function getWebRequestDetail(
  requestId: string,
): Promise<RequestLog | null> {
  return requestJson<RequestLog | null>(
    `/api/usage/request-logs/${encodeURIComponent(requestId)}`,
  );
}

export async function getWebModelPricing(): Promise<ModelPricing[]> {
  return requestJson<ModelPricing[]>("/api/usage/model-pricing");
}

export async function updateWebModelPricing(
  modelId: string,
  displayName: string,
  inputCost: string,
  outputCost: string,
  cacheReadCost: string,
  cacheCreationCost: string,
): Promise<void> {
  return requestWithBody<void>(
    `/api/usage/model-pricing/${encodeURIComponent(modelId)}`,
    "PUT",
    {
      displayName,
      inputCost,
      outputCost,
      cacheReadCost,
      cacheCreationCost,
    },
  );
}

export async function deleteWebModelPricing(modelId: string): Promise<void> {
  return requestWithBody<void>(
    `/api/usage/model-pricing/${encodeURIComponent(modelId)}`,
    "DELETE",
  );
}

export async function getWebProviderLimits(
  providerId: string,
  appType: string,
): Promise<ProviderLimitStatus> {
  return requestJson<ProviderLimitStatus>(
    `/api/usage/provider-limits/${encodeURIComponent(appType)}/${encodeURIComponent(providerId)}`,
  );
}

export async function syncWebSessionUsage(): Promise<SessionSyncResult> {
  return requestWithBody<SessionSyncResult>("/api/usage/session-sync", "POST");
}

export async function getWebUsageDataSources(): Promise<DataSourceSummary[]> {
  return requestJson<DataSourceSummary[]>("/api/usage/data-sources");
}
