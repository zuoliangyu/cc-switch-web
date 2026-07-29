import { describe, expect, it } from "vitest";
import {
  rebaseOpenClawSuggestedDefaults,
  type OpenClawSuggestedDefaults,
} from "@/config/openclawProviderPresets";

describe("rebaseOpenClawSuggestedDefaults", () => {
  it("按实际 Provider Key 重写主模型、回退模型和模型目录", () => {
    const defaults: OpenClawSuggestedDefaults = {
      model: {
        primary: "builtin/model-a",
        fallbacks: ["builtin/model-b", "model-c"],
      },
      modelCatalog: {
        "builtin/model-a": { alias: "A" },
        "builtin/model-b": { alias: "B" },
      },
    };

    expect(rebaseOpenClawSuggestedDefaults(defaults, "custom-key")).toEqual({
      model: {
        primary: "custom-key/model-a",
        fallbacks: ["custom-key/model-b", "custom-key/model-c"],
      },
      modelCatalog: {
        "custom-key/model-a": { alias: "A" },
        "custom-key/model-b": { alias: "B" },
      },
    });
    expect(defaults.model?.primary).toBe("builtin/model-a");
  });
});
