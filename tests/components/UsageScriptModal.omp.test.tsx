import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import UsageScriptModal from "@/components/UsageScriptModal";

const mocks = vi.hoisted(() => ({
  getBalance: vi.fn(),
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
    getCodexOauthQuota: vi.fn(),
    getQuota: vi.fn(),
    getBalance: mocks.getBalance,
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

/**
 * Oh My Pi 有自己的 AppId（omp），以前进不了 Pi 的分支，内置测试一律报「API Key 为空」。
 * 供应商的 Key 和地址要像 Pi 一样传给余额接口（上游 a03c6c7a）。
 */
describe("UsageScriptModal Oh My Pi credentials", () => {
  it("passes the omp provider's key and base URL to the balance test", async () => {
    mocks.getBalance.mockResolvedValue({ success: true, data: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UsageScriptModal
          provider={{
            id: "cc-switch-demo",
            name: "Demo",
            // 余额模板认得的地址，测试才会走到 getBalance
            settingsConfig: {
              baseUrl: "https://api.deepseek.com/v1",
              apiKey: "sk-omp",
              api: "openai-completions",
            },
          }}
          appId="omp"
          isOpen
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "usageScript.enableUsageQuery" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /usageScript.testScript/ }),
    );

    await waitFor(() =>
      expect(mocks.getBalance).toHaveBeenCalledWith(
        "https://api.deepseek.com/v1",
        "sk-omp",
      ),
    );
  });
});
