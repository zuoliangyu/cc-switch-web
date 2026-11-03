import { describe, expect, it } from "vitest";
import {
  KIMI_CAPABILITIES,
  kimiConfigSchema,
  kimiProviderPresets,
  kimiAccountPreset,
  KIMI_ACCOUNT_PRESET_ID,
} from "./kimiProviderPresets";
import { piProviderPresets } from "./piProviderPresets";
import { getVisiblePresetEntries } from "@/components/providers/forms/ProviderPresetSelector";
import type { TFunction } from "i18next";

const find = (name: string) =>
  kimiProviderPresets.find((preset) => preset.name === name)!;
const model = (name: string, id: string) => {
  const preset = find(name);
  return preset.settingsConfig.models[`${preset.providerKey}/${id}`];
};

describe("kimiProviderPresets", () => {
  // Web 的预设列表还没有按组/系列合并（随批次 5a），这里只核对账号登录预设单独列出
  it("keeps official account login separate from the API-key presets", () => {
    const t = ((key: string) => key) as TFunction;
    const entries = getVisiblePresetEntries(
      [
        { id: KIMI_ACCOUNT_PRESET_ID, preset: kimiAccountPreset },
        ...kimiProviderPresets.map((preset) => ({
          id: preset.providerKey,
          preset,
        })),
      ],
      { query: "Kimi", t },
    );
    expect(entries.map((entry) => entry.id)).toContain(KIMI_ACCOUNT_PRESET_ID);
    expect(
      entries.filter((entry) => entry.preset.name.startsWith("Kimi")).length,
    ).toBeGreaterThanOrEqual(4);
  });
  it("provides the compatible catalog across vendors, platforms, cloud and local groups", () => {
    const compatible = piProviderPresets.filter(
      (preset) => preset.settingsConfig.api !== "bedrock-converse-stream",
    );
    expect(kimiProviderPresets.map((preset) => preset.name)).toEqual(
      compatible.map((preset) => preset.name),
    );
    for (const name of [
      "88API",
      "A6API",
      "AICodeMirror",
      "OpenRouter",
      "TokenFactory",
    ]) {
      // 上游的“第三方”分组即不属于厂商/云/本地/登录的预设（presetGroups 随批次 5a）
      expect([
        "cn_official",
        "cloud_provider",
        "local",
        "official",
      ]).not.toContain(find(name).category);
      expect(find(name).apiKeyUrl).toBeTruthy();
    }
    expect(find("Third-party platform")).toBeUndefined();
  });

  it("keeps Kimi as one vendor row with its pay-as-you-go, coding and regional variants", () => {
    expect(
      kimiProviderPresets
        .map((preset) => preset.name)
        .filter((name) => name.startsWith("Kimi")),
    ).toEqual([
      "Kimi",
      "Kimi Global",
      "Kimi For Coding",
      "Kimi For Coding Global",
    ]);
    expect(find("Kimi Code")).toBeUndefined();
    expect(find("Moonshot (CN)")).toBeUndefined();
    expect(find("Moonshot (Global)")).toBeUndefined();
    expect(find("Kimi").settingsConfig.provider).toMatchObject({
      type: "kimi",
      base_url: "https://api.moonshot.cn/v1",
    });
    expect(find("Kimi For Coding").settingsConfig.provider).toMatchObject({
      type: "kimi",
      base_url: "https://api.kimi.com/coding/v1",
    });
    expect(model("Kimi", "kimi-k3")).toMatchObject({
      max_context_size: 1048576,
      support_efforts: ["low", "high", "max"],
      default_effort: "high",
    });
    expect(model("Kimi", "kimi-k3").capabilities).toEqual(
      expect.arrayContaining([
        "image_in",
        "thinking",
        "always_thinking",
        "dynamically_loaded_tools",
      ]),
    );
    for (const preset of ["Kimi", "Kimi Global"]) {
      for (const id of ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"]) {
        expect(model(preset, id)).toMatchObject({
          max_context_size: 1048576,
          support_efforts: ["low", "high", "max"],
          default_effort: "high",
        });
      }
    }
  });

  it("uses cloud providers' real protocols and excludes Bedrock's unsupported signing protocol", () => {
    for (const name of [
      "Ollama Cloud",
      "SambaNova",
      "DigitalOcean",
      "Microsoft Foundry",
    ]) {
      expect(find(name).category).toBe("cloud_provider");
    }
    expect(find("Microsoft Foundry").settingsConfig.provider).toMatchObject({
      type: "anthropic",
      base_url: "https://YOUR_RESOURCE_NAME.services.ai.azure.com/anthropic",
    });
    expect(find("AWS Bedrock")).toBeUndefined();
    expect(find("OpenRouter").settingsConfig.provider).toMatchObject({
      type: "anthropic",
      base_url: "https://openrouter.ai/api",
    });
  });

  it.each([
    ["Ollama", "http://localhost:11434/v1"],
    ["LM Studio", "http://localhost:1234/v1"],
    ["vLLM", "http://localhost:8000/v1"],
  ])(
    "configures %s without requiring a secret for its unauthenticated default server",
    (name, baseUrl) => {
      expect(find(name).category).toBe("local");
      expect(find(name).settingsConfig.provider).toMatchObject({
        type: "openai",
        base_url: baseUrl,
        api_key: "local",
      });
    },
  );

  it("writes only Kimi-native model fields while retaining reasoning and image capabilities", () => {
    const aliases = new Set<string>();
    for (const preset of kimiProviderPresets) {
      expect(
        kimiConfigSchema.safeParse(preset.settingsConfig).success,
        preset.name,
      ).toBe(true);
      const source = piProviderPresets.find(
        (entry) => entry.providerKey === preset.providerKey,
      )!;
      expect(preset.settingsConfig).not.toHaveProperty("api");
      expect(preset.settingsConfig).not.toHaveProperty("compat");
      for (const [alias, config] of Object.entries(
        preset.settingsConfig.models,
      )) {
        expect(aliases.has(alias), alias).toBe(false);
        aliases.add(alias);
        const original = source.settingsConfig.models.find(
          (entry) => entry.id === config.model,
        )!;
        expect(config.max_context_size).toBe(original.contextWindow);
        expect(config.capabilities?.includes("image_in")).toBe(
          original.input.includes("image"),
        );
        expect(config.capabilities?.includes("thinking")).toBe(
          original.reasoning,
        );
        for (const capability of config.capabilities ?? []) {
          expect(KIMI_CAPABILITIES).toContain(capability);
        }
        expect(config).not.toHaveProperty("compat");
        expect(config).not.toHaveProperty("thinkingLevelMap");
        expect(config).not.toHaveProperty("input");
        if (Array.isArray(config.support_efforts))
          expect(config.support_efforts).toContain(config.default_effort);
      }
    }
    expect(model("PackyCode", "claude-opus-5-5")).toMatchObject({
      adaptive_thinking: true,
      max_output_size: 128000,
    });
  });
});
