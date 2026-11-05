import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ImeSafeInput } from "@/components/ui/ime-safe-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import JsonEditor from "@/components/JsonEditor";
import { useProvidersQuery } from "@/lib/query/queries";
import { REQUIRED_LABEL } from "./BasicFormFields";
import { PiModelsEditor } from "./PiModelsEditor";
import { RequestHeadersEditor } from "./RequestHeadersEditor";
import { normalizeRequestHeaders } from "./helpers/requestHeaders";
import {
  piProviderPresets,
  type PiApiFormat,
  type PiProviderPreset,
} from "@/config/piProviderPresets";
import {
  ompProviderPresets,
  type OmpProviderPreset,
} from "@/config/ompProviderPresets";
import {
  yamlNodeFromText,
  yamlNodeToText,
  type YamlNodeError,
} from "./helpers/yamlNode";
import { NativeConfigEditor } from "./shared/NativeConfigEditor";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import type { ProviderCategory } from "@/types";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";

const PI_API_FORMATS: readonly PiApiFormat[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "bedrock-converse-stream",
];

// omp 的供应商在 models.yml 的 `providers.<标识>` 下
const OMP_SECTION = "providers";
// omp 的 `discovery.type`（docs/models.md）：运行时从端点拉模型列表，可以不写 models。
// 值里有点号，不能直接当 i18n key，所以另配一个 key。
const OMP_DISCOVERY_TYPES: ReadonlyArray<{ value: string; labelKey: string }> =
  [
    { value: "openai-models-list", labelKey: "openaiModelsList" },
    { value: "proxy", labelKey: "proxy" },
    { value: "ollama", labelKey: "ollama" },
    { value: "llama.cpp", labelKey: "llamaCpp" },
    { value: "lm-studio", labelKey: "lmStudio" },
    { value: "litellm", labelKey: "litellm" },
    { value: "apple-foundation-models", labelKey: "appleFoundationModels" },
  ];
const OMP_DISCOVERY_OFF = "__off__";

type PiFamilyPreset = PiProviderPreset | OmpProviderPreset;

const getPiPresetDisplayName = (
  preset: PiFamilyPreset,
  t: (key: string, options?: Record<string, unknown>) => string,
) =>
  preset.nameKey
    ? t(preset.nameKey, { defaultValue: preset.name })
    : preset.name;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringField = (value: unknown) =>
  typeof value === "string" ? value : "";

const headerField = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asObject(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export const validatePiModels = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return "pi.provider.modelsRequired";
  }
  for (const model of value) {
    const item = asObject(model);
    if (!stringField(item.id).trim() || !stringField(item.name).trim()) {
      return "pi.provider.modelIdentityRequired";
    }
    if (
      !Number.isFinite(item.contextWindow) ||
      Number(item.contextWindow) <= 0 ||
      !Number.isFinite(item.maxTokens) ||
      Number(item.maxTokens) <= 0
    ) {
      return "pi.provider.modelLimitsRequired";
    }
    if (typeof item.reasoning !== "boolean" || !Array.isArray(item.input)) {
      return "pi.provider.modelCapabilitiesRequired";
    }
    const map = item.thinkingLevelMap;
    if (
      map !== undefined &&
      (Array.isArray(map) ||
        !map ||
        Object.entries(map as Record<string, unknown>).some(
          ([level, entry]) =>
            ![
              "off",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
            ].includes(level) ||
            (entry !== null && typeof entry !== "string"),
        ))
    ) {
      return "pi.provider.invalidThinkingLevelMap";
    }
  }
  return null;
};

export function mergePiProviderSettings(
  config: Record<string, unknown>,
  fields: {
    name: string;
    baseUrl: string;
    apiKey: string;
    api: string;
    headers: Record<string, string>;
    models: unknown;
  },
  { includeName = true }: { includeName?: boolean } = {},
): Record<string, unknown> {
  const normalizedHeaders = normalizeRequestHeaders(fields.headers);
  const merged: Record<string, unknown> = {
    ...config,
    ...(includeName ? { name: fields.name.trim() } : {}),
    baseUrl: fields.baseUrl.trim(),
    apiKey: fields.apiKey,
    api: fields.api,
    models: fields.models,
  };
  if (Object.keys(normalizedHeaders).length > 0) {
    merged.headers = normalizedHeaders;
  } else {
    delete merged.headers;
  }
  return merged;
}

