import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OpenClawProviderConfig, Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { claudeDesktopApi } from "@/lib/api/claudeDesktop";
import { settingsApi } from "@/lib/api/settings";
import { extractErrorMessage } from "@/utils/errorUtils";
import { extractProviderBaseUrl } from "@/utils/providerConfigUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { sortProvidersByName } from "@/utils/providerSort";
import { getOpencodeDeclaredModels } from "@/components/providers/forms/helpers/opencodeFormUtils";
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
import { Notice } from "@/components/ui/notice";
import {
  DshAccountCard,
  accountName as dshAccountName,
  useDshAccountStatus,
} from "@/components/providers/DshAccount";
import {
  buildAdditiveSections,
  buildLaunchSections,
  buildSwitchSections,
  type CardPresentation,
  type ProviderSection,
  type SwitchModeInput,
} from "@/components/providers/presentation";
import {
  useCurrentOmoProviderId,
  useCurrentOmoSlimProviderId,
} from "@/lib/query/omo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isHermesReadOnlyProvider } from "@/config/hermesProviderPresets";
import {
  invalidatePiProviderCaches,
  usePiCurrentState,
} from "@/lib/query/pi";

/** 切换式应用（Claude Code / Claude Desktop / Codex / Gemini CLI / Grok Build）由模式面板算好的模式状态与操作 */
export type SwitchModeProps = Omit<SwitchModeInput, "app" | "t" | "providers">;

interface ProviderListProps {
  /** 搜索面板开关由页头的搜索按钮控制（上游 v7）；不传时列表自己管，⌘F / Ctrl+F 仍可打开 */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /**
   * 模式行右端给搜索框留的位置（null＝位置还没挂上，先不画）；不传则放在列表第一行右端，
   * 与第一个分组标题同行
   */
  searchSlot?: HTMLElement | null;
  /** 切换式应用必传：按正在查看的模式算卡片与分组 */
  switchMode?: SwitchModeProps;
  providers: Record<string, Provider>;
  currentProviderId: string;
  appId: AppId;
  /** 切换式应用的「启用」、累加应用的「添加」 */
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
  /** OpenClaw / OpenCode / Hermes / Kimi：设为默认（OpenClaw / OpenCode 可指定模型） */
  onSetAsDefault?: (provider: Provider, modelId?: string) => void;
}

