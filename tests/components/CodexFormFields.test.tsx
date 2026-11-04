import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { useState, type ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";

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
  // 取模型带上 Header 覆盖（上游 315aeda7）：测试里按 JSON 原样解析
  modelFetchRequestHeaders: (json: string) =>
    json.trim() ? (JSON.parse(json) as Record<string, string>) : undefined,
  showFetchModelsError: vi.fn(),
}));

vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: ({ selectedAccountId }: { selectedAccountId?: string }) => (
    <div data-testid="xai-oauth-account">{selectedAccountId}</div>
  ),
}));

vi.mock("@/components/providers/forms/shared", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/providers/forms/shared")
  >()),
  ApiKeySection: () => <div data-testid="api-key-field" />,
  EndpointField: () => <div data-testid="endpoint-field" />,
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
    // 没有模型列表：默认模型框带自己的获取按钮
    expect(document.getElementById("codexModelName")).toBeInTheDocument();

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

  it("默认模型不在列表里时提示并加到第一行；选拉到的模型补参数并带着默认模型", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    server.use(
      http.post("http://runtime.local/fetch_models_dev", () =>
        HttpResponse.json({
          example: {
            api: "https://example.com/v1",
            models: {
              "outside-model": { limit: { context: 9000 } },
              "remote-model": {
                limit: { context: 64000 },
                modalities: { input: ["text", "image"] },
                reasoning_options: [
                  { type: "discrete", values: ["low", "high"] },
                ],
              },
            },
          },
        }),
      ),
    );
    fetchModelsForConfigMock.mockResolvedValueOnce([
      { id: "mapped-model" },
      { id: "remote-model", ownedBy: "remote" },
    ]);
    const onCatalogModelsChange = vi.fn();
    const onModelNameChange = vi.fn();
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
        apiFormat="openai_responses"
        onApiFormatChange={vi.fn()}
        promptCacheRouting="auto"
        onPromptCacheRoutingChange={vi.fn()}
        modelName="outside-model"
        onModelNameChange={onModelNameChange}
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

    // 有模型列表：没有单独的默认模型框，拉取在列表标题上，拉到后打开选择弹窗
    expect(document.getElementById("codexModelName")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    );
    const picker = await screen.findByRole("dialog");
    fireEvent.click(
      within(picker).getByRole("button", { name: "common.cancel" }),
    );
    expect(onCatalogModelsChange).not.toHaveBeenCalled();

    expect(
      screen.getByText("codexConfig.defaultModelNotInList"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "codexConfig.addToModelList" }),
    );
    await waitFor(() =>
      expect(onCatalogModelsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          model: "outside-model",
          displayName: "outside-model",
          contextWindow: "9000",
        }),
        expect.objectContaining({ model: "mapped-model" }),
      ]),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "providerForm.searchModelAriaLabel",
      })[0],
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "remote-model" }),
    );
    // 第一行就是默认模型：换成拉到的模型时默认模型跟着变
    await waitFor(() =>
      expect(onCatalogModelsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          model: "remote-model",
          contextWindow: "9000",
        }),
        expect.objectContaining({ model: "mapped-model" }),
      ]),
    );
    expect(onModelNameChange).toHaveBeenCalledWith("remote-model");
  });
});

// 上游 315aeda7：Header 覆盖也是取模型的请求身份，换了要清掉旧列表、丢弃在途响应
describe("CodexFormFields model fetch identity", () => {
  function HeadersHarness() {
    const [headers, setHeaders] = useState('{"X-Tenant": "tenant-1"}');
    return (
      <>
        <button
          type="button"
          onClick={() => setHeaders('{"X-Tenant": "tenant-2"}')}
        >
          change-headers
        </button>
        <CodexFormFields
          codexApiKey="sk-test"
          onApiKeyChange={vi.fn()}
          category="third_party"
          shouldShowApiKeyLink={false}
          websiteUrl=""
          shouldShowSpeedTest={false}
          codexBaseUrl="https://api.example.com/v1"
          onBaseUrlChange={vi.fn()}
          isFullUrl={false}
          onFullUrlChange={vi.fn()}
          isEndpointModalOpen={false}
          onEndpointModalToggle={vi.fn()}
          autoSelect={false}
          onAutoSelectChange={vi.fn()}
          apiFormat="openai_responses"
          onApiFormatChange={vi.fn()}
          promptCacheRouting="auto"
          onPromptCacheRoutingChange={vi.fn()}
          modelName=""
          onModelNameChange={vi.fn()}
          speedTestEndpoints={[]}
          customUserAgent=""
          onCustomUserAgentChange={vi.fn()}
          localProxyHeadersOverride={headers}
          onLocalProxyHeadersOverrideChange={setHeaders}
          localProxyBodyOverride=""
          onLocalProxyBodyOverrideChange={vi.fn()}
        />
      </>
    );
  }

  // 没有模型列表时，拉到的模型出现在默认模型框旁的下拉里
  const fetchedIds = async () => {
    const trigger = screen.queryByRole("button", {
      name: "providerForm.searchModelAriaLabel",
    });
    if (!trigger) return [];
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    const ids = options.map((option) => option.textContent ?? "");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    return ids;
  };

  it("sends the header override and clears the list once it changes", async () => {
    fetchModelsForConfigMock.mockReset();
    fetchModelsForConfigMock.mockResolvedValueOnce([
      { id: "model-a", ownedBy: "vendor" },
    ]);
    render(<HeadersHarness />);

    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "providerForm.searchModelAriaLabel",
        }),
      ).toBeInTheDocument(),
    );
    expect((await fetchedIds()).join(" ")).toContain("model-a");
    expect(fetchModelsForConfigMock).toHaveBeenCalledWith(
      "https://api.example.com/v1",
      "sk-test",
      false,
      undefined,
      "",
      { requestHeaders: { "X-Tenant": "tenant-1" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "change-headers" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "providerForm.searchModelAriaLabel",
        }),
      ).toBeNull(),
    );
  });

  it("drops a response that lands after the header override changed", async () => {
    fetchModelsForConfigMock.mockReset();
    let resolveFetch!: (models: { id: string; ownedBy: string }[]) => void;
    fetchModelsForConfigMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<HeadersHarness />);

    const fetchButton = screen.getByRole("button", {
      name: "providerForm.fetchModels",
    });
    fireEvent.click(fetchButton);
    await waitFor(() => expect(fetchModelsForConfigMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "change-headers" }));
    resolveFetch([{ id: "stale-model", ownedBy: "vendor" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await fetchedIds()).toEqual([]);
  });
});
