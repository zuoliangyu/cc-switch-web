import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { UsageDashboard } from "@/components/usage/UsageDashboard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/usage/UsageSummaryCards", () => ({
  UsageSummaryCards: ({ appType }: { appType: string }) => (
    <div data-testid="usage-summary" data-app-type={appType} />
  ),
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

describe("UsageDashboard Pi 筛选", () => {
  it("将 Pi 作为统一用量筛选传给统计组件", () => {
    render(<UsageDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "usage.appFilter.pi" }));

    expect(screen.getByTestId("usage-summary")).toHaveAttribute(
      "data-app-type",
      "pi",
    );
  });
});
