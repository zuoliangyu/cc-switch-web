import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderForm,
  type ProviderFormProps,
} from "@/components/providers/forms/ProviderForm";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { createTestQueryClient } from "../utils/testQueryClient";
import { setSettings } from "../msw/state";

// Web 版的 Codex → GitHub Copilot 表单用例（上游 f9db9f70 的用例依赖草稿投影，Web 没有）。

vi.mock("@/components/JsonEditor", () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} />
  ),
}));
vi.mock("@/components/providers/forms/hooks", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/providers/forms/hooks")
  >()),
  useManagedAuth: () => ({ isAuthenticated: true, accounts: [] }),
}));
vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: ({
    selectedAccountId,
    onAccountSelect,
  }: {
    selectedAccountId?: string | null;
    onAccountSelect?: (accountId: string | null) => void;
  }) => (
    <>
      <output data-testid="selected-copilot-account">
        {selectedAccountId ?? "default"}
      </output>
      <button
        type="button"
        onClick={() => onAccountSelect?.("copilot-account")}
      >
        select-copilot-account
      </button>
    </>
  ),
}));
vi.mock("@/components/providers/forms/ProviderPresetSelector", () => ({
  ProviderPresetSelector: ({
    onPresetChange,
  }: {
    onPresetChange: (id: string) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onPresetChange(
          `codex-${codexProviderPresets.findIndex(
            (preset) => preset.providerType === "github_copilot",
          )}`,
        )
      }
    >
      choose-copilot
    </button>
  ),
}));

function renderForm(initialData?: ProviderFormProps["initialData"]) {
  setSettings({ commonConfigConfirmed: true });
  const onSubmit = vi.fn<ProviderFormProps["onSubmit"]>();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ProviderForm
        appId="codex"
        initialData={initialData}
        submitLabel="save-provider"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("Codex GitHub Copilot provider form", () => {
  it("saves the Copilot preset keyless with the managed account binding", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "choose-copilot" }));

    // 托管账号：不填 API Key 和端点，挂 Copilot 账号选择
    expect(document.getElementById("codexApiKey")).toBeNull();
    expect(document.getElementById("codexBaseUrl")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "select-copilot-account" }),
    );
    expect(screen.getByTestId("selected-copilot-account")).toHaveTextContent(
      "copilot-account",
    );

    fireEvent.click(screen.getByRole("button", { name: "save-provider" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.meta).toMatchObject({
      providerType: "github_copilot",
      authBinding: {
        source: "managed_account",
        authProvider: "github_copilot",
        accountId: "copilot-account",
      },
    });
    // 自动模式不写显式协议，由代理按模型能力选
    expect(submitted.meta?.codexCopilotApiFormat).toBeUndefined();
    expect(submitted.meta?.isFullUrl).toBeUndefined();
  });

  it("keeps an explicit Copilot protocol when editing a saved card", async () => {
    const preset = codexProviderPresets.find(
      (item) => item.providerType === "github_copilot",
    )!;
    const onSubmit = renderForm({
      name: "GitHub Copilot",
      category: "third_party",
      settingsConfig: { auth: {}, config: preset.config },
      meta: {
        providerType: "github_copilot",
        codexCopilotApiFormat: "openai_responses",
        authBinding: {
          source: "managed_account",
          authProvider: "github_copilot",
          accountId: "saved-account",
        },
      },
    });

    expect(screen.getByTestId("selected-copilot-account")).toHaveTextContent(
      "saved-account",
    );
    fireEvent.click(screen.getByRole("button", { name: "save-provider" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.meta).toMatchObject({
      providerType: "github_copilot",
      codexCopilotApiFormat: "openai_responses",
      apiFormat: "openai_responses",
    });
  });
});
