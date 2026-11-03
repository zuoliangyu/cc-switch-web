import { mcpApi, promptsApi, providersApi, skillsApi } from "@/lib/api";
import type { AppId } from "@/lib/api";
import { providerRuntimeApi } from "@/lib/api/providerRuntime";
import type { McpServer, Provider, ProviderMeta, UsageScript } from "@/types";
import { decodeBase64Utf8 } from "@/lib/utils/base64";
import { TEMPLATE_TYPES } from "@/config/constants";
import { detectCodingPlanProviderForApp } from "@/config/codingPlanProviders";
import type {
  DeepLinkApiFormat,
  DeepLinkImportRequest,
  DeepLinkImportResult,
  McpImportSummary,
} from "./types";
import {
  checkLinkValues,
  isAdditiveLinkApp,
  linkApiFormat,
  nativeProtocol,
  routedApiFormat,
} from "./linkRules";
import {
  codexConfigTextOf,
  decodeDeepLinkConfig,
  grokConfigTextOf,
} from "./parser";
import {
  GROK_DEFAULT_API_BACKEND,
  GROK_DEFAULT_CONTEXT_WINDOW,
  GROK_DEFAULT_MODEL,
  parseCodexLinkConfig,
  parseGrokLinkProfile,
  tomlString,
} from "./tomlLink";

const sanitizeId = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "imported";
};

const getTimestampId = (value: string) => `${sanitizeId(value)}-${Date.now()}`;

const randomSuffix = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/**
 * 供应商 ID。显示名可以是中文等 Unicode，但新的 OpenCode ID 要能通过编辑器的
 * `^[a-z0-9]+(-[a-z0-9]+)*$` 校验，所以只取 ASCII 字母数字片段，后缀换成随机值，
 * 同一毫秒内重复导入也不会撞 ID。
 */
const getProviderId = (app: AppId, name: string) => {
  if (app !== "opencode") return getTimestampId(name);
  const slug = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join("-")
    .toLowerCase();
  return `${slug || "provider"}-${randomSuffix()}`;
};

const getPrimaryEndpoint = (request: DeepLinkImportRequest) =>
  request.endpoint
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] ?? "";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

/** 用量查询专用 Key：和供应商 Key 相同时不单独存 */
const usageApiKeyOverride = (request: DeepLinkImportRequest) => {
  const usageApiKey = request.usageApiKey?.trim();
  if (!usageApiKey) return undefined;
  const providerApiKey = request.apiKey?.trim();
  return providerApiKey && usageApiKey === providerApiKey
    ? undefined
    : usageApiKey;
};

/** 用量查询专用地址：和主地址相同时不单独存 */
const usageBaseUrlOverride = (request: DeepLinkImportRequest) => {
  const usageBaseUrl = request.usageBaseUrl
    ? normalizeBaseUrl(request.usageBaseUrl)
    : "";
  if (!usageBaseUrl) return undefined;
  const providerBaseUrl = normalizeBaseUrl(getPrimaryEndpoint(request));
  return providerBaseUrl && usageBaseUrl === providerBaseUrl
    ? undefined
    : usageBaseUrl;
};

/**
 * 主地址命中套餐用量路由表、且这个应用新建时也会自动启用时返回套餐 id
 * （与新建供应商的 `injectCodingPlanUsageScript` 同一条规则）。
 */
export const linkCodingPlanProvider = (
  request: Pick<DeepLinkImportRequest, "app" | "endpoint">,
) =>
  request.app
    ? detectCodingPlanProviderForApp(
        request.app,
        request.endpoint?.split(",")[0]?.trim(),
      )
    : null;

/**
 * 导入后用量查询是否启用：链接写了 `usageEnabled` 就照办；没写时带了脚本或是套餐地址即启用。
 * 确认框的徽章用同一个函数，必须显示实际会发生的事，不能更乐观也不能更保守。
 */
export const usageWillBeEnabled = (request: DeepLinkImportRequest) =>
  request.usageEnabled ??
  (Boolean(request.usageScript) || Boolean(linkCodingPlanProvider(request)));

