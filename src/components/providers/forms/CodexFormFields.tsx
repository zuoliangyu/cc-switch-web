import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import EndpointSpeedTest from "./EndpointSpeedTest";
import {
  ApiKeySection,
  EndpointField,
  ModelInputWithFetch,
  ModelDropdown,
} from "./shared";
import { useCommittableRef } from "@/hooks/useLatestRef";
import { useModelMetadataFill } from "@/hooks/useModelMetadataFill";
import { codexPresetModelSources } from "@/config/presetModelMetadata";
import {
  fillCodexCatalogModel,
  metadataFilledAnything,
} from "./modelMetadataFill";
import { normalizeEnabledCodexChatEffortParam } from "./helpers/codexChatReasoning";
import { XaiOAuthSection } from "./XaiOAuthSection";
import { CopilotAuthSection } from "./CopilotAuthSection";
import {
  copilotGetModels,
  copilotGetModelsForAccount,
  type CopilotModel,
} from "@/lib/api/copilot";
import {
  fetchModelsForConfig,
  fetchXaiOauthModels,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { CustomUserAgentField } from "./CustomUserAgentField";
import { LocalProxyRequestOverridesField } from "./LocalProxyRequestOverridesField";
import type {
  CodexApiFormat,
  CodexCopilotApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  PromptCacheRoutingMode,
  ProviderCategory,
} from "@/types";

interface EndpointCandidate {
  url: string;
}

export function isCopilotModelSupportedByCodex(
  model: CopilotModel,
  format: CodexCopilotApiFormat = "auto",
): boolean {
  const endpoints =
    format === "openai_responses"
      ? ["/responses", "/v1/responses"]
      : format === "openai_chat"
        ? ["/chat/completions", "/v1/chat/completions"]
        : [
            "/responses",
            "/v1/responses",
            "/chat/completions",
            "/v1/chat/completions",
          ];
  return (model.supported_endpoints ?? []).some((endpoint) =>
    endpoints.includes(
      endpoint.split("?")[0].replace(/\/+$/, "").toLowerCase(),
    ),
  );
}

export function resolveCopilotReportedPromptLimit(
  current: CodexCatalogModel["contextWindow"],
  reported: number | undefined,
): CodexCatalogModel["contextWindow"] {
  return reported ?? current;
}

interface CodexFormFieldsProps {
  appId?: "codex" | "grokbuild";
  providerId?: string;
  // GitHub Copilot 托管账号预设：隐藏 API Key / 端点输入，挂账号选择区块
  isCopilotPreset?: boolean;
  isCopilotAuthenticated?: boolean;
  selectedGitHubAccountId?: string | null;
  onGitHubAccountSelect?: (accountId: string | null) => void;
  isXaiOauthPreset?: boolean;
  isXaiOauthAuthenticated?: boolean;
  selectedXaiAccountId?: string | null;
  onXaiAccountSelect?: (accountId: string | null) => void;
  // API Key
  codexApiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // Base URL
  shouldShowSpeedTest: boolean;
  codexBaseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isFullUrl: boolean;
  onFullUrlChange: (value: boolean) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;

  // Grok Build 的高级路由选项；Codex 模型目录使用独立开关。
  takeoverEnabled?: boolean;
  onTakeoverEnabledChange?: (enabled: boolean) => void;
  catalogEnabled?: boolean;
  onCatalogEnabledChange?: (enabled: boolean) => void;

  // API Format（跟随上游 cc-switch 1c82b8a3）
  apiFormat: CodexApiFormat;
  onApiFormatChange: (format: CodexApiFormat) => void;
  // Copilot：自动按模型选 Responses / Chat，或显式指定协议
  copilotApiFormat?: CodexCopilotApiFormat;
  onCopilotApiFormatChange?: (format: CodexCopilotApiFormat) => void;

  // Model Name
  shouldShowModelField?: boolean;
  modelName?: string;
  onModelNameChange?: (model: string) => void;

  codexChatReasoning?: CodexChatReasoning;
  onCodexChatReasoningChange?: (value: CodexChatReasoning) => void;
  promptCacheRouting: PromptCacheRoutingMode;
  onPromptCacheRoutingChange: (value: PromptCacheRoutingMode) => void;
  catalogModels?: CodexCatalogModel[];
  onCatalogModelsChange?: (models: CodexCatalogModel[]) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];

  customUserAgent: string;
  onCustomUserAgentChange: (value: string) => void;
  localProxyHeadersOverride: string;
  onLocalProxyHeadersOverrideChange: (value: string) => void;
  localProxyBodyOverride: string;
  onLocalProxyBodyOverrideChange: (value: string) => void;
}

