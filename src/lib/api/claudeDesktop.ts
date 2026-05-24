import { invoke } from "@/lib/runtime/client/core";
import type {
  ClaudeDesktopStatus,
  ClaudeDesktopDefaultRoute,
} from "@/types/claudeDesktop";

export const claudeDesktopApi = {
  /** Claude Desktop 3P 漂移状态 */
  async getStatus(): Promise<ClaudeDesktopStatus> {
    return invoke("get_claude_desktop_status");
  },

  /** Claude Desktop proxy 模式默认模型路由（唯一来源） */
  async getDefaultRoutes(): Promise<ClaudeDesktopDefaultRoute[]> {
    return invoke("get_claude_desktop_default_routes");
  },
};
