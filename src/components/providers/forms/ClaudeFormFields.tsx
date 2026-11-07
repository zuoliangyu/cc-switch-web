import type { AuthCenterTarget } from "@/lib/api";
import {
  ClaudeStackModelsField,
  type ClaudeStackModelRow,
} from "./ClaudeStackModelsField";
import { useCallback, useEffect, useState, useRef } from "react";
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
import { HelpTip } from "@/components/ui/help-tip";
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
  DirectModeFormatWarning,
  EndpointField,
  FullUrlToggle,
  type DirectModeFormatNotice,
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
  fetchCodexOauthModels,
  fetchXaiOauthModels,
  modelFetchRequestHeaders,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { CustomUserAgentField } from "./CustomUserAgentField";
import { LocalProxyRequestOverridesField } from "./LocalProxyRequestOverridesField";
import {
  ClaudeReasoningEffortField,
  type ClaudeReasoningEffortChoice,
} from "./ClaudeReasoningEffortField";
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
  /** 聚合布局的模型列表（第一行是这家的默认模型）；没存过列表时是从模型映射生成的行。 */
  stackModelRows?: ClaudeStackModelRow[];
  onStackModelRowsChange?: (rows: ClaudeStackModelRow[]) => void;
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
  /** 打开全屏授权中心并定位到某一组（新增 / 编辑对话框提供；不给就不显示「添加或管理账号」） */
  onManageAuthAccounts?: (target: AuthCenterTarget) => void;

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
  // 转成 OpenAI Chat / Responses 时思考档位的发法
  reasoningEffort: ClaudeReasoningEffortChoice;
  onReasoningEffortChange: (value: ClaudeReasoningEffortChoice) => void;

  // Auth Field (ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY)
  apiKeyField: ClaudeApiKeyField;
  onApiKeyFieldChange: (field: ClaudeApiKeyField) => void;

  // Full URL mode
  isFullUrl: boolean;
  onFullUrlChange: (value: boolean) => void;
  /** 应用实际在直连时传：选了要靠路由转换的格式就在格式下面提示后果（上游 e615a6f4）。 */
  directModeFormatNotice?: DirectModeFormatNotice;
  /**
   * 布局：`classic` 是直连 / 路由用的完整表单；`stack` 是聚合模式的简化面板（连接 +
   * 模型列表 + 高级），不显示模型映射（上游 fe831f0a / 84ca4f00）。
   */
  variant?: "classic" | "stack";

  customUserAgent: string;
  onCustomUserAgentChange: (value: string) => void;
  localProxyHeadersOverride: string;
  onLocalProxyHeadersOverrideChange: (value: string) => void;
  localProxyBodyOverride: string;
  onLocalProxyBodyOverrideChange: (value: string) => void;
}

