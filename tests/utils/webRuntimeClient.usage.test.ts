import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWebExchangeRates,
  getWebModelStats,
  getWebProviderStats,
  getWebUsageFirstDate,
  getWebUsageSummary,
  getWebUsageSummaryByApp,
  getWebUsageTrends,
} from "@/lib/runtime/client/web";

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("web runtime usage requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the dashboard scope filters to every stats route", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okJson([]));
    vi.stubGlobal("fetch", fetchMock);

    await getWebUsageSummary(10, 20, "codex", "Packy & Co", "gpt-5.5");
    await getWebUsageTrends(10, 20, undefined, "Packy & Co");
    await getWebProviderStats(10, 20, "claude", undefined, "claude-sonnet-4-6");
    await getWebModelStats(undefined, undefined, undefined, "Codex (Session)");
    await getWebUsageSummaryByApp(10, 20, "Packy & Co", "gpt-5.5");

    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual([
      "/api/usage/summary?startDate=10&endDate=20&appType=codex&providerName=Packy+%26+Co&model=gpt-5.5",
      "/api/usage/trends?startDate=10&endDate=20&providerName=Packy+%26+Co",
      "/api/usage/provider-stats?startDate=10&endDate=20&appType=claude&model=claude-sonnet-4-6",
      "/api/usage/model-stats?providerName=Codex+%28Session%29",
      "/api/usage/summary-by-app?startDate=10&endDate=20&providerName=Packy+%26+Co&model=gpt-5.5",
    ]);
  });

  it("reads the first usage date and exchange rates from the service", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => okJson("2025-11-02"))
      .mockImplementationOnce(async () =>
        okJson({
          rates: { CNY: 6.9 },
          fetchedAt: 1_700_000_000_000,
          source: "open.er-api.com",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWebUsageFirstDate("claude")).resolves.toBe("2025-11-02");
    await expect(fetchWebExchangeRates()).resolves.toEqual({
      rates: { CNY: 6.9 },
      fetchedAt: 1_700_000_000_000,
      source: "open.er-api.com",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/usage/first-date?appType=claude",
      "/api/usage/exchange-rates",
    ]);
  });
});
