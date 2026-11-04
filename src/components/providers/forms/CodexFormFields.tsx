import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { fieldClass, Input } from "@/components/ui/input";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
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
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  GripVertical,
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
  modelFetchRequestHeaders,
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
  // 自动审批（Auto Review）用的模型：`modelCatalog.autoReviewModel`，只能是映射里的一行。
  // Codex 专用；聚合模式下不生效（改用聚合设置）。
  autoReviewModel?: string;
  onAutoReviewModelChange?: (model: string) => void;

  // 子代理默认值（config.toml 的 `[agents]`）。Codex 专用：Grok Build 没有这两个键。
  subagentModel?: string;
  onSubagentModelChange?: (model: string) => void;
  subagentReasoningEffort?: string;
  onSubagentReasoningEffortChange?: (effort: string) => void;
  // 子代理并发上限（config.toml 的 `[agents] max_threads`）：Codex 的全局设置，保存时写进 live
  agentMaxThreads?: string;
  multiAgentV2Total?: number;
  onAgentMaxThreadsChange?: (value: string) => void;

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

const CODEX_REASONING_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

// 子代理推理强度下拉的「不写这个键」（Radix Select 不收空值）。
const EFFORT_INHERIT = "__inherit__";
// 自动审批模型下拉的「不写覆盖、用 Codex 的默认」。
const AUTO_REVIEW_DEFAULT = "__codex_default__";
// Codex 不写覆盖时用的审批模型（codex-rs `DEFAULT_APPROVAL_REVIEW_PREFERRED_MODEL`）。
const CODEX_AUTO_REVIEW_MODEL = "codex-auto-review";

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

// 拖动行首手柄换行序（上游 05034a4e）。Web 的默认模型是单独字段，第一行不代表它，
// 只换顺序：Codex 的 /model 菜单按这个顺序列出。
export function reorderCatalogRows<T extends { rowId: string }>(
  rows: T[],
  activeId: string,
  overId: string,
): T[] | null {
  const from = rows.findIndex((row) => row.rowId === activeId);
  const to = rows.findIndex((row) => row.rowId === overId);
  if (from === -1 || to === -1 || from === to) return null;
  return arrayMove(rows, from, to);
}

// 模型列表只能上下拖。
const verticalOnly: Modifier[] = [({ transform }) => ({ ...transform, x: 0 })];

