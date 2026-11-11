import { useProviderEditorConflict } from "@/hooks/useProviderEditorConflict";
import { useProviderEditorView } from "@/hooks/useProviderEditorView";
import type { ProviderEditorSave } from "@/lib/api/providers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { AuthSettingsPanel } from "@/components/providers/AuthSettingsPanel";
import type { AuthCenterTarget } from "@/lib/api";
import type { Provider } from "@/types";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import {
  openclawApi,
  providerRuntimeApi,
  providersApi,
  type AppId,
} from "@/lib/api";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import type { ModeView } from "@/components/providers/presentation";

interface EditProviderDialogProps {
  open: boolean;
  provider: Provider | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    provider: Provider;
    originalId?: string;
    editorSave?: ProviderEditorSave;
  }) => Promise<void> | void;
  appId: AppId;
  isProxyTakeover?: boolean; // 代理接管模式下不读取 live（避免显示被接管后的代理配置）
  /** 从供应商页哪一格打开的，见 ProviderForm 的同名参数 */
  modeView?: ModeView;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function EditProviderDialog({
  open,
  provider,
  onOpenChange,
  onSubmit,
  appId,
  isProxyTakeover = false,
  modeView,
}: EditProviderDialogProps) {
  const { t } = useTranslation();
  // 表单用了聚合的简化布局：页头标「聚合模式」
  const [stackLayout, setStackLayout] = useState(false);
  const editorConflict = useProviderEditorConflict(open, `${appId}:${provider?.id ?? ""}`);
  const providerEditor = useProviderEditorView(
    open &&
      (appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild") &&
      !!provider,
    provider?.settingsConfig ?? {},
    provider?.id ?? "",
    appId === "codex"
      ? "codex"
      : appId === "grokbuild"
        ? "grokbuild"
        : appId === "gemini"
          ? "gemini"
          : "claude",
    provider?.category,
  );
  const editorReady =
    (appId !== "claude" &&
      appId !== "codex" &&
      appId !== "gemini" &&
      appId !== "grokbuild") ||
    !!providerEditor.view;
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  // 表单里「添加或管理账号」打开的授权中心（盖在表单上，关掉回到表单）
  const [authSettingsTarget, setAuthSettingsTarget] =
    useState<AuthCenterTarget | null>(null);
  useEffect(() => {
    setAuthSettingsTarget(null);
  }, [appId, open, provider?.id]);
  const handlePanelClose = useCallback(() => {
    if (authSettingsTarget) {
      setAuthSettingsTarget(null);
      return;
    }
    onOpenChange(false);
  }, [authSettingsTarget, onOpenChange]);

  // 默认使用传入的 provider.settingsConfig，若当前编辑对象是"当前生效供应商"，则尝试读取实时配置替换初始值
  const [liveSettings, setLiveSettings] = useState<Record<
    string,
    unknown
  > | null>(null);

  // 使用 ref 标记是否已经加载过，防止重复读取覆盖用户编辑
  const [hasLoadedLive, setHasLoadedLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!open || !provider) {
        setLiveSettings(null);
        setHasLoadedLive(false);
        return;
      }

      if (
        appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild"
      )
        return;

      // 关键修复：只在首次打开时加载一次
      if (hasLoadedLive) {
        return;
      }

      // 代理接管模式：Live 配置已被代理改写，读取 live 会导致编辑界面展示代理地址/占位符等内容
      // 因此直接回退到 SSOT（数据库）配置，避免用户困惑与误保存
      if (isProxyTakeover) {
        if (!cancelled) {
          setLiveSettings(null);
          setHasLoadedLive(true);
        }
        return;
      }

      // OpenCode uses additive mode - each provider's config is stored independently in DB
      // Reading live config would return the full opencode.json (with $schema, provider, mcp etc.)
      // instead of just the provider fragment, causing incorrect nested structure on save.
      // MiniMax Code's, Kimi Code's and Oh My Pi's native configs are owned by
      // their catalog coordinators as well.
      if (
        appId === "opencode" ||
        appId === "mcode" ||
        appId === "kimi" ||
        appId === "dsh" ||
        appId === "omp" ||
        appId === "copilot"
      ) {
        if (!cancelled) {
          setLiveSettings(null);
          setHasLoadedLive(true);
        }
        return;
      }

      if (appId === "openclaw") {
        try {
          const live = await openclawApi.getLiveProvider(provider.id);
          if (!cancelled && live && typeof live === "object") {
            setLiveSettings(live);
          } else if (!cancelled) {
            setLiveSettings(null);
          }
        } catch {
          if (!cancelled) {
            setLiveSettings(null);
          }
        } finally {
          if (!cancelled) {
            setHasLoadedLive(true);
          }
        }
        return;
      }

      try {
        const currentId = await providersApi.getCurrent(appId);
        if (currentId && provider.id === currentId) {
          try {
            const live = (await providerRuntimeApi.getLiveProviderSettings(
              appId,
            )) as Record<string, unknown>;
            if (!cancelled && live && typeof live === "object") {
              setLiveSettings(live);
              setHasLoadedLive(true);
            }
          } catch {
            // 读取实时配置失败则回退到 SSOT（不打断编辑流程）
            if (!cancelled) {
              setLiveSettings(null);
              setHasLoadedLive(true);
            }
          }
        } else {
          if (!cancelled) {
            setLiveSettings(null);
            setHasLoadedLive(true);
          }
        }
      } finally {
        // no-op
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, provider?.id, appId, hasLoadedLive, isProxyTakeover]); // 只依赖 provider.id，不依赖整个 provider 对象

  const initialSettingsConfig = useMemo(() => {
    if (
      (appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild") &&
      providerEditor.view
    )
      return providerEditor.view.settings;
    const storedSettings = asRecord(provider?.settingsConfig);
    return (liveSettings ?? storedSettings ?? {}) as Record<string, unknown>;
  }, [liveSettings, provider?.settingsConfig, appId, providerEditor.view]); // 只依赖表单初始化所需字段，不依赖整个 provider

  // 固定 initialData，防止 provider 对象更新时重置表单
  const initialData = useMemo(() => {
    if (!provider) return null;
    return {
      name: provider.name,
      notes: provider.notes,
      websiteUrl: provider.websiteUrl,
      settingsConfig: initialSettingsConfig,
      category: provider.category,
      meta: provider.meta,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };
  }, [
    open, // 修复：编辑保存后再次打开显示旧数据，依赖 open 确保每次打开时重新读取最新 provider 数据
    provider?.id, // 只依赖 ID，provider 对象更新不会触发重新计算
    provider?.meta, // 需要依赖 meta 以便正确初始化 testConfig 和 proxyConfig
    initialSettingsConfig,
  ]);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      if (!provider) return;

      // 注意：values.settingsConfig 已经是最终的配置字符串
      // ProviderForm 已经为不同的 app 类型（Claude/Codex/Gemini/Grok Build）正确组装了配置
      const parsedConfig = JSON.parse(values.settingsConfig) as Record<
        string,
        unknown
      >;
      const nextProviderId =
        (appId === "opencode" || appId === "openclaw" || appId === "pi") &&
        values.providerKey?.trim()
          ? values.providerKey.trim()
          : provider.id;

      const updatedProvider: Provider = {
        ...provider,
        id: nextProviderId,
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        ...(values.presetCategory ? { category: values.presetCategory } : {}),
        // 保留或更新 meta 字段
        ...(values.meta ? { meta: values.meta } : {}),
      };

      if (
        (appId === "claude" ||
          appId === "codex" ||
          appId === "gemini" ||
          appId === "grokbuild") &&
        !providerEditor.view
      )
        return;
      const saved = await editorConflict.run((policy) =>
        onSubmit({
          ...((appId === "claude" ||
            appId === "codex" ||
            appId === "gemini" ||
            appId === "grokbuild") &&
          providerEditor.view
            ? {
                editorSave: {
                  base: providerEditor.view.settings,
                  onConflict: policy,
                },
              }
            : {}),
          provider: updatedProvider,
          originalId: provider.id,
        }),
      );
      if (saved) onOpenChange(false);
    },
    [
      appId,
      onSubmit,
      onOpenChange,
      provider,
      providerEditor.view,
      editorConflict.run,
    ],
  );

  if (!provider || !initialData) {
    return null;
  }

  return (
    <>
      {editorConflict.dialog}
      <FullScreenPanel
        // 首份编辑视图到了再打开：本地读取很快，先显示加载页会闪一下；加载失败仍打开，
        // 让用户看到原因并重试
        isOpen={open && (editorReady || !!providerEditor.error)}
        trackUnsavedChanges
        title={t("provider.editProvider")}
        subtitle={
          stackLayout
            ? t("provider.formSubtitleStack", { app: APP_DISPLAY_NAME[appId] })
            : undefined
        }
        onClose={handlePanelClose}
        footer={
          <Button
            type="submit"
            form="provider-form"
            disabled={isFormSubmitting || !editorReady}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4 mr-2" />
            {t("common.save")}
          </Button>
        }
      >
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
          <>
            {(appId === "claude" ||
              appId === "codex" ||
              appId === "gemini" ||
              appId === "grokbuild") &&
              !!providerEditor.view?.inactive.length && (
                <p className="text-sm text-muted-foreground">
                  {t("claudeConfig.inactiveFields")}:{" "}
                  {providerEditor.view.inactive
                    .map((field) => field.path.join("."))
                    .join(", ")}
                </p>
              )}
            <ProviderForm
              appId={appId}
              providerId={provider.id}
              submitLabel={t("common.save")}
              modeView={modeView}
              onStackLayoutChange={setStackLayout}
              onSubmit={handleSubmit}
              onCancel={() => onOpenChange(false)}
              onSubmittingChange={setIsFormSubmitting}
              initialData={initialData}
              showButtons={false}
              onManageAuthAccounts={setAuthSettingsTarget}
            />
          </>
        )}

      </FullScreenPanel>
      {/* 放在表单面板外面：授权中心里的开关、下拉（含渲染到 body 的选项）不沿组件树冒泡到
          表单的未保存登记；两个面板都渲染到 body，后打开的在上，Esc 按打开顺序先关它 */}
      <AuthSettingsPanel
        target={authSettingsTarget}
        onClose={() => setAuthSettingsTarget(null)}
      />
    </>
  );
}
