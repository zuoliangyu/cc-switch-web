import type { ProviderEditorSave } from "@/lib/api/providers";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { piApi } from "@/lib/api/pi";
import { providersApi, settingsApi, openclawApi, type AppId } from "@/lib/api";
import type {
  Provider,
  UsageScript,
  OpenClawProviderConfig,
  OpenClawDefaultModel,
} from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import {
  useAddProviderMutation,
  useUpdateProviderMutation,
  useDeleteProviderMutation,
  useSwitchProviderMutation,
} from "@/lib/query";
import { extractErrorMessage } from "@/utils/errorUtils";
import { routeSwitchNotification } from "@/utils/routeSwitchNotification";
import { injectCodingPlanUsageScript } from "@/config/codingPlanProviders";
import { openclawKeys } from "@/hooks/useOpenClaw";
import { getRoutingReason } from "@/utils/routingReason";
import { supportsOfficialProxyTakeover } from "@/utils/providerCapabilities";

/**
 * Hook for managing provider actions (add, update, delete, switch)
 * Extracts business logic from App.tsx
 */
export function useProviderActions(
  activeApp: AppId,
  isProxyRunning?: boolean,
  isProxyTakeover?: boolean,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const addProviderMutation = useAddProviderMutation(activeApp);
  const updateProviderMutation = useUpdateProviderMutation(activeApp);
  const deleteProviderMutation = useDeleteProviderMutation(activeApp);
  const switchProviderMutation = useSwitchProviderMutation(activeApp);

  const syncClaudePlugin = useCallback(
    async (provider: Provider) => {
      if (activeApp !== "claude") return;

      try {
        const settings = await settingsApi.get();
        if (!settings?.enableClaudePluginIntegration) {
          return;
        }

        const isOfficial = provider.category === "official";
        await settingsApi.applyClaudePluginConfig({ official: isOfficial });
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("notifications.syncClaudePluginFailed", {
            defaultValue: "同步 Claude 插件失败",
          });
        toast.error(detail, { duration: 4200 });
      }
    },
    [activeApp, t],
  );

  // 添加供应商
  const addProvider = useCallback(
    async (
      provider: Omit<Provider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
        addToLive?: boolean;
        ensureGrokBuildOfficialSeed?: boolean;
        ensureCodexOfficialSeed?: boolean;
        editorSave?: ProviderEditorSave;
      },
    ) => {
      // 命中 Coding Plan 路由表的新供应商自动启用套餐用量查询（上游 cc-switch 270a4ff3）
      const enhanced = injectCodingPlanUsageScript(activeApp, provider);
      await addProviderMutation.mutateAsync(enhanced);

      // OpenClaw: register models to allowlist after adding provider
      if (activeApp === "openclaw" && provider.suggestedDefaults) {
        const { model, modelCatalog } = provider.suggestedDefaults;
        let modelsRegistered = false;

        try {
          // 1. Merge model catalog (allowlist)
          if (modelCatalog && Object.keys(modelCatalog).length > 0) {
            const existingCatalog = (await openclawApi.getModelCatalog()) || {};
            const mergedCatalog = { ...existingCatalog, ...modelCatalog };
            await openclawApi.setModelCatalog(mergedCatalog);
            await queryClient.invalidateQueries({
              queryKey: openclawKeys.health,
            });
            modelsRegistered = true;
          }

          // 2. Set default model (only if not already set)
          if (model) {
            const existingDefault = await openclawApi.getDefaultModel();
            if (!existingDefault?.primary) {
              await openclawApi.setDefaultModel(model);
              await queryClient.invalidateQueries({
                queryKey: openclawKeys.health,
              });
            }
          }

          // Show success toast if models were registered
          if (modelsRegistered) {
            toast.success(
              t("notifications.openclawModelsRegistered", {
                defaultValue: "模型已注册到 /model 列表",
              }),
              { closeButton: true },
            );
          }
        } catch (error) {
          // Log warning but don't block main flow - provider config is already saved
          console.warn(
            "[OpenClaw] Failed to register models to allowlist:",
            error,
          );
        }
      }
    },
    [addProviderMutation, activeApp, queryClient, t],
  );

  // 更新供应商
  const updateProvider = useCallback(
    async (
      provider: Provider,
      originalId?: string,
      editorSave?: ProviderEditorSave,
    ) => {
      await updateProviderMutation.mutateAsync({
        provider,
        originalId,
        ...(editorSave ? { editorSave } : {}),
      });
    },
    [updateProviderMutation],
  );

  // 切换供应商
  const switchProvider = useCallback(
    async (provider: Provider) => {
      const isCopilotProvider =
        activeApp === "claude" &&
        provider.meta?.providerType === "github_copilot";
      const routingReady =
        activeApp === "claude-desktop"
          ? isProxyRunning === true
          : isProxyTakeover === true;

      // 路由没就绪时，要经路由的卡不能直连切换（原因和卡片上「需要路由」徽标的说明同一份）
      const proxyRequiredReason = routingReady
        ? null
        : getRoutingReason(activeApp, provider, t);

      if (proxyRequiredReason) {
        toast.warning(
          t("notifications.proxyRequiredForSwitch", {
            reason: proxyRequiredReason,
            defaultValue:
              "此供应商{{reason}}，需要代理服务才能正常使用，请先启动代理",
          }),
        );
        return;
      }

      if (
        isProxyTakeover &&
        provider.category === "official" &&
        !supportsOfficialProxyTakeover(activeApp, provider)
      ) {
        toast.error(
          t("notifications.officialBlockedByProxy", {
            defaultValue:
              "Routing 激活时不能切换到官方供应商，经由本地代理访问官方 API 可能导致账号风险",
          }),
          { duration: 6000 },
        );
        return;
      }

      try {
        const result = await switchProviderMutation.mutateAsync(provider.id);
        await syncClaudePlugin(provider);
        // 路由下的切换：路由当场换上游，客户端文件改写了才需要重启（提示里会说）
        if (activeApp === "gemini" && !result?.route)
          toast.info(t("notifications.geminiRestart"), {
            duration: 6000,
            closeButton: true,
          });

        // 按警告代码分别提示：auth 清理失败若显示为通用“回填失败”会误导用户。
        if (result?.warnings?.length) {
          const authCleanupFailed = result.warnings.some((warning) =>
            warning.startsWith("codex_auth_cleanup_failed"),
          );
          const hasOtherWarnings = result.warnings.some(
            (warning) => !warning.startsWith("codex_auth_cleanup_failed"),
          );
          if (authCleanupFailed) {
            toast.warning(
              t("notifications.codexAuthCleanupFailed", {
                defaultValue:
                  "切换成功，但未能删除 auth.json，官方登录凭据仍留在磁盘上；如需彻底移除请手动删除 Codex 配置目录中的 auth.json",
              }),
              { duration: 6000 },
            );
          }
          if (hasOtherWarnings) {
            toast.warning(
              t("notifications.backfillWarning", {
                defaultValue:
                  "切换成功，但旧供应商配置回填失败，您手动修改的配置可能未保存",
              }),
              { duration: 5000 },
            );
          }
        }

        // 根据供应商类型显示不同的成功提示
        if (result?.route) {
          toast.success(
            routeSwitchNotification(result.route, activeApp, provider.name, t),
            { closeButton: true },
          );
        } else if (
          activeApp === "claude" &&
          provider.category !== "official" &&
          (isCopilotProvider ||
            provider.meta?.apiFormat === "openai_chat" ||
            provider.meta?.apiFormat === "openai_responses" ||
            provider.meta?.apiFormat === "gemini_native")
        ) {
          // OpenAI format provider: show proxy hint
          toast.info(
            isCopilotProvider
              ? t("notifications.copilotProxyHint")
              : provider.meta?.apiFormat === "gemini_native"
                ? t("notifications.geminiNativeFormatHint", {
                    defaultValue:
                      "此供应商使用 Gemini Native generateContent 格式，需要开启代理服务才能正常使用",
                  })
                : t("notifications.openAIFormatHint"),
            {
              duration: 5000,
              closeButton: true,
            },
          );
        } else {
          // 普通供应商：显示切换成功
          // 累加模式应用显示“已添加到配置”而不是“切换成功”
          const isMultiProviderApp =
            activeApp === "opencode" ||
            activeApp === "openclaw" ||
            activeApp === "hermes" ||
            activeApp === "pi" ||
            activeApp === "omp" ||
            activeApp === "mcode" ||
            activeApp === "kimi" ||
            activeApp === "dsh";
          const messageKey = isMultiProviderApp
            ? "notifications.addToConfigSuccess"
            : "notifications.switchSuccess";
          const defaultMessage = isMultiProviderApp
            ? "已添加到配置"
            : "切换成功！";

          toast.success(t(messageKey, { defaultValue: defaultMessage }), {
            closeButton: true,
          });
        }
      } catch {
        // 错误提示由 mutation 处理
      }
    },
    [
      switchProviderMutation,
      syncClaudePlugin,
      activeApp,
      isProxyRunning,
      isProxyTakeover,
      t,
    ],
  );

  // 删除供应商
  const deleteProvider = useCallback(
    async (id: string) => {
      await deleteProviderMutation.mutateAsync(id);
    },
    [deleteProviderMutation],
  );

  // 保存用量脚本
  const saveUsageScript = useCallback(
    async (provider: Provider, script: UsageScript) => {
      try {
        const updatedProvider: Provider = {
          ...provider,
          meta: {
            ...provider.meta,
            usage_script: script,
          },
        };

        // Pi / Oh My Pi 的用量脚本只存在数据库元数据里，不重写原生配置文件
        if (activeApp === "pi" || activeApp === "omp") {
          await piApi.updateProviderUsageScript(provider.id, script, activeApp);
        } else {
          await providersApi.update(updatedProvider, activeApp);
        }
        await queryClient.invalidateQueries({
          queryKey: ["providers", activeApp],
        });
        // 🔧 保存用量脚本后，也应该失效该 provider 的用量查询缓存
        // 这样主页列表会使用新配置重新查询，而不是使用测试时的缓存
        await queryClient.invalidateQueries({
          queryKey: ["usage", provider.id, activeApp],
        });
        toast.success(
          t("provider.usageSaved", {
            defaultValue: "用量查询配置已保存",
          }),
          { closeButton: true },
        );
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("provider.usageSaveFailed", {
            defaultValue: "用量查询配置保存失败",
          });
        toast.error(detail);
      }
    },
    [activeApp, queryClient, t],
  );

  // Set provider as default model (OpenClaw only)
  const setAsDefaultModel = useCallback(
    async (provider: Provider) => {
      const config = provider.settingsConfig as OpenClawProviderConfig;
      if (!config.models || config.models.length === 0) {
        toast.error(
          t("notifications.openclawNoModels", {
            defaultValue: "该供应商没有配置模型",
          }),
        );
        return;
      }

      const model: OpenClawDefaultModel = {
        primary: `${provider.id}/${config.models[0].id}`,
        fallbacks: config.models.slice(1).map((m) => `${provider.id}/${m.id}`),
      };

      try {
        await openclawApi.setDefaultModel(model);
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.defaultModel,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
        toast.success(
          t("notifications.openclawDefaultModelSet", {
            defaultValue: "已设为默认模型",
          }),
          { closeButton: true },
        );
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("notifications.openclawDefaultModelSetFailed", {
            defaultValue: "设置默认模型失败",
          });
        toast.error(detail);
      }
    },
    [queryClient, t],
  );

  return {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
    isLoading:
      addProviderMutation.isPending ||
      updateProviderMutation.isPending ||
      deleteProviderMutation.isPending ||
      switchProviderMutation.isPending,
  };
}
