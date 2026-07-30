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
import { toast } from "sonner";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import EndpointSpeedTest from "./EndpointSpeedTest";
import { ApiKeySection, EndpointField, ModelInputWithFetch } from "./shared";
import { XaiOAuthSection } from "./XaiOAuthSection";
import {
  fetchModelsForConfig,
  fetchXaiOauthModels,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { CustomUserAgentField } from "./CustomUserAgentField";
import type {
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  PromptCacheRoutingMode,
  ProviderCategory,
} from "@/types";

interface EndpointCandidate {
  url: string;
}

interface CodexFormFieldsProps {
  providerId?: string;
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

  // API Format（跟随上游 cc-switch 1c82b8a3）
  apiFormat: CodexApiFormat;
  onApiFormatChange: (format: CodexApiFormat) => void;

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
        JSON.stringify(model.inputModalities ?? [])
    );
  });
}

export function CodexFormFields({
  providerId,
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
  apiFormat,
  onApiFormatChange,
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
}: CodexFormFieldsProps) {
  const { t } = useTranslation();
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const fetchModelsSeqRef = useRef(0);
  const [catalogRows, setCatalogRows] = useState<CodexCatalogRow[]>(() =>
    catalogModels.map((model) => createCatalogRow(model)),
  );
  const lastSentModelsRef = useRef<CodexCatalogModel[]>(catalogModels);

  useEffect(() => {
    fetchModelsSeqRef.current += 1;
    setFetchedModels((current) => (current.length === 0 ? current : []));
  }, [
    codexBaseUrl,
    isFullUrl,
    codexApiKey,
    customUserAgent,
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

  const handleAddModelToCatalog = useCallback(() => {
    if (!onCatalogModelsChange || !trimmedModelName) return;
    setCatalogRows((current) => [
      ...current,
      createCatalogRow({
        model: trimmedModelName,
        displayName: trimmedModelName,
      }),
    ]);
  }, [onCatalogModelsChange, trimmedModelName]);

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
          ? (codexChatReasoning.effortParam ?? "reasoning_effort")
          : "none",
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleFetchModels = useCallback(() => {
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
    codexApiKey,
    codexBaseUrl,
    customUserAgent,
    isFullUrl,
    isXaiOauthAuthenticated,
    isXaiOauthPreset,
    selectedXaiAccountId,
    t,
  ]);

  return (
    <>
      {isXaiOauthPreset && (
        <XaiOAuthSection
          selectedAccountId={selectedXaiAccountId}
          onAccountSelect={onXaiAccountSelect}
        />
      )}

      {/* Codex API Key 输入框 */}
      {!isXaiOauthPreset && (
        <ApiKeySection
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

      {/* Codex Base URL 输入框 */}
      {shouldShowSpeedTest && !isXaiOauthPreset && (
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

      {/* Codex API 格式选择（跟随上游 cc-switch 1c82b8a3） */}
      {shouldShowSpeedTest && !isXaiOauthPreset && (
        <div className="space-y-2">
          <FormLabel htmlFor="codexApiFormat">
            {t("providerForm.apiFormat", { defaultValue: "API 格式" })}
          </FormLabel>
          <Select
            value={apiFormat}
            onValueChange={(value) =>
              onApiFormatChange(value as CodexApiFormat)
            }
          >
            <SelectTrigger id="codexApiFormat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai_responses">
                {t("providerForm.codexApiFormatResponses", {
                  defaultValue: "OpenAI Responses API (原生)",
                })}
              </SelectItem>
              <SelectItem value="openai_chat">
                {t("providerForm.codexApiFormatOpenAIChat", {
                  defaultValue: "OpenAI Chat Completions (需开启路由)",
                })}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("providerForm.codexApiFormatHint", {
              defaultValue:
                "选择供应商真实支持的 Codex API 格式；Chat Completions 会通过本地路由自动转换为 Responses。",
            })}
          </p>
        </div>
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
            placeholder={t("codexConfig.defaultModelPlaceholder")}
            fetchedModels={modelSuggestions}
            isLoading={isFetchingModels}
          />
          <p className="text-xs text-muted-foreground">
            {t("codexConfig.defaultModelHint")}
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

      {shouldShowModelField && apiFormat === "openai_chat" && (
        <div className="space-y-4 rounded-lg border border-border-default p-4">
          <div className="space-y-2">
            <FormLabel>{t("codexConfig.promptCacheRoutingLabel")}</FormLabel>
            <Select
              value={promptCacheRouting}
              onValueChange={(value) =>
                onPromptCacheRoutingChange(value as PromptCacheRoutingMode)
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
              <FormLabel>{t("codexConfig.reasoningModeToggle")}</FormLabel>
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
              <FormLabel>{t("codexConfig.reasoningEffortToggle")}</FormLabel>
              <p className="text-xs text-muted-foreground">
                {t("codexConfig.reasoningEffortHint")}
              </p>
            </div>
            <Switch
              checked={supportsEffort}
              onCheckedChange={handleReasoningEffortChange}
            />
          </div>
        </div>
      )}

      {shouldShowModelField && onCatalogModelsChange && (
        <div className="space-y-3 rounded-lg border border-border-default p-4">
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
                setCatalogRows((current) => [...current, createCatalogRow()])
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
                placeholder={t("codexConfig.catalogDisplayNamePlaceholder")}
                aria-label={t("codexConfig.catalogColumnDisplay")}
              />
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

      {category !== "official" && (
        <CustomUserAgentField
          id="codex-custom-user-agent"
          value={customUserAgent}
          onChange={onCustomUserAgentChange}
        />
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
