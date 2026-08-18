import { describe, expect, it } from "vitest";
import {
  buildUsageTrendChartData,
  formatUsageTrendTickLabel,
} from "@/components/usage/UsageTrendChart";

const day = (isoDate: string) => ({
  date: `${isoDate}T12:00:00.000Z`,
  totalInputTokens: 100,
  totalOutputTokens: 50,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalCost: "0.01",
});

describe("buildUsageTrendChartData", () => {
  it("跨年同月同日仍使用唯一分类键", () => {
    const startDate = Date.parse("2025-01-01T00:00:00Z") / 1000;
    const endDate = Date.parse("2026-08-10T00:00:00Z") / 1000;
    const points = buildUsageTrendChartData(
      [day("2025-04-27"), day("2026-04-27")],
      { isHourly: false, dateLocale: "en-US", startDate, endDate },
    );

    expect(points).toHaveLength(2);
    expect(points[0].xKey).not.toBe(points[1].xKey);
    expect(points[0].xKey).toContain("2025-04-27");
    expect(points[1].xKey).toContain("2026-04-27");
    expect(points[0].tooltipLabel).toMatch(/2025/);
    expect(points[1].tooltipLabel).toMatch(/2026/);
  });

  it("仅在选中范围跨年时给轴标签增加年份", () => {
    const point = day("2026-04-27");
    const multiYear = buildUsageTrendChartData([point], {
      isHourly: false,
      dateLocale: "en-US",
      startDate: Date.parse("2025-01-01T00:00:00Z") / 1000,
      endDate: Date.parse("2026-08-10T00:00:00Z") / 1000,
    });
    const singleYear = buildUsageTrendChartData([point], {
      isHourly: false,
      dateLocale: "en-US",
      startDate: Date.parse("2026-01-01T00:00:00Z") / 1000,
      endDate: Date.parse("2026-08-10T00:00:00Z") / 1000,
    });

    expect(multiYear[0].label).toMatch(/26|2026/);
    expect(singleYear[0].label).not.toMatch(/2026/);
    expect(singleYear[0].tooltipLabel).toMatch(/2026/);
  });
});

describe("formatUsageTrendTickLabel", () => {
  it("按唯一分类键解析被抽稀后的刻度", () => {
    const points = buildUsageTrendChartData(
      [day("2025-01-01"), day("2025-04-27"), day("2026-04-27")],
      {
        isHourly: false,
        dateLocale: "en-US",
        startDate: Date.parse("2025-01-01T00:00:00Z") / 1000,
        endDate: Date.parse("2026-08-10T00:00:00Z") / 1000,
      },
    );
    const last = points[2];

    expect(formatUsageTrendTickLabel(last.xKey, points)).toBe(last.label);
    expect(formatUsageTrendTickLabel(last.xKey, points)).not.toBe(
      points[0].label,
    );
  });
});
