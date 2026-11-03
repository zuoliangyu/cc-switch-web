import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { settingsApi } from "@/lib/api";
import type {
  ToolUninstallCandidate,
  ToolUninstallPlan,
} from "@/lib/api/settings";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToolInstallRow } from "@/components/settings/ToolInstallRow";
import {
  hermesUninstallMayLeaveFiles,
  toolDisplayName,
  type ToolName,
  type WslShellPreference,
} from "./useToolManagement";

export function ToolUninstallConfirmDialog({
  tool,
  wslShellByTool,
  onConfirm,
  onCancel,
  onManualUninstall,
}: {
  tool: ToolName;
  wslShellByTool: Record<string, WslShellPreference>;
  onConfirm: (plan: ToolUninstallPlan) => void;
  onCancel: () => void;
  onManualUninstall: () => void;
}) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<ToolUninstallCandidate[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setError(null);
    setSelectedPath(null);
    void settingsApi.prepareToolUninstall(tool, wslShellByTool).then(
      (result) => {
        if (cancelled) return;
        setCandidates(result);
        // 多处安装时不预选：「错装的那处」不一定是非默认那处，让用户自己挑。
        if (result.length === 1 && result[0].plan) {
          setSelectedPath(result[0].path);
        }
      },
      (reason) => {
        if (!cancelled) setError(extractErrorMessage(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tool, wslShellByTool]);

  const plan =
    candidates?.find((candidate) => candidate.path === selectedPath)?.plan ??
    null;
  const anyPlan = Boolean(candidates?.some((candidate) => candidate.plan));
  const needsManual =
    error !== null || Boolean(candidates?.some((candidate) => !candidate.plan));

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-2xl" zIndex="alert">
        <DialogHeader>
          <DialogTitle>
            {t("settings.toolUninstallConfirmTitle", {
              tool: toolDisplayName(tool),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("settings.toolUninstallConfirmHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto px-6">
          {error !== null ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{t("settings.toolUninstallManualRequired")}</p>
              {error && (
                <p className="break-words text-muted-foreground">{error}</p>
              )}
            </div>
          ) : candidates ? (
            <>
              {!anyPlan && (
                <p role="alert" className="text-sm">
                  {t("settings.toolUninstallManualRequired")}
                </p>
              )}
              <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
                <legend className="sr-only">
                  {t("settings.toolUninstallChooseInstall")}
                </legend>
                {candidates.map((candidate) => (
                  <label
                    key={candidate.path}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed"
                  >
                    <input
                      type="radio"
                      name="tool-uninstall-target"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      aria-label={candidate.path}
                      checked={selectedPath === candidate.path}
                      disabled={!candidate.plan}
                      onChange={() => setSelectedPath(candidate.path)}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <ToolInstallRow inst={candidate} />
                      {candidate.unavailable_reason && (
                        <p className="break-words text-xs text-muted-foreground">
                          {candidate.unavailable_reason}
                        </p>
                      )}
                      {candidate.reinstalled_by_updater && (
                        <p className="text-xs text-amber-600">
                          {t("settings.toolUninstallReinstalledByUpdater", {
                            tool: toolDisplayName(tool),
                          })}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </fieldset>
              {plan && (
                <>
                  {plan.wsl_distro && (
                    <p className="text-sm">WSL: {plan.wsl_distro}</p>
                  )}
                  <dl className="space-y-2 text-sm">
                    <dt className="text-muted-foreground">
                      {t("settings.toolUpgradeWillRun")}
                    </dt>
                    <dd>
                      <pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-xs">
                        <code>{plan.command}</code>
                      </pre>
                    </dd>
                  </dl>
                  {plan.native && (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.toolUninstallNativeHint")}
                    </p>
                  )}
                  {hermesUninstallMayLeaveFiles(plan) && (
                    <p role="note" className="text-xs text-muted-foreground">
                      {t("settings.toolUninstallHermesWindowsHint")}
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settings.toolUninstallPreparing")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          {needsManual && (
            <Button variant="outline" onClick={onManualUninstall}>
              {t("settings.manualUninstallCommands")}
            </Button>
          )}
          {anyPlan && (
            <Button
              variant="destructive"
              disabled={!plan}
              onClick={() => plan && onConfirm(plan)}
            >
              {t("settings.toolUninstall")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