const buildUsageScript = (
  request: DeepLinkImportRequest,
): UsageScript | undefined => {
  const codingPlanProvider = linkCodingPlanProvider(request);
  const hasUsageConfig =
    codingPlanProvider ||
    request.usageScript ||
    request.usageEnabled !== undefined ||
    request.usageApiKey ||
    request.usageBaseUrl ||
    request.usageAccessToken ||
    request.usageUserId ||
    request.usageAutoInterval !== undefined;

  if (!hasUsageConfig) {
    return undefined;
  }

  const code = request.usageScript ? decodeBase64Utf8(request.usageScript) : "";

  // 套餐地址且没带脚本：和在应用里新建一样，按套餐额度查询并默认启用
  // （链接写了 `usageEnabled` 仍照办）。额度走后端固定端点，不执行任何脚本。
  if (codingPlanProvider && !code) {
    return {
      enabled: request.usageEnabled ?? true,
      language: "javascript",
      code,
      timeout: 10,
      apiKey: usageApiKeyOverride(request),
      baseUrl: usageBaseUrlOverride(request),
      templateType: TEMPLATE_TYPES.TOKEN_PLAN,
      autoQueryInterval: request.usageAutoInterval ?? 5,
      codingPlanProvider,
    };
  }

  // 启用状态：链接写了 `usageEnabled` 就照办；没写时，带了脚本就启用。
  //
  // 站长放脚本就是为了让用户看到余额，导入后还要再手动打开一次是多余的一步。
  // 默认启用的代价可控：脚本跑在后端受限的沙箱里，且深链接导入的脚本没有模板类型，
  // 请求必须与 base_url 同源。用户的同意体现在确认框：完整的脚本正文和启用徽章都展示过
  // 之后才点导入，所以那两处展示不可省略。链接想导入但不启用，就显式写 `usageEnabled=false`。
  return {
    enabled: request.usageEnabled ?? code !== "",
    language: "javascript",
    code,
    timeout: 10,
    apiKey: request.usageApiKey ?? request.apiKey,
    baseUrl: request.usageBaseUrl ?? (getPrimaryEndpoint(request) || undefined),
    accessToken: request.usageAccessToken,
    userId: request.usageUserId,
    autoQueryInterval: request.usageAutoInterval,
  };
};

const buildProviderMeta = (
  request: DeepLinkImportRequest,
  apiFormat: DeepLinkApiFormat | undefined,
): ProviderMeta | undefined => {
  const usageScript = buildUsageScript(request);
  // Claude Code、Codex、Grok Build 的格式记在 meta 上：非原生格式的卡片会带「需要路由」，
  // 切过去时由本地路由转换。链接没写时不加这个字段，和旧链接导入的行一致。
  const routed = request.app
    ? routedApiFormat(request.app, apiFormat)
    : undefined;
  if (!usageScript && !routed) {
    return undefined;
  }

  return {
    ...(usageScript ? { usage_script: usageScript } : {}),
    ...(routed ? { apiFormat: routed } : {}),
  };
};

/** Codex：链接附带了 config.toml 时按白名单收下属于这个供应商的部分；没带时用固定模板 */
const buildCodexSettings = (
  request: DeepLinkImportRequest,
): Record<string, unknown> => {
  const displayName =
    Array.from(request.name ?? "custom")
      .filter((char) => !/\p{Cc}/u.test(char))
      .join("")
      .trim() || "custom";
  const model = request.model ?? "gpt-5-codex";
  const endpoint = normalizeBaseUrl(getPrimaryEndpoint(request));
  const apiKey = request.apiKey ?? "";

  const payload = decodeDeepLinkConfig(request);
  const configText = payload ? codexConfigTextOf(payload) : null;
  if (configText !== null) {
    return {
      auth: { OPENAI_API_KEY: apiKey },
      config: parseCodexLinkConfig(configText).render(
        displayName,
        endpoint,
        model,
        apiKey,
      ),
    };
  }

  return {
    auth: {
      OPENAI_API_KEY: apiKey,
    },
    config: `model_provider = "custom"
model = ${tomlString(model)}
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = ${tomlString(displayName)}
base_url = ${tomlString(endpoint)}
wire_api = "responses"
requires_openai_auth = true
`,
  };
};

/** Grok Build：链接附带了 config.toml 时只收 `[models] default` 指向的那张模型表；没带时用固定模板 */
const buildGrokbuildSettings = (
  request: DeepLinkImportRequest,
): Record<string, unknown> => {
  const model = request.model?.trim() || GROK_DEFAULT_MODEL;
  const name = request.name?.trim() || "custom";
  const endpoint = getPrimaryEndpoint(request).trim();
  const apiKey = request.apiKey?.trim() ?? "";

  const payload = decodeDeepLinkConfig(request);
  if (payload) {
    const profile = parseGrokLinkProfile(grokConfigTextOf(payload));
    return { config: profile.render(name, model, endpoint, apiKey) };
  }

  const modelValue = tomlString(model);
  return {
    config: `[models]
default = ${modelValue}

[model.${modelValue}]
model = ${modelValue}
base_url = ${tomlString(endpoint)}
name = ${tomlString(name)}
api_key = ${tomlString(apiKey)}
api_backend = "${GROK_DEFAULT_API_BACKEND}"
context_window = ${GROK_DEFAULT_CONTEXT_WINDOW}
`,
  };
};

