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

describe("EditProviderDialog", () => {
  beforeEach(() => {
    mockFormReady = true;
    mockCodexManagedAccountSelected = false;
    submitReadyCallbacks = [];
    apiMocks.getCurrent.mockReset();
    apiMocks.getLiveProviderSettings.mockReset();
    apiMocks.getOpenClawLiveProvider.mockReset();
  });

  it("uses the current Codex live bearer with the stored provider auth template", async () => {
    const provider: Provider = {
      id: "provider-a",
      name: "Provider A",
      category: "custom",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-db-stale",
          provider_note: "keep-me",
        },
        config:
          'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://proxy.example/v1"\n',
      },
    };
    const liveSettings = {
      // Shared auth.json belongs to another provider / official login cache.
      auth: {
        OPENAI_API_KEY: "sk-shared-other-provider",
        tokens: { account_id: "shared-account" },
      },
      config:
        'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://proxy.example/v1"\nexperimental_bearer_token = "sk-provider-a"\n',
    };
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    apiMocks.getCurrent.mockResolvedValue(provider.id);
    apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
        appId="codex"
      />,
    );

    const expectedSettings = {
      ...liveSettings,
      auth: {
        OPENAI_API_KEY: "sk-provider-a",
        provider_note: "keep-me",
      },
    };

    await waitFor(() => {
      expect(
        JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
      ).toEqual(expectedSettings);
    });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual(
      expectedSettings,
    );
  });

  it.each([
    { description: "missing auth.json", auth: {} },
    { description: "a logout marker", auth: { auth_mode: "chatgpt" } },
  ])(
    "preserves $description for a category-less official Codex provider",
    async ({ auth }) => {
      const provider: Provider = {
        id: "codex-official",
        name: "OpenAI Official",
        settingsConfig: {
          auth: {
            auth_mode: "chatgpt",
            tokens: { refresh_token: "old-refresh-token" },
          },
          config: 'model = "old-model"\n',
        },
      };
      const liveSettings = { auth, config: 'model = "live-model"\n' };
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      apiMocks.getCurrent.mockResolvedValue(provider.id);
      apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

      render(
        <EditProviderDialog
          open
          provider={provider}
          onOpenChange={vi.fn()}
          onSubmit={handleSubmit}
          appId="codex"
        />,
      );

      await waitFor(() => {
        expect(
          JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
        ).toEqual(liveSettings);
      });

      fireEvent.click(screen.getByRole("button", { name: "common.save" }));
      await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
      expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual(
        liveSettings,
      );
    },
  );

  it.each([
    { id: "header-auth", category: "custom" as const },
    { id: "codex-official", category: undefined },
  ])(
    "keeps stored Codex auth for $id when Live has no auth.json",
    async ({ id, category }) => {
      // Repro of #7433: the provider table declares its own credential source
      // (Authorization header), so a switch injects no bearer token into
      // config.toml, and default mode deletes the shared auth.json. Live is then
      // `{ auth: {}, config }` while the DB row holds the only copy of the key —
      // opening the edit dialog and saving must not erase it. Live still owns
      // the config text, so the two snapshots differ there.
      const storedConfig =
        'model_provider = "custom"\nmodel = "old-model"\n[model_providers.custom]\nname = "Custom"\nbase_url = "https://api.example.com/v1"\nhttp_headers = { Authorization = "Bearer sk-db-only" }\n';
      const liveConfig = storedConfig.replace(
        'model = "old-model"',
        'model = "live-model"',
      );
      const provider: Provider = {
        id,
        name: "Header Auth",
        category,
        settingsConfig: {
          auth: { OPENAI_API_KEY: "sk-db-only" },
          config: storedConfig,
        },
      };
      const liveSettings = { auth: {}, config: liveConfig };
      const handleSubmit = vi.fn().mockResolvedValue(undefined);

      apiMocks.getCurrent.mockResolvedValue(provider.id);
      apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

      render(
        <EditProviderDialog
          open
          provider={provider}
          onOpenChange={vi.fn()}
          onSubmit={handleSubmit}
          appId="codex"
        />,
      );

      const expectedSettings = {
        ...liveSettings,
        auth: { OPENAI_API_KEY: "sk-db-only" },
      };

      await waitFor(() => {
        expect(
          JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
        ).toEqual(expectedSettings);
      });

      fireEvent.click(screen.getByRole("button", { name: "common.save" }));

      await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
      expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual(
        expectedSettings,
      );
    },
  );

  it("keeps the stored Codex auth when Live is only a logout marker", async () => {
    // `{ auth_mode: "chatgpt" }` with no tokens is Codex's logged-out shape,
    // not an authorization for the provider row to drop its own key.
    const provider: Provider = {
      id: "header-auth",
      name: "Header Auth",
      category: "custom",
      settingsConfig: {
        auth: { OPENAI_API_KEY: "sk-db-only" },
        config: 'model_provider = "custom"\nmodel = "old-model"\n',
      },
    };
    const liveSettings = {
      auth: { auth_mode: "chatgpt" },
      config: 'model_provider = "custom"\nmodel = "live-model"\n',
    };

    apiMocks.getCurrent.mockResolvedValue(provider.id);
    apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        appId="codex"
      />,
    );

    await waitFor(() => {
      expect(
        JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
      ).toEqual({
        ...liveSettings,
        auth: { OPENAI_API_KEY: "sk-db-only" },
      });
    });
  });

  it("does not convert an OAuth-only Codex provider into an API-key provider", async () => {
    const provider: Provider = {
      id: "oauth-provider",
      name: "OAuth Provider",
      category: "custom",
      settingsConfig: {
        auth: {
          auth_mode: "chatgpt",
          tokens: { account_id: "stored-account" },
        },
        config: 'model_provider = "custom"\n',
      },
    };
    const liveSettings = {
      auth: {
        auth_mode: "chatgpt",
        tokens: { account_id: "live-account" },
      },
      config:
        'model_provider = "custom"\nexperimental_bearer_token = "sk-route-only"\n',
    };

    apiMocks.getCurrent.mockResolvedValue(provider.id);
    apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        appId="codex"
      />,
    );

    await waitFor(() => {
      expect(
        JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
      ).toEqual(liveSettings);
    });
  });

  it("does not let a stored bearer override a non-current Codex provider auth", async () => {
    const provider: Provider = {
      id: "provider-a",
      name: "Provider A",
      category: "custom",
      settingsConfig: {
        auth: { OPENAI_API_KEY: "sk-db-authoritative" },
        config:
          'model_provider = "custom"\nexperimental_bearer_token = "sk-leftover-live"\n',
      },
    };
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    apiMocks.getCurrent.mockResolvedValue("provider-b");

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
        appId="codex"
      />,
    );

    await waitFor(() => expect(apiMocks.getCurrent).toHaveBeenCalledTimes(1));
    expect(apiMocks.getLiveProviderSettings).not.toHaveBeenCalled();
    expect(
      JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
    ).toEqual(provider.settingsConfig);

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual(
      provider.settingsConfig,
    );
  });
});
