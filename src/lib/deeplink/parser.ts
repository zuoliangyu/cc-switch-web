import {
  extractCodexBaseUrl,
  extractCodexModelName,
} from "@/utils/providerConfigUtils";
import { decodeBase64Utf8, encodeBase64Utf8 } from "@/lib/utils/base64";
import { parse as parseToml } from "smol-toml";
import type { AppId } from "@/lib/api";
import type { DeepLinkImportRequest, DeepLinkResource } from "./types";

const VALID_APPS = new Set<AppId>([
  "claude",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
]);

const VALID_RESOURCES = new Set<DeepLinkResource>([
  "provider",
  "prompt",
  "mcp",
  "skill",
]);

type DeepLinkConfigFormat = "json" | "toml";

const parseBoolean = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const parseOptionalApp = (
  value: string | null,
  fieldName: string,
): AppId | undefined => {
  if (!value) return undefined;
  if (!VALID_APPS.has(value as AppId)) {
    throw new Error(
      `${fieldName} 必须是 claude、codex、gemini、opencode 或 openclaw，当前为 ${value}`,
    );
  }
  return value as AppId;
};

const ensureHttpUrl = (value: string, fieldName: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error(`${fieldName} 不是合法的 HTTP(S) 地址`);
  }
};

const ensureValidSkillRepoRef = (repo: string, branch: string) => {
  const parts = repo.split("/");
  const [owner, name] = parts;
  const validOwner =
    parts.length === 2 &&
    owner.length > 0 &&
    owner.length <= 39 &&
    /^[A-Za-z0-9-]+$/.test(owner);
  const validName =
    name?.length > 0 &&
    name.length <= 100 &&
    name !== "." &&
    name !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(name);
  const validBranch =
    branch.length <= 255 &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("//") &&
    !branch.includes("@{") &&
    !/[\u0000-\u0020\u007f~^:?*\[\\#%]/.test(branch) &&
    branch.split("/").every(
      (segment) =>
        segment.length > 0 &&
        !segment.startsWith(".") &&
        !segment.endsWith(".") &&
        !segment.endsWith(".lock"),
    );
  if (!validOwner || !validName || !validBranch) {
    throw new Error(`skill 仓库坐标不合法：${repo}@${branch || "main"}`);
  }
};

const inferHomepageFromEndpoint = (endpoint: string): string | undefined => {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.replace(/^api[.-]/, "");
    return `https://${host}`;
  } catch {
    return undefined;
  }
};

const safeDecodeBase64Utf8 = (fieldName: string, value: string): string => {
  try {
    return decodeBase64Utf8(value);
  } catch (error) {
    throw new Error(
      `${fieldName} Base64 解码失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const normalizeConfigFormat = (
  configFormat: string | undefined,
): DeepLinkConfigFormat => {
  const format = configFormat?.trim().toLowerCase() || "json";
  if (format === "json" || format === "toml") {
    return format;
  }
  throw new Error(`Web 端暂不支持 ${format} 格式的 deeplink 配置导入`);
};

const parseConfigObject = (
  content: string,
  format: DeepLinkConfigFormat,
): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = format === "json" ? JSON.parse(content) : parseToml(content);
  } catch (error) {
    throw new Error(
      `deeplink ${format.toUpperCase()} 配置解析失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`deeplink ${format.toUpperCase()} 配置必须是对象`);
  }

  return parsed as Record<string, unknown>;
};

export const parseDeepLinkConfigObject = (
  request: Pick<DeepLinkImportRequest, "config" | "configFormat">,
): Record<string, unknown> | null => {
  if (!request.config) {
    return null;
  }

  const decoded = safeDecodeBase64Utf8("config", request.config);
  const format = normalizeConfigFormat(request.configFormat);
  return parseConfigObject(decoded, format);
};

const mergeClaudeConfig = (
  request: DeepLinkImportRequest,
  config: Record<string, unknown>,
) => {
  const env = (config.env ?? {}) as Record<string, unknown>;
  if (!request.apiKey && typeof env.ANTHROPIC_AUTH_TOKEN === "string") {
    request.apiKey = env.ANTHROPIC_AUTH_TOKEN;
  }
  if (!request.endpoint && typeof env.ANTHROPIC_BASE_URL === "string") {
    request.endpoint = env.ANTHROPIC_BASE_URL;
  }
  if (!request.model && typeof env.ANTHROPIC_MODEL === "string") {
    request.model = env.ANTHROPIC_MODEL;
  }
  if (
    !request.haikuModel &&
    typeof env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "string"
  ) {
    request.haikuModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  }
  if (
    !request.sonnetModel &&
    typeof env.ANTHROPIC_DEFAULT_SONNET_MODEL === "string"
  ) {
    request.sonnetModel = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  }
  if (
    !request.opusModel &&
    typeof env.ANTHROPIC_DEFAULT_OPUS_MODEL === "string"
  ) {
    request.opusModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }
};

const mergeCodexConfig = (
  request: DeepLinkImportRequest,
  config: Record<string, unknown>,
) => {
  const auth = (config.auth ?? {}) as Record<string, unknown>;
  if (!request.apiKey && typeof auth.OPENAI_API_KEY === "string") {
    request.apiKey = auth.OPENAI_API_KEY;
  }
  const configText = typeof config.config === "string" ? config.config : "";
  if (!request.endpoint) {
    request.endpoint = extractCodexBaseUrl(configText);
  }
  if (!request.model) {
    request.model = extractCodexModelName(configText);
  }
};

const mergeGeminiConfig = (
  request: DeepLinkImportRequest,
  config: Record<string, unknown>,
) => {
  if (!request.apiKey && typeof config.GEMINI_API_KEY === "string") {
    request.apiKey = config.GEMINI_API_KEY;
  }
  if (!request.endpoint) {
    if (typeof config.GOOGLE_GEMINI_BASE_URL === "string") {
      request.endpoint = config.GOOGLE_GEMINI_BASE_URL;
    } else if (typeof config.GEMINI_BASE_URL === "string") {
      request.endpoint = config.GEMINI_BASE_URL;
    }
  }
  if (!request.model && typeof config.GEMINI_MODEL === "string") {
    request.model = config.GEMINI_MODEL;
  }
};

const mergeAdditiveConfig = (
  request: DeepLinkImportRequest,
  config: Record<string, unknown>,
) => {
  if (!request.apiKey) {
    if (typeof config.apiKey === "string") {
      request.apiKey = config.apiKey;
    } else if (typeof config.api_key === "string") {
      request.apiKey = config.api_key;
    }
  }
  if (!request.endpoint) {
    if (typeof config.baseUrl === "string") {
      request.endpoint = config.baseUrl;
    } else if (typeof config.base_url === "string") {
      request.endpoint = config.base_url;
    } else {
      const options = config.options as Record<string, unknown> | undefined;
      if (typeof options?.baseURL === "string") {
        request.endpoint = options.baseURL;
      }
    }
  }
};

const mergeProviderConfigFromObject = (
  request: DeepLinkImportRequest,
  config: Record<string, unknown>,
): DeepLinkImportRequest => {
  const merged = { ...request };
  switch (merged.app) {
    case "claude":
      mergeClaudeConfig(merged, config);
      break;
    case "codex":
      mergeCodexConfig(merged, config);
      break;
    case "gemini":
      mergeGeminiConfig(merged, config);
      break;
    case "opencode":
    case "openclaw":
      mergeAdditiveConfig(merged, config);
      break;
    default:
      break;
  }

  if (!merged.homepage && merged.endpoint) {
    merged.homepage = inferHomepageFromEndpoint(merged.endpoint);
  }

  return merged;
};

const fetchRemoteConfigText = async (
  configUrl: string,
  format: DeepLinkConfigFormat,
): Promise<string> => {
  ensureHttpUrl(configUrl, "configUrl");

  let response: Response;
  try {
    response = await fetch(configUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept:
          format === "toml"
            ? "application/toml,text/plain,*/*"
            : "application/json,text/plain,*/*",
      },
    });
  } catch (error) {
    throw new Error(
      `拉取远程配置失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `拉取远程配置失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
    );
  }

  const content = await response.text();
  if (!content.trim()) {
    throw new Error("拉取远程配置失败：返回内容为空");
  }

  return content;
};

