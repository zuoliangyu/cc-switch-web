import { describe, expect, it } from "vitest";
import type { Provider } from "@/types";
import { providerNeedsRouting } from "@/utils/providerCapabilities";

const provider = (overrides: Partial<Provider> = {}): Provider => ({
  id: "p1",
  name: "Test",
  settingsConfig: {},
  ...overrides,
});

const codexConfig = (wireApi: string) =>
  `model_provider = "custom"\n\n[model_providers.custom]\nwire_api = "${wireApi}"\n`;

describe("providerNeedsRouting", () => {
  it("官方供应商不需要路由", () => {
    expect(
      providerNeedsRouting(
        "claude",
        provider({
          category: "official",
          meta: { providerType: "codex_oauth" },
        }),
      ),
    ).toBe(false);
  });

  it.each(["codex_oauth", "github_copilot"])(
    "托管 OAuth %s 不受 apiFormat 影响",
    (providerType) => {
      expect(
        providerNeedsRouting(
          "claude",
          provider({ meta: { providerType, apiFormat: "anthropic" } }),
        ),
      ).toBe(true);
    },
  );

  it("Claude 原生 Anthropic 可直连，其它格式需要路由", () => {
    expect(
      providerNeedsRouting(
        "claude",
        provider({ meta: { apiFormat: "anthropic" } }),
      ),
    ).toBe(false);
    expect(
      providerNeedsRouting(
        "claude",
        provider({ meta: { apiFormat: "openai_chat" } }),
      ),
    ).toBe(true);
  });

  it.each(["chat_completions", "anthropic_messages"])(
    "Codex wire_api=%s 需要路由",
    (wireApi) => {
      expect(
        providerNeedsRouting(
          "codex",
          provider({ settingsConfig: { config: codexConfig(wireApi) } }),
        ),
      ).toBe(true);
    },
  );

  it("Codex Responses 可直连", () => {
    expect(
      providerNeedsRouting(
        "codex",
        provider({ settingsConfig: { config: codexConfig("responses") } }),
      ),
    ).toBe(false);
  });
});
