export const PI_API_FORMATS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "bedrock-converse-stream",
] as const;

export type PiApiFormat = (typeof PI_API_FORMATS)[number];

export interface PiProviderPreset {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

export const piProviderPresets: readonly PiProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    config: {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      api: "anthropic-messages",
      models: [
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 1000000,
          maxTokens: 128000,
          thinkingLevelMap: {},
        },
      ],
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    config: {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      api: "openai-responses",
      models: [
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 272000,
          maxTokens: 128000,
          thinkingLevelMap: {
            off: "none",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "xhigh",
          },
        },
      ],
    },
  },
  {
    id: "google",
    name: "Google Gemini",
    config: {
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "",
      api: "google-generative-ai",
      models: [
        {
          id: "gemini-3.1-pro-preview",
          name: "Gemini 3.1 Pro Preview",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 1048576,
          maxTokens: 65536,
          thinkingLevelMap: { low: "LOW", high: "HIGH" },
        },
      ],
    },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    config: {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      api: "openai-completions",
      models: [
        {
          id: "deepseek-reasoner",
          name: "DeepSeek Reasoner",
          reasoning: true,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 32768,
          thinkingLevelMap: {},
        },
      ],
    },
  },
] as const;