type CodexCatalogRow = CodexCatalogModel & { rowId: string };

function createCatalogRow(seed?: Partial<CodexCatalogModel>): CodexCatalogRow {
  return {
    rowId: crypto.randomUUID(),
    model: seed?.model ?? "",
    displayName: seed?.displayName ?? "",
    contextWindow: seed?.contextWindow ?? "",
    ...(seed?.supportsParallelToolCalls !== undefined
      ? { supportsParallelToolCalls: seed.supportsParallelToolCalls }
      : {}),
    ...(seed?.inputModalities ? { inputModalities: seed.inputModalities } : {}),
    ...(seed?.baseInstructions
      ? { baseInstructions: seed.baseInstructions }
      : {}),
    ...(seed?.reasoningLevels ? { reasoningLevels: seed.reasoningLevels } : {}),
    ...(seed?.defaultReasoningLevel
      ? { defaultReasoningLevel: seed.defaultReasoningLevel }
      : {}),
  };
}

function catalogRowsMatchModels(
  rows: CodexCatalogModel[],
  models: CodexCatalogModel[],
): boolean {
  if (rows.length !== models.length) return false;
  return rows.every((row, index) => {
    const model = models[index];
    return (
      row.model === (model.model ?? "") &&
      (row.displayName ?? "") === (model.displayName ?? "") &&
      String(row.contextWindow ?? "") === String(model.contextWindow ?? "") &&
      (row.supportsParallelToolCalls ?? null) ===
        (model.supportsParallelToolCalls ?? null) &&
      (row.baseInstructions ?? "") === (model.baseInstructions ?? "") &&
      JSON.stringify(row.inputModalities ?? []) ===
        JSON.stringify(model.inputModalities ?? []) &&
      JSON.stringify(row.reasoningLevels ?? []) ===
        JSON.stringify(model.reasoningLevels ?? []) &&
      (row.defaultReasoningLevel ?? "") === (model.defaultReasoningLevel ?? "")
    );
  });
}

