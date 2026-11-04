import { normalizeAggregationModels } from "./ClaudeAggregationModels";
import type { ClaudeStackModel } from "@/types";
import { overlayCodexProviderConfig } from "@/utils/codexEditorOverlay";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { overlayGeminiProviderFields } from "@/utils/geminiEditorOverlay";
import {
  overlayClaudeProviderFields,
  withClaudeGatewayDefaults,
} from "@/utils/claudeEditorOverlay";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { ImeSafeInput } from "@/components/ui/ime-safe-input";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import {
  buildLocalProxyRequestOverrides,
  formatRequestOverrideObject,
} from "@/lib/requestOverrides";
import { providersApi, settingsApi, type AppId } from "@/lib/api";
import { useSettingsQuery } from "@/lib/query";
import type {
  ProviderCategory,
  ProviderMeta,
  ProviderTestConfig,
  ProviderProxyConfig,
  ClaudeApiFormat,
  CodexApiFormat,
  CodexCopilotApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  PromptCacheRoutingMode,
  ClaudeApiKeyField,
} from "@/types";
import {
  providerPresets,
  type ProviderPreset,
} from "@/config/claudeProviderPresets";
import {
  codexProviderPresets,
  type CodexProviderPreset,
} from "@/config/codexProviderPresets";
import {
  geminiProviderPresets,
  type GeminiProviderPreset,
} from "@/config/geminiProviderPresets";
import {
  opencodeProviderPresets,
  type OpenCodeProviderPreset,
} from "@/config/opencodeProviderPresets";
import {
  openclawProviderPresets,
  rebaseOpenClawSuggestedDefaults,
  type OpenClawProviderPreset,
  type OpenClawSuggestedDefaults,
} from "@/config/openclawProviderPresets";
import {
  hermesProviderPresets,
  type HermesProviderPreset,
} from "@/config/hermesProviderPresets";
import { OpenCodeFormFields } from "./OpenCodeFormFields";
import { OpenClawFormFields } from "./OpenClawFormFields";
import { HermesFormFields } from "./HermesFormFields";
import type { UniversalProviderPreset } from "@/config/universalProviderPresets";
import {
  applyTemplateValues,
  extractCodexModelName,
  extractCodexWireApi,
  getApiKeyFromConfig,
  hasApiKeyField,
  setCodexModelName as setCodexModelNameInConfig,
  setCodexWireApi,
} from "@/utils/providerConfigUtils";
import { mergeProviderMeta } from "@/utils/providerMetaUtils";
import { getCodexCustomTemplate } from "@/config/codexTemplates";
import CodexConfigEditor from "./CodexConfigEditor";
import { CommonConfigEditor } from "./CommonConfigEditor";
import GeminiConfigEditor from "./GeminiConfigEditor";
import JsonEditor from "@/components/JsonEditor";
import { Label } from "@/components/ui/label";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { BasicFormFields } from "./BasicFormFields";
import { ClaudeFormFields } from "./ClaudeFormFields";
import {
  toClaudeReasoningEffortChoice,
  type ClaudeReasoningEffortChoice,
} from "./ClaudeReasoningEffortField";
import { CodexFormFields } from "./CodexFormFields";
import { CodexOAuthSection } from "./CodexOAuthSection";
import { GeminiFormFields } from "./GeminiFormFields";
import { McodeProviderForm } from "./McodeProviderForm";
import { AgyAccountSelect, useAgyAccountSupported } from "./AgyOAuthSection";
import { ClaudeAccountSelect } from "./ClaudeOfficialSection";
import { usesGeminiStyleForm } from "@/config/appConfig";
import { KimiProviderForm } from "./KimiProviderForm";
import { OmoFormFields } from "./OmoFormFields";
import { parseOmoOtherFieldsObject } from "@/types/omo";
import { ProviderAdvancedConfig } from "./ProviderAdvancedConfig";
import {
  useProviderCategory,
  useApiKeyState,
  useBaseUrlState,
  useModelState,
  useCodexConfigState,
  useApiKeyLink,
  useTemplateValues,
  useCommonConfigSnippet,
  useCodexCommonConfig,
  useSpeedTestEndpoints,
  useCodexTomlValidation,
  useGeminiConfigState,
  useGeminiCommonConfig,
  useOmoModelSource,
  useOpencodeFormState,
  useOmoDraftState,
  useOpenclawFormState,
  useHermesFormState,
  useManagedAuth,
} from "./hooks";
import {
  CLAUDE_DEFAULT_CONFIG,
  CODEX_DEFAULT_CONFIG,
  GEMINI_DEFAULT_CONFIG,
  OPENCODE_DEFAULT_CONFIG,
  OPENCLAW_DEFAULT_CONFIG,
  hasNativeOpencodeDefinition,
  isNativeOpencodeConfig,
} from "./helpers/opencodeFormUtils";
import { HERMES_DEFAULT_CONFIG } from "./hooks/useHermesFormState";
import { resolveManagedAccountId } from "@/lib/authBinding";
import { useOpenClawLiveProviderIds } from "@/hooks/useOpenClaw";
import { useHermesLiveProviderIds } from "@/hooks/useHermes";
import { useAppModeView } from "@/hooks/useAppMode";
import type { DirectModeFormatNotice } from "./shared";
import { GrokBuildProviderForm } from "./GrokBuildProviderForm";
import { ClaudeDesktopProviderForm } from "./ClaudeDesktopProviderForm";
import { PiProviderForm } from "./PiProviderForm";
import { normalizeEnabledCodexChatEffortParam } from "./helpers/codexChatReasoning";

type PresetEntry = {
  id: string;
  preset:
    | ProviderPreset
    | CodexProviderPreset
    | GeminiProviderPreset
    | OpenCodeProviderPreset
    | OpenClawProviderPreset
    | HermesProviderPreset;
};

// 跟随上游 cc-switch 1c82b8a3：把 TOML wire_api 字符串归一为 CodexApiFormat。
const codexApiFormatFromWireApi = (
  wireApi: string | undefined,
): CodexApiFormat | undefined => {
  switch (wireApi?.trim().toLowerCase()) {
    case "chat":
    case "chat_completions":
    case "chat-completions":
    case "openai_chat":
    case "openai-chat":
      return "openai_chat";
    case "responses":
    case "openai_responses":
    case "openai-responses":
      return "openai_responses";
    default:
      return undefined;
  }
};

export const normalizeCodexCatalogModelsForSave = (
  models: CodexCatalogModel[],
): CodexCatalogModel[] => {
  const seen = new Set<string>();
  const normalized: CodexCatalogModel[] = [];

  for (const item of models) {
    const model = item.model.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);

    const displayName = item.displayName?.trim();
    const rawContextWindow = String(item.contextWindow ?? "").replace(
      /[^\d]/g,
      "",
    );
    const contextWindow = rawContextWindow
      ? Number.parseInt(rawContextWindow, 10)
      : undefined;
    const inputModalities = item.inputModalities?.filter(
      (modality) => typeof modality === "string" && modality.trim(),
    );
    const baseInstructions = item.baseInstructions?.trim();
    const reasoningLevels = item.reasoningLevels
      ?.filter((level) => typeof level === "string" && level.trim())
      .map((level) => level.trim());
    const defaultReasoningLevel = item.defaultReasoningLevel?.trim();

    normalized.push({
      model,
      ...(displayName ? { displayName } : {}),
      ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
      ...(typeof item.supportsParallelToolCalls === "boolean"
        ? { supportsParallelToolCalls: item.supportsParallelToolCalls }
        : {}),
      ...(inputModalities?.length ? { inputModalities } : {}),
      ...(baseInstructions ? { baseInstructions } : {}),
      ...(reasoningLevels?.length ? { reasoningLevels } : {}),
      ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
    });
  }

  return normalized;
};

const normalizeCodexChatReasoningForSave = (
  value?: CodexChatReasoning,
): CodexChatReasoning | undefined => {
  const supportsEffort = value?.supportsEffort === true;
  const supportsThinking = value?.supportsThinking === true || supportsEffort;
  const hasExplicitConfig = value && Object.keys(value).length > 0;

  if (!supportsThinking && !supportsEffort) {
    return hasExplicitConfig
      ? {
          supportsThinking: false,
          supportsEffort: false,
          thinkingParam: "none",
          effortParam: "none",
          outputFormat: value?.outputFormat ?? "auto",
        }
      : undefined;
  }

  return {
    supportsThinking,
    supportsEffort,
    thinkingParam: supportsThinking
      ? (value?.thinkingParam ?? "thinking")
      : "none",
    effortParam: supportsEffort
      ? normalizeEnabledCodexChatEffortParam(value?.effortParam)
      : "none",
    effortValueMode: supportsEffort
      ? (value?.effortValueMode ?? "passthrough")
      : undefined,
    outputFormat: value?.outputFormat ?? "auto",
  };
};

const normalizeProviderKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9-]/g, "");

export interface ProviderFormProps {
  providerLiveBase?: Record<string, unknown>;
  appId: AppId;
  providerId?: string;
  submitLabel: string;
  onSubmit: (values: ProviderFormValues) => Promise<void> | void;
  onCancel: () => void;
  onUniversalPresetSelect?: (preset: UniversalProviderPreset) => void;
  onManageUniversalProviders?: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  onSubmitReadyChange?: (isReady: boolean) => void;
  /** Native account login supplies its own actions instead of the provider-save footer. */
  onAccountLoginChange?: (accountLogin: boolean) => void;
  initialData?: {
    name?: string;
    websiteUrl?: string;
    notes?: string;
    settingsConfig?: Record<string, unknown>;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    icon?: string;
    iconColor?: string;
  };
  showButtons?: boolean;
}

