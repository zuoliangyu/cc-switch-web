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
import { HelpTip } from "@/components/ui/help-tip";
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
  DirectModeFormatWarning,
  EndpointField,
  FullUrlToggle,
  ModelDropdown,
  type DirectModeFormatNotice,
} from "./shared";
import {
  FetchedModelPicker,
  type FetchedModelSelection,
} from "./FetchedModelPicker";
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

  // Grok Build 的高级路由选项。Codex 的模型列表常驻显示，留空即不生成目录。
  takeoverEnabled?: boolean;
  onTakeoverEnabledChange?: (enabled: boolean) => void;
  /** 应用实际在直连时传：选了要靠路由转换的格式就在格式下面提示后果（上游 e615a6f4）。 */
  directModeFormatNotice?: DirectModeFormatNotice;
  /**
   * 布局：`classic` 是直连 / 路由用的完整表单；`stack` 是聚合模式的简化面板（连接 + 模型列表 +
   * 高级），子代理、并发上限与自动审批改在聚合设置里（上游 fe831f0a / 4f08989a）。
   */
  variant?: "classic" | "stack";

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

// 默认模型（`model`）那一行排到最前面：有模型列表时第一行就是默认模型（上游 9f7ac1fa）。
// 不在列表里、或已经在第一行时原样返回。
function withDefaultModelFirst<T extends CodexCatalogModel>(
  models: T[],
  defaultModel: string,
): T[] {
  const target = defaultModel.trim();
  const index = target
    ? models.findIndex((model) => model.model.trim() === target)
    : -1;
  if (index <= 0) return models;
  return [models[index], ...models.filter((_, i) => i !== index)];
}

