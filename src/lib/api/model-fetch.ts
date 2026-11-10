import { invoke } from "@/lib/runtime/client/core";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { parseHeaderOverrideJson } from "@/lib/requestOverrides";

// 矩阵起源 Genesis 的 /v1/models 会混入 embedding / rerank 模型。除 Claude 外
// 的表单不读预设的 modelsUrl，所以在这里按地址补上 ?type=chat。
const GENESIS_ORIGIN = "https://token.moi.matrixorigin.cn";
const GENESIS_CHAT_MODELS_URL = `${GENESIS_ORIGIN}/v1/models?type=chat`;

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

export interface OpenCodeModelRef {
  providerId: string;
  modelId: string;
}

export async function getOpenCodeModels(): Promise<OpenCodeModelRef[]> {
  return invoke("get_opencode_models");
}

/**
 * 把表单里的本地代理 Header 覆盖 JSON 解析成取模型列表时要携带的请求头。
 *
 * 与转发路径共用 parseHeaderOverrideJson 的校验规则；解析失败或覆盖为空时
 * 静默返回 undefined（回退到不带覆盖头取模型），格式错误由表单字段本身提示。
 */
export function modelFetchRequestHeaders(
  headersJson: string,
): Record<string, string> | undefined {
  const { headers, error } = parseHeaderOverrideJson(headersJson);
  if (error || !headers || Object.keys(headers).length === 0) {
    return undefined;
  }
  return headers;
}

export async function fetchModelsForConfig(
  baseUrl: string,
  apiKey: string,
  isFullUrl?: boolean,
  modelsUrlOverride?: string,
  customUserAgent?: string,
  options?: { apiFormat?: string; requestHeaders?: Record<string, string> },
): Promise<FetchedModel[]> {
  let modelsUrl = modelsUrlOverride;
  if (!modelsUrl) {
    try {
      const endpoint = new URL(baseUrl);
      if (
        endpoint.origin === GENESIS_ORIGIN &&
        (endpoint.pathname === "/" ||
          endpoint.pathname === "/v1" ||
          endpoint.pathname === "/v1/")
      ) {
        modelsUrl = GENESIS_CHAT_MODELS_URL;
      }
    } catch {
      // Keep the native fetcher's normal validation for malformed URLs.
    }
  }
  return invoke<FetchedModel[]>("fetch_models_for_config", {
    baseUrl,
    apiKey,
    isFullUrl,
    modelsUrl,
    customUserAgent,
    ...options,
  });
}

export async function fetchXaiOauthModels(
  accountId?: string | null,
): Promise<FetchedModel[]> {
  return invoke("get_xai_oauth_models", { accountId: accountId || null });
}

export function showFetchModelsError(
  err: unknown,
  t: TFunction,
  opts?: { hasApiKey: boolean; hasBaseUrl: boolean },
): void {
  if (opts && !opts.hasBaseUrl && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedConfig"));
    return;
  }
  if (opts && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedApiKey"));
    return;
  }
  if (opts && !opts.hasBaseUrl) {
    toast.error(t("providerForm.fetchModelsNeedEndpoint"));
    return;
  }

  const message = String(err);

  if (message.includes("HTTP 401") || message.includes("HTTP 403")) {
    toast.error(t("providerForm.fetchModelsAuthFailed"));
    return;
  }
  if (message.includes("HTTP 404") || message.includes("HTTP 405")) {
    toast.error(t("providerForm.fetchModelsEndpointNotFound"));
    return;
  }
  if (message.includes("All candidates failed")) {
    toast.error(t("providerForm.fetchModelsEndpointNotFound"));
    return;
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    toast.error(t("providerForm.fetchModelsTimeout"));
    return;
  }
  if (message.includes("Failed to parse")) {
    toast.error(t("providerForm.fetchModelsNotSupported"));
    return;
  }

  toast.error(t("providerForm.fetchModelsFailed"));
}

export async function fetchCodexOauthModels(
  accountId?: string | null,
): Promise<FetchedModel[]> {
  return invoke("get_codex_oauth_models", { accountId: accountId || null });
}

/**
 * Models reported by the Antigravity runtime installed on the server. With an API key it asks agy's
 * API-key mode, which only accepts its built-in Gemini models (by display name).
 */
export async function getAgyModels(options?: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<FetchedModel[]> {
  return invoke("get_agy_models", {
    apiKey: options?.apiKey || null,
    baseUrl: options?.baseUrl || null,
  });
}
