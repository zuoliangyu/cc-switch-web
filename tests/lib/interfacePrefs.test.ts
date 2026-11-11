import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 模块加载时就读 localStorage，每个用例重新加载一次
async function load() {
  vi.resetModules();
  return import("@/lib/interfacePrefs");
}

describe("interfacePrefs", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.density;
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.density;
  });

  it("defaults to compact density", async () => {
    const prefs = await load();
    prefs.initializeInterfacePrefs();

    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("applies the stored density on startup", async () => {
    localStorage.setItem("cc-switch-density", "comfortable");
    const prefs = await load();
    prefs.initializeInterfacePrefs();

    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("ignores a stored value that is not a known density", async () => {
    localStorage.setItem("cc-switch-density", "spacious");
    const prefs = await load();
    prefs.initializeInterfacePrefs();

    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("persists a density change and applies it to <html>", async () => {
    const prefs = await load();
    prefs.setDensity("comfortable");

    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(localStorage.getItem("cc-switch-density")).toBe("comfortable");
  });

  it("lets the density-aware heights override caller heights in cn()", async () => {
    const { cn } = await import("@/lib/utils");
    // 调用方传 h-8 要能盖掉按钮自带的 h-control，反过来也一样
    expect(cn("h-control px-4", "h-8")).toBe("px-4 h-8");
    expect(cn("h-9", "h-control-sm")).toBe("h-control-sm");
    expect(cn("min-h-card", "min-h-[40px]")).toBe("min-h-[40px]");
  });
});
