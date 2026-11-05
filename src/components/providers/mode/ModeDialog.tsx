import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isOfficialAccount } from "@/utils/providerCapabilities";
import type { ModeView } from "@/components/providers/presentation";

/** 路由模式改写的客户端文件（确认框里写明，用默认位置）。 */
const CLIENT_FILE: Partial<Record<AppId, string>> = {
  claude: "~/.claude/settings.json",
  codex: "~/.codex/config.toml",
  gemini: "~/.gemini/.env",
  grokbuild: "~/.grok/config.toml",
};

export type ModeDialogState =
  | { kind: "enter"; target: Exclude<ModeView, "direct"> }
  /** 回到直连；`useProviderId` 不为空时回到直连后改用这家 */
  | { kind: "exit"; useProviderId?: string }
  | { kind: "needsRoute"; providerId: string; reason: string };

interface ModeDialogProps {
  app: AppId;
  state: ModeDialogState | null;
  active: ModeView;
  providers: Provider[];
  /** 直连那家：回到直连后默认落到它 */
  directId: string | null;
  /** 能做路由目标 / 聚合默认的供应商 */
  eligibleIds: string[];
  /** 默认选中：上次的路由目标（聚合里就是默认那家），没有就用直连那家 */
  defaultPick: string | null;
  /** 聚合名单（含默认那家）及各家只做成员时发布的模型数；框里按选中的默认那家算「另有」哪几家 */
  stackMembers: { id: string; name: string; models: number }[];
  onClose: () => void;
  onEnter: (target: Exclude<ModeView, "direct">, pick: string) => Promise<void>;
  /** 回到直连（`useProviderId` 见 `exit` 状态） */
  onExit: (useProviderId?: string) => Promise<void>;
  /** 「需要路由」框里的「仍然直连切换」 */
  onSwitchDirect: (providerId: string) => void;
}

const NOTE_LIST =
  "space-y-1.5 rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground";
const ERROR_BOX =
  "rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400";

/**
 * 模式切换确认框（上游 v7）：进入路由 / 聚合、回到直连、「这家需要路由」。确认键写明后果，
 * 出错时就地显示，不关框。路由到哪家、聚合以哪家为默认都在框里选（进入模式只有这一个入口）。
 */