function SortableCatalogRow({
  id,
  canDrag,
  children,
}: {
  id: string;
  canDrag: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !canDrag });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        "flex items-start gap-1",
        isDragging && "rounded-md bg-background shadow-md",
      )}
    >
      {/* 只有一行时没东西可换，手柄隐藏但留着位置，各列照旧和表头对齐 */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        disabled={!canDrag}
        className="flex h-9 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:invisible"
        aria-label={t("provider.dragHandle", { defaultValue: "拖拽排序" })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
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

// Trigger label for the picked levels, kept narrow for the catalog cell. Each
// run of three or more adjacent canonical levels collapses to "first → last"
// ("none, low → max" when minimal is skipped); a range never spans a gap, so
// it can't imply an unpicked level. Non-canonical order stays a plain list.
export function formatReasoningLevelsLabel(levels: string[]): string {
  const canonical = CODEX_REASONING_LEVELS as readonly string[];
  const positions = levels.map((level) => canonical.indexOf(level));
  const ordered = positions.every(
    (position, index) =>
      position >= 0 && (index === 0 || position > positions[index - 1]),
  );
  if (!ordered) return levels.join(", ");

  const parts: string[] = [];
  let runStart = 0;
  for (let index = 1; index <= levels.length; index++) {
    if (
      index < levels.length &&
      positions[index] === positions[index - 1] + 1
    ) {
      continue;
    }
    const run = levels.slice(runStart, index);
    if (run.length >= 3) {
      parts.push(`${run[0]} → ${run[run.length - 1]}`);
    } else {
      parts.push(...run);
    }
    runStart = index;
  }
  return parts.join(", ");
}

// Sentinel for the default-level Select: Radix Select forbids empty item
// values, so "back to Auto" needs a non-empty value mapped to undefined.
const AUTO_DEFAULT_REASONING_LEVEL = "__auto__";

function ReasoningLevelsEditor({
  levels,
  defaultLevel,
  onLevelsChange,
  onDefaultLevelChange,
}: {
  levels?: string[];
  defaultLevel?: string;
  onLevelsChange: (levels: string[] | undefined) => void;
  onDefaultLevelChange: (level: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = (levels ?? []).filter((level) =>
    (CODEX_REASONING_LEVELS as readonly string[]).includes(level),
  );

  const toggleLevel = (level: string) => {
    const picked = selected.includes(level)
      ? selected.filter((item) => item !== level)
      : [...selected, level];
    // Store in canonical ascending-depth order (not click order): the Codex
    // picker and the generated catalog both follow array order.
    const next = (CODEX_REASONING_LEVELS as readonly string[]).filter((item) =>
      picked.includes(item),
    );
    onLevelsChange(next.length > 0 ? next : undefined);
    if (defaultLevel && !next.includes(defaultLevel)) {
      onDefaultLevelChange(undefined);
    }
  };

  const triggerLabel =
    selected.length > 0
      ? formatReasoningLevelsLabel(selected)
      : t("codexConfig.reasoningLevelsNotSet", {
          defaultValue: "Not set",
        });

  // The label may be a range or truncated, so hovering spells out every
  // picked level plus the default one.
  const triggerTip =
    selected.length > 0 ? (
      <>
        <div>{selected.join(", ")}</div>
        {defaultLevel && (
          <div>
            {t("codexConfig.defaultReasoningLevelTip", {
              level: defaultLevel,
              defaultValue: "Default level: {{level}}",
            })}
          </div>
        )}
      </>
    ) : undefined;

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <HoverTip content={triggerTip}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            // 和同一行的 Input、Select 同一套外观，行高才对得齐。
            className={cn(
              fieldClass,
              "flex h-9 w-full items-center justify-between gap-1 whitespace-nowrap text-start",
            )}
          >
            <span
              className={cn(
                "truncate",
                selected.length === 0 && "text-muted-foreground",
              )}
            >
              {triggerLabel}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
      </HoverTip>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        avoidCollisions
        collisionPadding={8}
        // Flipping alone can't help when neither side of the trigger has
        // room for the whole panel (short window, row mid-form): cap it to
        // the space Radix measured and let the level list scroll instead of
        // cutting off the bottom, including the default-level picker.
        className="z-[1000] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] flex-col p-0 border-border"
      >
        <Command className="min-h-0 flex-1">
          <CommandInput
            placeholder={t("codexConfig.reasoningLevelsSearch", {
              defaultValue: "Search reasoning levels...",
            })}
          />
          <CommandList>
            <CommandEmpty>
              {t("codexConfig.reasoningLevelsEmpty", {
                defaultValue: "No levels",
              })}
            </CommandEmpty>
            <CommandGroup>
              {CODEX_REASONING_LEVELS.map((level) => (
                <CommandItem
                  key={level}
                  value={level}
                  onSelect={() => toggleLevel(level)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(level) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1">{level}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="shrink-0 border-t border-border p-2">
            <span className="text-xs text-muted-foreground">
              {t("codexConfig.defaultReasoningLevelLabel", {
                defaultValue: "Default level",
              })}
            </span>
            <Select
              value={defaultLevel ?? AUTO_DEFAULT_REASONING_LEVEL}
              onValueChange={(value) =>
                onDefaultLevelChange(
                  value === AUTO_DEFAULT_REASONING_LEVEL ? undefined : value,
                )
              }
            >
              <SelectTrigger className="mt-1 h-8 w-full">
                <SelectValue
                  placeholder={t(
                    "codexConfig.defaultReasoningLevelPlaceholder",
                    { defaultValue: "Auto" },
                  )}
                />
              </SelectTrigger>
              {/* Must render above the enclosing z-[1000] popover: the
                  default SelectContent z-[100] would hide the menu behind
                  the panel when it flips upward. */}
              <SelectContent className="z-[1100]">
                <SelectItem value={AUTO_DEFAULT_REASONING_LEVEL}>
                  {t("codexConfig.defaultReasoningLevelPlaceholder", {
                    defaultValue: "Auto",
                  })}
                </SelectItem>
                {selected.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
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
  autoReviewModel = "",
  onAutoReviewModelChange,
  subagentModel = "",
  onSubagentModelChange,
  subagentReasoningEffort = "",
  onSubagentReasoningEffortChange,
  agentMaxThreads = "",
  multiAgentV2Total,
  onAgentMaxThreadsChange,
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
  const catalogSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleCatalogDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    setCatalogRows(
      (current) =>
        reorderCatalogRows(current, String(active.id), String(over.id)) ??
        current,
    );
  }, []);
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
    // Header 覆盖也是请求身份：/models 可能按请求头身份返回，换了就清掉旧列表
    localProxyHeadersOverride,
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

  // 子代理模型不在模型映射里：Codex 拿不到它的窗口和推理档位；经路由转成 Chat 协议时还会
  // 被换成默认模型（转换路径只放行映射里的模型）。没有映射、走原生 Responses 的供应商直接
  // 请求任意模型名，不提示。
  const trimmedSubagentModel = subagentModel.trim();
  const isSubagentModelOutsideCatalog =
    !!trimmedSubagentModel &&
    (catalogRows.length > 0 || isChatFormat) &&
    !catalogRows.some((row) => row.model.trim() === trimmedSubagentModel);

  const handleAddSubagentModelToCatalog = useCallback(() => {
    if (!onCatalogModelsChange || !trimmedSubagentModel) return;
    const rows = catalogRowsRef.current;
    const added: CodexCatalogRow[] = [];
    // 映射原本为空时默认模型也一起加进去，不然加完它就成了映射外的模型。
    if (
      rows.length === 0 &&
      trimmedModelName &&
      trimmedModelName !== trimmedSubagentModel
    ) {
      added.push(
        createCatalogRow({
          model: trimmedModelName,
          displayName: trimmedModelName,
        }),
      );
    }
    added.push(
      createCatalogRow({
        model: trimmedSubagentModel,
        displayName: trimmedSubagentModel,
      }),
    );
    commitCatalogRows([...rows, ...added]);
    onCatalogEnabledChange?.(true);
    for (const row of added) fillCatalogRowMetadata(row.rowId, row.model);
  }, [
    catalogRowsRef,
    commitCatalogRows,
    fillCatalogRowMetadata,
    onCatalogEnabledChange,
    onCatalogModelsChange,
    trimmedModelName,
    trimmedSubagentModel,
  ]);

  // 自动审批模型只能选映射里的：审批请求和主对话发给同一家，后端也只写目录里有的模型。
  const autoReviewChoices = useMemo(() => {
    const seen = new Set<string>();
    const choices: { model: string; label: string }[] = [];
    if (!catalogEnabled) return choices;
    for (const row of catalogRows) {
      const model = row.model.trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      choices.push({ model, label: row.displayName?.trim() || model });
    }
    return choices;
  }, [catalogEnabled, catalogRows]);
  const trimmedAutoReviewModel = autoReviewModel.trim();
  const autoReviewSelectValue = autoReviewChoices.some(
    (choice) => choice.model === trimmedAutoReviewModel,
  )
    ? trimmedAutoReviewModel
    : AUTO_REVIEW_DEFAULT;
  // 不写覆盖时 Codex 先找目录里的 codex-auto-review：没有映射（用 Codex 自带的列表）或映射里
  // 就有它时用它，否则由主模型自己审批。
  const autoReviewDefaultIsCodex =
    autoReviewChoices.length === 0 ||
    autoReviewChoices.some(
      (choice) => choice.model === CODEX_AUTO_REVIEW_MODEL,
    );

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
      {
        requestHeaders: modelFetchRequestHeaders(localProxyHeadersOverride),
      },
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
    localProxyHeadersOverride,
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

      {/* 子代理 —— config.toml 的 [agents] default_subagent_model / default_subagent_reasoning_effort。
          留空删键，子代理跟随主模型；聚合模式下改用聚合设置。 */}
      {category !== "official" && !isGrokBuild && onSubagentModelChange && (
        <div className="space-y-2">
          <label
            htmlFor="codexSubagentModel"
            className="block text-sm font-medium text-foreground"
          >
            {t("codexConfig.subagentModelLabel")}
          </label>
          <div className="flex gap-1">
            <Input
              id="codexSubagentModel"
              value={subagentModel}
              onChange={(event) => onSubagentModelChange(event.target.value)}
              placeholder={t("codexConfig.subagentModelPlaceholder")}
              className="flex-1"
            />
            {modelSuggestions.length > 0 && (
              <ModelDropdown
                models={modelSuggestions}
                onSelect={(id) => onSubagentModelChange(id)}
              />
            )}
            {onSubagentReasoningEffortChange && (
              <Select
                value={subagentReasoningEffort || EFFORT_INHERIT}
                onValueChange={(value) =>
                  onSubagentReasoningEffortChange(
                    value === EFFORT_INHERIT ? "" : value,
                  )
                }
              >
                <SelectTrigger
                  aria-label={t("codexConfig.subagentReasoningEffortLabel")}
                  className="w-36 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EFFORT_INHERIT}>
                    {t("codexConfig.subagentReasoningEffortDefault")}
                  </SelectItem>
                  {subagentReasoningEffort &&
                    !(CODEX_REASONING_LEVELS as readonly string[]).includes(
                      subagentReasoningEffort,
                    ) && (
                      <SelectItem value={subagentReasoningEffort}>
                        {subagentReasoningEffort}
                      </SelectItem>
                    )}
                  {CODEX_REASONING_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("codexConfig.subagentModelHint")}
          </p>
          {isSubagentModelOutsideCatalog && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs leading-relaxed text-muted-foreground">
              {t("codexConfig.subagentModelNotInCatalog")}
              {onCatalogModelsChange && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={handleAddSubagentModelToCatalog}
                >
                  {t("codexConfig.addToModelMapping")}
                </Button>
              )}
            </p>
          )}
        </div>
      )}

      {/* 子代理并发上限 —— config.toml 的 [agents] max_threads，Codex 的全局设置（官方供应商也显示），
          保存时写进 live。留空删键，回到 Codex 默认值（上游 a9e607c3）。 */}
      {!isGrokBuild && onAgentMaxThreadsChange && (
        <div className="space-y-2">
          <label
            htmlFor="codexAgentMaxThreads"
            className="block text-sm font-medium text-foreground"
          >
            {t("codexConfig.agentMaxThreadsLabel")}
          </label>
          <Input
            id="codexAgentMaxThreads"
            value={agentMaxThreads}
            inputMode="numeric"
            onChange={(event) => onAgentMaxThreadsChange(event.target.value)}
            placeholder={t("codexConfig.agentMaxThreadsPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {t("codexConfig.agentMaxThreadsHint")}
          </p>
          {multiAgentV2Total !== undefined && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("codexConfig.agentMaxThreadsV2Override", {
                total: multiAgentV2Total,
              })}
            </p>
          )}
        </div>
      )}

      {/* 自动审批 —— 写进模型目录每一行的 auto_review_model_override，Codex 按主模型那一行
          选审批模型。只能选映射里的模型；聚合模式下改用聚合设置。 */}
      {category !== "official" && !isGrokBuild && onAutoReviewModelChange && (
        <div className="space-y-2">
          <label
            htmlFor="codexAutoReviewModel"
            className="block text-sm font-medium text-foreground"
          >
            {t("codexConfig.autoReviewModelLabel")}
          </label>
          <Select
            value={autoReviewSelectValue}
            onValueChange={(next) => {
              // 表单里的 Radix Select 带一个隐藏的原生 select：编辑页加载时列表和已存的值同时
              // 到达，值先于选项注册，它会回报一次空串。选项都不是空值，空串只能是这个，忽略。
              if (!next) return;
              onAutoReviewModelChange(next === AUTO_REVIEW_DEFAULT ? "" : next);
            }}
            disabled={autoReviewChoices.length === 0}
          >
            <SelectTrigger
              id="codexAutoReviewModel"
              aria-label={t("codexConfig.autoReviewModelLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_REVIEW_DEFAULT}>
                {autoReviewDefaultIsCodex
                  ? t("codexConfig.autoReviewModelCodexDefault")
                  : t("codexConfig.autoReviewModelMainDefault")}
              </SelectItem>
              {autoReviewChoices.map((choice) => (
                <SelectItem key={choice.model} value={choice.model}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {autoReviewChoices.length === 0
              ? t("codexConfig.autoReviewModelNoList")
              : t("codexConfig.autoReviewModelHint")}
          </p>
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

                <DndContext
                  sensors={catalogSensors}
                  collisionDetection={closestCenter}
                  modifiers={verticalOnly}
                  onDragEnd={handleCatalogDragEnd}
                >
                  <SortableContext
                    items={catalogRows.map((row) => row.rowId)}
                    strategy={verticalListSortingStrategy}
                  >
                    {catalogRows.map((row, index) => (
                      <SortableCatalogRow
                        key={row.rowId}
                        id={row.rowId}
                        canDrag={catalogRows.length > 1}
                      >
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,140px)_36px]">
                          <Input
                            value={row.displayName ?? ""}
                            onChange={(event) =>
                              setCatalogRows((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        displayName: event.target.value,
                                      }
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
                              placeholder={t(
                                "codexConfig.catalogModelPlaceholder",
                              )}
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
                                        contextWindow:
                                          event.target.value.replace(
                                            /[^\d]/g,
                                            "",
                                          ),
                                      }
                                    : item,
                                ),
                              )
                            }
                            placeholder={t(
                              "codexConfig.contextWindowPlaceholder",
                            )}
                            aria-label={t("codexConfig.catalogColumnContext")}
                          />
                          <ReasoningLevelsEditor
                            levels={row.reasoningLevels}
                            defaultLevel={row.defaultReasoningLevel}
                            onLevelsChange={(levels) =>
                              setCatalogRows((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, reasoningLevels: levels }
                                    : item,
                                ),
                              )
                            }
                            onDefaultLevelChange={(level) =>
                              setCatalogRows((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, defaultReasoningLevel: level }
                                    : item,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setCatalogRows((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                            title={t("common.delete")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </SortableCatalogRow>
                    ))}
                  </SortableContext>
                </DndContext>
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
