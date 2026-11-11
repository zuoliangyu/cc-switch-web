import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import {
  OPENCODE_PRESET_MODEL_VARIANTS,
  opencodeProviderPresets,
} from "@/config/opencodeProviderPresets";
import { localIconList } from "@/icons/local";
import { hasIcon } from "@/icons/extracted";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";
import { piProviderPresets } from "@/config/piProviderPresets";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";

describe("current provider presets", () => {
  it("includes 88API and Tu-zi with resolvable icons across nine apps and retires ETok", () => {
    for (const presets of [
      providerPresets,
      claudeDesktopProviderPresets,
      codexProviderPresets,
      geminiProviderPresets,
      grokBuildProviderPresets,
      opencodeProviderPresets,
      openclawProviderPresets,
      hermesProviderPresets,
      piProviderPresets,
    ]) {
      expect(presets.some((preset) => preset.name === "ETok.ai")).toBe(false);
      for (const name of ["88API", "Tu-zi"]) {
        const preset = presets.find((entry) => entry.name === name);
        expect(preset, name).toBeDefined();
        expect(
          preset?.icon &&
            (hasIcon(preset.icon) || localIconList.includes(preset.icon)),
          name,
        ).toBe(true);
      }
    }
  });

  it("uses Tu-zi's API key header and the bare Claude Desktop host", () => {
    expect(
      providerPresets.find((preset) => preset.name === "Tu-zi"),
    ).toMatchObject({
      apiKeyField: "ANTHROPIC_API_KEY",
      settingsConfig: {
        env: {
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_BASE_URL: "https://api.tu-zi.com",
        },
      },
    });
    expect(
      claudeDesktopProviderPresets.find((preset) => preset.name === "Tu-zi")
        ?.baseUrl,
    ).toBe("https://api.tu-zi.com");
    for (const locale of [zh, en, ja]) {
      expect(locale.providerForm.presets.tuzi).toBeTruthy();
      expect(locale.providerForm.partnerPromotion["88api"]).toBeTruthy();
    }
  });

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

  it("includes current Gemini Code0 and Qiniu presets without retired Code0 promotion copy", () => {
    expect(
      geminiProviderPresets.find((preset) => preset.name === "Code0"),
    ).toMatchObject({
      baseURL: "https://code0.ai",
      model: "gemini-3.8-flash",
      icon: "code0",
    });
    expect(
      geminiProviderPresets.find((preset) => preset.name === "Qiniu"),
    ).toMatchObject({
      baseURL: "https://api.qnaigc.com/bypass/vertex",
      model: "gemini-3.8-flash",
      partnerPromotionKey: "qiniu",
      endpointCandidates: [
        "https://api.qnaigc.com/bypass/vertex",
        "https://api.modelink.ai/bypass/vertex",
      ],
      icon: "qiniu",
    });
    for (const locale of [zh, en, ja]) {
      expect(locale.providerForm.partnerPromotion.qiniu).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.apikeyfun).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.apinebula).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.etok).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.subrouter).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.kimi).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.xycai).toBeTruthy();
      expect(
        locale.providerForm.partnerPromotion.volcengine_codingplan,
      ).toBeTruthy();
    }
  });

  it("matches the current Gemini provider catalog", () => {
    expect(geminiProviderPresets.map((preset) => preset.name)).toEqual([
      "Google Official",
      "PackyCode",
      "APINebula",
      "AICodeMirror",
      "PatewayAI",
      "hao.ai",
      "FennoAI",
      "RunAPI",
      "OpenModel",
      "GrooRoute Pro",
      "BuyToken",
      "V-API",
      "Shengsuanyun",
      "AIGoCode",
      "Qiniu",
      "AICoding",
      "SubRouter",
      "OspreyAI",
      "88API",
      "APIKEY.FUN",
      "9527CODE",
      "TeamoRouter",
      "Code0",
      "A6API",
      "Compshare",
      "CCSub",
      "SSSAiCode",
      "SoleAPI",
      "Micu",
      "Cubence",
      "CrazyRouter",
      "DMXAPI",
      "SudoCode.chat",
      "SudoCode.us",
      "XycAi",
      "Modelflare",
      "AllTokens",
      "AllTokens SI",
      "Tu-zi",
      "E-FlowCode",
      "CherryIN",
      "OpenRouter",
      "TheRouter",
      "AICodeWith",
      "SoruxGPT",
      "IKunCode",
      "RunToken",
      "YYLX",
      "TokenFlux",
      "AIComing",
    ]);
  });

  it("matches current OpenCode providers and model capabilities", () => {
    const names = opencodeProviderPresets.map((preset) => preset.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "APINebula",
        "FennoAI",
        "SubRouter",
        "APIKEY.FUN",
        "Code0",
        "火山 Agent Plan",
        "火山 Coding Plan",
        "XycAi",
        "OpenCode Go",
        "CherryIN",
        "PPIO",
        "JieKou AI",
      ]),
    );
    for (const retired of [
      "Kimi k2.6",
      "X-Code API",
      "CTok.ai",
      "LionCCAPI",
      "LemonData",
      "OpenAI Compatible",
    ]) {
      expect(names).not.toContain(retired);
    }
    expect(
      OPENCODE_PRESET_MODEL_VARIANTS["@ai-sdk/openai"].map((model) => model.id),
    ).toContain("gpt-5.6-sol");
    expect(
      OPENCODE_PRESET_MODEL_VARIANTS["@ai-sdk/google"].map((model) => model.id),
    ).toContain("gemini-3.6-flash");
    expect(
      OPENCODE_PRESET_MODEL_VARIANTS["@ai-sdk/amazon-bedrock"].map(
        (model) => model.id,
      ),
    ).toContain("global.anthropic.claude-opus-5");
    for (const locale of [zh, en, ja]) {
      expect(locale.providerForm.partnerPromotion.fenno).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.opencode_go).toBeTruthy();
    }
  });

  it("matches current OpenClaw provider catalog", () => {
    const names = openclawProviderPresets.map((preset) => preset.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Kimi",
        "APINebula",
        "FennoAI",
        "SubRouter",
        "Code0",
        "AtlasCloud",
        "CCSub",
        "Qiniu",
        "XycAi",
        "CherryIN",
        "PPIO",
        "JieKou AI",
      ]),
    );
    for (const retired of [
      "Kimi k2.6",
      "CTok.ai",
      "LionCCAPI",
      "LemonData",
      "OpenAI Compatible",
    ]) {
      expect(names).not.toContain(retired);
    }
    for (const locale of [zh, en, ja]) {
      // 上游 242abf78 去掉了 CCSub 的推广文案（预设本身保留）
      expect(locale.providerForm.partnerPromotion).not.toHaveProperty("ccsub");
      expect(locale.providerForm.partnerPromotion.sudocode).toBeTruthy();
      expect(locale.providerForm.partnerPromotion.teamorouter).toBeTruthy();
    }
  });

  // NekoCode 在上游 v4.0.9 重新接入，只保留 Unity2.ai 的下架校验
  it("removes the retired Unity2.ai presets", () => {
    for (const presets of [
      providerPresets,
      codexProviderPresets,
      geminiProviderPresets,
      grokBuildProviderPresets,
      openclawProviderPresets,
      opencodeProviderPresets,
    ]) {
      const names = presets.map((preset) => preset.name);
      expect(names).not.toContain("Unity2.ai");
    }
  });
});
