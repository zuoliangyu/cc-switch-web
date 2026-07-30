import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import JsonEditor from "@/components/JsonEditor";
import { Button } from "@/components/ui/button";
import { Form, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import type { ProviderCategory, ProviderMeta } from "@/types";
import {
  grokBuildOfficialPreset,
  grokBuildProviderPresets,
  type GrokBuildProviderPreset,
} from "@/config/grokBuildProviderPresets";
import {
  buildGrokBuildConfig,
  parseGrokBuildConfig,
  updateGrokBuildConfig,
  validateGrokBuildConfig,
  type GrokBuildConfigValues,
} from "@/utils/grokBuildConfig";
import {
  extractCodexBaseUrl,
  extractCodexModelName,
} from "@/utils/providerConfigUtils";
import { GROKBUILD_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";
import { BasicFormFields } from "./BasicFormFields";
import { CustomUserAgentField } from "./CustomUserAgentField";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";

type GrokBuildProviderFormProps = Omit<ProviderFormProps, "appId">;

const grokPresetEntries: Array<{
  id: string;
  preset: GrokBuildProviderPreset;
}> = [
  { id: GROKBUILD_OFFICIAL_PROVIDER_ID, preset: grokBuildOfficialPreset },
  ...grokBuildProviderPresets.map((preset, index) => ({
    id: `grokbuild-${index}`,
    preset,
  })),
];

const apiFormatForBackend = (apiBackend: string): ProviderMeta["apiFormat"] => {
  if (apiBackend === "chat_completions") return "openai_chat";
  if (apiBackend === "messages") return "anthropic";
  return "openai_responses";
};

export function GrokBuildProviderForm({
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: GrokBuildProviderFormProps) {
  const { t } = useTranslation();
  const initialConfigText =
    typeof initialData?.settingsConfig?.config === "string"
      ? initialData.settingsConfig.config
      : undefined;
  const initialConfig = useMemo(
    () => parseGrokBuildConfig(initialConfigText, initialData?.name),
    [initialConfigText, initialData?.name],
  );

  const [profile, setProfile] = useState(initialConfig.model);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : "custom",
  );
  const [category, setCategory] = useState<ProviderCategory>(
    initialData?.category ?? "custom",
  );
  const [isPartner, setIsPartner] = useState(
    initialData?.meta?.isPartner ?? false,
  );
  const [partnerPromotionKey, setPartnerPromotionKey] = useState<string>();
  const [upstreamModel, setUpstreamModel] = useState(
    initialConfig.upstreamModel ?? initialConfig.model,
  );
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [apiKey, setApiKey] = useState(initialConfig.apiKey);
  const [apiBackend, setApiBackend] = useState(initialConfig.apiBackend);
  const [contextWindow, setContextWindow] = useState(
    String(initialConfig.contextWindow),
  );
  const [rawConfig, setRawConfig] = useState(
    initialConfigText ?? buildGrokBuildConfig(initialConfig),
  );
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [customUserAgent, setCustomUserAgent] = useState(
    initialData?.meta?.customUserAgent ?? "",
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      name: initialData?.name ?? initialConfig.name,
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify({ config: rawConfig }),
      icon: initialData?.icon ?? "grok",
      iconColor: initialData?.iconColor ?? "",
    },
    mode: "onSubmit",
  });
  const { isSubmitting } = form.formState;
  const isOfficial = category === "official";

  const presetCategoryLabels = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial"),
      aggregator: t("providerForm.categoryAggregation"),
      third_party: t("providerForm.categoryThirdParty"),
    }),
    [t],
  );

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    const updateTheme = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const syncStructuredConfig = (overrides: Partial<GrokBuildConfigValues>) => {
    setRawConfig((current) =>
      updateGrokBuildConfig(current, {
        model: profile,
        upstreamModel,
        baseUrl,
        name: form.getValues("name") || initialConfig.name,
        apiKey,
        apiBackend,
        contextWindow: Number.parseInt(contextWindow, 10),
        ...overrides,
      }),
    );
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === "custom") {
      setCategory("custom");
      setIsPartner(false);
      setPartnerPromotionKey(undefined);
      return;
    }

    const entry = grokPresetEntries.find((item) => item.id === presetId);
    if (!entry) return;
    const preset = entry.preset;
    const presetName = preset.nameKey ? String(t(preset.nameKey)) : preset.name;
    form.setValue("name", presetName);
    form.setValue("websiteUrl", preset.websiteUrl ?? "");
    form.setValue("icon", preset.icon ?? "grok");
    form.setValue("iconColor", preset.iconColor ?? "");
    setCategory(preset.category ?? "custom");
    setIsPartner(preset.isPartner ?? false);
    setPartnerPromotionKey(preset.partnerPromotionKey);

    if (presetId === GROKBUILD_OFFICIAL_PROVIDER_ID) {
      setRawConfig("");
      return;
    }

    const presetBaseUrl = extractCodexBaseUrl(preset.config) ?? "";
    const presetModel = extractCodexModelName(preset.config) ?? profile;
    const presetApiKey = preset.auth.OPENAI_API_KEY;
    const presetBackend =
      preset.apiFormat === "openai_chat" ? "chat_completions" : "responses";
    setBaseUrl(presetBaseUrl);
    setUpstreamModel(presetModel);
    setApiKey(typeof presetApiKey === "string" ? presetApiKey : "");
    setApiBackend(presetBackend);
    setRawConfig(
      buildGrokBuildConfig({
        model: profile,
        upstreamModel: presetModel,
        baseUrl: presetBaseUrl,
        name: presetName,
        apiKey: typeof presetApiKey === "string" ? presetApiKey : "",
        apiBackend: presetBackend,
        contextWindow: Number.parseInt(contextWindow, 10),
      }),
    );
  };

  const handleRawConfigChange = (value: string) => {
    setRawConfig(value);
    if (validateGrokBuildConfig(value)) return;

    const parsed = parseGrokBuildConfig(value, form.getValues("name"));
    setProfile(parsed.model);
    setUpstreamModel(parsed.upstreamModel ?? parsed.model);
    setBaseUrl(parsed.baseUrl);
    setApiKey(parsed.apiKey);
    setApiBackend(parsed.apiBackend);
    setContextWindow(String(parsed.contextWindow));
    if (parsed.name) form.setValue("name", parsed.name);
  };

  const handleSubmit = async (values: ProviderFormData) => {
    const name = values.name.trim();
    if (!name) {
      toast.error(t("providerForm.fillSupplierName"));
      return;
    }

    if (isOfficial) {
      await onSubmit({
        ...values,
        name,
        websiteUrl: values.websiteUrl?.trim() ?? "",
        notes: values.notes?.trim() ?? "",
        settingsConfig: JSON.stringify({ config: rawConfig }),
        presetId: selectedPresetId ?? undefined,
        presetCategory: "official",
        meta: initialData?.meta
          ? { ...initialData.meta, customUserAgent: undefined }
          : undefined,
      });
      return;
    }

    const parsedContextWindow = Number.parseInt(contextWindow, 10);
    const envKey = parseGrokBuildConfig(rawConfig).envKey?.trim();
    if (
      !baseUrl.trim() ||
      (!apiKey.trim() && !envKey) ||
      !profile.trim() ||
      !upstreamModel.trim()
    ) {
      toast.error(t("providerForm.requiredFields"));
      return;
    }
    if (!Number.isInteger(parsedContextWindow) || parsedContextWindow <= 0) {
      toast.error(t("grokBuild.contextWindowInvalid"));
      return;
    }

    const finalConfig = updateGrokBuildConfig(rawConfig, {
      model: profile,
      upstreamModel,
      baseUrl,
      name,
      apiKey,
      apiBackend,
      contextWindow: parsedContextWindow,
    });
    const configError = validateGrokBuildConfig(finalConfig);
    if (configError) {
      toast.error(t("grokBuild.invalidToml", { error: configError }));
      return;
    }

    const payload: ProviderFormValues = {
      ...values,
      name,
      websiteUrl: values.websiteUrl?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      settingsConfig: JSON.stringify({ config: finalConfig }),
      presetId: selectedPresetId ?? undefined,
      presetCategory: category,
      meta: {
        ...(initialData?.meta ?? {}),
        apiFormat: apiFormatForBackend(apiBackend),
        customUserAgent: customUserAgent.trim() || undefined,
        isPartner,
        partnerPromotionKey,
      },
    };
    await onSubmit(payload);
  };

  const rawConfigError = isOfficial ? null : validateGrokBuildConfig(rawConfig);

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
      >
        {!initialData && (
          <ProviderPresetSelector
            selectedPresetId={selectedPresetId}
            presetEntries={grokPresetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={handlePresetChange}
            category={category}
          />
        )}

        <BasicFormFields form={form} />

        {!isOfficial && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="grokbuild-profile">
                  {t("grokBuild.profile")}
                </FormLabel>
                <Input
                  id="grokbuild-profile"
                  value={profile}
                  onChange={(event) => {
                    setProfile(event.target.value);
                    syncStructuredConfig({ model: event.target.value });
                  }}
                  placeholder="grok-4.5"
                />
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="grokbuild-upstream-model">
                  {t("grokBuild.upstreamModel")}
                </FormLabel>
                <Input
                  id="grokbuild-upstream-model"
                  value={upstreamModel}
                  onChange={(event) => {
                    setUpstreamModel(event.target.value);
                    syncStructuredConfig({
                      upstreamModel: event.target.value,
                    });
                  }}
                  placeholder="grok-4.5"
                />
              </FormItem>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="grokbuild-base-url">
                  {t("grokBuild.baseUrl")}
                </FormLabel>
                <Input
                  id="grokbuild-base-url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    syncStructuredConfig({ baseUrl: event.target.value });
                  }}
                  placeholder="https://api.example.com/v1"
                />
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="grokbuild-api-key">API Key</FormLabel>
                <Input
                  id="grokbuild-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    syncStructuredConfig({ apiKey: event.target.value });
                  }}
                  autoComplete="off"
                />
              </FormItem>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="grokbuild-api-backend">
                  {t("grokBuild.apiBackend")}
                </FormLabel>
                <Select
                  value={apiBackend}
                  onValueChange={(value) => {
                    setApiBackend(value);
                    syncStructuredConfig({ apiBackend: value });
                  }}
                >
                  <SelectTrigger id="grokbuild-api-backend">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="responses">Responses</SelectItem>
                    <SelectItem value="chat_completions">
                      Chat Completions
                    </SelectItem>
                    <SelectItem value="messages">Anthropic Messages</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="grokbuild-context-window">
                  {t("grokBuild.contextWindow")}
                </FormLabel>
                <Input
                  id="grokbuild-context-window"
                  type="number"
                  min={1}
                  step={1}
                  value={contextWindow}
                  onChange={(event) => {
                    setContextWindow(event.target.value);
                    syncStructuredConfig({
                      contextWindow: Number.parseInt(event.target.value, 10),
                    });
                  }}
                />
              </FormItem>
            </div>

            <div className="space-y-2">
              <FormLabel>{t("grokBuild.rawConfig")}</FormLabel>
              <JsonEditor
                value={rawConfig}
                onChange={handleRawConfigChange}
                darkMode={isDarkMode}
                rows={12}
                showValidation={false}
                language="javascript"
              />
              {rawConfigError && (
                <p className="text-xs text-destructive">
                  {t("grokBuild.invalidToml", { error: rawConfigError })}
                </p>
              )}
            </div>

            <CustomUserAgentField
              id="grokbuild-custom-user-agent"
              value={customUserAgent}
              onChange={setCustomUserAgent}
            />
          </>
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
  );
}
