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
    const onCatalogEnabledChange = vi.fn();
    renderForm({
      apiFormat: "openai_chat",
      subagentModel: "k3-mini",
      catalogModels: [],
      onCatalogModelsChange,
      onCatalogEnabledChange,
    });
    expect(
      screen.getByText("codexConfig.subagentModelNotInCatalog"),
    ).toBeInTheDocument();
    onCatalogModelsChange.mockClear();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "codexConfig.addToModelMapping",
      })[0],
    );
    const rows = onCatalogModelsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(rows.map((row: { model: string }) => row.model)).toEqual([
      "gpt-a",
      "k3-mini",
    ]);
    expect(onCatalogEnabledChange).toHaveBeenCalledWith(true);
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
      catalogEnabled: true,
      catalogModels: [
        { model: "deepseek-v4-pro", displayName: "Pro" },
        { model: "deepseek-v4-flash", displayName: "Flash" },
      ],
      autoReviewModel: "deepseek-v4-flash",
    });
    expect(autoReviewTrigger()).not.toBeDisabled();
    expect(autoReviewTrigger()).toHaveTextContent("Flash");
    expect(
      screen.getByText("codexConfig.autoReviewModelHint"),
    ).toBeInTheDocument();
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
