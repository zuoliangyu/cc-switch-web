import type { AppModeView } from "@/types/proxy";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { claudeDesktopApi } from "@/lib/api/claudeDesktop";
import { extractErrorMessage } from "@/utils/errorUtils";
import { extractProviderBaseUrl } from "@/utils/providerConfigUtils";
import { HoverTip } from "@/components/ui/hover-tip";
import { sortProvidersByName } from "@/utils/providerSort";
import { getOpencodeDeclaredModels } from "@/components/providers/forms/helpers/opencodeFormUtils";
import type { OpenClawProviderConfig } from "@/types";
import {
  useOpenClawLiveProviderIds,
  useOpenClawDefaultModel,
} from "@/hooks/useOpenClaw";
import {
  useHermesLiveProviderIds,
  useHermesModelConfig,
} from "@/hooks/useHermes";
import { useStreamCheck } from "@/hooks/useStreamCheck";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderEmptyState } from "@/components/providers/ProviderEmptyState";
import {
  DshAccountCard,
  accountName as dshAccountName,
  useDshAccountStatus,
} from "@/components/providers/DshAccount";
import {
  useAutoFailoverEnabled,
  useFailoverQueue,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
} from "@/lib/query/failover";
import {
  useCurrentOmoProviderId,
  useCurrentOmoSlimProviderId,
} from "@/lib/query/omo";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api/settings";
import {
  invalidatePiProviderCaches,
  usePiCurrentState,
} from "@/lib/query/pi";

interface ProviderListProps {
  modeView?: AppModeView;
  modePending?: boolean;
  onAggregationMember?: (id: string, enabled: boolean) => void;
  onAggregationDefault?: (id: string) => void;
  providers: Record<string, Provider>;
  currentProviderId: string;
  appId: AppId;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onCreate?: () => void;
  isLoading?: boolean;
  isProxyRunning?: boolean; // 代理服务运行状态
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管）
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  /** OpenClaw / OpenCode / Hermes / Kimi：设为默认（OpenClaw / OpenCode 可指定模型） */
  onSetAsDefault?: (provider: Provider, modelId?: string) => void;
}

