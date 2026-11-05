import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import type { useAppMode } from "@/hooks/useAppMode";
import {
  useAddToFailoverQueue,
  useAutoFailoverEnabled,
  useFailoverQueue,
  useRemoveFromFailoverQueue,
  useSetAutoFailoverEnabled,
} from "@/lib/query/failover";
import { useSettingsQuery } from "@/lib/query/queries";
import { settingsApi } from "@/lib/api/settings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getRoutingReason } from "@/utils/routingReason";
import { routeSwitchNotification } from "@/utils/routeSwitchNotification";
import { cn } from "@/lib/utils";
import { sortProvidersByName } from "@/utils/providerSort";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { HoverTip } from "@/components/ui/hover-tip";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { ProviderList } from "@/components/providers/ProviderList";
import { CodexStaleClientsNotice } from "@/components/providers/CodexStaleClientsNotice";
import {
  fromModeView,
  toModeView,
  type ModeView,
} from "@/components/providers/presentation";
import { RouteSettingsSheet } from "./RouteSettingsSheet";
import { StackSettingsSheet } from "./StackSettingsSheet";
import {
  sameStackSubagent,
  stackSubagentSettings,
  stackSubagentValue,
  type StackSubagentValue,
} from "./StackSubagentFields";
import { ModeTabs, MODE_TONE } from "./ModeTabs";
import { ModeDialog, type ModeDialogState } from "./ModeDialog";

type ListCallbacks = Pick<
  React.ComponentProps<typeof ProviderList>,
  | "onEdit"
  | "onDelete"
  | "onDuplicate"
  | "onConfigureUsage"
  | "onOpenWebsite"
  | "onOpenTerminal"
  | "onCreate"
  | "searchOpen"
  | "onSearchOpenChange"
>;

interface SwitchModePanelProps extends ListCallbacks {
  app: AppId;
  /** 页头里给连接徽标留的位置（窄屏不显示页头徽标，徽标改画在模式行里） */
  statusSlot?: HTMLElement | null;
  providers: Record<string, Provider>;
  currentProviderId: string;
  isLoading: boolean;
  /** useAppMode 的结果：模式视图与切换动作（同一个查询，App 也用它决定页头按钮） */
  state: ReturnType<typeof useAppMode>;
  /** 路由服务在跑：路由页的故障转移队列显示健康状态 */
  serviceRunning: boolean;
  onSwitch: (
    provider: Provider,
    options?: { acknowledgedRouting?: boolean },
  ) => unknown;
  /** 报告正在看的那格：App 打开新增 / 编辑时按它选表单布局（上游 fe831f0a） */
  onViewChange?: (app: AppId, view: ModeView) => void;
  /** 路由设置里的「更多路由设置」：去设置页的本地路由分组 */
  onOpenRoutingSettings?: () => void;
}

/** 这几个客户端只在启动时读配置：改写了客户端文件要提示重启（Claude Code 会自己重读）。 */
const RESTART_TO_APPLY = new Set<AppId>([
  "codex",
  "gemini",
  "grokbuild",
  "claude-desktop",
]);

/** Gemini CLI、Grok Build 没有聚合模式：那一格隐藏，前两格位置不变。 */
const modesFor = (app: AppId): ModeView[] =>
  app === "claude" || app === "codex" || app === "claude-desktop"
    ? ["direct", "route", "stack"]
    : ["direct", "route"];

/**
 * 切换式应用的供应商页（上游 v7）：模式行 → 通知 → 按正在查看的模式分区的列表。
 * 页签只负责查看；要生效必须点写明后果的按钮（确认框），回到直连也一样。
 */
