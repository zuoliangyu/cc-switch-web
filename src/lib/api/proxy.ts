import type { AppId } from "@/lib/api/types";
import type { AppMode, AppModeView, RouteSwitchResult } from "@/types/proxy";
import { invoke } from "@/lib/runtime/client/core";
import type {
  ProxyStatus,
  ProxyServerInfo,
  ProxyTakeoverStatus,
  GlobalProxyConfig,
  AppProxyConfig,
} from "@/types/proxy";

export const proxyApi = {
  restartCodexDaemon(): Promise<"restarted" | "notRunning"> {
    return invoke("restart_codex_daemon");
  },
  /** Codex 聚合的模型被默认那家自己的模型目录挡住时，改用 CC Switch 的；返回之后还剩的提示。 */
  adoptCodexStackCatalog(): Promise<
    AppModeView["aggregation"]["notice"] | null
  > {
    return invoke("adopt_codex_stack_catalog");
  },
  /** 关掉「Codex 可能还在用旧的」提示（看不到进程时）：记下现在的目录和登录。 */
  acknowledgeCodexStaleClients(): Promise<void> {
    return invoke("acknowledge_codex_stale_clients");
  },
  getAppMode(appType: AppId): Promise<AppModeView> {
    return invoke("get_app_mode", { appType });
  },
  setAppMode(
    appType: AppId,
    mode: AppMode,
    routeProviderId?: string,
  ): Promise<void> {
    return invoke("set_app_mode", { appType, mode, routeProviderId });
  },
  setAggregationMember(
    appType: AppId,
    providerId: string,
    enabled: boolean,
  ): Promise<void> {
    return invoke("set_aggregation_member", { appType, providerId, enabled });
  },
  /** 指定路由目标：已经接上路由时当场生效，否则只记下来，下次进入路由 / 聚合模式时用 */
  setRoute(appType: AppId, providerId: string): Promise<RouteSwitchResult> {
    return invoke("switch_proxy_provider", { appType, providerId });
  },
  restartService(config: GlobalProxyConfig): Promise<void> {
    return invoke("restart_proxy_service", { config });
  },
  // ========== 代理服务器控制 API ==========

  // 启动代理服务器
  async startProxyServer(): Promise<ProxyServerInfo> {
    return invoke("start_proxy_server");
  },

  // 停止代理服务器并恢复配置
  async stopProxyWithRestore(): Promise<void> {
    return invoke("stop_proxy_with_restore");
  },

  // 获取代理服务器状态
  async getProxyStatus(): Promise<ProxyStatus> {
    return invoke("get_proxy_status");
  },

  // ========== 接管状态 API ==========

  // 获取各应用接管状态
  async getProxyTakeoverStatus(): Promise<ProxyTakeoverStatus> {
    return invoke("get_proxy_takeover_status");
  },

  // 为指定应用开启/关闭接管
  async setProxyTakeoverForApp(
    appType: string,
    enabled: boolean,
  ): Promise<void> {
    return invoke("set_proxy_takeover_for_app", { appType, enabled });
  },

  // ========== v3+ 全局/应用级配置 API ==========

  // 获取全局代理配置
  async getGlobalProxyConfig(): Promise<GlobalProxyConfig> {
    return invoke("get_global_proxy_config");
  },

  // 更新全局代理配置
  async updateGlobalProxyConfig(config: GlobalProxyConfig): Promise<void> {
    return invoke("update_global_proxy_config", { config });
  },

  // 获取客户端地址（写给客户端的代理主机，空表示按监听地址推）
  async getProxyClientHost(): Promise<string> {
    return invoke("get_proxy_client_host");
  },

  // 保存客户端地址，并按新地址重写接上路由的客户端
  async setProxyClientHost(host: string): Promise<void> {
    return invoke("set_proxy_client_host", { host });
  },

  // 获取指定应用的代理配置
  async getProxyConfigForApp(appType: string): Promise<AppProxyConfig> {
    return invoke("get_proxy_config_for_app", { appType });
  },

  // 更新指定应用的代理配置
  async updateProxyConfigForApp(config: AppProxyConfig): Promise<void> {
    return invoke("update_proxy_config_for_app", { config });
  },

  // ========== 计费默认配置 API ==========

  // 获取计费模式来源
  async getPricingModelSource(appType: string): Promise<string> {
    return invoke("get_pricing_model_source", { appType });
  },

  // 设置计费模式来源
  async setPricingModelSource(appType: string, value: string): Promise<void> {
    return invoke("set_pricing_model_source", { appType, value });
  },
};
