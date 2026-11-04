import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { Provider } from "@/types";
import { getRoutingReason } from "@/utils/routingReason";

const t = ((key: string) => key) as unknown as TFunction;

const provider = (overrides: Partial<Provider> = {}): Provider => ({
  id: "p1",
  name: "Test",
  settingsConfig: {},
  ...overrides,
});

describe("getRoutingReason", () => {
  it("不需要路由时返回 null", () => {
    expect(getRoutingReason("claude", provider(), t)).toBeNull();
    expect(getRoutingReason("opencode", provider(), t)).toBeNull();
  });

  it("按协议、托管登录与 Desktop 映射给出原因", () => {
    expect(
      getRoutingReason(
        "claude",
        provider({ meta: { apiFormat: "gemini_native" } }),
        t,
      ),
    ).toBe("notifications.proxyReasonGeminiNative");
    expect(
      getRoutingReason(
        "codex",
        provider({ meta: { providerType: "codex_oauth" } }),
        t,
      ),
    ).toBe("notifications.proxyReasonManagedOAuth");
    expect(
      getRoutingReason(
        "claude-desktop",
        provider({ meta: { claudeDesktopMode: "proxy" } }),
        t,
      ),
    ).toBe("notifications.proxyReasonDesktopMapping");
  });
});
