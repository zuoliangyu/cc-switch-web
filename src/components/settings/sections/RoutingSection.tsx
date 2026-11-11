import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";
import type { AppId } from "@/lib/api";
import { proxyApi } from "@/lib/api/proxy";
import { useProvidersQuery } from "@/lib/query";
import {
  useGlobalProxyConfig,
  useProxyClientHost,
  useProxyStatusQuery,
  useRestartProxyService,
  useSetProxyClientHost,
  useUpdateGlobalProxyConfig,
} from "@/lib/query/proxy";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip, DisabledReason } from "@/components/ui/help-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AutoFailoverConfigPanel } from "@/components/proxy/AutoFailoverConfigPanel";
import { RectifierConfigPanel } from "@/components/settings/RectifierConfigPanel";
import { APP_DISPLAY_NAME, AppGlyph } from "@/components/shell/AppGlyph";
import { MODE_TONE } from "@/components/providers/mode/ModeTabs";
import { toModeView } from "@/components/providers/presentation";
import {
  SettingsBlock,
  SettingsCard,
  SettingsRow,
  SettingsSwitchRow,
} from "@/components/settings/SettingsLayout";
import { cn } from "@/lib/utils";
import { appModeQueryKey } from "@/lib/query/appModeKeys";

/** 有故障转移与路由设置的应用；Claude Desktop 经同一个路由服务转发，但没有故障转移。 */
const PROXY_APP_IDS = ["claude", "codex", "gemini", "grokbuild"] as const;
type ProxyAppId = (typeof PROXY_APP_IDS)[number];

/** 有直连 / 路由模式的应用：上面四个加 Claude Desktop。 */
const MODE_APP_IDS: AppId[] = [...PROXY_APP_IDS, "claude-desktop"];

interface RoutingSectionProps {
  /** 「前往」打开这个应用的供应商页 */
  onOpenApp: (app: AppId) => void;
}

const isValidListenAddress = (address: string): boolean => {
  if (address === "localhost" || address === "0.0.0.0") return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    return address.split(".").every((part) => Number(part) <= 255);
  }
  // IPv6 字面量：必须含 `:` 且能在 [..] 包装后被 URL 解析器接受（后端会把 `::` 改写成 `::1`）
  if (!address.includes(":")) return false;
  try {
    new URL(`http://[${address}]/`);
    return true;
  } catch {
    return false;
  }
};

/** 客户端地址：空（按监听地址）、IP 或主机名；`0.0.0.0` / `::` 客户端连不上 */
const isValidClientHost = (host: string): boolean => {
  if (host === "") return true;
  if (host === "0.0.0.0" || host === "::") return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return isValidListenAddress(host);
  }
  return /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
    host,
  );
};

/** 没设客户端地址时写给客户端的主机，和后端 `proxy_origin` 一致 */
const defaultClientHost = (listenAddress: string): string =>
  listenAddress === "0.0.0.0"
    ? "127.0.0.1"
    : listenAddress === "::"
      ? "::1"
      : listenAddress;

/** 服务地址（IPv6 加方括号），复制给需要手动接入的客户端 */
const formatServiceUrl = (address: string, port: number): string =>
  `http://${address.includes(":") ? `[${address}]` : address}:${port}`;

function formatUptime(seconds: number, t: TFunction) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? t("routingSettings.uptimeHours", { hours, minutes })
    : t("routingSettings.uptimeMinutes", { minutes: Math.max(minutes, 0) });
}

/**
 * 设置 → 本地路由（上游 v7）：服务（状态、统计、启停、监听地址、连接地址、请求日志）
 * → 正在使用路由的应用 → 全部回到直连 → 故障转移参数 → 整流与优化。
 * 进出路由与故障转移队列在各应用页的模式页签里。
 */