const buildProviderSettings = (
  request: DeepLinkImportRequest,
  apiFormat: DeepLinkApiFormat | undefined,
): Record<string, unknown> => {
  const endpoint = getPrimaryEndpoint(request);

  switch (request.app) {
    case "claude":
      return {
        env: {
          ANTHROPIC_AUTH_TOKEN: request.apiKey ?? "",
          ANTHROPIC_BASE_URL: endpoint,
          ...(request.model ? { ANTHROPIC_MODEL: request.model } : {}),
          ...(request.haikuModel
            ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: request.haikuModel }
            : {}),
          ...(request.sonnetModel
            ? { ANTHROPIC_DEFAULT_SONNET_MODEL: request.sonnetModel }
            : {}),
          ...(request.opusModel
            ? { ANTHROPIC_DEFAULT_OPUS_MODEL: request.opusModel }
            : {}),
        },
      };
    case "codex":
      return buildCodexSettings(request);
    case "gemini":
      return {
        env: {
          GEMINI_API_KEY: request.apiKey ?? "",
          GOOGLE_GEMINI_BASE_URL: endpoint,
          ...(request.model ? { GEMINI_MODEL: request.model } : {}),
        },
      };
    case "grokbuild":
      return buildGrokbuildSettings(request);
    case "opencode":
      return {
        npm: nativeProtocol("opencode", apiFormat),
        options: {
          ...(endpoint ? { baseURL: endpoint } : {}),
          ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        },
        models: request.model
          ? {
              [request.model]: {
                name: request.model,
              },
            }
          : {},
      };
    case "openclaw":
      return {
        ...(endpoint ? { baseUrl: endpoint } : {}),
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        api: nativeProtocol("openclaw", apiFormat),
        ...(request.model
          ? {
              models: [{ id: request.model, name: request.model }],
            }
          : {}),
      };
    case "hermes":
      // Hermes 的 custom_providers 用 snake_case 字段；api_mode 一律显式写出，
      // 不依赖 Hermes 只认几个官方地址的 URL 推断
      return {
        ...(request.name ? { name: request.name } : {}),
        ...(endpoint ? { base_url: endpoint } : {}),
        ...(request.apiKey ? { api_key: request.apiKey } : {}),
        api_mode: nativeProtocol("hermes", apiFormat),
        ...(request.model
          ? {
              models: [{ id: request.model, name: request.model }],
            }
          : {}),
      };
    case "pi": {
      // Pi 的 models.json 供应商节点，形状同 Pi 页面的表单。模型必填：没有模型的节点在 Pi 里
      // 选不到任何模型，导入了也用不上
      const model = request.model?.trim();
      if (!model) {
        throw new Error("Pi 供应商需要模型，请在链接里加上 model 参数");
      }
      return {
        ...(request.name ? { name: request.name } : {}),
        ...(endpoint ? { baseUrl: endpoint } : {}),
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        api: nativeProtocol("pi", apiFormat),
        models: [{ id: model, name: model }],
      };
    }
    default:
      throw new Error(`不支持的 provider app：${String(request.app)}`);
  }
};

/** 按链接请求构建供应商行（不写入），导入和测试共用 */
export const buildProviderFromRequest = (
  request: DeepLinkImportRequest,
): Provider => {
  if (!request.app || !request.name) {
    throw new Error("provider deeplink 缺少必要字段");
  }
  const apiFormat = linkApiFormat(request);
  // 前端组件可以直接构造请求、不经过解析器：构建时还要再查一次
  checkLinkValues(request);
  return {
    id: getProviderId(request.app, request.name),
    name: request.name,
    settingsConfig: buildProviderSettings(request, apiFormat),
    websiteUrl: request.homepage,
    notes: request.notes,
    meta: buildProviderMeta(request, apiFormat),
    icon: request.icon,
  };
};

