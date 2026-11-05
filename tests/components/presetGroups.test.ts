/**
 * 预设分组逻辑（presetGroups）：分类、合并同一家的版本、版本布局、搜索、分段与排序。
 * 取自上游 tests/components/ProviderPresetSelector.test.tsx 的逻辑部分；界面部分随批次 5c2
 * 迁入。Web 的选择器在 5c2 前仍用旧的搜索 / 排序函数，这里直接对 presetGroups 断言。
 */
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { ProviderCategory } from "@/types";
import {
  getVisiblePresetRows,
  type PresetEntry,
} from "@/components/providers/forms/ProviderPresetSelector";
import {
  PRESET_GROUP_ORDER,
  domainBody,
  groupPresetRows,
  loginAccountKey,
  presetDisplayName,
  presetGroup,
  presetMatches,
  presetVersionLayout,
  sectionPresetRows,
  sortPresetsByName,
} from "@/components/providers/forms/presetGroups";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { dshAccountPreset } from "@/config/dshProviderPresets";
import { kimiAccountPreset } from "@/config/kimiProviderPresets";
import {
  PRESET_FAMILIES,
  PRESET_PLAN_KEYS,
  PRESET_REGION_KEYS,
} from "@/config/presetFamilies";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";

const translations: Record<string, string> = {
  "preset.alpha": "Alpha 本地名",
  "preset.zhipu": "智谱 GLM",
};
const t = ((key: string) => translations[key] ?? key) as TFunction;

function preset(
  name: string,
  category: ProviderCategory,
  websiteUrl: string,
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    websiteUrl,
    settingsConfig: {},
    category,
    ...extra,
  } as PresetEntry["preset"];
}

const entries: PresetEntry[] = [
  {
    id: "gamma",
    preset: preset("Gamma", "aggregator", "https://api.gamma.com"),
  },
  {
    id: "alpha",
    preset: preset("Alpha Raw", "official", "https://alpha.example.com", {
      nameKey: "preset.alpha",
    }),
  },
  {
    id: "huoshan",
    preset: preset("火山引擎", "cn_official", "https://www.volcengine.com"),
  },
  {
    id: "zhipu",
    preset: preset("Zhipu GLM", "cn_official", "https://open.bigmodel.cn", {
      nameKey: "preset.zhipu",
    }),
  },
  {
    id: "bedrock",
    preset: preset("AWS Bedrock", "cloud_provider", "https://aws.amazon.com"),
  },
  {
    id: "copilot",
    preset: preset("GitHub Copilot", "third_party", "https://github.com", {
      providerType: "github_copilot",
    }),
  },
  {
    id: "ollama-local",
    preset: preset("Ollama", "local", "https://ollama.com"),
  },
];

// 同一家的四个版本：套餐 × 地区成完整网格（文件顺序故意打乱；显示时按 planOrder 排）
const kimiEntries: PresetEntry[] = [
  {
    id: "kimi-cn",
    preset: preset("Kimi", "cn_official", "https://platform.kimi.com", {
      family: "kimi",
      planKey: "payg",
      regionKey: "cn",
    }),
  },
  {
    id: "kimi-coding",
    preset: preset("Kimi For Coding", "cn_official", "https://www.kimi.com", {
      family: "kimi",
      planKey: "coding",
      regionKey: "cn",
    }),
  },
  {
    id: "kimi-intl",
    preset: preset("Kimi Global", "cn_official", "https://platform.kimi.ai", {
      family: "kimi",
      planKey: "payg",
      regionKey: "intl",
    }),
  },
  {
    id: "kimi-coding-intl",
    preset: preset(
      "Kimi For Coding Global",
      "cn_official",
      "https://www.kimi.com",
      { family: "kimi", planKey: "coding", regionKey: "intl" },
    ),
  },
];
const familyEntries: PresetEntry[] = [...entries, ...kimiEntries];

// 只在一个维度上变化的一家（智谱：国内 / 海外）
const zhipuFamily: PresetEntry[] = [
  {
    id: "glm-cn",
    preset: preset("GLM", "cn_official", "https://open.bigmodel.cn", {
      family: "zhipu",
      regionKey: "cn",
    }),
  },
  {
    id: "glm-intl",
    preset: preset("GLM en", "cn_official", "https://z.ai", {
      family: "zhipu",
      regionKey: "intl",
    }),
  },
];

