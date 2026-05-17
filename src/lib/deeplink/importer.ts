import { mcpApi, promptsApi, providersApi, skillsApi } from "@/lib/api";
import { providerRuntimeApi } from "@/lib/api/providerRuntime";
import type { McpServer, Provider, ProviderMeta, UsageScript } from "@/types";
import { decodeBase64Utf8 } from "@/lib/utils/base64";
import type {
  DeepLinkImportRequest,
  DeepLinkImportResult,
  McpImportSummary,
} from "./types";

const sanitizeId = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "imported";
};

const getTimestampId = (value: string) => `${sanitizeId(value)}-${Date.now()}`;

const getPrimaryEndpoint = (request: DeepLinkImportRequest) =>
  request.endpoint
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] ?? "";

const buildUsageScript = (
  request: DeepLinkImportRequest,
): UsageScript | undefined => {
  const hasUsageConfig =
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

  return {
    enabled: request.usageEnabled ?? Boolean(request.usageScript),
    language: "javascript",
    code: request.usageScript ? decodeBase64Utf8(request.usageScript) : "",
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
): ProviderMeta | undefined => {
  const usageScript = buildUsageScript(request);
  if (!usageScript) {
    return undefined;
  }

  return {
    usage_script: usageScript,
  };
};

const buildProviderSettings = (
  request: DeepLinkImportRequest,
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
    case "codex": {
      const providerName = sanitizeId(request.name ?? "custom");
      const model = request.model ?? "gpt-5-codex";
      const normalizedEndpoint = endpoint.trim().replace(/\/+$/, "");
      return {
        auth: {
          OPENAI_API_KEY: request.apiKey ?? "",
        },
        config: `model_provider = "${providerName}"
model = "${model}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${providerName}]
name = "${providerName}"
base_url = "${normalizedEndpoint}"
wire_api = "responses"
requires_openai_auth = true
`,
      };
    }
    case "gemini":
      return {
        env: {
          GEMINI_API_KEY: request.apiKey ?? "",
          GOOGLE_GEMINI_BASE_URL: endpoint,
          ...(request.model ? { GEMINI_MODEL: request.model } : {}),
        },
      };
    case "opencode":
      return {
        npm: "@ai-sdk/openai-compatible",
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
        api: "openai-completions",
        ...(request.model
          ? {
              models: [{ id: request.model, name: request.model }],
            }
          : {}),
      };
    default:
      throw new Error(`不支持的 provider app：${String(request.app)}`);
  }
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
  const providerId = getTimestampId(request.name);
  const provider: Provider = {
    id: providerId,
    name: request.name,
    settingsConfig: buildProviderSettings(request),
    websiteUrl: request.homepage,
    notes: request.notes,
    meta: buildProviderMeta(request),
    icon: request.icon,
  };

  await providersApi.add(provider, request.app);

  const extraEndpoints =
    request.endpoint
      ?.split(",")
      .map((item) => item.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .slice(1) ?? [];

  for (const extraEndpoint of extraEndpoints) {
    await providerRuntimeApi.addCustomEndpoint(
      request.app,
      providerId,
      extraEndpoint,
    );
  }

  if (request.enabled) {
    await providersApi.switch(providerId, request.app);
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
    claude: targets.includes("claude"),
    "claude-desktop": targets.includes("claude-desktop"),
    codex: targets.includes("codex"),
    gemini: targets.includes("gemini"),
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
  const config = JSON.parse(decoded) as { mcpServers?: Record<string, unknown> };
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
              claude: current.apps.claude || targetApps.claude,
              "claude-desktop":
                current.apps["claude-desktop"] ||
                targetApps["claude-desktop"],
              codex: current.apps.codex || targetApps.codex,
              gemini: current.apps.gemini || targetApps.gemini,
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
