import { http, HttpResponse } from "msw";
import type { AppId } from "@/lib/api/types";
import type { Provider, Settings } from "@/types";
import {
  addProvider,
  deleteProvider,
  deleteSession,
  getCurrentProviderId,
  getSessionMessages,
  getProviders,
  listProviders,
  listSessions,
  resetProviderState,
  setCurrentProviderId,
  updateProvider,
  updateSortOrder,
  getSettings,
  setSettings,
  getAppConfigDirOverride,
  getResolvedAppConfigDir,
  setAppConfigDirOverrideState,
} from "./state";

const RUNTIME_ENDPOINT = "http://runtime.local";

const withJson = async <T>(request: Request): Promise<T> => {
  try {
    const body = await request.text();
    if (!body) return {} as T;
    return JSON.parse(body) as T;
  } catch {
    return {} as T;
  }
};

const success = <T>(payload: T) => HttpResponse.json(payload as any);

export const handlers = [
  http.post(`${RUNTIME_ENDPOINT}/get_providers`, async ({ request }) => {
    const { app } = await withJson<{ app: AppId }>(request);
    return success(getProviders(app));
  }),

  http.post(`${RUNTIME_ENDPOINT}/get_current_provider`, async ({ request }) => {
    const { app } = await withJson<{ app: AppId }>(request);
    return success(getCurrentProviderId(app));
  }),

  http.post(
    `${RUNTIME_ENDPOINT}/update_providers_sort_order`,
    async ({ request }) => {
      const { updates = [], app } = await withJson<{
        updates: { id: string; sortIndex: number }[];
        app: AppId;
      }>(request);
      updateSortOrder(app, updates);
      return success(true);
    },
  ),

  http.post(`${RUNTIME_ENDPOINT}/switch_provider`, async ({ request }) => {
    const { id, app } = await withJson<{ id: string; app: AppId }>(request);
    const providers = listProviders(app);
    if (!providers[id]) {
      return HttpResponse.json(false, { status: 404 });
    }
    setCurrentProviderId(app, id);
    return success(true);
  }),

  http.post(`${RUNTIME_ENDPOINT}/add_provider`, async ({ request }) => {
    const { provider, app } = await withJson<{
      provider: Provider & { id?: string };
      app: AppId;
    }>(request);

    const newId = provider.id ?? `mock-${Date.now()}`;
    addProvider(app, { ...provider, id: newId });
    return success(true);
  }),

  http.post(`${RUNTIME_ENDPOINT}/update_provider`, async ({ request }) => {
    const { provider, app } = await withJson<{
      provider: Provider;
      app: AppId;
    }>(request);
    updateProvider(app, provider);
    return success(true);
  }),

  http.post(`${RUNTIME_ENDPOINT}/delete_provider`, async ({ request }) => {
    const { id, app } = await withJson<{ id: string; app: AppId }>(request);
    deleteProvider(app, id);
    return success(true);
  }),

  http.post(`${RUNTIME_ENDPOINT}/import_default_config`, async () => {
    resetProviderState();
    return success(true);
  }),

  http.post(`${RUNTIME_ENDPOINT}/open_external`, () => success(true)),

  http.post(`${RUNTIME_ENDPOINT}/list_sessions`, () => success(listSessions())),

  http.post(`${RUNTIME_ENDPOINT}/list_profiles`, () =>
    success({
      profiles: [],
      currentIds: {
        claude: null,
        claudeDesktop: null,
        codex: null,
      },
    }),
  ),

  http.post(`${RUNTIME_ENDPOINT}/check_env_conflicts`, () => success([])),

  http.post(`${RUNTIME_ENDPOINT}/get_installed_skills`, () => success([])),

  http.post(`${RUNTIME_ENDPOINT}/get_session_messages`, async ({ request }) => {
    const { providerId, sourcePath } = await withJson<{
      providerId: string;
      sourcePath: string;
    }>(request);
    return success(getSessionMessages(providerId, sourcePath));
  }),

  http.post(`${RUNTIME_ENDPOINT}/delete_session`, async ({ request }) => {
    const { providerId, sessionId, sourcePath } = await withJson<{
      providerId: string;
      sessionId: string;
      sourcePath: string;
    }>(request);
    return success(deleteSession(providerId, sessionId, sourcePath));
  }),

  http.post(`${RUNTIME_ENDPOINT}/delete_sessions`, async ({ request }) => {
    const { items = [] } = await withJson<{
      items?: {
        providerId: string;
        sessionId: string;
        sourcePath: string;
      }[];
    }>(request);

    return success(
      items.map((item) => ({
        providerId: item.providerId,
        sessionId: item.sessionId,
        sourcePath: item.sourcePath,
        success: deleteSession(
          item.providerId,
          item.sessionId,
          item.sourcePath,
        ),
      })),
    );
  }),

  http.post(`${RUNTIME_ENDPOINT}/get_settings`, () => success(getSettings())),

  http.post(`${RUNTIME_ENDPOINT}/save_settings`, async ({ request }) => {
    const { settings } = await withJson<{ settings: Settings }>(request);
    setSettings(settings);
    return success(true);
  }),

  http.post(
    `${RUNTIME_ENDPOINT}/set_app_config_dir_override`,
    async ({ request }) => {
      const { path } = await withJson<{ path: string | null }>(request);
      setAppConfigDirOverrideState(path ?? null);
      return success(true);
    },
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_app_config_dir_override`, () =>
    success(getAppConfigDirOverride()),
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_app_config_dir`, () =>
    success(getResolvedAppConfigDir()),
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_default_app_config_dir`, () =>
    success("/default/app"),
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_config_dir`, async ({ request }) => {
    const { app } = await withJson<{ app: AppId }>(request);
    if (app === "claude") return success("/default/claude");
    if (app === "codex") return success("/default/codex");
    if (app === "gemini") return success("/default/gemini");
    return success("/default/opencode");
  }),

  http.post(`${RUNTIME_ENDPOINT}/get_default_config_dir`, async ({ request }) => {
    const { app } = await withJson<{ app: AppId }>(request);
    if (app === "claude") return success("/default/claude");
    if (app === "codex") return success("/default/codex");
    if (app === "gemini") return success("/default/gemini");
    return success("/default/opencode");
  }),

  // Sync current providers live (no-op success)
  http.post(`${RUNTIME_ENDPOINT}/sync_current_providers_live`, () =>
    success({ success: true }),
  ),

  // Proxy status (for SettingsPage / ProxyPanel hooks)
  http.post(`${RUNTIME_ENDPOINT}/get_proxy_status`, () =>
    success({
      running: false,
      address: "127.0.0.1",
      port: 0,
      active_connections: 0,
      total_requests: 0,
      success_requests: 0,
      failed_requests: 0,
      success_rate: 0,
      uptime_seconds: 0,
      current_provider: null,
      current_provider_id: null,
      last_request_at: null,
      last_error: null,
      failover_count: 0,
      active_targets: [],
    }),
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_proxy_takeover_status`, () =>
    success({
      claude: false,
      codex: false,
      gemini: false,
    }),
  ),

  http.post(`${RUNTIME_ENDPOINT}/is_live_takeover_active`, () => success(false)),

  // Failover / circuit breaker defaults
  http.post(`${RUNTIME_ENDPOINT}/get_failover_queue`, () => success([])),
  http.post(`${RUNTIME_ENDPOINT}/get_available_providers_for_failover`, () =>
    success([]),
  ),
  http.post(`${RUNTIME_ENDPOINT}/add_to_failover_queue`, () => success(true)),
  http.post(`${RUNTIME_ENDPOINT}/remove_from_failover_queue`, () =>
    success(true),
  ),

  http.post(`${RUNTIME_ENDPOINT}/get_circuit_breaker_config`, () =>
    success({
      failureThreshold: 3,
      successThreshold: 2,
      timeoutSeconds: 60,
      errorRateThreshold: 50,
      minRequests: 5,
    }),
  ),
  http.post(`${RUNTIME_ENDPOINT}/update_circuit_breaker_config`, () =>
    success(true),
  ),
  http.post(`${RUNTIME_ENDPOINT}/get_provider_health`, () =>
    success({
      provider_id: "mock-provider",
      app_type: "claude",
      is_healthy: true,
      consecutive_failures: 0,
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }),
  ),
  http.post(`${RUNTIME_ENDPOINT}/reset_circuit_breaker`, () => success(true)),
];