export function ProviderList({
  modeView,
  modePending,
  onAggregationMember,
  onAggregationDefault,
  providers,
  currentProviderId,
  appId,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onCreate,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  activeProviderId,
  onSetAsDefault,
}: ProviderListProps) {
  const { t } = useTranslation();
  const { checkProvider, isChecking } = useStreamCheck(appId);
  const sortedProviders = useMemo(
    () => sortProvidersByName(Object.values(providers)),
    [providers],
  );

  const { data: opencodeLiveIds, isPending: opencodeLivePending } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode",
  });

  const { data: piLiveIds, isPending: piLivePending } = useQuery({
    queryKey: ["piLiveProviderIds"],
    queryFn: () => providersApi.getPiLiveProviderIds(),
    enabled: appId === "pi",
  });
  // Oh My Pi：models.yml 里有哪些供应商由后端的当前状态给出
  const { data: ompState, isPending: ompStatePending } = usePiCurrentState(
    appId === "omp",
    "omp",
  );

  // OpenClaw: 查询 live 配置中的供应商 ID 列表，用于判断 isInConfig
  const { data: openclawLiveIds, isPending: openclawLivePending } = useOpenClawLiveProviderIds(
    appId === "openclaw",
  );

  const { data: hermesLiveIds, isPending: hermesLivePending } = useHermesLiveProviderIds(appId === "hermes");
  const { data: hermesModelConfig } = useHermesModelConfig(appId === "hermes");
  const hermesCurrentProviderId = hermesModelConfig?.provider;

  // 判断供应商是否已添加到配置（累加模式应用：OpenCode/OpenClaw/Hermes）
  const isProviderInConfig = useCallback(
    (providerId: string): boolean => {
      if (appId === "mcode" || appId === "kimi" || appId === "dsh")
        return providers[providerId]?.meta?.liveConfigManaged === true;
      if (appId === "opencode") {
        return opencodeLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "openclaw") {
        return openclawLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "hermes") {
        return hermesLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "pi") {
        return piLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "omp") {
        return ompState?.enabledProviderIds.includes(providerId) ?? false;
      }
      return true; // 其他应用始终返回 true
    },
    [
      appId,
      opencodeLiveIds,
      openclawLiveIds,
      hermesLiveIds,
      piLiveIds,
      ompState,
      providers,
    ],
  );

  // OpenClaw: query default model to determine which provider is default
  const { data: openclawDefaultModel } = useOpenClawDefaultModel(
    appId === "openclaw",
  );

  // OpenCode：顶层 model（`<provider>/<model>`）属于哪家
  const { data: opencodeDefaultModel } = useQuery({
    queryKey: ["opencodeDefaultModel"],
    queryFn: () => providersApi.getOpenCodeDefaultModel(),
    enabled: appId === "opencode",
  });

  const isProviderDefaultModel = useCallback(
    (providerId: string): boolean => {
      const primary =
        appId === "openclaw"
          ? openclawDefaultModel?.primary
          : appId === "opencode"
            ? opencodeDefaultModel
            : undefined;
      if (!primary) return false;
      return primary.startsWith(providerId + "/");
    },
    [appId, openclawDefaultModel, opencodeDefaultModel],
  );

  // OpenClaw / OpenCode：「设为默认」可选的模型
  const defaultModelOptions = useCallback(
    (provider: Provider): { id: string; name?: string }[] | undefined => {
      if (appId === "opencode") {
        return getOpencodeDeclaredModels(provider.id, provider.settingsConfig);
      }
      if (appId === "openclaw") {
        const models = (provider.settingsConfig as OpenClawProviderConfig)
          ?.models;
        return Array.isArray(models)
          ? models
              .filter((model) => typeof model?.id === "string" && model.id)
              .map((model) => ({ id: model.id, name: model.name }))
          : [];
      }
      return undefined;
    },
    [appId],
  );

  // 故障转移相关
  const supportsFailover = ![
    "opencode",
    "openclaw",
    "hermes",
    "pi",
    "kimi",
    "dsh",
    "agy",
    "omp",
  ].includes(appId);
  const { data: isAutoFailoverEnabled } = useAutoFailoverEnabled(
    appId,
    supportsFailover,
  );
  const { data: failoverQueue } = useFailoverQueue(appId, supportsFailover);
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();

  const isFailoverModeActive =
    modeView?.mode !== "aggregation" &&
    isProxyTakeover === true &&
    isAutoFailoverEnabled === true;

  const isOpenCode = appId === "opencode";
  const { data: currentOmoId } = useCurrentOmoProviderId(isOpenCode);
  const { data: currentOmoSlimId } = useCurrentOmoSlimProviderId(isOpenCode);

  const getFailoverPriority = useCallback(
    (providerId: string): number | undefined => {
      if (!isFailoverModeActive || !failoverQueue) return undefined;
      const index = failoverQueue.findIndex(
        (item) => item.providerId === providerId,
      );
      return index >= 0 ? index + 1 : undefined;
    },
    [isFailoverModeActive, failoverQueue],
  );

  const isInFailoverQueue = useCallback(
    (providerId: string): boolean => {
      if (!isFailoverModeActive || !failoverQueue) return false;
      return failoverQueue.some((item) => item.providerId === providerId);
    },
    [isFailoverModeActive, failoverQueue],
  );

  const handleToggleFailover = useCallback(
    (providerId: string, enabled: boolean) => {
      if (enabled) {
        addToQueue.mutate({ appType: appId, providerId });
      } else {
        removeFromQueue.mutate({ appType: appId, providerId });
      }
    },
    [appId, addToQueue, removeFromQueue],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: claudeDesktopStatus } = useQuery({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => claudeDesktopApi.getStatus(),
    enabled: appId === "claude-desktop",
    refetchInterval: appId === "claude-desktop" ? 5000 : false,
  });
  const [showStreamCheckConfirm, setShowStreamCheckConfirm] = useState(false);
  const [pendingTestProvider, setPendingTestProvider] =
    useState<Provider | null>(null);

  // Query settings for streamCheckConfirmed flag
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const handleTest = useCallback(
    (provider: Provider) => {
      if (!settings?.streamCheckConfirmed) {
        setPendingTestProvider(provider);
        setShowStreamCheckConfirm(true);
      } else {
        checkProvider(provider.id, provider.name);
      }
    },
    [checkProvider, settings?.streamCheckConfirmed],
  );

  const handleStreamCheckConfirm = async () => {
    setShowStreamCheckConfirm(false);
    try {
      if (settings) {
        const { webdavSync: _, ...rest } = settings;
        await settingsApi.save({ ...rest, streamCheckConfirmed: true });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      console.error("Failed to save stream check confirmed:", error);
    }
    if (pendingTestProvider) {
      checkProvider(pendingTestProvider.id, pendingTestProvider.name);
      setPendingTestProvider(null);
    }
  };

  // Import current live config as default provider
  const queryClient = useQueryClient();
  const importMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      if (appId === "opencode") {
        const count = await providersApi.importOpenCodeFromLive();
        return count > 0;
      }
      if (appId === "openclaw") {
        const count = await providersApi.importOpenClawFromLive();
        return count > 0;
      }
      if (appId === "pi") {
        const count = await providersApi.importPiFromLive();
        return count > 0;
      }
      if (appId === "omp") {
        const count = await providersApi.importOmpFromLive();
        return count > 0;
      }
      return providersApi.importDefault(appId);
    },
    onSuccess: (imported) => {
      if (imported) {
        queryClient.invalidateQueries({ queryKey: ["providers", appId] });
        if (appId === "claude-desktop") {
          queryClient.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
        }
        if (appId === "pi" || appId === "omp") {
          void invalidatePiProviderCaches(queryClient, appId);
        }
        toast.success(t("provider.importCurrentDescription"));
      } else {
        toast.info(t("provider.noProviders"));
      }
    },
    onError: (error: unknown) => {
      toast.error(extractErrorMessage(error) || t("settings.importFailed"));
      // 失败前可能已导入部分条目，仍需刷新列表呈现真实状态。
      queryClient.invalidateQueries({ queryKey: ["providers", appId] });
    },
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  const filteredProviders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return sortedProviders;
    return sortedProviders.filter((provider) => {
      // 名称、备注、网站之外也按请求地址匹配（各应用存法不同，统一由 extractProviderBaseUrl 取）
      const fields = [
        provider.name,
        provider.notes,
        provider.websiteUrl,
        extractProviderBaseUrl(provider.settingsConfig),
      ];
      return fields.some((field) =>
        field?.toString().toLowerCase().includes(keyword),
      );
    });
  }, [searchTerm, sortedProviders]);

  // DSH 登录了 DeepSeek 账号时，列表最前面画一张官方账号卡（不是供应商行，见 DshAccountCard）
  const { data: dshAccount } = useDshAccountStatus(appId === "dsh");
  const dshAccountCard =
    appId === "dsh" && dshAccount?.signedIn ? dshAccount : null;
  const searchKeyword = searchTerm.trim().toLowerCase();
  const showDshAccountCard = Boolean(
    dshAccountCard &&
      (!searchKeyword ||
        ["deepseek", dshAccountName(dshAccountCard, "")].some((value) =>
          value.toLowerCase().includes(searchKeyword),
        )),
  );

  const claudeDesktopStatusMessages = useMemo(() => {
    if (appId !== "claude-desktop" || !claudeDesktopStatus) return [];

    const messages: string[] = [];
    if (!claudeDesktopStatus.supported) {
      return [t("claudeDesktop.statusUnsupported")];
    }
    if (claudeDesktopStatus.staleRawModels) {
      messages.push(t("claudeDesktop.statusStaleRawModels"));
    }
    if (claudeDesktopStatus.missingRouteMappings) {
      messages.push(t("claudeDesktop.statusMissingRouteMappings"));
    }
    if (
      claudeDesktopStatus.mode === "proxy" &&
      !claudeDesktopStatus.gatewayTokenConfigured
    ) {
      messages.push(t("claudeDesktop.statusGatewayTokenMissing"));
    }

    const expected = claudeDesktopStatus.expectedBaseUrl?.replace(/\/+$/, "");
    const actual = claudeDesktopStatus.actualBaseUrl?.replace(/\/+$/, "");
    if (expected && actual && expected !== actual) {
      messages.push(
        t("claudeDesktop.statusBaseUrlMismatch", { expected, actual }),
      );
    }
    return messages;
  }, [appId, claudeDesktopStatus, t]);

  const membershipPending = (appId === "opencode" && opencodeLivePending) || (appId === "openclaw" && openclawLivePending) || (appId === "hermes" && hermesLivePending) || (appId === "pi" && piLivePending) || (appId === "omp" && ompStatePending);
  if (isLoading || (membershipPending && sortedProviders.length > 0)) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="w-full border border-dashed rounded-lg h-28 border-muted-foreground/40 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (sortedProviders.length === 0) {
    const emptyState = (
      <ProviderEmptyState
        appId={appId}
        onCreate={onCreate}
        onImport={
          appId === "mcode" || appId === "kimi" || appId === "dsh"
            ? undefined
            : () => importMutation.mutate()
        }
      />
    );
    return dshAccountCard ? (
      <div className="space-y-4">
        <DshAccountCard status={dshAccountCard} />
        {emptyState}
      </div>
    ) : (
      emptyState
    );
  }

  const renderProviderList = () => (
    <div className="space-y-4">
      {appId === "dsh" && (
        // DSH 的供应商一起写进 Web 和 Desktop 两份配置，在这里说明
        <p className="m-0 text-xs text-muted-foreground">
          {t("dsh.sharedProviders")}
        </p>
      )}
      {showDshAccountCard && dshAccountCard && (
        <DshAccountCard status={dshAccountCard} />
      )}
      {filteredProviders.map((provider) => {
        const isOmo = provider.category === "omo";
        const isOmoSlim = provider.category === "omo-slim";
        const isOmoCurrent = isOmo && provider.id === (currentOmoId || "");
        const isOmoSlimCurrent =
          isOmoSlim && provider.id === (currentOmoSlimId || "");
        const isHermesCurrent =
          appId === "hermes" && hermesCurrentProviderId === provider.id;
        return (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isCurrent={
              isOmo
                ? isOmoCurrent
                : isOmoSlim
                  ? isOmoSlimCurrent
                  : appId === "hermes"
                    ? isHermesCurrent
                    : provider.id === currentProviderId
            }
            appId={appId}
            isInConfig={isProviderInConfig(provider.id)}
            isOmo={isOmo}
            isOmoSlim={isOmoSlim}
            onSwitch={onSwitch}
            onEdit={onEdit}
            onDelete={onDelete}
            onRemoveFromConfig={onRemoveFromConfig}
            onDisableOmo={onDisableOmo}
            onDisableOmoSlim={onDisableOmoSlim}
            onDuplicate={onDuplicate}
            onConfigureUsage={onConfigureUsage ?? (() => undefined)}
            onOpenWebsite={onOpenWebsite}
            onOpenTerminal={onOpenTerminal}
            onTest={handleTest}
            isTesting={isChecking(provider.id)}
            isProxyRunning={isProxyRunning}
            isProxyTakeover={isProxyTakeover}
            deleteDisabledReason={
              // 后端 is_referenced：直连指针指着的、路由 / 聚合时正在路由的都删不掉。
              // 路由 / 聚合时直连那家不算「正在用」，单独说明退出路由会回到它
              modeView?.mode !== "direct" &&
              provider.id === modeView?.routeProviderId
                ? t("provider.deleteBlockedInUse")
                : provider.id === modeView?.directProviderId
                  ? modeView?.mode === "direct"
                    ? t("provider.deleteBlockedInUse")
                    : t("provider.deleteBlockedDirectDefault")
                  : undefined
            }
            aggregation={
              modeView?.mode === "aggregation"
                ? {
                    member: modeView.aggregation.members.some(
                      (m) => m.providerId === provider.id,
                    ),
                    default: provider.id === modeView.routeProviderId,
                    disabled:
                      modePending ||
                      !modeView.eligibleProviderIds.includes(provider.id),
                    onToggle: () =>
                      onAggregationMember?.(
                        provider.id,
                        !modeView.aggregation.members.some(
                          (m) => m.providerId === provider.id,
                        ),
                      ),
                    onDefault: () => onAggregationDefault?.(provider.id),
                  }
                : undefined
            }
            isAutoFailoverEnabled={isFailoverModeActive}
            failoverPriority={getFailoverPriority(provider.id)}
            isInFailoverQueue={isInFailoverQueue(provider.id)}
            onToggleFailover={(enabled) =>
              handleToggleFailover(provider.id, enabled)
            }
            activeProviderId={activeProviderId}
            isDefaultModel={
              appId === "hermes"
                ? isHermesCurrent
                : appId === "kimi"
                  ? // Kimi 的「当前默认」是 default_model 所属的那家
                    provider.id === currentProviderId
                  : isProviderDefaultModel(provider.id)
            }
            onSetAsDefault={
              onSetAsDefault
                ? (modelId?: string) => onSetAsDefault(provider, modelId)
                : undefined
            }
            defaultModelOptions={defaultModelOptions(provider)}
          />
        );
      })}
    </div>
  );

  return (
    <div className="mt-4 space-y-4">
      {claudeDesktopStatusMessages.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("claudeDesktop.statusTitle")}
          </div>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed">
            {claudeDesktopStatusMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="glass-card rounded-[30px] border border-border-default p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t("provider.workspaceLabel", {
                defaultValue: "Provider Workspace",
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {t("provider.listTitle", {
                  defaultValue: "供应商工作台",
                })}
              </h2>
              <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                {t("provider.countSummary", {
                  count: sortedProviders.length,
                  defaultValue: "{{count}} 个配置",
                })}
              </span>
              {searchTerm.trim() && (
                <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                  {t("provider.filteredCount", {
                    count: filteredProviders.length,
                    defaultValue: "筛选后 {{count}} 个",
                  })}
                </span>
              )}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {searchTerm.trim()
                ? t("provider.searchSummary", {
                    defaultValue:
                      "正在按名称、备注和 URL 过滤当前应用下的供应商配置。",
                  })
                : t("provider.workspaceDescription", {
                    defaultValue:
                      "集中查看、筛选和整理当前应用的供应商配置，常用操作可以直接在这里完成。",
                  })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSearchOpen ? (
              // 搜索框放在工作台这一行的末尾：不浮在卡片上挡住操作，也不把卡片往下推
              <HoverTip
                content={`${t("provider.searchScopeHint", {
                  defaultValue: "Matches provider name, notes, and URL.",
                })} ${t("provider.searchCloseHint", {
                  defaultValue: "Press Esc to close",
                })}`}
              >
                <div className="relative flex w-full items-center sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={t("provider.searchPlaceholder", {
                      defaultValue: "Search name, notes, or URL...",
                    })}
                    aria-label={t("provider.searchAriaLabel", {
                      defaultValue: "Search providers",
                    })}
                    className="pl-9 pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
                    onClick={() => setIsSearchOpen(false)}
                    aria-label={t("provider.searchCloseAriaLabel", {
                      defaultValue: "Close provider search",
                    })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </HoverTip>
            ) : (
              <Button
                type="button"
                variant={searchTerm.trim() ? "default" : "outline"}
                className="min-w-[8rem]"
                onClick={() => setIsSearchOpen(true)}
              >
                <Search className="mr-2 h-4 w-4" />
                {searchTerm.trim()
                  ? t("provider.searching", {
                      defaultValue: "筛选中",
                    })
                  : t("provider.search", {
                      defaultValue: "搜索",
                    })}
              </Button>
            )}
            {onCreate && (
              <Button
                type="button"
                className="theme-primary-solid min-w-[8rem]"
                onClick={onCreate}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("provider.addProvider")}
              </Button>
            )}
          </div>
        </div>

        {searchTerm.trim() && (
          <div className="mt-4 flex flex-col gap-2 rounded-[22px] border border-border-default bg-background/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t("provider.searchActiveHint", {
                count: filteredProviders.length,
                defaultValue: "当前显示 {{count}} 个匹配项。",
              })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start sm:justify-center"
              onClick={() => setSearchTerm("")}
            >
              {t("common.clear", { defaultValue: "清空" })}
            </Button>
          </div>
        )}
      </div>

      {filteredProviders.length === 0 ? (
        <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="mt-4 text-base font-semibold text-foreground">
            {t("provider.noSearchResults", {
              defaultValue: "No providers match your search.",
            })}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t("provider.noSearchResultsHint", {
              defaultValue:
                "试试更短的关键字，或者清空筛选后重新查看全部供应商。",
            })}
          </p>
        </div>
      ) : (
        renderProviderList()
      )}

      <ConfirmDialog
        isOpen={showStreamCheckConfirm}
        variant="info"
        title={t("confirm.streamCheck.title")}
        message={t("confirm.streamCheck.message")}
        confirmText={t("confirm.streamCheck.confirm")}
        onConfirm={() => void handleStreamCheckConfirm()}
        onCancel={() => {
          setShowStreamCheckConfirm(false);
          setPendingTestProvider(null);
        }}
      />
    </div>
  );
}
