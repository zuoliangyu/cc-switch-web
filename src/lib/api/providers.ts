import { invoke } from "@/lib/runtime/client/core";
import type {
  Provider,
  UniversalProvider,
  UniversalProvidersMap,
} from "@/types";
import type { AppId } from "./types";
import type { RouteSwitchResult } from "@/types/proxy";

export interface ProviderEditorSave {
  base: Record<string, unknown>;
  onConflict: "refuse" | "keepMine" | "keepTheirs";
}
export interface ProviderEditorView {
  settings: Record<string, unknown>;
  inactive: { path: string[]; value: unknown }[];
}

export interface ProviderSortUpdate {
  id: string;
  sortIndex: number;
}

/**
 * Codex 切换让新会话换了组（openai ↔ custom），统一会话历史又关着：
 * 新版 Codex 只能继续当前组的会话，切换前那组从此只读。
 */
export interface CodexHistorySplitHint {
  /** 切换前新会话记的 provider id（"openai" 或 "custom"） */
  previousBucket: string;
  currentBucket: string;
  /** 记在切换前那组、现在只能查看的会话数 */
  lockedThreads: number;
}

export interface SwitchResult {
  warnings: string[];
  /** 这次选的是本地路由的目标时才有 */
  route?: RouteSwitchResult;
  codexHistorySplit?: CodexHistorySplitHint;
}

export interface OpenTerminalOptions {
  cwd?: string;
  /** 只给这一次启动加跳过权限确认的参数 */
  skipPermissions?: boolean;
  /** 接在生成的参数后面的附加参数 */
  extraArgs?: string;
}

