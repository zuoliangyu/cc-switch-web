import { mcpApi, promptsApi, providersApi, skillsApi } from "@/lib/api";
import type { AppId } from "@/lib/api";
import { providerRuntimeApi } from "@/lib/api/providerRuntime";
import { piApi } from "@/lib/api/pi";
import type {
  ClaudeDesktopModelRoute,
  McpServer,
  Provider,
  ProviderMeta,
  UsageScript,
} from "@/types";
import { CLAUDE_DESKTOP_ROLE_ROUTE_IDS } from "@/config/claudeDesktopProviderPresets";
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

/** 原生键有 slug 规则的应用（DeepSeek Harness 只收小写连字符 id，MCode 只收 ASCII 字母数字） */
const SLUG_ID_APPS = new Set<AppId>([
  "opencode",
  "mcode",
  "kimi",
  "dsh",
  "omp",
]);

/**
 * 供应商 ID。显示名可以是中文等 Unicode，但新的 OpenCode 等 ID 要能通过编辑器的
 * `^[a-z0-9]+(-[a-z0-9]+)*$` 校验，所以只取 ASCII 字母数字片段，后缀换成随机值，
 * 同一毫秒内重复导入也不会撞 ID。
 */
const getProviderId = (app: AppId, name: string) => {
  if (!SLUG_ID_APPS.has(app)) return getTimestampId(name);
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

/** 和后端 `is_claude_safe_model_id`、Desktop 表单的 `isClaudeSafeRoute` 同一条规则 */
const isClaudeSafeModelId = (model: string) => {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("[1m]")) return false;
  const tail = normalized.startsWith("anthropic/claude-")
    ? normalized.slice("anthropic/claude-".length)
    : normalized.startsWith("claude-")
      ? normalized.slice("claude-".length)
      : "";
  return ["sonnet-", "opus-", "haiku-", "fable-"].some(
    (prefix) => tail.startsWith(prefix) && tail.length > prefix.length,
  );
};

/**
 * Claude Desktop 只认 `claude-*` 模型名，按链接里的模型名分成两种卡：Anthropic 格式、模型全是
 * Claude 名字（或没写模型）的导成直连卡；有别的名字或别的格式的导成模型映射卡，经本地路由转发，
 * 和在 Desktop 页面手动新建的映射卡一样占满四档，没单独写模型的档用链接的主模型。
 */
const claudeDesktopMeta = (
  request: DeepLinkImportRequest,
  apiFormat: DeepLinkApiFormat | undefined,
): ProviderMeta => {
  const trimmed = (value: string | undefined) => value?.trim() || undefined;
  const format = apiFormat ?? "anthropic";
  const models = [
    request.model,
    request.sonnetModel,
    request.opusModel,
    request.haikuModel,
  ]
    .map(trimmed)
    .filter((model): model is string => Boolean(model));

  if (format === "anthropic" && models.every(isClaudeSafeModelId)) {
    return {
      claudeDesktopMode: "direct",
      apiFormat: "anthropic",
      claudeDesktopModelRoutes: Object.fromEntries(
        models.map((model) => [model, { model }]),
      ),
    };
  }

  const primary = models[0];
  if (!primary) {
    throw new Error(
      "使用非 Anthropic apiFormat 的 Claude Desktop 链接需要模型，请在链接里加上 model 参数",
    );
  }
  const tiers: Record<keyof typeof CLAUDE_DESKTOP_ROLE_ROUTE_IDS, string> = {
    sonnet: trimmed(request.sonnetModel) ?? primary,
    opus: trimmed(request.opusModel) ?? primary,
    haiku: trimmed(request.haikuModel) ?? primary,
    fable: primary,
  };
  const routes: Record<string, ClaudeDesktopModelRoute> = {};
  for (const role of ["sonnet", "opus", "haiku", "fable"] as const) {
    const upstream = tiers[role];
    routes[CLAUDE_DESKTOP_ROLE_ROUTE_IDS[role]] = {
      model: upstream,
      labelOverride: upstream,
    };
  }
  return {
    claudeDesktopMode: "proxy",
    apiFormat: nativeProtocol(
      "claude-desktop",
      format,
    ) as ProviderMeta["apiFormat"],
    claudeDesktopModelRoutes: routes,
  };
};

