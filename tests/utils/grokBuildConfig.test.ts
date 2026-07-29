import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  buildGrokBuildConfig,
  extractGrokBuildBaseUrl,
  parseGrokBuildConfig,
  updateGrokBuildConfig,
  validateGrokBuildConfig,
} from "@/utils/grokBuildConfig";

describe("Grok Build config", () => {
  it("构建并回读供应商 TOML", () => {
    const config = buildGrokBuildConfig({
      model: "client-profile",
      upstreamModel: "grok-4.5",
      baseUrl: "https://relay.example.com/v1",
      name: 'Relay "A"',
      apiKey: "secret",
      apiBackend: "responses",
      contextWindow: 500000,
    });

    expect(parseGrokBuildConfig(config)).toEqual({
      model: "client-profile",
      upstreamModel: "grok-4.5",
      baseUrl: "https://relay.example.com/v1",
      name: 'Relay "A"',
      apiKey: "secret",
      envKey: "",
      apiBackend: "responses",
      contextWindow: 500000,
    });
    expect(extractGrokBuildBaseUrl(config)).toBe(
      "https://relay.example.com/v1",
    );
    expect(validateGrokBuildConfig(config)).toBeNull();
  });

  it("更新时保留 env_key 与无关配置，并移除旧档位", () => {
    const original = `[models]
default = "old-profile"

[model."old-profile"]
model = "grok-4.5"
base_url = "https://api.example.com/v1"
name = "Relay"
env_key = "XAI_API_KEY"
api_backend = "responses"
context_window = 500000

[mcp.servers.demo]
command = "demo"
`;
    const updated = updateGrokBuildConfig(original, {
      ...parseGrokBuildConfig(original),
      model: "new-profile",
      baseUrl: "https://updated.example.com/v1",
    });
    const parsed = parseToml(updated) as Record<string, any>;

    expect(parsed.model["new-profile"].env_key).toBe("XAI_API_KEY");
    expect(parsed.model["new-profile"]).not.toHaveProperty("api_key");
    expect(parsed.model).not.toHaveProperty("old-profile");
    expect(parsed.mcp.servers.demo.command).toBe("demo");
  });

  it("拒绝缺字段、缺凭据和非法上下文窗口", () => {
    expect(validateGrokBuildConfig("")).toBe("config.toml must not be empty");
    expect(validateGrokBuildConfig('[models]\ndefault = "missing"\n')).toBe(
      "Missing [models] default model table",
    );

    const missingCredential = buildGrokBuildConfig({
      model: "grok-4.5",
      baseUrl: "https://api.example.com/v1",
      name: "Relay",
      apiKey: "",
      apiBackend: "responses",
      contextWindow: 500000,
    });
    expect(validateGrokBuildConfig(missingCredential)).toBe(
      "Missing api_key or env_key",
    );
    expect(
      validateGrokBuildConfig(
        missingCredential
          .replace('name = "Relay"', 'name = "Relay"\napi_key = "secret"')
          .replace("context_window = 500000", "context_window = 0"),
      ),
    ).toBe("context_window must be a positive integer");
  });
});
