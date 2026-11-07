import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";

const apiMocks = vi.hoisted(() => ({
  getCodexEditorView: vi.fn(),
  getCurrent: vi.fn(),
  getLiveProviderSettings: vi.fn(),
  getOpenClawLiveProvider: vi.fn(),
}));
let mockFormReady = true;
let mockCodexManagedAccountSelected = false;
let submitReadyCallbacks: Array<(isReady: boolean) => void> = [];

vi.mock("@/lib/api", () => ({
  providersApi: {
    getCurrent: apiMocks.getCurrent,
  },
  providerRuntimeApi: {
    getLiveProviderSettings: apiMocks.getLiveProviderSettings,
  },
  openclawApi: {
    getLiveProvider: apiMocks.getOpenClawLiveProvider,
  },
}));

vi.mock("@/lib/api/providers", () => ({
  providersApi: { getCodexEditorView: apiMocks.getCodexEditorView },
}));

vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({
    isOpen,
    children,
    footer,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/forms/ProviderForm", () => ({
  ProviderForm: ({
    initialData,
    onSubmit,
    onSubmitReadyChange,
    onManageAuthAccounts,
    isProxyTakeover,
  }: {
    initialData: {
      name?: string;
      websiteUrl?: string;
      notes?: string;
      settingsConfig?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      icon?: string;
      iconColor?: string;
    };
    onSubmit: (values: {
      name: string;
      websiteUrl: string;
      notes?: string;
      settingsConfig: string;
      meta?: Record<string, unknown>;
      icon?: string;
      iconColor?: string;
    }) => void;
    onSubmitReadyChange?: (isReady: boolean) => void;
    onManageAuthAccounts?: (target: "codex_oauth") => void;
    isProxyTakeover?: boolean;
    appId?: string;
  }) => {
    useEffect(() => {
      if (onSubmitReadyChange) {
        submitReadyCallbacks.push(onSubmitReadyChange);
        onSubmitReadyChange(mockFormReady);
      }
    }, [onSubmitReadyChange]);
    return (
      <form
        id="provider-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            name: initialData.name ?? "",
            websiteUrl: initialData.websiteUrl ?? "",
            notes: initialData.notes,
            settingsConfig: JSON.stringify(initialData.settingsConfig ?? {}),
            meta: mockCodexManagedAccountSelected
              ? {
                  ...(initialData.meta ?? {}),
                  providerType: "codex_oauth",
                  authBinding: {
                    source: "managed_account",
                    authProvider: "codex_oauth",
                    accountId: "acct-managed",
                  },
                }
              : initialData.meta,
            icon: initialData.icon,
            iconColor: initialData.iconColor,
          });
        }}
      >
        <output data-testid="settings-config">
          {JSON.stringify(initialData.settingsConfig ?? {})}
        </output>
        <output data-testid="is-proxy-takeover">
          {isProxyTakeover ? "true" : "false"}
        </output>
        <button
          type="button"
          onClick={() => onManageAuthAccounts?.("codex_oauth")}
        >
          manage-auth
        </button>
      </form>
    );
  },
}));

vi.mock("@/components/providers/AuthSettingsPanel", () => ({
  AuthSettingsPanel: ({ target }: { target: string | null }) =>
    target ? <div data-testid="auth-settings-panel">{target}</div> : null,
}));

import { EditProviderDialog } from "@/components/providers/EditProviderDialog";

