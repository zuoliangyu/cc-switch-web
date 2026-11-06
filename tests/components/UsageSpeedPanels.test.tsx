import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestDetailPanel } from "@/components/usage/RequestDetailPanel";
import { ProviderStatsTable } from "@/components/usage/ProviderStatsTable";
import { renderWithQueryClient as render } from "../utils/testQueryClient";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  stats: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/query/usage", () => ({
  useRequestDetail: mocks.detail,
  useProviderStats: mocks.stats,
}));

describe("用量详情与供应商速度", () => {
  it("详情读取失败展示真实错误并允许重试，不显示未找到", () => {
    mocks.detail.mockReturnValue({
      isLoading: false,
      error: new Error("query failed"),
      refetch: mocks.retry,
    });
    render(<RequestDetailPanel requestId="request" onClose={() => {}} />);
    expect(screen.getByText("query failed")).toBeInTheDocument();
    expect(screen.queryByText("usage.requestNotFound")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("供应商统计仍按名称 A–Z；有精确速度时不再显示会话估算", () => {
    const base = {
      appType: "claude",
      requestCount: 1,
      totalTokens: 1000,
      totalCost: "0",
      successRate: 100,
      avgLatencyMs: 1000,
      speedOutputTokens: 1000,
      speedGenerationMs: 10000,
      estSpeedOutputTokens: 200,
      estSpeedDurationMs: 5000,
    };
    mocks.stats.mockReturnValue({
      isLoading: false,
      data: [
        // 请求多的排在后面也不上移：Web 的供应商列表一律 A–Z
        { ...base, requestCount: 9, providerId: "z", providerName: "Zulu" },
        {
          ...base,
          providerId: "a",
          providerName: "alpha",
          speedOutputTokens: 0,
          speedGenerationMs: 0,
        },
      ],
    });
    render(
      <ProviderStatsTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alpha");
    expect(rows[1]).toHaveTextContent("Zulu");
    // alpha 没有经路由的精确速度：用会话日志估算的 40 tok/s，带 ≈
    expect(rows[0]).toHaveTextContent("≈40tok/s");
    // Zulu 有精确的 100 tok/s，不再另列估算
    expect(rows[1]).toHaveTextContent("100tok/s");
    expect(rows[1]).not.toHaveTextContent("≈");
  });
});
