import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";

const fetchXaiOauthModelsMock = vi.hoisted(() => vi.fn());
const fetchModelsForConfigMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/form", () => ({
  FormLabel: ({ children }: { children: ReactNode }) => (
    <label>{children}</label>
  ),
}));

vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: fetchModelsForConfigMock,
  fetchXaiOauthModels: fetchXaiOauthModelsMock,
  showFetchModelsError: vi.fn(),
}));

vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: ({ selectedAccountId }: { selectedAccountId?: string }) => (
    <div data-testid="xai-oauth-account">{selectedAccountId}</div>
  ),
}));

vi.mock("@/components/providers/forms/shared", () => ({
  ApiKeySection: () => <div data-testid="api-key-field" />,
  EndpointField: () => <div data-testid="endpoint-field" />,
  ModelInputWithFetch: ({ fetchedModels }: { fetchedModels: unknown[] }) => (
    <div
      data-testid="model-field"
      data-models={JSON.stringify(fetchedModels)}
    />
  ),
}));

function renderXaiOauthFields() {
  render(
    <CodexFormFields
      isXaiOauthPreset
      isXaiOauthAuthenticated
      selectedXaiAccountId="xai-account"
      codexApiKey=""
      onApiKeyChange={vi.fn()}
      category="third_party"
      shouldShowApiKeyLink
      websiteUrl="https://x.ai/grok"
      shouldShowSpeedTest
      codexBaseUrl="https://api.x.ai/v1"
      onBaseUrlChange={vi.fn()}
      isFullUrl={false}
      onFullUrlChange={vi.fn()}
      isEndpointModalOpen={false}
      onEndpointModalToggle={vi.fn()}
      autoSelect={false}
      onAutoSelectChange={vi.fn()}
      takeoverEnabled={false}
      onTakeoverEnabledChange={vi.fn()}
      apiFormat="openai_responses"
      onApiFormatChange={vi.fn()}
      promptCacheRouting="auto"
      onPromptCacheRoutingChange={vi.fn()}
      modelName="grok-4.5"
      onModelNameChange={vi.fn()}
      speedTestEndpoints={[]}
      customUserAgent=""
      onCustomUserAgentChange={vi.fn()}
      localProxyHeadersOverride=""
      onLocalProxyHeadersOverrideChange={vi.fn()}
      localProxyBodyOverride=""
      onLocalProxyBodyOverrideChange={vi.fn()}
    />,
  );
}

describe("CodexFormFields", () => {
  it("xAI OAuth 模式隐藏凭据和端点，并用绑定账号拉取模型", async () => {
    fetchXaiOauthModelsMock.mockResolvedValueOnce([{ id: "grok-4.5" }]);
    renderXaiOauthFields();

    expect(screen.getByTestId("xai-oauth-account")).toHaveTextContent(
      "xai-account",
    );
    expect(screen.queryByTestId("api-key-field")).toBeNull();
    expect(screen.queryByTestId("endpoint-field")).toBeNull();
    expect(document.getElementById("codexApiFormat")).toBeNull();
    expect(screen.getByTestId("model-field")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    );

    await waitFor(() =>
      expect(fetchXaiOauthModelsMock).toHaveBeenCalledWith("xai-account"),
    );
  });

  it("编辑模型目录时保留原生 Responses 隐藏能力字段", async () => {
    const onCatalogModelsChange = vi.fn();
    render(
      <CodexFormFields
        codexApiKey="sk-test"
        onApiKeyChange={vi.fn()}
        category="third_party"
        shouldShowApiKeyLink={false}
        websiteUrl="https://example.com"
        shouldShowSpeedTest={false}
        codexBaseUrl="https://example.com/v1"
        onBaseUrlChange={vi.fn()}
        isFullUrl={false}
        onFullUrlChange={vi.fn()}
        isEndpointModalOpen={false}
        onEndpointModalToggle={vi.fn()}
        autoSelect={false}
        onAutoSelectChange={vi.fn()}
        takeoverEnabled
        onTakeoverEnabledChange={vi.fn()}
        apiFormat="openai_responses"
        onApiFormatChange={vi.fn()}
        promptCacheRouting="auto"
        onPromptCacheRoutingChange={vi.fn()}
        modelName="mimo-v2.5-pro"
        onModelNameChange={vi.fn()}
        catalogModels={[
          {
            model: "mimo-v2.5-pro",
            displayName: "MiMo",
            contextWindow: 262144,
            supportsParallelToolCalls: true,
            inputModalities: ["text", "image"],
            baseInstructions: "You are MiMo.",
          },
        ]}
        onCatalogModelsChange={onCatalogModelsChange}
        speedTestEndpoints={[]}
        customUserAgent=""
        onCustomUserAgentChange={vi.fn()}
        localProxyHeadersOverride=""
        onLocalProxyHeadersOverrideChange={vi.fn()}
        localProxyBodyOverride=""
        onLocalProxyBodyOverrideChange={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByLabelText("codexConfig.catalogColumnDisplay"),
      { target: { value: "MiMo 2.5" } },
    );

    await waitFor(() =>
      expect(onCatalogModelsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          displayName: "MiMo 2.5",
          supportsParallelToolCalls: true,
          inputModalities: ["text", "image"],
          baseInstructions: "You are MiMo.",
        }),
      ]),
    );
  });

  it("默认模型合并目录与远端建议，并可加入模型映射", async () => {
    fetchModelsForConfigMock.mockResolvedValueOnce([
      { id: "mapped-model" },
      { id: "remote-model", ownedBy: "remote" },
    ]);
    const onCatalogModelsChange = vi.fn();
    render(
      <CodexFormFields
        codexApiKey="sk-test"
        onApiKeyChange={vi.fn()}
        category="third_party"
        shouldShowApiKeyLink={false}
        websiteUrl="https://example.com"
        shouldShowSpeedTest
        codexBaseUrl="https://example.com/v1"
        onBaseUrlChange={vi.fn()}
        isFullUrl={false}
        onFullUrlChange={vi.fn()}
        isEndpointModalOpen={false}
        onEndpointModalToggle={vi.fn()}
        autoSelect={false}
        onAutoSelectChange={vi.fn()}
        takeoverEnabled
        onTakeoverEnabledChange={vi.fn()}
        apiFormat="openai_responses"
        onApiFormatChange={vi.fn()}
        promptCacheRouting="auto"
        onPromptCacheRoutingChange={vi.fn()}
        modelName="outside-model"
        onModelNameChange={vi.fn()}
        catalogModels={[{ model: "mapped-model" }]}
        onCatalogModelsChange={onCatalogModelsChange}
        speedTestEndpoints={[]}
        customUserAgent="cc-switch-test"
        onCustomUserAgentChange={vi.fn()}
        localProxyHeadersOverride=""
        onLocalProxyHeadersOverrideChange={vi.fn()}
        localProxyBodyOverride=""
        onLocalProxyBodyOverrideChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("model-field")).toHaveAttribute(
        "data-models",
        expect.stringContaining('"id":"remote-model"'),
      ),
    );
    expect(screen.getByTestId("model-field")).toHaveAttribute(
      "data-models",
      expect.stringContaining('"id":"mapped-model"'),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "codexConfig.addToModelMapping" }),
    );
    await waitFor(() =>
      expect(onCatalogModelsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ model: "mapped-model" }),
        expect.objectContaining({
          model: "outside-model",
          displayName: "outside-model",
        }),
      ]),
    );
  });
});
