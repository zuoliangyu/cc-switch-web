import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Plug, Route } from "lucide-react";
import { toast } from "sonner";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import type { AppMode } from "@/types/proxy";
import type { useAppMode } from "@/hooks/useAppMode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { sortProvidersByName } from "@/utils/providerSort";
import { extractErrorMessage } from "@/utils/errorUtils";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { CodexStackSettings } from "./CodexStackSettings";

/** 状态徽标里各模式的圆点颜色 */
const MODE_DOT: Record<AppMode, string> = {
  direct: "bg-emerald-500",
  routing: "bg-sky-500",
  aggregation: "bg-violet-500",
};

/** 回到直连时改写的客户端文件（确认框里写明，用默认位置）。 */
const CLIENT_FILE: Partial<Record<AppId, string>> = {
  claude: "~/.claude/settings.json",
  codex: "~/.codex/config.toml",
  gemini: "~/.gemini/.env",
  grokbuild: "~/.grok/config.toml",
};

export function AppModePanel({
  app,
  providers,
  state,
}: {
  app: AppId;
  providers: Record<string, Provider>;
  state: ReturnType<typeof useAppMode>;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<AppMode | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [route, setRoute] = useState("");
  // 关掉的旧客户端提示：同一份（revision 相同）不再显示，目录或登录又变了才重新出现
  const [dismissedStale, setDismissedStale] = useState<string | null>(null);
  const active = state.data?.mode ?? "direct";
  const selected = view ?? active;
  const choices = sortProvidersByName(Object.values(providers)).filter((p) =>
    state.data?.eligibleProviderIds.includes(p.id),
  );
  const modes: AppMode[] =
    app === "claude" || app === "codex" || app === "claude-desktop"
      ? ["direct", "routing", "aggregation"]
      : ["direct", "routing"];
  if (state.isError)
    return (
      <div role="alert" className="py-3 text-sm">
        <span>{t("webMode.loadFailed")}</span>
        <Button variant="ghost" onClick={() => void state.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (!state.data) return null;
  const inUseId =
    active === "direct"
      ? state.data.directProviderId
      : state.data.routeProviderId;
  const connected =
    !!inUseId &&
    !!providers[inUseId] &&
    (active === "direct" || state.data.attached);
  const stale = state.data.aggregation.staleClients;
  const staleRevision = state.data.aggregation.staleRevision ?? "";
  const showStale = !!stale && dismissedStale !== staleRevision;
  const dismissStale = () => {
    if (stale?.unverified) {
      void state.change({ kind: "acknowledgeStale" }).catch(() => {});
    }
    setDismissedStale(staleRevision);
  };
  const routeId = state.data.routeProviderId;
  // 默认那家不发布 `ccs-*` 模型，选了也写不进去
  const subagentModels = (state.data.aggregation.subagentModels ?? []).filter(
    (model) => model.providerId !== routeId,
  );
  const directName = state.data.directProviderId
    ? (providers[state.data.directProviderId]?.name ??
      state.data.directProviderId)
    : t("webMode.noProvider");
  const exitNotes = [
    CLIENT_FILE[app]
      ? t("webMode.exit.noteFile", {
          file: CLIENT_FILE[app],
          provider: directName,
        })
      : t("webMode.exit.noteDesktop", { provider: directName }),
    active === "aggregation"
      ? t("webMode.exit.leaveStackNote")
      : t("webMode.exit.routeKept"),
  ];
  const confirmExit = () => {
    setExitError(null);
    void state
      .change({ kind: "mode", mode: "direct", quiet: true })
      .then(() => setExitConfirm(false))
      .catch((error) =>
        setExitError(extractErrorMessage(error) || t("common.unknown")),
      );
  };
  const begin = () => {
    // 回到直连也先确认：说明会连到哪家、改写哪个文件、路由设置留不留
    if (selected === "direct") {
      setExitError(null);
      setExitConfirm(true);
      return;
    }
    const preferred =
      state.data?.routeProviderId ?? state.data?.directProviderId;
    setRoute(
      choices.find((p) => p.id === preferred)?.id ?? choices[0]?.id ?? "",
    );
    setConfirm(true);
  };
  return (
    <section
      className="space-y-3 border-b border-border pb-4 pt-3"
      aria-label={t("webMode.title")}
    >
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("webMode.title")}
      >
        {modes.map((mode) => {
          const Icon =
            mode === "direct" ? Plug : mode === "routing" ? Route : Layers;
          return (
            <Button
              key={mode}
              size="sm"
              variant={selected === mode ? "secondary" : "ghost"}
              aria-pressed={selected === mode}
              onClick={() => setView(mode)}
            >
              <Icon className="mr-1 h-4 w-4" />
              {t(`webMode.${mode}`)}
              {active === mode && (
                <span
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-current"
                  aria-label={t("webMode.active")}
                />
              )}
            </Button>
          );
        })}
        {/* 实际生效的连接，不跟随正在查看的模式：模式色圆点表示已接上，灰点表示还没接上 */}
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border-default px-2.5 py-0.5 text-sm"
          title={inUseId ? providers[inUseId]?.name : undefined}
        >
          <span
            aria-hidden="true"
            data-testid="app-mode-status-dot"
            className={cn(
              "me-1 h-1.5 w-1.5 shrink-0 rounded-full",
              connected ? MODE_DOT[active] : "bg-muted-foreground/40",
            )}
          />
          <span className="shrink-0 text-muted-foreground">
            {t(`webMode.${active}`)}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {inUseId ? providers[inUseId]?.name : t("webMode.noProvider")}
          </span>
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(`webMode.help.${selected}`)}
      </p>
      {selected === "aggregation" && (
        <p className="text-sm text-muted-foreground">
          {t("webMode.officialDefaultAdvice")}
        </p>
      )}
      {app === "claude-desktop" && selected !== "direct" && (
        <p role="note" className="text-sm text-muted-foreground">
          {t("webMode.desktopRouteNote")}
        </p>
      )}
      {state.data.startupError && (
        <p role="alert" className="text-sm text-destructive">
          {t("webMode.startupFailed", { error: state.data.startupError })}
        </p>
      )}
      {(selected !== active ||
        (active !== "direct" && !state.data.attached)) && (
        <Button
          size="sm"
          disabled={
            state.pending || (selected !== "direct" && choices.length === 0)
          }
          onClick={begin}
        >
          {t("webMode.activate", { mode: t(`webMode.${selected}`) })}
        </Button>
      )}
      {state.data.aggregation.notice && (
        <div role="status" className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t(`webMode.notice.${state.data.aggregation.notice}`)}
            {state.data.aggregation.noticeReasons?.map((reason) => (
              <span key={reason} className="block">
                {t(`webMode.noticeReason.${reason}`)}
              </span>
            ))}
          </p>
          {app === "codex" &&
            state.data.aggregation.notice === "routeOwnsCatalog" && (
              <Button
                size="sm"
                variant="outline"
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
            )}
        </div>
      )}
      {app === "codex" && active === "aggregation" && (
        <CodexStackSettings
          models={subagentModels}
          routeOfficial={
            !!routeId && providers[routeId]?.category === "official"
          }
        />
      )}
      {app === "codex" && stale && showStale && (
        <div role="status" className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {t(
              stale.unverified
                ? "webMode.staleClients.unverifiedTitle"
                : stale.auth
                  ? "webMode.staleClients.authTitle"
                  : "webMode.staleClients.title",
            )}
          </p>
          {stale.daemon && (
            <span className="block">{t("webMode.staleClients.daemon")}</span>
          )}
          {stale.others && (
            <span className="block">{t("webMode.staleClients.others")}</span>
          )}
          {stale.unverified && (
            <span className="block">
              {t("webMode.staleClients.unverifiedHint")}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            {stale.daemon && (
              <Button
                size="sm"
                variant="outline"
                disabled={state.pending}
                onClick={() => setRestartConfirm(true)}
              >
                {t("webMode.restartDaemon")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismissStale}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}
      <Dialog
        open={restartConfirm}
        onOpenChange={(open) => !state.pending && setRestartConfirm(open)}
      >
        <DialogContent className="gap-4 p-6">
          <DialogTitle>{t("webMode.restartDaemon")}</DialogTitle>
          <DialogDescription>
            {t("webMode.restartDaemonConfirm")}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={state.pending}
              onClick={() => setRestartConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={state.pending}
              onClick={() => {
                void state
                  .change({ kind: "restartDaemon" })
                  .then(() => setRestartConfirm(false))
                  .catch(() => {});
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exitConfirm}
        onOpenChange={(open) => !state.pending && setExitConfirm(open)}
      >
        <DialogContent className="gap-4 p-6">
          <DialogTitle>
            {t("webMode.exit.title", {
              app: APP_DISPLAY_NAME[app],
              from: t(`webMode.${active}`),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("webMode.exit.lead", {
              app: APP_DISPLAY_NAME[app],
              provider: directName,
            })}
          </DialogDescription>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {exitNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
          {exitError && (
            <p role="alert" className="text-sm text-destructive">
              {exitError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              autoFocus
              disabled={state.pending}
              onClick={() => setExitConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={state.pending} onClick={confirmExit}>
              {t("webMode.exit.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={(open) => !state.pending && setConfirm(open)}
      >
        <DialogContent className="gap-4 p-6">
          <DialogTitle>
            {t("webMode.activate", { mode: t(`webMode.${selected}`) })}
          </DialogTitle>
          <DialogDescription>{t("webMode.confirm")}</DialogDescription>
          {active === "aggregation" && selected === "routing" && (
            <p className="text-sm text-muted-foreground">
              {t("webMode.exit.leaveStackNote")}
            </p>
          )}
          <label className="space-y-2 text-sm">
            {t("webMode.defaultProvider")}
            <select
              className="w-full rounded-md border border-border bg-background p-2"
              aria-label={t("webMode.defaultProvider")}
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              disabled={state.pending}
            >
              {choices.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={state.pending}
              onClick={() => setConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                state.pending || !route || !choices.some((p) => p.id === route)
              }
              onClick={() => {
                void state
                  .change({ kind: "mode", mode: selected, route })
                  .then(() => setConfirm(false))
                  .catch(() => {});
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