const importProvider = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportResult> => {
  if (!request.app || !request.name) {
    throw new Error("provider deeplink 缺少必要字段");
  }
  if (!request.apiKey) {
    throw new Error("provider deeplink 缺少 API Key");
  }
  if (!getPrimaryEndpoint(request)) {
    throw new Error("provider deeplink 缺少 endpoint");
  }
  const app = request.app;
  const provider = buildProviderFromRequest(request);
  const providerId = provider.id;

  // `enabled` 是确认框里「导入后立即切换 / 添加到应用」开关的值（链接里的 `enabled` 只是它的
  // 初始值）。累加式应用（OpenCode、OpenClaw、Hermes、Pi）没有「切换」：开关决定这家要不要
  // 写进应用的配置文件；旧链接没写时照旧写进去。切换式应用开关关闭时只存进列表：`add` 在
  // 还没有当前供应商时会让这家直接生效，所以走不写客户端配置的路径。
  const additive = isAdditiveLinkApp(app);
  const activate = additive
    ? (request.enabled ?? true)
    : (request.enabled ?? false);

  if (additive) {
    await providersApi.add(provider, app, activate);
  } else if (activate) {
    await providersApi.add(provider, app);
  } else {
    await providersApi.addWithoutSwitching(provider, app);
  }

  const extraEndpoints =
    request.endpoint
      ?.split(",")
      .map((item) => normalizeBaseUrl(item))
      .filter(Boolean)
      .slice(1) ?? [];

  for (const extraEndpoint of extraEndpoints) {
    await providerRuntimeApi.addCustomEndpoint(app, providerId, extraEndpoint);
  }

  if (!additive && activate) {
    await providersApi.switch(providerId, app);
  }

  return { type: "provider", id: providerId };
};

const importPrompt = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportResult> => {
  if (!request.app || !request.name || !request.content) {
    throw new Error("prompt deeplink 缺少必要字段");
  }
  const id = getTimestampId(request.name);
  const timestamp = Date.now();
  await promptsApi.upsertPrompt(request.app, id, {
    id,
    name: request.name,
    content: decodeBase64Utf8(request.content),
    description: request.description,
    enabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (request.enabled) {
    await promptsApi.enablePrompt(request.app, id);
  }
  return { type: "prompt", id };
};

const mergeMcpApps = (apps: string | undefined) => {
  const targets = (apps ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    mcode: targets.includes("mcode"),
    claude: targets.includes("claude"),
    "claude-desktop": targets.includes("claude-desktop"),
    codex: targets.includes("codex"),
    gemini: targets.includes("gemini"),
    grokbuild: targets.includes("grokbuild"),
    opencode: targets.includes("opencode"),
    openclaw: targets.includes("openclaw"),
    hermes: targets.includes("hermes"),
  };
};

const importMcp = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportResult> => {
  if (!request.config) {
    throw new Error("mcp deeplink 缺少 config");
  }
  const decoded = decodeBase64Utf8(request.config);
  const config = JSON.parse(decoded) as {
    mcpServers?: Record<string, unknown>;
  };
  const servers = config.mcpServers ?? {};
  if (Object.keys(servers).length === 0) {
    throw new Error("deeplink 中未找到 MCP 服务器配置");
  }
  const existing = await mcpApi.getAllServers();
  const targetApps = mergeMcpApps(request.apps);
  const summary: McpImportSummary = {
    importedCount: 0,
    importedIds: [],
    failed: [],
  };

  for (const [id, serverSpec] of Object.entries(servers)) {
    try {
      const current = existing[id];
      const server: McpServer = current
        ? {
            ...current,
            apps: {
              mcode: Boolean(current.apps.mcode) || targetApps.mcode,
              claude: current.apps.claude || targetApps.claude,
              "claude-desktop":
                current.apps["claude-desktop"] || targetApps["claude-desktop"],
              codex: current.apps.codex || targetApps.codex,
              gemini: current.apps.gemini || targetApps.gemini,
              grokbuild: current.apps.grokbuild || targetApps.grokbuild,
              opencode: current.apps.opencode || targetApps.opencode,
              openclaw: current.apps.openclaw || targetApps.openclaw,
              hermes: current.apps.hermes || targetApps.hermes,
            },
          }
        : {
            id,
            name: id,
            server: serverSpec as McpServer["server"],
            apps: targetApps,
            tags: ["imported"],
          };

      await mcpApi.upsertUnifiedServer(server);
      summary.importedCount += 1;
      summary.importedIds.push(id);
    } catch (error) {
      summary.failed.push({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    type: "mcp",
    ...summary,
  };
};

const importSkill = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportResult> => {
  if (!request.repo) {
    throw new Error("skill deeplink 缺少 repo");
  }
  const [owner, name] = request.repo.split("/");
  await skillsApi.addRepo({
    owner,
    name,
    branch: request.branch || "main",
    enabled: request.enabled ?? true,
  });
  return {
    type: "skill",
    key: `${owner}/${name}`,
  };
};

export const importFromDeepLink = async (
  request: DeepLinkImportRequest,
): Promise<DeepLinkImportResult> => {
  switch (request.resource) {
    case "provider":
      return importProvider(request);
    case "prompt":
      return importPrompt(request);
    case "mcp":
      return importMcp(request);
    case "skill":
      return importSkill(request);
    default:
      throw new Error(
        `不支持的 deeplink 资源类型：${String(request.resource)}`,
      );
  }
};
