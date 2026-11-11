import { WebSidebar } from "@/components/shell/WebSidebar";
import type { SettingsSection } from "@/components/settings/settingsSections";
import type { ProviderEditorSave } from "@/lib/api/providers";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ModeView } from "@/components/providers/presentation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings,
  ArrowLeft,
  Book,
  Wrench,
  History,
  BarChart2,
  FolderOpen,
  KeyRound,
  Shield,
  Cpu,
  LayoutDashboard,
  MoreHorizontal,
  Search,
} from "lucide-react";
import type { Provider, VisibleApps } from "@/types";
import { useProvidersQuery, useSettingsQuery } from "@/lib/query";
import { syncLanguageFromSettings } from "@/i18n";
import { hermesApi, providersApi, settingsApi, type AppId } from "@/lib/api";
import { piApi } from "@/lib/api/pi";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import { APP_IDS, isPiFamilyApp, orderAppIds } from "@/config/appConfig";
import { OpenTerminalDialog } from "@/components/providers/OpenTerminalDialog";
import {
  hermesKeys,
  useHermesHealth,
  useOpenHermesWebUI,
} from "@/hooks/useHermes";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useAppServerEvents } from "@/hooks/useAppServerEvents";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import {
  extractErrorMessage,
  translateKimiProviderMutationError,
  translatePiProviderMutationError,
} from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { isOfficialAccount } from "@/utils/providerCapabilities";
import {
  COPILOT_PROVIDER_ID_MAX,
  normalizeCopilotProviderId,
} from "@/config/copilotConfig";
import { HoverTip } from "@/components/ui/hover-tip";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { ProviderList } from "@/components/providers/ProviderList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { discardUnsavedChanges, hasUnsavedChanges } from "@/lib/unsavedChanges";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { SwitchModePanel } from "@/components/providers/mode/SwitchModePanel";
import { useAppMode, supportsAppMode } from "@/hooks/useAppMode";
import { RoutingActivationBrand } from "@/components/proxy/RoutingActivationBrand";
import { McpIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesHealthBanner from "@/components/hermes/HermesHealthBanner";
import { UpdateBadge } from "@/components/UpdateBadge";
import { useUpdate } from "@/contexts/UpdateContext";
import {
  hasOpencodeDefinition,
  isNativeOpencodeConfig,
} from "@/components/providers/forms/helpers/opencodeFormUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RefreshAllQuotaButton } from "@/components/settings/auth/RefreshAllQuotaButton";

// 首屏只展示供应商列表；其余视图与弹窗按需加载，避免首屏包过大。
const AddProviderDialog = lazy(() =>
  import("@/components/providers/AddProviderDialog").then((m) => ({
    default: m.AddProviderDialog,
  })),
);
const EditProviderDialog = lazy(() =>
  import("@/components/providers/EditProviderDialog").then((m) => ({
    default: m.EditProviderDialog,
  })),
);
const SettingsPage = lazy(() =>
  import("@/components/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const DeepLinkImportDialog = lazy(() =>
  import("@/components/deeplink/DeepLinkImportDialog").then((m) => ({
    default: m.DeepLinkImportDialog,
  })),
);
const UsageScriptModal = lazy(() => import("@/components/UsageScriptModal"));
const UnifiedMcpPanel = lazy(() => import("@/components/mcp/UnifiedMcpPanel"));
const PromptPanel = lazy(() => import("@/components/prompts/PromptPanel"));
const UnifiedSkillsPanel = lazy(
  () => import("@/components/skills/UnifiedSkillsPanel"),
);
const UniversalProviderPanel = lazy(() =>
  import("@/components/universal").then((m) => ({
    default: m.UniversalProviderPanel,
  })),
);
const SessionManagerPage = lazy(() =>
  import("@/components/sessions/SessionManagerPage").then((m) => ({
    default: m.SessionManagerPage,
  })),
);
const WorkspaceFilesPanel = lazy(
  () => import("@/components/workspace/WorkspaceFilesPanel"),
);
const EnvPanel = lazy(() => import("@/components/openclaw/EnvPanel"));
const ToolsPanel = lazy(() => import("@/components/openclaw/ToolsPanel"));
const AgentsDefaultsPanel = lazy(
  () => import("@/components/openclaw/AgentsDefaultsPanel"),
);
const HermesMemoryPanel = lazy(
  () => import("@/components/hermes/HermesMemoryPanel"),
);

const AppsPage = lazy(() =>
  import("@/components/apps/AppsPage").then((m) => ({ default: m.AppsPage })),
);

const AuthCenterPanel = lazy(() =>
  import("@/components/settings/AuthCenterPanel").then((m) => ({
    default: m.AuthCenterPanel,
  })),
);
const UsagePage = lazy(() =>
  import("@/components/usage/UsagePage").then((m) => ({
    default: m.UsagePage,
  })),
);

function PageLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      {t("common.loading")}
    </div>
  );
}

