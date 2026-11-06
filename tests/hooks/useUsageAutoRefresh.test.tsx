import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { useUsageAutoRefresh } from "@/hooks/useUsageAutoRefresh";
import { usageApi } from "@/lib/api/usage";
import { usageKeys } from "@/lib/query/usage";
import type { SessionSyncResult } from "@/types/usage";

// 改写自上游 cc-switch tests/hooks/useUsageAutoRefresh.test.tsx：Web 没有
// usage-log-recorded 推送，每轮结束重读整页统计（usageKeys.all），自动扫描关着时只重读
vi.mock("@/lib/api/usage", () => ({
  usageApi: { syncSessionUsage: vi.fn() },
}));

const syncResult: SessionSyncResult = {
  imported: 1,
  skipped: 0,
  filesScanned: 1,
  suspectedDuplicates: 0,
  deferredFiles: 0,
  errors: [],
};
const syncMock = vi.mocked(usageApi.syncSessionUsage);
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("useUsageAutoRefresh", () => {
  let client: QueryClient;
  let invalidate: MockInstance<QueryClient["invalidateQueries"]>;

  function wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidate = vi.spyOn(client, "invalidateQueries");
    syncMock.mockReset().mockResolvedValue(syncResult);
  });

  afterEach(() => {
    cleanup();
    client.clear();
    focusManager.setFocused(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([5000, 10000, 30000, 60000])(
    "scans on open, then every %i ms",
    async (refreshIntervalMs) => {
      renderHook(
        () =>
          useUsageAutoRefresh({
            refreshIntervalMs,
            sessionAutoSyncEnabled: true,
          }),
        { wrapper },
      );
      await flush();
      expect(syncMock).toHaveBeenCalledTimes(1);
      // 没有后端推送：扫完重读整页统计
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: usageKeys.all });
      await advance(refreshIntervalMs - 1);
      expect(syncMock).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(syncMock).toHaveBeenCalledTimes(2);
      await advance(refreshIntervalMs);
      expect(syncMock).toHaveBeenCalledTimes(3);
    },
  );

  it("scans right away and reschedules when the interval changes", async () => {
    const { rerender } = renderHook(
      ({ interval }) =>
        useUsageAutoRefresh({
          refreshIntervalMs: interval,
          sessionAutoSyncEnabled: true,
        }),
      { wrapper, initialProps: { interval: 60000 } },
    );
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(1);
    await advance(1000);
    rerender({ interval: 5000 });
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(syncMock).toHaveBeenCalledTimes(3);
  });

  it("only re-reads statistics while session auto-sync is off", async () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useUsageAutoRefresh({
          refreshIntervalMs: 5000,
          sessionAutoSyncEnabled: enabled,
        }),
      { wrapper, initialProps: { enabled: false } },
    );
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(1);
    await advance(20000);
    expect(syncMock).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(5);
    rerender({ enabled: true });
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await advance(20000);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("waits for a slow scan and shares it with manual sync without queueing more scans", async () => {
    let finish!: (result: SessionSyncResult) => void;
    syncMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(
      () =>
        useUsageAutoRefresh({
          refreshIntervalMs: 5000,
          sessionAutoSyncEnabled: true,
        }),
      { wrapper },
    );
    await flush();
    const manualSync = result.current.syncSessionUsage();
    await advance(20000);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      finish(syncResult);
      await manualSync;
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("skips hidden windows, rescans once visible, and pauses during a rebuild", async () => {
    focusManager.setFocused(false);
    const { rerender } = renderHook(
      ({ paused }) =>
        useUsageAutoRefresh({
          refreshIntervalMs: 5000,
          sessionAutoSyncEnabled: true,
          paused,
        }),
      { wrapper, initialProps: { paused: false } },
    );
    await advance(10000);
    expect(syncMock).not.toHaveBeenCalled();
    act(() => focusManager.setFocused(true));
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(1);
    rerender({ paused: true });
    await advance(10000);
    expect(syncMock).toHaveBeenCalledTimes(1);
    rerender({ paused: false });
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it.each(["disable", "unmount"] as const)(
    "ignores a pending scan after %s",
    async (action) => {
      let finish!: (result: SessionSyncResult) => void;
      syncMock.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { rerender, unmount } = renderHook(
        ({ enabled }) =>
          useUsageAutoRefresh({
            refreshIntervalMs: 5000,
            sessionAutoSyncEnabled: enabled,
          }),
        { wrapper, initialProps: { enabled: true } },
      );
      await flush();
      if (action === "disable") rerender({ enabled: false });
      else unmount();
      // 关掉自动扫描后仍按间隔重读，但在途的那次扫描结束时不再额外重读
      const before = invalidate.mock.calls.length;
      await act(async () => {
        finish(syncResult);
      });
      expect(invalidate).toHaveBeenCalledTimes(before);
      await advance(60000);
      expect(syncMock).toHaveBeenCalledTimes(1);
      if (action === "unmount") expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it("re-runs usage queries every minute for rolling ranges, even when paused", async () => {
    const { rerender } = renderHook(
      ({ rolling }) =>
        useUsageAutoRefresh({
          refreshIntervalMs: 5000,
          sessionAutoSyncEnabled: false,
          paused: true,
          rollingRange: rolling,
        }),
      { wrapper, initialProps: { rolling: true } },
    );
    await advance(59_999);
    expect(invalidate).not.toHaveBeenCalled();
    await advance(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: usageKeys.all });
    focusManager.setFocused(false);
    await advance(60_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    focusManager.setFocused(true);
    rerender({ rolling: false });
    await advance(120_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("still re-reads statistics after a scan error and retries next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    syncMock.mockRejectedValueOnce(new Error("scan failed"));
    renderHook(
      () =>
        useUsageAutoRefresh({
          refreshIntervalMs: 5000,
          sessionAutoSyncEnabled: true,
        }),
      { wrapper },
    );
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
