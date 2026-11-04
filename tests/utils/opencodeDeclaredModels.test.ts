import { describe, expect, it } from "vitest";
import { getOpencodeDeclaredModels } from "@/components/providers/forms/helpers/opencodeFormUtils";

describe("getOpencodeDeclaredModels", () => {
  it("reads models from the stored provider fragment", () => {
    expect(
      getOpencodeDeclaredModels("relay", {
        npm: "@ai-sdk/openai-compatible",
        models: { "m-1": { name: "Model 1" }, "m-2": {} },
      }),
    ).toEqual([{ id: "m-1", name: "Model 1" }, { id: "m-2" }]);
  });

  it("unwraps a stored full config and skips natively disabled models", () => {
    expect(
      getOpencodeDeclaredModels("relay", {
        $schema: "https://opencode.ai/config.json",
        providers: {
          relay: {
            models: { keep: {}, off: { disabled: true }, " ": {} },
          },
        },
      }),
    ).toEqual([{ id: "keep" }]);
  });

  it("returns nothing for providers without models", () => {
    expect(getOpencodeDeclaredModels("relay", { npm: "x" })).toEqual([]);
    expect(getOpencodeDeclaredModels("relay", null)).toEqual([]);
  });
});
