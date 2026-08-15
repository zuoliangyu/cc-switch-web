import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeWindowActivity } from "@/lib/windowActivity";

describe("initializeWindowActivity", () => {
  afterEach(() => vi.useRealTimers());

  it("标签页隐藏后停止状态心跳", () => {
    vi.useFakeTimers();
    let visible = true;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });

    initializeWindowActivity();
    vi.advanceTimersByTime(3000);
    expect(document.documentElement.dataset.statusHeartbeat).toBe("true");

    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.dataset.windowActive).toBe("false");
    expect(document.documentElement.dataset.statusHeartbeat).toBeUndefined();
  });
});