const buildProviderMeta = (
  request: DeepLinkImportRequest,
  apiFormat: DeepLinkApiFormat | undefined,
): ProviderMeta | undefined => {
  const usageScript = buildUsageScript(request);
  if (request.app === "claude-desktop") {
    return {
      ...(usageScript ? { usage_script: usageScript } : {}),
      ...claudeDesktopMeta(request, apiFormat),
    };
  }
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

/**
 * 链接的主模型。Pi 系这几家的节点没有模型就选不到任何模型，解析时已要求链接带上；
 * 从 `config` 合并来的请求、直接构造的请求再查一次。
 */
const requiredLinkModel = (request: DeepLinkImportRequest) => {
  const model = request.model?.trim();
  if (!model) {
    throw new Error(
      `${String(request.app)} 供应商需要模型，请在链接里加上 model 参数`,
    );
  }
  return model;
};

/**
 * 链接导入的 Kimi Code 模型的上下文窗口。Kimi 自己要求每个模型都带正数
 * `max_context_size`（缺了拒绝运行），链接里没有这个字段。取偏小的 128K：Kimi 按它决定何时压缩，
 * 报大了长会话会被上游拒绝，报小了只是早一点压缩。用户可在编辑器里改。
 */
const KIMI_LINK_CONTEXT_SIZE = 131_072;

/**
 * Kimi Code 的模型表是全局的，键和别家供应商撞了写入会被拒，所以键写成 `<供应商 id>/<模型>`，
 * 和预设一致。
 */
const namespaceKimiModels = (settings: Record<string, unknown>, id: string) => {
  const models = settings.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return;
  settings.models = Object.fromEntries(
    Object.entries(models as Record<string, unknown>).map(([key, model]) => [
      `${id}/${key}`,
      model,
    ]),
  );
};

const buildProviderSettings = (
  request: DeepLinkImportRequest,
  apiFormat: DeepLinkApiFormat | undefined,
): Record<string, unknown> => {
  const endpoint = getPrimaryEndpoint(request);

  switch (request.app) {
    case "claude":
    case "claude-desktop":
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
    case "agy":
      // agy 只认 settings.json 里的 model.name（显示名），Key 和地址只经打开的终端传入
      return {
        env: {
          GEMINI_API_KEY: request.apiKey ?? "",
          GOOGLE_GEMINI_BASE_URL: endpoint,
        },
        ...(request.model
          ? { config: { model: { name: request.model } } }
          : {}),
      };
    case "grokbuild":
      return buildGrokbuildSettings(request);
    case "copilot": {
      // Copilot CLI 自带模型的环境变量：接口格式换算成 COPILOT_PROVIDER_TYPE 与
      // COPILOT_PROVIDER_WIRE_API（上游 build_copilot_settings）；Key 只在打开的终端里传给 copilot
      const wire = nativeProtocol("copilot", apiFormat);
      const model = request.model?.trim();
      return {
        env: {
          COPILOT_PROVIDER_BASE_URL: endpoint,
          ...(request.apiKey
            ? { COPILOT_PROVIDER_API_KEY: request.apiKey }
            : {}),
          ...(wire === "anthropic"
            ? { COPILOT_PROVIDER_TYPE: "anthropic" }
            : {
                COPILOT_PROVIDER_TYPE: "openai",
                COPILOT_PROVIDER_WIRE_API: wire,
              }),
          ...(model ? { COPILOT_MODEL: model } : {}),
        },
      };
    }
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
    case "mcode":
    case "dsh": {
      // MiniMax Code、DeepSeek Harness 的自定义供应商节点，两家是同一种形状。模型只写名字：
      // 两家客户端都接受，上下文窗口等留给用户在编辑器里补
      const model = requiredLinkModel(request);
      return {
        name: request.name ?? "",
        kind: "custom",
        enabled: true,
        api: nativeProtocol(request.app, apiFormat),
        options: { baseURL: endpoint, apiKey: request.apiKey ?? "" },
        models: { [model]: { name: model } },
      };
    }
    case "kimi": {
      // 模型键先用模型名，定下供应商 id 后由 `namespaceKimiModels` 加前缀
      const model = requiredLinkModel(request);
      return {
        provider: {
          type: nativeProtocol("kimi", apiFormat),
          base_url: endpoint,
          api_key: request.apiKey ?? "",
        },
        models: {
          [model]: {
            model,
            max_context_size: KIMI_LINK_CONTEXT_SIZE,
            capabilities: ["tool_use"],
          },
        },
      };
    }
    case "omp": {
      // Oh My Pi 的 models.yml 节点：和 Pi 一样只写一个模型，但没有 `name` 字段（显示名在 CC Switch）
      const model = requiredLinkModel(request);
      return {
        baseUrl: endpoint,
        apiKey: request.apiKey ?? "",
        api: nativeProtocol("omp", apiFormat),
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
  const id = getProviderId(request.app, request.name);
  const settingsConfig = buildProviderSettings(request, apiFormat);
  if (request.app === "kimi") {
    namespaceKimiModels(settingsConfig, id);
  }
  return {
    id,
    name: request.name,
    settingsConfig,
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
  // omp 先把 Key 当环境变量名查（服务端进程的环境和 `.env`）：此刻就能解析成别的值的，
  // 导入后会把那个值发到链接给的地址
  if (app === "omp" && (await piApi.isOmpApiKeyReference(request.apiKey))) {
    throw new Error(
      "链接的 apiKey 会被 omp 当成环境变量名解析成本机的值，不能从链接导入，请手动添加供应商",
    );
  }

  // `enabled` 是确认框里「导入后立即切换 / 添加到应用」开关的值（链接里的 `enabled` 只是它的
  // 初始值）。累加式应用（OpenCode、OpenClaw、Hermes、Pi）没有「切换」：开关决定这家要不要
  // 写进应用的配置文件；旧链接没写时照旧写进去。切换式应用开关关闭时只存进列表：`add` 在
  // 还没有当前供应商时会让这家直接生效，所以走不写客户端配置的路径。
  const additive = isAdditiveLinkApp(app);
  // Antigravity、Copilot CLI 没有「启用」（卡片只用来打开终端），只导入
  const activate =
    app !== "agy" &&
    app !== "copilot" &&
    (additive ? (request.enabled ?? true) : (request.enabled ?? false));

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
    pi: targets.includes("pi"),
    agy: targets.includes("agy"),
    kimi: targets.includes("kimi"),
    omp: targets.includes("omp"),
    copilot: targets.includes("copilot"),
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
              pi: Boolean(current.apps.pi) || targetApps.pi,
              kimi: Boolean(current.apps.kimi) || targetApps.kimi,
              omp: Boolean(current.apps.omp) || targetApps.omp,
              agy: Boolean(current.apps.agy) || targetApps.agy,
              copilot: Boolean(current.apps.copilot) || targetApps.copilot,
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
