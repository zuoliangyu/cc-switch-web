import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { FormLabel } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Wand2,
} from "lucide-react";
import EndpointSpeedTest from "./EndpointSpeedTest";
import {
  ApiKeySection,
  EndpointField,
  ModelDropdown,
  ModelInputWithFetch,
} from "./shared";
import { CopilotAuthSection } from "./CopilotAuthSection";
import { CodexOAuthSection } from "./CodexOAuthSection";
import { XaiOAuthSection } from "./XaiOAuthSection";
import {
  copilotGetModels,
  copilotGetModelsForAccount,
} from "@/lib/api/copilot";
import type { CopilotModel } from "@/lib/api/copilot";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { CustomUserAgentField } from "./CustomUserAgentField";
import { LocalProxyRequestOverridesField } from "./LocalProxyRequestOverridesField";
import type {
  ProviderCategory,
  ClaudeApiFormat,
  ClaudeApiKeyField,
} from "@/types";
import {
  providerPresets,
  type TemplateValueConfig,
} from "@/config/claudeProviderPresets";
import {
  hasClaudeOneMMarker,
  setClaudeOneMMarker,
  stripClaudeOneMMarker,
  type ClaudeModelEnvField,
} from "./hooks/useModelState";

interface EndpointCandidate {
  url: string;
}

interface ClaudeFormFieldsProps {
  providerId?: string;
  // API Key
  shouldShowApiKey: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // GitHub Copilot OAuth
  isCopilotPreset?: boolean;
  usesOAuth?: boolean;
  isCopilotAuthenticated?: boolean;
  /** 当前选中的 GitHub 账号 ID（多账号支持） */
  selectedGitHubAccountId?: string | null;
  /** GitHub 账号选择回调（多账号支持） */
  onGitHubAccountSelect?: (accountId: string | null) => void;

  // Codex OAuth
  isCodexOauthPreset?: boolean;
  isCodexOauthAuthenticated?: boolean;
  selectedCodexAccountId?: string | null;
  onCodexAccountSelect?: (accountId: string | null) => void;

  // xAI OAuth
  isXaiOauthPreset?: boolean;
  selectedXaiAccountId?: string | null;
  onXaiAccountSelect?: (accountId: string | null) => void;

  // Template Values
  templateValueEntries: Array<[string, TemplateValueConfig]>;
  templateValues: Record<string, TemplateValueConfig>;
  templatePresetName: string;
  onTemplateValueChange: (key: string, value: string) => void;

  // Base URL
  shouldShowSpeedTest: boolean;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;

  // Model Selector
  shouldShowModelSelector: boolean;
  claudeModel: string;
  defaultHaikuModel: string;
  defaultSonnetModel: string;
  defaultOpusModel: string;
  defaultHaikuModelName: string;
  defaultSonnetModelName: string;
  defaultOpusModelName: string;
  defaultFableModel: string;
  defaultFableModelName: string;
  subagentModel: string;
  onModelChange: (field: ClaudeModelEnvField, value: string) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];

  // API Format (for third-party providers that use OpenAI Chat Completions format)
  apiFormat: ClaudeApiFormat;
  onApiFormatChange: (format: ClaudeApiFormat) => void;

  // Auth Field (ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY)
  apiKeyField: ClaudeApiKeyField;
  onApiKeyFieldChange: (field: ClaudeApiKeyField) => void;

  // Full URL mode
  isFullUrl: boolean;
  onFullUrlChange: (value: boolean) => void;

  customUserAgent: string;
  onCustomUserAgentChange: (value: string) => void;
  localProxyHeadersOverride: string;
  onLocalProxyHeadersOverrideChange: (value: string) => void;
  localProxyBodyOverride: string;
  onLocalProxyBodyOverrideChange: (value: string) => void;
}

