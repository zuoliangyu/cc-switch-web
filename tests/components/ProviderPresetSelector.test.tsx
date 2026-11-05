import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import type { ProviderCategory } from "@/types";
import type { AppId } from "@/lib/api";
import {
  ProviderPresetSelector,
  filterPresetEntries,
  getPresetDisplayName,
  getVisiblePresetEntries,
  type PresetEntry,
} from "@/components/providers/forms/ProviderPresetSelector";
import {
  PresetStepContext,
  type PresetStepState,
} from "@/components/providers/forms/presetStep";
import {
  dshAccountPreset,
  DSH_ACCOUNT_PRESET_ID,
} from "@/config/dshProviderPresets";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";

// 逻辑层（分组、合并行、版本布局、分节、三语文案）的用例在 presetGroups.test.ts；
// 这里是选择器界面（两步选择、预设条、版本切换）与 Web 的展示约束。

vi.mock("@/components/ProviderIcon", () => ({
  ProviderIcon: ({ name }: { name: string }) => (
    <span data-testid="provider-icon" data-name={name} />
  ),
}));

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

function TwoSteps({
  onPresetChange,
  presetEntries = entries,
  appId = "claude",
}: {
  onPresetChange: (id: string) => void;
  presetEntries?: PresetEntry[];
  appId?: AppId;
}) {
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>("custom");
  // 表单的替身：选预设时程序重填（清空 Key），用户可以手动输入
  const [apiKey, setApiKey] = useState("");
  const state: PresetStepState = {
    appId,
    step,
    setStep,
    host,
    registerSelector: () => () => undefined,
  };
  return (
    <PresetStepContext.Provider value={state}>
      {step === "pick" && <div data-testid="host" ref={setHost} />}
      <form>
        <ProviderPresetSelector
          selectedPresetId={selected}
          presetEntries={presetEntries}
          onPresetChange={(id) => {
            setSelected(id);
            setApiKey("");
            onPresetChange(id);
          }}
        />
        {step === "form" && (
          <input
            aria-label="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
      </form>
    </PresetStepContext.Provider>
  );
}

describe("ProviderPresetSelector", () => {
  beforeAll(() => {
    // Radix Select 打开时会滚动到选中项，jsdom 没有 scrollIntoView
    Element.prototype.scrollIntoView ??= vi.fn();
    // jsdom 也没有指针捕获，Radix Select 的触发器要用
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.releasePointerCapture ??= vi.fn();
  });

  it("picks a preset in step 1, then shows a preset bar that goes back", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(<TwoSteps onPresetChange={onPresetChange} />);

    const host = await screen.findByTestId("host");
    // 自定义配置固定第一行；其余按分类分段（账号登录 → 模型厂商 → 第三方平台 → 云服务商 → 本地），段内按名称
    const rows = within(host)
      .getAllByRole("button")
      .filter((button) => !button.hasAttribute("aria-pressed"));
    expect(rows[0]).toHaveTextContent("providerPreset.custom");
    expect(
      within(host)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual([
      "providerPreset.group.login",
      "providerPreset.group.vendor",
      "providerPreset.group.thirdparty",
      "providerPreset.group.cloud",
      "providerPreset.group.local",
    ]);
    const login = within(host).getByRole("region", {
      name: "providerPreset.group.login",
    });
    expect(
      within(login)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["GitHub Copilot", "preset.alpha"]);
    expect(
      within(
        within(host).getByRole("region", {
          name: "providerPreset.group.cloud",
        }),
      ).getByRole("button", { name: "AWS Bedrock" }),
    ).toBeInTheDocument();

    await user.click(within(host).getByText("preset.zhipu"));
    expect(onPresetChange).toHaveBeenCalledWith("zhipu");
    expect(screen.queryByTestId("host")).not.toBeInTheDocument();
    expect(screen.getByText("open.bigmodel.cn")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "providerPreset.change" }),
    );
    expect(await screen.findByTestId("host")).toBeInTheDocument();
  });

  it("shows the DeepSeek account subtitle for the DSH official preset", async () => {
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        appId="dsh"
        onPresetChange={onPresetChange}
        presetEntries={[
          { id: DSH_ACCOUNT_PRESET_ID, preset: dshAccountPreset },
        ]}
      />,
    );
    const host = await screen.findByTestId("host");
    expect(
      within(host).getByText("providerPreset.loginWith.deepseek"),
    ).toBeInTheDocument();
    expect(
      within(host).queryByText("providerPreset.loginWith.claude"),
    ).not.toBeInTheDocument();
    for (const locale of [zh, en, ja]) {
      expect(
        (locale.providerPreset.loginWith as Record<string, string>).deepseek,
      ).toContain("DeepSeek");
    }
    await userEvent
      .setup()
      .click(
        within(host).getByRole("button", { name: "dsh.account.presetName" }),
      );
    expect(onPresetChange).toHaveBeenCalledWith(DSH_ACCOUNT_PRESET_ID);
  });

  it("filters by category and keeps the search text when clicking around", async () => {
    const user = userEvent.setup();
    render(<TwoSteps onPresetChange={vi.fn()} />);
    const host = await screen.findByTestId("host");

    await user.click(
      within(host).getByRole("button", { name: /providerPreset.group.login/ }),
    );
    expect(within(host).getByText("GitHub Copilot")).toBeInTheDocument();
    expect(within(host).queryByText("Gamma")).not.toBeInTheDocument();
    expect(
      within(host).getByText("providerPreset.loginWith.github"),
    ).toBeInTheDocument();

    const search = within(host).getByRole("textbox", {
      name: "providerPreset.searchAriaLabel",
    });
    await user.type(search, "zzz");
    await user.click(document.body);
    expect(search).toHaveValue("zzz");
    expect(
      within(host).getByText("providerPreset.noResults"),
    ).toBeInTheDocument();
  });

  it("picks the first version of a merged row, then switches plan and region in the bar", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        onPresetChange={onPresetChange}
        presetEntries={familyEntries}
      />,
    );
    const host = await screen.findByTestId("host");

    expect(within(host).getAllByText("Kimi")).toHaveLength(1);
    expect(
      within(host).getByText("providerPreset.versionCount"),
    ).toBeInTheDocument();
    await user.click(within(host).getByRole("button", { name: "Kimi" }));
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-cn");

    // 完整网格：套餐一组、地区一组
    const plans = () =>
      within(
        screen.getByRole("group", { name: "providerPreset.planLabel" }),
      ).getAllByRole("button");
    const regions = () =>
      within(
        screen.getByRole("group", { name: "providerPreset.regionLabel" }),
      ).getAllByRole("button");
    expect(plans().map((button) => button.textContent)).toEqual([
      "providerPreset.plan.payg",
      "providerPreset.plan.coding",
    ]);
    expect(regions().map((button) => button.textContent)).toEqual([
      "providerPreset.region.cn",
      "providerPreset.region.intl",
    ]);
    expect(
      screen.queryByRole("group", { name: "providerPreset.versionLabel" }),
    ).not.toBeInTheDocument();
    expect(plans()[0]).toHaveAttribute("aria-pressed", "true");
    expect(regions()[0]).toHaveAttribute("aria-pressed", "true");

    await user.click(regions()[1]);
    // 没手动改过表单：直接切，不弹确认
    expect(
      screen.queryByText("providerPreset.switchVersionTitle"),
    ).not.toBeInTheDocument();
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-intl");
    // 换版本留在第 2 步
    expect(screen.queryByTestId("host")).not.toBeInTheDocument();
    expect(regions()[1]).toHaveAttribute("aria-pressed", "true");

    // 切套餐时地区保持海外
    await user.click(plans()[1]);
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-coding-intl");
    expect(plans()[1]).toHaveAttribute("aria-pressed", "true");
    expect(regions()[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("uses one segmented control, labelled by the dimension that changes", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        onPresetChange={onPresetChange}
        presetEntries={[...entries.slice(0, 1), ...zhipuFamily]}
      />,
    );
    const host = await screen.findByTestId("host");
    await user.click(within(host).getByRole("button", { name: "Zhipu GLM" }));
    expect(onPresetChange).toHaveBeenLastCalledWith("glm-cn");

    const versions = screen.getByRole("group", {
      name: "providerPreset.versionLabel",
    });
    expect(
      within(versions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["providerPreset.region.cn", "providerPreset.region.intl"]);
    expect(
      screen.queryByRole("group", { name: "providerPreset.planLabel" }),
    ).not.toBeInTheDocument();
    await user.click(within(versions).getAllByRole("button")[1]);
    expect(onPresetChange).toHaveBeenLastCalledWith("glm-intl");
  });

  it("falls back to a dropdown when plans and regions do not form a grid", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        onPresetChange={onPresetChange}
        presetEntries={[...entries.slice(0, 1), ...tencentPartial]}
      />,
    );
    const host = await screen.findByTestId("host");
    await user.click(
      within(host).getByRole("button", {
        name: "providerPreset.family.tencent",
      }),
    );
    expect(onPresetChange).toHaveBeenLastCalledWith("tp-cn");
    expect(
      screen.queryByRole("group", { name: "providerPreset.planLabel" }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole("combobox", {
      name: "providerPreset.versionLabel",
    });
    expect(trigger).toHaveTextContent(
      "providerPreset.plan.tokenPlan · providerPreset.region.cn",
    );
    await user.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "providerPreset.plan.tokenPlan · providerPreset.region.cn",
      "providerPreset.plan.tokenPlan · providerPreset.region.intl",
      "providerPreset.plan.enterprisePro · providerPreset.region.cn",
      "providerPreset.plan.enterprisePro · providerPreset.region.intl",
      "providerPreset.plan.payg · providerPreset.region.cn",
    ]);
    await user.click(options[4]);
    expect(onPresetChange).toHaveBeenLastCalledWith("hunyuan");
  });

  it("asks before switching versions once the form was edited", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        onPresetChange={onPresetChange}
        presetEntries={familyEntries}
      />,
    );
    const host = await screen.findByTestId("host");
    await user.click(within(host).getByRole("button", { name: "Kimi" }));
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-cn");
    onPresetChange.mockClear();

    const plans = () =>
      within(
        screen.getByRole("group", { name: "providerPreset.planLabel" }),
      ).getAllByRole("button");
    const regions = () =>
      within(
        screen.getByRole("group", { name: "providerPreset.regionLabel" }),
      ).getAllByRole("button");

    await user.type(screen.getByLabelText("api-key"), "sk-typed");
    await user.click(plans()[1]);
    expect(
      await screen.findByText("providerPreset.switchVersionTitle"),
    ).toBeInTheDocument();
    expect(onPresetChange).not.toHaveBeenCalled();

    // 取消：不切，Key 还在
    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByText("providerPreset.switchVersionTitle"),
      ).not.toBeInTheDocument(),
    );
    expect(onPresetChange).not.toHaveBeenCalled();
    expect(plans()[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("api-key")).toHaveValue("sk-typed");

    // 确认：切过去、表单重填；重填之后再切不用确认
    await user.click(plans()[1]);
    await user.click(
      await screen.findByRole("button", {
        name: "providerPreset.switchVersionConfirm",
      }),
    );
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-coding");
    expect(screen.getByLabelText("api-key")).toHaveValue("");
    await user.click(regions()[1]);
    expect(
      screen.queryByText("providerPreset.switchVersionTitle"),
    ).not.toBeInTheDocument();
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-coding-intl");
  });

  it("selects the version a search matched", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(
      <TwoSteps
        onPresetChange={onPresetChange}
        presetEntries={familyEntries}
      />,
    );
    const host = await screen.findByTestId("host");

    await user.type(
      within(host).getByRole("textbox", {
        name: "providerPreset.searchAriaLabel",
      }),
      "coding",
    );
    // 命中两个编程订阅版本，选中第一个
    expect(
      within(host).getByText("providerPreset.matchedVersions"),
    ).toBeInTheDocument();
    await user.click(within(host).getByRole("button", { name: "Kimi" }));
    expect(onPresetChange).toHaveBeenLastCalledWith("kimi-coding");
  });

  it("offers the custom config when nothing matches", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(<TwoSteps onPresetChange={onPresetChange} />);
    const host = await screen.findByTestId("host");

    await user.type(
      within(host).getByRole("textbox", {
        name: "providerPreset.searchAriaLabel",
      }),
      "nothing-here",
    );
    await user.click(
      within(host).getByRole("button", { name: "providerPreset.useCustom" }),
    );
    await waitFor(() => expect(onPresetChange).toHaveBeenCalledWith("custom"));
  });
});

