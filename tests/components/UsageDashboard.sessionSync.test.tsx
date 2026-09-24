import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { UsageDashboard } from "@/components/usage/UsageDashboard";

const syncSessionUsage = vi.fn();
const invalidateQueries = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/lib/api/usage", () => ({
  usageApi: { syncSessionUsage: () => syncSessionUsage() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/usage/UsageSummaryCards", () => ({
  UsageSummaryCards: () => null,
}));
vi.mock("@/components/usage/UsageTrendChart", () => ({
  UsageTrendChart: () => null,
}));
vi.mock("@/components/usage/RequestLogTable", () => ({
  RequestLogTable: () => null,
}));
vi.mock("@/components/usage/ProviderStatsTable", () => ({
  ProviderStatsTable: () => null,
}));
vi.mock("@/components/usage/ModelStatsTable", () => ({
  ModelStatsTable: () => null,
}));
vi.mock("@/components/usage/DataSourceBar", () => ({
  DataSourceBar: () => null,
}));
vi.mock("@/components/usage/PricingConfigPanel", () => ({
  PricingConfigPanel: () => null,
}));
vi.mock("@/components/usage/UsageDateRangePicker", () => ({
  UsageDateRangePicker: () => null,
}));

describe("UsageDashboard 会话扫描模式", () => {
  beforeEach(() => {
    syncSessionUsage.mockReset();
    invalidateQueries.mockReset();
  });

  it("自动模式隐藏立即同步，开关切换回调新值", () => {
    const onChange = vi.fn();
    render(
      <UsageDashboard
        sessionAutoSyncEnabled
        onSessionAutoSyncEnabledChange={onChange}
      />,
    );

    expect(screen.queryByText("usage.sessionSync.syncNow")).toBeNull();
    fireEvent.click(
      screen.getByRole("switch", { name: "usage.sessionSync.title" }),
    );
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("手动模式提供立即同步并刷新用量查询", async () => {
    syncSessionUsage.mockResolvedValue({
      imported: 2,
      skipped: 0,
      filesScanned: 3,
      errors: [],
    });
    render(<UsageDashboard sessionAutoSyncEnabled={false} />);

    fireEvent.click(screen.getByText("usage.sessionSync.syncNow"));

    await waitFor(() => expect(syncSessionUsage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  });
});
