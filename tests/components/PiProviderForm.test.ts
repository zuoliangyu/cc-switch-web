import { describe, expect, it } from "vitest";
import {
  mergePiProviderSettings,
  validatePiModels,
} from "@/components/providers/forms/PiProviderForm";

const model = {
  id: "model-a",
  name: "Model A",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 32000,
  thinkingLevelMap: { off: null, high: "high" },
  futureModelField: { keep: true },
};

describe("Pi Provider 配置", () => {
  it("合并结构化字段时保留未知字段和稀疏思考映射", () => {
    const result = mergePiProviderSettings(
      {
        futureProviderField: { keep: true },
        headers: { Old: "remove" },
      },
      {
        name: " Example ",
        baseUrl: " https://api.example.com/v1 ",
        apiKey: "secret",
        api: "openai-responses",
        headers: { Authorization: "Bearer test" },
        models: [model],
      },
    );

    expect(result).toMatchObject({
      name: "Example",
      baseUrl: "https://api.example.com/v1",
      futureProviderField: { keep: true },
      headers: { Authorization: "Bearer test" },
      models: [model],
    });
    expect((result.models as (typeof model)[])[0].thinkingLevelMap).toEqual({
      off: null,
      high: "high",
    });
  });

  it("拒绝缺少能力字段和非法 thinkingLevelMap 的自定义模型", () => {
    expect(
      validatePiModels([{ id: "incomplete", name: "Incomplete" }]),
    ).toBeTruthy();
    expect(
      validatePiModels([{ ...model, thinkingLevelMap: { high: 1 } }]),
    ).toBe("pi.provider.invalidThinkingLevelMap");
    expect(
      validatePiModels([{ ...model, thinkingLevelMap: { turbo: "turbo" } }]),
    ).toBe("pi.provider.invalidThinkingLevelMap");
    expect(validatePiModels([model])).toBeNull();
  });
});