function ProviderFormFull({
  providerLiveBase,
  appId,
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onUniversalPresetSelect,
  onManageUniversalProviders,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ProviderFormProps) {
  const { t } = useTranslation();
  const isEditMode = Boolean(initialData);
  const queryClient = useQueryClient();
  const { data: settingsData } = useSettingsQuery();
  const showCommonConfigNotice =
    settingsData != null && settingsData.commonConfigConfirmed !== true;

  const handleCommonConfigConfirm = async () => {
    try {
      if (settingsData) {
        const { webdavSync: _ignoredWebdavSync, ...rest } = settingsData;
        await settingsApi.save({ ...rest, commonConfigConfirmed: true });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      console.error("Failed to save commonConfigConfirmed:", error);
    }
  };

  const [aggregationModels, setAggregationModels] = useState<
    ClaudeStackModel[] | undefined
  >(initialData?.meta?.stackModels);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : "custom",
  );
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
    isPartner?: boolean;
    partnerPromotionKey?: string;
    suggestedDefaults?: OpenClawSuggestedDefaults;
  } | null>(null);
  const [isEndpointModalOpen, setIsEndpointModalOpen] = useState(false);
  const [isCodexEndpointModalOpen, setIsCodexEndpointModalOpen] =
    useState(false);

  const [draftCustomEndpoints, setDraftCustomEndpoints] = useState<string[]>(
    () => {
      if (initialData) return [];
      return [];
    },
  );
  const [endpointAutoSelect, setEndpointAutoSelect] = useState<boolean>(
    () => initialData?.meta?.endpointAutoSelect ?? true,
  );
  const supportsFullUrl = appId === "claude" || appId === "codex";
  // 应用实际在直连时，非原生上游格式发不出请求：正在直连用的这张卡一保存就坏，别的卡切不过去。
  // 按实际模式判断（上游 e615a6f4）。
  const appModeView = useAppModeView(appId);
  const directModeFormatNotice: DirectModeFormatNotice | undefined =
    appModeView?.mode === "direct"
      ? providerId && providerId === appModeView.directProviderId
        ? "inUse"
        : "switch"
      : undefined;
  const [localIsFullUrl, setLocalIsFullUrl] = useState<boolean>(() => {
    if (!supportsFullUrl) return false;
    return initialData?.meta?.isFullUrl ?? false;
  });

  const [testConfig, setTestConfig] = useState<ProviderTestConfig>(
    () => initialData?.meta?.testConfig ?? { enabled: false },
  );
  const [proxyConfig, setProxyConfig] = useState<ProviderProxyConfig>(
    () => initialData?.meta?.proxyConfig ?? { enabled: false },
  );
  const [codexChatReasoning, setCodexChatReasoning] =
    useState<CodexChatReasoning>(
      () => initialData?.meta?.codexChatReasoning ?? {},
    );
  const [claudeReasoningEffort, setClaudeReasoningEffort] =
    useState<ClaudeReasoningEffortChoice>(() =>
      toClaudeReasoningEffortChoice(initialData?.meta?.claudeReasoningEffort),
    );
  const [promptCacheRouting, setPromptCacheRouting] =
    useState<PromptCacheRoutingMode>(
      () => initialData?.meta?.promptCacheRouting ?? "auto",
    );
  const [customUserAgent, setCustomUserAgent] = useState(
    () => initialData?.meta?.customUserAgent ?? "",
  );
  const [localProxyHeadersOverride, setLocalProxyHeadersOverride] = useState(
    () =>
      formatRequestOverrideObject(
        initialData?.meta?.localProxyRequestOverrides?.headers,
      ),
  );
  const [localProxyBodyOverride, setLocalProxyBodyOverride] = useState(() =>
    formatRequestOverrideObject(
      initialData?.meta?.localProxyRequestOverrides?.body,
    ),
  );

  const { category } = useProviderCategory({
    appId,
    selectedPresetId,
    isEditMode,
    initialCategory: initialData?.category,
  });
  const isOmoCategory = appId === "opencode" && category === "omo";
  const isOmoSlimCategory = appId === "opencode" && category === "omo-slim";
  const isAnyOmoCategory = isOmoCategory || isOmoSlimCategory;

  useEffect(() => {
    setSelectedPresetId(initialData ? null : "custom");
    setActivePreset(null);

    if (!initialData) {
      setDraftCustomEndpoints([]);
    }
    setEndpointAutoSelect(initialData?.meta?.endpointAutoSelect ?? true);
    setLocalIsFullUrl(
      supportsFullUrl ? (initialData?.meta?.isFullUrl ?? false) : false,
    );
    setTestConfig(initialData?.meta?.testConfig ?? { enabled: false });
    setProxyConfig(initialData?.meta?.proxyConfig ?? { enabled: false });
    setCodexChatReasoning(initialData?.meta?.codexChatReasoning ?? {});
    setClaudeReasoningEffort(
      toClaudeReasoningEffortChoice(initialData?.meta?.claudeReasoningEffort),
    );
    setPromptCacheRouting(initialData?.meta?.promptCacheRouting ?? "auto");
    setCustomUserAgent(initialData?.meta?.customUserAgent ?? "");
    setLocalProxyHeadersOverride(
      formatRequestOverrideObject(
        initialData?.meta?.localProxyRequestOverrides?.headers,
      ),
    );
    setLocalProxyBodyOverride(
      formatRequestOverrideObject(
        initialData?.meta?.localProxyRequestOverrides?.body,
      ),
    );
  }, [appId, initialData, supportsFullUrl]);

  const defaultValues: ProviderFormData = useMemo(
    () => ({
      name: initialData?.name ?? "",
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: initialData?.settingsConfig
        ? JSON.stringify(initialData.settingsConfig, null, 2)
        : appId === "codex"
          ? CODEX_DEFAULT_CONFIG
          : usesGeminiStyleForm(appId)
            ? JSON.stringify(
                overlayGeminiProviderFields(
                  providerLiveBase ?? {},
                  JSON.parse(GEMINI_DEFAULT_CONFIG),
                ),
                null,
                2,
              )
            : appId === "opencode"
              ? OPENCODE_DEFAULT_CONFIG
              : appId === "openclaw"
                ? OPENCLAW_DEFAULT_CONFIG
                : appId === "hermes"
                  ? HERMES_DEFAULT_CONFIG
                  : JSON.stringify(
                      overlayClaudeProviderFields(
                        providerLiveBase ?? {},
                        withClaudeGatewayDefaults(
                          JSON.parse(CLAUDE_DEFAULT_CONFIG) as Record<
                            string,
                            unknown
                          >,
                          "custom",
                        ),
                      ),
                      null,
                      2,
                    ),
      icon: initialData?.icon ?? "",
      iconColor: initialData?.iconColor ?? "",
    }),
    [initialData, appId, providerLiveBase],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });
  const { isSubmitting } = form.formState;

  const handleSettingsConfigChange = useCallback(
    (config: string) => {
      if (form.getValues("settingsConfig") === config) {
        return;
      }
      form.setValue("settingsConfig", config);
    },
    [form],
  );

  // 事件处理要现读 settingsConfig，不能按渲染期的快照重建 JSON：JSON 编辑器经
  // form.setValue 写入，渲染期取的快照可能早于这些改动（上游 3817c2b2）。
  const getSettingsConfig = useCallback(
    () => form.getValues("settingsConfig"),
    [form],
  );

  const [localApiKeyField, setLocalApiKeyField] = useState<ClaudeApiKeyField>(
    () => {
      if (appId !== "claude") return "ANTHROPIC_AUTH_TOKEN";
      if (initialData?.meta?.apiKeyField) return initialData.meta.apiKeyField;
      // Infer from existing config env
      const env = (initialData?.settingsConfig as Record<string, unknown>)
        ?.env as Record<string, unknown> | undefined;
      if (env?.ANTHROPIC_API_KEY !== undefined) return "ANTHROPIC_API_KEY";
      return "ANTHROPIC_AUTH_TOKEN";
    },
  );

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const {
    apiKey,
    handleApiKeyChange,
    showApiKey: shouldShowApiKey,
  } = useApiKeyState({
    initialConfig: form.getValues("settingsConfig"),
    onConfigChange: handleSettingsConfigChange,
    getConfig: getSettingsConfig,
    selectedPresetId,
    category,
    appType: appId,
    apiKeyField: appId === "claude" ? localApiKeyField : undefined,
  });

  const { baseUrl, handleClaudeBaseUrlChange } = useBaseUrlState({
    appType: appId,
    category,
    settingsConfig: form.getValues("settingsConfig"),
    codexConfig: "",
    onSettingsConfigChange: handleSettingsConfigChange,
    onCodexConfigChange: () => {},
    getSettingsConfig,
  });

  const {
    claudeModel,
    defaultHaikuModel,
    defaultHaikuModelName,
    defaultSonnetModel,
    defaultSonnetModelName,
    defaultOpusModel,
    defaultOpusModelName,
    defaultFableModel,
    defaultFableModelName,
    subagentModel,
    handleModelChange,
  } = useModelState({
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: handleSettingsConfigChange,
    getSettingsConfig,
  });

  // 提交时的校验和身份判断要按 JSON 编辑器里的当前内容，不能用上一次渲染时 hook
  // 里的旧状态。
  const readSubmitTimeCredentials = useCallback(() => {
    const raw = getSettingsConfig() || "{}";
    let parsedBaseUrl: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { env?: Record<string, unknown> };
      const candidate = parsed.env?.ANTHROPIC_BASE_URL;
      parsedBaseUrl = typeof candidate === "string" ? candidate.trim() : "";
    } catch {
      // JSON 校验会提示格式错误；改好之前辅助检查沿用 hook 状态
      parsedBaseUrl = null;
    }
    return {
      baseUrl: parsedBaseUrl ?? baseUrl,
      apiKey: parsedBaseUrl === null ? apiKey : getApiKeyFromConfig(raw, appId),
    };
  }, [apiKey, appId, baseUrl, getSettingsConfig]);

  const [localApiFormat, setLocalApiFormat] = useState<ClaudeApiFormat>(() => {
    if (appId !== "claude") return "anthropic";
    return initialData?.meta?.apiFormat ?? "anthropic";
  });

  const handleApiFormatChange = useCallback((format: ClaudeApiFormat) => {
    setLocalApiFormat(format);
  }, []);

  const handleApiKeyFieldChange = useCallback(
    (field: ClaudeApiKeyField) => {
      const prev = localApiKeyField;
      setLocalApiKeyField(field);

      // Swap the env key name in settingsConfig
      try {
        const raw = form.getValues("settingsConfig");
        const config = JSON.parse(raw || "{}");
        if (config?.env && prev in config.env) {
          const value = config.env[prev];
          delete config.env[prev];
          config.env[field] = value;
          const updated = JSON.stringify(config, null, 2);
          handleSettingsConfigChange(updated);
        }
      } catch {
        // ignore parse errors during editing
      }
    },
    [localApiKeyField, form, handleSettingsConfigChange],
  );

  // Copilot OAuth 认证状态（仅 Claude 应用需要）
  const { isAuthenticated: isCopilotAuthenticated } =
    useManagedAuth("github_copilot");

  const {
    isAuthenticated: isCodexOauthAuthenticated,
    accounts: codexOauthAccounts,
  } = useManagedAuth("codex_oauth");

  const {
    isAuthenticated: isXaiOauthAuthenticated,
    accounts: xaiOauthAccounts,
  } = useManagedAuth("xai_oauth");

  // 选中的 GitHub 账号 ID（多账号支持）
  const [selectedGitHubAccountId, setSelectedGitHubAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "github_copilot"));

  const [selectedCodexAccountId, setSelectedCodexAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "codex_oauth"));

  const [selectedXaiAccountId, setSelectedXaiAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "xai_oauth"));
  // Claude 官方卡绑定的 Claude 官方账号；null = 跟随 Claude Code 登录（~/.claude）
  const [selectedClaudeAccountId, setSelectedClaudeAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "claude_official"));
  // Antigravity 官方卡绑定的授权中心账号；null = 跟着 agy 当前的登录
  const [selectedAgyAccountId, setSelectedAgyAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "agy_oauth"));
  const agyAccountSupported = useAgyAccountSupported(appId === "agy");

  const {
    codexAuth,
    codexConfig,
    codexApiKey,
    codexBaseUrl,
    codexModelName,
    codexCatalogModels,
    codexAutoReviewModel,
    setCodexAutoReviewModel,
    codexSubagentModel,
    codexSubagentReasoningEffort,
    codexAgentMaxThreads,
    codexMultiAgentV2Total,
    handleCodexSubagentModelChange,
    handleCodexSubagentReasoningEffortChange,
    handleCodexAgentMaxThreadsChange,
    codexAuthError,
    setCodexAuth,
    setCodexConfig,
    setCodexCatalogModels,
    handleCodexApiKeyChange,
    handleCodexBaseUrlChange,
    handleCodexModelNameChange,
    handleCodexConfigChange: originalHandleCodexConfigChange,
    resetCodexConfig,
  } = useCodexConfigState({ initialData });

  // Codex API 格式（跟随上游 cc-switch 1c82b8a3）：优先 meta.apiFormat，
  // 其次从 TOML config 里的 wire_api 推断，回退到 openai_responses。
  const [localCodexApiFormat, setLocalCodexApiFormat] =
    useState<CodexApiFormat>(() => {
      // 托管 Copilot 的协议在 codexCopilotApiFormat 里，旧卡残留的 apiFormat 不再作数
      if (initialData?.meta?.providerType === "github_copilot")
        return "openai_responses";
      if (initialData?.meta?.apiFormat === "openai_chat") return "openai_chat";
      if (initialData?.meta?.apiFormat === "openai_responses")
        return "openai_responses";
      return (
        codexApiFormatFromWireApi(
          extractCodexWireApi(
            typeof initialData?.settingsConfig?.config === "string"
              ? initialData.settingsConfig.config
              : "",
          ),
        ) ?? "openai_responses"
      );
    });
  // Codex → GitHub Copilot 的协议选择：缺省为自动（按模型能力选 Responses / Chat）
  // 原样保留新版本写下的值，用户改了协议才换掉。
  const [codexCopilotApiFormat, setCodexCopilotApiFormat] = useState<string>(
    () => initialData?.meta?.codexCopilotApiFormat ?? "auto",
  );
  const effectiveCodexCopilotApiFormat: CodexCopilotApiFormat =
    codexCopilotApiFormat === "openai_chat" ||
    codexCopilotApiFormat === "openai_responses"
      ? codexCopilotApiFormat
      : "auto";

  const { configError: codexConfigError, debouncedValidate } =
    useCodexTomlValidation();

  const handleCodexConfigChange = useCallback(
    (value: string) => {
      originalHandleCodexConfigChange(value);
      // 用户改 TOML 时如果手工写了 wire_api，把表单的 apiFormat 也同步过来
      const nextFormat = codexApiFormatFromWireApi(extractCodexWireApi(value));
      if (nextFormat) {
        setLocalCodexApiFormat(nextFormat);
      }
      debouncedValidate(value);
    },
    [originalHandleCodexConfigChange, debouncedValidate],
  );

  // 用户在 UI 上切 apiFormat：保留 TOML 的 wire_api 为 "responses"（兼容新版 Codex
  // 客户端的 Responses 协议），真实路由由 meta.apiFormat 与代理判定。
  const handleCodexApiFormatChange = useCallback(
    (format: CodexApiFormat) => {
      setLocalCodexApiFormat(format);
      setCodexConfig((prev) => {
        const updated = setCodexWireApi(prev, "responses");
        debouncedValidate(updated);
        return updated;
      });
    },
    [setCodexConfig, debouncedValidate],
  );

  // Copilot 的协议另存（codexCopilotApiFormat），不再借 apiFormat 存一个代表值；
  // Codex 对代理始终说 Responses。
  const handleCodexCopilotApiFormatChange = useCallback(
    (format: CodexCopilotApiFormat) => {
      setCodexCopilotApiFormat(format);
      setCodexConfig((prev) => {
        const updated = setCodexWireApi(prev, "responses");
        debouncedValidate(updated);
        return updated;
      });
    },
    [setCodexConfig, debouncedValidate],
  );

  useEffect(() => {
    if (appId === "codex" && !initialData && selectedPresetId === "custom") {
      const template = getCodexCustomTemplate();
      resetCodexConfig(
        template.auth,
        overlayCodexProviderConfig(providerLiveBase?.config, template.config),
      );
    }
  }, [
    appId,
    initialData,
    selectedPresetId,
    resetCodexConfig,
    providerLiveBase,
  ]);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const presetCategoryLabels: Record<string, string> = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", {
        defaultValue: "官方",
      }),
      cn_official: t("providerForm.categoryCnOfficial", {
        defaultValue: "国内官方",
      }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
      local: t("providerForm.categoryLocal", {
        defaultValue: "本地",
      }),
      omo: "OMO",
    }),
    [t],
  );

  const presetEntries = useMemo(() => {
    // 先编号再过滤 hidden：id 里的序号是原数组下标，AddProviderDialog /
    // useProviderCategory 按它回查预设，先过滤会让隐藏项之后的预设全部错位
    if (appId === "codex") {
      return codexProviderPresets
        .map<PresetEntry>((preset, index) => ({
          id: `codex-${index}`,
          preset,
        }))
        .filter((entry) => !(entry.preset as CodexProviderPreset).hidden);
    } else if (usesGeminiStyleForm(appId)) {
      return geminiProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `gemini-${index}`,
        preset,
      }));
    } else if (appId === "opencode") {
      return opencodeProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `opencode-${index}`,
        preset,
      }));
    } else if (appId === "openclaw") {
      return openclawProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `openclaw-${index}`,
        preset,
      }));
    } else if (appId === "hermes") {
      return hermesProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `hermes-${index}`,
        preset,
      }));
    }
    return providerPresets
      .map<PresetEntry>((preset, index) => ({
        id: `claude-${index}`,
        preset,
      }))
      .filter((entry) => !(entry.preset as ProviderPreset).hidden);
  }, [appId]);

  const presetProviderType = useMemo(() => {
    if (!selectedPresetId) return undefined;
    const preset = presetEntries.find(
      (entry) => entry.id === selectedPresetId,
    )?.preset;
    return preset && "providerType" in preset ? preset.providerType : undefined;
  }, [presetEntries, selectedPresetId]);

  const {
    templateValues,
    templateValueEntries,
    selectedPreset: templatePreset,
    handleTemplateValueChange,
    validateTemplateValues,
  } = useTemplateValues({
    selectedPresetId: appId === "claude" ? selectedPresetId : null,
    presetEntries: appId === "claude" ? presetEntries : [],
    settingsConfig: form.getValues("settingsConfig"),
    getSettingsConfig,
    onConfigChange: handleSettingsConfigChange,
  });

  const {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    isExtracting: isClaudeExtracting,
    handleExtract: handleClaudeExtract,
  } = useCommonConfigSnippet({
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: handleSettingsConfigChange,
    initialData: appId === "claude" ? initialData : undefined,
    initialEnabled:
      appId === "claude" ? initialData?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
    enabled: false,
  });

  const {
    useCommonConfig: useCodexCommonConfigFlag,
    commonConfigSnippet: codexCommonConfigSnippet,
    commonConfigError: codexCommonConfigError,
    handleCommonConfigToggle: handleCodexCommonConfigToggle,
    handleCommonConfigSnippetChange: handleCodexCommonConfigSnippetChange,
    isExtracting: isCodexExtracting,
    handleExtract: handleCodexExtract,
    clearCommonConfigError: clearCodexCommonConfigError,
  } = useCodexCommonConfig({
    enabled: false,
    codexConfig,
    onConfigChange: handleCodexConfigChange,
    initialData: appId === "codex" ? initialData : undefined,
    initialEnabled:
      appId === "codex" ? initialData?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  const geminiInitialData = useMemo(
    () =>
      usesGeminiStyleForm(appId)
        ? (initialData ??
          (providerLiveBase ? { settingsConfig: providerLiveBase } : undefined))
        : undefined,
    [appId, initialData, providerLiveBase],
  );

  const {
    geminiEnv,
    geminiConfig,
    geminiApiKey,
    geminiBaseUrl,
    geminiModel,
    envError,
    configError: geminiConfigError,
    handleGeminiApiKeyChange: originalHandleGeminiApiKeyChange,
    handleGeminiBaseUrlChange: originalHandleGeminiBaseUrlChange,
    handleGeminiModelChange: originalHandleGeminiModelChange,
    handleGeminiEnvChange,
    handleGeminiConfigChange,
    resetGeminiConfig,
    envStringToObj,
    envObjToString,
  } = useGeminiConfigState({
    initialData: geminiInitialData,
    // agy 只认 settings.json 里的 model.name（显示名），模型字段读写那里
    preferConfigModel: appId === "agy",
  });

  const updateGeminiEnvField = useCallback(
    (
      key: "GEMINI_API_KEY" | "GOOGLE_GEMINI_BASE_URL" | "GEMINI_MODEL",
      value: string,
    ) => {
      try {
        const config = JSON.parse(form.getValues("settingsConfig") || "{}") as {
          env?: Record<string, unknown>;
        };
        if (!config.env || typeof config.env !== "object") {
          config.env = {};
        }
        config.env[key] = value;
        handleSettingsConfigChange(JSON.stringify(config, null, 2));
      } catch {}
    },
    [form, handleSettingsConfigChange],
  );

  const handleGeminiApiKeyChange = useCallback(
    (key: string) => {
      originalHandleGeminiApiKeyChange(key);
      updateGeminiEnvField("GEMINI_API_KEY", key.trim());
    },
    [originalHandleGeminiApiKeyChange, updateGeminiEnvField],
  );

  const handleGeminiBaseUrlChange = useCallback(
    (url: string) => {
      originalHandleGeminiBaseUrlChange(url);
      updateGeminiEnvField(
        "GOOGLE_GEMINI_BASE_URL",
        url.trim().replace(/\/+$/, ""),
      );
    },
    [originalHandleGeminiBaseUrlChange, updateGeminiEnvField],
  );

  const handleGeminiModelChange = useCallback(
    (model: string) => {
      originalHandleGeminiModelChange(model);
      updateGeminiEnvField("GEMINI_MODEL", model.trim());
    },
    [originalHandleGeminiModelChange, updateGeminiEnvField],
  );

  const {
    useCommonConfig: useGeminiCommonConfigFlag,
    commonConfigSnippet: geminiCommonConfigSnippet,
    commonConfigError: geminiCommonConfigError,
    handleCommonConfigToggle: handleGeminiCommonConfigToggle,
    handleCommonConfigSnippetChange: handleGeminiCommonConfigSnippetChange,
    isExtracting: isGeminiExtracting,
    handleExtract: handleGeminiExtract,
    clearCommonConfigError: clearGeminiCommonConfigError,
  } = useGeminiCommonConfig({
    enabled: false,
    envValue: geminiEnv,
    onEnvChange: handleGeminiEnvChange,
    envStringToObj,
    envObjToString,
    initialData: usesGeminiStyleForm(appId) ? initialData : undefined,
    initialEnabled: usesGeminiStyleForm(appId)
      ? initialData?.meta?.commonConfigEnabled
      : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  // ── Extracted hooks: OpenCode / OMO / OpenClaw ─────────────────────

  const {
    omoModelOptions,
    omoModelVariantsMap,
    omoPresetMetaMap,
    existingOpencodeKeys,
  } = useOmoModelSource({ isOmoCategory: isAnyOmoCategory, providerId });

  const {
    data: opencodeLiveProviderIds = [],
    isLoading: isOpencodeLiveProviderIdsLoading,
    isSuccess: isOpencodeLiveProviderIdsSuccess,
  } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode" && !isAnyOmoCategory,
  });

  const opencodeForm = useOpencodeFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: handleSettingsConfigChange,
    getSettingsConfig,
  });
  const isNativeOpencode =
    appId === "opencode" &&
    !isAnyOmoCategory &&
    isNativeOpencodeConfig(
      form.watch("settingsConfig"),
      initialData?.meta?.opencodeConfigFormat,
    );
  const isExistingNativeOpencodeKey =
    isNativeOpencode && providerId === opencodeForm.opencodeProviderKey;
  // Keep existing IDs, including legacy V1 deep-link IDs, without renaming live references.
  const isOpencodeProviderKeyInvalid =
    opencodeForm.opencodeProviderKey.trim() !== "" &&
    !isExistingNativeOpencodeKey &&
    !(isEditMode && providerId === opencodeForm.opencodeProviderKey) &&
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(opencodeForm.opencodeProviderKey);

  const keepsOpencodeProviderId =
    isEditMode &&
    !!providerId &&
    opencodeForm.opencodeProviderKey === providerId;
  const canKeepExistingOpencodeOverride =
    keepsOpencodeProviderId &&
    isOpencodeLiveProviderIdsSuccess &&
    opencodeLiveProviderIds.includes(opencodeForm.opencodeProviderKey);
  // Unlike V1, no older version copied native rows without their definition
  // (copies now require one), so a stored native row keeping its ID may stay
  // package-less after removal from the live config.
  const canInheritOpencodeDefinition =
    canKeepExistingOpencodeOverride ||
    (keepsOpencodeProviderId &&
      initialData?.meta?.opencodeConfigFormat === "v2");

  const initialOmoSettings =
    appId === "opencode" &&
    (initialData?.category === "omo" || initialData?.category === "omo-slim")
      ? (initialData.settingsConfig as Record<string, unknown> | undefined)
      : undefined;

  const omoDraft = useOmoDraftState({
    initialOmoSettings,
    isEditMode,
    appId,
    category,
  });

  const openclawForm = useOpenclawFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: handleSettingsConfigChange,
    getSettingsConfig,
  });
  const {
    data: openclawLiveProviderIds = [],
    isLoading: isOpenclawLiveProviderIdsLoading,
  } = useOpenClawLiveProviderIds(appId === "openclaw");

  const hermesForm = useHermesFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: handleSettingsConfigChange,
    getSettingsConfig,
  });
  const {
    data: hermesLiveProviderIds = [],
    isLoading: isHermesLiveProviderIdsLoading,
  } = useHermesLiveProviderIds(appId === "hermes");

  const additiveExistingProviderKeys = useMemo(() => {
    if (appId === "opencode" && !isAnyOmoCategory) {
      return Array.from(
        new Set(
          [...existingOpencodeKeys, ...opencodeLiveProviderIds].filter(
            (key) => key !== providerId,
          ),
        ),
      );
    }

    if (appId === "openclaw") {
      return Array.from(
        new Set(
          [
            ...openclawForm.existingOpenclawKeys,
            ...openclawLiveProviderIds,
          ].filter((key) => key !== providerId),
        ),
      );
    }

    if (appId === "hermes") {
      return Array.from(
        new Set(
          [...hermesForm.existingHermesKeys, ...hermesLiveProviderIds].filter(
            (key) => key !== providerId,
          ),
        ),
      );
    }

    return [];
  }, [
    appId,
    existingOpencodeKeys,
    hermesForm.existingHermesKeys,
    hermesLiveProviderIds,
    isAnyOmoCategory,
    openclawForm.existingOpenclawKeys,
    openclawLiveProviderIds,
    opencodeLiveProviderIds,
    providerId,
  ]);

  const isProviderKeyLockStateLoading = useMemo(() => {
    if (!isEditMode) return false;
    if (appId === "opencode" && !isAnyOmoCategory) {
      return isOpencodeLiveProviderIdsLoading;
    }
    if (appId === "openclaw") {
      return isOpenclawLiveProviderIdsLoading;
    }
    if (appId === "hermes") {
      return isHermesLiveProviderIdsLoading;
    }
    return false;
  }, [
    appId,
    isAnyOmoCategory,
    isEditMode,
    isHermesLiveProviderIdsLoading,
    isOpenclawLiveProviderIdsLoading,
    isOpencodeLiveProviderIdsLoading,
  ]);

  const isProviderKeyLocked = useMemo(() => {
    if (!isEditMode || !providerId) return false;
    if (appId === "opencode" && !isAnyOmoCategory) {
      return opencodeLiveProviderIds.includes(providerId);
    }
    if (appId === "openclaw") {
      return openclawLiveProviderIds.includes(providerId);
    }
    if (appId === "hermes") {
      return hermesLiveProviderIds.includes(providerId);
    }
    return false;
  }, [
    appId,
    hermesLiveProviderIds,
    isAnyOmoCategory,
    isEditMode,
    openclawLiveProviderIds,
    opencodeLiveProviderIds,
    providerId,
  ]);

  const [isCommonConfigModalOpen, setIsCommonConfigModalOpen] = useState(false);

  const shouldApplyLocalProxyRequestOverrides =
    (appId === "claude" || appId === "codex") && category !== "official";

  const handleSubmit = async (values: ProviderFormData) => {
    const overridesResult = shouldApplyLocalProxyRequestOverrides
      ? buildLocalProxyRequestOverrides(
          localProxyHeadersOverride,
          localProxyBodyOverride,
        )
      : {};
    if (overridesResult.error) {
      toast.error(
        t("providerForm.localProxyRequestOverridesInvalid", {
          error: overridesResult.error,
        }),
      );
      return;
    }

    if (appId === "claude" && templateValueEntries.length > 0) {
      const validation = validateTemplateValues();
      if (!validation.isValid && validation.missingField) {
        toast.error(
          t("providerForm.fillParameter", {
            label: validation.missingField.label,
            defaultValue: `请填写 ${validation.missingField.label}`,
          }),
        );
        return;
      }
    }

    if (appId === "hermes") {
      const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!hermesForm.hermesProviderKey.trim()) {
        toast.error(t("hermes.form.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(hermesForm.hermesProviderKey)) {
        toast.error(t("hermes.form.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(hermesForm.hermesProviderKey)
      ) {
        toast.error(t("hermes.form.providerKeyDuplicate"));
        return;
      }
    }

    if (!values.name.trim()) {
      toast.error(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
      return;
    }

    if (appId === "opencode" && !isAnyOmoCategory) {
      if (!opencodeForm.opencodeProviderKey.trim()) {
        toast.error(t("opencode.providerKeyRequired"));
        return;
      }
      if (isOpencodeProviderKeyInvalid) {
        toast.error(t("opencode.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(opencodeForm.opencodeProviderKey)
      ) {
        toast.error(t("opencode.providerKeyDuplicate"));
        return;
      }
      // 已有覆盖保持原标识时才可沿用默认定义；V2 原生声明的包名写在 `package`。
      if (!canInheritOpencodeDefinition) {
        const hasDefinition = isNativeOpencode
          ? hasNativeOpencodeDefinition(
              form.getValues("settingsConfig"),
              opencodeForm.opencodeProviderKey,
            )
          : !!opencodeForm.opencodeNpm.trim() &&
            Object.keys(opencodeForm.opencodeModels).length > 0;
        if (!hasDefinition) {
          toast.error(
            t(
              isNativeOpencode
                ? "opencode.nativeCustomProviderRequired"
                : "opencode.customProviderRequired",
            ),
          );
          return;
        }
      }
    }

    // OpenClaw: validate provider key
    if (appId === "openclaw") {
      const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!openclawForm.openclawProviderKey.trim()) {
        toast.error(t("openclaw.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(openclawForm.openclawProviderKey)) {
        toast.error(t("openclaw.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(openclawForm.openclawProviderKey)
      ) {
        toast.error(t("openclaw.providerKeyDuplicate"));
        return;
      }
    }

    // 非官方供应商必填校验：端点和 API Key
    // cloud_provider（如 Bedrock）通过模板变量处理认证，跳过通用校验
    // GitHub Copilot 使用 OAuth 认证，不需要 API Key
    // Codex 只按供应商类型认托管 Copilot：自建中转（地址里带 githubcopilot.com）保留自己的
    // Key 和端点
    const { baseUrl: submitBaseUrl, apiKey: submitApiKey } =
      readSubmitTimeCredentials();
    const isCopilotProvider =
      presetProviderType === "github_copilot" ||
      initialData?.meta?.providerType === "github_copilot" ||
      (appId !== "codex" && submitBaseUrl.includes("githubcopilot.com"));
    // 自动协议可能按请求选 Chat，Chat 专属选项照样保留
    const isCodexChatFormat = isCopilotProvider
      ? effectiveCodexCopilotApiFormat !== "openai_responses"
      : localCodexApiFormat === "openai_chat";
    const isCodexOauthProvider =
      presetProviderType === "codex_oauth" ||
      initialData?.meta?.providerType === "codex_oauth";
    const isCodexOfficialFollowLogin =
      appId === "codex" && category === "official";
    const usesCodexManagedAccount =
      isCodexOauthProvider ||
      (isCodexOfficialFollowLogin && selectedCodexAccountId !== null);
    const isXaiOauthProvider =
      presetProviderType === "xai_oauth" ||
      initialData?.meta?.providerType === "xai_oauth";
    // GitHub Copilot 必须先登录才能添加
    if (isCopilotProvider && !isCopilotAuthenticated) {
      toast.error(
        t("copilot.loginRequired", {
          defaultValue: "请先登录 GitHub Copilot",
        }),
      );
      return;
    }
    if (isCodexOauthProvider && !isCodexOauthAuthenticated) {
      toast.error(
        t("codexOauth.loginRequired", {
          defaultValue: "请先登录 ChatGPT 账号",
        }),
      );
      return;
    }
    if (
      usesCodexManagedAccount &&
      selectedCodexAccountId !== null &&
      !codexOauthAccounts.some(
        (account) =>
          account.id === selectedCodexAccountId && !account.reauth_required,
      )
    ) {
      toast.error(
        t("managedAuth.selectedAccountNeedsReauth", {
          defaultValue: "已绑定账号不存在或需要重新登录",
        }),
      );
      return;
    }
    if (isXaiOauthProvider && !isXaiOauthAuthenticated) {
      toast.error(
        t("xaiOauth.loginRequired", {
          defaultValue: "请先登录 xAI 账号",
        }),
      );
      return;
    }
    if (
      isXaiOauthProvider &&
      selectedXaiAccountId !== null &&
      !xaiOauthAccounts.some(
        (account) =>
          account.id === selectedXaiAccountId && !account.requires_reauth,
      )
    ) {
      toast.error(
        t("managedAuth.selectedAccountNeedsReauth", {
          defaultValue: "已绑定账号不存在或需要重新登录",
        }),
      );
      return;
    }

    if (category !== "official" && category !== "cloud_provider") {
      if (appId === "claude") {
        if (
          !isCodexOauthProvider &&
          !isXaiOauthProvider &&
          !submitBaseUrl.trim()
        ) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (
          !isCopilotProvider &&
          !isCodexOauthProvider &&
          !isXaiOauthProvider &&
          !submitApiKey.trim()
        ) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      } else if (appId === "codex") {
        // 托管账号预设（Copilot / xAI）：端点由 adapter 硬定向、token 由代理注入
        if (!isCopilotProvider && !isXaiOauthProvider && !codexBaseUrl.trim()) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (!isCopilotProvider && !isXaiOauthProvider && !codexApiKey.trim()) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      } else if (usesGeminiStyleForm(appId)) {
        // agy 只填 Key 不填地址是合法用法（走 Google 默认 API）
        if (appId !== "agy" && !geminiBaseUrl.trim()) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (!geminiApiKey.trim()) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      }
    }

    let settingsConfig: string;

    if (appId === "codex") {
      try {
        const authJson = JSON.parse(codexAuth);
        // 跟随上游 cc-switch 1c82b8a3：第三方 Codex provider 保存时把 TOML 的
        // wire_api 归一为 "responses"——原生 Responses 可直连；
        // 需要协议转换时，代理根据 meta.apiFormat 处理。
        let normalizedCodexConfig =
          category !== "official" && (codexConfig ?? "").trim()
            ? setCodexWireApi(codexConfig ?? "", "responses")
            : (codexConfig ?? "");
        const normalizedCatalogModels =
          category !== "official"
            ? normalizeCodexCatalogModelsForSave(codexCatalogModels)
            : [];
        if (
          normalizedCatalogModels.length > 0 &&
          !extractCodexModelName(normalizedCodexConfig)
        ) {
          normalizedCodexConfig = setCodexModelNameInConfig(
            normalizedCodexConfig,
            normalizedCatalogModels[0].model,
          );
        }
        const configObj = {
          auth: authJson,
          config: normalizedCodexConfig,
        } as {
          auth: unknown;
          config: string;
          modelCatalog?: {
            models: CodexCatalogModel[];
            autoReviewModel?: string;
          };
        };
        if (normalizedCatalogModels.length > 0) {
          configObj.modelCatalog = { models: normalizedCatalogModels };
          // 自动审批模型只能是映射里的（映射里删掉了就不再存，后端也只认目录里的）
          const autoReviewModel = codexAutoReviewModel.trim();
          if (
            autoReviewModel &&
            normalizedCatalogModels.some(
              (model) => model.model === autoReviewModel,
            )
          ) {
            configObj.modelCatalog.autoReviewModel = autoReviewModel;
          }
        }
        settingsConfig = JSON.stringify(configObj);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (usesGeminiStyleForm(appId)) {
      try {
        const envObj = envStringToObj(geminiEnv);
        const configObj = geminiConfig.trim() ? JSON.parse(geminiConfig) : {};
        const combined = {
          env: envObj,
          config: configObj,
        };
        settingsConfig = JSON.stringify(combined);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (
      appId === "opencode" &&
      (category === "omo" || category === "omo-slim")
    ) {
      const omoConfig: Record<string, unknown> = {};
      if (Object.keys(omoDraft.omoAgents).length > 0) {
        omoConfig.agents = omoDraft.omoAgents;
      }
      if (
        category === "omo" &&
        Object.keys(omoDraft.omoCategories).length > 0
      ) {
        omoConfig.categories = omoDraft.omoCategories;
      }
      if (omoDraft.omoOtherFieldsStr.trim()) {
        try {
          const otherFields = parseOmoOtherFieldsObject(
            omoDraft.omoOtherFieldsStr,
          );
          if (!otherFields) {
            toast.error(
              t("omo.jsonMustBeObject", {
                field: t("omo.otherFields", {
                  defaultValue: "Other Config",
                }),
                defaultValue: "{{field}} must be a JSON object",
              }),
            );
            return;
          }
          omoConfig.otherFields = otherFields;
        } catch {
          toast.error(
            t("omo.invalidJson", {
              defaultValue: "Other Fields contains invalid JSON",
            }),
          );
          return;
        }
      }
      settingsConfig = JSON.stringify(omoConfig);
    } else {
      settingsConfig = values.settingsConfig.trim();
    }

    const payload: ProviderFormValues = {
      ...values,
      name: values.name.trim(),
      websiteUrl: values.websiteUrl?.trim() ?? "",
      settingsConfig,
    };

    if (appId === "opencode") {
      if (isAnyOmoCategory) {
        if (!isEditMode) {
          const prefix = category === "omo" ? "omo" : "omo-slim";
          payload.providerKey = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
        }
      } else {
        payload.providerKey = opencodeForm.opencodeProviderKey;
      }
    } else if (appId === "openclaw") {
      payload.providerKey = openclawForm.openclawProviderKey;
    } else if (appId === "hermes") {
      payload.providerKey = hermesForm.hermesProviderKey;
    }

    if (isAnyOmoCategory && !payload.presetCategory) {
      payload.presetCategory = category;
    }

    if (activePreset) {
      payload.presetId = activePreset.id;
      if (activePreset.category) {
        payload.presetCategory = activePreset.category;
      }
      // OpenClaw: 传递预设的 suggestedDefaults 到提交数据
      if (activePreset.suggestedDefaults) {
        payload.suggestedDefaults =
          appId === "openclaw" && payload.providerKey
            ? rebaseOpenClawSuggestedDefaults(
                activePreset.suggestedDefaults,
                payload.providerKey,
              )
            : activePreset.suggestedDefaults;
      }
    }

    if (!isEditMode && draftCustomEndpoints.length > 0) {
      const customEndpointsToSave: Record<
        string,
        import("@/types").CustomEndpoint
      > = draftCustomEndpoints.reduce(
        (acc, url) => {
          const now = Date.now();
          acc[url] = { url, addedAt: now, lastUsed: undefined };
          return acc;
        },
        {} as Record<string, import("@/types").CustomEndpoint>,
      );

      const hadEndpoints =
        initialData?.meta?.custom_endpoints &&
        Object.keys(initialData.meta.custom_endpoints).length > 0;
      const needsClearEndpoints =
        hadEndpoints && draftCustomEndpoints.length === 0;

      let mergedMeta = needsClearEndpoints
        ? mergeProviderMeta(initialData?.meta, {})
        : mergeProviderMeta(initialData?.meta, customEndpointsToSave);

      if (mergedMeta !== undefined) {
        payload.meta = mergedMeta;
      }
    }

    const baseMeta: ProviderMeta | undefined =
      payload.meta ?? (initialData?.meta ? { ...initialData.meta } : undefined);

    // 确定 providerType（新建时从预设获取，编辑时从现有数据获取）
    const providerType = presetProviderType || initialData?.meta?.providerType;

    payload.meta = {
      ...(baseMeta ?? {}),
      opencodeConfigFormat: isNativeOpencode ? "v2" : undefined,
      stackModels:
        appId === "claude" && aggregationModels !== undefined
          ? normalizeAggregationModels(aggregationModels)
          : undefined,
      isPartner: activePreset
        ? activePreset.isPartner
          ? true
          : undefined
        : baseMeta?.isPartner,
      partnerPromotionKey: activePreset
        ? activePreset.partnerPromotionKey
        : baseMeta?.partnerPromotionKey,
      commonConfigEnabled:
        appId === "claude"
          ? true
          : appId === "codex"
            ? useCodexCommonConfigFlag
            : usesGeminiStyleForm(appId)
              ? true
              : undefined,
      endpointAutoSelect,
      // 保存 providerType（用于识别 Copilot 等特殊供应商）
      providerType,
      authBinding: isCopilotProvider
        ? {
            source: "managed_account",
            authProvider: "github_copilot",
            accountId: selectedGitHubAccountId ?? undefined,
          }
        : usesCodexManagedAccount
          ? {
              source: "managed_account",
              authProvider: "codex_oauth",
              accountId: selectedCodexAccountId ?? undefined,
            }
          : isXaiOauthProvider
            ? {
                source: "managed_account",
                authProvider: "xai_oauth",
                accountId: selectedXaiAccountId ?? undefined,
              }
            : appId === "agy" && category === "official" && selectedAgyAccountId
              ? {
                  source: "managed_account",
                  authProvider: "agy_oauth",
                  accountId: selectedAgyAccountId,
                }
              : appId === "claude" &&
                  category === "official" &&
                  selectedClaudeAccountId
                ? {
                    source: "managed_account",
                    authProvider: "claude_official",
                    accountId: selectedClaudeAccountId,
                  }
                : undefined,
      // GitHub Copilot 多账号：保存关联的账号 ID
      githubAccountId:
        isCopilotProvider && selectedGitHubAccountId
          ? selectedGitHubAccountId
          : undefined,
      codexChatReasoning:
        appId === "codex" && category !== "official" && isCodexChatFormat
          ? normalizeCodexChatReasoningForSave(codexChatReasoning)
          : undefined,
      promptCacheRouting:
        appId === "codex" &&
        category !== "official" &&
        isCodexChatFormat &&
        promptCacheRouting !== "auto"
          ? promptCacheRouting
          : undefined,
      claudeReasoningEffort:
        appId === "claude" &&
        category !== "official" &&
        (localApiFormat === "openai_chat" ||
          localApiFormat === "openai_responses") &&
        claudeReasoningEffort !== "auto"
          ? claudeReasoningEffort
          : undefined,
      customUserAgent:
        (appId === "claude" || appId === "codex") && category !== "official"
          ? customUserAgent.trim() || undefined
          : undefined,
      localProxyRequestOverrides: shouldApplyLocalProxyRequestOverrides
        ? overridesResult.overrides
        : undefined,
      testConfig: testConfig.enabled ? testConfig : undefined,
      proxyConfig: proxyConfig.enabled ? proxyConfig : undefined,
      apiFormat:
        appId === "claude" && category !== "official"
          ? isXaiOauthProvider
            ? "openai_responses"
            : localApiFormat
          : // 托管 Copilot 不存 apiFormat（旧卡上的代表值随保存去掉）
            appId === "codex" && category !== "official" && !isCopilotProvider
            ? isXaiOauthProvider
              ? "openai_responses"
              : localCodexApiFormat
            : undefined,
      codexCopilotApiFormat:
        appId === "codex" &&
        isCopilotProvider &&
        codexCopilotApiFormat !== "auto"
          ? codexCopilotApiFormat
          : undefined,
      apiKeyField:
        appId === "claude" &&
        category !== "official" &&
        localApiKeyField !== "ANTHROPIC_AUTH_TOKEN"
          ? localApiKeyField
          : undefined,
      isFullUrl:
        supportsFullUrl &&
        category !== "official" &&
        !isCopilotProvider &&
        !isXaiOauthProvider &&
        localIsFullUrl
          ? true
          : undefined,
    };

    await onSubmit(payload);
  };

  const shouldShowSpeedTest =
    category !== "official" && category !== "cloud_provider";

  const {
    shouldShowApiKeyLink: shouldShowClaudeApiKeyLink,
    websiteUrl: claudeWebsiteUrl,
    isPartner: isClaudePartner,
    partnerPromotionKey: claudePartnerPromotionKey,
  } = useApiKeyLink({
    appId: "claude",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: baseUrl,
  });

  const {
    shouldShowApiKeyLink: shouldShowCodexApiKeyLink,
    websiteUrl: codexWebsiteUrl,
    isPartner: isCodexPartner,
    partnerPromotionKey: codexPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "codex",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: codexBaseUrl,
  });

  const {
    shouldShowApiKeyLink: shouldShowGeminiApiKeyLink,
    websiteUrl: geminiWebsiteUrl,
    isPartner: isGeminiPartner,
    partnerPromotionKey: geminiPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "gemini",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: geminiBaseUrl,
  });

  const {
    shouldShowApiKeyLink: shouldShowOpencodeApiKeyLink,
    websiteUrl: opencodeWebsiteUrl,
    isPartner: isOpencodePartner,
    partnerPromotionKey: opencodePartnerPromotionKey,
  } = useApiKeyLink({
    appId: "opencode",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: opencodeForm.opencodeBaseUrl,
  });

  // 使用 API Key 链接 hook (OpenClaw)
  const {
    shouldShowApiKeyLink: shouldShowOpenclawApiKeyLink,
    websiteUrl: openclawWebsiteUrl,
    isPartner: isOpenclawPartner,
    partnerPromotionKey: openclawPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "openclaw",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: openclawForm.openclawBaseUrl,
  });

  const {
    shouldShowApiKeyLink: shouldShowHermesApiKeyLink,
    websiteUrl: hermesWebsiteUrl,
    isPartner: isHermesPartner,
    partnerPromotionKey: hermesPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "hermes",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    formBaseUrl: hermesForm.hermesBaseUrl,
  });

  // 使用端点测速候选 hook
  const speedTestEndpoints = useSpeedTestEndpoints({
    appId,
    selectedPresetId,
    presetEntries,
    baseUrl,
    codexBaseUrl,
    initialData,
  });

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);
    if (value === "custom") {
      setActivePreset(null);
      form.reset(defaultValues);

      if (appId === "codex") {
        const template = getCodexCustomTemplate();
        resetCodexConfig(
          template.auth,
          overlayCodexProviderConfig(providerLiveBase?.config, template.config),
        );
        setCodexChatReasoning({});
        setPromptCacheRouting("auto");
        setLocalCodexApiFormat(
          codexApiFormatFromWireApi(extractCodexWireApi(template.config)) ??
            "openai_responses",
        );
      }
      if (usesGeminiStyleForm(appId)) {
        const base = overlayGeminiProviderFields(providerLiveBase ?? {}, {});
        resetGeminiConfig(base.env, base.config);
      }
      if (appId === "opencode") {
        opencodeForm.resetOpencodeState();
        omoDraft.resetOmoDraftState();
      }
      // OpenClaw 自定义模式：重置为空配置
      if (appId === "openclaw") {
        openclawForm.resetOpenclawState();
      }
      if (appId === "hermes") {
        hermesForm.resetHermesState();
      }
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) {
      return;
    }

    setActivePreset({
      id: value,
      category: entry.preset.category,
      isPartner: entry.preset.isPartner,
      partnerPromotionKey: entry.preset.partnerPromotionKey,
    });

    if (appId === "codex") {
      const preset = entry.preset as CodexProviderPreset;
      const auth = preset.auth ?? {};
      const config = overlayCodexProviderConfig(
        providerLiveBase?.config,
        preset.config ?? "",
      );

      resetCodexConfig(auth, config, preset.modelCatalog ?? []);
      setCodexChatReasoning(preset.codexChatReasoning ?? {});
      setPromptCacheRouting(preset.promptCacheRouting ?? "auto");
      setCodexCopilotApiFormat("auto");
      setLocalCodexApiFormat(
        preset.apiFormat ??
          codexApiFormatFromWireApi(extractCodexWireApi(config)) ??
          "openai_responses",
      );

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(
          preset.modelCatalog?.length
            ? { auth, config, modelCatalog: { models: preset.modelCatalog } }
            : { auth, config },
          null,
          2,
        ),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (usesGeminiStyleForm(appId)) {
      const preset = entry.preset as GeminiProviderPreset;
      const merged = overlayGeminiProviderFields(
        providerLiveBase ?? {},
        preset.settingsConfig,
      );
      resetGeminiConfig(merged.env, merged.config);

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(merged, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "opencode") {
      const preset = entry.preset as OpenCodeProviderPreset;
      const config = preset.settingsConfig;

      if (preset.category === "omo" || preset.category === "omo-slim") {
        omoDraft.resetOmoDraftState();
        form.reset({
          name: preset.category === "omo" ? "OMO" : "OMO Slim",
          websiteUrl: preset.websiteUrl ?? "",
          settingsConfig: JSON.stringify({}, null, 2),
          icon: preset.icon ?? "",
          iconColor: preset.iconColor ?? "",
        });
        return;
      }

      opencodeForm.resetOpencodeState(config);

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    // OpenClaw preset handling
    if (appId === "openclaw") {
      const preset = entry.preset as OpenClawProviderPreset;
      const config = preset.settingsConfig;

      // Update activePreset with suggestedDefaults for OpenClaw
      setActivePreset({
        id: value,
        category: preset.category,
        isPartner: preset.isPartner,
        partnerPromotionKey: preset.partnerPromotionKey,
        suggestedDefaults: preset.suggestedDefaults,
      });

      openclawForm.resetOpenclawState(config);

      // Update form fields
      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "hermes") {
      const preset = entry.preset as HermesProviderPreset;
      const config = preset.settingsConfig;

      hermesForm.resetHermesState(config);
      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    const preset = entry.preset as ProviderPreset;
    const config = overlayClaudeProviderFields(
      providerLiveBase ?? {},
      withClaudeGatewayDefaults(
        applyTemplateValues(
          preset.settingsConfig,
          preset.templateValues,
        ) as Record<string, unknown>,
        preset.category,
      ),
    );

    if (preset.apiFormat) {
      setLocalApiFormat(preset.apiFormat);
    } else {
      setLocalApiFormat("anthropic");
    }
    setClaudeReasoningEffort("auto");

    setLocalApiKeyField(preset.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN");
    setLocalIsFullUrl(false);

    form.reset({
      name: preset.nameKey ? t(preset.nameKey) : preset.name,
      websiteUrl: preset.websiteUrl ?? "",
      settingsConfig: JSON.stringify(config, null, 2),
      icon: preset.icon ?? "",
      iconColor: preset.iconColor ?? "",
    });
  };

  const settingsConfigErrorField = (
    <FormField
      control={form.control}
      name="settingsConfig"
      render={() => (
        <FormItem className="space-y-0">
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <>
      <Form {...form}>
        <form
          id="provider-form"
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-6 glass rounded-xl p-6 border border-white/10"
        >
          {!initialData && (
            <ProviderPresetSelector
              selectedPresetId={selectedPresetId}
              presetEntries={presetEntries}
              presetCategoryLabels={presetCategoryLabels}
              onPresetChange={handlePresetChange}
              onUniversalPresetSelect={onUniversalPresetSelect}
              onManageUniversalProviders={onManageUniversalProviders}
              category={category}
            />
          )}

          <BasicFormFields
            form={form}
            beforeNameSlot={
              appId === "opencode" && !isAnyOmoCategory ? (
                <div className="space-y-2">
                  <Label htmlFor="opencode-key">
                    {t("opencode.providerKey")}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <ImeSafeInput
                    id="opencode-key"
                    value={opencodeForm.opencodeProviderKey}
                    onValueChange={opencodeForm.setOpencodeProviderKey}
                    normalize={normalizeProviderKey}
                    placeholder={t("opencode.providerKeyPlaceholder")}
                    disabled={
                      isProviderKeyLocked || isProviderKeyLockStateLoading
                    }
                    className={
                      (additiveExistingProviderKeys.includes(
                        opencodeForm.opencodeProviderKey,
                      ) &&
                        !isProviderKeyLocked) ||
                      isOpencodeProviderKeyInvalid
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {additiveExistingProviderKeys.includes(
                    opencodeForm.opencodeProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("opencode.providerKeyDuplicate")}
                      </p>
                    )}
                  {isOpencodeProviderKeyInvalid && (
                    <p className="text-xs text-destructive">
                      {t("opencode.providerKeyInvalid")}
                    </p>
                  )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      opencodeForm.opencodeProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    !isOpencodeProviderKeyInvalid && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("opencode.providerKeyLockedHint", {
                              defaultValue:
                                "该供应商已添加到应用配置中，供应商标识不可修改",
                            })
                          : t("opencode.providerKeyHint")}
                      </p>
                    )}
                </div>
              ) : appId === "openclaw" ? (
                <div className="space-y-2">
                  <Label htmlFor="openclaw-key">
                    {t("openclaw.providerKey")}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <ImeSafeInput
                    id="openclaw-key"
                    value={openclawForm.openclawProviderKey}
                    onValueChange={openclawForm.setOpenclawProviderKey}
                    normalize={normalizeProviderKey}
                    placeholder={t("openclaw.providerKeyPlaceholder")}
                    disabled={
                      isProviderKeyLocked || isProviderKeyLockStateLoading
                    }
                    className={
                      (additiveExistingProviderKeys.includes(
                        openclawForm.openclawProviderKey,
                      ) &&
                        !isProviderKeyLocked) ||
                      (openclawForm.openclawProviderKey.trim() !== "" &&
                        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                          openclawForm.openclawProviderKey,
                        ))
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {additiveExistingProviderKeys.includes(
                    openclawForm.openclawProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("openclaw.providerKeyDuplicate")}
                      </p>
                    )}
                  {openclawForm.openclawProviderKey.trim() !== "" &&
                    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      openclawForm.openclawProviderKey,
                    ) && (
                      <p className="text-xs text-destructive">
                        {t("openclaw.providerKeyInvalid")}
                      </p>
                    )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      openclawForm.openclawProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    (openclawForm.openclawProviderKey.trim() === "" ||
                      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        openclawForm.openclawProviderKey,
                      )) && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("openclaw.providerKeyLockedHint", {
                              defaultValue:
                                "该供应商已添加到应用配置中，供应商标识不可修改",
                            })
                          : t("openclaw.providerKeyHint")}
                      </p>
                    )}
                </div>
              ) : appId === "hermes" ? (
                <div className="space-y-2">
                  <Label htmlFor="hermes-key">
                    {t("hermes.form.providerKey")}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <ImeSafeInput
                    id="hermes-key"
                    value={hermesForm.hermesProviderKey}
                    onValueChange={hermesForm.setHermesProviderKey}
                    normalize={normalizeProviderKey}
                    placeholder={t("hermes.form.providerKeyPlaceholder")}
                    disabled={
                      isProviderKeyLocked || isProviderKeyLockStateLoading
                    }
                    className={
                      (additiveExistingProviderKeys.includes(
                        hermesForm.hermesProviderKey,
                      ) &&
                        !isProviderKeyLocked) ||
                      (hermesForm.hermesProviderKey.trim() !== "" &&
                        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                          hermesForm.hermesProviderKey,
                        ))
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {additiveExistingProviderKeys.includes(
                    hermesForm.hermesProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("hermes.form.providerKeyDuplicate")}
                      </p>
                    )}
                  {hermesForm.hermesProviderKey.trim() !== "" &&
                    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      hermesForm.hermesProviderKey,
                    ) && (
                      <p className="text-xs text-destructive">
                        {t("hermes.form.providerKeyInvalid")}
                      </p>
                    )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      hermesForm.hermesProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    (hermesForm.hermesProviderKey.trim() === "" ||
                      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        hermesForm.hermesProviderKey,
                      )) && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("hermes.form.providerKeyLockedHint")
                          : t("hermes.form.providerKeyHint")}
                      </p>
                    )}
                </div>
              ) : undefined
            }
          />

          {appId === "claude" && (
            <ClaudeFormFields
              directModeFormatNotice={directModeFormatNotice}
              aggregationModels={aggregationModels}
              onAggregationModelsChange={setAggregationModels}
              providerId={providerId}
              shouldShowApiKey={
                (category !== "cloud_provider" ||
                  hasApiKeyField(form.getValues("settingsConfig"), "claude")) &&
                shouldShowApiKey(form.getValues("settingsConfig"), isEditMode)
              }
              apiKey={apiKey}
              onApiKeyChange={handleApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowClaudeApiKeyLink}
              websiteUrl={claudeWebsiteUrl}
              isPartner={isClaudePartner}
              partnerPromotionKey={claudePartnerPromotionKey}
              isCopilotPreset={
                presetProviderType === "github_copilot" ||
                initialData?.meta?.providerType === "github_copilot" ||
                baseUrl.includes("githubcopilot.com")
              }
              isCodexOauthPreset={
                presetProviderType === "codex_oauth" ||
                initialData?.meta?.providerType === "codex_oauth"
              }
              isXaiOauthPreset={
                presetProviderType === "xai_oauth" ||
                initialData?.meta?.providerType === "xai_oauth"
              }
              usesOAuth={
                templatePreset?.requiresOAuth === true ||
                presetProviderType === "github_copilot" ||
                presetProviderType === "codex_oauth" ||
                presetProviderType === "xai_oauth" ||
                initialData?.meta?.providerType === "github_copilot" ||
                initialData?.meta?.providerType === "codex_oauth" ||
                initialData?.meta?.providerType === "xai_oauth" ||
                baseUrl.includes("githubcopilot.com")
              }
              isCopilotAuthenticated={isCopilotAuthenticated}
              isCodexOauthAuthenticated={isCodexOauthAuthenticated}
              selectedGitHubAccountId={selectedGitHubAccountId}
              onGitHubAccountSelect={setSelectedGitHubAccountId}
              selectedCodexAccountId={selectedCodexAccountId}
              onCodexAccountSelect={setSelectedCodexAccountId}
              selectedXaiAccountId={selectedXaiAccountId}
              onXaiAccountSelect={setSelectedXaiAccountId}
              templateValueEntries={templateValueEntries}
              templateValues={templateValues}
              templatePresetName={templatePreset?.name || ""}
              onTemplateValueChange={handleTemplateValueChange}
              shouldShowSpeedTest={shouldShowSpeedTest}
              baseUrl={baseUrl}
              onBaseUrlChange={handleClaudeBaseUrlChange}
              isEndpointModalOpen={isEndpointModalOpen}
              onEndpointModalToggle={setIsEndpointModalOpen}
              onCustomEndpointsChange={
                isEditMode ? undefined : setDraftCustomEndpoints
              }
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              shouldShowModelSelector={category !== "official"}
              claudeModel={claudeModel}
              defaultHaikuModel={defaultHaikuModel}
              defaultHaikuModelName={defaultHaikuModelName}
              defaultSonnetModel={defaultSonnetModel}
              defaultSonnetModelName={defaultSonnetModelName}
              defaultOpusModel={defaultOpusModel}
              defaultOpusModelName={defaultOpusModelName}
              defaultFableModel={defaultFableModel}
              defaultFableModelName={defaultFableModelName}
              subagentModel={subagentModel}
              onModelChange={handleModelChange}
              speedTestEndpoints={speedTestEndpoints}
              apiFormat={localApiFormat}
              onApiFormatChange={handleApiFormatChange}
              reasoningEffort={claudeReasoningEffort}
              onReasoningEffortChange={setClaudeReasoningEffort}
              apiKeyField={localApiKeyField}
              onApiKeyFieldChange={handleApiKeyFieldChange}
              isFullUrl={localIsFullUrl}
              onFullUrlChange={setLocalIsFullUrl}
              customUserAgent={customUserAgent}
              onCustomUserAgentChange={setCustomUserAgent}
              localProxyHeadersOverride={localProxyHeadersOverride}
              onLocalProxyHeadersOverrideChange={setLocalProxyHeadersOverride}
              localProxyBodyOverride={localProxyBodyOverride}
              onLocalProxyBodyOverrideChange={setLocalProxyBodyOverride}
            />
          )}

          {appId === "claude" && category === "official" && (
            <ClaudeAccountSelect
              value={selectedClaudeAccountId}
              onChange={setSelectedClaudeAccountId}
            />
          )}

          {appId === "codex" && (
            <>
              {category === "official" && (
                <CodexOAuthSection
                  selectedAccountId={selectedCodexAccountId}
                  onAccountSelect={setSelectedCodexAccountId}
                />
              )}
              <CodexFormFields
                providerId={providerId}
                isCopilotPreset={
                  presetProviderType === "github_copilot" ||
                  initialData?.meta?.providerType === "github_copilot"
                }
                isCopilotAuthenticated={isCopilotAuthenticated}
                selectedGitHubAccountId={selectedGitHubAccountId}
                onGitHubAccountSelect={setSelectedGitHubAccountId}
                isXaiOauthPreset={
                  presetProviderType === "xai_oauth" ||
                  initialData?.meta?.providerType === "xai_oauth"
                }
                isXaiOauthAuthenticated={isXaiOauthAuthenticated}
                selectedXaiAccountId={selectedXaiAccountId}
                onXaiAccountSelect={setSelectedXaiAccountId}
                codexApiKey={codexApiKey}
                onApiKeyChange={handleCodexApiKeyChange}
                category={category}
                shouldShowApiKeyLink={shouldShowCodexApiKeyLink}
                websiteUrl={codexWebsiteUrl}
                isPartner={isCodexPartner}
                partnerPromotionKey={codexPartnerPromotionKey}
                shouldShowSpeedTest={shouldShowSpeedTest}
                codexBaseUrl={codexBaseUrl}
                onBaseUrlChange={handleCodexBaseUrlChange}
                isFullUrl={localIsFullUrl}
                onFullUrlChange={setLocalIsFullUrl}
                isEndpointModalOpen={isCodexEndpointModalOpen}
                onEndpointModalToggle={setIsCodexEndpointModalOpen}
                onCustomEndpointsChange={
                  isEditMode ? undefined : setDraftCustomEndpoints
                }
                autoSelect={endpointAutoSelect}
                onAutoSelectChange={setEndpointAutoSelect}
                directModeFormatNotice={directModeFormatNotice}
                apiFormat={localCodexApiFormat}
                onApiFormatChange={handleCodexApiFormatChange}
                copilotApiFormat={effectiveCodexCopilotApiFormat}
                onCopilotApiFormatChange={handleCodexCopilotApiFormatChange}
                shouldShowModelField={category !== "official"}
                modelName={codexModelName}
                onModelNameChange={handleCodexModelNameChange}
                codexChatReasoning={codexChatReasoning}
                onCodexChatReasoningChange={setCodexChatReasoning}
                promptCacheRouting={promptCacheRouting}
                onPromptCacheRoutingChange={setPromptCacheRouting}
                catalogModels={codexCatalogModels}
                onCatalogModelsChange={setCodexCatalogModels}
                autoReviewModel={codexAutoReviewModel}
                onAutoReviewModelChange={setCodexAutoReviewModel}
                subagentModel={codexSubagentModel}
                onSubagentModelChange={handleCodexSubagentModelChange}
                subagentReasoningEffort={codexSubagentReasoningEffort}
                onSubagentReasoningEffortChange={
                  handleCodexSubagentReasoningEffortChange
                }
                agentMaxThreads={codexAgentMaxThreads}
                multiAgentV2Total={codexMultiAgentV2Total}
                onAgentMaxThreadsChange={handleCodexAgentMaxThreadsChange}
                speedTestEndpoints={speedTestEndpoints}
                customUserAgent={customUserAgent}
                onCustomUserAgentChange={setCustomUserAgent}
                localProxyHeadersOverride={localProxyHeadersOverride}
                onLocalProxyHeadersOverrideChange={setLocalProxyHeadersOverride}
                localProxyBodyOverride={localProxyBodyOverride}
                onLocalProxyBodyOverrideChange={setLocalProxyBodyOverride}
              />
            </>
          )}

          {usesGeminiStyleForm(appId) && (
            <GeminiFormFields
              appId={appId as "gemini" | "agy"}
              providerId={providerId}
              shouldShowApiKey={shouldShowApiKey(
                form.getValues("settingsConfig"),
                isEditMode,
              )}
              apiKey={geminiApiKey}
              onApiKeyChange={handleGeminiApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowGeminiApiKeyLink}
              websiteUrl={geminiWebsiteUrl}
              isPartner={isGeminiPartner}
              partnerPromotionKey={geminiPartnerPromotionKey}
              shouldShowSpeedTest={shouldShowSpeedTest}
              baseUrl={geminiBaseUrl}
              onBaseUrlChange={handleGeminiBaseUrlChange}
              isEndpointModalOpen={isEndpointModalOpen}
              onEndpointModalToggle={setIsEndpointModalOpen}
              onCustomEndpointsChange={setDraftCustomEndpoints}
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              shouldShowModelField={true}
              model={geminiModel}
              onModelChange={handleGeminiModelChange}
              speedTestEndpoints={speedTestEndpoints}
            />
          )}

          {/* 切号只实现了 macOS 钥匙串：服务端不支持时不显示，卡上已有的绑定原样保留 */}
          {appId === "agy" &&
            category === "official" &&
            agyAccountSupported && (
              <AgyAccountSelect
                value={selectedAgyAccountId}
                onChange={setSelectedAgyAccountId}
              />
            )}

          {appId === "opencode" && !isAnyOmoCategory && !isNativeOpencode && (
            <OpenCodeFormFields
              allowBuiltinDefaults={canKeepExistingOpencodeOverride}
              npm={opencodeForm.opencodeNpm}
              onNpmChange={opencodeForm.handleOpencodeNpmChange}
              apiKey={opencodeForm.opencodeApiKey}
              onApiKeyChange={opencodeForm.handleOpencodeApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowOpencodeApiKeyLink}
              websiteUrl={opencodeWebsiteUrl}
              isPartner={isOpencodePartner}
              partnerPromotionKey={opencodePartnerPromotionKey}
              baseUrl={opencodeForm.opencodeBaseUrl}
              onBaseUrlChange={opencodeForm.handleOpencodeBaseUrlChange}
              headers={opencodeForm.opencodeHeaders}
              onHeadersChange={opencodeForm.handleOpencodeHeadersChange}
              models={opencodeForm.opencodeModels}
              onModelsChange={opencodeForm.handleOpencodeModelsChange}
              extraOptions={opencodeForm.opencodeExtraOptions}
              onExtraOptionsChange={
                opencodeForm.handleOpencodeExtraOptionsChange
              }
            />
          )}

          {appId === "opencode" &&
            (category === "omo" || category === "omo-slim") && (
              <OmoFormFields
                modelOptions={omoModelOptions}
                modelVariantsMap={omoModelVariantsMap}
                presetMetaMap={omoPresetMetaMap}
                agents={omoDraft.omoAgents}
                onAgentsChange={omoDraft.setOmoAgents}
                categories={
                  category === "omo" ? omoDraft.omoCategories : undefined
                }
                onCategoriesChange={
                  category === "omo" ? omoDraft.setOmoCategories : undefined
                }
                otherFieldsStr={omoDraft.omoOtherFieldsStr}
                onOtherFieldsStrChange={omoDraft.setOmoOtherFieldsStr}
                isSlim={category === "omo-slim"}
              />
            )}

          {/* OpenClaw 专属字段 */}
          {appId === "openclaw" && (
            <OpenClawFormFields
              baseUrl={openclawForm.openclawBaseUrl}
              onBaseUrlChange={openclawForm.handleOpenclawBaseUrlChange}
              apiKey={openclawForm.openclawApiKey}
              onApiKeyChange={openclawForm.handleOpenclawApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowOpenclawApiKeyLink}
              websiteUrl={openclawWebsiteUrl}
              isPartner={isOpenclawPartner}
              partnerPromotionKey={openclawPartnerPromotionKey}
              api={openclawForm.openclawApi}
              onApiChange={openclawForm.handleOpenclawApiChange}
              models={openclawForm.openclawModels}
              onModelsChange={openclawForm.handleOpenclawModelsChange}
              userAgent={openclawForm.openclawUserAgent}
              onUserAgentChange={openclawForm.handleOpenclawUserAgentChange}
            />
          )}

          {appId === "hermes" && (
            <HermesFormFields
              baseUrl={hermesForm.hermesBaseUrl}
              onBaseUrlChange={hermesForm.handleHermesBaseUrlChange}
              apiKey={hermesForm.hermesApiKey}
              onApiKeyChange={hermesForm.handleHermesApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowHermesApiKeyLink}
              websiteUrl={hermesWebsiteUrl}
              isPartner={isHermesPartner}
              partnerPromotionKey={hermesPartnerPromotionKey}
              apiMode={hermesForm.hermesApiMode}
              onApiModeChange={hermesForm.handleHermesApiModeChange}
              models={hermesForm.hermesModels}
              onModelsChange={hermesForm.handleHermesModelsChange}
              rateLimitDelay={hermesForm.hermesRateLimitDelay}
              onRateLimitDelayChange={
                hermesForm.handleHermesRateLimitDelayChange
              }
            />
          )}

          {/* 配置编辑器：Codex、Claude、Gemini 分别使用不同的编辑器 */}
          {appId === "codex" ? (
            <>
              <CodexConfigEditor
                keyFieldMode
                authValue={codexAuth}
                configValue={codexConfig}
                onAuthChange={setCodexAuth}
                onConfigChange={handleCodexConfigChange}
                useCommonConfig={useCodexCommonConfigFlag}
                onCommonConfigToggle={handleCodexCommonConfigToggle}
                commonConfigSnippet={codexCommonConfigSnippet}
                onCommonConfigSnippetChange={
                  handleCodexCommonConfigSnippetChange
                }
                onCommonConfigErrorClear={clearCodexCommonConfigError}
                commonConfigError={codexCommonConfigError}
                authError={codexAuthError}
                configError={codexConfigError}
                onExtract={handleCodexExtract}
                isExtracting={isCodexExtracting}
              />
              {settingsConfigErrorField}
            </>
          ) : usesGeminiStyleForm(appId) ? (
            <>
              <GeminiConfigEditor
                isAgy={appId === "agy"}
                keyFieldMode
                envValue={geminiEnv}
                configValue={geminiConfig}
                onEnvChange={handleGeminiEnvChange}
                onConfigChange={handleGeminiConfigChange}
                useCommonConfig={useGeminiCommonConfigFlag}
                onCommonConfigToggle={handleGeminiCommonConfigToggle}
                commonConfigSnippet={geminiCommonConfigSnippet}
                onCommonConfigSnippetChange={
                  handleGeminiCommonConfigSnippetChange
                }
                onCommonConfigErrorClear={clearGeminiCommonConfigError}
                commonConfigError={geminiCommonConfigError}
                envError={envError}
                configError={geminiConfigError}
                onExtract={handleGeminiExtract}
                isExtracting={isGeminiExtracting}
              />
              {settingsConfigErrorField}
            </>
          ) : appId === "opencode" &&
            (category === "omo" || category === "omo-slim") ? (
            <div className="space-y-2">
              <Label>{t("provider.configJson")}</Label>
              <JsonEditor
                value={omoDraft.mergedOmoJsonPreview}
                onChange={() => {}}
                rows={3}
                showValidation={false}
                language="json"
              />
            </div>
          ) : appId === "opencode" &&
            category !== "omo" &&
            category !== "omo-slim" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="settingsConfig">
                  {t("provider.configJson")}
                </Label>
                {isNativeOpencode && (
                  <p className="text-sm text-fg-2">
                    {t("opencode.nativeConfigHint")}
                  </p>
                )}
                <JsonEditor
                  value={form.getValues("settingsConfig")}
                  onChange={handleSettingsConfigChange}
                  placeholder={
                    isNativeOpencode
                      ? "{}"
                      : `{
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "https://your-api-endpoint.com",
    "apiKey": "your-api-key-here"
  },
  "models": {}
}`
                  }
                  rows={3}
                  showValidation={true}
                  language="json"
                />
              </div>
              {settingsConfigErrorField}
            </>
          ) : appId === "openclaw" || appId === "hermes" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="settingsConfig">
                  {t("provider.configJson")}
                </Label>
                <JsonEditor
                  value={form.getValues("settingsConfig")}
                  onChange={handleSettingsConfigChange}
                  placeholder={
                    appId === "hermes"
                      ? `{
  "name": "my-provider",
  "base_url": "https://api.example.com/v1",
  "api_key": ""
}`
                      : `{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "your-api-key-here",
  "api": "openai-completions",
  "models": []
}`
                  }
                  rows={3}
                  showValidation={true}
                  language="json"
                />
              </div>
              <FormField
                control={form.control}
                name="settingsConfig"
                render={() => (
                  <FormItem className="space-y-0">
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <>
              <CommonConfigEditor
                keyFieldMode={appId === "claude"}
                value={form.getValues("settingsConfig")}
                onChange={handleSettingsConfigChange}
                useCommonConfig={useCommonConfig}
                onCommonConfigToggle={handleCommonConfigToggle}
                commonConfigSnippet={commonConfigSnippet}
                onCommonConfigSnippetChange={handleCommonConfigSnippetChange}
                commonConfigError={commonConfigError}
                onEditClick={() => setIsCommonConfigModalOpen(true)}
                isModalOpen={isCommonConfigModalOpen}
                onModalClose={() => setIsCommonConfigModalOpen(false)}
                onExtract={handleClaudeExtract}
                isExtracting={isClaudeExtracting}
              />
              {settingsConfigErrorField}
            </>
          )}

          {!isAnyOmoCategory &&
            appId !== "opencode" &&
            appId !== "openclaw" &&
            appId !== "hermes" && (
              <ProviderAdvancedConfig
                testConfig={testConfig}
                proxyConfig={proxyConfig}
                onTestConfigChange={setTestConfig}
                onProxyConfigChange={setProxyConfig}
              />
            )}

          {showButtons && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {submitLabel}
              </Button>
            </div>
          )}
        </form>
      </Form>

      <ConfirmDialog
        isOpen={showCommonConfigNotice}
        variant="info"
        title={t("confirm.commonConfig.title")}
        message={t("confirm.commonConfig.message")}
        confirmText={t("confirm.commonConfig.confirm")}
        onConfirm={() => void handleCommonConfigConfirm()}
        onCancel={() => void handleCommonConfigConfirm()}
      />
    </>
  );
}

export type ProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  meta?: ProviderMeta;
  providerKey?: string; // OpenCode/OpenClaw: user-defined provider key
  suggestedDefaults?: OpenClawSuggestedDefaults; // OpenClaw: suggested default model configuration
};

export function ProviderForm(props: ProviderFormProps) {
  if (props.appId === "mcode" || props.appId === "dsh")
    return <McodeProviderForm {...props} />;
  if (props.appId === "kimi") return <KimiProviderForm {...props} />;
  if (props.appId === "pi" || props.appId === "omp") {
    return <PiProviderForm {...props} />;
  }
  if (props.appId === "claude-desktop") {
    return <ClaudeDesktopProviderForm {...props} />;
  }
  if (props.appId === "grokbuild") {
    return <GrokBuildProviderForm {...props} />;
  }
  return <ProviderFormFull {...props} />;
}
