import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UsageHeatmap } from "@/components/usage/UsageHeatmap";
import { resolveUsageRange } from "@/lib/usageRange";

const trends = vi.hoisted(() => vi.fn());
vi.mock("@/lib/query/usage", () => ({ useUsageTrends: trends }));

describe("全部时间热力图", () => {
  it("全部时间从零开始，热力图的结束时间持续跟随当前时间", () => {
    expect(resolveUsageRange({ preset: "all" }, 9000000)).toEqual({
      startDate: 0,
      endDate: 9000,
    });
    expect(
      resolveUsageRange(
        {
          preset: "custom",
          customStartDate: 1,
          customEndDate: 2,
          liveEndTime: true,
        },
        9000000,
      ),
    ).toEqual({ startDate: 1, endDate: 9000 });
  });

  it("按本地日期展示用量，支持键盘查看与切换指标", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    trends.mockReturnValue({
      isLoading: false,
      data: [
        {
          date: today.toISOString(),
          requestCount: 3,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalCacheCreationTokens: 10,
          totalCacheReadTokens: 20,
          totalCost: "1.5",
        },
      ],
    });
    render(<UsageHeatmap appType="codex" refreshIntervalMs={0} />);
    expect(trends).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "custom", liveEndTime: true }),
      { appType: "codex" },
      { refetchInterval: false },
    );
    const day = document.querySelector('[aria-label$=": 180"]')!;
    expect(day).toHaveAttribute("tabindex", "0");
    fireEvent.focus(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("180");
    fireEvent.blur(day);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "usage.trend.requests" }),
    );
    expect(document.querySelector('[aria-label$=": 3"]')).toBeInTheDocument();
  });
});
