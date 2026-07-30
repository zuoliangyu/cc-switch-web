import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isHermesReadOnlyProvider } from "@/config/hermesProviderPresets";
import { useHermesFormState } from "@/components/providers/forms/hooks/useHermesFormState";

vi.mock("@/lib/query/queries", () => ({
  useProvidersQuery: () => ({
    data: { providers: { existing: {}, editing: {} } },
  }),
}));

describe("Hermes Provider 前端状态", () => {
  it("识别 providers: dict 的只读 overlay", () => {
    expect(isHermesReadOnlyProvider({ _cc_source: "providers_dict" })).toBe(
      true,
    );
    expect(isHermesReadOnlyProvider({ _cc_source: "custom_providers" })).toBe(
      false,
    );
  });

  it("以 snake_case 保存协议、模型和请求间隔", () => {
    let config = JSON.stringify({ name: "demo", untouched: true });
    const { result } = renderHook(() =>
      useHermesFormState({
        appId: "hermes",
        providerId: "editing",
        initialData: { settingsConfig: JSON.parse(config) },
        getSettingsConfig: () => config,
        onSettingsConfigChange: (next) => {
          config = next;
        },
      }),
    );

    act(() => {
      result.current.handleHermesBaseUrlChange("https://api.example.com/v1/");
      result.current.handleHermesApiKeyChange("secret");
      result.current.handleHermesApiModeChange("anthropic_messages");
      result.current.handleHermesModelsChange([
        { id: "claude-opus", name: "Opus", context_length: 200_000 },
      ]);
      result.current.handleHermesRateLimitDelayChange(0.5);
    });

    expect(JSON.parse(config)).toEqual({
      name: "demo",
      untouched: true,
      base_url: "https://api.example.com/v1",
      api_key: "secret",
      api_mode: "anthropic_messages",
      models: [{ id: "claude-opus", name: "Opus", context_length: 200_000 }],
      rate_limit_delay: 0.5,
    });
    expect(result.current.existingHermesKeys).toEqual(["existing"]);
  });
});