// 拖动行首手柄换行序（上游 05034a4e）。`currentDefault` 是第一行代表的默认模型（`model`），
// 为 null 时第一行不代表它（没填、或不在列表里）；否则换到最前面的那一行成为新的默认模型，
// 和删行一样取第一个填了名字的行。
export function reorderCatalogRows<T extends { rowId: string; model: string }>(
  rows: T[],
  activeId: string,
  overId: string,
  currentDefault: string | null,
): { rows: T[]; defaultModel?: string } | null {
  const from = rows.findIndex((row) => row.rowId === activeId);
  const to = rows.findIndex((row) => row.rowId === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const next = arrayMove(rows, from, to);
  if (currentDefault === null) return { rows: next };
  const first = next.map((row) => row.model.trim()).find(Boolean);
  return first && first !== currentDefault
    ? { rows: next, defaultModel: first }
    : { rows: next };
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
  directModeFormatNotice,
  variant = "classic",
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
  // 有模型列表的卡：列表第一行就是默认模型，没有单独的默认模型框；列表为空时才显示默认模型框。
  // Grok Build 没有列表，官方卡不显示列表（上游 9f7ac1fa）。
  const firstRowIsDefault =
    Boolean(onCatalogModelsChange) && category !== "official";
  // 显示用的顺序。挪动默认那一行不算修改：没动过列表时保存仍是原来的顺序。
  const orderCatalogModels = (models: CodexCatalogModel[]) =>
    firstRowIsDefault ? withDefaultModelFirst(models, modelName) : models;
  const [catalogRows, setCatalogRows] = useState<CodexCatalogRow[]>(() =>
    orderCatalogModels(catalogModels).map((model) => createCatalogRow(model)),
  );
  const lastSentModelsRef = useRef<CodexCatalogModel[]>(
    orderCatalogModels(catalogModels),
  );
  const catalogSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
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
  // 高级区在有任何可见配置时自动展开（仅折叠→展开）：自定义 UA / 请求覆盖 / 非默认的
  // 上游格式 / Grok Build 的路由开关 / 完整 URL。模型列表在高级区外面，不算。
  const hasRequestOverrides = Boolean(
    localProxyHeadersOverride.trim() || localProxyBodyOverride.trim(),
  );
  const hasAnyAdvancedValue =
    !!isCopilotPreset ||
    !!customUserAgent ||
    hasRequestOverrides ||
    (isGrokBuild && takeoverEnabled) ||
    (!isGrokBuild && isChatFormat) ||
    isFullUrl;
  const [advancedExpanded, setAdvancedExpanded] = useState(hasAnyAdvancedValue);
  const isStack = variant === "stack";
  // 聚合布局的高级区（完整 URL、思考能力、User-Agent、请求覆盖）：开了或填了才展开。
  const [stackAdvancedExpanded, setStackAdvancedExpanded] = useState(
    isFullUrl || !!customUserAgent || hasRequestOverrides,
  );

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

  // 父 → 子：仅当 prop 数据真的变化（预设切换 / 编辑加载）时才重建 rowId。
  useEffect(() => {
    const models = orderCatalogModels(catalogModels);
    setCatalogRows((current) =>
      catalogRowsMatchModels(current, models)
        ? current
        : models.map((model) => createCatalogRow(model)),
    );
    lastSentModelsRef.current = models;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogModels]);

  useEffect(() => {
    if (!onCatalogModelsChange) return;
    const next = catalogRows.map(({ rowId: _rowId, ...model }) => model);
    if (catalogRowsMatchModels(catalogRows, lastSentModelsRef.current)) return;
    lastSentModelsRef.current = next;
    onCatalogModelsChange(next);
  }, [catalogRows, onCatalogModelsChange]);

  // `model` 比列表晚到（编辑加载时先给列表、再从 TOML 读出 `model`）：在当前行上把它挪到
  // 第一行，行 id 不变，也不回传父组件。编辑中 `model` 只会跟着第一行变，这里不会动。
  useEffect(() => {
    if (!firstRowIsDefault) return;
    const ordered = withDefaultModelFirst(catalogRows, modelName);
    if (ordered === catalogRows) return;
    lastSentModelsRef.current = ordered.map(
      ({ rowId: _rowId, ...model }) => model,
    );
    setCatalogRows(ordered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName, firstRowIsDefault]);

  const modelSuggestions = useMemo<FetchedModel[]>(() => {
    const seen = new Set<string>();
    const suggestions: FetchedModel[] = [];
    for (const row of catalogRows) {
      const id = row.model.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      suggestions.push({ id, ownedBy: t("codexConfig.modelListTitle") });
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
    (rowId: string, modelId: string, silent?: boolean) => {
      fillModelMetadata(
        modelId,
        (metadata) => {
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
        },
        { silent },
      );
    },
    [catalogRowsRef, commitCatalogRows, fillModelMetadata],
  );

  // 第一行就是 `model`（加载时已挪到最前面）：它不在列表里时没有这样的行；没填时保存会用
  // 第一行。默认模型那一行就代表 `model`：改它的名字、删掉它，`model` 当场跟着变。
  const defaultRowIndex = trimmedModelName
    ? catalogRows.findIndex((row) => row.model.trim() === trimmedModelName)
    : 0;
  const linkedDefaultIndex =
    firstRowIsDefault && trimmedModelName ? defaultRowIndex : -1;

  // 列表从空变成有行时，当前默认模型排第一行（已在新增的行里就挪到最前，否则补一行），
  // 默认模型框随之隐藏，默认值不会悄悄换掉。
  const seedWithDefaultModel = useCallback(
    (additions: CodexCatalogRow[]): CodexCatalogRow[] => {
      if (!firstRowIsDefault || !trimmedModelName) return additions;
      const ordered = withDefaultModelFirst(additions, trimmedModelName);
      if (ordered[0]?.model.trim() === trimmedModelName) return ordered;
      return [
        createCatalogRow({
          model: trimmedModelName,
          displayName: trimmedModelName,
        }),
        ...additions,
      ];
    },
    [firstRowIsDefault, trimmedModelName],
  );

  const handleAddCatalogRow = useCallback(() => {
    if (!onCatalogModelsChange) return;
    const rows = catalogRowsRef.current;
    const added =
      rows.length === 0
        ? seedWithDefaultModel([createCatalogRow()])
        : [createCatalogRow()];
    commitCatalogRows([...rows, ...added]);
    for (const row of added) {
      if (row.model) fillCatalogRowMetadata(row.rowId, row.model);
    }
  }, [
    catalogRowsRef,
    commitCatalogRows,
    fillCatalogRowMetadata,
    onCatalogModelsChange,
    seedWithDefaultModel,
  ]);

  const handleUpdateCatalogRow = useCallback(
    (index: number, patch: Partial<CodexCatalogModel>) => {
      if (patch.model !== undefined && index === linkedDefaultIndex) {
        onModelNameChange?.(patch.model);
      }
      setCatalogRows((current) =>
        current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [linkedDefaultIndex, onModelNameChange],
  );

  const selectFetchedCatalogModel = (rowId: string, modelId: string) => {
    const rows = catalogRowsRef.current;
    if (rows.findIndex((row) => row.rowId === rowId) === linkedDefaultIndex) {
      onModelNameChange?.(modelId);
    }
    commitCatalogRows(
      rows.map((row) =>
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

  const handleRemoveCatalogRow = useCallback(
    (index: number) => {
      if (index === linkedDefaultIndex) {
        const next = catalogRows
          .filter((_, i) => i !== index)
          .map((row) => row.model.trim())
          .find(Boolean);
        // 删光了就留着 `model`：列表为空时用的正是它。
        if (next) onModelNameChange?.(next);
      }
      setCatalogRows((current) => current.filter((_, i) => i !== index));
    },
    [catalogRows, linkedDefaultIndex, onModelNameChange],
  );

  // 拖动换行序：第一行就是默认模型，换到最前面的那一行当场成为新的 `model`。
  const handleCatalogDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over) return;
      const result = reorderCatalogRows(
        catalogRowsRef.current,
        String(active.id),
        String(over.id),
        linkedDefaultIndex >= 0 ? trimmedModelName : null,
      );
      if (!result) return;
      if (result.defaultModel) onModelNameChange?.(result.defaultModel);
      commitCatalogRows(result.rows);
    },
    [
      catalogRowsRef,
      commitCatalogRows,
      linkedDefaultIndex,
      onModelNameChange,
      trimmedModelName,
    ],
  );

  // 按弹窗里的勾选增删列表行：留下的行原样不动，新勾的追加到末尾并补参数（上游 f7244745）。
  const handleApplyFetchedCatalogRows = useCallback(
    ({ add, remove }: FetchedModelSelection) => {
      const current = catalogRowsRef.current;
      const removed = new Set(remove);
      const kept = current.filter((row) => !removed.has(row.model.trim()));
      const configured = new Set(kept.map((row) => row.model.trim()));
      const picked = add
        .filter((id) => !configured.has(id))
        .map((id) => createCatalogRow({ model: id, displayName: id }));
      const additions =
        current.length === 0 ? seedWithDefaultModel(picked) : picked;
      const next = [...kept, ...additions];
      // 默认模型那一行被取消：和删行一样改用新的第一行；删光了就留着 `model`。
      if (linkedDefaultIndex >= 0 && removed.has(trimmedModelName)) {
        const first = next.map((row) => row.model.trim()).find(Boolean);
        if (first) onModelNameChange?.(first);
      }
      commitCatalogRows(next);
      // 弹窗里已经显示过这些参数，补完不再提示（上游 644b7d5c）。
      for (const row of additions) {
        fillCatalogRowMetadata(row.rowId, row.model, true);
      }
    },
    [
      catalogRowsRef,
      commitCatalogRows,
      fillCatalogRowMetadata,
      linkedDefaultIndex,
      onModelNameChange,
      seedWithDefaultModel,
      trimmedModelName,
    ],
  );

  // 默认模型不在列表里时加进去：有列表时它排第一行。
  const handleAddModelToCatalog = useCallback(() => {
    if (!onCatalogModelsChange || !trimmedModelName) return;
    const row = createCatalogRow({
      model: trimmedModelName,
      displayName: trimmedModelName,
    });
    const rows = catalogRowsRef.current;
    commitCatalogRows(firstRowIsDefault ? [row, ...rows] : [...rows, row]);
    fillCatalogRowMetadata(row.rowId, trimmedModelName);
  }, [
    catalogRowsRef,
    commitCatalogRows,
    fillCatalogRowMetadata,
    firstRowIsDefault,
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
    for (const row of added) fillCatalogRowMetadata(row.rowId, row.model);
  }, [
    catalogRowsRef,
    commitCatalogRows,
    fillCatalogRowMetadata,
    onCatalogModelsChange,
    trimmedModelName,
    trimmedSubagentModel,
  ]);

  // 自动审批模型只能选映射里的：审批请求和主对话发给同一家，后端也只写目录里有的模型。
  const autoReviewChoices = useMemo(() => {
    const seen = new Set<string>();
    const choices: { model: string; label: string }[] = [];
    for (const row of catalogRows) {
      const model = row.model.trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      choices.push({ model, label: row.displayName?.trim() || model });
    }
    return choices;
  }, [catalogRows]);
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
          if (usableModels.length === 0) {
            toast.info(t("providerForm.fetchModelsEmpty"));
          } else if (!canEditCatalog) {
            // 有模型列表时拉取成功会直接打开选择弹窗，不再提示成功。
            toast.success(
              t("providerForm.fetchModelsSuccess", {
                count: usableModels.length,
              }),
            );
          }
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
          if (models.length === 0) {
            toast.info(t("providerForm.fetchModelsEmpty"));
          } else if (!canEditCatalog) {
            toast.success(
              t("providerForm.fetchModelsSuccess", { count: models.length }),
            );
          }
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
        } else if (!canEditCatalog) {
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
    canEditCatalog,
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

  // 字段名后面的「?」：规则和术语解释收进去；后果（要开路由、会报错）仍写在页面上（上游 36e2ce2c）。
  const labelWithHelp = (label: string, help: ReactNode, htmlFor?: string) => (
    <div className="flex items-center gap-0.5">
      <FormLabel htmlFor={htmlFor}>{label}</FormLabel>
      <HelpTip title={label}>{help}</HelpTip>
    </div>
  );

  // 模型列表标题右侧：获取 / 选择模型弹窗，和「手动添加」（模型没在拉到的列表里时的兜底）。
  const catalogActionButtons = (
    <div className="flex gap-1">
      <FetchedModelPicker
        models={fetchedModels}
        configuredModelIds={catalogRows.map((row) => row.model)}
        onApply={handleApplyFetchedCatalogRows}
        onFetch={handleFetchModels}
        isFetching={isFetchingModels}
        metadataSource={{
          baseUrl: codexBaseUrl,
          presets: codexPresetModelSources,
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddCatalogRow}
        className="h-7 shrink-0 gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("codexConfig.addCatalogModel")}
      </Button>
    </div>
  );

  const catalogRowsEditor = (
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
        <div className="space-y-2">
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
                    handleUpdateCatalogRow(index, {
                      displayName: event.target.value,
                    })
                  }
                  placeholder={t("codexConfig.catalogDisplayNamePlaceholder")}
                  aria-label={t("codexConfig.catalogColumnDisplay")}
                />
                <div className="flex gap-1">
                  <Input
                    value={row.model}
                    onChange={(event) =>
                      handleUpdateCatalogRow(index, {
                        model: event.target.value,
                      })
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
                    handleUpdateCatalogRow(index, {
                      contextWindow: event.target.value.replace(/[^\d]/g, ""),
                    })
                  }
                  placeholder={t("codexConfig.contextWindowPlaceholder")}
                  aria-label={t("codexConfig.catalogColumnContext")}
                />
                <ReasoningLevelsEditor
                  levels={row.reasoningLevels}
                  defaultLevel={row.defaultReasoningLevel}
                  onLevelsChange={(levels) =>
                    handleUpdateCatalogRow(index, { reasoningLevels: levels })
                  }
                  onDefaultLevelChange={(level) =>
                    handleUpdateCatalogRow(index, {
                      defaultReasoningLevel: level,
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveCatalogRow(index)}
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </SortableCatalogRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  // 默认模型（`model`）不在列表里：没有哪一行是默认，提示并给出加入列表（排第一行）。
  const defaultModelNotInListNotice = isModelOutsideCatalog && (
    <p className="flex flex-wrap items-center gap-x-2 text-xs leading-relaxed text-muted-foreground">
      {t("codexConfig.defaultModelNotInList", { model: trimmedModelName })}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={handleAddModelToCatalog}
      >
        {t("codexConfig.addToModelList")}
      </Button>
    </p>
  );

  // 上游格式（Copilot 可自动按模型能力选，也可显式指定）。直连下 Chat 发不出请求，按应用
  // 实际的模式提示后果；Copilot 恒需路由，单独提示（上游 e615a6f4）。
  const upstreamFormatSelect = (
    <div className="space-y-1.5">
      {labelWithHelp(
        t("codexConfig.upstreamFormatLabel"),
        isCopilotPreset
          ? t("codexConfig.upstreamFormatCopilotHint")
          : t("codexConfig.upstreamFormatHint"),
        "codexApiFormat",
      )}
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
      {directModeFormatNotice && !isCopilotPreset && isChatFormat && (
        <DirectModeFormatWarning notice={directModeFormatNotice} />
      )}
      {isCopilotPreset && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("codexConfig.upstreamFormatCopilotRouteHint")}
        </p>
      )}
    </div>
  );

  // 两项都只在路由模式下生效：在分组开头说一次，各自的作用收进字段名后的「?」。
  // Copilot 的请求由转发层按 Copilot 客户端的样子发，UA 和请求覆盖都会被跳过，不显示。
  const userAgentAndOverrides = isCopilotPreset ? null : (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          isGrokBuild
            ? "grokBuild.routeOnlySettingsHint"
            : "codexConfig.routeOnlySettingsHint",
        )}
      </p>
      <CustomUserAgentField
        id="codex-custom-user-agent"
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
    </>
  );

  // 完整 URL 跟着地址框（托管账号端点由 adapter 硬定向，没有这个开关），放在高级选项里。
  const showFullUrlToggle =
    shouldShowSpeedTest && !isCopilotPreset && !isXaiOauthPreset;

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

      {/* 聚合布局：上游格式放在 Key 前面（完整表单里在高级选项） */}
      {isStack &&
        (shouldShowSpeedTest || isCopilotPreset) &&
        !isXaiOauthPreset &&
        upstreamFormatSelect}

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
          help={t("providerForm.codexApiHint")}
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}

      {/* 模型列表 —— 生成 Codex 的模型目录（model_catalog_json）：/model 菜单列哪些模型，
          各自的窗口和思考等级。留空不生成。第一行是默认模型，子代理也从这里选。 */}
      {firstRowIsDefault && shouldShowModelField && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              {labelWithHelp(
                t("codexConfig.modelListTitle"),
                t(
                  isStack
                    ? "codexConfig.stackModelDefaultHelp"
                    : "codexConfig.modelListDefaultHelp",
                ),
              )}
              {catalogActionButtons}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("codexConfig.modelListHint")}
            </p>
          </div>
          {defaultModelNotInListNotice}
          {catalogRows.length > 0 && catalogRowsEditor}
        </div>
      )}

      {/* 默认模型 —— config.toml 顶层 model。有模型列表时第一行就是它，不显示这个框
          （Grok Build 没有列表，一直显示）；列表为空时显示。 */}
      {shouldShowModelField &&
        onModelNameChange &&
        (!firstRowIsDefault || catalogRows.length === 0) && (
          <div className="space-y-1.5">
            {labelWithHelp(
              t("codexConfig.defaultModelLabel"),
              t(
                isGrokBuild
                  ? "grokBuild.defaultModelHint"
                  : "codexConfig.defaultModelHint",
              ),
              "codexModelName",
            )}
            <div className="flex gap-1">
              <Input
                id="codexModelName"
                value={modelName}
                onChange={(event) => onModelNameChange(event.target.value)}
                placeholder={t(
                  isGrokBuild
                    ? "grokBuild.defaultModelPlaceholder"
                    : "codexConfig.defaultModelPlaceholder",
                )}
                className="flex-1"
              />
              {/* 有模型列表时用列表上的「获取模型列表」，这里不再放一个。 */}
              {!canEditCatalog && (
                <HoverTip content={t("providerForm.fetchModels")}>
                  <Button
                    aria-label={t("providerForm.fetchModels")}
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleFetchModels}
                    disabled={isFetchingModels}
                    className="shrink-0"
                  >
                    {isFetchingModels ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                </HoverTip>
              )}
              {modelSuggestions.length > 0 && (
                <ModelDropdown
                  models={modelSuggestions}
                  onSelect={(id) => onModelNameChange(id)}
                />
              )}
            </div>
          </div>
        )}

      {/* 子代理 —— config.toml 的 [agents] default_subagent_model / default_subagent_reasoning_effort。
          留空删键，子代理跟随主模型；聚合模式下改用聚合设置。 */}
      {!isStack &&
        category !== "official" &&
        !isGrokBuild &&
        onSubagentModelChange && (
          <div className="space-y-1.5">
            {labelWithHelp(
              t("codexConfig.subagentModelLabel"),
              t("codexConfig.subagentModelHint"),
              "codexSubagentModel",
            )}
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
                    {t("codexConfig.addToModelList")}
                  </Button>
                )}
              </p>
            )}
          </div>
        )}

      {/* 子代理并发上限 —— config.toml 的 [agents] max_threads，Codex 的全局设置（官方供应商也显示），
          保存时写进 live。留空删键，回到 Codex 默认值（上游 a9e607c3）。 */}
      {!isStack && !isGrokBuild && onAgentMaxThreadsChange && (
        <div className="space-y-1.5">
          {labelWithHelp(
            t("codexConfig.agentMaxThreadsLabel"),
            t("codexConfig.agentMaxThreadsHint"),
            "codexAgentMaxThreads",
          )}
          <Input
            id="codexAgentMaxThreads"
            value={agentMaxThreads}
            inputMode="numeric"
            onChange={(event) => onAgentMaxThreadsChange(event.target.value)}
            placeholder={t("codexConfig.agentMaxThreadsPlaceholder")}
          />
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
          选审批模型。只能选列表里的模型；聚合模式下改用聚合设置。 */}
      {!isStack &&
        category !== "official" &&
        !isGrokBuild &&
        onAutoReviewModelChange && (
          <div className="space-y-1.5">
            {labelWithHelp(
              t("codexConfig.autoReviewModelLabel"),
              t("codexConfig.autoReviewModelHint"),
              "codexAutoReviewModel",
            )}
            <Select
              value={autoReviewSelectValue}
              onValueChange={(next) => {
                // 表单里的 Radix Select 带一个隐藏的原生 select：编辑页加载时列表和已存的值同时
                // 到达，值先于选项注册，它会回报一次空串。选项都不是空值，空串只能是这个，忽略。
                if (!next) return;
                onAutoReviewModelChange(
                  next === AUTO_REVIEW_DEFAULT ? "" : next,
                );
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
            {autoReviewChoices.length === 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("codexConfig.autoReviewModelNoList")}
              </p>
            )}
          </div>
        )}

      {/* 高级选项 —— 上游格式 / 完整 URL / 思考能力 / 自定义 UA；预设供应商通常无需展开 */}
      {category !== "official" &&
        (!isStack ||
          showFullUrlToggle ||
          showChatOptions ||
          userAgentAndOverrides) && (
          <Collapsible
            open={isStack ? stackAdvancedExpanded : advancedExpanded}
            onOpenChange={
              isStack ? setStackAdvancedExpanded : setAdvancedExpanded
            }
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
            <CollapsibleContent className="space-y-3 pt-3">
              {isStack && showFullUrlToggle && (
                <FullUrlToggle
                  checked={isFullUrl}
                  onCheckedChange={onFullUrlChange}
                />
              )}
              {!isStack &&
                (shouldShowSpeedTest || isCopilotPreset) &&
                !isXaiOauthPreset && (
                  <div className="space-y-3">
                    {upstreamFormatSelect}

                    {isGrokBuild && (
                      <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                        {labelWithHelp(
                          t("codexConfig.localRoutingToggle"),
                          t(
                            takeoverEnabled
                              ? "codexConfig.localRoutingOnHint"
                              : "codexConfig.localRoutingOffHint",
                          ),
                        )}
                        <Switch
                          checked={takeoverEnabled}
                          onCheckedChange={onTakeoverEnabledChange}
                          aria-label={t("codexConfig.localRoutingToggle")}
                        />
                      </div>
                    )}

                    {showFullUrlToggle && (
                      <FullUrlToggle
                        checked={isFullUrl}
                        onCheckedChange={onFullUrlChange}
                        className="border-t border-border-default pt-3"
                      />
                    )}
                  </div>
                )}

              {showChatOptions && (
                <div className="space-y-4 border-t border-border-default pt-3">
                  <div className="space-y-1.5">
                    {labelWithHelp(
                      t("codexConfig.promptCacheRoutingLabel"),
                      t("codexConfig.promptCacheRoutingHint"),
                      "codexPromptCacheRouting",
                    )}
                    <Select
                      value={promptCacheRouting}
                      onValueChange={(value) =>
                        onPromptCacheRoutingChange(
                          value as PromptCacheRoutingMode,
                        )
                      }
                    >
                      <SelectTrigger id="codexPromptCacheRouting">
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
                  </div>

                  <div className="border-t border-border-default pt-3">
                    <FormLabel>
                      {t("codexConfig.reasoningGroupTitle")}
                    </FormLabel>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    {labelWithHelp(
                      t("codexConfig.reasoningModeToggle"),
                      t("codexConfig.reasoningModeHint"),
                    )}
                    <Switch
                      checked={supportsThinking}
                      onCheckedChange={handleReasoningThinkingChange}
                      aria-label={t("codexConfig.reasoningModeToggle")}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                    {labelWithHelp(
                      t("codexConfig.reasoningEffortToggle"),
                      t(
                        isGrokBuild
                          ? "grokBuild.reasoningEffortHint"
                          : "codexConfig.reasoningEffortHint",
                      ),
                    )}
                    <Switch
                      checked={supportsEffort}
                      onCheckedChange={handleReasoningEffortChange}
                      aria-label={t("codexConfig.reasoningEffortToggle")}
                    />
                  </div>
                </div>
              )}

              {userAgentAndOverrides && (
                <div
                  className={cn(
                    "space-y-3",
                    (shouldShowSpeedTest || showChatOptions) &&
                      "border-t border-border-default pt-3",
                  )}
                >
                  {userAgentAndOverrides}
                </div>
              )}
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