export function ModeDialog(props: ModeDialogProps) {
  const { state, onClose } = props;
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {state && (
        <DialogContent
          zIndex="alert"
          className="max-h-[90vh] max-w-[480px] gap-0 overflow-y-auto p-6"
        >
          {state.kind === "enter" ? (
            <EnterBody {...props} state={state} />
          ) : state.kind === "exit" ? (
            <ExitBody {...props} state={state} />
          ) : (
            <NeedsRouteBody {...props} state={state} />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function NoteList({ notes }: { notes: string[] }) {
  return (
    <ul className={NOTE_LIST}>
      {notes.map((note) => (
        <li key={note} className="flex gap-2">
          <span aria-hidden="true">·</span>
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}

function EnterBody({
  app,
  state,
  active,
  providers,
  eligibleIds,
  defaultPick,
  stackMembers,
  onClose,
  onEnter,
}: ModeDialogProps & {
  state: Extract<ModeDialogState, { kind: "enter" }>;
}) {
  const { t } = useTranslation();
  const appName = APP_DISPLAY_NAME[app];
  const target = state.target;
  const viaDirect = active !== "direct";
  const eligible = providers.filter((p) => eligibleIds.includes(p.id));
  const initialPick =
    defaultPick && eligibleIds.includes(defaultPick)
      ? defaultPick
      : (eligible[0]?.id ?? "");
  const [pick, setPick] = useState(initialPick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickedProvider = eligible.find((p) => p.id === pick);
  // 官方账号只能做聚合的默认、不能做成员（Codex）：选了别家，它的模型就进不了聚合
  const officialLeftOut =
    target === "stack" &&
    pickedProvider !== undefined &&
    !isOfficialAccount(app, pickedProvider) &&
    eligible.some((p) => isOfficialAccount(app, p));

  useEffect(() => {
    setPick(initialPick);
    // 每次打开按传进来的预选重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // 换默认预览：按框里选中的默认那家，算出「另有」哪几家、共几个模型
  const otherMembers = stackMembers.filter((m) => m.id !== pick);
  const memberModels = otherMembers.reduce((sum, m) => sum + m.models, 0);
  const notes =
    target === "route" && app === "claude-desktop"
      ? [
          t("mode.dialog.desktopRouteNoteModels"),
          t("mode.dialog.desktopRouteNoteRestart", { app: appName }),
          t("mode.dialog.desktopRouteNoteKeepRunning", { app: appName }),
        ]
      : target === "route"
        ? [
            t("mode.dialog.routeNoteFile", { file: CLIENT_FILE[app] ?? "" }),
            t("mode.dialog.routeNoteSwitch"),
            t("mode.dialog.routeNoteKeepRunning"),
          ]
        : app === "claude-desktop"
          ? [
              otherMembers.length > 0
                ? t("mode.dialog.desktopStackNoteMembers", {
                    names: otherMembers.map((m) => m.name).join("、"),
                    count: memberModels,
                  })
                : t("mode.dialog.stackNoteEmpty"),
              t("mode.dialog.desktopRouteNoteRestart", { app: appName }),
              t("mode.dialog.desktopRouteNoteKeepRunning", { app: appName }),
            ]
          : [
              otherMembers.length > 0
                ? t("mode.dialog.stackNoteMembers", {
                    names: otherMembers.map((m) => m.name).join("、"),
                    count: memberModels,
                  })
                : t("mode.dialog.stackNoteEmpty"),
              t("mode.dialog.stackNoteNoFailover"),
              // Claude Code 运行中就会读到改过的 settings.json，不用重启。
              ...(app === "codex"
                ? [t("mode.dialog.stackNoteRestartCodex", { app: appName })]
                : []),
            ];
  if (active === "stack" && target === "route") {
    notes.push(
      t(
        app === "claude-desktop"
          ? "mode.dialog.desktopLeaveStackNote"
          : "mode.dialog.leaveStackNote",
      ),
    );
  }

  const confirm = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onEnter(target, pick);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || t("common.unknown"));
    } finally {
      setBusy(false);
    }
  };

  const targetName = t(`mode.names.${target}`);
  const title = viaDirect
    ? t("mode.dialog.switchTitle", {
        app: appName,
        from: t(`mode.names.${active}`),
        to: targetName,
      })
    : target === "route"
      ? t("mode.dialog.routeTitle", { app: appName })
      : t("mode.dialog.stackTitle", { app: appName });
  const lead =
    target === "route"
      ? t("mode.dialog.routeLead")
      : t("mode.dialog.stackLead");
  const pickLabel =
    target === "route"
      ? t("mode.dialog.routeTo")
      : t("mode.dialog.stackDefault");
  const optionLabel = (provider: Provider) =>
    isOfficialAccount(app, provider)
      ? t("mode.dialog.officialOption", { name: provider.name })
      : provider.name;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {lead}
        </DialogDescription>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">
          {pickLabel}
        </label>
        <Select value={pick} onValueChange={setPick} disabled={busy}>
          <SelectTrigger className="h-9" aria-label={pickLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[70]">
            {eligible.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {optionLabel(provider)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {officialLeftOut && (
          <p
            data-testid="stack-official-note"
            className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            {t("mode.dialog.stackOfficialNote")}
          </p>
        )}
      </div>

      <NoteList notes={notes} />

      {error && (
        <p role="alert" className={ERROR_BOX}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={busy || !pick} onClick={() => void confirm()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {target === "route"
            ? t("mode.dialog.confirmRoute")
            : t("mode.dialog.confirmStack")}
        </Button>
      </div>
    </div>
  );
}

function ExitBody({
  app,
  state,
  active,
  providers,
  directId,
  onClose,
  onExit,
}: ModeDialogProps & {
  state: Extract<ModeDialogState, { kind: "exit" }>;
}) {
  const { t } = useTranslation();
  const appName = APP_DISPLAY_NAME[app];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetId = state.useProviderId ?? directId;
  const provider =
    providers.find((p) => p.id === targetId)?.name ?? t("mode.noProvider");

  // Claude Desktop 没有单个配置文件可指，也没有故障转移队列和路由设置
  const notes =
    app === "claude-desktop"
      ? [
          t("mode.dialog.desktopRouteNoteRestart", { app: appName }),
          active === "stack"
            ? t("mode.dialog.desktopLeaveStackNote")
            : t("mode.dialog.desktopExitNoteRouteKept"),
        ]
      : [
          t("mode.dialog.exitNoteFile", {
            file: CLIENT_FILE[app] ?? "",
            provider,
          }),
          active === "stack"
            ? t("mode.dialog.leaveStackNote")
            : t("mode.dialog.exitNoteRouteKept"),
        ];

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onExit(state.useProviderId);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || t("common.unknown"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <DialogTitle className="text-base">
          {t("mode.dialog.exitTitle", {
            app: appName,
            from: t(`mode.names.${active}`),
          })}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("mode.dialog.exitLead", { app: appName, provider })}
        </DialogDescription>
      </div>

      <NoteList notes={notes} />

      {error && (
        <p role="alert" className={ERROR_BOX}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("mode.dialog.confirmDirect")}
        </Button>
      </div>
    </div>
  );
}

function NeedsRouteBody({
  app,
  state,
  providers,
  onClose,
  onEnter,
  onSwitchDirect,
}: ModeDialogProps & {
  state: Extract<ModeDialogState, { kind: "needsRoute" }>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((p) => p.id === state.providerId);
  const name = provider?.name ?? state.providerId;

  const route = async () => {
    setBusy(true);
    setError(null);
    try {
      await onEnter("route", state.providerId);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || t("common.unknown"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <DialogTitle className="text-base">
          {t("mode.dialog.needsRouteTitle", { provider: name })}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("mode.dialog.needsRouteLead", {
            provider: name,
            reason: state.reason,
            app: APP_DISPLAY_NAME[app],
          })}
        </DialogDescription>
      </div>
      {error && (
        <p role="alert" className={ERROR_BOX}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {/* Claude Desktop 直连写不进要经路由的卡，后端会拒绝 */}
        {app !== "claude-desktop" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              onClose();
              onSwitchDirect(state.providerId);
            }}
          >
            {t("mode.dialog.switchAnyway")}
          </Button>
        )}
        <Button disabled={busy} onClick={() => void route()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("mode.dialog.routeAndUse")}
        </Button>
      </div>
    </div>
  );
}
