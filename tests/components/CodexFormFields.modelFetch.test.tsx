import type { ComponentProps } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";
import {
  copilotGetModels,
  copilotGetModelsForAccount,
  type CopilotModel,
} from "@/lib/api/copilot";
import type { FetchedModel } from "@/lib/api/model-fetch";

vi.mock("@/lib/api/copilot", () => ({
  copilotGetModels: vi.fn(),
  copilotGetModelsForAccount: vi.fn(),
}));
vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: vi.fn(),
  fetchXaiOauthModels: vi.fn(),
  showFetchModelsError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/shared", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/providers/forms/shared")
    >();
  return {
    ...actual,
    ModelDropdown: ({ models }: { models: FetchedModel[] }) => (
      <output data-testid="model-options">
        {models.map((model) => model.id).join(",")}
      </output>
    ),
  };
});

type Props = ComponentProps<typeof CodexFormFields>;
type ProviderKind = "copilot" | "xai" | "config";

function pendingModels() {
  let resolve!: (models: Array<CopilotModel & FetchedModel>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Array<CopilotModel & FetchedModel>>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

function advertisedModel(id = "model-1"): CopilotModel & FetchedModel {
  return {
    id,
    name: "Model One",
    vendor: "vendor",
    ownedBy: "vendor",
    model_picker_enabled: true,
    supported_endpoints: ["/responses"],
    context_window: 400_000,
  };
}

function makeProps(kind: ProviderKind): Props {
  return {
    isCopilotPreset: kind === "copilot",
    isCopilotAuthenticated: true,
    selectedGitHubAccountId: "github-account",
    isXaiOauthPreset: kind === "xai",
    isXaiOauthAuthenticated: true,
    selectedXaiAccountId: "xai-account",
    codexApiKey: "test-key",
    onApiKeyChange: vi.fn(),
    category: "third_party",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    shouldShowSpeedTest: false,
    codexBaseUrl: "https://example.com/v1",
    onBaseUrlChange: vi.fn(),
    isFullUrl: false,
    onFullUrlChange: vi.fn(),
    isEndpointModalOpen: false,
    onEndpointModalToggle: vi.fn(),
    autoSelect: false,
    onAutoSelectChange: vi.fn(),
    modelName: "model-1",
    onModelNameChange: vi.fn(),
    apiFormat: "openai_chat",
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

const fetchButton = () =>
  screen.getAllByRole("button", { name: "providerForm.fetchModels" })[0];

describe("Codex model-fetch lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches only models supporting the selected Copilot protocol", async () => {
    const responsesModel = advertisedModel("responses-model");
    const chatModel = {
      ...advertisedModel("chat-model"),
      supported_endpoints: ["/chat/completions"],
    };
    vi.mocked(copilotGetModelsForAccount).mockResolvedValue([
      responsesModel,
      chatModel,
    ]);
    const props = {
      ...makeProps("copilot"),
      copilotApiFormat: "openai_chat" as const,
    };
    render(<Harness {...props} />);
    fireEvent.click(fetchButton());
    await waitFor(() => expect(fetchButton()).toBeEnabled());
    expect(props.onModelNameChange).toHaveBeenCalledWith("chat-model");
    expect(props.onCatalogModelsChange).toHaveBeenCalledWith([
      expect.objectContaining({ model: "chat-model" }),
    ]);
  });

  it("discards a pending model list after the Copilot protocol changes", async () => {
    const pending = pendingModels();
    vi.mocked(copilotGetModelsForAccount).mockReturnValue(pending.promise);
    const props = makeProps("copilot");
    const { rerender } = render(<Harness {...props} />);
    fireEvent.click(fetchButton());
    rerender(<Harness {...props} copilotApiFormat="openai_chat" />);
    await act(async () => pending.resolve([advertisedModel()]));
    expect(props.onCatalogModelsChange).not.toHaveBeenCalled();
    expect(props.onModelNameChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(["gpt-6-astra", "claude-model"])(
    "prefers an available GPT model without replacing a valid selection (%s)",
    async (currentModel) => {
      vi.mocked(copilotGetModelsForAccount).mockResolvedValue([
        advertisedModel("claude-model"),
        advertisedModel("gpt-available"),
      ]);
      const props = { ...makeProps("copilot"), modelName: currentModel };
      render(<Harness {...props} />);
      fireEvent.click(fetchButton());
      await waitFor(() => expect(fetchButton()).toBeEnabled());
      if (currentModel === "claude-model") {
        expect(props.onModelNameChange).not.toHaveBeenCalled();
      } else {
        expect(props.onModelNameChange).toHaveBeenCalledWith("gpt-available");
      }
    },
  );

  it("keeps Copilot filtering, applies reported prompt limits and selects a default model", async () => {
    vi.mocked(copilotGetModels).mockResolvedValue([
      advertisedModel(),
      {
        ...advertisedModel("messages-only"),
        supported_endpoints: ["/v1/messages"],
      },
    ]);
    const props = {
      ...makeProps("copilot"),
      selectedGitHubAccountId: null,
      modelName: "unavailable",
      catalogModels: [{ model: "model-1", contextWindow: 200_000 }],
    };
    render(<Harness {...props} />);
    fireEvent.click(fetchButton());

    await waitFor(() =>
      expect(props.onModelNameChange).toHaveBeenCalledWith("model-1"),
    );
    expect(copilotGetModels).toHaveBeenCalledTimes(1);
    expect(copilotGetModelsForAccount).not.toHaveBeenCalled();
    expect(props.onCatalogModelsChange).toHaveBeenCalledWith([
      expect.objectContaining({ model: "model-1", contextWindow: 400_000 }),
    ]);
  });

  it("overrides stale managed metadata with live Copilot capabilities", async () => {
    vi.mocked(copilotGetModelsForAccount).mockResolvedValue([
      {
        ...advertisedModel(),
        context_window: 922_000,
        supports_parallel_tool_calls: true,
        reasoning_effort: ["none", "low", "medium", "high", "xhigh"],
      },
    ]);
    const props = {
      ...makeProps("copilot"),
      catalogModels: [
        {
          model: "model-1",
          contextWindow: 1_048_576,
          supportsParallelToolCalls: false,
          reasoningLevels: ["max"],
          baseInstructions: "Keep me",
        },
      ],
    };
    render(<Harness {...props} />);
    fireEvent.click(fetchButton());

    await waitFor(() =>
      expect(props.onCatalogModelsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          model: "model-1",
          contextWindow: 922_000,
          supportsParallelToolCalls: true,
          reasoningLevels: ["none", "low", "medium", "high", "xhigh"],
          baseInstructions: "Keep me",
        }),
      ]),
    );
  });

  it("preserves existing managed metadata when Copilot omits it", async () => {
    vi.mocked(copilotGetModelsForAccount).mockResolvedValue([
      {
        ...advertisedModel(),
        context_window: undefined,
      },
    ]);
    const props = {
      ...makeProps("copilot"),
      catalogModels: [
        {
          model: "model-1",
          contextWindow: 222_000,
          supportsParallelToolCalls: true,
          reasoningLevels: ["high", "max"],
        },
      ],
    };
    render(<Harness {...props} />);
    fireEvent.click(fetchButton());

    await waitFor(() =>
      expect(props.onCatalogModelsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          model: "model-1",
          contextWindow: 222_000,
          supportsParallelToolCalls: true,
          reasoningLevels: ["high", "max"],
        }),
      ]),
    );
  });

  it("clears stale reasoning levels when Copilot explicitly reports none", async () => {
    vi.mocked(copilotGetModelsForAccount).mockResolvedValue([
      {
        ...advertisedModel(),
        reasoning_effort: [],
      },
    ]);
    const props = {
      ...makeProps("copilot"),
      catalogModels: [
        {
          model: "model-1",
          reasoningLevels: ["high", "max"],
        },
      ],
    };
    render(<Harness {...props} />);
    fireEvent.click(fetchButton());

    await waitFor(() =>
      expect(props.onCatalogModelsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          model: "model-1",
          reasoningLevels: [],
        }),
      ]),
    );
  });
});