export const providersApi = {
  async getCodexEditorView(
    settings: Record<string, unknown>,
    providerId?: string,
    category?: string,
  ): Promise<ProviderEditorView> {
    return invoke("get_codex_editor_view", { settings, providerId, category });
  },
  async getGrokEditorView(
    settings: Record<string, unknown>,
    providerId?: string,
    category?: string,
  ): Promise<ProviderEditorView> {
    return invoke("get_grok_editor_view", { settings, providerId, category });
  },
  async getGeminiEditorView(
    settings: Record<string, unknown>,
    providerId?: string,
    category?: string,
  ): Promise<ProviderEditorView> {
    return invoke("get_gemini_editor_view", { settings, providerId, category });
  },
  async getClaudeEditorView(
    settings: Record<string, unknown>,
  ): Promise<ProviderEditorView> {
    return invoke("get_claude_editor_view", { settings });
  },
  async getAll(appId: AppId): Promise<Record<string, Provider>> {
    return await invoke("get_providers", { app: appId });
  },

  async getCurrent(appId: AppId): Promise<string> {
    return await invoke("get_current_provider", { app: appId });
  },

  async add(
    provider: Provider,
    appId: AppId,
    addToLive?: boolean,
    editorSave?: ProviderEditorSave,
  ): Promise<boolean> {
    if (appId === "codex" && editorSave)
      return invoke("save_codex_editor", {
        provider,
        editor: editorSave,
        add: true,
      });
    if (appId === "grokbuild" && editorSave)
      return invoke("save_grok_editor", {
        provider,
        editor: editorSave,
        add: true,
      });
    if (appId === "gemini" && editorSave)
      return invoke("save_gemini_editor", {
        provider,
        editor: editorSave,
        add: true,
      });
    if (appId === "claude" && editorSave)
      return invoke("save_claude_editor", {
        provider,
        editor: editorSave,
        add: true,
      });
    return await invoke("add_provider", { provider, app: appId, addToLive });
  },

  /**
   * 只保存供应商行、不切换（切换式应用）。`add` 在还没有当前供应商时会让新的这家直接生效，
   * 深链接导入时用户关掉了「导入后立即切换」就走这里。
   */
  async addWithoutSwitching(
    provider: Provider,
    appId: AppId,
  ): Promise<boolean> {
    return await invoke("add_provider_without_switching", {
      provider,
      app: appId,
    });
  },

  async update(
    provider: Provider,
    appId: AppId,
    originalId?: string,
    editorSave?: ProviderEditorSave,
  ): Promise<boolean> {
    if (appId === "codex" && editorSave)
      return invoke("save_codex_editor", {
        provider,
        editor: editorSave,
        add: false,
      });
    if (appId === "grokbuild" && editorSave)
      return invoke("save_grok_editor", {
        provider,
        editor: editorSave,
        add: false,
      });
    if (appId === "gemini" && editorSave)
      return invoke("save_gemini_editor", {
        provider,
        editor: editorSave,
        add: false,
      });
    if (appId === "claude" && editorSave)
      return invoke("save_claude_editor", {
        provider,
        editor: editorSave,
        add: false,
      });
    return await invoke("update_provider", {
      provider,
      app: appId,
      originalId,
    });
  },

  async delete(id: string, appId: AppId): Promise<boolean> {
    return await invoke("delete_provider", { id, app: appId });
  },

  /** Kimi「添加」：把卡片写进 config.toml，但不改默认模型（「切换」才改） */
  async addToLiveConfig(id: string, appId: AppId): Promise<boolean> {
    return await invoke("add_provider_to_live_config", { id, app: appId });
  },

  /**
   * Remove provider from live config only (for additive mode apps like OpenCode)
   * Does NOT delete from database - provider remains in the list
   */
  async removeFromLiveConfig(id: string, appId: AppId): Promise<boolean> {
    return await invoke("remove_provider_from_live_config", { id, app: appId });
  },

  async switch(id: string, appId: AppId): Promise<SwitchResult> {
    return await invoke("switch_provider", { id, app: appId });
  },

  async openTerminal(
    providerId: string,
    appId: AppId,
    options?: OpenTerminalOptions,
  ): Promise<boolean> {
    const { cwd, skipPermissions, extraArgs } = options ?? {};
    return await invoke("open_provider_terminal", {
      providerId,
      app: appId,
      cwd,
      skipPermissions,
      extraArgs,
    });
  },

  async importDefault(appId: AppId): Promise<boolean> {
    return await invoke("import_default_config", { app: appId });
  },

  async updateSortOrder(
    updates: ProviderSortUpdate[],
    appId: AppId,
  ): Promise<boolean> {
    return await invoke("update_providers_sort_order", { updates, app: appId });
  },

  /**
   * 从 OpenCode live 配置导入供应商到数据库
   * OpenCode 特有功能：由于累加模式，用户可能已在 opencode.json 中配置供应商
   */
  async importOpenCodeFromLive(): Promise<number> {
    return await invoke("import_opencode_providers_from_live");
  },

  /**
   * 获取 OpenCode live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 opencode.json
   */
  async getOpenCodeLiveProviderIds(): Promise<string[]> {
    return await invoke("get_opencode_live_provider_ids");
  },

  /** OpenCode 顶层 model（`<provider>/<model>`），没写时为 null */
  async getOpenCodeDefaultModel(): Promise<string | null> {
    return await invoke("get_opencode_default_model");
  },

  async setOpenCodeDefaultModel(model: string): Promise<void> {
    await invoke("set_opencode_default_model", { model });
  },

  /**
   * 获取 OpenClaw live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 openclaw.json
   */
  async getOpenClawLiveProviderIds(): Promise<string[]> {
    return await invoke("get_openclaw_live_provider_ids");
  },

  /**
   * 从 OpenClaw live 配置导入供应商到数据库
   * OpenClaw 特有功能：由于累加模式，用户可能已在 openclaw.json 中配置供应商
   */
  async importOpenClawFromLive(): Promise<number> {
    return await invoke("import_openclaw_providers_from_live");
  },

  async getPiLiveProviderIds(): Promise<string[]> {
    return await invoke("get_pi_live_provider_ids");
  },

  async importPiFromLive(): Promise<number> {
    return await invoke("import_pi_providers_from_live");
  },

  async importOmpFromLive(): Promise<number> {
    return await invoke("import_omp_providers_from_live");
  },

  /**
   * 获取 Hermes live 配置中的供应商 ID 列表
   */
  async getHermesLiveProviderIds(): Promise<string[]> {
    return await invoke("get_hermes_live_provider_ids");
  },
};

// ============================================================================
// 统一供应商（Universal Provider）API
// ============================================================================

export const universalProvidersApi = {
  /**
   * 获取所有统一供应商
   */
  async getAll(): Promise<UniversalProvidersMap> {
    return await invoke("get_universal_providers");
  },

  /**
   * 获取单个统一供应商
   */
  async get(id: string): Promise<UniversalProvider | null> {
    return await invoke("get_universal_provider", { id });
  },

  /**
   * 添加或更新统一供应商
   */
  async upsert(provider: UniversalProvider): Promise<boolean> {
    return await invoke("upsert_universal_provider", { provider });
  },

  /**
   * 删除统一供应商
   */
  async delete(id: string): Promise<boolean> {
    return await invoke("delete_universal_provider", { id });
  },

  /**
   * 手动同步统一供应商到各应用
   */
  async sync(id: string): Promise<boolean> {
    return await invoke("sync_universal_provider", { id });
  },
};