export function ClaudeFormFields({
  stackModelRows = [],
  onStackModelRowsChange,
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
  onManageAuthAccounts,
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
  reasoningEffort,
  onReasoningEffortChange,
  apiKeyField,
  onApiKeyFieldChange,
  isFullUrl,
  onFullUrlChange,
  directModeFormatNotice,
  variant = "classic",
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
    reasoningEffort !== "auto" ||
    apiKeyField !== "ANTHROPIC_AUTH_TOKEN" ||
    customUserAgent ||
    hasRequestOverrides ||
    isFullUrl
  );
  const [advancedExpanded, setAdvancedExpanded] = useState(
    isXaiOauthPreset ? false : hasAnyAdvancedValue,
  );
  // 聚合布局的高级区只有完整 URL、User-Agent 和请求覆盖，开了或填了才展开。
  const [stackAdvancedExpanded, setStackAdvancedExpanded] = useState(
    isFullUrl || !!customUserAgent || hasRequestOverrides,
  );

  // 预设填充高级值后自动展开（仅从折叠→展开，不会自动折叠）
  useEffect(() => {
    if (isXaiOauthPreset) {
      setAdvancedExpanded(false);
    } else if (hasAnyAdvancedValue) {
      setAdvancedExpanded(true);
    }
  }, [hasAnyAdvancedValue, isXaiOauthPreset]);

  const apiFormatLabel = t("providerForm.apiFormat", {
    defaultValue: "上游格式",
  });
  const authFieldLabel = t("providerForm.authField", {
    defaultValue: "认证字段",
  });
  const fallbackModelLabel = t("providerForm.fallbackModelLabel", {
    defaultValue: "默认兜底模型",
  });
  // 只有第三方端点才认不出原始 Claude 模型名：直连看后台任务用的 Haiku 档，路由看兜底模型本身。
  const usesThirdPartyEndpoint =
    category !== "official" && category !== "cloud_provider";
  const fallbackModelMissing =
    usesThirdPartyEndpoint &&
    !(directModeFormatNotice ? defaultHaikuModel : claudeModel).trim();

  // Copilot 可用模型列表
  const [copilotModels, setCopilotModels] = useState<CopilotModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const modelFetchGeneration = useRef(0);
  // 这次拉取是不是聚合模型列表发起的：那边拉到就打开选择弹窗，弹窗里已经显示了数量。
  const opensPickerRef = useRef(false);
  useEffect(() => {
    modelFetchGeneration.current++;
    setFetchedModels([]);
    setIsFetchingModels(false);
    return () => {
      modelFetchGeneration.current++;
    };
  }, [
    baseUrl,
    apiKey,
    isCodexOauthPreset,
    isXaiOauthPreset,
    selectedCodexAccountId,
    selectedXaiAccountId,
  ]);
  const handleFetchModels = useCallback(() => {
    if (!isCodexOauthPreset && !isXaiOauthPreset && (!baseUrl || !apiKey)) {
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

    const generation = ++modelFetchGeneration.current;
    setIsFetchingModels(true);
    (isCodexOauthPreset
      ? fetchCodexOauthModels(selectedCodexAccountId)
      : isXaiOauthPreset
        ? fetchXaiOauthModels(selectedXaiAccountId)
        : fetchModelsForConfig(
            baseUrl,
            apiKey,
            isFullUrl,
            modelsUrl,
            customUserAgent,
            {
              requestHeaders: modelFetchRequestHeaders(
                localProxyHeadersOverride,
              ),
            },
          )
    )
      .then((models) => {
        if (generation !== modelFetchGeneration.current) return;
        setFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else if (!opensPickerRef.current) {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((error) => {
        if (generation !== modelFetchGeneration.current) return;
        console.warn("[ModelFetch] Failed:", error);
        showFetchModelsError(error, t);
      })
      .finally(() => {
        if (generation === modelFetchGeneration.current)
          setIsFetchingModels(false);
      });
  }, [
    apiKey,
    baseUrl,
    customUserAgent,
    isFullUrl,
    isCodexOauthPreset,
    isXaiOauthPreset,
    localProxyHeadersOverride,
    selectedCodexAccountId,
    selectedXaiAccountId,
    t,
  ]);

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
    },
    {
      role: "opus",
      label: t("providerForm.modelRoleOpus", { defaultValue: "Opus" }),
      model: defaultOpusModel,
      displayName: defaultOpusModelName,
      modelField: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
      inputId: "claudeDefaultOpusModel",
    },
    {
      role: "fable",
      label: t("providerForm.modelRoleFable", { defaultValue: "Fable" }),
      model: defaultFableModel,
      displayName: defaultFableModelName,
      modelField: "ANTHROPIC_DEFAULT_FABLE_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
      inputId: "claudeDefaultFableModel",
    },
    {
      role: "haiku",
      label: t("providerForm.modelRoleHaiku", { defaultValue: "Haiku" }),
      model: defaultHaikuModel,
      displayName: defaultHaikuModelName,
      modelField: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      displayNameField: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      inputId: "claudeDefaultHaikuModel",
    },
    {
      role: "subagent",
      label: t("providerForm.modelRoleSubagent", {
        defaultValue: "Subagent",
      }),
      model: subagentModel,
      modelField: "CLAUDE_CODE_SUBAGENT_MODEL",
      inputId: "claudeCodeSubagentModel",
    },
  ];

  const handleRoleModelChange = (row: ModelRoleRow, value: string) => {
    const oldModelBase = stripClaudeOneMMarker(row.model).trim();
    const nextModelBase = stripClaudeOneMMarker(value).trim();
    const displayName = row.displayName?.trim() ?? "";
    const shouldSyncDisplayName = !displayName || displayName === oldModelBase;
    onModelChange(row.modelField, value);
    if (row.displayNameField && shouldSyncDisplayName) {
      onModelChange(row.displayNameField, nextModelBase);
    }
  };

  const handleRoleOneMChange = (row: ModelRoleRow, enabled: boolean) => {
    handleRoleModelChange(row, setClaudeOneMMarker(row.model, enabled));
  };

  const oauthSections = (
    <>
      {/* GitHub Copilot OAuth 认证 */}
      {isCopilotPreset && (
        <CopilotAuthSection
          mode="select"
          selectedAccountId={selectedGitHubAccountId}
          onAccountSelect={onGitHubAccountSelect}
          onManageAccounts={
            onManageAuthAccounts
              ? () => onManageAuthAccounts("github_copilot")
              : undefined
          }
        />
      )}
      {isCopilotPreset && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("copilot.automaticFormatHint")}
        </p>
      )}

      {isCodexOauthPreset && (
        <CodexOAuthSection
          mode="select"
          selectedAccountId={selectedCodexAccountId}
          onAccountSelect={onCodexAccountSelect}
          onManageAccounts={
            onManageAuthAccounts
              ? () => onManageAuthAccounts("codex_oauth")
              : undefined
          }
        />
      )}

      {isXaiOauthPreset && (
        <XaiOAuthSection
          selectedAccountId={selectedXaiAccountId}
          onAccountSelect={onXaiAccountSelect}
        />
      )}
    </>
  );

  const apiKeySection = (
    <>
      {/* API Key 输入框（非 OAuth 预设时显示） */}
      {shouldShowApiKey && !usesOAuth && (
        <ApiKeySection
          required
          value={apiKey}
          onChange={onApiKeyChange}
          category={category}
          shouldShowLink={shouldShowApiKeyLink}
          websiteUrl={websiteUrl}
          isPartner={isPartner}
          partnerPromotionKey={partnerPromotionKey}
        />
      )}
    </>
  );

  const templateSection = (
    <>
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
    </>
  );

  const endpointSection = (
    <>
      {/* Base URL 输入框 */}
      {shouldShowSpeedTest && (
        <EndpointField
          id="baseUrl"
          label={t("providerForm.apiEndpoint")}
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.apiEndpointPlaceholder")}
          help={
            apiFormat === "openai_responses"
              ? t("providerForm.apiHintResponses")
              : apiFormat === "openai_chat"
                ? t("providerForm.apiHintOAI")
                : apiFormat === "gemini_native"
                  ? t("providerForm.apiHintGeminiNative")
                  : t("providerForm.apiHint")
          }
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}
    </>
  );

  const speedTestModal = (
    <>
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
    </>
  );

  const apiFormatField = (
    <>
      {/* 上游格式选择（仅非云服务商显示） */}
      {category !== "cloud_provider" && !isXaiOauthPreset && (
        <div className="space-y-2">
          <div className="flex items-center gap-0.5">
            <FormLabel htmlFor="apiFormat">{apiFormatLabel}</FormLabel>
            <HelpTip title={apiFormatLabel}>
              {t("providerForm.apiFormatHelp")}
            </HelpTip>
          </div>
          <Select
            value={apiFormat}
            onValueChange={onApiFormatChange}
            disabled={isCopilotPreset}
          >
            <SelectTrigger id="apiFormat" className="w-full">
              <SelectValue>
                {/* Copilot 按模型能力自动选协议（上游 bd50984e） */}
                {isCopilotPreset ? t("copilot.automaticFormat") : undefined}
              </SelectValue>
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
          {directModeFormatNotice &&
            !isCopilotPreset &&
            apiFormat !== "anthropic" && (
              <DirectModeFormatWarning notice={directModeFormatNotice} />
            )}
        </div>
      )}
      {category !== "cloud_provider" &&
        !isXaiOauthPreset &&
        !isCodexOauthPreset &&
        !isCopilotPreset &&
        (apiFormat === "openai_chat" || apiFormat === "openai_responses") && (
          <ClaudeReasoningEffortField
            id="claudeReasoningEffort"
            value={reasoningEffort}
            onChange={onReasoningEffortChange}
          />
        )}
    </>
  );

  const fullUrlToggle = (
    <>
      {/* 完整 URL 跟着地址框：托管账号卡的地址由后端固定，没有这个开关（上游 1e045d2e）。 */}
      {shouldShowSpeedTest && !isCodexOauthPreset && !isXaiOauthPreset && (
        <FullUrlToggle
          checked={isFullUrl}
          onCheckedChange={onFullUrlChange}
          geminiNative={apiFormat === "gemini_native"}
        />
      )}
    </>
  );

  const authFieldSelect = (
    <>
      {/* 认证字段只决定 Anthropic 格式上游的认证头（OpenAI 格式一律 Bearer）；Copilot
                靠它决定占位符写在哪个变量。 */}
      {(apiFormat === "anthropic" || isCopilotPreset) && (
        <div className="space-y-2">
          <div className="flex items-center gap-0.5">
            <FormLabel>{authFieldLabel}</FormLabel>
            <HelpTip title={authFieldLabel}>
              {t("providerForm.authFieldHint")}
            </HelpTip>
          </div>
          <Select
            value={apiKeyField}
            onValueChange={(v) => onApiKeyFieldChange(v as ClaudeApiKeyField)}
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
        </div>
      )}
    </>
  );

  const userAgentAndOverrides = (
    <>
      {/* Copilot 的请求由转发层按 Copilot 客户端的样子发，UA 和请求覆盖都会被跳过 */}
      {!isCopilotPreset && (
        <div className="space-y-4 border-t border-border-default pt-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("codexConfig.routeOnlySettingsHint")}
          </p>
          <CustomUserAgentField
            id="claude-custom-user-agent"
            value={customUserAgent}
            onChange={onCustomUserAgentChange}
            help={t("providerForm.customUserAgentHelp")}
          />
          <div className="border-t border-border-default pt-3">
            <LocalProxyRequestOverridesField
              headersJson={localProxyHeadersOverride}
              bodyJson={localProxyBodyOverride}
              onHeadersJsonChange={onLocalProxyHeadersOverrideChange}
              onBodyJsonChange={onLocalProxyBodyOverrideChange}
              help={t("providerForm.localProxyRequestOverridesHelp")}
            />
          </div>
        </div>
      )}
    </>
  );

  // 批量勾选模型用当前预设对应的那份上游列表（Copilot 的列表随登录账号自动加载）。
  const stackFetchedModels = isCopilotPreset
    ? copilotModels.map((model) => ({ id: model.id, ownedBy: null }))
    : fetchedModels;
  const aggregationModelsField = onStackModelRowsChange && (
    <ClaudeStackModelsField
      rows={stackModelRows}
      onRowsChange={onStackModelRowsChange}
      fetchedModels={stackFetchedModels}
      onFetchModels={() => {
        if (isCopilotPreset) return;
        opensPickerRef.current = true;
        handleFetchModels();
      }}
      isFetchingModels={isFetchingModels || modelsLoading}
      baseUrl={baseUrl}
    />
  );

  if (variant === "stack") {
    // 认证字段只对 Anthropic 格式、自己填 Key 的供应商有意义，放在 Key 旁边。
    const showAuthField =
      shouldShowApiKey &&
      !usesOAuth &&
      !isCodexOauthPreset &&
      !isXaiOauthPreset &&
      apiFormat === "anthropic";
    return (
      <>
        {oauthSections}
        {apiFormatField}
        {apiKeySection}
        {showAuthField && authFieldSelect}
        {templateSection}
        {endpointSection}
        {speedTestModal}
        {aggregationModelsField}
        {/* 高级区只有完整 URL、UA 和请求覆盖；Copilot 的转发会跳过后两项，整块不显示 */}
        {!isCopilotPreset && (
          <Collapsible
            open={stackAdvancedExpanded}
            onOpenChange={setStackAdvancedExpanded}
            className="rounded-lg border border-border-default p-4"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant={null}
                size="sm"
                className="h-8 w-full justify-start gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
              >
                {stackAdvancedExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {t("providerForm.advancedOptionsToggle")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              {fullUrlToggle}
              {userAgentAndOverrides}
            </CollapsibleContent>
          </Collapsible>
        )}
      </>
    );
  }

  return (
    <>
      {oauthSections}
      {apiKeySection}
      {templateSection}
      {endpointSection}
      {speedTestModal}
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
          <CollapsibleContent className="space-y-4 pt-2">
            {apiFormatField}
            {fullUrlToggle}
            {authFieldSelect}
            {/* 模型映射 */}
            <div className="space-y-1 border-t border-border-default pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  <FormLabel>{t("providerForm.modelMappingLabel")}</FormLabel>
                  <HelpTip title={t("providerForm.modelMappingLabel")}>
                    {t("providerForm.modelMappingHint")}
                  </HelpTip>
                </div>
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
                          onModelChange(row.modelField, value);
                          if (row.displayNameField) {
                            onModelChange(
                              row.displayNameField,
                              stripClaudeOneMMarker(value),
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
                      onClick={() => {
                        opensPickerRef.current = false;
                        handleFetchModels();
                      }}
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
                const usesOneM = hasClaudeOneMMarker(row.model);

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
                          setClaudeOneMMarker(value, usesOneM),
                        ),
                    )}
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
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 border-t border-border-default pt-4">
              <div className="flex items-center gap-0.5">
                <FormLabel htmlFor="claudeModel">
                  {fallbackModelLabel}
                </FormLabel>
                {/* 直连时它是 Claude Code 的主模型；经过路由时才是各档留空、没匹配到档位的回落。 */}
                <HelpTip title={fallbackModelLabel}>
                  {directModeFormatNotice
                    ? t("providerForm.fallbackModelHelpDirect")
                    : t("providerForm.fallbackModelHelp")}
                </HelpTip>
              </div>
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
              {fallbackModelMissing && (
                <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                  {directModeFormatNotice
                    ? t("providerForm.fallbackModelHaikuMissing")
                    : t("providerForm.fallbackModelMissing")}
                </p>
              )}
            </div>
            {userAgentAndOverrides}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
