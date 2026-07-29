import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";

const fetchXaiOauthModelsMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: vi.fn(),
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
  ModelInputWithFetch: () => <div data-testid="model-field" />,
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
      modelName="grok-4.5"
      onModelNameChange={vi.fn()}
      speedTestEndpoints={[]}
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
});
