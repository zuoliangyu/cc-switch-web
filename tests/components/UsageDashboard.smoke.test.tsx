import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

/**
 * 不 mock 子组件，把整页（指标、趋势图、四个页签）真渲染一遍，接口用假数据。
 */

const usageApiMock = vi.hoisted(() => ({
  getUsageSummary: vi.fn(),
  getUsageSummaryByApp: vi.fn(),
  getUsageTrends: vi.fn(),
  getProviderStats: vi.fn(),
  getModelStats: vi.fn(),
  getRequestLogs: vi.fn(),
  getRequestDetail: vi.fn(),
  getModelPricing: vi.fn(),
  getModelsDevSyncConfig: vi.fn(),
  saveModelsDevSyncConfig: vi.fn(),
  syncSessionUsage: vi.fn(),
  getSessionUsageLastSync: vi.fn().mockResolvedValue(null),
  rebuildCodexUsage: vi.fn(),
}));

// t 要稳定：真实的 i18next 也只在切语言时换 t，组件里有依赖 t 的 effect
const i18nMock = vi.hoisted(() => ({
  t: (key: string, options?: unknown) =>
    options && typeof options === "object" && "count" in options
      ? `${key}:${(options as { count: unknown }).count}`
      : key,
  i18n: { resolvedLanguage: "zh", language: "zh" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => i18nMock,
}));

vi.mock("@/lib/api/usage", () => ({ usageApi: usageApiMock }));

vi.mock("@/lib/api/proxy", () => ({
  proxyApi: {
    getPricingModelSource: vi.fn().mockResolvedValue("response"),
    setPricingModelSource: vi.fn().mockResolvedValue(undefined),
  },
}));

const summary = {
  totalRequests: 3120,
  totalCost: "42.100000",
  totalInputTokens: 1_000_000,
  totalOutputTokens: 400_000,
  totalCacheCreationTokens: 200_000,
  totalCacheReadTokens: 16_600_000,
  successRate: 99.5,
  realTotalTokens: 18_200_000,
  cacheHitRate: 0.7161,
};

describe("UsageDashboard (smoke)", () => {
  beforeEach(() => {
    usageApiMock.syncSessionUsage.mockReset().mockResolvedValue({
      imported: 0,
      filesScanned: 0,
      errors: [],
    });
    usageApiMock.getUsageSummary.mockResolvedValue(summary);
    usageApiMock.getUsageSummaryByApp.mockResolvedValue([
      { appType: "claude", summary },
    ]);
    usageApiMock.getUsageTrends.mockResolvedValue([
      {
        date: "2026-09-30T00:00:00+08:00",
        requestCount: 290,
        totalCost: "4.1",
        totalTokens: 1_800_000,
        totalInputTokens: 100_000,
        totalOutputTokens: 50_000,
        totalCacheCreationTokens: 10_000,
        totalCacheReadTokens: 1_640_000,
      },
    ]);
    usageApiMock.getProviderStats.mockResolvedValue([
      {
        providerId: "p1",
        appType: "claude",
        providerName: "DeepSeek",
        requestCount: 720,
        totalTokens: 4_300_000,
        totalCost: "6.1",
        successRate: 99.4,
        avgLatencyMs: 9000,
        speedOutputTokens: 92_000,
        speedGenerationMs: 1_000_000,
      },
    ]);
    usageApiMock.getModelStats.mockResolvedValue([
      {
        model: "kimi-k2.6",
        requestCount: 980,
        totalTokens: 5_700_000,
        totalCost: "11.2",
        avgCostPerRequest: "0.0114",
        successRate: 100,
      },
    ]);
    usageApiMock.getRequestLogs.mockResolvedValue({
      data: [],
      total: 0,
      page: 0,
      pageSize: 20,
    });
    usageApiMock.getModelPricing.mockResolvedValue([
      {
        modelId: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        inputCostPerMillion: "1.32",
        outputCostPerMillion: "3.96",
        cacheReadCostPerMillion: "0.044",
        cacheCreationCostPerMillion: "0",
      },
    ]);
    usageApiMock.getModelsDevSyncConfig.mockResolvedValue({
      configPath: "/tmp/model-pricing.json",
      config: {
        autoSyncEnabled: true,
        includeCommonModels: true,
        selectedModelKeys: [],
        excludedCommonModelKeys: [],
        lastSyncAt: Date.now() - 2 * 60 * 60 * 1000,
        lastSyncError: null,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Web 的服务端不推送「有新用量」事件：每轮扫描结束都重读整页统计，导入的用量这样出现
  it("scans session logs on open and shows imported usage after the scan", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    usageApiMock.syncSessionUsage.mockImplementation(async () => {
      usageApiMock.getUsageSummaryByApp.mockResolvedValue([
        { appType: "claude", summary: { ...summary, totalCost: "43.1" } },
      ]);
      return { imported: 1, filesScanned: 1, errors: [] };
    });
    render(
      <QueryClientProvider client={client}>
        <UsageDashboard refreshIntervalMs={5000} />
      </QueryClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(usageApiMock.syncSessionUsage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("$43.10")).toBeInTheDocument();
    client.clear();
  });

  it("scans at the interval and re-reads statistics after every scan", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    usageApiMock.syncSessionUsage.mockResolvedValue({
      imported: 0,
      filesScanned: 1,
      errors: [],
    });
    render(
      <QueryClientProvider client={client}>
        <UsageDashboard refreshIntervalMs={5000} />
      </QueryClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    const queries = [
      usageApiMock.getUsageSummary,
      usageApiMock.getUsageSummaryByApp,
      usageApiMock.getUsageTrends,
      usageApiMock.getProviderStats,
      usageApiMock.getModelStats,
      usageApiMock.getRequestLogs,
    ];
    const counts = queries.map((query) => query.mock.calls.length);
    // 三个页签的计数都查，没打开的页签也有数字
    expect(counts.every((count) => count > 0)).toBe(true);
    // Web 没有推送：每轮扫描后整页统计都重读一次（上游没有新用量时不重查）
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(queries.map((query) => query.mock.calls.length)).toEqual(
      counts.map((count) => count + 1),
    );
    expect(usageApiMock.syncSessionUsage).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("never scans while auto scanning is off but still re-reads statistics", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <UsageDashboard
          refreshIntervalMs={5000}
          sessionAutoSyncEnabled={false}
        />
      </QueryClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    const before = usageApiMock.getUsageSummaryByApp.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(usageApiMock.syncSessionUsage).not.toHaveBeenCalled();
    // 关掉自动扫描后 Web 仍按间隔重读统计（服务端不推送，这是唯一的刷新来源）
    expect(usageApiMock.getUsageSummaryByApp.mock.calls.length).toBe(
      before + 1,
    );
    client.clear();
  });

  it("renders metrics, trend, every tab and pricing with real children", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <UsageDashboard />
      </QueryClientProvider>,
    );

    // 指标卡
    expect(await screen.findByText("$42.10")).toBeInTheDocument();
    expect(screen.getByText("18.2M")).toBeInTheDocument();
    // 「全部」时由各应用的 token 重新算：16.6M ÷ (1M + 0.2M + 16.6M)
    expect(screen.getByText("93.3%")).toBeInTheDocument();
    expect(screen.getByText("usage.trend.titleMetric")).toBeInTheDocument();

    // Tokens 的 4 个组成部分默认收起（整行 inert），展开后占第二行
    const more = screen.getByRole("button", { name: "usage.metrics.more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const cacheWriteLabel = screen.getByText("usage.logColumns.cacheWrite");
    expect(cacheWriteLabel.closest("[inert]")).not.toBeNull();
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(cacheWriteLabel.closest("[inert]")).toBeNull();
    // 点指标格切换图表画的指标
    const costCell = screen.getByRole("button", { name: /^usage\.totalCost / });
    expect(costCell).toHaveAttribute("aria-pressed", "false");
    await user.click(costCell);
    expect(costCell).toHaveAttribute("aria-pressed", "true");

    // 供应商：汇总速度 92000 / 1000 s = 92 tok/s
    await user.click(
      screen.getByRole("tab", { name: /^usage\.tabs\.providers/ }),
    );
    // 应用筛选条上也有一个 DeepSeek 图标（图标的 <title> 同样是 "DeepSeek"），
    // 所以只在表格行里认供应商行。
    const providerRow = (await screen.findAllByText("DeepSeek"))
      .map((element) => element.closest("tr"))
      .find((row) => row !== null) as HTMLTableRowElement;
    expect(within(providerRow).getByText("92")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^usage\.tabs\.models/ }));
    expect(await screen.findByText("kimi-k2.6")).toBeInTheDocument();

    // 定价：用量设置抽屉 → 管理定价
    await user.click(
      screen.getByRole("button", { name: "usage.settings.title" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "usage.settings.managePricing",
      }),
    );
    expect(await screen.findByText("DeepSeek V4 Pro")).toBeInTheDocument();
    expect(screen.getByText("$1.32")).toBeInTheDocument();
    expect(screen.getByText("$0.044")).toBeInTheDocument();
    // Web 的定价页沿用自己的版式（models.dev 同步面板没有上游的标题行），这里只认定价表
  });
});