// 两维都变但缺格子（腾讯在 Codex 里多一个只有国内的按量付费）
const tencentPartial: PresetEntry[] = [
  ["tp-cn", "tokenPlan", "cn"],
  ["tp-intl", "tokenPlan", "intl"],
  ["pro-cn", "enterprisePro", "cn"],
  ["pro-intl", "enterprisePro", "intl"],
  ["hunyuan", "payg", "cn"],
].map(([id, planKey, regionKey]) => ({
  id,
  preset: preset(`Tencent ${id}`, "cn_official", "https://cloud.tencent.com", {
    family: "tencent",
    planKey,
    regionKey,
  }),
}));

describe("preset helpers", () => {
  it("groups presets from existing fields without touching category", () => {
    expect(entries.map((entry) => presetGroup(entry.preset))).toEqual([
      "thirdparty",
      "login",
      "vendor",
      "vendor",
      "cloud",
      "login",
      "local",
    ]);
  });

  it("sorts only by name, with Chinese names placed by pinyin initial", () => {
    expect(sortPresetsByName(entries, t).map((entry) => entry.id)).toEqual([
      "alpha",
      "bedrock",
      "gamma",
      "copilot",
      "huoshan",
      "ollama-local",
      "zhipu",
    ]);
  });

  it("searches display names, domains and aliases but not TLDs", () => {
    expect(domainBody("api.gamma.com")).toBe("gamma");
    const ids = (query: string) =>
      entries
        .filter((entry) => presetMatches(entry, query, t))
        .map((entry) => entry.id);
    expect(ids("智谱")).toEqual(["zhipu"]);
    expect(ids("bigmodel")).toEqual(["zhipu"]);
    expect(ids("com")).toEqual([]);
    expect(presetDisplayName(entries[1].preset, t)).toBe("Alpha 本地名");
  });
});

