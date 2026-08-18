import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import type { Provider } from "@/types";
import { providerNeedsRouting } from "@/utils/providerCapabilities";

describe("AWS Bedrock Provider Presets", () => {
  const bedrockAksk = providerPresets.find(
    (p) => p.name === "AWS Bedrock (AKSK)",
  );

  it("should include AWS Bedrock (AKSK) preset", () => {
    expect(bedrockAksk).toBeDefined();
  });

  it("AKSK preset should have required AWS env variables", () => {
    const env = (bedrockAksk!.settingsConfig as any).env;
    expect(env).toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(env).toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(env).toHaveProperty("AWS_REGION");
    expect(env).toHaveProperty("CLAUDE_CODE_USE_BEDROCK", "1");
  });

  it("AKSK preset should have template values for AWS credentials", () => {
    expect(bedrockAksk!.templateValues).toBeDefined();
    expect(bedrockAksk!.templateValues!.AWS_ACCESS_KEY_ID).toBeDefined();
    expect(bedrockAksk!.templateValues!.AWS_SECRET_ACCESS_KEY).toBeDefined();
    expect(bedrockAksk!.templateValues!.AWS_REGION).toBeDefined();
    expect(bedrockAksk!.templateValues!.AWS_REGION.editorValue).toBe(
      "us-west-2",
    );
  });

  it("AKSK preset should have correct base URL template", () => {
    const env = (bedrockAksk!.settingsConfig as any).env;
    expect(env.ANTHROPIC_BASE_URL).toContain("bedrock-runtime");
    expect(env.ANTHROPIC_BASE_URL).toContain("${AWS_REGION}");
  });

  it("AKSK preset should have cloud_provider category", () => {
    expect(bedrockAksk!.category).toBe("cloud_provider");
  });

  it("AKSK preset should have Bedrock model as default", () => {
    const env = (bedrockAksk!.settingsConfig as any).env;
    expect(env.ANTHROPIC_MODEL).toContain("anthropic.claude");
  });

  const bedrockApiKey = providerPresets.find(
    (p) => p.name === "AWS Bedrock (API Key)",
  );

  it("should include AWS Bedrock (API Key) preset", () => {
    expect(bedrockApiKey).toBeDefined();
  });

  it("API Key preset should have apiKey field and AWS env variables", () => {
    const config = bedrockApiKey!.settingsConfig as any;
    expect(config).toHaveProperty("apiKey", "");
    expect(config.env).toHaveProperty("AWS_REGION");
    expect(config.env).toHaveProperty("CLAUDE_CODE_USE_BEDROCK", "1");
  });

  it("API Key preset should NOT have AKSK env variables", () => {
    const env = (bedrockApiKey!.settingsConfig as any).env;
    expect(env).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("API Key preset should have template values for region only", () => {
    expect(bedrockApiKey!.templateValues).toBeDefined();
    expect(bedrockApiKey!.templateValues!.AWS_REGION).toBeDefined();
    expect(bedrockApiKey!.templateValues!.AWS_REGION.editorValue).toBe(
      "us-west-2",
    );
  });

  it("API Key preset should have cloud_provider category", () => {
    expect(bedrockApiKey!.category).toBe("cloud_provider");
  });
});

describe("Claude Provider Presets", () => {
  it("should match the complete upstream catalog", () => {
    expect(providerPresets).toHaveLength(77);
    expect(providerPresets.map((preset) => preset.name)).toEqual(
      expect.arrayContaining([
        "Kimi",
        "Kimi For Coding",
        "Code0",
        "Qiniu",
        "Gemini Native",
        "OpenCode Go",
        "Xiaomi MiMo Token Plan (China)",
      ]),
    );
  });

  it("should keep the latest Kimi coding model routes", () => {
    const kimi = providerPresets.find((preset) => preset.name === "Kimi");
    const kimiCoding = providerPresets.find(
      (preset) => preset.name === "Kimi For Coding",
    );

    expect(kimi?.primePartner).toBe(true);
    expect((kimi?.settingsConfig as any).env.ANTHROPIC_MODEL).toBe(
      "kimi-k2.7-code",
    );
    expect(kimiCoding?.primePartner).toBe(true);
    expect((kimiCoding?.settingsConfig as any).env.ANTHROPIC_MODEL).toBe(
      "kimi-for-coding",
    );
  });

  it("should use DeepSeek's explicit models endpoint", () => {
    const deepSeek = providerPresets.find(
      (preset) => preset.name === "DeepSeek",
    );

    expect(deepSeek?.modelsUrl).toBe("https://api.deepseek.com/models");
  });
});

describe("OpenCode Go Provider Preset", () => {
  const openCodeGo = providerPresets.find(
    (preset) => preset.name === "OpenCode Go",
  )!;

  it("使用 Anthropic 兼容端点和 x-api-key 认证", () => {
    const env = (openCodeGo.settingsConfig as any).env;
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://opencode.ai/zen/go",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "deepseek-v4-flash",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
    });
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(openCodeGo.apiFormat).toBeUndefined();
    expect(openCodeGo.apiKeyField).toBe("ANTHROPIC_API_KEY");
  });

  it("Claude Code 直连时不要求本地路由", () => {
    const provider: Provider = {
      id: "opencode-go",
      name: openCodeGo.name,
      category: openCodeGo.category,
      settingsConfig: openCodeGo.settingsConfig as Record<string, any>,
      meta: {
        apiFormat: openCodeGo.apiFormat,
        apiKeyField: openCodeGo.apiKeyField,
      },
    };

    expect(providerNeedsRouting("claude", provider)).toBe(false);
  });
});