export function CodexFormFields({
  appId = "codex",
  providerId,
  isCopilotPreset,
  isCopilotAuthenticated,
  selectedGitHubAccountId,
  onGitHubAccountSelect,
  isXaiOauthPreset,
  isXaiOauthAuthenticated,
  selectedXaiAccountId,
  onXaiAccountSelect,
  codexApiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  isPartner,
  partnerPromotionKey,
  shouldShowSpeedTest,
  codexBaseUrl,
  onBaseUrlChange,
  isFullUrl,
  onFullUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  autoSelect,
  onAutoSelectChange,
  takeoverEnabled = false,
  onTakeoverEnabledChange,
  catalogEnabled = false,
  onCatalogEnabledChange,
  apiFormat,
  onApiFormatChange,
  copilotApiFormat = "auto",
  onCopilotApiFormatChange,
  shouldShowModelField = true,
  modelName = "",
  onModelNameChange,
  codexChatReasoning = {},
  onCodexChatReasoningChange,
  promptCacheRouting,
  onPromptCacheRoutingChange,
  catalogModels = [],
  onCatalogModelsChange,
  speedTestEndpoints,
  customUserAgent,
  onCustomUserAgentChange,
  localProxyHeadersOverride,
  onLocalProxyHeadersOverrideChange,
  localProxyBodyOverride,
  onLocalProxyBodyOverrideChange,
}: CodexFormFieldsProps) {
  const { t } = useTranslation();
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const fetchModelsSeqRef = useRef(0);
  const [catalogRows, setCatalogRows] = useState<CodexCatalogRow[]>(() =>
    catalogModels.map((model) => createCatalogRow(model)),
  );
  const lastSentModelsRef = useRef<CodexCatalogModel[]>(catalogModels);
  // Copilot 自动模式按 Chat 的能力选项展示（Responses 原生模型也兼容这些选项）
  const effectiveApiFormat = isCopilotPreset
    ? copilotApiFormat === "auto"
      ? "openai_chat"
      : copilotApiFormat
    : apiFormat;
  const isChatFormat = effectiveApiFormat === "openai_chat";
  const isGrokBuild = appId === "grokbuild";
  const canEditCatalog = Boolean(onCatalogModelsChange);
  const showChatOptions =
    shouldShowModelField && isChatFormat && (!isGrokBuild || takeoverEnabled);
  const optionsEnabled = isGrokBuild ? takeoverEnabled : catalogEnabled;
  const optionsToggleLabel = isGrokBuild
    ? "codexConfig.localRoutingToggle"
    : "codexConfig.catalogToggle";
  const optionsToggleHint = isGrokBuild
    ? takeoverEnabled
      ? "codexConfig.localRoutingOnHint"
      : "codexConfig.localRoutingOffHint"
    : catalogEnabled
      ? "codexConfig.catalogOnHint"
      : "codexConfig.catalogOffHint";
  const hasRequestOverrides = Boolean(
    localProxyHeadersOverride.trim() || localProxyBodyOverride.trim(),
  );
  const hasAnyAdvancedValue =
    !!isCopilotPreset ||
    !!customUserAgent ||
    hasRequestOverrides ||
    optionsEnabled ||
    (!isGrokBuild && isChatFormat);
  const [advancedExpanded, setAdvancedExpanded] = useState(hasAnyAdvancedValue);

  useEffect(() => {
    if (hasAnyAdvancedValue) setAdvancedExpanded(true);
  }, [hasAnyAdvancedValue]);

  useEffect(() => {
    fetchModelsSeqRef.current += 1;
    setFetchedModels((current) => (current.length === 0 ? current : []));
  }, [
    codexBaseUrl,
    isFullUrl,
    codexApiKey,
    customUserAgent,
    isCopilotPreset,
    copilotApiFormat,
    isCopilotAuthenticated,
    selectedGitHubAccountId,
    isXaiOauthPreset,
    isXaiOauthAuthenticated,
    selectedXaiAccountId,
  ]);

  useEffect(() => {
    setCatalogRows((current) =>
      catalogRowsMatchModels(current, catalogModels)
        ? current
        : catalogModels.map((model) => createCatalogRow(model)),
    );
    lastSentModelsRef.current = catalogModels;
  }, [catalogModels]);

  useEffect(() => {
    if (!onCatalogModelsChange) return;
    const next = catalogRows.map(({ rowId: _rowId, ...model }) => model);
    if (catalogRowsMatchModels(catalogRows, lastSentModelsRef.current)) return;
    lastSentModelsRef.current = next;
    onCatalogModelsChange(next);
  }, [catalogRows, onCatalogModelsChange]);

  const modelSuggestions = useMemo<FetchedModel[]>(() => {
    const seen = new Set<string>();
    const suggestions: FetchedModel[] = [];
    for (const row of catalogRows) {
      const id = row.model.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      suggestions.push({ id, ownedBy: t("codexConfig.modelMappingTitle") });
    }
    for (const model of fetchedModels) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      suggestions.push(model);
    }
    return suggestions;
  }, [catalogRows, fetchedModels, t]);

  const trimmedModelName = modelName.trim();
  const isModelOutsideCatalog =
    catalogRows.length > 0 &&
    !!trimmedModelName &&
    !catalogRows.some((row) => row.model.trim() === trimmedModelName);

  const fillModelMetadata = useModelMetadataFill({
    baseUrl: codexBaseUrl,
    presets: codexPresetModelSources,
    prefetch: fetchedModels.length > 0,
  });
  const [catalogRowsRef, commitCatalogRows] = useCommittableRef(
    catalogRows,
    setCatalogRows,
  );
  const fillCatalogRowMetadata = useCallback(
    (rowId: string, modelId: string) => {
      fillModelMetadata(modelId, (metadata) => {
        const rows = catalogRowsRef.current;
        const current = rows.find((row) => row.rowId === rowId);
        if (current?.model.trim() !== modelId) return false;
        const filled = fillCodexCatalogModel(current, metadata, [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ]);
        if (!metadataFilledAnything(current, filled)) return false;
        commitCatalogRows(
          rows.map((row) => (row.rowId === rowId ? filled : row)),
        );
        return true;
      });
    },
    [catalogRowsRef, commitCatalogRows, fillModelMetadata],
  );

  const selectFetchedCatalogModel = (rowId: string, modelId: string) => {
    commitCatalogRows(
      catalogRowsRef.current.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              model: modelId,
              displayName: row.displayName?.trim() ? row.displayName : modelId,
            }
          : row,
      ),
    );
    fillCatalogRowMetadata(rowId, modelId);
  };

  const handleAddModelToCatalog = useCallback(() => {
    if (!onCatalogModelsChange || !trimmedModelName) return;
    const row = createCatalogRow({
      model: trimmedModelName,
      displayName: trimmedModelName,
    });
    commitCatalogRows([...catalogRowsRef.current, row]);
    fillCatalogRowMetadata(row.rowId, trimmedModelName);
  }, [
    catalogRowsRef,
    commitCatalogRows,
    fillCatalogRowMetadata,
    onCatalogModelsChange,
    trimmedModelName,
  ]);

  const supportsThinking =
    codexChatReasoning.supportsThinking === true ||
    codexChatReasoning.supportsEffort === true;
  const supportsEffort = codexChatReasoning.supportsEffort === true;

  const handleReasoningThinkingChange = useCallback(
    (checked: boolean) => {
      onCodexChatReasoningChange?.({
        ...codexChatReasoning,
        supportsThinking: checked,
        supportsEffort: checked ? codexChatReasoning.supportsEffort : false,
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleReasoningEffortChange = useCallback(
    (checked: boolean) => {
      onCodexChatReasoningChange?.({
        ...codexChatReasoning,
        supportsThinking: checked ? true : codexChatReasoning.supportsThinking,
        supportsEffort: checked,
        effortParam: checked
          ? normalizeEnabledCodexChatEffortParam(codexChatReasoning.effortParam)
          : "none",
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleFetchModels = useCallback(() => {
    // GitHub Copilot 托管账号：按账号的 /models 拉取，只留 Codex 能走的协议（Responses / Chat），
    // 并把账号实际的上下文窗口、并行工具调用和推理档位填进模型目录
    if (isCopilotPreset) {
      if (!isCopilotAuthenticated) {
        toast.error(
          t("copilot.loginRequired", {
            defaultValue: "请先登录 GitHub Copilot",
          }),
        );
        return;
      }
      const seq = ++fetchModelsSeqRef.current;
      setIsFetchingModels(true);
      (selectedGitHubAccountId
        ? copilotGetModelsForAccount(selectedGitHubAccountId)
        : copilotGetModels()
      )
        .then((models) => {
          if (seq !== fetchModelsSeqRef.current) return;
          const usableModels = models.filter((model) =>
            isCopilotModelSupportedByCodex(model, copilotApiFormat),
          );
          setFetchedModels(
            usableModels.map((model) => ({
              id: model.id,
              ownedBy: model.vendor || null,
            })),
          );
          if (onCatalogModelsChange) {
            const existing = new Map(
              catalogModels.map((model) => [model.model, model]),
            );
            onCatalogModelsChange(
              usableModels.map((model) => ({
                ...(existing.get(model.id) ?? {}),
                model: model.id,
                displayName: model.name || model.id,
                contextWindow: resolveCopilotReportedPromptLimit(
                  existing.get(model.id)?.contextWindow,
                  model.context_window,
                ),
                supportsParallelToolCalls:
                  model.supports_parallel_tool_calls ??
                  existing.get(model.id)?.supportsParallelToolCalls ??
                  false,
                inputModalities: existing.get(model.id)?.inputModalities ?? [
                  "text",
                ],
                ...(model.reasoning_effort !== undefined
                  ? { reasoningLevels: model.reasoning_effort }
                  : {}),
              })),
            );
          }
          if (
            usableModels.length > 0 &&
            onModelNameChange &&
            !usableModels.some((model) => model.id === modelName)
          ) {
            const defaultModel =
              usableModels.find((model) =>
                model.id.toLowerCase().startsWith("gpt-"),
              ) ?? usableModels[0];
            onModelNameChange(defaultModel.id);
          }
          toast[usableModels.length === 0 ? "info" : "success"](
            t(
              usableModels.length === 0
                ? "providerForm.fetchModelsEmpty"
                : "providerForm.fetchModelsSuccess",
              { count: usableModels.length },
            ),
          );
        })
        .catch((error) => {
          if (seq !== fetchModelsSeqRef.current) return;
          console.warn("[Copilot] Failed to fetch models:", error);
          showFetchModelsError(error, t);
        })
        .finally(() => {
          if (seq === fetchModelsSeqRef.current) setIsFetchingModels(false);
        });
      return;
    }

    if (isXaiOauthPreset) {
      if (!isXaiOauthAuthenticated) {
        toast.error(t("xaiOauth.loginRequired"));
        return;
      }
      const seq = ++fetchModelsSeqRef.current;
      setIsFetchingModels(true);
      fetchXaiOauthModels(selectedXaiAccountId)
        .then((models) => {
          if (seq !== fetchModelsSeqRef.current) return;
          setFetchedModels(models);
          toast[models.length === 0 ? "info" : "success"](
            t(
              models.length === 0
                ? "providerForm.fetchModelsEmpty"
                : "providerForm.fetchModelsSuccess",
              { count: models.length },
            ),
          );
        })
        .catch((error) => {
          if (seq !== fetchModelsSeqRef.current) return;
          console.warn("[XaiOAuth] Failed to fetch models:", error);
          showFetchModelsError(error, t);
        })
        .finally(() => {
          if (seq === fetchModelsSeqRef.current) setIsFetchingModels(false);
        });
      return;
    }

    if (!codexBaseUrl || !codexApiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!codexApiKey,
        hasBaseUrl: !!codexBaseUrl,
      });
      return;
    }

    const seq = ++fetchModelsSeqRef.current;
    setIsFetchingModels(true);
    fetchModelsForConfig(
      codexBaseUrl,
      codexApiKey,
      isFullUrl,
      undefined,
      customUserAgent,
    )
      .then((models) => {
        if (seq !== fetchModelsSeqRef.current) return;
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
        if (seq !== fetchModelsSeqRef.current) return;
        console.warn("[ModelFetch] Failed:", error);
        showFetchModelsError(error, t);
      })
      .finally(() => {
        if (seq === fetchModelsSeqRef.current) setIsFetchingModels(false);
      });
  }, [
    catalogModels,
    codexApiKey,
    codexBaseUrl,
    copilotApiFormat,
    customUserAgent,
    isCopilotAuthenticated,
    isCopilotPreset,
    isFullUrl,
    isXaiOauthAuthenticated,
    isXaiOauthPreset,
    modelName,
    onCatalogModelsChange,
    onModelNameChange,
    selectedGitHubAccountId,
    selectedXaiAccountId,
    t,
  ]);

  return (
    <>
      {isCopilotPreset && (
        <CopilotAuthSection
          mode="select"
          selectedAccountId={selectedGitHubAccountId}
          onAccountSelect={onGitHubAccountSelect}
        />
      )}

      {isXaiOauthPreset && (
        <XaiOAuthSection
          selectedAccountId={selectedXaiAccountId}
          onAccountSelect={onXaiAccountSelect}
        />
      )}

      {/* Codex API Key 输入框（托管账号预设无需 Key） */}
      {!isCopilotPreset && !isXaiOauthPreset && (
        <ApiKeySection
          required
          id="codexApiKey"
          label="API Key"
          value={codexApiKey}
          onChange={onApiKeyChange}
          category={category}
          shouldShowLink={shouldShowApiKeyLink}
          websiteUrl={websiteUrl}
          isPartner={isPartner}
          partnerPromotionKey={partnerPromotionKey}
          placeholder={{
            official: t("providerForm.codexOfficialNoApiKey", {
              defaultValue: "官方供应商无需 API Key",
            }),
            thirdParty: t("providerForm.codexApiKeyAutoFill", {
              defaultValue: "输入 API Key，将自动填充到配置",
            }),
          }}
        />
      )}

      {/* Codex Base URL 输入框（托管账号端点由 adapter 硬定向，不展示） */}
      {shouldShowSpeedTest && !isCopilotPreset && !isXaiOauthPreset && (
        <EndpointField
          id="codexBaseUrl"
          label={t("codexConfig.apiUrlLabel")}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.codexApiEndpointPlaceholder")}
          hint={t("providerForm.codexApiHint")}
          showFullUrlToggle
          isFullUrl={isFullUrl}
          onFullUrlChange={onFullUrlChange}
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}

      {/* Codex Model Name 输入框 */}
      {shouldShowModelField && onModelNameChange && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="codexModelName"
              className="block text-sm font-medium text-foreground"
            >
              {t("codexConfig.defaultModelLabel")}
            </label>
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
          </div>
          <ModelInputWithFetch
            id="codexModelName"
            value={modelName}
            onChange={onModelNameChange}
            placeholder={t(
              isGrokBuild
                ? "grokBuild.defaultModelPlaceholder"
                : "codexConfig.defaultModelPlaceholder",
            )}
            fetchedModels={modelSuggestions}
            isLoading={isFetchingModels}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              isGrokBuild
                ? "grokBuild.defaultModelHint"
                : "codexConfig.defaultModelHint",
            )}
          </p>
          {isModelOutsideCatalog && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs leading-relaxed text-muted-foreground">
              {t("codexConfig.defaultModelNotInCatalog")}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={handleAddModelToCatalog}
              >
                {t("codexConfig.addToModelMapping")}
              </Button>
            </p>
          )}
        </div>
      )}

      {category !== "official" && (
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
            <p className="mt-1 ml-1 text-xs text-muted-foreground">
              {t(
                isGrokBuild
                  ? "grokBuild.advancedSectionHint"
                  : "codexConfig.advancedSectionHint",
              )}
            </p>
          )}
          <CollapsibleContent className="space-y-3 pt-3">
            {/* Copilot 支持按模型能力自动选协议或显式指定；其余供应商沿用原有格式选择 */}
            {(shouldShowSpeedTest || isCopilotPreset) && !isXaiOauthPreset && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <FormLabel htmlFor="codexApiFormat">
                    {t("codexConfig.upstreamFormatLabel")}
                  </FormLabel>
                  <Select
                    value={isCopilotPreset ? copilotApiFormat : apiFormat}
                    onValueChange={(value) => {
                      if (isCopilotPreset) {
                        if (
                          value === "auto" ||
                          value === "openai_chat" ||
                          value === "openai_responses"
                        ) {
                          onCopilotApiFormatChange?.(value);
                        }
                      } else {
                        onApiFormatChange(value as CodexApiFormat);
                      }
                    }}
                  >
                    <SelectTrigger id="codexApiFormat" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isCopilotPreset && (
                        <SelectItem value="auto">
                          {t("codexConfig.upstreamFormatAuto")}
                        </SelectItem>
                      )}
                      <SelectItem value="openai_chat">
                        {t("codexConfig.upstreamFormatChat")}
                      </SelectItem>
                      <SelectItem value="openai_responses">
                        {isCopilotPreset
                          ? t("codexConfig.upstreamFormatCopilotResponses")
                          : t("codexConfig.upstreamFormatResponses")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {isCopilotPreset
                      ? t("codexConfig.upstreamFormatCopilotHint")
                      : t("codexConfig.upstreamFormatHint")}
                  </p>
                </div>

                {(isGrokBuild || canEditCatalog) && (
                  <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                    <div className="space-y-1">
                      <FormLabel>{t(optionsToggleLabel)}</FormLabel>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t(optionsToggleHint)}
                      </p>
                    </div>
                    <Switch
                      checked={optionsEnabled}
                      onCheckedChange={
                        isGrokBuild
                          ? onTakeoverEnabledChange
                          : onCatalogEnabledChange
                      }
                      aria-label={t(optionsToggleLabel)}
                    />
                  </div>
                )}
              </div>
            )}

            {showChatOptions && (
              <div className="space-y-4 border-t border-border-default pt-3">
                <div className="space-y-2">
                  <FormLabel>
                    {t("codexConfig.promptCacheRoutingLabel")}
                  </FormLabel>
                  <Select
                    value={promptCacheRouting}
                    onValueChange={(value) =>
                      onPromptCacheRoutingChange(
                        value as PromptCacheRoutingMode,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t("codexConfig.promptCacheRoutingAuto")}
                      </SelectItem>
                      <SelectItem value="enabled">
                        {t("codexConfig.promptCacheRoutingEnabled")}
                      </SelectItem>
                      <SelectItem value="disabled">
                        {t("codexConfig.promptCacheRoutingDisabled")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("codexConfig.promptCacheRoutingHint")}
                  </p>
                </div>

                <div className="space-y-1 border-t border-border-default pt-3">
                  <FormLabel>{t("codexConfig.reasoningGroupTitle")}</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    {t("codexConfig.reasoningSectionHint")}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("codexConfig.reasoningModeToggle")}
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      {t("codexConfig.reasoningModeHint")}
                    </p>
                  </div>
                  <Switch
                    checked={supportsThinking}
                    onCheckedChange={handleReasoningThinkingChange}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("codexConfig.reasoningEffortToggle")}
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        isGrokBuild
                          ? "grokBuild.reasoningEffortHint"
                          : "codexConfig.reasoningEffortHint",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={supportsEffort}
                    onCheckedChange={handleReasoningEffortChange}
                  />
                </div>
              </div>
            )}

            {catalogEnabled && shouldShowModelField && canEditCatalog && (
              <div className="space-y-3 border-t border-border-default pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <FormLabel>{t("codexConfig.modelMappingTitle")}</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      {t("codexConfig.modelMappingHint")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCatalogRows((current) => [
                        ...current,
                        createCatalogRow(),
                      ])
                    }
                    className="h-7 shrink-0 gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("codexConfig.addCatalogModel")}
                  </Button>
                </div>

                {catalogRows.map((row, index) => (
                  <div
                    key={row.rowId}
                    className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_140px_36px]"
                  >
                    <Input
                      value={row.displayName ?? ""}
                      onChange={(event) =>
                        setCatalogRows((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, displayName: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder={t(
                        "codexConfig.catalogDisplayNamePlaceholder",
                      )}
                      aria-label={t("codexConfig.catalogColumnDisplay")}
                    />
                    <div className="flex gap-1">
                      <Input
                        value={row.model}
                        onChange={(event) =>
                          setCatalogRows((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, model: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder={t("codexConfig.catalogModelPlaceholder")}
                        aria-label={t("codexConfig.catalogColumnModel")}
                      />
                      {fetchedModels.length > 0 && (
                        <ModelDropdown
                          models={fetchedModels}
                          onSelect={(id) =>
                            selectFetchedCatalogModel(row.rowId, id)
                          }
                        />
                      )}
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={row.contextWindow ?? ""}
                      onChange={(event) =>
                        setCatalogRows((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  contextWindow: event.target.value.replace(
                                    /[^\d]/g,
                                    "",
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      placeholder={t("codexConfig.contextWindowPlaceholder")}
                      aria-label={t("codexConfig.catalogColumnContext")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setCatalogRows((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      title={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={
                shouldShowSpeedTest || optionsEnabled
                  ? "space-y-3 border-t border-border-default pt-3"
                  : "space-y-3"
              }
            >
              <CustomUserAgentField
                id="codex-custom-user-agent"
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
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* 端点测速弹窗 - Codex */}
      {shouldShowSpeedTest && !isXaiOauthPreset && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="codex"
          providerId={providerId}
          value={codexBaseUrl}
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
}