describe("preset families", () => {
  it("merges the versions of one vendor into a single row", () => {
    const rows = groupPresetRows(familyEntries);
    expect(rows).toHaveLength(entries.length + 1);
    const kimi = rows.find((row) => row.family === "kimi");
    // 先按套餐（planOrder），同一套餐里先国内后海外
    expect(kimi?.versions.map((entry) => entry.id)).toEqual([
      "kimi-cn",
      "kimi-intl",
      "kimi-coding",
      "kimi-coding-intl",
    ]);
  });

  it("matches the whole vendor by name, or the versions a query names", () => {
    const hits = (query: string) =>
      getVisiblePresetRows(familyEntries, { query, t }).map(({ row, hits }) => [
        row.key,
        hits,
      ]);
    expect(hits("kimi")).toEqual([["family:kimi", []]]);
    expect(hits("coding")).toEqual([["family:kimi", [2, 3]]]);
    // 带点的词可以命中某个版本自己的完整域名
    expect(hits("kimi.ai")).toEqual([["family:kimi", [1]]]);
    // 别名算整家命中
    expect(hits("moonshot")).toEqual([["family:kimi", []]]);
  });

  it("merges Claude's visible presets into 111 rows", () => {
    const claudeEntries = providerPresets
      .map((item, index) => ({ id: `claude-${index}`, preset: item }))
      .filter((entry) => !entry.preset.hidden);
    expect(groupPresetRows(claudeEntries)).toHaveLength(111);
  });

  it("orders plans and regions as the design does where a family says so", () => {
    const claudeEntries = providerPresets
      .map((item, index) => ({ id: `claude-${index}`, preset: item }))
      .filter((entry) => !entry.preset.hidden);
    const versionsOf = (family: string) =>
      groupPresetRows(claudeEntries)
        .find((row) => row.family === family)
        ?.versions.map((entry) =>
          [entry.preset.planKey, entry.preset.regionKey]
            .filter(Boolean)
            .join("|"),
        );
    expect(versionsOf("kimi")).toEqual([
      "payg|cn",
      "payg|intl",
      "coding|cn",
      "coding|intl",
    ]);
    expect(versionsOf("tencent")).toEqual([
      "tokenPlan|cn",
      "tokenPlan|intl",
      "enterpriseLite|cn",
      "enterpriseLite|intl",
      "enterprisePro|cn",
      "enterprisePro|intl",
    ]);
    // 没写 planOrder 的保持文件顺序
    expect(versionsOf("volcengine")).toEqual([
      "agentPlan",
      "codingPlan",
      "payg",
    ]);
  });

  it("lays out versions by plan × region: segments, a grid or a dropdown", () => {
    const layoutOf = (
      presets: PresetEntry["preset"][],
      family: string,
    ): ReturnType<typeof presetVersionLayout> | undefined => {
      const row = groupPresetRows(
        presets.map((item, index) => ({ id: `p-${index}`, preset: item })),
      ).find((item) => item.family === family);
      return row ? presetVersionLayout(row.versions) : undefined;
    };
    const claude = providerPresets.filter((item) => !item.hidden);

    expect(layoutOf(claude, "kimi")).toEqual({
      kind: "grid",
      plans: ["payg", "coding"],
      regions: ["cn", "intl"],
    });
    expect(layoutOf(claude, "tencent")).toEqual({
      kind: "grid",
      plans: ["tokenPlan", "enterpriseLite", "enterprisePro"],
      regions: ["cn", "intl"],
    });
    // Codex 的腾讯多一个只有国内的混元：不成网格，用下拉
    expect(layoutOf(codexProviderPresets, "tencent")).toEqual({
      kind: "list",
    });
    expect(layoutOf(claude, "volcengine")).toEqual({
      kind: "single",
      dimension: "plan",
    });
    expect(layoutOf(claude, "zhipu")).toEqual({
      kind: "single",
      dimension: "region",
    });
    // 两维都没写：用域名区分
    expect(layoutOf(claude, "sudocode")).toEqual({
      kind: "single",
      dimension: null,
    });
    expect(presetVersionLayout(tencentPartial)).toEqual({ kind: "list" });
    expect(presetVersionLayout(zhipuFamily)).toEqual({
      kind: "single",
      dimension: "region",
    });
  });

  it("splits the all view into category sections, skipping empty ones", () => {
    const sections = (query: string) =>
      sectionPresetRows(getVisiblePresetRows(familyEntries, { query, t })).map(
        (section) => [section.group, section.items.map(({ row }) => row.key)],
      );
    expect(sections("")).toEqual([
      ["login", ["alpha", "copilot"]],
      ["vendor", ["huoshan", "family:kimi", "zhipu"]],
      ["thirdparty", ["gamma"]],
      ["cloud", ["bedrock"]],
      ["local", ["ollama-local"]],
    ]);
    expect(sections("gamma")).toEqual([["thirdparty", ["gamma"]]]);
  });

  it("has every family name and version label in all three locales", () => {
    const lookup = (data: unknown, key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          data,
        );
    const keys = [
      "providerPreset.versionLabel",
      "providerPreset.planLabel",
      "providerPreset.regionLabel",
      ...PRESET_PLAN_KEYS.map((key) => `providerPreset.plan.${key}`),
      ...PRESET_REGION_KEYS.map((key) => `providerPreset.region.${key}`),
      ...Object.values(PRESET_FAMILIES).flatMap((info) =>
        "nameKey" in info ? [info.nameKey] : [],
      ),
    ];
    for (const locale of [zh, en, ja]) {
      for (const key of keys) {
        expect(typeof lookup(locale, key), key).toBe("string");
      }
    }
  });

  it("has a label and a hint for every category in all three locales", () => {
    for (const [name, locale] of Object.entries({ zh, en, ja })) {
      const { group, groupHint } = locale.providerPreset as unknown as Record<
        "group" | "groupHint",
        Record<string, unknown>
      >;
      for (const key of PRESET_GROUP_ORDER) {
        expect(typeof group[key], `${name} group.${key}`).toBe("string");
        expect(typeof groupHint[key], `${name} groupHint.${key}`).toBe(
          "string",
        );
      }
    }
  });
});

describe("login presets and local inference", () => {
  it("puts account sign-in presets in the login group with the right account", () => {
    expect(presetGroup(dshAccountPreset)).toBe("login");
    expect(loginAccountKey("dsh", dshAccountPreset)).toBe("deepseek");
    expect(presetGroup(kimiAccountPreset)).toBe("login");
    expect(loginAccountKey("kimi", kimiAccountPreset)).toBe("kimi");
    expect(loginAccountKey("agy", kimiAccountPreset)).toBe("google");
    expect(loginAccountKey("codex", kimiAccountPreset)).toBe("chatgpt");
    expect(loginAccountKey("claude", kimiAccountPreset)).toBe("claude");
    for (const locale of [zh, en, ja]) {
      const loginWith = locale.providerPreset.loginWith as Record<
        string,
        string
      >;
      expect(loginWith.deepseek).toContain("DeepSeek");
      expect(loginWith.google).toContain("Google");
    }
  });

  it("collects the local inference presets into the local group", () => {
    for (const presets of [
      providerPresets,
      codexProviderPresets,
      opencodeProviderPresets,
    ]) {
      const local = presets.filter(
        (item) => (item as { category?: string }).category === "local",
      );
      expect(local.length).toBeGreaterThan(0);
      for (const item of local) {
        expect(presetGroup(item)).toBe("local");
      }
    }
  });
});