export function ProviderList({
  searchOpen,
  onSearchOpenChange,
  searchSlot,
  switchMode,
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
  onSetAsDefault,
}: ProviderListProps) {
  const { t } = useTranslation();
  const { checkProvider, isChecking } = useStreamCheck(appId);
  // 已保存的供应商一律按显示名称 A–Z；分组只按状态分（队列 / 已添加 / 可添加…），组内仍是 A–Z
  const sortedProviders = useMemo(
    () => sortProvidersByName(Object.values(providers)),
    [providers],
  );

  const {
    data: opencodeLiveIds,
    isPending: opencodeLivePending,
    error: opencodeLiveIdsError,
  } = useQuery({
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

  const {
    data: openclawLiveIds,
    isPending: openclawLivePending,
    error: openclawLiveIdsError,
  } = useOpenClawLiveProviderIds(appId === "openclaw");

  const {
    data: hermesLiveIds,
    isPending: hermesLivePending,
    error: hermesLiveIdsError,
  } = useHermesLiveProviderIds(appId === "hermes");
  const { data: hermesModelConfig } = useHermesModelConfig(appId === "hermes");

  // 累加应用：供应商是否已写进应用自己的配置
  const isInConfig = useCallback(
    (provider: Provider): boolean => {
      switch (appId) {
        case "mcode":
        case "kimi":
        case "dsh":
          return provider.meta?.liveConfigManaged === true;
        case "opencode":
          return opencodeLiveIds?.includes(provider.id) ?? false;
        case "openclaw":
          return openclawLiveIds?.includes(provider.id) ?? false;
        case "hermes":
          return hermesLiveIds?.includes(provider.id) ?? false;
        case "pi":
          return piLiveIds?.includes(provider.id) ?? false;
        case "omp":
          return ompState?.enabledProviderIds.includes(provider.id) ?? false;
        default:
          return true;
      }
    },
    [appId, opencodeLiveIds, openclawLiveIds, hermesLiveIds, piLiveIds, ompState],
  );

  const { data: openclawDefaultModel } = useOpenClawDefaultModel(
    appId === "openclaw",
  );

  // OpenCode：顶层 model（`<provider>/<model>`）属于哪家
  const { data: opencodeDefaultModel } = useQuery({
    queryKey: ["opencodeDefaultModel"],
    queryFn: () => providersApi.getOpenCodeDefaultModel(),
    enabled: appId === "opencode",
  });

  const isOpenCode = appId === "opencode";
  const { data: currentOmoId } = useCurrentOmoProviderId(isOpenCode);
  const { data: currentOmoSlimId } = useCurrentOmoSlimProviderId(isOpenCode);

  const [searchTerm, setSearchTerm] = useState("");
  const [innerSearchOpen, setInnerSearchOpen] = useState(false);
  const isSearchOpen = searchOpen ?? innerSearchOpen;
  const setIsSearchOpen = onSearchOpenChange ?? setInnerSearchOpen;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    input.scrollIntoView?.({ block: "nearest" });
  }, []);
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
      if (event.defaultPrevented) return;

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        // 正在输入框/可编辑区域中时不抢占 Ctrl+F（例如添加供应商表单里
        // ProviderPresetSelector 的搜索框），避免与其同名快捷键冲突。
        if (isTextEditableTarget(document.activeElement)) return;
        event.preventDefault();
        if (isSearchOpen) {
          // 列表行里的搜索框可能已经滚出视野
          focusSearch();
        } else {
          setIsSearchOpen(true);
        }
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setIsSearchOpen, isSearchOpen, focusSearch]);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(focusSearch);
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen, focusSearch]);

  // 关掉面板就不再过滤：搜索词留着，下次打开还在，但列表不会悄悄少几家
  const searchKeyword = isSearchOpen ? searchTerm.trim().toLowerCase() : "";

  // 每家可被搜到的文字：名称、备注、官网、请求地址（请求地址要解析配置，只随列表变化重算）
  const searchIndex = useMemo(
    () =>
      sortedProviders.map((provider) => ({
        provider,
        text: [
          provider.name,
          provider.notes,
          provider.websiteUrl,
          extractProviderBaseUrl(provider.settingsConfig),
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase(),
      })),
    [sortedProviders],
  );

  const filteredProviders = useMemo(() => {
    if (!searchKeyword) return sortedProviders;
    return searchIndex
      .filter((entry) => entry.text.includes(searchKeyword))
      .map((entry) => entry.provider);
  }, [searchKeyword, searchIndex, sortedProviders]);

  // DSH 登录了 DeepSeek 账号时，「已添加」最前面画一张官方账号卡（不是供应商行，见 DshAccountCard）
  const { data: dshAccount } = useDshAccountStatus(appId === "dsh");
  const dshAccountCard =
    appId === "dsh" && dshAccount?.signedIn ? dshAccount : null;
  const showDshAccountCard = Boolean(
    dshAccountCard &&
      (!searchKeyword ||
        ["deepseek", dshAccountName(dshAccountCard, "")].some((value) =>
          value.toLowerCase().includes(searchKeyword),
        )),
  );

  const sections = useMemo<ProviderSection[]>(() => {
    if (switchMode) {
      // 队列按没过滤的全部供应商剔掉已不存在的 id：序号要按完整队列算，搜索只决定画哪些卡
      const known = new Set(sortedProviders.map((p) => p.id));
      return buildSwitchSections({
        ...switchMode,
        app: appId,
        t,
        providers: filteredProviders,
        queue: switchMode.queue.filter((id) => known.has(id)),
      });
    }
    if (appId === "agy" || appId === "copilot") {
      return buildLaunchSections({
        app: appId,
        t,
        providers: filteredProviders,
        openTerminal: (provider) => onOpenTerminal?.(provider),
      });
    }
    const defaultPrimary =
      (appId === "openclaw"
        ? openclawDefaultModel?.primary
        : appId === "opencode"
          ? opencodeDefaultModel
          : null) ?? "";
    const slash = defaultPrimary.indexOf("/");
    return buildAdditiveSections({
      app: appId,
      t,
      providers: filteredProviders,
      isInConfig,
      currentOmoId,
      currentOmoSlimId,
      defaultModel:
        slash > 0
          ? {
              providerId: defaultPrimary.slice(0, slash),
              model: defaultPrimary.slice(slash + 1),
            }
          : null,
      defaultModelOptions: (provider) => {
        if (appId === "opencode") {
          return getOpencodeDeclaredModels(
            provider.id,
            provider.settingsConfig,
          );
        }
        const config = provider.settingsConfig as OpenClawProviderConfig;
        if (!Array.isArray(config?.models)) return [];
        return config.models
          .filter((model) => typeof model?.id === "string" && model.id.trim())
          .map((model) => ({ id: model.id, name: model.name }));
      },
      hermesCurrentId: hermesModelConfig?.provider ?? null,
      isHermesManaged: (provider) =>
        isHermesReadOnlyProvider(provider.settingsConfig),
      kimiCurrentId: currentProviderId,
      extraAdded: showDshAccountCard ? 1 : 0,
      actions: {
        add: onSwitch,
        remove: (provider) =>
          onRemoveFromConfig
            ? onRemoveFromConfig(provider)
            : onDelete(provider),
        disableOmo: (provider) =>
          provider.category === "omo-slim"
            ? onDisableOmoSlim?.()
            : onDisableOmo?.(),
        setDefault: (provider, modelId) => onSetAsDefault?.(provider, modelId),
      },
    });
  }, [
    switchMode,
    appId,
    t,
    sortedProviders,
    filteredProviders,
    onSwitch,
    onOpenTerminal,
    openclawDefaultModel?.primary,
    opencodeDefaultModel,
    isInConfig,
    currentOmoId,
    currentOmoSlimId,
    hermesModelConfig?.provider,
    currentProviderId,
    showDshAccountCard,
    onRemoveFromConfig,
    onDelete,
    onDisableOmo,
    onDisableOmoSlim,
    onSetAsDefault,
  ]);

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

  // 累加式应用要等 live 里有哪些供应商读回来才知道卡片该进哪个分区；在那之前按加载中画骨架，
  // 不然卡片先全落进「可添加」，读回来再整体搬到「已添加」。一张卡都没有时不用等，直接出空状态
  const membershipPending =
    (appId === "opencode" && opencodeLivePending) ||
    (appId === "openclaw" && openclawLivePending) ||
    (appId === "hermes" && hermesLivePending) ||
    (appId === "pi" && piLivePending) ||
    (appId === "omp" && ompStatePending);
  // 累加式应用读不了 live 配置（如 YAML 写坏了）时，列表和空状态看起来跟没配置过一样，
  // 添加 / 移除又会报错，所以在顶部说清楚
  const liveIdsError =
    appId === "opencode"
      ? opencodeLiveIdsError
      : appId === "openclaw"
        ? openclawLiveIdsError
        : appId === "hermes"
          ? hermesLiveIdsError
          : null;
  const liveIdsErrorMessage = liveIdsError
    ? extractErrorMessage(liveIdsError)
    : "";
  const liveConfigErrorNotice = liveIdsError ? (
    <Notice
      tone="warning"
      title={t("provider.liveConfigReadFailed", {
        app: t(`apps.${appId}`),
        defaultValue: "无法读取 {{app}} 配置文件",
      })}
    >
      {t("provider.liveConfigReadFailedHint", {
        defaultValue: "修好配置文件之前，添加、移除供应商都会失败。",
      })}
      {liveIdsErrorMessage ? ` ${liveIdsErrorMessage}` : ""}
    </Notice>
  ) : null;

  if (isLoading || (membershipPending && sortedProviders.length > 0)) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-[60px] w-full rounded-2xl border border-dashed border-muted-foreground/40 bg-muted/40"
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
    return dshAccountCard || liveConfigErrorNotice ? (
      <div className="space-y-4">
        {liveConfigErrorNotice}
        {dshAccountCard && <DshAccountCard status={dshAccountCard} />}
        {emptyState}
      </div>
    ) : (
      emptyState
    );
  }

  // 「当前」只用来决定官方订阅 / OAuth 额度自动刷新：Pi 没有当前项，OMO / Hermes 各看自己的当前项；
  // Antigravity、Copilot CLI 没有「启用」，每张卡都随时能打开，额度一律照常显示
  const isCurrentFor = (provider: Provider) => {
    if (appId === "pi" || appId === "omp") return false;
    if (appId === "agy" || appId === "copilot") return true;
    if (provider.category === "omo") return provider.id === currentOmoId;
    if (provider.category === "omo-slim")
      return provider.id === currentOmoSlimId;
    if (appId === "hermes") return provider.id === hermesModelConfig?.provider;
    return provider.id === currentProviderId;
  };

  const renderCard = (provider: Provider, presentation: CardPresentation) => (
    <ProviderCard
      key={provider.id}
      provider={provider}
      appId={appId}
      presentation={presentation}
      isCurrent={isCurrentFor(provider)}
      onEdit={onEdit}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onConfigureUsage={onConfigureUsage ?? (() => undefined)}
      onOpenWebsite={onOpenWebsite}
      // Antigravity、Copilot CLI 的「打开终端」已经是主按钮，不再重复
      onOpenTerminal={
        appId === "agy" || appId === "copilot" ? undefined : onOpenTerminal
      }
      onTest={handleTest}
      isTesting={isChecking(provider.id)}
    />
  );

  // 搜索框（上游 v7）：有模式行时放在模式行右端，否则放在列表第一行右端；不盖住卡片、打开时卡片也不下移
  const searchField = (
    <AnimatePresence>
      {isSearchOpen && (
        <motion.div
          key="provider-search"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="relative flex w-full min-w-[10rem] shrink items-center sm:w-64"
        >
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            title={`${t("provider.searchScopeHint", {
              defaultValue:
                "Matches provider name, notes, website, and API address.",
            })} ${t("provider.searchCloseHint", {
              defaultValue: "Press Esc to close",
            })}`}
            className={searchTerm ? "h-8 pe-[5.5rem] ps-8" : "h-8 pe-9 ps-8"}
          />
          {searchTerm && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute end-8 top-1/2 h-6 -translate-y-1/2 px-1.5"
              onClick={() => setSearchTerm("")}
            >
              {t("common.clear", { defaultValue: "清空" })}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute end-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
            onClick={() => setIsSearchOpen(false)}
            aria-label={t("provider.searchCloseAriaLabel", {
              defaultValue: "Close provider search",
            })}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const renderSectionTitle = (section: ProviderSection) => (
    <div className="flex flex-wrap items-center gap-1 text-xs font-semibold text-muted-foreground">
      <h2 className="m-0 text-xs font-semibold">{section.title}</h2>
      {section.help && (
        <HelpTip title={section.help.title}>{section.help.body}</HelpTip>
      )}
      {section.note && (
        <span className="ms-1 font-normal text-muted-foreground/80">
          {section.note}
        </span>
      )}
    </div>
  );

  // 没有模式行的应用：第一个分组标题和搜索框同一行。这一行一直在（搜不到结果时只剩搜索框），
  // 输入框在树里的位置不变，打字中途不会因为结果清空被重新挂载而丢焦点
  const hostedSearch = searchSlot !== undefined;
  const leadSection = sections[0];
  const liftLeadTitle =
    !hostedSearch &&
    Boolean(leadSection?.title) &&
    (filteredProviders.length > 0 || showDshAccountCard);
  const showListHeader =
    !hostedSearch && (Boolean(leadSection?.title) || isSearchOpen);

  return (
    <div className="space-y-4">
      {liveConfigErrorNotice}
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
      {searchSlot && createPortal(searchField, searchSlot)}
      {showListHeader && (
        <div
          className={
            liftLeadTitle
              ? "-mb-2 flex min-h-8 flex-wrap items-center gap-3"
              : "flex min-h-8 flex-wrap items-center gap-3"
          }
        >
          <div className="min-w-0 flex-1">
            {liftLeadTitle && renderSectionTitle(leadSection)}
          </div>
          {searchField}
        </div>
      )}

      {filteredProviders.length === 0 && !showDshAccountCard ? (
        <div className="rounded-2xl border border-dashed border-border-default px-6 py-8 text-center text-sm text-muted-foreground">
          {t("provider.noSearchResults", {
            defaultValue: "No providers match your search.",
          })}
        </div>
      ) : (
        sections.map((section, index) => (
          <section key={section.key} className="space-y-2">
            {section.title && !(index === 0 && liftLeadTitle) && (
              <div className="pt-1">{renderSectionTitle(section)}</div>
            )}
            {section.key === "added" &&
              showDshAccountCard &&
              dshAccountCard && <DshAccountCard status={dshAccountCard} />}
            {section.items.length === 0 &&
            section.emptyText &&
            !(section.key === "added" && showDshAccountCard) ? (
              <div className="rounded-2xl border border-dashed border-border-default px-4 py-3 text-xs text-muted-foreground">
                {section.emptyText}
              </div>
            ) : (
              <div className="space-y-2">
                {section.items.map((item) =>
                  renderCard(item.provider, item.presentation),
                )}
              </div>
            )}
          </section>
        ))
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
