import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
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
import { extractCodexExperimentalBearerToken } from "@/utils/providerConfigUtils";
import { resolveCodexOfficialIdentity } from "@/utils/providerCapabilities";

interface EditProviderDialogProps {
  open: boolean;
  provider: Provider | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    provider: Provider;
    originalId?: string;
  }) => Promise<void> | void;
  appId: AppId;
  isProxyTakeover?: boolean; // 代理接管模式下不读取 live（避免显示被接管后的代理配置）
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasAuthMaterial = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

/**
 * Whether an auth payload actually carries a credential, ignoring the bare
 * `auth_mode` marker — the frontend twin of the backend
 * `codex_auth_has_login_material`.
 */
const hasCodexAuthMaterial = (auth: Record<string, unknown> | null): boolean =>
  auth !== null &&
  Object.entries(auth).some(
    ([key, value]) => key !== "auth_mode" && hasAuthMaterial(value),
  );

/**
 * Rebuild the provider auth only for a current Codex provider's live snapshot.
 *
 * In official-auth-preservation mode, live config.toml owns the active
 * provider bearer while the shared auth.json may belong to another provider or
 * contain the user's ChatGPT login. Stored provider auth remains the template:
 * this mirrors the backend switch-away backfill and avoids copying shared auth
 * material into the provider row. DB snapshots and presets must keep their
 * normal auth-first precedence.
 */
const reconcileCodexLiveAuth = (
  liveSettings: Record<string, unknown>,
  storedSettings: Record<string, unknown> | null,
  isOfficialProvider: boolean,
): Record<string, unknown> => {
  if (isOfficialProvider) return liveSettings;

  const configText =
    typeof liveSettings.config === "string" ? liveSettings.config : "";
  const bearer = extractCodexExperimentalBearerToken(configText);
  const liveAuth = asRecord(liveSettings.auth);
  const storedAuth = asRecord(storedSettings?.auth);

  if (!bearer) {
    // Live auth.json is a single shared slot with no provider identity, and a
    // third-party Codex route never reads it: the switch deletes the file in
    // default mode and injects the key into config.toml instead — an injection
    // that is skipped entirely when the provider table declares its own
    // credential source (`env_key`, `auth`/`aws`, an explicit Authorization
    // header). A credential-less live auth (missing file, or the bare
    // `auth_mode` logout marker) is therefore an absent field, not an emptied
    // one: keep the stored template so saving the form cannot silently erase
    // the only remaining copy of the provider's key.
    if (!hasCodexAuthMaterial(liveAuth) && hasCodexAuthMaterial(storedAuth)) {
      return { ...liveSettings, auth: storedAuth };
    }
    return liveSettings;
  }

  const authTemplate = storedAuth ?? liveAuth ?? {};
  const hasProviderApiKey =
    typeof authTemplate.OPENAI_API_KEY === "string" &&
    authTemplate.OPENAI_API_KEY.trim().length > 0;
  const hasOauthLogin = Object.entries(authTemplate).some(
    ([key, value]) =>
      key !== "auth_mode" && key !== "OPENAI_API_KEY" && hasAuthMaterial(value),
  );

  // Match should_restore_codex_provider_token_for_backfill: an OAuth-only
  // provider must not be silently converted into an API-key provider.
  if (hasOauthLogin && !hasProviderApiKey) return liveSettings;

  return {
    ...liveSettings,
    auth: {
      ...authTemplate,
      OPENAI_API_KEY: bearer,
    },
  };
};

export function EditProviderDialog({
  open,
  provider,
  onOpenChange,
  onSubmit,
  appId,
  isProxyTakeover = false,
}: EditProviderDialogProps) {
  const { t } = useTranslation();
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);

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
      // MiniMax Code's native config is owned by the catalog coordinator as well.
      if (appId === "opencode" || appId === "mcode") {
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

  // 旧版官方卡片可能没有 category；其 live 登出状态仍拥有 auth（上游 5a80e300）。
  const isCodexOfficialProvider =
    appId === "codex" &&
    provider !== null &&
    (provider.category === "official" ||
      resolveCodexOfficialIdentity(appId, provider) !== null);

  const initialSettingsConfig = useMemo(() => {
    const storedSettings = asRecord(provider?.settingsConfig);
    if (appId === "codex" && liveSettings) {
      return reconcileCodexLiveAuth(
        liveSettings,
        storedSettings,
        isCodexOfficialProvider,
      );
    }
    return (liveSettings ?? storedSettings ?? {}) as Record<string, unknown>;
  }, [liveSettings, provider?.settingsConfig, isCodexOfficialProvider, appId]); // 只依赖表单初始化所需字段，不依赖整个 provider

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

      await onSubmit({
        provider: updatedProvider,
        originalId: provider.id,
      });
      onOpenChange(false);
    },
    [appId, onSubmit, onOpenChange, provider],
  );

  if (!provider || !initialData) {
    return null;
  }

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("provider.editProvider")}
      onClose={() => onOpenChange(false)}
      footer={
        <Button
          type="submit"
          form="provider-form"
          disabled={isFormSubmitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Save className="h-4 w-4 mr-2" />
          {t("common.save")}
        </Button>
      }
    >
      <ProviderForm
        appId={appId}
        providerId={provider.id}
        submitLabel={t("common.save")}
        onSubmit={handleSubmit}
        onCancel={() => onOpenChange(false)}
        onSubmittingChange={setIsFormSubmitting}
        initialData={initialData}
        showButtons={false}
      />
    </FullScreenPanel>
  );
}