describe("preset display helpers", () => {
  it("uses the translated name and finds Tu-zi by Chinese and compact aliases", () => {
    expect(getPresetDisplayName(entries[1].preset, t)).toBe("Alpha 本地名");
    expect(getPresetDisplayName(entries[0].preset, t)).toBe("Gamma");
    const tuzi = [
      {
        id: "tuzi",
        preset: preset("Tu-zi", "third_party", "https://api.tu-zi.com"),
      },
    ];
    for (const query of ["兔子", "兔子api", "tuzi"]) {
      expect(filterPresetEntries(tuzi, query, t)).toEqual(tuzi);
    }
  });

  it("ignores sponsor and partner flags when ordering and shows no badges", async () => {
    const sponsored: PresetEntry[] = [
      {
        id: "zulu",
        preset: preset("Zulu Partner", "third_party", "https://zulu.example", {
          isPartner: true,
          primePartner: true,
        }),
      },
      {
        id: "alpha",
        preset: preset("Alpha Plain", "third_party", "https://alpha.example"),
      },
    ];
    expect(
      getVisiblePresetEntries(sponsored, { query: "", t }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["alpha", "zulu"]);

    render(<TwoSteps onPresetChange={vi.fn()} presetEntries={sponsored} />);
    const host = await screen.findByTestId("host");
    const section = within(host).getByRole("region", {
      name: "providerPreset.group.thirdparty",
    });
    const rows = within(section).getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Alpha Plain",
      "Zulu Partner",
    ]);
    expect(rows[0].className).toBe(rows[1].className);
    expect(host.querySelector(".lucide-star, .lucide-heart")).toBeNull();
    expect(
      within(host).queryByText(/providerPreset\.(partner|primePartner)/),
    ).not.toBeInTheDocument();
  });
});
