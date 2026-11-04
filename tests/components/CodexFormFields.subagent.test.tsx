import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";

vi.mock("@/hooks/useModelMetadataFill", () => ({
  useModelMetadataFill: () => () => {},
}));
vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => null,
}));

type Props = ComponentProps<typeof CodexFormFields>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    codexApiKey: "sk-test",
    onApiKeyChange: vi.fn(),
    category: "third_party",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    shouldShowSpeedTest: false,
    codexBaseUrl: "https://api.example.com",
    onBaseUrlChange: vi.fn(),
    isFullUrl: false,
    onFullUrlChange: vi.fn(),
    isEndpointModalOpen: false,
    onEndpointModalToggle: vi.fn(),
    autoSelect: false,
    onAutoSelectChange: vi.fn(),
    modelName: "gpt-a",
    onModelNameChange: vi.fn(),
    apiFormat: "openai_responses",
    onApiFormatChange: vi.fn(),
    promptCacheRouting: "auto",
    onPromptCacheRoutingChange: vi.fn(),
    catalogModels: [],
    onCatalogModelsChange: vi.fn(),
    speedTestEndpoints: [],
    customUserAgent: "",
    onCustomUserAgentChange: vi.fn(),
    localProxyHeadersOverride: "",
    onLocalProxyHeadersOverrideChange: vi.fn(),
    localProxyBodyOverride: "",
    onLocalProxyBodyOverrideChange: vi.fn(),
    subagentModel: "",
    onSubagentModelChange: vi.fn(),
    subagentReasoningEffort: "",
    onSubagentReasoningEffortChange: vi.fn(),
    autoReviewModel: "",
    onAutoReviewModelChange: vi.fn(),
    ...overrides,
  };
}

function Harness(props: Props) {
  const form = useForm();
  return (
    <FormProvider {...form}>
      <CodexFormFields {...props} />
    </FormProvider>
  );
}

function renderForm(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides);
  render(<Harness {...props} />);
  return props;
}

const subagentInput = () =>
  document.getElementById("codexSubagentModel") as HTMLInputElement | null;
const autoReviewTrigger = () =>
  document.getElementById("codexAutoReviewModel") as HTMLButtonElement | null;

describe("CodexFormFields 子代理与自动审批", () => {
  it("子代理模型经回调写回", () => {
    const props = renderForm();
    fireEvent.change(subagentInput()!, { target: { value: "gpt-a-mini" } });
    expect(props.onSubagentModelChange).toHaveBeenCalledWith("gpt-a-mini");
  });

  it("官方卡不显示这两个字段", () => {
    renderForm({ category: "official" });
    expect(subagentInput()).toBeNull();
    expect(autoReviewTrigger()).toBeNull();
  });

  it("Chat 协议下子代理模型不在映射里时提示，并能连同默认模型一起加进映射", () => {
    const onCatalogModelsChange = vi.fn();
    renderForm({
      apiFormat: "openai_chat",
      subagentModel: "k3-mini",
      catalogModels: [],
      onCatalogModelsChange,
    });
    expect(
      screen.getByText("codexConfig.subagentModelNotInCatalog"),
    ).toBeInTheDocument();
    onCatalogModelsChange.mockClear();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "codexConfig.addToModelList",
      })[0],
    );
    const rows = onCatalogModelsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(rows.map((row: { model: string }) => row.model)).toEqual([
      "gpt-a",
      "k3-mini",
    ]);
  });

  it("原生 Responses、没有映射时不提示", () => {
    renderForm({ subagentModel: "k3-mini" });
    expect(
      screen.queryByText("codexConfig.subagentModelNotInCatalog"),
    ).toBeNull();
  });

  it("自动审批模型只能选映射里的；没有映射时不可选并说明 Codex 默认", () => {
    renderForm();
    expect(autoReviewTrigger()).toBeDisabled();
    expect(
      screen.getByText("codexConfig.autoReviewModelNoList"),
    ).toBeInTheDocument();
  });

  it("有映射时显示已存的审批模型，默认项按映射里有没有 codex-auto-review 区分", () => {
    renderForm({
      catalogModels: [
        { model: "deepseek-v4-pro", displayName: "Pro" },
        { model: "deepseek-v4-flash", displayName: "Flash" },
      ],
      autoReviewModel: "deepseek-v4-flash",
    });
    expect(autoReviewTrigger()).not.toBeDisabled();
    expect(autoReviewTrigger()).toHaveTextContent("Flash");
    // 说明在字段名后的「?」里；有列表时不再提示「没有模型列表」（上游 36e2ce2c）
    expect(
      screen.getByRole("button", { name: "codexConfig.autoReviewModelLabel" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("codexConfig.autoReviewModelNoList")).toBeNull();
  });
});

// 上游 a9e607c3：子代理并发上限（Codex 的全局设置，官方卡也显示）
const maxThreadsInput = () =>
  document.getElementById("codexAgentMaxThreads") as HTMLInputElement | null;

