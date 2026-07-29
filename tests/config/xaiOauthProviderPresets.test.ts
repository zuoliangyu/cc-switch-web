import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";

describe("xAI OAuth provider presets", () => {
  it("pins the Claude preset to managed Responses auth", () => {
    const preset = providerPresets.find((entry) => entry.name === "xAI (Grok)");

    expect(preset).toMatchObject({
      category: "third_party",
      apiFormat: "openai_responses",
      providerType: "xai_oauth",
      requiresOAuth: true,
      icon: "xai",
    });
    expect((preset!.settingsConfig as any).env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.x.ai/v1",
      ANTHROPIC_MODEL: "grok-4.5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "grok-4.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "grok-4.5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "grok-4.5",
    });
    expect((preset!.settingsConfig as any).env).not.toHaveProperty(
      "ANTHROPIC_API_KEY",
    );
    expect((preset!.settingsConfig as any).env).not.toHaveProperty(
      "ANTHROPIC_AUTH_TOKEN",
    );
  });

  it("pins Codex API Key and OAuth presets to native Responses", () => {
    const apiKeyPreset = codexProviderPresets.find(
      (entry) => entry.name === "xAI (Grok)",
    );
    const oauthPreset = codexProviderPresets.find(
      (entry) => entry.name === "xAI (Grok) OAuth",
    );

    expect(apiKeyPreset).toMatchObject({
      apiFormat: "openai_responses",
      endpointCandidates: ["https://api.x.ai/v1"],
      icon: "xai",
    });
    expect(apiKeyPreset?.config).toContain('model = "grok-4.5"');
    expect(apiKeyPreset?.config).toContain('base_url = "https://api.x.ai/v1"');
    expect(apiKeyPreset?.config).toContain('wire_api = "responses"');

    expect(oauthPreset).toMatchObject({
      apiFormat: "openai_responses",
      providerType: "xai_oauth",
      requiresOAuth: true,
      icon: "xai",
    });
    expect(oauthPreset?.config).toContain('model = "grok-4.5"');
    expect(oauthPreset?.config).toContain('base_url = "https://api.x.ai/v1"');
    expect(oauthPreset?.config).toContain('wire_api = "responses"');
  });
});
