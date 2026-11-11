import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppServerEvents } from "@/hooks/useAppServerEvents";
import { useServerEvent } from "@/hooks/useServerEvent";
import { proxyKeys } from "@/lib/query/proxy";
import { emitRuntimeEvent } from "../msw/runtimeMocks";

const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, warning: toastWarning },
}));

function setup() {
  const client = new QueryClient();
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

const flush = () => act(async () => {});

describe("useServerEvent", () => {
  afterEach(cleanup);

  it("calls the latest handler and stops after unmount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ handler }) => useServerEvent("test-event", handler),
      { initialProps: { handler: first } },
    );
    await flush();
    rerender({ handler: second });
    act(() => emitRuntimeEvent("test-event", { n: 1 }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ n: 1 });
    unmount();
    act(() => emitRuntimeEvent("test-event", { n: 2 }));
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useAppServerEvents", () => {
  afterEach(() => {
    cleanup();
    toastError.mockReset();
    toastWarning.mockReset();
  });

  it("refreshes the provider list and mode view on provider-switched", async () => {
    const { invalidate, wrapper } = setup();
    renderHook(() => useAppServerEvents(), { wrapper });
    await flush();
    await act(async () => {
      emitRuntimeEvent("provider-switched", {
        appType: "codex",
        providerId: "p2",
        source: "failover",
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["providers", "codex"],
    });
  });

  it("refreshes profile, resource and proxy caches on profile-applied", async () => {
    const { invalidate, wrapper } = setup();
    renderHook(() => useAppServerEvents(), { wrapper });
    await flush();
    await act(async () => {
      emitRuntimeEvent("profile-applied", { profileId: "x", scope: "claude" });
    });
    for (const queryKey of [
      ["profiles"],
      ["mcp", "all"],
      ["skills"],
      proxyKeys.takeoverStatus,
      proxyKeys.status,
      ["providers", "claude-desktop"],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("toasts only failed automatic WebDAV syncs", async () => {
    const { invalidate, wrapper } = setup();
    renderHook(() => useAppServerEvents(), { wrapper });
    await flush();
    await act(async () => {
      emitRuntimeEvent("webdav-sync-status-updated", {
        source: "auto",
        status: "success",
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["settings"] });
    expect(toastError).not.toHaveBeenCalled();
    await act(async () => {
      emitRuntimeEvent("webdav-sync-status-updated", {
        source: "auto",
        status: "error",
        error: "boom",
      });
    });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("warns when the system proxy hijacks the local route", async () => {
    const { wrapper } = setup();
    renderHook(() => useAppServerEvents(), { wrapper });
    await flush();
    await act(async () => {
      emitRuntimeEvent("proxy-loopback-hijacked", {
        appType: "codex",
        origin: "http://127.0.0.1:15721",
      });
    });
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning.mock.calls[0][1]).toEqual({ duration: 15000 });
  });

  it("invalidates everything on resync and universal provider changes", async () => {
    const { invalidate, wrapper } = setup();
    renderHook(() => useAppServerEvents(), { wrapper });
    await flush();
    await act(async () => {
      emitRuntimeEvent("universal-provider-synced", {
        action: "upsert",
        id: "u1",
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["providers"] });
    invalidate.mockClear();
    await act(async () => {
      emitRuntimeEvent("resync", null);
    });
    expect(invalidate).toHaveBeenCalledWith();
  });
});
