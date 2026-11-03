import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";
import { decodeBase64Utf8 } from "@/lib/utils/base64";
import { parse as parseToml } from "smol-toml";
import type { AppId } from "@/lib/api";
import type {
  DeepLinkApiFormat,
  DeepLinkImportRequest,
  DeepLinkResource,
} from "./types";
import {
  MCP_LINK_APPS,
  PROMPT_LINK_APPS,
  PROVIDER_LINK_APPS,
  checkApiFormat,
  checkLinkValues,
} from "./linkRules";
import {
  codexLinkConfigText,
  grokLinkConfigText,
  parseCodexLinkConfig,
  parseGrokLinkProfile,
} from "./tomlLink";

const VALID_RESOURCES = new Set<DeepLinkResource>([
  "provider",
  "prompt",
  "mcp",
  "skill",
]);

type DeepLinkConfigFormat = "json" | "toml";

/** 只给了 env_key：Key 在本机环境变量里，不能从不可信的链接导入 */
const ENV_KEY_ONLY_ERROR =
  "这条链接只通过 env_key 间接提供 API Key，不能从不可信的链接导入；请手动添加供应商并自行填写 Key";

const parseBoolean = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const ensureLinkApp = (
  value: string | undefined,
  allowed: readonly AppId[],
  fieldName: string,
): AppId => {
  if (!value || !allowed.includes(value as AppId)) {
    throw new Error(
      `${fieldName} 必须是 ${allowed.join("、")} 之一，当前为 ${value || "空"}`,
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
    branch
      .split("/")
      .every(
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

/** 链接 `config` 参数解码后的原文、格式和解析出的对象；没带时返回 null */
export interface DeepLinkConfigPayload {
  text: string;
  format: DeepLinkConfigFormat;
  value: Record<string, unknown>;
}

export const decodeDeepLinkConfig = (
  request: Pick<DeepLinkImportRequest, "config" | "configFormat">,
): DeepLinkConfigPayload | null => {
  if (!request.config) {
    return null;
  }

  const text = safeDecodeBase64Utf8("config", request.config);
  const format = normalizeConfigFormat(request.configFormat);
  return { text, format, value: parseConfigObject(text, format) };
};

export const parseDeepLinkConfigObject = (
  request: Pick<DeepLinkImportRequest, "config" | "configFormat">,
): Record<string, unknown> | null =>
  decodeDeepLinkConfig(request)?.value ?? null;

/** Codex 链接附带的 config.toml 文本（整份 TOML 时用原文，保留数值类型） */
export const codexConfigTextOf = (
  payload: DeepLinkConfigPayload,
): string | null =>
  codexLinkConfigText(
    payload.value,
    payload.format === "toml" ? payload.text : undefined,
  );

/** Grok Build 链接附带的 config.toml 文本（整份 TOML 时用原文，保留数值类型） */
export const grokConfigTextOf = (payload: DeepLinkConfigPayload): string =>
  grokLinkConfigText(
    payload.value,
    payload.format === "toml" ? payload.text : undefined,
  );

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
  payload: DeepLinkConfigPayload,
) => {
  const configText = codexConfigTextOf(payload);
  // 先过白名单：拒绝的键在确认框打开时就报出来，而不是点了导入才失败
  const link = configText !== null ? parseCodexLinkConfig(configText) : null;

  if (!request.apiKey) {
    const auth = (payload.value.auth ?? {}) as Record<string, unknown>;
    const authKey =
      typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim()
        ? auth.OPENAI_API_KEY
        : undefined;
    request.apiKey =
      authKey ?? extractCodexExperimentalBearerToken(configText) ?? undefined;
  }
  if (!request.apiKey && link?.declaresEnvKey) {
    throw new Error(ENV_KEY_ONLY_ERROR);
  }
  if (!request.endpoint) {
    request.endpoint =
      link?.baseUrl() ??
      (configText ? extractCodexBaseUrl(configText) : undefined);
  }
  if (!request.model) {
    request.model = link?.model();
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

const mergeGrokbuildConfig = (
  request: DeepLinkImportRequest,
  payload: DeepLinkConfigPayload,
) => {
  // 先过白名单：拒绝的键在确认框打开时就报出来，而不是点了导入才失败
  const profile = parseGrokLinkProfile(grokConfigTextOf(payload));

  if (!request.apiKey) {
    // 只收显式声明的 api_key；env_key 是间接引用，不能解析成明文，也不能原样带进来：
    // 转发和用量查询都会在请求时解析它，等于把本机的环境变量密钥发到链接给的地址
    request.apiKey = profile.apiKey;
    if (!request.apiKey && profile.declaresEnvKey) {
      throw new Error(ENV_KEY_ONLY_ERROR);
    }
  }
  if (!request.endpoint) {
    request.endpoint = profile.baseUrl;
  }
  if (!request.model) {
    request.model = profile.model;
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

const mergeProviderConfig = (
  request: DeepLinkImportRequest,
  payload: DeepLinkConfigPayload,
): DeepLinkImportRequest => {
  const merged = { ...request };
  switch (merged.app) {
    case "claude":
      mergeClaudeConfig(merged, payload.value);
      break;
    case "codex":
      mergeCodexConfig(merged, payload);
      break;
    case "gemini":
      mergeGeminiConfig(merged, payload.value);
      break;
    case "grokbuild":
      mergeGrokbuildConfig(merged, payload);
      break;
    case "opencode":
    case "openclaw":
    case "hermes":
    case "pi":
      mergeAdditiveConfig(merged, payload.value);
      // 从 config 里补来的地址和 Key 同样要查，让确认框当场报错
      checkLinkValues(merged);
      break;
    default:
      break;
  }

  if (!merged.homepage && merged.endpoint) {
    merged.homepage = inferHomepageFromEndpoint(merged.endpoint);
  }

  return merged;
};

export const mergeDeepLinkConfig = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportRequest> => {
  if (request.resource !== "provider") {
    return request;
  }
  // 远程配置没有实现：解析阶段已经拒绝，这里兜底，防止直接构造的请求绕过
  if (request.configUrl) {
    throw new Error("暂不支持 configUrl，请用 config 参数内联配置（Base64）");
  }

  const payload = decodeDeepLinkConfig(request);
  if (!payload) {
    return request;
  }

  return {
    ...mergeProviderConfig(request, payload),
    configFormat: payload.format,
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
  const appRaw = url.searchParams.get("app") || undefined;
  const request: DeepLinkImportRequest = {
    version: url.hostname,
    resource: resourceRaw as DeepLinkResource,
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
    case "provider": {
      if (!appRaw) throw new Error("provider deeplink 缺少 app 参数");
      request.app = ensureLinkApp(appRaw, PROVIDER_LINK_APPS, "app");
      if (!request.name) throw new Error("provider deeplink 缺少 name 参数");
      // 远程配置没有实现。在解析阶段就拒绝，用户当场看到原因，而不是确认导入之后才失败
      if (url.searchParams.has("configUrl")) {
        throw new Error(
          "暂不支持 configUrl，请用 config 参数内联配置（Base64）",
        );
      }
      if (request.homepage) ensureHttpUrl(request.homepage, "homepage");
      if (request.endpoint) {
        request.endpoint
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item, index) => ensureHttpUrl(item, `endpoint[${index}]`));
      }
      // Pi 的节点没有模型就选不到任何模型
      if (request.app === "pi" && !request.model?.trim()) {
        throw new Error("Pi 供应商需要模型，请在链接里加上 model 参数");
      }
      // 在解析阶段就核对，用户当场看到「这个应用不支持这种接口」，而不是确认导入之后才失败
      const apiFormatRaw = url.searchParams.get("apiFormat");
      if (apiFormatRaw !== null) {
        request.apiFormat = checkApiFormat(
          request.app,
          apiFormatRaw,
        ) as DeepLinkApiFormat;
      }
      // 累加式应用会把某些写法当成命令、环境变量或文件引用，解析阶段就拒绝
      checkLinkValues(request);
      break;
    }
    case "prompt":
      if (!appRaw) throw new Error("prompt deeplink 缺少 app 参数");
      request.app = ensureLinkApp(appRaw, PROMPT_LINK_APPS, "app");
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
          if (!MCP_LINK_APPS.includes(app as AppId)) {
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
