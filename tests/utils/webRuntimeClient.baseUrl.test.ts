import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebApiBase } from "@/lib/runtime/client/web";

describe("Web API 地址", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未配置时使用页面同源 API", () => {
    vi.stubEnv("VITE_LOCAL_API_BASE", "");

    expect(getWebApiBase()).toBe("");
  });

  it("显式配置时使用配置地址并移除末尾斜杠", () => {
    vi.stubEnv("VITE_LOCAL_API_BASE", "https://api.example.com///");

    expect(getWebApiBase()).toBe("https://api.example.com");
  });
});
