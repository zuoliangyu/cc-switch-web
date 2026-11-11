import { streamWebSession, getWebSessionImage, getWebSessionContent } from "@/lib/runtime/client/web";
import type { ContentRef, ImageRef, TranscriptChunk } from "@/types";
import { invoke } from "@/lib/runtime/client/core";
import type {
  SessionContentSearchResult,
  SessionIndexStatus,
  SessionMessage,
  SessionMeta,
} from "@/types";

export interface DeleteSessionOptions {
  providerId: string;
  sessionId: string;
  sourcePath: string;
}

export interface DeleteSessionResult extends DeleteSessionOptions {
  success: boolean;
  error?: string;
}

export interface LaunchSessionTerminalOptions {
  command: string;
  cwd?: string | null;
  customConfig?: string | null;
}

export interface BlockContent { text: string; totalLen: number; truncated: boolean; nextOffset?: number }
export const sessionsApi = {
  streamMessages(providerId: string, sourcePath: string, onChunk: (chunk: TranscriptChunk) => void) { return streamWebSession(providerId, sourcePath, onChunk); },
  getBlockContent(providerId: string, sourcePath: string, contentRef: ContentRef, page: {offset?: number; limit?: number} = {}): Promise<BlockContent> { return getWebSessionContent({ providerId, sourcePath, contentRef, ...page }); },
  getImage(providerId: string, sourcePath: string, image: ImageRef) { return getWebSessionImage({ providerId, sourcePath, image }); },
  async exportMarkdown(defaultName: string, content: string): Promise<string | null> {
    const url = URL.createObjectURL(new Blob([content], {type: "text/markdown;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = defaultName.replace(/[\\/:*?"<>|]/g, "_"); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); return link.download;
  },
  async list(): Promise<SessionMeta[]> {
    return await invoke("list_sessions");
  },

  /** 后台同步正文索引；立即返回当前进度，之后的进度走 session-index-status 推送 */
  async syncContentIndex(): Promise<SessionIndexStatus> {
    return await invoke("sync_session_index");
  },

  /** 在消息正文里搜索（按会话聚合）；providerIds 为空时不按应用过滤 */
  async searchContent(
    query: string,
    providerIds?: string[],
  ): Promise<SessionContentSearchResult> {
    return await invoke("search_session_content", { query, providerIds });
  },

  /** 删除正文索引文件（关闭「搜索消息正文」时） */
  async clearContentIndex(): Promise<boolean> {
    return await invoke("clear_session_index");
  },

  async getMessages(
    providerId: string,
    sourcePath: string,
  ): Promise<SessionMessage[]> {
    return await invoke("get_session_messages", { providerId, sourcePath });
  },

  async delete(options: DeleteSessionOptions): Promise<boolean> {
    const { providerId, sessionId, sourcePath } = options;
    return await invoke("delete_session", {
      providerId,
      sessionId,
      sourcePath,
    });
  },

  async deleteMany(
    items: DeleteSessionOptions[],
  ): Promise<DeleteSessionResult[]> {
    return await invoke("delete_sessions", { items });
  },

  async launchTerminal(
    options: LaunchSessionTerminalOptions,
  ): Promise<boolean> {
    const { command, cwd, customConfig } = options;
    return await invoke("launch_session_terminal", {
      command,
      cwd,
      customConfig,
    });
  },
};