export function RoutingSection({ onOpenApp }: RoutingSectionProps) {
  const { t } = useTranslation();
  const { data: status } = useProxyStatusQuery();
  const running = status?.running ?? false;
  const { startProxyServer, stopWithRestore, isPending } = useProxyStatus();
  const { data: config } = useGlobalProxyConfig();
  const updateConfig = useUpdateGlobalProxyConfig();
  const restartService = useRestartProxyService();
  const { data: savedClientHost } = useProxyClientHost();
  const saveClientHostMutation = useSetProxyClientHost();
  const [address, setAddress] = useState("127.0.0.1");
  const [port, setPort] = useState("15721");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);
  const [clientHost, setClientHost] = useState("");
  const [clientHostError, setClientHostError] = useState<string | null>(null);
  const [confirmExitAll, setConfirmExitAll] = useState(false);
  const [failoverApp, setFailoverApp] = useState<ProxyAppId>("claude");

  useEffect(() => {
    if (config) {
      setAddress(config.listenAddress);
      setPort(String(config.listenPort));
    }
  }, [config]);

  useEffect(() => {
    if (savedClientHost !== undefined) setClientHost(savedClientHost);
  }, [savedClientHost]);

  const modeQueries = useQueries({
    queries: MODE_APP_IDS.map((app) => ({
      queryKey: appModeQueryKey(app),
      queryFn: () => proxyApi.getAppMode(app),
    })),
  });
  const providerQueries: Partial<
    Record<AppId, ReturnType<typeof useProvidersQuery>["data"]>
  > = {
    claude: useProvidersQuery("claude").data,
    codex: useProvidersQuery("codex").data,
    gemini: useProvidersQuery("gemini").data,
    grokbuild: useProvidersQuery("grokbuild").data,
    "claude-desktop": useProvidersQuery("claude-desktop").data,
  };

  const usingApps = MODE_APP_IDS.flatMap((app, index) => {
    const view = modeQueries[index]?.data;
    if (!view || view.mode === "direct") return [];
    const routeName =
      (view.routeProviderId &&
        providerQueries[app]?.providers[view.routeProviderId]?.name) ||
      "—";
    return [{ app, mode: toModeView(view.mode), routeName }];
  });
  const usingCount = usingApps.length;

  const listenDirty =
    !!config &&
    (address.trim() !== config.listenAddress ||
      port.trim() !== String(config.listenPort));
  const savingListen = updateConfig.isPending || restartService.isPending;

  const saveListen = async () => {
    if (!config) return;
    const trimmed = address.trim();
    const portValue = Number(port.trim());
    const addressOk = isValidListenAddress(trimmed);
    const portOk =
      /^\d+$/.test(port.trim()) && portValue >= 1024 && portValue <= 65535;
    setAddressError(addressOk ? null : t("proxy.settings.invalidAddress"));
    setPortError(portOk ? null : t("proxy.settings.invalidPort"));
    if (!addressOk || !portOk) return;
    const next = {
      ...config,
      listenAddress: trimmed === "localhost" ? "127.0.0.1" : trimmed,
      listenPort: portValue,
    };
    try {
      // 运行中改地址要重启服务才生效；绑定失败时后端恢复原地址
      if (running) {
        await restartService.mutateAsync(next);
        toast.success(t("proxy.settings.configSaved"), { closeButton: true });
      } else {
        await updateConfig.mutateAsync(next);
      }
    } catch {
      if (running) toast.error(t("proxy.settings.configSaveFailed"));
      // 未运行时 useUpdateGlobalProxyConfig 的 onError 已经弹过 toast
    }
  };

  const saveClientHost = async () => {
    const trimmed = clientHost.trim();
    const ok = isValidClientHost(trimmed);
    setClientHostError(ok ? null : t("routingSettings.clientHostInvalid"));
    if (!ok) return;
    try {
      await saveClientHostMutation.mutateAsync(trimmed);
    } catch {
      // useSetProxyClientHost 的 onSuccess / onError 已经弹过 toast
    }
  };

  const toggleLogging = async (enabled: boolean) => {
    if (!config) return;
    try {
      await updateConfig.mutateAsync({ ...config, enableLogging: enabled });
    } catch {
      toast.error(t("proxy.logging.failed"));
    }
  };

  const stopReason =
    running && usingCount > 0 ? t("routingSettings.stopBlocked") : undefined;
  const serviceUrl =
    running && status ? formatServiceUrl(status.address, status.port) : null;

  return (
    <>
      <SettingsBlock title={t("routingSettings.service")}>
        <SettingsCard>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                {t("routingSettings.serviceName")}
                <HelpTip title={t("routingSettings.serviceName")}>
                  {t("routingSettings.serviceHelp")}
                </HelpTip>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    running ? "bg-emerald-500" : "bg-muted-foreground/50",
                  )}
                />
                {running
                  ? t("routingSettings.runningFor", {
                      uptime: formatUptime(status?.uptime_seconds ?? 0, t),
                    })
                  : t("routingSettings.stopped")}
              </div>
            </div>
            {running && (
              <dl className="flex gap-6 text-end">
                {[
                  [
                    t("routingSettings.totalRequests"),
                    status?.total_requests ?? 0,
                  ],
                  [
                    t("routingSettings.successRate"),
                    `${(status?.success_rate ?? 0).toFixed(1)}%`,
                  ],
                  [
                    t("routingSettings.activeConnections"),
                    status?.active_connections ?? 0,
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="m-0 text-base font-semibold tabular-nums text-foreground">
                      {typeof value === "number"
                        ? value.toLocaleString()
                        : value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {running ? (
              <DisabledReason reason={stopReason} align="end">
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => void stopWithRestore()}
                >
                  {t("routingSettings.stop")}
                </Button>
              </DisabledReason>
            ) : (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => void startProxyServer()}
              >
                {t("routingSettings.start")}
              </Button>
            )}
          </div>

          {serviceUrl && (
            <SettingsRow
              label={t("proxy.panel.serviceAddress")}
              description={serviceUrl}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(serviceUrl).then(() =>
                      toast.success(t("proxy.panel.addressCopied"), {
                        closeButton: true,
                      }),
                    );
                  }}
                >
                  {t("common.copy")}
                </Button>
              }
            />
          )}

          <SettingsRow
            label={t("routingSettings.listen")}
            help={{
              title: t("routingSettings.listen"),
              body: t("webMode.rebindHint"),
            }}
            control={
              <div className="flex flex-wrap items-start gap-3">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-muted-foreground">
                    {t("routingSettings.address")}
                  </span>
                  <Input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    aria-invalid={addressError ? true : undefined}
                    className="w-[150px]"
                  />
                  <span
                    className={cn(
                      "block text-xs",
                      addressError
                        ? "text-destructive"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {addressError ?? t("routingSettings.addressHint")}
                  </span>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-muted-foreground">
                    {t("routingSettings.port")}
                  </span>
                  <Input
                    value={port}
                    inputMode="numeric"
                    onChange={(event) => setPort(event.target.value)}
                    aria-invalid={portError ? true : undefined}
                    className="w-[96px]"
                  />
                  <span
                    className={cn(
                      "block text-xs",
                      portError
                        ? "text-destructive"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {portError ?? "1024–65535"}
                  </span>
                </label>
                <Button
                  variant="outline"
                  // 和输入框顶边对齐：上面的小标题 18 + 间距 4
                  className="mt-[22px]"
                  disabled={!listenDirty || savingListen}
                  onClick={() => void saveListen()}
                >
                  {savingListen && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("routingSettings.saveAndRestart")}
                </Button>
              </div>
            }
          />
          <SettingsRow
            label={t("routingSettings.clientHost")}
            help={{
              title: t("routingSettings.clientHost"),
              body: t("routingSettings.clientHostHelp"),
            }}
            control={
              <div className="flex flex-wrap items-start gap-3">
                <label className="space-y-1">
                  <Input
                    value={clientHost}
                    placeholder={defaultClientHost(
                      config?.listenAddress ?? "127.0.0.1",
                    )}
                    onChange={(event) => setClientHost(event.target.value)}
                    aria-label={t("routingSettings.clientHost")}
                    aria-invalid={clientHostError ? true : undefined}
                    className="w-full max-w-[262px] sm:w-[262px]"
                  />
                  <span
                    className={cn(
                      "block text-xs",
                      clientHostError
                        ? "text-destructive"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {clientHostError ?? t("routingSettings.clientHostHint")}
                  </span>
                </label>
                <Button
                  variant="outline"
                  disabled={
                    savedClientHost === undefined ||
                    saveClientHostMutation.isPending
                  }
                  onClick={() => void saveClientHost()}
                >
                  {t("common.save")}
                </Button>
              </div>
            }
          />
          <SettingsSwitchRow
            label={t("routingSettings.logging")}
            help={{
              title: t("routingSettings.logging"),
              body: t("routingSettings.loggingHelp"),
            }}
            checked={config?.enableLogging ?? false}
            disabled={!config}
            onCheckedChange={(value) => void toggleLogging(value)}
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock
        title={t("routingSettings.usingApps", { count: usingCount })}
      >
        {usingCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground/70">
            {t("routingSettings.noApps")}
          </div>
        ) : (
          <SettingsCard>
            {usingApps.map(({ app, mode, routeName }) => (
              <UsingAppRow
                key={app}
                app={app}
                modeLabel={t(`mode.names.${mode}`)}
                dotClass={MODE_TONE[mode].dot}
                detail={
                  mode === "stack"
                    ? t("routingSettings.stackDetail", { name: routeName })
                    : t("routingSettings.routeDetail", { name: routeName })
                }
                onOpen={() => onOpenApp(app)}
              />
            ))}
          </SettingsCard>
        )}
        {usingApps.length > 0 && (
          <Button variant="outline" onClick={() => setConfirmExitAll(true)}>
            {t("routingSettings.exitAll")}
          </Button>
        )}
      </SettingsBlock>

      <SettingsBlock
        id="settings-failover"
        title={t("settings.advanced.failover.title")}
        help={{
          title: t("settings.advanced.failover.title"),
          body: t("routingSettings.failoverHelp"),
        }}
      >
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <SegmentedControl
            size="sm"
            aria-label={t("settings.advanced.failover.title")}
            value={failoverApp}
            onValueChange={setFailoverApp}
            className="max-w-full overflow-x-auto"
            items={PROXY_APP_IDS.map((app) => ({
              value: app,
              label: APP_DISPLAY_NAME[app],
            }))}
          />
          <AutoFailoverConfigPanel key={failoverApp} appType={failoverApp} />
        </div>
      </SettingsBlock>

      <SettingsBlock
        title={t("settings.advanced.rectifier.title")}
        help={{
          title: t("settings.advanced.rectifier.title"),
          body: t("settings.advanced.rectifier.description"),
        }}
      >
        <div className="rounded-xl border border-border bg-card p-5">
          <RectifierConfigPanel />
        </div>
      </SettingsBlock>

      {/* 可恢复的操作（路由目标、队列、聚合名单都保留），不用红色 */}
      <ConfirmDialog
        isOpen={confirmExitAll}
        variant="info"
        title={t("routingSettings.exitAllTitle")}
        message={t("routingSettings.exitAllMessage")}
        confirmText={t("routingSettings.exitAllConfirm")}
        onConfirm={() => {
          setConfirmExitAll(false);
          void stopWithRestore();
        }}
        onCancel={() => setConfirmExitAll(false)}
      />
    </>
  );
}

function UsingAppRow({
  app,
  modeLabel,
  dotClass,
  detail,
  onOpen,
}: {
  app: AppId;
  modeLabel: string;
  dotClass: string;
  detail: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <AppGlyph app={app} size={18} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {APP_DISPLAY_NAME[app]}
          <span className="text-muted-foreground/70">·</span>
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", dotClass)}
          />
          <span className="font-normal text-muted-foreground">{modeLabel}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        {t("routingSettings.goTo")}
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
