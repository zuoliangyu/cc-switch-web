import type { AppId } from "@/lib/api";

export type DeepLinkResource = "provider" | "prompt" | "mcp" | "skill";

/** 链接声明的接口格式，按应用换算成各自的字段（见 linkRules.ts） */
export type DeepLinkApiFormat =
  | "anthropic"
  | "openai_chat"
  | "openai_responses"
  | "gemini_native";

export interface DeepLinkImportRequest {
  version: string;
  resource: DeepLinkResource;
  app?: AppId;
  name?: string;
  /**
   * 导入后是否立即生效：供应商（切换式应用）切过去、累加式应用写进配置文件、提示词启用。
   * 确认框里有对应开关，链接里的值只是开关的初始值，导入时以开关为准。
   */
  enabled?: boolean;
  homepage?: string;
  endpoint?: string;
  apiKey?: string;
  icon?: string;
  model?: string;
  notes?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  /** 供应商的接口格式；没写时用各应用的默认格式 */
  apiFormat?: DeepLinkApiFormat;
  content?: string;
  description?: string;
  apps?: string;
  repo?: string;
  directory?: string;
  branch?: string;
  config?: string;
  configFormat?: string;
  configUrl?: string;
  usageEnabled?: boolean;
  usageScript?: string;
  usageApiKey?: string;
  usageBaseUrl?: string;
  usageAccessToken?: string;
  usageUserId?: string;
  usageAutoInterval?: number;
}

export interface McpImportError {
  id: string;
  error: string;
}

export interface McpImportSummary {
  importedCount: number;
  importedIds: string[];
  failed: McpImportError[];
}

export type DeepLinkImportResult =
  | { type: "provider"; id: string }
  | { type: "prompt"; id: string }
  | ({ type: "mcp" } & McpImportSummary)
  | { type: "skill"; key: string };