export function SwitchModePanel({
  app,
  statusSlot,
  providers,
  currentProviderId,
  isLoading,
  state,
  serviceRunning,
  onSwitch,
  onViewChange,
  onOpenRoutingSettings,
  ...listCallbacks
}: SwitchModePanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const appName = APP_DISPLAY_NAME[app];
  const modes = modesFor(app);
  const modeView = state.data;
  const rawActive = modeView ? toModeView(modeView.mode) : "direct";
  const active: ModeView = modes.includes(rawActive) ? rawActive : "direct";
  const directId = modeView?.directProviderId ?? null;
  const routeId = modeView?.routeProviderId ?? null;

  // 离开页面再回来、或生效的模式变了，一律落在生效的那格（「查看中」不持久化）
  const [view, setView] = useState<ModeView>(active);
  const [searchSlot, setSearchSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setView(active);
  }, [app, active]);
  useEffect(() => {
    onViewChange?.(app, view);
  }, [app, view, onViewChange]);

  // Claude Desktop 没有故障转移
  const hasFailover = app !== "claude-desktop";
  const { data: failoverEnabled = false } = useAutoFailoverEnabled(
    app,
    hasFailover,
  );
  const { data: queue } = useFailoverQueue(app, hasFailover);
  const setFailover = useSetAutoFailoverEnabled();
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();
  const failoverOn = active === "route" && failoverEnabled;

  const [dialog, setDialog] = useState<ModeDialogState | null>(null);
  const [routeSettingsOpen, setRouteSettingsOpen] = useState(false);
  const [stackSettingsOpen, setStackSettingsOpen] = useState(false);
  const [confirmFailover, setConfirmFailover] = useState(false);
  // 关掉的是哪一份提示（后端的 staleRevision）：目录或登录又变了就是新的一份，重新显示。
  const [staleDismissed, setStaleDismissed] = useState<string | null>(null);
  const stale = modeView?.aggregation.staleClients;
  const staleRevision = modeView?.aggregation.staleRevision ?? "";

  // 确认框里的候选按显示名称 A–Z
  const providerList = useMemo(
    () => sortProvidersByName(Object.values(providers)),
    [providers],
  );
  const nameOf = (id: string | null) =>
    (id && providers[id]?.name) || t("mode.noProvider");

  const members = modeView?.aggregation.members ?? [];
  const stackMembers = useMemo(() => {
    const map = new Map<string, number>();
    for (const member of members) {
      map.set(member.providerId, member.modelIds.length);
    }
    return map;
  }, [members]);

  const queueIds = useMemo(
    () => (queue ?? []).map((item) => item.providerId),
    [queue],
  );

  const setDefault = (provider: Provider) => {
    void state
      .setRoute(provider.id)
      .then((result) =>
        toast.success(routeSwitchNotification(result, app, provider.name, t), {
          closeButton: true,
        }),
      )
      .catch(() => {});
  };

  const switchMode = {
    active,
    view,
    directId,
    routeId,
    failoverOn,
    queue: queueIds,
    stackMembers,
    serviceRunning,
    routingReason: (provider: Provider) =>
      getRoutingReason(app, provider, t) ?? "",
    actions: {
      switchDirect: (provider: Provider) => void onSwitch(provider),
      needsRouteDialog: (provider: Provider) =>
        setDialog({
          kind: "needsRoute",
          providerId: provider.id,
          reason: getRoutingReason(app, provider, t) ?? "",
        }),
      exitAndUse: (provider: Provider) =>
        setDialog({ kind: "exit", useProviderId: provider.id }),
      routeTo: (provider: Provider) => void onSwitch(provider),
      queueAdd: (provider: Provider) =>
        addToQueue.mutate({ appType: app, providerId: provider.id }),
      queueRemove: (provider: Provider) =>
        removeFromQueue.mutate({ appType: app, providerId: provider.id }),
      stackAdd: (provider: Provider) =>
        void state
          .change({ kind: "member", id: provider.id, enabled: true })
          .catch(() => {}),
      stackRemove: (provider: Provider) =>
        void state
          .change({ kind: "member", id: provider.id, enabled: false })
          .catch(() => {}),
      // 聚合生效时换默认当场生效；没生效时只记下选择，切换时的确认框预选它
      stackSetDefault: setDefault,
    },
  };

  // 页头始终显示实际生效的连接，不跟随正在浏览的模式页签。
  const routeTarget = failoverOn ? t("mode.status.byQueue") : nameOf(routeId);
  const otherMembers = members.filter((m) => m.providerId !== routeId);
  const otherModels = otherMembers.reduce(
    (sum, member) => sum + member.modelIds.length,
    0,
  );
  const status =
    active === "direct"
      ? { lead: t("mode.status.directLead"), value: nameOf(directId) }
      : active === "route"
        ? { lead: t("mode.status.routeLead"), value: routeTarget }
        : {
            lead: t("mode.status.stackLead"),
            value: t("mode.status.stackValue", {
              name: nameOf(routeId),
              count: otherMembers.length,
              models: otherModels,
            }),
          };
  const attached = active === "direct" || Boolean(modeView?.attached);
  const connected =
    active === "direct"
      ? Boolean(directId && providers[directId])
      : attached && Boolean(routeId && providers[routeId]);

  const restartHint = RESTART_TO_APPLY.has(app)
    ? t("mode.toast.restartHint", { app: appName })
    : "";

  const handleFailoverChange = (enabled: boolean) => {
    if (enabled && !settings?.failoverConfirmed) {
      setConfirmFailover(true);
      return;
    }
    setFailover.mutate({ appType: app, enabled });
  };

  const confirmFailoverOn = async () => {
    setConfirmFailover(false);
    try {
      const current = await settingsApi.get();
      await settingsApi.save({ ...current, failoverConfirmed: true });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (error) {
      console.error(
        "[SwitchModePanel] Failed to save failover confirmation",
        error,
      );
    }
    setFailover.mutate({ appType: app, enabled: true });
  };

  const enterMode = async (
    target: Exclude<ModeView, "direct">,
    pick: string,
    subagent?: StackSubagentValue,
  ) => {
    // 框里改了子代理设置就先存（聚合还没生效时后端只存不写），进入聚合时随契约一起写进去
    if (
      subagent &&
      !sameStackSubagent(subagent, stackSubagentValue(settings))
    ) {
      const current = await settingsApi.get();
      await settingsApi.save({
        ...current,
        ...stackSubagentSettings(subagent),
      });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
    await state.change({
      kind: "mode",
      mode: fromModeView(target),
      route: pick,
      quiet: true,
    });
    toast.success(
      target === "route"
        ? // Desktop 的模型列表也换成了路由那家的，要重启才看得到
          t("mode.toast.enteredRoute", {
            app: appName,
            provider: nameOf(pick),
          }) + (app === "claude-desktop" ? restartHint : "")
        : t(
            app === "codex"
              ? "mode.toast.enteredStack"
              : app === "claude-desktop"
                ? "mode.toast.enteredStackDesktop"
                : "mode.toast.enteredStackLive",
            { app: appName },
          ),
      { closeButton: true },
    );
  };

  const exitToDirect = async (useProviderId?: string) => {
    await state.change({ kind: "mode", mode: "direct", quiet: true });
    // 回到直连后改用另一家：直连切换到它
    const target = useProviderId ? providers[useProviderId] : undefined;
    if (target && useProviderId !== directId) await onSwitch(target);
    toast.success(
      [
        t("mode.toast.exited", {
          app: appName,
          provider: nameOf(useProviderId ?? directId),
        }),
        restartHint,
      ]
        .filter(Boolean)
        .join(""),
      { closeButton: true },
    );
  };

  const notices: React.ReactNode[] = [];
  if (active !== "direct" && modeView && !modeView.attached) {
    notices.push(
      <Notice
        key="detached"
        tone="warning"
        title={t("mode.notice.serviceDown", {
          app: appName,
          mode: t(`mode.names.${active}`),
        })}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={state.pending}
              onClick={() =>
                setDialog({
                  kind: "enter",
                  target: active as Exclude<ModeView, "direct">,
                })
              }
            >
              {t("common.retry")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={state.pending}
              onClick={() => setDialog({ kind: "exit" })}
            >
              {t("mode.notice.backToDirect")}
            </Button>
          </>
        }
      />,
    );
  }
  if (modeView?.startupError) {
    notices.push(
      <Notice
        key="startup"
        tone="warning"
        title={t("webMode.startupFailed", { error: modeView.startupError })}
      />,
    );
  }
  const stackNotice = modeView?.aggregation.notice;
  if (view === "stack" && active === "stack" && stackNotice) {
    notices.push(
      <Notice
        key="stackNotice"
        tone="warning"
        title={t(`webMode.notice.${stackNotice}`)}
        actions={
          app === "codex" && stackNotice === "routeOwnsCatalog" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={state.pending}
              onClick={() => {
                void state
                  .change({ kind: "adoptCatalog" })
                  .then(() => toast.success(t("webMode.adoptCatalogDone")))
                  .catch(() => {});
              }}
            >
              {t("webMode.adoptCatalog")}
            </Button>
          ) : undefined
        }
      >
        {modeView?.aggregation.noticeReasons?.length
          ? modeView.aggregation.noticeReasons.map((reason) => (
              <span key={reason} className="block">
                {t(`webMode.noticeReason.${reason}`)}
              </span>
            ))
          : undefined}
      </Notice>,
    );
  }
  if (
    app === "codex" &&
    stale &&
    (stale.daemon || stale.others || stale.unverified) &&
    staleDismissed !== staleRevision
  ) {
    notices.push(
      <CodexStaleClientsNotice
        key="stale"
        staleClients={stale}
        pending={state.pending}
        onRestartDaemon={() => state.change({ kind: "restartDaemon" })}
        onDismiss={() => {
          if (stale.unverified) {
            void state.change({ kind: "acknowledgeStale" }).catch(() => {});
          }
          setStaleDismissed(staleRevision);
        }}
      />,
    );
  }
  if (view !== active) {
    const cta =
      view === "route"
        ? t("mode.activate.route")
        : view === "stack"
          ? t("mode.activate.stack")
          : t("mode.activate.direct");
    const eligibleCount = modeView?.eligibleProviderIds.length ?? 0;
    // Web 原有的补充说明：聚合建议以官方账号做默认；Desktop 经路由时的限制
    const extra =
      view === "stack"
        ? t("webMode.officialDefaultAdvice")
        : app === "claude-desktop" && view === "route"
          ? t("webMode.desktopRouteNote")
          : undefined;
    notices.push(
      <Notice
        key="activate"
        tone="neutral"
        title={t("mode.activate.viewing", {
          view: t(`mode.names.${view}`),
          app: appName,
          active: t(`mode.names.${active}`),
        })}
        actions={
          <Button
            size="sm"
            disabled={
              state.pending || (view !== "direct" && eligibleCount === 0)
            }
            onClick={() =>
              setDialog(
                view === "direct"
                  ? { kind: "exit" }
                  : { kind: "enter", target: view },
              )
            }
          >
            {cta}
          </Button>
        }
      >
        {extra}
      </Notice>,
    );
  }

  const badge = (
    <HoverTip content={`${status.lead} ${status.value}`}>
      <span
        tabIndex={0}
        aria-label={`${status.lead} ${status.value}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border-default bg-background/80 px-2.5 py-0.5 text-sm"
      >
        <span
          aria-hidden="true"
          data-testid="app-mode-status-dot"
          className={cn(
            "me-1 h-1.5 w-1.5 shrink-0 rounded-full",
            connected ? MODE_TONE[active].dot : "bg-muted-foreground/40",
          )}
        />
        <span className="shrink-0 text-muted-foreground">
          {t(`mode.names.${active}`)}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="min-w-0 truncate font-medium text-foreground">
          {active === "stack" ? nameOf(routeId) : status.value}
        </span>
      </span>
    </HoverTip>
  );

  const subagentModels = (modeView?.aggregation.subagentModels ?? []).filter(
    (model) => model.providerId !== routeId,
  );

  return (
    <div className="space-y-3">
      {statusSlot && createPortal(badge, statusSlot)}
      {state.isError ? (
        <div role="alert" className="flex items-center gap-2 py-3 text-sm">
          <span>{t("webMode.loadFailed")}</span>
          <Button variant="ghost" onClick={() => void state.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <>
          <ModeTabs
            modes={modes}
            active={active}
            view={view}
            onView={setView}
            searchSlotRef={setSearchSlot}
            failover={
              hasFailover && view === "route" && active === "route"
                ? {
                    enabled: failoverEnabled,
                    disabled: setFailover.isPending,
                    onChange: handleFailoverChange,
                  }
                : undefined
            }
            onOpenRouteSettings={
              hasFailover && view === "route" && active === "route"
                ? () => setRouteSettingsOpen(true)
                : undefined
            }
            onOpenStackSettings={
              app === "codex" && view === "stack" && active === "stack"
                ? () => setStackSettingsOpen(true)
                : undefined
            }
          />
          {/* 窄屏页头放不下徽标：改画在模式行下面 */}
          {modeView && (
            <div className={cn("flex", statusSlot && "md:hidden")}>{badge}</div>
          )}
          {notices.length > 0 && (
            <div role="status" className="flex flex-col gap-2">
              {notices}
            </div>
          )}
        </>
      )}
      <ProviderList
        {...listCallbacks}
        providers={providers}
        currentProviderId={currentProviderId}
        appId={app}
        isLoading={isLoading}
        onSwitch={(provider) => void onSwitch(provider)}
        switchMode={switchMode}
        searchSlot={state.isError ? undefined : searchSlot}
      />

      <ModeDialog
        app={app}
        state={dialog}
        active={active}
        providers={providerList}
        directId={directId}
        eligibleIds={modeView?.eligibleProviderIds ?? []}
        defaultPick={routeId ?? directId}
        stackMembers={members.map((member) => ({
          id: member.providerId,
          name: nameOf(member.providerId),
          models: member.memberModels ?? member.modelIds.length,
        }))}
        stackSubagent={
          app === "codex"
            ? {
                models: modeView?.aggregation.subagentModels ?? [],
                value: stackSubagentValue(settings),
              }
            : undefined
        }
        onClose={() => setDialog(null)}
        onEnter={enterMode}
        onExit={exitToDirect}
        onSwitchDirect={(providerId) => {
          const provider = providers[providerId];
          if (provider) void onSwitch(provider, { acknowledgedRouting: true });
        }}
      />

      {hasFailover && (
        <RouteSettingsSheet
          app={app}
          open={routeSettingsOpen}
          onOpenChange={setRouteSettingsOpen}
          onOpenSettings={onOpenRoutingSettings}
        />
      )}
      {app === "codex" && (
        <StackSettingsSheet
          open={stackSettingsOpen}
          onOpenChange={setStackSettingsOpen}
          models={subagentModels}
          routeOfficial={
            !!routeId && providers[routeId]?.category === "official"
          }
        />
      )}
      <ConfirmDialog
        isOpen={confirmFailover}
        variant="info"
        title={t("confirm.failover.title")}
        message={t("confirm.failover.message")}
        confirmText={t("confirm.failover.confirm")}
        onConfirm={() => void confirmFailoverOn()}
        onCancel={() => setConfirmFailover(false)}
      />
    </div>
  );
}
