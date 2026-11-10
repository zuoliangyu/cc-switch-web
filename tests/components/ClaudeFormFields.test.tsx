import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  modelFetchRequestHeaders: () => undefined,
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
    reasoningEffort: "auto",
    onReasoningEffortChange: vi.fn(),
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
  // 上游 cd15a164：Genesis 预设地址按预设的 modelsUrl 只拉对话模型
  it("Genesis 使用当前 Key 拉取可用对话模型", async () => {
    renderForm({
      category: "aggregator",
      shouldShowApiKey: true,
      apiKey: "test-key",
      baseUrl: "https://token.moi.matrixorigin.cn",
    });

    fireEvent.click(
      screen.getAllByRole("button", { name: "providerForm.fetchModels" })[0],
    );

    await waitFor(() => {
      expect(modelFetchApiMock.fetchModelsForConfig).toHaveBeenCalledWith(
        "https://token.moi.matrixorigin.cn",
        "test-key",
        false,
        "https://token.moi.matrixorigin.cn/v1/models?type=chat",
        "",
        { requestHeaders: undefined },
      );
    });
  });

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
    // Haiku 也保留 1M 标记（上游 3d46e06c）
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "shared-model[1M]",
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
    // 行序：Sonnet、Opus、Fable、Haiku、Subagent，最后是兜底模型
    fireEvent.click(checkboxes[0]);

    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "claude-sonnet[1M]",
    );
  });

  // 上游 3d46e06c
  it("Haiku 行也能勾 1M：勾选状态即模型名的 [1M] 后缀", () => {
    const onModelChange = vi.fn();
    renderForm({
      defaultHaikuModel: "glm-5.3-flash[1M]",
      defaultHaikuModelName: "",
      onModelChange,
    });

    const haikuRow = screen.getByText("Haiku").parentElement!;
    expect(within(haikuRow).getByDisplayValue("glm-5.3-flash")).toBeTruthy();
    const checkbox = within(haikuRow).getByRole("checkbox");
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(onModelChange).toHaveBeenCalledWith(
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "glm-5.3-flash",
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

// 上游 2122f7da：只在转成 OpenAI 格式时显示思考档位
describe("ClaudeFormFields reasoning effort", () => {
  beforeEach(() => {
    modelFetchApiMock.fetchModelsForConfig.mockResolvedValue([]);
  });

  it("只在转成 OpenAI 格式时显示思考档位", () => {
    const { unmount } = renderForm({ apiFormat: "openai_chat" });
    expect(screen.getByRole("combobox", { name: "思考档位" })).toBeVisible();
    unmount();

    renderForm({ apiFormat: "anthropic" });
    expect(screen.queryByRole("combobox", { name: "思考档位" })).toBeNull();
  });

  it("Copilot 卡不显示思考档位", () => {
    renderForm({ apiFormat: "openai_chat", isCopilotPreset: true });
    expect(screen.queryByRole("combobox", { name: "思考档位" })).toBeNull();
  });
});

// 上游 bd50984e：Copilot 的上游格式由路由按模型自动选，手选格式禁用并说明
describe("ClaudeFormFields Copilot protocol", () => {
  beforeEach(() => {
    modelFetchApiMock.fetchModelsForConfig.mockResolvedValue([]);
  });

  it("shows the automatic protocol and disables the manual format", () => {
    renderForm({
      apiFormat: "openai_responses",
      isCopilotPreset: true,
      usesOAuth: true,
    });

    expect(screen.getByText("copilot.automaticFormatHint")).toBeVisible();
    // 非 Anthropic 格式时高级选项默认展开
    if (!document.getElementById("apiFormat")) {
      fireEvent.click(
        screen.getByRole("button", {
          name: /providerForm.advancedOptionsToggle/,
        }),
      );
    }
    const control = document.getElementById("apiFormat");
    expect(control).toBeDisabled();
    expect(control).toHaveTextContent("copilot.automaticFormat");
  });
});
