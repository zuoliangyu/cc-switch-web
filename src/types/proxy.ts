export interface ProxyConfig {
  listen_address: string;
  listen_port: number;
  max_retries: number;
  request_timeout: number;
  enable_logging: boolean;
  live_takeover_active?: boolean;
  // 超时配置
  streaming_first_byte_timeout: number;
  streaming_idle_timeout: number;
  non_streaming_timeout: number;
}

export interface ProxyStatus {
  running: boolean;
  address: string;
  port: number;
  active_connections: number;
  total_requests: number;
  success_requests: number;
  failed_requests: number;
  success_rate: number;
  uptime_seconds: number;
  current_provider: string | null;
  current_provider_id: string | null;
  last_request_at: string | null;
  last_error: string | null;
  failover_count: number;
  active_targets?: ActiveTarget[];
}

export interface ActiveTarget {
  app_type: string;
  provider_name: string;
  provider_id: string;
}

export interface ProxyServerInfo {
  address: string;
  port: number;
  started_at: string;
}

export interface ProxyTakeoverStatus {
  claude: boolean;
  "claude-desktop": boolean;
  codex: boolean;
  gemini: boolean;
  grokbuild: boolean;
  opencode: boolean;
  openclaw: boolean;
  hermes: boolean;
}

export interface ProviderHealth {
  provider_id: string;
  app_type: string;
  is_healthy: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  updated_at: string;
}

// 熔断器相关类型
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutSeconds: number;
  errorRateThreshold: number;
  minRequests: number;
}

export type CircuitState = "closed" | "open" | "half_open";

// 供应商健康状态枚举
export enum ProviderHealthStatus {
  Healthy = "healthy",
  Degraded = "degraded",
  Failed = "failed",
  Unknown = "unknown",
}

// 扩展 ProviderHealth 以包含前端计算的状态
export interface ProviderHealthWithStatus extends ProviderHealth {
  status: ProviderHealthStatus;
  circuitState?: CircuitState;
}

export interface ProxyUsageRecord {
  provider_id: string;
  app_type: string;
  endpoint: string;
  request_tokens: number | null;
  response_tokens: number | null;
  status_code: number;
  latency_ms: number;
  error: string | null;
  timestamp: string;
}

// 故障转移队列条目
export interface FailoverQueueItem {
  providerId: string;
  providerName: string;
  sortIndex?: number;
}

// 全局代理配置（统一字段，三行镜像）
export interface GlobalProxyConfig {
  proxyEnabled: boolean;
  listenAddress: string;
  listenPort: number;
  enableLogging: boolean;
}

// 应用级代理配置（每个 app 独立）
export interface AppProxyConfig {
  appType: string;
  enabled: boolean;
  autoFailoverEnabled: boolean;
  maxRetries: number;
  streamingFirstByteTimeout: number;
  streamingIdleTimeout: number;
  nonStreamingTimeout: number;
  circuitFailureThreshold: number;
  circuitSuccessThreshold: number;
  circuitTimeoutSeconds: number;
  circuitErrorRateThreshold: number;
  circuitMinRequests: number;
}

export type AppModeNoticeReason =
  | "noLogin"
  | "loginStale"
  | "loginIncomplete"
  | "noVersion"
  | "fetchFailed"
  | "invalidList"
  | "noCli"
  | "cliFailed"
  | "nothingUsable";
export type AppMode = "direct" | "routing" | "aggregation";

/**
 * Codex 客户端可能缓存着旧账号或模型列表（只在启动时读）：`daemon` 是 `codex` 命令行连的托管
 * 守护进程，可以一键重启；`others` 是桌面版、编辑器插件，要用户自己彻底退出再开。
 */
export interface CodexStaleClients {
  daemon: boolean;
  others: boolean;
  /** 文件登录在客户端启动之后换过：可能还缓存着之前的账号。 */
  auth?: boolean;
  /**
   * 看不到桌面版、编辑器插件的进程（Windows）：`others` 只表示上次确认之后目录或登录变了，
   * 不知道有没有开着。关掉提示时要告诉后端（`acknowledgeCodexStaleClients`）。
   */
  unverified?: boolean;
}

/** Codex 聚合设置里「子代理模型」下拉的一项：发布的模型和它在合并目录里的推理强度档位。 */
export interface AppModeSubagentModel {
  /** 发布给客户端的模型 id（`ccs-<key>/<model>`），也是写进 `[agents]` 的值。 */
  id: string;
  providerId: string;
  /** `<模型显示名>（<供应商名>）`，和 Codex 模型选择器里一样。 */
  displayName: string;
  efforts: string[];
  defaultEffort?: string;
}

export interface AppModeView {
  startupError?: string | null;
  mode: AppMode;
  attached: boolean;
  directProviderId: string | null;
  routeProviderId: string | null;
  eligibleProviderIds: string[];
  aggregation: {
    active: boolean;
    members: { providerId: string; modelIds: string[]; route: boolean }[];
    /**
     * Codex 聚合模型客户端看不到或看不全：`routeOwnsCatalog` 默认那家使用自己的模型目录文件；
     * 官方做默认时：`officialModelsBundled` 暂用 Codex 自带的列表，`officialModelsUnavailable`
     * 暂不可用，`officialModelsOutdated` 本机 Codex 太旧，拉到的官方列表里没有能选的模型。
     */
    notice?:
      | "routeOwnsCatalog"
      | "officialModelsBundled"
      | "officialModelsUnavailable"
      | "officialModelsOutdated";
    /** 官方模型列表没取到的原因：先是官方列表的，不可用时再跟 Codex 自带列表的。 */
    noticeReasons?: AppModeNoticeReason[];
    /** Codex 客户端可能还在用旧的登录或模型列表（不分模式）。 */
    staleClients?: CodexStaleClients;
    /** `staleClients` 对应的目录和登录：关掉提示后这个值变了就重新显示。 */
    staleRevision?: string;
    /** Codex：聚合设置「子代理模型」的选项，按名单顺序。 */
    subagentModels?: AppModeSubagentModel[];
  };
}