export const mergeDeepLinkConfig = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportRequest> => {
  if (
    request.resource !== "provider" ||
    (!request.config && !request.configUrl)
  ) {
    return request;
  }

  const format = normalizeConfigFormat(request.configFormat);
  const configText = request.config
    ? safeDecodeBase64Utf8("config", request.config)
    : await fetchRemoteConfigText(request.configUrl ?? "", format);
  const config = parseConfigObject(configText, format);
  const merged = mergeProviderConfigFromObject(request, config);

  return {
    ...merged,
    config: request.config ?? encodeBase64Utf8(configText),
    configFormat: format,
  };
};

export const parseDeepLinkUrl = (urlString: string): DeepLinkImportRequest => {
  let url: URL;
  try {
    url = new URL(urlString.trim());
  } catch (error) {
    throw new Error(
      `Deep link 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (url.protocol !== "ccswitch:") {
    throw new Error(`协议错误，期望 ccswitch://，实际为 ${url.protocol}`);
  }
  if (url.hostname !== "v1") {
    throw new Error(
      `暂仅支持 ccswitch://v1/import，当前版本为 ${url.hostname || "空"}`,
    );
  }
  if (url.pathname !== "/import") {
    throw new Error(`路径错误，期望 /import，实际为 ${url.pathname}`);
  }

  const resourceRaw = url.searchParams.get("resource");
  if (!resourceRaw || !VALID_RESOURCES.has(resourceRaw as DeepLinkResource)) {
    throw new Error("resource 必须是 provider、prompt、mcp 或 skill");
  }

  const usageAutoIntervalRaw = url.searchParams.get("usageAutoInterval");
  const request: DeepLinkImportRequest = {
    version: url.hostname,
    resource: resourceRaw as DeepLinkResource,
    app: parseOptionalApp(url.searchParams.get("app"), "app"),
    name: url.searchParams.get("name") ?? undefined,
    enabled: parseBoolean(url.searchParams.get("enabled")),
    homepage: url.searchParams.get("homepage") ?? undefined,
    endpoint: url.searchParams.get("endpoint") ?? undefined,
    apiKey: url.searchParams.get("apiKey") ?? undefined,
    icon: url.searchParams.get("icon")?.trim().toLowerCase() || undefined,
    model: url.searchParams.get("model") ?? undefined,
    notes: url.searchParams.get("notes") ?? undefined,
    haikuModel: url.searchParams.get("haikuModel") ?? undefined,
    sonnetModel: url.searchParams.get("sonnetModel") ?? undefined,
    opusModel: url.searchParams.get("opusModel") ?? undefined,
    content: url.searchParams.get("content") ?? undefined,
    description: url.searchParams.get("description") ?? undefined,
    apps: url.searchParams.get("apps") ?? undefined,
    repo: url.searchParams.get("repo") ?? undefined,
    directory: url.searchParams.get("directory") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
    config: url.searchParams.get("config") ?? undefined,
    configFormat: url.searchParams.get("configFormat") ?? undefined,
    configUrl: url.searchParams.get("configUrl") ?? undefined,
    usageEnabled: parseBoolean(url.searchParams.get("usageEnabled")),
    usageScript: url.searchParams.get("usageScript") ?? undefined,
    usageApiKey: url.searchParams.get("usageApiKey") ?? undefined,
    usageBaseUrl: url.searchParams.get("usageBaseUrl") ?? undefined,
    usageAccessToken: url.searchParams.get("usageAccessToken") ?? undefined,
    usageUserId: url.searchParams.get("usageUserId") ?? undefined,
    usageAutoInterval:
      usageAutoIntervalRaw !== null &&
      !Number.isNaN(Number(usageAutoIntervalRaw))
        ? Number(usageAutoIntervalRaw)
        : undefined,
  };

  switch (request.resource) {
    case "provider":
      if (!request.app) throw new Error("provider deeplink 缺少 app 参数");
      if (!request.name) throw new Error("provider deeplink 缺少 name 参数");
      if (request.homepage) ensureHttpUrl(request.homepage, "homepage");
      if (request.endpoint) {
        request.endpoint
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item, index) => ensureHttpUrl(item, `endpoint[${index}]`));
      }
      break;
    case "prompt":
      if (!request.app) throw new Error("prompt deeplink 缺少 app 参数");
      if (!request.name) throw new Error("prompt deeplink 缺少 name 参数");
      if (!request.content)
        throw new Error("prompt deeplink 缺少 content 参数");
      break;
    case "mcp":
      if (!request.apps) throw new Error("mcp deeplink 缺少 apps 参数");
      if (!request.config) throw new Error("mcp deeplink 缺少 config 参数");
      request.apps
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((app) => {
          if (!VALID_APPS.has(app as AppId)) {
            throw new Error(`mcp deeplink apps 中包含无效应用：${app}`);
          }
        });
      break;
    case "skill":
      if (!request.repo) throw new Error("skill deeplink 缺少 repo 参数");
      ensureValidSkillRepoRef(request.repo, request.branch || "main");
      request.app = "claude";
      break;
  }

  return request;
};

export const extractDeepLinkFromLocation = (
  locationValue: Location,
): string | null => {
  const searchParams = new URLSearchParams(locationValue.search);
  const direct = searchParams.get("deeplink");
  if (direct) {
    return direct;
  }

  const rawSearch = locationValue.search.startsWith("?")
    ? locationValue.search.slice(1)
    : locationValue.search;
  const marker = "deeplink=";
  const markerIndex = rawSearch.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const rawValue = rawSearch.slice(markerIndex + marker.length);
  if (!rawValue) {
    return null;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};
