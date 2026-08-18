import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCodexOauthQuotaByAccountId } from "@/lib/query/subscription";

const useQuery = vi.hoisted(() => vi.fn((options: unknown) => options));

vi.mock("@tanstack/react-query", () => ({ useQuery }));
vi.mock("@/lib/api/subscription", () => ({
  subscriptionApi: { getCodexOauthQuota: vi.fn() },
}));

describe("useCodexOauthQuotaByAccountId", () => {
  beforeEach(() => {
    useQuery.mockClear();
  });

  it("按配置分钟数设置自动轮询和缓存时效", () => {
    useCodexOauthQuotaByAccountId("account-1", {
      autoQuery: true,
      autoQueryIntervalMinutes: 12,
    });

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: 12 * 60 * 1000,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: true,
        staleTime: 12 * 60 * 1000,
      }),
    );
  });

  it("间隔为 0 时关闭自动轮询和窗口聚焦刷新", () => {
    useCodexOauthQuotaByAccountId("account-1", {
      autoQuery: true,
      autoQueryIntervalMinutes: 0,
    });

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
      }),
    );
  });

  it("正数间隔最小按 1 分钟处理", () => {
    useCodexOauthQuotaByAccountId("account-1", {
      autoQuery: true,
      autoQueryIntervalMinutes: 0.5,
    });

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: 60 * 1000,
        staleTime: 60 * 1000,
      }),
    );
  });
});
