import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeWindowActivity } from "@/lib/windowActivity";

let visible = true;

describe("initializeWindowActivity", () => {
  afterEach(() => vi.useRealTimers());

  it("标签页隐藏后停止状态心跳", () => {
    vi.useFakeTimers();
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

  it("状态没变时重复的焦点事件不重启心跳", () => {
    vi.useFakeTimers();
    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.dataset.windowActive).toBe("true");

    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
    expect(document.documentElement.dataset.statusHeartbeat).toBe("true");
  });
});
