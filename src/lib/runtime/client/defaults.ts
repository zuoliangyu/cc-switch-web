import type { Settings, VisibleApps } from "@/types";
import type {
  AppProxyConfig,
  GlobalProxyConfig,
  ProxyConfig,
  ProxyStatus,
  ProxyTakeoverStatus,
} from "@/types/proxy";

const visibleApps: VisibleApps = {
  claude: true,
  "claude-desktop": false,
  codex: true,
  gemini: true,
  opencode: true,
  openclaw: true,
  hermes: true,
};

export const getDefaultSettings = (): Settings => ({
  enableLocalProxy: false,
  proxyConfirmed: false,
  usageConfirmed: false,
  streamCheckConfirmed: false,
  enableFailoverToggle: false,
  failoverConfirmed: false,
  firstRunNoticeConfirmed: false,
  autoSyncConfirmed: false,
  commonConfigConfirmed: false,
  enableClaudePluginIntegration: false,
  launchOnStartup: false,
  skipClaudeOnboarding: false,
  language: "zh",
  visibleApps,
});

export const getDefaultProxyStatus = (): ProxyStatus => ({
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
});

export const getDefaultProxyTakeoverStatus = (): ProxyTakeoverStatus => ({
  claude: false,
  "claude-desktop": false,
  codex: false,
  gemini: false,
  opencode: false,
  openclaw: false,
  hermes: false,
});

export const getDefaultProxyConfig = (): ProxyConfig => ({
  listen_address: "127.0.0.1",
  listen_port: 8787,
  max_retries: 3,
  request_timeout: 60,
  enable_logging: false,
  live_takeover_active: false,
  streaming_first_byte_timeout: 30,
  streaming_idle_timeout: 300,
  non_streaming_timeout: 120,
});

export const getDefaultGlobalProxyConfig = (): GlobalProxyConfig => ({
  proxyEnabled: false,
  listenAddress: "127.0.0.1",
  listenPort: 8787,
  enableLogging: false,
});

export const getDefaultAppProxyConfig = (
  appType = "claude",
): AppProxyConfig => ({
  appType,
  enabled: false,
  autoFailoverEnabled: false,
  maxRetries: 3,
  streamingFirstByteTimeout: 30,
  streamingIdleTimeout: 300,
  nonStreamingTimeout: 120,
  circuitFailureThreshold: 5,
  circuitSuccessThreshold: 2,
  circuitTimeoutSeconds: 30,
  circuitErrorRateThreshold: 0.5,
  circuitMinRequests: 10,
});