describe("Codex editor snapshots", () => {
  beforeEach(() => {
    mockFormReady = true;
    apiMocks.getCodexEditorView.mockReset();
    apiMocks.getLiveProviderSettings.mockReset();
  });
  const provider: Provider = {
    id: "provider-a",
    name: "A",
    category: "custom",
    settingsConfig: {
      auth: { OPENAI_API_KEY: "row-key" },
      config: "model = 'row-model'\n",
    },
  };
  const snapshot = {
    settings: {
      ...provider.settingsConfig,
      config: "model = 'row-model'\napproval_policy = 'on-request'\n",
    },
    inactive: [],
  };
  it.each(["custom", "official"] as const)(
    "uses the server projection for %s cards without reading shared auth",
    async (category) => {
      apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
      const submit = vi.fn().mockResolvedValue(undefined);
      render(
        <EditProviderDialog
          open
          provider={{ ...provider, category }}
          onOpenChange={vi.fn()}
          onSubmit={submit}
          appId="codex"
        />,
      );
      await waitFor(() =>
        expect(
          JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
        ).toEqual(snapshot.settings),
      );
      fireEvent.click(screen.getByRole("button", { name: "common.save" }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit.mock.calls[0][0].editorSave).toEqual({
        base: snapshot.settings,
        onConflict: "refuse",
      });
      expect(submit.mock.calls[0][0].provider.settingsConfig.auth).toEqual({
        OPENAI_API_KEY: "row-key",
      });
      expect(apiMocks.getLiveProviderSettings).not.toHaveBeenCalled();
    },
  );
  it("clears the nested auth panel before the dialog reopens", async () => {
    apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
    const props = {
      provider,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      appId: "codex" as const,
    };
    const { rerender } = render(<EditProviderDialog open {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "manage-auth" }));
    expect(screen.getByTestId("auth-settings-panel")).toHaveTextContent(
      "codex_oauth",
    );

    rerender(<EditProviderDialog open={false} {...props} />);
    rerender(<EditProviderDialog open {...props} />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("auth-settings-panel"),
      ).not.toBeInTheDocument();
    });
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });
  it("keeps the list visible until the initial editor projection is ready", async () => {
    let resolveView!: (view: typeof snapshot) => void;
    apiMocks.getCodexEditorView.mockReturnValue(
      new Promise((resolve) => {
        resolveView = resolve;
      }),
    );
    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        appId="codex"
      />,
    );
    // 首份投影到之前不打开面板，也就没有一闪而过的加载页
    expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common.save" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-config")).not.toBeInTheDocument();

    await act(async () => {
      resolveView(snapshot);
    });
    expect(screen.getByTestId("settings-config")).toBeInTheDocument();
  });
  it("blocks saving when reading the client fails and allows retry", async () => {
    apiMocks.getCodexEditorView
      .mockRejectedValueOnce(new Error("broken TOML"))
      .mockResolvedValue(snapshot);
    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        appId="codex"
      />,
    );
    await screen.findByRole("button", { name: "common.retry" });
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    expect(screen.queryByTestId("settings-config")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await screen.findByTestId("settings-config");
    expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
  });
  it.each(["keepMine", "keepTheirs"] as const)(
    "retries conflicts with %s and the same draft and base",
    async (policy) => {
      apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
      const submit = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            JSON.stringify({
              code: "LIVE_EDIT_CONFLICT",
              path: "config.toml",
              keys: ["approval_policy"],
            }),
          ),
        )
        .mockResolvedValue(undefined);
      const close = vi.fn();
      render(
        <EditProviderDialog
          open
          provider={provider}
          onOpenChange={close}
          onSubmit={submit}
          appId="codex"
        />,
      );
      await screen.findByTestId("settings-config");
      fireEvent.click(screen.getByRole("button", { name: "common.save" }));
      await screen.findByRole("dialog");
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByText("approval_policy")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: `providerEditor.${policy}` }),
      );
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
      expect(submit.mock.calls[1][0]).toEqual({
        ...submit.mock.calls[0][0],
        editorSave: { base: snapshot.settings, onConflict: policy },
      });
      await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    },
  );
  it("keeps the draft open when the user cancels conflict resolution", async () => {
    apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
    const submit = vi.fn().mockRejectedValue(
      new Error(
        JSON.stringify({
          code: "LIVE_EDIT_CONFLICT",
          path: "config.toml",
          keys: ["approval_policy"],
        }),
      ),
    );
    const close = vi.fn();
    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={close}
        onSubmit={submit}
        appId="codex"
      />,
    );
    await screen.findByTestId("settings-config");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "providerEditor.keepEditing" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-config")).toBeInTheDocument();
  });
  it("does not show a late conflict after closing and reopening", async () => {
    apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
    let rejectSave!: (error: Error) => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSave = reject;
        }),
    );
    const close = vi.fn();
    const dialog = (open: boolean) => (
      <EditProviderDialog
        open={open}
        provider={provider}
        onOpenChange={close}
        onSubmit={submit}
        appId="codex"
      />
    );
    const { rerender } = render(dialog(true));
    await screen.findByTestId("settings-config");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    rerender(dialog(false));
    rerender(dialog(true));
    await act(async () =>
      rejectSave(
        new Error(
          JSON.stringify({
            code: "LIVE_EDIT_CONFLICT",
            path: "config.toml",
            keys: ["approval_policy"],
          }),
        ),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not close a reopened editor when an old save succeeds", async () => {
    apiMocks.getCodexEditorView.mockResolvedValue(snapshot);
    let finishSave!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const close = vi.fn();
    const dialog = (open: boolean) => (
      <EditProviderDialog
        open={open}
        provider={provider}
        onOpenChange={close}
        onSubmit={submit}
        appId="codex"
      />
    );
    const { rerender } = render(dialog(true));
    await screen.findByTestId("settings-config");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    rerender(dialog(false));
    rerender(dialog(true));
    await act(async () => finishSave());
    expect(close).not.toHaveBeenCalled();
  });
});