type View =
  | "usage"
  | "accounts"
  | "apps"
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "skillsDiscovery"
  | "mcp"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawAgents"
  | "hermesMemory";

const DRAG_BAR_HEIGHT = 0; // px
const HEADER_HEIGHT = 64; // px
/** 页面自己画上游页头（AppPageHeader）的视图 */
const PAGES_WITH_OWN_HEADER = new Set<View>([
  "usage",
  "apps",
  "mcp",
  "skills",
  "skillsDiscovery",
  "sessions",
]);
const STORAGE_KEY = "cc-switch-last-app";
const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && APP_IDS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const VIEW_STORAGE_KEY = "cc-switch-last-view";
const VALID_VIEWS: View[] = [
  "usage",
  "accounts",
  "apps",
  "providers",
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
];

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "providers";
};

function App() {
  const { hasUpdate } = useUpdate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // 服务端推送的切换、同步等事件（对应上游 App.tsx 的 Tauri 事件监听）
  useAppServerEvents();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  // 从应用页的「配置目录」进入设置时，定位并闪烁该应用的配置区域（上游 eda410e5）
  const [appConfigScrollTarget, setAppConfigScrollTarget] = useState<AppId>();
  const openSettings = useCallback(
    (section: SettingsSection, appConfigTarget?: AppId) => {
      setSettingsSection(section);
      setAppConfigScrollTarget(appConfigTarget);
      setCurrentView("settings");
    },
    [],
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  // 新增 / 编辑面板第一次打开时才挂载（才去加载表单代码），之后保留以便关闭动画
  const [hasOpenedAdd, setHasOpenedAdd] = useState(false);
  useEffect(() => {
    if (isAddOpen) setHasOpenedAdd(true);
  }, [isAddOpen]);
  // 供应商页顶部正在看的那格（直连 / 路由 / 聚合），由 SwitchModePanel 报上来。打开新增、
  // 编辑时记下当时那格，表单按它选布局：在聚合那格打开就是聚合的简化表单（上游 fe831f0a）。
  const [providerModeView, setProviderModeView] = useState<{
    app: AppId;
    view: ModeView;
  } | null>(null);
  const [formModeView, setFormModeView] = useState<ModeView>();
  const handleProviderModeViewChange = useCallback(
    (app: AppId, view: ModeView) => setProviderModeView({ app, view }),
    [],
  );
  // 换了应用、新面板还没报上来时为 undefined：表单按应用实际生效的模式
  const currentModeView =
    providerModeView?.app === activeApp ? providerModeView.view : undefined;
  const openAddProvider = (view: ModeView | undefined) => {
    setFormModeView(view);
    setIsAddOpen(true);
  };
  // 供应商搜索面板：页头按钮和 ⌘F 都能打开；换应用或离开供应商页就收起
  const [providerSearchOpen, setProviderSearchOpen] = useState(false);
  // 页头里给模式连接徽标留的位置（SwitchModePanel 通过 portal 画进来）
  const [modeStatusSlot, setModeStatusSlot] = useState<HTMLDivElement | null>(
    null,
  );
  useEffect(() => {
    setProviderSearchOpen(false);
  }, [activeApp, currentView]);

  const handleViewChange = (nextView: View) => {
    setCurrentView(nextView);
  };

  // 编辑页里有未保存的修改：先确认，确认放弃后再执行这次导航
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const confirmLeaveRef = useRef<(proceed: () => void) => boolean>(() => false);
  confirmLeaveRef.current = (proceed) => {
    if (!hasUnsavedChanges()) return false;
    setPendingLeave(() => proceed);
    return true;
  };

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  const { data: settingsData } = useSettingsQuery();
  // 首屏语言来自 localStorage 缓存；拿到后端保存的语言后再校正一次
  useEffect(() => {
    syncLanguageFromSettings(settingsData?.language);
  }, [settingsData?.language]);
  const visibleApps: VisibleApps = settingsData?.visibleApps ?? {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    grokbuild: true,
    opencode: true,
    openclaw: true,
    hermes: true,
    pi: true,
    mcode: true,
    kimi: true,
    dsh: true,
    agy: true,
    omp: true,
    copilot: true,
  };

  // 默认打开的应用跟应用页拖出来的顺序走
  const getFirstVisibleApp = (): AppId =>
    orderAppIds(settingsData?.appOrder).find((app) => visibleApps[app]) ??
    "claude";

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  useEffect(() => {
    if (currentView === "hermesMemory" && activeApp !== "hermes") {
      setCurrentView("providers");
    }
  }, [activeApp, currentView]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          if (!sessionStorage.getItem("env_banner_dismissed")) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    void checkEnvOnStartup();
  }, []);

  useEffect(() => {
    if (!["claude", "codex", "gemini"].includes(activeApp)) {
      return;
    }

    const checkEnvOnSwitch = async () => {
      try {
        if (activeApp === "mcode" || activeApp === "dsh") return;
        const conflicts = await checkEnvConflicts(activeApp);
        if (conflicts.length === 0) {
          return;
        }

        setEnvConflicts((previous) => {
          const existingKeys = new Set(
            previous.map(
              (conflict) => `${conflict.varName}:${conflict.sourcePath}`,
            ),
          );
          const nextConflicts = conflicts.filter(
            (conflict) =>
              !existingKeys.has(`${conflict.varName}:${conflict.sourcePath}`),
          );
          return [...previous, ...nextConflicts];
        });

        if (!sessionStorage.getItem("env_banner_dismissed")) {
          setShowEnvBanner(true);
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    void checkEnvOnSwitch();
  }, [activeApp]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [hasOpenedEdit, setHasOpenedEdit] = useState(false);
  useEffect(() => {
    if (editingProvider) setHasOpenedEdit(true);
  }, [editingProvider]);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<
    import("@/types/env").EnvConflict[]
  >([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);
  const [envBannerHeight, setEnvBannerHeight] = useState(0);

  useEffect(() => {
    setIsAddOpen(false);
    setEditingProvider(null);
    setUsageProvider(null);
    setConfirmAction(null);
  }, [activeApp, currentView]);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);
  const mainScrollRef = useRef<HTMLElement>(null);
  const providerScrollContainerRef = useRef<HTMLDivElement>(null);

  // 切换应用时回到列表顶部，避免沿用上一个应用的滚动位置（上游 4837fe2c）。
  useLayoutEffect(() => {
    if (currentView !== "providers") return;

    for (const container of [
      mainScrollRef.current,
      providerScrollContainerRef.current,
    ]) {
      if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
    }
  }, [activeApp, currentView]);

  const promptPanelRef = useRef<any>(null);
  const addActionButtonClass = "theme-floating-action rounded-full w-8 h-8";

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus();
  const isCurrentAppTakeoverActive =
    activeApp !== "pi" &&
    activeApp !== "mcode" &&
    activeApp !== "kimi" &&
    activeApp !== "dsh" &&
    activeApp !== "agy" &&
    activeApp !== "omp" &&
    activeApp !== "copilot" &&
    (takeoverStatus?.[activeApp] || false);

  const { data, isLoading, refetch } = useProvidersQuery(activeApp, {
    isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const appMode = useAppMode(activeApp);
  const isOpenClawView =
    activeApp === "openclaw" &&
    (currentView === "providers" ||
      currentView === "workspace" ||
      currentView === "sessions" ||
      currentView === "openclawEnv" ||
      currentView === "openclawTools" ||
      currentView === "openclawAgents");
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);
  const isHermesView =
    activeApp === "hermes" &&
    (currentView === "providers" || currentView === "hermesMemory");
  const { data: hermesHealthWarnings = [] } = useHermesHealth(isHermesView);
  const hasSkillsSupport = true;
  const hasSessionSupport =
    activeApp === "claude" ||
    activeApp === "codex" ||
    activeApp === "grokbuild" ||
    activeApp === "opencode" ||
    activeApp === "openclaw" ||
    activeApp === "gemini" ||
    activeApp === "pi" ||
    activeApp === "omp" ||
    activeApp === "mcode" ||
    activeApp === "dsh";

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning,
    isProxyRunning && isCurrentAppTakeoverActive,
  );

  // Kimi「添加」：写进 config.toml 但不改默认模型；改默认模型走「设为默认」（切换）
  // Kimi「添加」只写进 config.toml、不改默认模型；「切换」走 switchProvider。
  // Copilot CLI 的自带模型卡同理：「添加」只写进 providers.json，默认模型在 copilot 里用 /model 选
  const addNativeProviderToConfig = async (
    provider: Provider,
    app: "kimi" | "copilot",
  ) => {
    try {
      await providersApi.addToLiveConfig(provider.id, app);
    } catch (error) {
      toast.error(extractErrorMessage(error));
      return;
    } finally {
      // 失败也重读：文件可能在客户端里改过，「已添加」状态要跟上
      await queryClient.invalidateQueries({ queryKey: ["providers", app] });
    }
    toast.success(
      t("notifications.addToConfigSuccess", { defaultValue: "已添加到配置" }),
    );
  };

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const currentViewRef = useRef(currentView);
  const isEnvBannerVisible = showEnvBanner && envConflicts.length > 0;
  const headerTopOffset =
    DRAG_BAR_HEIGHT + (isEnvBannerVisible ? envBannerHeight : 0);
  // 窄屏把页头操作挪到第二行的页面；MCP、Skills、统一供应商的操作已在页内页头里
  const resourceToolbar = ["prompts"].includes(currentView);
  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  useEffect(() => {
    if (!isEnvBannerVisible && envBannerHeight !== 0) {
      setEnvBannerHeight(0);
    }
  }, [envBannerHeight, isEnvBannerVisible]);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        // 已在设置页：不算离开，不弹确认，也不清掉编辑页的未保存登记
        if (currentViewRef.current === "settings") return;
        const openSettings = () => setCurrentView("settings");
        if (!confirmLeaveRef.current(openSettings)) openSettings();
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "providers") return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      setCurrentView(view === "skillsDiscovery" ? "skills" : "providers");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
    editorSave,
  }: {
    provider: Provider;
    originalId?: string;
    editorSave?: ProviderEditorSave;
  }) => {
    await updateProvider(provider, originalId, editorSave);
    setEditingProvider(null);
  };

  // 累加式应用的「已添加」和「默认」都现读客户端文件，移除前后重读一遍
  const refreshAdditiveLiveState = async (app: AppId) => {
    if (app === "opencode") {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        }),
        queryClient.invalidateQueries({ queryKey: ["opencodeDefaultModel"] }),
      ]);
    } else if (app === "openclaw") {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        }),
        queryClient.invalidateQueries({ queryKey: openclawKeys.defaultModel }),
        queryClient.invalidateQueries({ queryKey: openclawKeys.health }),
      ]);
    } else if (app === "hermes") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hermesKeys.liveProviderIds }),
        queryClient.invalidateQueries({ queryKey: hermesKeys.modelConfig }),
      ]);
    } else if (app === "pi") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["piLiveProviderIds"] }),
        queryClient.invalidateQueries({ queryKey: ["pi", "state"] }),
      ]);
    } else if (app === "omp") {
      await queryClient.invalidateQueries({ queryKey: ["omp", "state"] });
    } else if (
      app === "mcode" ||
      app === "kimi" ||
      app === "dsh" ||
      app === "copilot"
    ) {
      // MiniMax Code / Kimi Code / DeepSeek Harness / Copilot CLI 的“已添加”状态来自
      // meta.liveConfigManaged（上游 09c5d39d）。
      await queryClient.invalidateQueries({ queryKey: ["providers", app] });
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      try {
        await providersApi.removeFromLiveConfig(provider.id, activeApp);
      } catch (error) {
        const detail = extractErrorMessage(error);
        const description =
          (isPiFamilyApp(activeApp)
            ? translatePiProviderMutationError(detail, t)
            : activeApp === "kimi"
              ? translateKimiProviderMutationError(detail, t)
              : "") || detail;
        // 默认模型可能在客户端里改过、页面还是旧的：失败了也重读，让「默认」和移除按钮跟上
        void refreshAdditiveLiveState(activeApp).catch(() => undefined);
        toast.error(t("notifications.removeFromConfigFailed"), {
          description: description || t("common.unknown"),
          closeButton: true,
        });
        return;
      }
      await refreshAdditiveLiveState(activeApp);
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    if (
      activeApp === "opencode" &&
      provider.category !== "omo" &&
      provider.category !== "omo-slim"
    ) {
      // A copy gets a new ID, so it cannot inherit a built-in definition.
      // Native V2 declarations name their package in `package`, not `npm`.
      const isNative = isNativeOpencodeConfig(
        JSON.stringify(provider.settingsConfig),
        provider.meta?.opencodeConfigFormat,
      );
      if (
        !hasOpencodeDefinition(
          provider.settingsConfig,
          isNative ? "package" : "npm",
        )
      ) {
        toast.error(
          t(
            isNative
              ? "opencode.duplicateRequiresNativeDefinition"
              : "opencode.duplicateRequiresDefinition",
          ),
        );
        return;
      }
    }

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: JSON.parse(JSON.stringify(provider.settingsConfig)), // 深拷贝
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      meta: provider.meta
        ? JSON.parse(JSON.stringify(provider.meta))
        : undefined, // 深拷贝
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes" ||
      activeApp === "pi" ||
      activeApp === "omp"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: ["opencodeLiveProviderIds"],
                queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds,
                  queryFn: () => providersApi.getOpenClawLiveProviderIds(),
                })
              : activeApp === "hermes"
                ? await queryClient.ensureQueryData({
                    queryKey: hermesKeys.liveProviderIds,
                    queryFn: () => providersApi.getHermesLiveProviderIds(),
                  })
                : activeApp === "omp"
                  ? (
                      await queryClient.ensureQueryData({
                        queryKey: ["omp", "state"],
                        queryFn: () => piApi.getCurrentState("omp"),
                      })
                    ).enabledProviderIds
                  : await queryClient.ensureQueryData({
                      queryKey: ["piLiveProviderIds"],
                      queryFn: () => providersApi.getPiLiveProviderIds(),
                    });
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("notifications.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }

      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = false;
    } else if (
      activeApp === "mcode" ||
      activeApp === "dsh" ||
      activeApp === "kimi"
    ) {
      // The list includes live custom nodes; the backend also guards native account keys.
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        Object.keys(providers),
      );
      if (activeApp === "kimi") {
        // Kimi 的模型键以供应商键为前缀，复制出来的卡要改成新键，也先不写进 config.toml
        const models = duplicatedProvider.settingsConfig.models ?? {};
        duplicatedProvider.settingsConfig.models = Object.fromEntries(
          Object.entries(models).map(([key, value]) => [
            `${duplicatedProvider.providerKey}/${key.startsWith(`${provider.id}/`) ? key.slice(provider.id.length + 1) : key}`,
            {
              ...(value as Record<string, unknown>),
              provider: duplicatedProvider.providerKey,
            },
          ]),
        );
        duplicatedProvider.addToLive = false;
      }
    } else if (activeApp === "copilot") {
      // 自带模型卡的 id 就是 providers.json 里的供应商名，副本另起一个；官方卡仍用随机 id。
      // 副本都先不写进 providers.json（官方卡本来就不写）
      if (!isOfficialAccount(activeApp, provider)) {
        // 后端要求供应商名不超过 64 个字符：给「-copy-N」留出位置再截断
        const base =
          normalizeCopilotProviderId(provider.id).slice(
            0,
            COPILOT_PROVIDER_ID_MAX - "-copy-999".length,
          ) || "copilot";
        duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
          base,
          Object.keys(providers),
        );
      }
      duplicatedProvider.addToLive = false;
    }

    await addProvider(duplicatedProvider);
  };

  // 「打开终端」先弹对话框选目录，再由对话框去打开
  const [terminalProvider, setTerminalProvider] = useState<Provider | null>(
    null,
  );
  const handleOpenTerminal = (provider: Provider) => {
    setTerminalProvider(provider);
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
  };

  const renderContent = () => {
    const content = (() => {
      switch (currentView) {
        case "accounts":
          return (
            <div className="px-6 py-4">
              <AuthCenterPanel />
            </div>
          );
        case "usage":
          // 页头、筛选行和滚动区由用量页自己排（上游 S6 版式），外面不再套内边距
          return (
            <UsagePage onOpenRoutingSettings={() => openSettings("routing")} />
          );
        case "apps":
          return (
            <AppsPage
              onOpenAppConfig={(app) => openSettings("appConfig", app)}
            />
          );
        case "settings":
          return (
            <SettingsPage
              section={settingsSection}
              onSectionChange={(section) => {
                setSettingsSection(section);
                setAppConfigScrollTarget(undefined);
              }}
              appConfigScrollTarget={appConfigScrollTarget}
              onImportSuccess={handleImportSuccess}
              onOpenApps={() => setCurrentView("apps")}
              onOpenApp={(app) => {
                setActiveApp(app);
                setCurrentView("providers");
              }}
            />
          );
        case "prompts":
          return (
            <PromptPanel
              key={activeApp}
              ref={promptPanelRef}
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              appId={activeApp}
            />
          );
        case "skills":
        case "skillsDiscovery":
          // 「已安装 / 发现」合成一页；旧的 skillsDiscovery 视图直接打开「发现」段
          return (
            <UnifiedSkillsPanel
              key={currentView}
              initialView={
                currentView === "skillsDiscovery" ? "discover" : "installed"
              }
            />
          );
        case "mcp":
          return <UnifiedMcpPanel />;
        case "universal":
          return (
            <div className="px-6 pt-4">
              <UniversalProviderPanel />
            </div>
          );

        case "sessions":
          return <SessionManagerPage key={activeApp} appId={activeApp} />;
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawEnv":
          return <EnvPanel />;
        case "openclawTools":
          return <ToolsPanel />;
        case "openclawAgents":
          return <AgentsDefaultsPanel />;
        case "hermesMemory":
          return <HermesMemoryPanel />;
        default:
          return (
            <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
              <div
                ref={providerScrollContainerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeApp}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    {(() => {
                      const listProps = {
                        searchOpen: providerSearchOpen,
                        onSearchOpenChange: setProviderSearchOpen,
                        onEdit: (provider: Provider) => {
                          setFormModeView(currentModeView);
                          setEditingProvider(provider);
                        },
                        onDelete: (provider: Provider) =>
                          setConfirmAction({ provider, action: "delete" }),
                        onDuplicate: handleDuplicateProvider,
                        onConfigureUsage: setUsageProvider,
                        onOpenWebsite: handleOpenWebsite,
                        onOpenTerminal:
                          activeApp === "claude" ||
                          activeApp === "codex" ||
                          activeApp === "agy" ||
                          activeApp === "grokbuild" ||
                          activeApp === "copilot"
                            ? handleOpenTerminal
                            : undefined,
                        onCreate: () => openAddProvider(currentModeView),
                      };
                      if (supportsAppMode(activeApp)) {
                        return (
                          <SwitchModePanel
                            key={activeApp}
                            app={activeApp}
                            statusSlot={modeStatusSlot}
                            providers={providers}
                            currentProviderId={currentProviderId}
                            isLoading={isLoading}
                            state={appMode}
                            serviceRunning={isProxyRunning}
                            onSwitch={switchProvider}
                            onViewChange={handleProviderModeViewChange}
                            onOpenRoutingSettings={() => {
                              openSettings("routing");
                            }}
                            {...listProps}
                          />
                        );
                      }
                      return (
                        <ProviderList
                          {...listProps}
                          providers={providers}
                          currentProviderId={currentProviderId}
                          appId={activeApp}
                          isLoading={isLoading}
                          onSwitch={
                            activeApp === "kimi" || activeApp === "copilot"
                              ? (provider: Provider) =>
                                  addNativeProviderToConfig(provider, activeApp)
                              : switchProvider
                          }
                          onRemoveFromConfig={
                            activeApp === "opencode" ||
                            activeApp === "openclaw" ||
                            activeApp === "hermes" ||
                            activeApp === "pi" ||
                            activeApp === "omp" ||
                            activeApp === "mcode" ||
                            activeApp === "kimi" ||
                            activeApp === "dsh" ||
                            activeApp === "copilot"
                              ? (provider) =>
                                  setConfirmAction({
                                    provider,
                                    action: "remove",
                                  })
                              : undefined
                          }
                          onDisableOmo={
                            activeApp === "opencode"
                              ? handleDisableOmo
                              : undefined
                          }
                          onDisableOmoSlim={
                            activeApp === "opencode"
                              ? handleDisableOmoSlim
                              : undefined
                          }
                          onSetAsDefault={
                            activeApp === "openclaw" || activeApp === "opencode"
                              ? setAsDefaultModel
                              : activeApp === "hermes" || activeApp === "kimi"
                                ? (provider: Provider) =>
                                    switchProvider(provider)
                                : undefined
                          }
                        />
                      );
                    })()}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          className="flex flex-1 min-h-0 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Suspense fallback={<PageLoading />}>{content}</Suspense>
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <div
      className={`app-shell ${resourceToolbar ? "resource-toolbar-page" : ""} md:pl-14 flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4`}
      style={{
        overflowX: "hidden",
        paddingTop: `calc(${headerTopOffset}px + var(--web-header-height, ${HEADER_HEIGHT}px))`,
      }}
    >
      <div
        className="fixed top-0 left-0 right-0 z-[60]"
        style={{ height: DRAG_BAR_HEIGHT }}
      />

      {isEnvBannerVisible && (
        <EnvWarningBanner
          conflicts={envConflicts}
          topOffset={DRAG_BAR_HEIGHT}
          onHeightChange={setEnvBannerHeight}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      <header
        className="fixed inset-x-0 md:left-14 z-50 transition-colors duration-300 bg-background/80 backdrop-blur-md"
        style={{
          top: headerTopOffset,
          height: `var(--web-header-height, ${HEADER_HEIGHT}px)`,
        }}
      >
        <div
          data-page-toolbar
          className="flex h-full items-center justify-between gap-2 px-6"
        >
          <div className="flex items-center gap-1">
            {currentView !== "providers" ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("common.back")}
                  onClick={() =>
                    setCurrentView(
                      currentView === "skillsDiscovery"
                        ? "skills"
                        : "providers",
                    )
                  }
                  className="mr-2 rounded-lg"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                {/* 这几页自带上游页头（图标 + 标题 + 操作），外壳的标题只留给读屏，避免显示两遍 */}
                <h1
                  className={cn(
                    "text-lg font-semibold",
                    PAGES_WITH_OWN_HEADER.has(currentView) && "sr-only",
                  )}
                >
                  {currentView === "usage" && t("nav.usage")}
                  {currentView === "accounts" && t("settings.authCenter.title")}
                  {currentView === "apps" && t("nav.apps")}
                  {currentView === "settings" && t("settings.title")}
                  {currentView === "prompts" &&
                    t("prompts.title", { appName: t(`apps.${activeApp}`) })}
                  {currentView === "skills" && t("skills.title")}
                  {currentView === "skillsDiscovery" && t("skills.title")}
                  {currentView === "mcp" && t("mcp.unifiedPanel.title")}
                  {currentView === "universal" &&
                    t("universalProvider.title", {
                      defaultValue: "统一供应商",
                    })}
                  {currentView === "sessions" && t("sessionManager.title")}
                  {currentView === "workspace" && t("workspace.title")}
                  {currentView === "openclawEnv" && t("openclaw.env.title")}
                  {currentView === "openclawTools" && t("openclaw.tools.title")}
                  {currentView === "openclawAgents" &&
                    t("openclaw.agents.title")}
                  {currentView === "hermesMemory" && t("hermes.memory.title")}
                </h1>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {activeApp !== "pi" && activeApp !== "omp" && (
                  <RoutingActivationBrand
                    active={isProxyRunning && isCurrentAppTakeoverActive}
                    contextKey={activeApp}
                    ready={
                      proxyStatus !== undefined && takeoverStatus !== undefined
                    }
                  />
                )}
                {/* 模式连接徽标（上游 v7）：实际生效的模式与那家，不跟随正在查看的页签；窄屏改画在模式行下 */}
                {supportsAppMode(activeApp) && (
                  <div
                    ref={setModeStatusSlot}
                    className="hidden min-w-0 max-w-[16rem] md:flex"
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openSettings("general")}
                  title={t("common.settings")}
                  className="hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Settings className="w-4 h-4" />
                </Button>
                <UpdateBadge onClick={() => openSettings("about")} />
                {isCurrentAppTakeoverActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleViewChange("usage")}
                    title={t("usage.title", {
                      defaultValue: "使用统计",
                    })}
                    className="hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <BarChart2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5">
            {currentView === "providers" &&
              activeApp !== "mcode" &&
              activeApp !== "dsh" &&
              (settingsData?.showProfileSwitcher ?? false) && (
                <div className="flex shrink-0 items-center">
                  <ProfileSwitcher activeApp={activeApp} />
                </div>
              )}
            <div className="flex min-w-0 flex-1 items-center justify-end overflow-hidden">
              {(currentView === "providers" || currentView === "prompts") && (
                <AppSwitcher
                  activeApp={activeApp}
                  onSwitch={setActiveApp}
                  visibleApps={visibleApps}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center">
              <div className="flex shrink-0 items-center gap-1.5 ml-auto">
                {currentView === "accounts" && <RefreshAllQuotaButton />}
                {currentView === "prompts" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => promptPanelRef.current?.openAdd()}
                    className="hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t("prompts.add")}
                  </Button>
                )}
                {currentView === "providers" && (
                  <>
                    {(settingsData?.showProviderSearch ?? true) && (
                      <HoverTip
                        content={t("provider.searchButtonTip", {
                          shortcut: isMac() ? "⌘F" : "Ctrl+F",
                          defaultValue: "搜索供应商（{{shortcut}}）",
                        })}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("provider.searchAriaLabel", {
                            defaultValue: "搜索供应商",
                          })}
                          aria-pressed={providerSearchOpen}
                          onClick={() => setProviderSearchOpen((open) => !open)}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </HoverTip>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 md:hidden"
                          title={t("common.more", "更多")}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-48 md:hidden"
                      >
                        {activeApp === "openclaw" ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("workspace")}
                            >
                              <FolderOpen className="h-4 w-4" />
                              {t("workspace.manage")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("sessions")}
                            >
                              <History className="h-4 w-4" />
                              {t("sessionManager.title")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("openclawEnv")}
                            >
                              <KeyRound className="h-4 w-4" />
                              {t("openclaw.env.title")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("openclawTools")}
                            >
                              <Shield className="h-4 w-4" />
                              {t("openclaw.tools.title")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                handleViewChange("openclawAgents")
                              }
                            >
                              <Cpu className="h-4 w-4" />
                              {t("openclaw.agents.title")}
                            </DropdownMenuItem>
                          </>
                        ) : activeApp === "hermes" ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("skills")}
                            >
                              <Wrench className="h-4 w-4" />
                              {t("skills.manage")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("hermesMemory")}
                            >
                              <Book className="h-4 w-4" />
                              {t("hermes.memory.title")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void openHermesWebUI()}
                            >
                              <LayoutDashboard className="h-4 w-4" />
                              {t("hermes.webui.open")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("mcp")}
                            >
                              <McpIcon size={16} />
                              {t("mcp.title")}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            {hasSkillsSupport && (
                              <DropdownMenuItem
                                onSelect={() => handleViewChange("skills")}
                              >
                                <Wrench className="h-4 w-4" />
                                {t("skills.manage")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("prompts")}
                            >
                              <Book className="h-4 w-4" />
                              {t("prompts.manage")}
                            </DropdownMenuItem>
                            {hasSessionSupport && (
                              <DropdownMenuItem
                                onSelect={() => handleViewChange("sessions")}
                              >
                                <History className="h-4 w-4" />
                                {t("sessionManager.title")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => handleViewChange("mcp")}
                            >
                              <McpIcon size={16} />
                              {t("mcp.title")}
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => openAddProvider(currentModeView)}
                        >
                          <Plus className="h-4 w-4" />
                          {t("header.addProvider")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="hidden items-center gap-1 rounded-xl bg-muted p-1 md:flex">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={
                            activeApp === "openclaw"
                              ? "openclaw"
                              : activeApp === "hermes"
                                ? "hermes"
                                : "default"
                          }
                          className="flex items-center gap-1"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          {activeApp === "openclaw" ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("workspace")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("workspace.manage")}
                              >
                                <FolderOpen className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("sessions")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("sessionManager.title")}
                              >
                                <History className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("openclawEnv")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.env.title")}
                              >
                                <KeyRound className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleViewChange("openclawTools")
                                }
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.tools.title")}
                              >
                                <Shield className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleViewChange("openclawAgents")
                                }
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.agents.title")}
                              >
                                <Cpu className="w-4 h-4" />
                              </Button>
                            </>
                          ) : activeApp === "hermes" ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("skills")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("skills.manage")}
                              >
                                <Wrench className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("hermesMemory")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("hermes.memory.title")}
                              >
                                <Book className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void openHermesWebUI()}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("hermes.webui.open")}
                              >
                                <LayoutDashboard className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("mcp")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("mcp.title")}
                              >
                                <McpIcon size={16} />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("skills")}
                                className={cn(
                                  "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                                  "transition-all duration-200 ease-in-out overflow-hidden",
                                  hasSkillsSupport
                                    ? "opacity-100 w-8 scale-100 px-2"
                                    : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                )}
                                title={t("skills.manage")}
                              >
                                <Wrench className="flex-shrink-0 w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("prompts")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("prompts.manage")}
                              >
                                <Book className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("sessions")}
                                className={cn(
                                  "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                                  "transition-all duration-200 ease-in-out overflow-hidden",
                                  hasSessionSupport
                                    ? "opacity-100 w-8 scale-100 px-2"
                                    : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                )}
                                title={t("sessionManager.title")}
                              >
                                <History className="flex-shrink-0 w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewChange("mcp")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("mcp.title")}
                              >
                                <McpIcon size={16} />
                              </Button>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <Button
                      onClick={() => openAddProvider(currentModeView)}
                      size="icon"
                      aria-label={t("header.addProvider")}
                      title={t("header.addProvider")}
                      className={`ml-2 hidden md:inline-flex ${addActionButtonClass}`}
                    >
                      <Plus className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <WebSidebar
        activeApp={activeApp}
        currentView={currentView}
        visibleApps={visibleApps}
        appOrder={settingsData?.appOrder}
        settingsHasUpdate={hasUpdate}
        onApp={(app) => {
          setActiveApp(app);
          setCurrentView("providers");
        }}
        onView={(view) => {
          // 「设置」上的绿点说的是 CC Switch Web 有新版本，点进去直接到「关于」
          if (view === "settings") {
            openSettings(hasUpdate ? "about" : settingsSection);
            return;
          }
          handleViewChange(view);
        }}
      />

      <main
        ref={mainScrollRef}
        className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in"
      >
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {isHermesView && hermesHealthWarnings.length > 0 && (
          <HermesHealthBanner
            warnings={hermesHealthWarnings}
            onOpenConfig={() => openHermesWebUI("/config")}
          />
        )}
        {renderContent()}
      </main>

      <Suspense fallback={null}>
        {(isAddOpen || hasOpenedAdd) && (
          <AddProviderDialog
            open={isAddOpen}
            onOpenChange={setIsAddOpen}
            appId={activeApp}
            onSubmit={addProvider}
            modeView={formModeView}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {(editingProvider || hasOpenedEdit) && (
          <EditProviderDialog
            open={Boolean(editingProvider)}
            provider={effectiveEditingProvider}
            onOpenChange={(open) => {
              if (!open) {
                setEditingProvider(null);
              }
            }}
            onSubmit={handleEditProvider}
            appId={activeApp}
            isProxyTakeover={isProxyRunning && isCurrentAppTakeoverActive}
            modeView={formModeView}
          />
        )}
      </Suspense>

      {effectiveUsageProvider && (
        <Suspense fallback={null}>
          <UsageScriptModal
            key={effectiveUsageProvider.id}
            provider={effectiveUsageProvider}
            appId={activeApp}
            isOpen={Boolean(usageProvider)}
            onClose={() => setUsageProvider(null)}
            onSave={(script) => {
              if (usageProvider) {
                void saveUsageScript(usageProvider, script);
              }
            }}
          />
        </Suspense>
      )}

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />
      <OpenTerminalDialog
        provider={terminalProvider}
        appId={activeApp}
        onClose={() => setTerminalProvider(null)}
      />
      <ConfirmDialog
        isOpen={pendingLeave !== null}
        title={t("common.unsavedLeaveTitle")}
        message={t("common.unsavedLeaveMessage")}
        confirmText={t("common.unsavedLeaveConfirm")}
        cancelText={t("common.unsavedLeaveCancel")}
        zIndex="top"
        onConfirm={() => {
          const proceed = pendingLeave;
          setPendingLeave(null);
          discardUnsavedChanges();
          proceed?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />
      <FirstRunNoticeDialog />
      <Suspense fallback={null}>
        <DeepLinkImportDialog />
      </Suspense>
    </div>
  );
}

export default App;