describe("CodexFormFields sub-agent concurrency limit", () => {
  it("shows the value and writes the typed text through the handler", () => {
    const onAgentMaxThreadsChange = vi.fn();
    renderForm({ agentMaxThreads: "8", onAgentMaxThreadsChange });
    expect(maxThreadsInput()!.value).toBe("8");

    fireEvent.change(maxThreadsInput()!, { target: { value: "12" } });
    expect(onAgentMaxThreadsChange).toHaveBeenCalledWith("12");
  });

  it("is shown for the official card too: it is a Codex-wide setting", () => {
    renderForm({ category: "official", onAgentMaxThreadsChange: vi.fn() });
    expect(maxThreadsInput()).not.toBeNull();
    expect(subagentInput()).toBeNull();
  });

  it("is hidden when the caller gives no handler", () => {
    renderForm();
    expect(maxThreadsInput()).toBeNull();
  });

  it("points out a multi_agent_v2 total that takes precedence", () => {
    renderForm({ multiAgentV2Total: 5, onAgentMaxThreadsChange: vi.fn() });
    expect(
      screen.getByText("codexConfig.agentMaxThreadsV2Override"),
    ).toBeTruthy();
  });
});

const rowModels = () =>
  screen
    .getAllByPlaceholderText("codexConfig.catalogModelPlaceholder")
    .map((input) => (input as HTMLInputElement).value);
const defaultModelInput = () =>
  document.getElementById("codexModelName") as HTMLInputElement | null;

// 上游 0dae89e2 / 9f7ac1fa：模型列表在高级选项外面，第一行就是默认模型
describe("CodexFormFields 模型列表与默认模型", () => {
  it("有列表时由列表决定默认模型：没有单独的默认模型框，列表不在高级选项里", () => {
    renderForm({ catalogModels: [{ model: "gpt-a" }] });
    expect(screen.getByText("codexConfig.modelListTitle")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "codexConfig.modelListTitle" }),
    ).toBeVisible();
    expect(defaultModelInput()).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /providerForm\.fetchModels/ }),
    ).toHaveLength(1);
  });

  it("列表为空时默认模型框在列表下面，加第一行时用当前默认模型打底", () => {
    const onCatalogModelsChange = vi.fn();
    renderForm({ catalogModels: [], onCatalogModelsChange });
    const listTitle = screen.getByText("codexConfig.modelListTitle");
    expect(
      listTitle.compareDocumentPosition(defaultModelInput()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "codexConfig.addCatalogModel" }),
    );
    expect(rowModels()).toEqual(["gpt-a", ""]);
    expect(defaultModelInput()).toBeNull();
    const rows = onCatalogModelsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(rows.map((row: { model: string }) => row.model)).toEqual([
      "gpt-a",
      "",
    ]);
  });

  it("旧卡的默认模型不在第一行时排到最前面显示，不算修改", () => {
    const onCatalogModelsChange = vi.fn();
    renderForm({
      modelName: "gpt-b",
      catalogModels: [{ model: "gpt-a" }, { model: "gpt-b" }],
      onCatalogModelsChange,
    });
    expect(rowModels()).toEqual(["gpt-b", "gpt-a"]);
    expect(onCatalogModelsChange).not.toHaveBeenCalled();
  });

  it("改第一行的模型、删掉第一行时默认模型跟着变", () => {
    const props = renderForm({
      catalogModels: [{ model: "gpt-a" }, { model: "gpt-b" }],
    });
    fireEvent.change(
      screen.getAllByPlaceholderText("codexConfig.catalogModelPlaceholder")[0],
      { target: { value: "gpt-c" } },
    );
    expect(props.onModelNameChange).toHaveBeenLastCalledWith("gpt-c");
  });

  it("没有列表时（Grok Build）保留默认模型框和它的获取按钮", () => {
    renderForm({ onCatalogModelsChange: undefined });
    expect(screen.queryByText("codexConfig.modelListTitle")).toBeNull();
    expect(defaultModelInput()).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    ).toBeInTheDocument();
  });
});

// 上游 36e2ce2c / 1e045d2e / e615a6f4：说明进「?」，完整 URL 在高级选项里，按实际模式提示后果
describe("CodexFormFields 说明与提示", () => {
  it("字段说明收进「?」，后果提示留在页面上", () => {
    renderForm({
      apiFormat: "openai_chat",
      shouldShowSpeedTest: true,
      directModeFormatNotice: "inUse",
    });
    for (const name of [
      "codexConfig.apiUrlLabel",
      "codexConfig.defaultModelLabel",
      "codexConfig.subagentModelLabel",
      "codexConfig.upstreamFormatLabel",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // 完整 URL 开关在高级选项里，说明在它的「?」里
    expect(
      screen.getByRole("switch", { name: "完整 URL" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "完整 URL" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("providerForm.directModeFormatInUse"),
    ).toBeVisible();
    expect(screen.getByText("codexConfig.routeOnlySettingsHint")).toBeVisible();
  });

  it("不在直连或格式不需转换时不提示", () => {
    renderForm({ apiFormat: "openai_chat", shouldShowSpeedTest: true });
    expect(screen.queryByText("providerForm.directModeFormatInUse")).toBeNull();
    expect(
      screen.queryByText("providerForm.directModeFormatSwitch"),
    ).toBeNull();
  });
});
