// 配置相关 API
import { invoke } from "@/lib/runtime/client/core";

export type AppType = "claude" | "codex" | "gemini" | "omo" | "omo_slim";

/**
 * 获取通用配置片段（统一接口）
 * @param appType - 应用类型（claude/codex/gemini）
 * @returns 通用配置片段（原始字符串），如果不存在则返回 null
 */
export async function getCommonConfigSnippet(
  appType: AppType,
): Promise<string | null> {
  return invoke<string | null>("get_common_config_snippet", { appType });
}

/**
 * 设置通用配置片段（统一接口）
 * @param appType - 应用类型（claude/codex/gemini）
 * @param snippet - 通用配置片段（原始字符串）
 * @throws 如果格式无效（Claude/Gemini 验证 JSON，Codex 暂不验证）
 */
export async function setCommonConfigSnippet(
  appType: AppType,
  snippet: string,
): Promise<void> {
  return invoke("set_common_config_snippet", { appType, snippet });
}

export async function updateTomlCommonConfigSnippet(
  configToml: string,
  snippetToml: string,
  enabled: boolean,
): Promise<string> {
  return invoke<string>("update_toml_common_config_snippet", {
    configToml,
    snippetToml,
    enabled,
  });
}

/**
 * 提取通用配置片段
 *
 * 默认读取当前激活供应商的配置；若传入 `options.settingsConfig`，则从编辑器当前内容提取。
 * 会自动排除差异化字段（API Key、模型配置、端点等），返回可复用的通用配置片段。
 *
 * @param appType - 应用类型（claude/codex/gemini）
 * @param options - 可选：提取来源
 * @returns 提取的通用配置片段（JSON/TOML 字符串）
 */
export type ExtractCommonConfigSnippetOptions = {
  settingsConfig?: string;
};

export async function extractCommonConfigSnippet(
  appType: Exclude<AppType, "omo">,
  options?: ExtractCommonConfigSnippetOptions,
): Promise<string> {
  const args: Record<string, unknown> = { appType };
  const settingsConfig = options?.settingsConfig;

  if (typeof settingsConfig === "string" && settingsConfig.trim()) {
    args.settingsConfig = settingsConfig;
  }

  return invoke<string>("extract_common_config_snippet", args);
}
