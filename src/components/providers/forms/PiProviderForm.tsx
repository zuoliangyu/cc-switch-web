import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { RequestHeadersEditor } from "./RequestHeadersEditor";
import { normalizeRequestHeaders } from "./helpers/requestHeaders";
import { PI_API_FORMATS, piProviderPresets } from "@/config/piProviderPresets";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";

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
): Record<string, unknown> {
  const normalizedHeaders = normalizeRequestHeaders(fields.headers);
  const merged: Record<string, unknown> = {
    ...config,
    name: fields.name.trim(),
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
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ProviderFormProps) {
  const { t } = useTranslation();
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

  const setStructuredConfig = (updates: Record<string, unknown>) => {
    try {
      const current = asObject(JSON.parse(configText || "{}"));
      setConfigText(JSON.stringify({ ...current, ...updates }, null, 2));
    } catch {
      toast.error(t("pi.provider.fixJsonFirst"));
    }
  };

  const applyPreset = (presetId: string) => {
    const preset = piProviderPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    const config = structuredClone(preset.config);
    setProviderKey(preset.id);
    setName(preset.name);
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
      setName(stringField(config.name) || name);
      setBaseUrl(stringField(config.baseUrl));
      setApiKey(stringField(config.apiKey));
      setApi(stringField(config.api) || "openai-completions");
      setHeaders(headerField(config.headers));
      setModelsText(JSON.stringify(config.models ?? [], null, 2));
    } catch {
      // 编辑中的无效 JSON 保留到提交校验，不打断输入。
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = providerKey.trim();
    if (!key || !/^[A-Za-z0-9._-]+$/.test(key)) {
      toast.error(t("pi.provider.invalidKey"));
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
    const modelsError = validatePiModels(models);
    if (modelsError) {
      toast.error(t(modelsError));
      return;
    }

    const settingsConfig = mergePiProviderSettings(config, {
      name,
      baseUrl,
      apiKey,
      api,
      headers,
      models,
    });

    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const values: ProviderFormValues = {
        name: name.trim(),
        notes: notes.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        settingsConfig: JSON.stringify(settingsConfig),
        icon: initialData?.icon ?? "pi",
        iconColor: initialData?.iconColor,
        providerKey: key,
        presetCategory: initialData?.category ?? "custom",
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
        <div className="space-y-2">
          <Label>{t("pi.provider.preset")}</Label>
          <Select onValueChange={applyPreset}>
            <SelectTrigger>
              <SelectValue placeholder={t("pi.provider.selectPreset")} />
            </SelectTrigger>
            <SelectContent>
              {piProviderPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pi-provider-key">{t("pi.provider.key")}</Label>
          <ImeSafeInput
            id="pi-provider-key"
            value={providerKey}
            onValueChange={setProviderKey}
            disabled={Boolean(initialData)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pi-provider-name">{t("provider.name")}</Label>
          <ImeSafeInput
            id="pi-provider-name"
            value={name}
            onValueChange={(value) => {
              setName(value);
              setStructuredConfig({ name: value });
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

      <RequestHeadersEditor
        headers={headers}
        onHeadersChange={(value) => {
          setHeaders(value);
          setStructuredConfig({ headers: normalizeRequestHeaders(value) });
        }}
      />

      <div className="space-y-2">
        <Label>{t("pi.provider.models")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("pi.provider.modelsHint")}
        </p>
        <JsonEditor value={modelsText} onChange={setModelsText} rows={12} />
      </div>

      <div className="space-y-2">
        <Label>{t("pi.provider.rawJson")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("pi.provider.rawJsonHint")}
        </p>
        <JsonEditor value={configText} onChange={updateFromJson} rows={14} />
      </div>

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
