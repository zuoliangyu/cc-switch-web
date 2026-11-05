import { useProviderEditorConflict } from "@/hooks/useProviderEditorConflict";
import { useProviderEditorView } from "@/hooks/useProviderEditorView";
import type { ProviderEditorSave } from "@/lib/api/providers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Provider, CustomEndpoint, UniversalProvider } from "@/types";
import type { AppId } from "@/lib/api";
import { universalProvidersApi } from "@/lib/api";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import {
  PresetStepContext,
  type PresetStepState,
} from "@/components/providers/forms/presetStep";
import { UniversalProviderFormModal } from "@/components/universal/UniversalProviderFormModal";
import { UniversalProviderPanel } from "@/components/universal";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";
import { extractGrokBuildBaseUrl } from "@/utils/grokBuildConfig";
import { GROKBUILD_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import type { UniversalProviderPreset } from "@/config/universalProviderPresets";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onSubmit: (
    provider: Omit<Provider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
      addToLive?: boolean;
      ensureGrokBuildOfficialSeed?: boolean;
      ensureCodexOfficialSeed?: boolean;
      editorSave?: ProviderEditorSave;
    },
  ) => Promise<void> | void;
}

export function AddProviderDialog({
  open,
  onOpenChange,
  appId,
  onSubmit,
}: AddProviderDialogProps) {
  const { t } = useTranslation();
  const editorConflict = useProviderEditorConflict(open, appId);
  const providerEditor = useProviderEditorView(
    open &&
      (appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild"),
    {},
    "add",
    appId === "codex"
      ? "codex"
      : appId === "grokbuild"
        ? "grokbuild"
        : appId === "gemini"
          ? "gemini"
          : "claude",
  );
  const editorReady =
    (appId !== "claude" &&
      appId !== "codex" &&
      appId !== "gemini" &&
      appId !== "grokbuild") ||
    !!providerEditor.view;
  // 累加模式应用、Pi、Grok Build 与 Claude Desktop 不支持统一供应商投影。
  const showUniversal =
    appId !== "opencode" &&
    appId !== "openclaw" &&
    appId !== "hermes" &&
    appId !== "pi" &&
    appId !== "omp" &&
    appId !== "mcode" &&
    appId !== "dsh" &&
    appId !== "kimi" &&
    appId !== "grokbuild" &&
    appId !== "claude-desktop";
  // 两步：先选预设，再填写（每次打开都从第 1 步开始）
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [pickerHost, setPickerHost] = useState<HTMLDivElement | null>(null);
  const [manageUniversalOpen, setManageUniversalOpen] = useState(false);
  useEffect(() => {
    if (open) setStep("pick");
  }, [open, appId]);
  const selectorCount = useRef(0);
  const registerSelector = useCallback(() => {
    selectorCount.current += 1;
    return () => {
      selectorCount.current -= 1;
    };
  }, []);
  const stepState = useMemo<PresetStepState>(
    () => ({ appId, step, setStep, host: pickerHost, registerSelector }),
    [appId, step, pickerHost, registerSelector],
  );
  const [universalFormOpen, setUniversalFormOpen] = useState(false);
  const [selectedUniversalPreset, setSelectedUniversalPreset] =
    useState<UniversalProviderPreset | null>(null);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  // Kimi 的官方账号预设在表单里直接登录，没有「添加」这一步，底栏只留取消
  const [accountLogin, setAccountLogin] = useState(false);
  useEffect(() => {
    if (open) setAccountLogin(false);
  }, [open, appId]);

  const handleUniversalProviderSave = useCallback(
    async (provider: UniversalProvider) => {
      try {
        await universalProvidersApi.upsert(provider);
        toast.success(
          t("universalProvider.addSuccess", {
            defaultValue: "统一供应商添加成功",
          }),
        );
        setUniversalFormOpen(false);
        setSelectedUniversalPreset(null);
        onOpenChange(false);
      } catch (error) {
        console.error(
          "[AddProviderDialog] Failed to save universal provider",
          error,
        );
        toast.error(
          t("universalProvider.addFailed", {
            defaultValue: "统一供应商添加失败",
          }),
        );
      }
    },
    [t, onOpenChange],
  );

  const handleUniversalFormClose = useCallback(() => {
    setUniversalFormOpen(false);
    setSelectedUniversalPreset(null);
  }, []);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      const parsedConfig = JSON.parse(values.settingsConfig) as Record<
        string,
        unknown
      >;

      // 构造基础提交数据
      const providerData: Omit<Provider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
        addToLive?: boolean;
        ensureGrokBuildOfficialSeed?: boolean;
        ensureCodexOfficialSeed?: boolean;
        editorSave?: ProviderEditorSave;
      } = {
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        ...(values.presetCategory ? { category: values.presetCategory } : {}),
        ...(values.meta ? { meta: values.meta } : {}),
      };

      if (
        appId === "grokbuild" &&
        values.presetCategory === "official" &&
        values.presetId === GROKBUILD_OFFICIAL_PROVIDER_ID
      ) {
        providerData.ensureGrokBuildOfficialSeed = true;
      }

      if (
        appId === "codex" &&
        values.presetCategory === "official" &&
        values.presetId === "codex-0"
      ) {
        providerData.ensureCodexOfficialSeed = true;
      }

      // 累加模式应用：传递 providerKey 作为 Provider ID
      if (
        (appId === "opencode" ||
          appId === "openclaw" ||
          appId === "hermes" ||
          appId === "pi" ||
          appId === "omp" ||
          appId === "mcode" ||
          appId === "kimi" ||
          appId === "dsh") &&
        values.providerKey
      ) {
        providerData.providerKey = values.providerKey;
      }

      const hasCustomEndpoints =
        providerData.meta?.custom_endpoints &&
        Object.keys(providerData.meta.custom_endpoints).length > 0;

      if (!hasCustomEndpoints && values.presetCategory !== "omo") {
        const urlSet = new Set<string>();

        const addUrl = (rawUrl?: string) => {
          const url = (rawUrl || "").trim().replace(/\/+$/, "");
          if (url && url.startsWith("http")) {
            urlSet.add(url);
          }
        };

        if (values.presetId) {
          if (appId === "claude") {
            const presets = providerPresets;
            const presetIndex = parseInt(
              values.presetId.replace("claude-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (preset?.endpointCandidates) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "codex") {
            const presets = codexProviderPresets;
            const presetIndex = parseInt(values.presetId.replace("codex-", ""));
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "gemini") {
            const presets = geminiProviderPresets;
            const presetIndex = parseInt(
              values.presetId.replace("gemini-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "grokbuild") {
            const presetIndex = parseInt(
              values.presetId.replace("grokbuild-", ""),
            );
            const preset = grokBuildProviderPresets[presetIndex];
            preset?.endpointCandidates?.forEach(addUrl);
          }
        }

        if (appId === "claude") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.ANTHROPIC_BASE_URL) {
            addUrl(env.ANTHROPIC_BASE_URL);
          }
        } else if (appId === "codex") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            const extractedBaseUrl = extractCodexBaseUrl(config);
            if (extractedBaseUrl) {
              addUrl(extractedBaseUrl);
            }
          }
        } else if (appId === "gemini") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.GOOGLE_GEMINI_BASE_URL) {
            addUrl(env.GOOGLE_GEMINI_BASE_URL);
          }
        } else if (appId === "grokbuild") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            addUrl(extractGrokBuildBaseUrl(config));
          }
        } else if (appId === "opencode") {
          const options = parsedConfig.options as
            | Record<string, any>
            | undefined;
          if (options?.baseURL) {
            addUrl(options.baseURL);
          }
        } else if (appId === "openclaw") {
          // OpenClaw uses baseUrl directly
          if (parsedConfig.baseUrl) {
            addUrl(parsedConfig.baseUrl as string);
          }
        } else if (appId === "hermes") {
          if (parsedConfig.base_url) {
            addUrl(parsedConfig.base_url as string);
          }
        }

        const urls = Array.from(urlSet);
        if (urls.length > 0) {
          const now = Date.now();
          const customEndpoints: Record<string, CustomEndpoint> = {};
          urls.forEach((url) => {
            customEndpoints[url] = {
              url,
              addedAt: now,
              lastUsed: undefined,
            };
          });

          providerData.meta = {
            ...(providerData.meta ?? {}),
            custom_endpoints: customEndpoints,
          };
        }
      }

      // OpenClaw: pass suggestedDefaults for model registration
      if (appId === "openclaw" && values.suggestedDefaults) {
        providerData.suggestedDefaults = values.suggestedDefaults;
      }

      if (
        appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild"
      ) {
        if (!providerEditor.view) return;
        providerData.editorSave = {
          base: providerEditor.view.settings,
          onConflict: "refuse",
        };
      }
      const saved = await editorConflict.run((policy) =>
        onSubmit({
          ...providerData,
          ...(providerData.editorSave
            ? { editorSave: { ...providerData.editorSave, onConflict: policy } }
            : {}),
        }),
      );
      if (saved) onOpenChange(false);
    },
    [appId, onSubmit, onOpenChange, providerEditor.view, editorConflict.run],
  );

  // 表单已经挂上、却没有预设选择器（没有预设可选的表单）：直接进第 2 步。
  // 子组件的 effect 先于这里执行，选择器在同一次提交里已经登记过了。
  useEffect(() => {
    if (open && editorReady && selectorCount.current === 0) {
      setStep("form");
    }
  }, [open, editorReady, appId]);

  const handlePanelClose = useCallback(() => {
    // 第 2 步的返回回到选预设
    if (step === "form") {
      setStep("pick");
      return;
    }
    onOpenChange(false);
  }, [onOpenChange, step]);

  const footer =
    step === "form" ? (
      <>
        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
          {t("provider.addFooterHint")}
        </span>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="border-border/20 hover:bg-accent hover:text-accent-foreground"
        >
          {t("common.cancel")}
        </Button>
        {!accountLogin && (
          <Button
            type="submit"
            form="provider-form"
            disabled={isFormSubmitting || !editorReady}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("common.add")}
          </Button>
        )}
      </>
    ) : null;

  return (
    <>
      {editorConflict.dialog}
      <FullScreenPanel
        isOpen={open}
        trackUnsavedChanges={step === "form" && !accountLogin}
        title={t("provider.addNewProvider")}
        backLabel={
          step === "form"
            ? t("providerPreset.backToPick")
            : t("provider.backToList")
        }
        onClose={handlePanelClose}
        footer={footer}
        contentClassName={
          step === "pick" ? "flex h-full flex-col space-y-0 p-0 sm:p-0" : "pt-3"
        }
      >
        <PresetStepContext.Provider value={stepState}>
          {step === "pick" && (
            <div ref={setPickerHost} className="min-h-0 flex-1" />
          )}
          <div className={step === "pick" ? "hidden" : undefined}>
            {!editorReady ? (
              <div role="status">
                {providerEditor.error
                  ? t("claudeConfig.editorLoadFailed")
                  : t("common.loading")}
                {providerEditor.error && (
                  <Button onClick={providerEditor.retry}>
                    {t("common.retry")}
                  </Button>
                )}
              </div>
            ) : (
              <ProviderForm
                providerLiveBase={providerEditor.view?.settings}
                appId={appId}
                submitLabel={t("common.add")}
                onSubmit={handleSubmit}
                onCancel={() => onOpenChange(false)}
                onSubmittingChange={setIsFormSubmitting}
                onAccountLoginChange={setAccountLogin}
                showButtons={false}
                onUniversalPresetSelect={
                  showUniversal
                    ? (preset) => {
                        setSelectedUniversalPreset(preset);
                        setUniversalFormOpen(true);
                      }
                    : undefined
                }
                onManageUniversalProviders={
                  showUniversal ? () => setManageUniversalOpen(true) : undefined
                }
              />
            )}
          </div>
        </PresetStepContext.Provider>

        {showUniversal && (
          <UniversalProviderFormModal
            isOpen={universalFormOpen}
            onClose={handleUniversalFormClose}
            onSave={handleUniversalProviderSave}
            initialPreset={selectedUniversalPreset}
          />
        )}

        {showUniversal && (
          <FullScreenPanel
            isOpen={manageUniversalOpen}
            title={t("universalProvider.manage")}
            onClose={() => setManageUniversalOpen(false)}
          >
            <UniversalProviderPanel />
          </FullScreenPanel>
        )}
      </FullScreenPanel>
    </>
  );
}
