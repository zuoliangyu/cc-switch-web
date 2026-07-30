import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWebAccessKey,
  getWebApiBase,
  getWebSettings,
  setWebAccessKey,
} from "@/lib/runtime/client/web";

describe("Web API 地址", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearWebAccessKey();
    vi.unstubAllGlobals();
  });

  it("未配置时使用页面同源 API", () => {
    vi.stubEnv("VITE_LOCAL_API_BASE", "");

    expect(getWebApiBase()).toBe("");
  });

  it("显式配置时使用配置地址并移除末尾斜杠", () => {
    vi.stubEnv("VITE_LOCAL_API_BASE", "https://api.example.com///");

    expect(getWebApiBase()).toBe("https://api.example.com");
  });

  it("已登录时为 API 请求附加 Bearer 密钥", async () => {
    vi.stubEnv("VITE_LOCAL_API_BASE", "");
    setWebAccessKey("correct-access-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ firstRunNoticeConfirmed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getWebSettings();

    expect(fetchMock).toHaveBeenCalledWith("/api/settings", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer correct-access-key",
      },
    });
  });
});