export function ClaudeFormFields({
  providerId,
  shouldShowApiKey,
  apiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  isPartner,
  partnerPromotionKey,
  isCopilotPreset,
  usesOAuth,
  isCopilotAuthenticated,
  selectedGitHubAccountId,
  onGitHubAccountSelect,
  isCodexOauthPreset,
  selectedCodexAccountId,
  onCodexAccountSelect,
  isXaiOauthPreset,
  selectedXaiAccountId,
  onXaiAccountSelect,
  templateValueEntries,
  templateValues,
  templatePresetName,
  onTemplateValueChange,
  shouldShowSpeedTest,
  baseUrl,
  onBaseUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  autoSelect,
  onAutoSelectChange,
  shouldShowModelSelector,
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
  onModelChange,
  speedTestEndpoints,
  apiFormat,
  onApiFormatChange,
  apiKeyField,
  onApiKeyFieldChange,
  isFullUrl,
  onFullUrlChange,
  customUserAgent,
  onCustomUserAgentChange,
  localProxyHeadersOverride,
  onLocalProxyHeadersOverrideChange,
  localProxyBodyOverride,
  onLocalProxyBodyOverrideChange,
}: ClaudeFormFieldsProps) {
  const { t } = useTranslation();
  const hasRequestOverrides = Boolean(
    localProxyHeadersOverride.trim() || localProxyBodyOverride.trim(),
  );
  const hasAnyAdvancedValue = !!(
    claudeModel ||
    defaultHaikuModel ||
    defaultSonnetModel ||
    defaultOpusModel ||
    (!isXaiOauthPreset && apiFormat !== "anthropic") ||
    apiKeyField !== "ANTHROPIC_AUTH_TOKEN" ||
    customUserAgent ||
    hasRequestOverrides
  );
  const [advancedExpanded, setAdvancedExpanded] = useState(
    isXaiOauthPreset ? false : hasAnyAdvancedValue,
  );

  // 预设填充高级值后自动展开（仅从折叠→展开，不会自动折叠）
  useEffect(() => {
    if (isXaiOauthPreset) {
      setAdvancedExpanded(false);
    } else if (hasAnyAdvancedValue) {
      setAdvancedExpanded(true);
    }
  }, [hasAnyAdvancedValue, isXaiOauthPreset]);

  // Copilot 可用模型列表
  const [copilotModels, setCopilotModels] = useState<CopilotModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const handleFetchModels = useCallback(() => {
    if (!baseUrl || !apiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!apiKey,
        hasBaseUrl: !!baseUrl,
      });
      return;
    }

    const modelsUrl = providerPresets.find((preset) => {
      const env = (preset.settingsConfig as { env?: Record<string, string> })
        .env;
      return env?.ANTHROPIC_BASE_URL === baseUrl;
    })?.modelsUrl;

    setIsFetchingModels(true);
    fetchModelsForConfig(baseUrl, apiKey, isFullUrl, modelsUrl, customUserAgent)
      .then((models) => {
        setFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((error) => {
        console.warn("[ModelFetch] Failed:", error);
        showFetchModelsError(error, t);
      })
      .finally(() => setIsFetchingModels(false));
  }, [apiKey, baseUrl, customUserAgent, isFullUrl, t]);

  // 当 Copilot 预设且已认证时，加载可用模型
  useEffect(() => {
    // 如果不是 Copilot 预设或未认证，清空模型列表
    if (!isCopilotPreset || !isCopilotAuthenticated) {
      setCopilotModels([]);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    const fetchModels = selectedGitHubAccountId
      ? copilotGetModelsForAccount(selectedGitHubAccountId)
      : copilotGetModels();

    fetchModels
      .then((models) => {
        if (!cancelled) setCopilotModels(models);
      })
      .catch((err) => {
        console.warn("[Copilot] Failed to fetch models:", err);
        if (!cancelled) {
          toast.error(
            t("copilot.loadModelsFailed", {
              defaultValue: "加载 Copilot 模型列表失败",
            }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCopilotPreset, isCopilotAuthenticated, selectedGitHubAccountId]);

  const fallbackUsesOneM = hasClaudeOneMMarker(claudeModel);

  // 模型输入框：支持手动输入 + 下拉选择
  const renderModelInput = (
    id: string,
    value: string,
    field: ClaudeModelEnvField,
    placeholder?: string,
    onValueChange?: (value: string) => void,
  ) => {
    const updateValue =
      onValueChange ?? ((next: string) => onModelChange(field, next));

    if (isCopilotPreset && copilotModels.length > 0) {
      const selectableModels: FetchedModel[] = copilotModels.map((model) => ({
        id: model.id,
        ownedBy: model.vendor || null,
      }));

      return (
        <div className="flex gap-1">
          <Input
            id={id}
            type="text"
            value={value}
            onChange={(e) => updateValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1"
          />
          <ModelDropdown models={selectableModels} onSelect={updateValue} />
        </div>
      );
    }

    if (isCopilotPreset && modelsLoading) {
      return (
        <div className="flex gap-1">
          <Input
            id={id}
            type="text"
            value={value}
            onChange={(e) => updateValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1"
          />
          <Button variant="outline" size="icon" className="shrink-0" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        </div>
      );
    }

    return (
      <ModelInputWithFetch
        id={id}
        value={value}
        onChange={updateValue}
        placeholder={placeholder}
        fetchedModels={fetchedModels}
        isLoading={isFetchingModels}
      />
    );
  };

  type ModelRoleRow = {
    role: "sonnet" | "opus" | "fable" | "haiku" | "subagent";
    label: string;
    model: string;
    displayName?: string;
    modelField: ClaudeModelEnvField;
    displayNameField?: ClaudeModelEnvField;
    inputId: string;
    supportsOneM: boolean;
  };

  const modelRoleRows: ModelRoleRow[] = [
    {
      role: "sonnet",
      label: t("providerForm.modelRoleSonnet", { defaultValue: "Sonnet" }),
      model: defaultSonnetModel,
      displayName: defaultSonnetModelName,
      modelField: "ANTHROPIC_DEFAULT_SONNET_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      inputId: "claudeDefaultSonnetModel",
      supportsOneM: true,
    },
    {
      role: "opus",
      label: t("providerForm.modelRoleOpus", { defaultValue: "Opus" }),
      model: defaultOpusModel,
      displayName: defaultOpusModelName,
      modelField: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
      inputId: "claudeDefaultOpusModel",
      supportsOneM: true,
    },
    {
      role: "fable",
      label: t("providerForm.modelRoleFable", { defaultValue: "Fable" }),
      model: defaultFableModel,
      displayName: defaultFableModelName,
      modelField: "ANTHROPIC_DEFAULT_FABLE_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
      inputId: "claudeDefaultFableModel",
      supportsOneM: true,
    },
    {
      role: "haiku",
      label: t("providerForm.modelRoleHaiku", { defaultValue: "Haiku" }),
      model: defaultHaikuModel,
      displayName: defaultHaikuModelName,
      modelField: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      inputId: "claudeDefaultHaikuModel",
      supportsOneM: false,
    },
    {
      role: "subagent",
      label: t("providerForm.modelRoleSubagent", {
        defaultValue: "Subagent",
      }),
      model: subagentModel,
      modelField: "CLAUDE_CODE_SUBAGENT_MODEL",
      inputId: "claudeCodeSubagentModel",
      supportsOneM: true,
    },
  ];

  const handleRoleModelChange = (row: ModelRoleRow, value: string) => {
    const oldModelBase = stripClaudeOneMMarker(row.model).trim();
    const normalizedValue = row.supportsOneM
      ? value
      : stripClaudeOneMMarker(value);
    const nextModelBase = stripClaudeOneMMarker(normalizedValue).trim();
    const displayName = row.displayName?.trim() ?? "";
    const shouldSyncDisplayName = !displayName || displayName === oldModelBase;
    onModelChange(row.modelField, normalizedValue);
    if (row.displayNameField && shouldSyncDisplayName) {
      onModelChange(row.displayNameField, nextModelBase);
    }
  };

  const handleRoleOneMChange = (row: ModelRoleRow, enabled: boolean) => {
    if (!row.supportsOneM) return;
    handleRoleModelChange(row, setClaudeOneMMarker(row.model, enabled));
  };

  return (
    <>
      {/* GitHub Copilot OAuth 认证 */}
      {isCopilotPreset && (
        <CopilotAuthSection
          selectedAccountId={selectedGitHubAccountId}
          onAccountSelect={onGitHubAccountSelect}
        />
      )}

      {isCodexOauthPreset && (
        <CodexOAuthSection
          selectedAccountId={selectedCodexAccountId}
          onAccountSelect={onCodexAccountSelect}
        />
      )}

      {isXaiOauthPreset && (
        <XaiOAuthSection
          selectedAccountId={selectedXaiAccountId}
          onAccountSelect={onXaiAccountSelect}
        />
      )}

      {/* API Key 输入框（非 OAuth 预设时显示） */}
      {shouldShowApiKey && !usesOAuth && (
        <ApiKeySection
          value={apiKey}
          onChange={onApiKeyChange}
          category={category}
          shouldShowLink={shouldShowApiKeyLink}
          websiteUrl={websiteUrl}
          isPartner={isPartner}
          partnerPromotionKey={partnerPromotionKey}
        />
      )}

      {/* 模板变量输入 */}
      {templateValueEntries.length > 0 && (
        <div className="space-y-3">
          <FormLabel>
            {t("providerForm.parameterConfig", {
              name: templatePresetName,
              defaultValue: `${templatePresetName} 参数配置`,
            })}
          </FormLabel>
          <div className="space-y-4">
            {templateValueEntries.map(([key, config]) => (
              <div key={key} className="space-y-2">
                <FormLabel htmlFor={`template-${key}`}>
                  {config.label}
                </FormLabel>
                <Input
                  id={`template-${key}`}
                  type="text"
                  required
                  value={
                    templateValues[key]?.editorValue ??
                    config.editorValue ??
                    config.defaultValue ??
                    ""
                  }
                  onChange={(e) => onTemplateValueChange(key, e.target.value)}
                  placeholder={config.placeholder || config.label}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Base URL 输入框 */}
      {shouldShowSpeedTest && (
        <EndpointField
          id="baseUrl"
          label={t("providerForm.apiEndpoint")}
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.apiEndpointPlaceholder")}
          hint={
            apiFormat === "openai_responses"
              ? t("providerForm.apiHintResponses")
              : apiFormat === "openai_chat"
                ? t("providerForm.apiHintOAI")
                : apiFormat === "gemini_native"
                  ? t("providerForm.apiHintGeminiNative")
                  : t("providerForm.apiHint")
          }
          fullUrlHint={
            apiFormat === "gemini_native"
              ? t("providerForm.fullUrlHintGeminiNative")
              : undefined
          }
          onManageClick={() => onEndpointModalToggle(true)}
          showFullUrlToggle={!isXaiOauthPreset}
          isFullUrl={isFullUrl}
          onFullUrlChange={onFullUrlChange}
        />
      )}

      {/* 端点测速弹窗 */}
      {shouldShowSpeedTest && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="claude"
          providerId={providerId}
          value={baseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          visible={isEndpointModalOpen}
          onClose={() => onEndpointModalToggle(false)}
          autoSelect={autoSelect}
          onAutoSelectChange={onAutoSelectChange}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}

      {/* 高级选项（API 格式 + 认证字段 + 模型映射） */}
      {shouldShowModelSelector && (
        <Collapsible
          open={advancedExpanded}
          onOpenChange={setAdvancedExpanded}
          className="rounded-lg border border-border-default p-4"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant={null}
              size="sm"
              className="h-8 w-full justify-start gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
            >
              {advancedExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {t("providerForm.advancedOptionsToggle")}
            </Button>
          </CollapsibleTrigger>
          {!advancedExpanded && (
            <p className="text-xs text-muted-foreground mt-1 ml-1">
              {t("providerForm.advancedOptionsHint")}
            </p>
          )}
          <CollapsibleContent className="space-y-4 pt-2">
            {/* 上游格式选择（仅非云服务商显示） */}
            {category !== "cloud_provider" && !isXaiOauthPreset && (
              <div className="space-y-2">
                <FormLabel htmlFor="apiFormat">
                  {t("providerForm.apiFormat", { defaultValue: "上游格式" })}
                </FormLabel>
                <Select value={apiFormat} onValueChange={onApiFormatChange}>
                  <SelectTrigger id="apiFormat" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">
                      {t("providerForm.apiFormatAnthropic", {
                        defaultValue: "Anthropic Messages (原生)",
                      })}
                    </SelectItem>
                    <SelectItem value="openai_chat">
                      {t("providerForm.apiFormatOpenAIChat", {
                        defaultValue: "OpenAI Chat Completions (需转换)",
                      })}
                    </SelectItem>
                    <SelectItem value="openai_responses">
                      {t("providerForm.apiFormatOpenAIResponses", {
                        defaultValue: "OpenAI Responses API (需转换)",
                      })}
                    </SelectItem>
                    <SelectItem value="gemini_native">
                      {t("providerForm.apiFormatGeminiNative", {
                        defaultValue: "Gemini Native generateContent (需转换)",
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("providerForm.apiFormatHint", {
                    defaultValue:
                      "供应商原生为 Anthropic Messages API 就选 Anthropic Messages（直连，不转换格式）；使用 Chat Completions 协议就选 Chat；使用 Responses API 就选 Responses；使用 Gemini generateContent 协议就选 Gemini Native。Chat、Responses 与 Gemini Native 均需开启路由接管才能转换为 Anthropic Messages。",
                  })}
                </p>
              </div>
            )}

            {/* 认证字段选择器 */}
            <div className="space-y-2">
              <FormLabel>
                {t("providerForm.authField", { defaultValue: "认证字段" })}
              </FormLabel>
              <Select
                value={apiKeyField}
                onValueChange={(v) =>
                  onApiKeyFieldChange(v as ClaudeApiKeyField)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANTHROPIC_AUTH_TOKEN">
                    {t("providerForm.authFieldAuthToken", {
                      defaultValue: "ANTHROPIC_AUTH_TOKEN（默认）",
                    })}
                  </SelectItem>
                  <SelectItem value="ANTHROPIC_API_KEY">
                    {t("providerForm.authFieldApiKey", {
                      defaultValue: "ANTHROPIC_API_KEY",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("providerForm.authFieldHint", {
                  defaultValue: "选择写入配置的认证环境变量名",
                })}
              </p>
            </div>

            {/* 模型映射 */}
            <div className="space-y-1 border-t border-border-default pt-2">
              <div className="flex items-center justify-between">
                <FormLabel>{t("providerForm.modelMappingLabel")}</FormLabel>
                <div className="flex gap-2">
                  {/* 一键设置按钮 */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // 按面板从上到下取值，默认兜底模型最后使用。
                      const value =
                        defaultSonnetModel ||
                        defaultOpusModel ||
                        defaultFableModel ||
                        defaultHaikuModel ||
                        subagentModel ||
                        claudeModel;
                      if (value) {
                        for (const row of modelRoleRows) {
                          const roleValue = row.supportsOneM
                            ? value
                            : stripClaudeOneMMarker(value);
                          onModelChange(row.modelField, roleValue);
                          if (row.displayNameField) {
                            onModelChange(
                              row.displayNameField,
                              stripClaudeOneMMarker(roleValue),
                            );
                          }
                        }
                        toast.success(
                          t("providerForm.quickSetSuccess", {
                            defaultValue: "已将模型名称应用到所有角色",
                          }),
                        );
                      }
                    }}
                    disabled={
                      !claudeModel &&
                      !defaultHaikuModel &&
                      !defaultSonnetModel &&
                      !defaultOpusModel &&
                      !defaultFableModel &&
                      !subagentModel
                    }
                    className="h-7 gap-1"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("providerForm.quickSetModels", {
                      defaultValue: "一键设置",
                    })}
                  </Button>
                  {!isCopilotPreset && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="h-7 gap-1"
                    >
                      {isFetchingModels ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {t("providerForm.fetchModels")}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("providerForm.modelMappingHint")}
              </p>
            </div>

            <div className="space-y-3">
              <div className="hidden grid-cols-[120px_1fr_minmax(0,1fr)_104px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span>
                  {t("providerForm.modelRoleLabel", {
                    defaultValue: "模型角色",
                  })}
                </span>
                <span>
                  {t("providerForm.modelDisplayNameLabel", {
                    defaultValue: "显示名称",
                  })}
                </span>
                <span>
                  {t("providerForm.requestModelLabel", {
                    defaultValue: "实际请求模型",
                  })}
                </span>
                <span>
                  {t("providerForm.modelOneMHeader", {
                    defaultValue: "声明支持 1M",
                  })}
                </span>
              </div>

              {modelRoleRows.map((row) => {
                const modelBase = stripClaudeOneMMarker(row.model);
                const usesOneM =
                  row.supportsOneM && hasClaudeOneMMarker(row.model);

                return (
                  <div
                    key={row.role}
                    className="grid grid-cols-1 gap-2 md:grid-cols-[120px_1fr_minmax(0,1fr)_104px]"
                  >
                    <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                      {row.label}
                    </div>
                    {row.displayNameField ? (
                      <Input
                        value={row.displayName ?? ""}
                        onChange={(event) =>
                          onModelChange(
                            row.displayNameField!,
                            event.target.value,
                          )
                        }
                        placeholder={
                          modelBase ||
                          t("providerForm.modelDisplayNamePlaceholder", {
                            defaultValue: "例如 DeepSeek V4 Pro",
                          })
                        }
                        autoComplete="off"
                      />
                    ) : (
                      <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                        {t("providerForm.modelNoDisplayName", {
                          defaultValue: "不显示在 /model 菜单",
                        })}
                      </div>
                    )}
                    {renderModelInput(
                      row.inputId,
                      modelBase,
                      row.modelField,
                      t("providerForm.modelPlaceholder", { defaultValue: "" }),
                      (value) =>
                        handleRoleModelChange(
                          row,
                          row.supportsOneM
                            ? setClaudeOneMMarker(value, usesOneM)
                            : stripClaudeOneMMarker(value),
                        ),
                    )}
                    {row.supportsOneM && (
                      <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          checked={usesOneM}
                          onCheckedChange={(checked) =>
                            handleRoleOneMChange(row, checked === true)
                          }
                        />
                        {t("providerForm.modelOneMLabel", {
                          defaultValue: "1M",
                        })}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 border-t border-border-default pt-4">
              <FormLabel htmlFor="claudeModel">
                {t("providerForm.fallbackModelLabel", {
                  defaultValue: "默认兜底模型",
                })}
              </FormLabel>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_minmax(0,104px)]">
                {renderModelInput(
                  "claudeModel",
                  stripClaudeOneMMarker(claudeModel),
                  "ANTHROPIC_MODEL",
                  t("providerForm.modelPlaceholder", { defaultValue: "" }),
                  (value) =>
                    onModelChange(
                      "ANTHROPIC_MODEL",
                      setClaudeOneMMarker(value, fallbackUsesOneM),
                    ),
                )}
                <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={fallbackUsesOneM}
                    onCheckedChange={(checked) => {
                      const base = stripClaudeOneMMarker(claudeModel).trim();
                      if (!base) return;
                      onModelChange(
                        "ANTHROPIC_MODEL",
                        setClaudeOneMMarker(base, checked === true),
                      );
                    }}
                  />
                  {t("providerForm.modelOneMLabel", {
                    defaultValue: "1M",
                  })}
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("providerForm.fallbackModelHint", {
                  defaultValue:
                    "用于未明确落到 Sonnet、Opus、Fable、Haiku 角色的请求。使用第三方/中转端点时建议填写：否则这些请求（含 Haiku 后台子任务）会以原始 Claude 模型名透传给上游，可能因上游无此模型而报错。官方端点可留空。",
                })}
              </p>
            </div>

            <CustomUserAgentField
              id="claude-custom-user-agent"
              value={customUserAgent}
              onChange={onCustomUserAgentChange}
            />

            <div className="border-t border-border-default pt-3">
              <LocalProxyRequestOverridesField
                headersJson={localProxyHeadersOverride}
                bodyJson={localProxyBodyOverride}
                onHeadersJsonChange={onLocalProxyHeadersOverrideChange}
                onBodyJsonChange={onLocalProxyBodyOverrideChange}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
