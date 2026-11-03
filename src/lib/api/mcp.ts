import { invoke } from "@/lib/runtime/client/core";
import {
  cancelWebMcpConnectivityChecks,
  pollWebMcpConnectivityChecks,
  startWebMcpConnectivityChecks,
} from "@/lib/runtime/client/web";
import type { McpServer, McpServersMap } from "@/types";
import type { AppId } from "./types";

export interface McpAppSyncOutcome {
  app: string;
  ok: boolean;
  error?: string;
}
export interface McpConnectivityResult {
  serverId: string;
  connected: boolean;
}

/** 结果轮询间隔：每个检查最长 30 秒，0.5 秒足够及时又不频繁 */
const CONNECTIVITY_POLL_MS = 500;
const connectivityPollers = new Map<string, ReturnType<typeof setTimeout>>();

export const mcpApi = {
  /**
   * 启动一批连通性检查。Web 没有 IPC 通道，后端暂存结果，这里轮询取回并逐个回调，
   * 批次跑完或被取消后停止轮询。
   */
  async startConnectivityChecks(
    serverIds: string[],
    onResult: (result: McpConnectivityResult) => void,
  ): Promise<string> {
    const batchId = await startWebMcpConnectivityChecks(serverIds);
    const poll = async () => {
      if (!connectivityPollers.has(batchId)) return;
      try {
        const { results, done } = await pollWebMcpConnectivityChecks(batchId);
        if (!connectivityPollers.has(batchId)) return;
        results.forEach(onResult);
        if (done) {
          connectivityPollers.delete(batchId);
          return;
        }
      } catch {
        connectivityPollers.delete(batchId);
        return;
      }
      connectivityPollers.set(batchId, setTimeout(poll, CONNECTIVITY_POLL_MS));
    };
    connectivityPollers.set(batchId, setTimeout(poll, CONNECTIVITY_POLL_MS));
    return batchId;
  },

  async cancelConnectivityChecks(batchId: string): Promise<void> {
    const timer = connectivityPollers.get(batchId);
    if (timer !== undefined) clearTimeout(timer);
    connectivityPollers.delete(batchId);
    await cancelWebMcpConnectivityChecks(batchId);
  },

  async resyncToApps(apps?: AppId[]): Promise<McpAppSyncOutcome[]> {
    return invoke("resync_mcp_to_apps", { apps });
  },
  /**
   * 获取所有 MCP 服务器（统一结构）
   */
  async getAllServers(): Promise<McpServersMap> {
    return await invoke("get_mcp_servers");
  },

  /**
   * 添加或更新 MCP 服务器（统一结构）
   */
  async upsertUnifiedServer(server: McpServer): Promise<void> {
    return await invoke("upsert_mcp_server", { server });
  },

  /**
   * 删除 MCP 服务器
   */
  async deleteUnifiedServer(id: string): Promise<boolean> {
    return await invoke("delete_mcp_server", { id });
  },

  /**
   * 切换 MCP 服务器在指定应用的启用状态
   */
  async toggleApp(
    serverId: string,
    app: AppId,
    enabled: boolean,
  ): Promise<void> {
    return await invoke("toggle_mcp_app", { serverId, app, enabled });
  },

  /**
   * 从所有应用导入 MCP 服务器
   */
  async importFromApps(): Promise<number> {
    return await invoke("import_mcp_from_apps");
  },
};
