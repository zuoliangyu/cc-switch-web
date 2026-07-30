import { describe, expect, it } from "vitest";
import {
  hermesApiModes,
  hermesProviderPresets,
} from "@/config/hermesProviderPresets";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";

type TranslationTree = Record<string, unknown>;

function readTranslation(tree: TranslationTree, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as TranslationTree)[segment];
  }, tree);
}

describe("Hermes Provider 预设目录", () => {
  it("完整包含 63 个上游预设并保持唯一 Provider Key", () => {
    const keys = hermesProviderPresets.map(
      (preset) => preset.settingsConfig.name,
    );

    expect(hermesProviderPresets).toHaveLength(63);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每项显式声明协议，默认模型指向自身模型目录", () => {
    const supportedModes = new Set(hermesApiModes.map((mode) => mode.value));

    for (const preset of hermesProviderPresets) {
      expect(supportedModes.has(preset.settingsConfig.api_mode!)).toBe(true);
      expect(preset.settingsConfig.models?.length).toBeGreaterThan(0);

      const defaults = preset.suggestedDefaults?.model;
      if (defaults) {
        expect(defaults.provider).toBe(preset.settingsConfig.name);
        expect(
          preset.settingsConfig.models?.some((m) => m.id === defaults.default),
        ).toBe(true);
      }
    }
  });

  it.each([
    ["zh", zh],
    ["en", en],
    ["ja", ja],
  ])("%s 覆盖预设名称与合作推广文案", (_locale, translations) => {
    const keys = new Set<string>();
    for (const preset of hermesProviderPresets) {
      if (preset.nameKey) keys.add(preset.nameKey);
      if (preset.partnerPromotionKey) {
        keys.add(`providerForm.partnerPromotion.${preset.partnerPromotionKey}`);
      }
    }

    const missing = [...keys].filter((key) => {
      const value = readTranslation(translations, key);
      return typeof value !== "string" || value.trim().length === 0;
    });
    expect(missing).toEqual([]);
  });
});
