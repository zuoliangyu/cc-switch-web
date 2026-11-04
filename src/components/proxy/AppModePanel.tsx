import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Plug, Route } from "lucide-react";
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
import { sortProvidersByName } from "@/utils/providerSort";

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
  const [route, setRoute] = useState("");
  const active = state.data?.mode ?? "direct";
  const selected = view ?? active;
  const choices = sortProvidersByName(Object.values(providers)).filter((p) =>
    state.data?.eligibleProviderIds.includes(p.id),
  );
  const modes: AppMode[] =
    app === "claude" || app === "codex"
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
  const begin = () => {
    if (selected === "direct") {
      void state.change({ kind: "mode", mode: "direct" }).catch(() => {});
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
        <span
          className="min-w-0 max-w-full truncate text-sm text-muted-foreground"
          title={inUseId ? providers[inUseId]?.name : undefined}
        >
          {t(`webMode.${active}`)} ·{" "}
          {inUseId ? providers[inUseId]?.name : t("webMode.noProvider")}
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
      {app === "claude" && active === "aggregation" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("webMode.claudeModelsRestart")}
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
        <p role="status" className="text-sm text-muted-foreground">
          {t(`webMode.notice.${state.data.aggregation.notice}`)}
          {state.data.aggregation.noticeReasons?.map((reason) => (
            <span key={reason} className="block">
              {t(`webMode.noticeReason.${reason}`)}
            </span>
          ))}
        </p>
      )}
      {state.data.aggregation.staleClients && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("webMode.restartClients")}
        </p>
      )}
      {app === "codex" && state.data.aggregation.staleClients?.daemon && (
        <Button
          size="sm"
          variant="outline"
          disabled={state.pending}
          onClick={() => setRestartConfirm(true)}
        >
          {t("webMode.restartDaemon")}
        </Button>
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
        open={confirm}
        onOpenChange={(open) => !state.pending && setConfirm(open)}
      >
        <DialogContent className="gap-4 p-6">
          <DialogTitle>
            {t("webMode.activate", { mode: t(`webMode.${selected}`) })}
          </DialogTitle>
          <DialogDescription>{t("webMode.confirm")}</DialogDescription>
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
