import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAppMode = vi.fn();

vi.mock("@/lib/api/proxy", () => ({
  proxyApi: { getAppMode: (...args: unknown[]) => getAppMode(...args) },
}));

import { useAppModeView } from "@/hooks/useAppMode";
import { appModeQueryKey, isAppModeQueryKey } from "@/lib/query/appModeKeys";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("模式视图查询键", () => {
  beforeEach(() => {
    getAppMode.mockReset();
    getAppMode.mockResolvedValue({ mode: "direct" });
  });

  it("挂在供应商列表前缀下，失效列表时连带重取（不靠轮询）", async () => {
    const { client, wrapper } = setup();
    renderHook(() => useAppModeView("codex"), { wrapper });
    await waitFor(() => expect(getAppMode).toHaveBeenCalledTimes(1));

    await client.invalidateQueries({ queryKey: ["providers", "codex"] });
    await waitFor(() => expect(getAppMode).toHaveBeenCalledTimes(2));

    // 别的应用的列表失效不影响
    await client.invalidateQueries({ queryKey: ["providers", "claude"] });
    expect(getAppMode).toHaveBeenCalledTimes(2);
  });

  it("isAppModeQueryKey 只认模式视图", () => {
    expect(isAppModeQueryKey(appModeQueryKey("claude"))).toBe(true);
    expect(isAppModeQueryKey(["providers", "claude"])).toBe(false);
    expect(isAppModeQueryKey(["providers", "claude", "direct"])).toBe(false);
  });
});
