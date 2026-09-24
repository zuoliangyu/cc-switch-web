import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeFormFields } from "@/components/providers/forms/ClaudeFormFields";
import { Form } from "@/components/ui/form";

const modelFetchApiMock = vi.hoisted(() => ({
  fetchModelsForConfig: vi.fn(),
  showFetchModelsError: vi.fn(),
}));

vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: modelFetchApiMock.fetchModelsForConfig,
  showFetchModelsError: modelFetchApiMock.showFetchModelsError,
}));

vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => <div data-testid="copilot-auth-section" />,
}));

vi.mock("@/components/providers/forms/CodexOAuthSection", () => ({
  CodexOAuthSection: () => <div data-testid="codex-oauth-section" />,
}));

type ClaudeFormFieldsProps = ComponentProps<typeof ClaudeFormFields>;

const FormShell = ({ children }: PropsWithChildren) => {
  const form = useForm();

  return <Form {...form}>{children}</Form>;
};

const renderForm = (overrides: Partial<ClaudeFormFieldsProps> = {}) => {
  const props: ClaudeFormFieldsProps = {
    shouldShowApiKey: false,
    apiKey: "",
    onApiKeyChange: vi.fn(),
    category: "custom",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    isCopilotPreset: false,
    usesOAuth: false,
    templateValueEntries: [],
    templateValues: {},
    templatePresetName: "",
    onTemplateValueChange: vi.fn(),
    shouldShowSpeedTest: false,
    baseUrl: "https://api.example.com",
    onBaseUrlChange: vi.fn(),
    isEndpointModalOpen: false,
    onEndpointModalToggle: vi.fn(),
    onCustomEndpointsChange: vi.fn(),
    autoSelect: false,
    onAutoSelectChange: vi.fn(),
    shouldShowModelSelector: true,
    claudeModel: "",
    defaultHaikuModel: "",
    defaultHaikuModelName: "",
    defaultSonnetModel: "claude-sonnet",
    defaultSonnetModelName: "Claude Sonnet",
    defaultOpusModel: "",
    defaultOpusModelName: "",
    defaultFableModel: "",
    defaultFableModelName: "",
    subagentModel: "",
    onModelChange: vi.fn(),
    speedTestEndpoints: [],
    apiFormat: "anthropic",
    onApiFormatChange: vi.fn(),
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    onApiKeyFieldChange: vi.fn(),
    isFullUrl: false,
    onFullUrlChange: vi.fn(),
    customUserAgent: "",
    onCustomUserAgentChange: vi.fn(),
    localProxyHeadersOverride: "",
    onLocalProxyHeadersOverrideChange: vi.fn(),
    localProxyBodyOverride: "",
    onLocalProxyBodyOverrideChange: vi.fn(),
    ...overrides,
  };

  return render(
    <FormShell>
      <ClaudeFormFields {...props} />
    </FormShell>,
  );
};

const quickSetButton = () =>
  screen.getByRole("button", {
    name: "一键设置",
  });

describe("ClaudeFormFields role-based model mapping", () => {
  beforeEach(() => {
    modelFetchApiMock.fetchModelsForConfig.mockResolvedValue([]);
  });

  // 上游 b3e5e32c / 4b57f7e1
  it("一键设置会同时写入 Subagent 模型", () => {
    const onModelChange = vi.fn();
    renderForm({
      claudeModel: "shared-model[1M]",
      defaultSonnetModel: "",
      defaultSonnetModelName: "",
      onModelChange,
    });

    fireEvent.click(quickSetButton());

    expect(onModelChange).toHaveBeenCalledWith(
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "shared-model[1M]",
    );
    // Haiku 不支持 1M：写入前剥离标记
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "shared-model",
    );
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      "shared-model",
    );
  });

  // 上游 5c053626：按面板从上到下取值，默认兜底模型最后使用
  it("一键设置优先使用 Sonnet，而不是默认兜底模型", () => {
    const onModelChange = vi.fn();
    renderForm({
      claudeModel: "fallback-model",
      defaultSonnetModel: "sonnet-model",
      onModelChange,
    });

    fireEvent.click(quickSetButton());

    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "sonnet-model",
    );
    expect(onModelChange).not.toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "fallback-model",
    );
  });

  it("勾选 1M 会在角色模型后追加标记", () => {
    const onModelChange = vi.fn();
    renderForm({ onModelChange });

    const checkboxes = screen.getAllByRole("checkbox");
    // 行序：Sonnet、Opus、Fable、Subagent（Haiku 无 1M），最后是兜底模型
    fireEvent.click(checkboxes[0]);

    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "claude-sonnet[1M]",
    );
  });

  it("显示名称跟随模型修改，除非用户已自定义", () => {
    const onModelChange = vi.fn();
    renderForm({
      defaultSonnetModel: "old-model",
      defaultSonnetModelName: "old-model",
      defaultOpusModel: "opus-model",
      defaultOpusModelName: "My Opus",
      onModelChange,
    });

    fireEvent.change(
      document.getElementById("claudeDefaultSonnetModel") as HTMLInputElement,
      { target: { value: "new-model" } },
    );
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      "new-model",
    );

    onModelChange.mockClear();
    fireEvent.change(
      document.getElementById("claudeDefaultOpusModel") as HTMLInputElement,
      { target: { value: "opus-next" } },
    );
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "opus-next",
    );
    expect(onModelChange).not.toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
      expect.anything(),
    );
  });
});
