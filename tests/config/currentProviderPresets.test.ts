import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { localIconList } from "@/icons/local";

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
});
