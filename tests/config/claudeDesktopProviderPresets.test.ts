import { describe, expect, it } from "vitest";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";

describe("Claude Desktop provider presets", () => {
  it("includes the complete upstream catalog and managed OAuth presets", () => {
    expect(claudeDesktopProviderPresets).toHaveLength(71);
    expect(claudeDesktopProviderPresets[0]).toMatchObject({
      name: "Claude Desktop Official",
      category: "official",
      mode: "direct",
    });
    expect(
      claudeDesktopProviderPresets.find((preset) => preset.name === "SubRouter"),
    ).toMatchObject({ mode: "direct", apiFormat: "anthropic" });

    for (const [name, providerType] of [
      ["GitHub Copilot", "github_copilot"],
      ["Codex", "codex_oauth"],
      ["xAI (Grok)", "xai_oauth"],
    ] as const) {
      expect(
        claudeDesktopProviderPresets.find((preset) => preset.name === name),
      ).toMatchObject({
        mode: "proxy",
        providerType,
        requiresOAuth: true,
      });
    }
  });
});
