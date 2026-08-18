import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsageScriptModal from "@/components/UsageScriptModal";
import type { Provider, UsageScript } from "@/types";

const mocks = vi.hoisted(() => ({
  getCodexOauthQuota: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/query", () => ({
  useSettingsQuery: () => ({ data: { usageConfirmed: true } }),
}));
vi.mock("@/lib/api", () => ({
  usageApi: { testScript: vi.fn() },
  settingsApi: { update: vi.fn() },
}));
vi.mock("@/lib/api/copilot", () => ({
  copilotGetUsage: vi.fn(),
  copilotGetUsageForAccount: vi.fn(),
}));
vi.mock("@/lib/api/subscription", () => ({
  subscriptionApi: {
    getCodexOauthQuota: mocks.getCodexOauthQuota,
    getQuota: vi.fn(),
    getBalance: vi.fn(),
    getCodingPlanQuota: vi.fn(),
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
    footer: React.ReactNode;
  }) =>
    isOpen ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("@/components/JsonEditor", () => ({ default: () => null }));

const provider: Provider = {
  id: "team-login",
  name: "Team Login",
  category: "custom",
  settingsConfig: { auth: {}, config: "" },
  meta: {
    authBinding: {
      source: "managed_account",
      authProvider: "codex_oauth",
      accountId: "account-42",
    },
  },
};

function renderModal(onSave = vi.fn<(script: UsageScript) => void>()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <UsageScriptModal
        provider={provider}
        appId="codex"
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  return { queryClient, onSave };
}

describe("UsageScriptModal managed Codex account", () => {
  beforeEach(() => {
    mocks.getCodexOauthQuota.mockReset();
  });

  it("默认生成已启用的官方订阅配置", () => {
    const { onSave } = renderModal();

    expect(
      screen.getByText("usageScript.officialSubscriptionHint"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("usageScript.extractorCode"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("usageScript.timeoutSeconds"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "usageScript.saveConfig" }),
    );

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        templateType: "official_subscription",
        autoQueryInterval: 5,
        code: "",
      }),
    );
  });

  it("测试时查询绑定账号并写入账号额度缓存", async () => {
    const quota = {
      tool: "codex_oauth",
      credentialStatus: "valid",
      credentialMessage: null,
      success: true,
      tiers: [{ name: "Plus", utilization: 25, resetsAt: null }],
      extraUsage: null,
      error: null,
      queriedAt: 1,
    };
    mocks.getCodexOauthQuota.mockResolvedValue(quota);
    const { queryClient } = renderModal();

    fireEvent.click(
      screen.getByRole("button", { name: "usageScript.testScript" }),
    );

    await waitFor(() => {
      expect(mocks.getCodexOauthQuota).toHaveBeenCalledWith("account-42");
    });
    expect(
      queryClient.getQueryData(["codex_oauth", "quota", "account-42"]),
    ).toEqual(quota);
  });
});
