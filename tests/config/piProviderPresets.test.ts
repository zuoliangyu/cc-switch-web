import { describe, expect, it } from "vitest";
import { piProviderPresets } from "@/config/piProviderPresets";

describe("Pi Provider 离线预设", () => {
  it("为每个模型提供完整能力和显式思考映射", () => {
    expect(piProviderPresets.length).toBeGreaterThan(0);
    for (const preset of piProviderPresets) {
      const models = preset.config.models as Array<Record<string, unknown>>;
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(model).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          reasoning: expect.any(Boolean),
          input: expect.any(Array),
          contextWindow: expect.any(Number),
          maxTokens: expect.any(Number),
        });
        if (model.reasoning) {
          expect(model).toHaveProperty("thinkingLevelMap");
        }
      }
    }
  });
});
