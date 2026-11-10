import { describe, expect, it } from "vitest";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";

describe("Claude Desktop provider presets", () => {
  it("includes the complete upstream catalog and managed OAuth presets", () => {
    expect(claudeDesktopProviderPresets).toHaveLength(130);
    // 文件顺序跟上游（TokenPlus 排在官方卡前面）；应用内按分组与名称展示，不看文件顺序
    expect(
      claudeDesktopProviderPresets.find(
        (preset) => preset.name === "Claude Desktop Official",
      ),
    ).toMatchObject({
      name: "Claude Desktop Official",
      category: "official",
      mode: "direct",
    });
    expect(
      claudeDesktopProviderPresets.find(
        (preset) => preset.name === "SubRouter",
      ),
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

describe("Claude Desktop OpenCode Go 预设", () => {
  const preset = claudeDesktopProviderPresets.find(
    (item) => item.name === "OpenCode Go",
  );

  it("默认走官方文档列出的 /inference/go/anthropic", () => {
    expect(preset?.baseUrl).toBe("https://opencode.ai/inference/go/anthropic");
  });
});

describe("Claude Desktop OpenCode Go 预设", () => {
  const preset = claudeDesktopProviderPresets.find(
    (item) => item.name === "OpenCode Go",
  );

  it("默认走官方文档列出的 /inference/go/anthropic", () => {
    expect(preset?.baseUrl).toBe("https://opencode.ai/inference/go/anthropic");
  });
});