export function PiProviderForm({
  appId,
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ProviderFormProps) {
  const { t } = useTranslation();
  // Oh My Pi 是 Pi 的分支：同一张表单，预设、文件格式和几处 schema 规则不同
  const isOmp = appId === "omp";
  const presets: readonly PiFamilyPreset[] = isOmp
    ? ompProviderPresets
    : piProviderPresets;
  // 预设交给共用的分组选择器（添加页第 1 步）；id 按预设文件里的位置编，与上游一致
  const presetEntries = useMemo(
    () =>
      presets.map((preset, index) => ({
        id: `pi-${index}`,
        preset,
      })),
    [presets],
  );
  const initialConfig = useMemo(
    () => asObject(initialData?.settingsConfig),
    [initialData?.settingsConfig],
  );
  const [providerKey, setProviderKey] = useState(providerId ?? "");
  const [name, setName] = useState(
    initialData?.name ?? stringField(initialConfig.name),
  );
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initialData?.websiteUrl ?? "");
  const [baseUrl, setBaseUrl] = useState(stringField(initialConfig.baseUrl));
  const [apiKey, setApiKey] = useState(stringField(initialConfig.apiKey));
  const [api, setApi] = useState(
    stringField(initialConfig.api) || "openai-completions",
  );
  const [headers, setHeaders] = useState(() =>
    headerField(initialConfig.headers),
  );
  const [modelsText, setModelsText] = useState(() =>
    JSON.stringify(initialConfig.models ?? [], null, 2),
  );
  const [configText, setConfigText] = useState(() =>
    JSON.stringify(initialConfig, null, 2),
  );
  const [submitting, setSubmitting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PiFamilyPreset | null>(
    null,
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : "custom",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { data: existingProviders } = useProvidersQuery(isOmp ? "omp" : "pi");
  // 预设自带标识；同一家加第二次时会撞上已有的卡，在字段下直接提示（上游 1e2559ef）。
  const isDuplicateProviderKey =
    !initialData &&
    Object.prototype.hasOwnProperty.call(
      existingProviders?.providers ?? {},
      providerKey.trim(),
    );

  const parsedConfig = useMemo(() => {
    try {
      const value = JSON.parse(configText);
      return value && typeof value === "object" && !Array.isArray(value)
        ? asObject(value)
        : null;
    } catch {
      return null;
    }
  }, [configText]);

  const setStructuredConfig = (updates: Record<string, unknown>) => {
    try {
      const current = asObject(JSON.parse(configText || "{}"));
      setConfigText(JSON.stringify({ ...current, ...updates }, null, 2));
    } catch {
      toast.error(t("pi.provider.fixJsonFirst"));
    }
  };

  const selectPreset = (id: string) => {
    setSelectedPresetId(id);
    if (id === "custom") {
      // 自定义：回到空白表单
      setSelectedPreset(null);
      setProviderKey("");
      setName("");
      setWebsiteUrl("");
      setBaseUrl("");
      setApiKey("");
      setApi("openai-completions");
      setHeaders({});
      setModelsText("[]");
      setConfigText("{}");
      return;
    }
    const preset = presetEntries.find((entry) => entry.id === id)?.preset;
    if (!preset) return;
    const config = structuredClone(preset.settingsConfig) as Record<
      string,
      unknown
    >;
    const displayName = getPiPresetDisplayName(preset, t);
    setSelectedPreset(preset);
    setProviderKey(preset.providerKey);
    setName(displayName);
    setWebsiteUrl(preset.websiteUrl ?? "");
    setBaseUrl(stringField(config.baseUrl));
    setApiKey(stringField(config.apiKey));
    setApi(stringField(config.api));
    setHeaders(headerField(config.headers));
    setModelsText(JSON.stringify(config.models ?? [], null, 2));
    setConfigText(JSON.stringify(config, null, 2));
  };

  const updateFromJson = (value: string) => {
    setConfigText(value);
    try {
      const config = asObject(JSON.parse(value));
      // omp 的 models.yml 节点没有 name，显示名只存在 CC Switch 里
      if (!isOmp) setName(stringField(config.name) || name);
      setBaseUrl(stringField(config.baseUrl));
      setApiKey(stringField(config.apiKey));
      setApi(stringField(config.api) || "openai-completions");
      setHeaders(headerField(config.headers));
      setModelsText(JSON.stringify(config.models ?? [], null, 2));
    } catch {
      // 编辑中的无效 JSON 保留到提交校验，不打断输入。
    }
  };

  // omp：编辑框按 models.yml 里 `providers.<标识>` 的位置显示 YAML，
  // 表单内部仍以 JSON 的配置文本为准，读通的 YAML 经 updateFromJson 同步回来。
  const ompKey = providerKey.trim() || "custom";
  const [ompText, setOmpText] = useState("");
  const [ompError, setOmpError] = useState<YamlNodeError | null>(null);
  const ompEmittedRef = useRef<{ json: string; key: string } | null>(null);
  useEffect(() => {
    if (!isOmp) return;
    const emitted = ompEmittedRef.current;
    if (emitted?.json === configText && emitted.key === ompKey) return;
    let config: Record<string, unknown>;
    try {
      const value = JSON.parse(configText || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      config = value as Record<string, unknown>;
    } catch {
      return;
    }
    ompEmittedRef.current = { json: configText, key: ompKey };
    setOmpText(yamlNodeToText(OMP_SECTION, ompKey, config));
    setOmpError(null);
  }, [isOmp, ompKey, configText]);
  const ompErrorMessage = !ompError
    ? null
    : ompError.kind === "syntax"
      ? t("providerForm.nativeConfig.invalid", {
          format: "YAML",
          error: ompError.detail,
        })
      : t("providerForm.nativeConfig.scope", {
          section: `${OMP_SECTION}.${ompKey}`,
        });
  const handleOmpTextChange = (text: string) => {
    setOmpText(text);
    const parsed = yamlNodeFromText(text, OMP_SECTION, ompKey);
    if (!parsed.ok) {
      setOmpError(parsed.error);
      return;
    }
    setOmpError(null);
    const json = JSON.stringify(parsed.value, null, 2);
    ompEmittedRef.current = { json, key: ompKey };
    updateFromJson(json);
  };

  // discovery 只改 type，其余子键原样保留；例外是 injectV1：omp 只允许它出现在
  // openai-models-list 上，留着会让整份 models.yml 失效。
  const ompDiscoveryType = stringField(asObject(parsedConfig?.discovery).type);
  const handleOmpDiscoveryChange = (value: string) => {
    // 下拉挂载时 Radix 可能回报一次空串，不能当成「关闭」
    if (!value || !parsedConfig) return;
    const next = { ...parsedConfig };
    const { type: _previous, injectV1, ...extra } = asObject(next.discovery);
    if (value === "openai-models-list" && injectV1 !== undefined) {
      extra.injectV1 = injectV1;
    }
    if (value === OMP_DISCOVERY_OFF) delete next.discovery;
    else next.discovery = { type: value, ...extra };
    setConfigText(JSON.stringify(next, null, 2));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = providerKey.trim();
    if (!key || !/^[A-Za-z0-9._-]+$/.test(key)) {
      toast.error(t("pi.provider.invalidKey"));
      return;
    }
    if (isDuplicateProviderKey) {
      toast.error(t("pi.form.providerKeyDuplicate"));
      document.getElementById("pi-provider-key")?.focus();
      return;
    }
    if (!name.trim()) {
      toast.error(t("providerForm.fillSupplierName"));
      return;
    }

    let config: Record<string, unknown>;
    let models: unknown;
    try {
      config = asObject(JSON.parse(configText || "{}"));
      models = JSON.parse(modelsText);
    } catch {
      toast.error(t("pi.provider.invalidJson"));
      return;
    }
    // 编辑框里没读通的 YAML 不能按上一次读通的内容悄悄保存
    if (isOmp && ompErrorMessage) {
      toast.error(ompErrorMessage);
      return;
    }
    // omp 开了模型自动发现时可以不写 models；thinkingLevelMap 是 Pi 独有的字段
    const discoveryEnabled = isOmp && Boolean(asObject(config.discovery).type);
    if (isOmp && Array.isArray(models)) {
      models = models.map((model) => {
        const { thinkingLevelMap: _piOnly, ...rest } = asObject(model);
        return rest;
      });
    }
    const modelsError =
      discoveryEnabled && Array.isArray(models) && models.length === 0
        ? null
        : validatePiModels(models);
    if (modelsError) {
      toast.error(t(modelsError));
      return;
    }

    const settingsConfig = mergePiProviderSettings(
      config,
      {
        name,
        baseUrl,
        apiKey,
        api,
        headers,
        models,
      },
      { includeName: !isOmp },
    );

    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const values: ProviderFormValues = {
        name: name.trim(),
        notes: notes.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        settingsConfig: JSON.stringify(settingsConfig),
        // 无图标时留空，由列表按应用默认图标兜底，避免预设 logo 被固定写成 "pi"。
        icon: initialData?.icon || selectedPreset?.icon || "",
        iconColor: initialData?.iconColor || selectedPreset?.iconColor || "",
        providerKey: key,
        presetCategory: (initialData?.category ??
          selectedPreset?.category ??
          "custom") as ProviderCategory,
        meta: initialData?.meta,
      };
      await onSubmit(values);
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  return (
    <form id="provider-form" onSubmit={handleSubmit} className="space-y-5 pb-6">
      {!initialData && (
        <ProviderPresetSelector
          selectedPresetId={selectedPresetId}
          presetEntries={presetEntries}
          onPresetChange={selectPreset}
          category={selectedPreset?.category ?? "custom"}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pi-provider-key" className={REQUIRED_LABEL}>
            {t("pi.provider.key")}
          </Label>
          <ImeSafeInput
            id="pi-provider-key"
            value={providerKey}
            onValueChange={setProviderKey}
            disabled={Boolean(initialData)}
            aria-invalid={isDuplicateProviderKey || undefined}
            aria-describedby={
              isDuplicateProviderKey ? "pi-provider-key-duplicate" : undefined
            }
          />
          {isDuplicateProviderKey && (
            <p
              id="pi-provider-key-duplicate"
              role="alert"
              className="text-xs text-destructive"
            >
              {t("pi.form.providerKeyDuplicate")}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="pi-provider-name" className={REQUIRED_LABEL}>
            {t("provider.name")}
          </Label>
          <ImeSafeInput
            id="pi-provider-name"
            value={name}
            onValueChange={(value) => {
              setName(value);
              if (!isOmp) setStructuredConfig({ name: value });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pi-provider-url">{t("pi.provider.baseUrl")}</Label>
          <ImeSafeInput
            id="pi-provider-url"
            value={baseUrl}
            onValueChange={(value) => {
              setBaseUrl(value);
              setStructuredConfig({ baseUrl: value });
            }}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pi-provider-api-key">{t("pi.provider.apiKey")}</Label>
          <ImeSafeInput
            id="pi-provider-api-key"
            type="password"
            value={apiKey}
            onValueChange={(value) => {
              setApiKey(value);
              setStructuredConfig({ apiKey: value });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("pi.provider.api")}</Label>
          <Select
            value={api}
            onValueChange={(value) => {
              setApi(value);
              setStructuredConfig({ api: value });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PI_API_FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {format}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pi-provider-website">
            {t("provider.websiteUrl")}
          </Label>
          <ImeSafeInput
            id="pi-provider-website"
            value={websiteUrl}
            onValueChange={setWebsiteUrl}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pi-provider-notes">{t("provider.notes")}</Label>
        <ImeSafeInput
          id="pi-provider-notes"
          value={notes}
          onValueChange={setNotes}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("pi.provider.models")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("pi.provider.modelsHint")}
        </p>
        <PiModelsEditor
          value={modelsText}
          locked={!parsedConfig}
          apiKey={apiKey}
          headers={headers}
          protocol={{
            api,
            baseUrl,
            providerId: providerKey,
            compat: asObject(parsedConfig?.compat),
          }}
          onChange={(value) => {
            if (!parsedConfig) return;
            setModelsText(value);
            try {
              setConfigText(
                JSON.stringify(
                  { ...parsedConfig, models: JSON.parse(value) },
                  null,
                  2,
                ),
              );
            } catch {
              /* 草稿保留到提交校验 */
            }
          }}
        />
      </div>

      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="rounded-lg border border-border-default p-4"
      >
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant={null}
            size="sm"
            className="h-8 w-full justify-start gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
          >
            {advancedOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {t("providerForm.advancedOptionsToggle")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <RequestHeadersEditor
            headers={headers}
            onHeadersChange={(value) => {
              setHeaders(value);
              setStructuredConfig({ headers: normalizeRequestHeaders(value) });
            }}
          />

          {isOmp && (
            <div className="space-y-2">
              <Label htmlFor="omp-discovery-type">
                {t("omp.form.discoveryType")}
              </Label>
              <Select
                value={ompDiscoveryType || OMP_DISCOVERY_OFF}
                onValueChange={handleOmpDiscoveryChange}
                disabled={!parsedConfig}
              >
                <SelectTrigger id="omp-discovery-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OMP_DISCOVERY_OFF}>
                    {t("omp.form.discoveryOff")}
                  </SelectItem>
                  {OMP_DISCOVERY_TYPES.map(({ value, labelKey }) => (
                    <SelectItem key={value} value={value}>
                      {t(`omp.form.discoveryTypes.${labelKey}`)}
                    </SelectItem>
                  ))}
                  {ompDiscoveryType &&
                    !OMP_DISCOVERY_TYPES.some(
                      ({ value }) => value === ompDiscoveryType,
                    ) && (
                      <SelectItem value={ompDiscoveryType}>
                        {ompDiscoveryType}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("omp.form.discoveryHint")}
              </p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {isOmp ? (
        <NativeConfigEditor
          appId="omp"
          file="models.yml"
          id="pi-settings-config"
          value={ompText}
          onChange={handleOmpTextChange}
          error={ompErrorMessage}
        />
      ) : (
        <div className="space-y-2">
          <Label>{t("pi.provider.rawJson")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("pi.provider.rawJsonHint")}
          </p>
          <JsonEditor value={configText} onChange={updateFromJson} rows={14} />
        </div>
      )}

      {showButtons && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
