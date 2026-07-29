import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { localIconList } from "@/icons/local";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";

describe("current provider presets", () => {
  it("includes A6API in every supported app", () => {
    for (const presets of [
      providerPresets,
      codexProviderPresets,
      geminiProviderPresets,
      grokBuildProviderPresets,
      openclawProviderPresets,
      opencodeProviderPresets,
    ]) {
      expect(presets.find((preset) => preset.name === "A6API")).toMatchObject({
        partnerPromotionKey: "a6api",
        icon: "a6api",
      });
    }
    expect(localIconList).toContain("a6api");
  });

  it("uses the current PackyCode primary and fallback endpoints", () => {
    expect(
      providerPresets.find((preset) => preset.name === "PackyCode")
        ?.endpointCandidates,
    ).toEqual([
      "https://www.packyapi.ai",
      "https://cf.api.fan",
      "https://slb-v1.api.fan",
      "https://www.packyapi.com",
    ]);
    expect(
      codexProviderPresets.find((preset) => preset.name === "PackyCode")
        ?.endpointCandidates,
    ).toEqual([
      "https://www.packyapi.ai/v1",
      "https://cf.api.fan/v1",
      "https://slb-v1.api.fan/v1",
      "https://www.packyapi.com/v1",
    ]);
    expect(
      geminiProviderPresets.find((preset) => preset.name === "PackyCode")
        ?.endpointCandidates,
    ).toEqual([
      "https://www.packyapi.ai",
      "https://cf.api.fan",
      "https://slb-v1.api.fan",
      "https://www.packyapi.com",
    ]);
  });

  it("includes current Gemini Code0 and Qiniu presets", () => {
    expect(
      geminiProviderPresets.find((preset) => preset.name === "Code0"),
    ).toMatchObject({
      baseURL: "https://code0.ai",
      model: "gemini-3.6-flash",
      partnerPromotionKey: "code0",
      icon: "code0",
    });
    expect(
      geminiProviderPresets.find((preset) => preset.name === "Qiniu"),
    ).toMatchObject({
      baseURL: "https://api.qnaigc.com/bypass/vertex",
      model: "gemini-3.6-flash",
      partnerPromotionKey: "qiniu",
      endpointCandidates: [
        "https://api.qnaigc.com/bypass/vertex",
        "https://api.modelink.ai/bypass/vertex",
      ],
      icon: "qiniu",
    });
    for (const locale of [zh, en, ja]) {
      expect(locale.providerForm.partnerPromotion.code0).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.qiniu).toBeTruthy();
    }
  });
});
