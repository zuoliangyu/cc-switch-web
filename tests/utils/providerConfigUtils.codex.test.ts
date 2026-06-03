import { describe, expect, it } from "vitest";
import {
  extractCodexBaseUrl,
  extractCodexModelName,
  setCodexBaseUrl,
  setCodexModelName,
  isCodexGoalModeEnabled,
  setCodexGoalMode,
  isCodexRemoteCompactionEnabled,
  setCodexRemoteCompaction,
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
});

describe("Codex goal mode toggle (上游 3c3d4174)", () => {
  it("adds [features] goals=true when enabled and removes it when disabled", () => {
    const base = 'model_provider = "custom"\nmodel = "gpt-5.5"\n';
    expect(isCodexGoalModeEnabled(base)).toBe(false);

    const on = setCodexGoalMode(base, true);
    expect(isCodexGoalModeEnabled(on)).toBe(true);
    expect(on).toMatch(/\[features\]/);
    expect(on).toMatch(/goals\s*=\s*true/);

    const off = setCodexGoalMode(on, false);
    expect(isCodexGoalModeEnabled(off)).toBe(false);
    // 空的 [features] 段应被清理
    expect(off).not.toMatch(/\[features\]/);
    // 其余配置保留
    expect(off).toMatch(/model_provider = "custom"/);
  });

  it("flips an existing goals=false to true in place", () => {
    const input = 'model = "gpt-5.5"\n\n[features]\ngoals = false\n';
    expect(isCodexGoalModeEnabled(input)).toBe(false);
    const on = setCodexGoalMode(input, true);
    expect(isCodexGoalModeEnabled(on)).toBe(true);
  });
});

describe("Codex remote compaction toggle (上游 af60c7ed)", () => {
  it("writes custom provider name to OpenAI when enabled and restores on disable", () => {
    const input = [
      'model_provider = "deepseek"',
      'model = "deepseek-chat"',
      "",
      "[model_providers.deepseek]",
      'name = "deepseek"',
      'base_url = "https://api.deepseek.com/v1"',
      "",
    ].join("\n");

    expect(isCodexRemoteCompactionEnabled(input)).toBe(false);

    const on = setCodexRemoteCompaction(input, true);
    expect(isCodexRemoteCompactionEnabled(on)).toBe(true);
    expect(on).toMatch(/\[model_providers\.deepseek\][\s\S]*name = "OpenAI"/);

    const off = setCodexRemoteCompaction(on, false, "deepseek");
    expect(isCodexRemoteCompactionEnabled(off)).toBe(false);
    expect(off).toMatch(/name = "deepseek"/);
  });

  it("is a no-op for reserved (official) provider ids like openai", () => {
    const input =
      'model_provider = "openai"\nmodel = "gpt-5-codex"\n\n[model_providers.openai]\nname = "openai"\n';
    expect(isCodexRemoteCompactionEnabled(input)).toBe(false);
    // openai 是保留 id → 无自定义段，setter 不写入 OpenAI
    const result = setCodexRemoteCompaction(input, true);
    expect(isCodexRemoteCompactionEnabled(result)).toBe(false);
    expect(result).toMatch(/name = "openai"/);
  });
});
