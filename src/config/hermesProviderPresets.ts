import type { ProviderCategory } from "../types";
import type { PresetTheme, TemplateValueConfig } from "./claudeProviderPresets";

export const HERMES_PROVIDER_SOURCE_FIELD = "_cc_source";
export const HERMES_PROVIDER_SOURCE_CUSTOM_LIST = "custom_providers";
export const HERMES_PROVIDER_SOURCE_DICT = "providers_dict";

export function isHermesReadOnlyProvider(settingsConfig: unknown): boolean {
  if (!settingsConfig || typeof settingsConfig !== "object") return false;
  return (
    (settingsConfig as Record<string, unknown>)[
      HERMES_PROVIDER_SOURCE_FIELD
    ] === HERMES_PROVIDER_SOURCE_DICT
  );
}

export interface HermesModel {
  id: string;
  name?: string;
  context_length?: number;
}

export interface HermesSuggestedDefaults {
  model: {
    default: string;
    provider?: string;
  };
}

export type HermesApiMode =
  | "chat_completions"
  | "anthropic_messages"
  | "codex_responses"
  | "bedrock_converse";

export const HERMES_DEFAULT_API_MODE: HermesApiMode = "chat_completions";

export const hermesApiModes: Array<{
  value: HermesApiMode;
  labelKey: string;
}> = [
  { value: "chat_completions", labelKey: "hermes.form.apiModeChatCompletions" },
  {
    value: "anthropic_messages",
    labelKey: "hermes.form.apiModeAnthropicMessages",
  },
  { value: "codex_responses", labelKey: "hermes.form.apiModeCodexResponses" },
  { value: "bedrock_converse", labelKey: "hermes.form.apiModeBedrockConverse" },
];

export interface HermesProviderSettingsConfig {
  name: string;
  base_url?: string;
  api_key?: string;
  api_mode?: HermesApiMode;
  models?: HermesModel[];
  rate_limit_delay?: number;
  [key: string]: unknown;
}

export interface HermesProviderPreset {
  name: string;
  nameKey?: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: HermesProviderSettingsConfig;
  isOfficial?: boolean;
  isPartner?: boolean;
  primePartner?: boolean;
  partnerPromotionKey?: string;
  category?: ProviderCategory;
  templateValues?: Record<string, TemplateValueConfig>;
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
  isCustomTemplate?: boolean;
  suggestedDefaults?: HermesSuggestedDefaults;
}

// 预设数据在下一阶段从固定上游完整同步；本阶段只接通表单与类型。
export const hermesProviderPresets: HermesProviderPreset[] = [];
