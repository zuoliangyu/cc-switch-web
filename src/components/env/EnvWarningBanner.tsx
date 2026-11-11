import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronUp, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteEnvVars } from "@/lib/api/env";
import type { EnvConflict } from "@/types/env";

interface EnvWarningBannerProps {
  conflicts: EnvConflict[];
  topOffset?: number;
  onHeightChange?: (height: number) => void;
  onDismiss: () => void;
  onDeleted: () => void;
}

export function EnvWarningBanner({
  conflicts,
  topOffset = 0,
  onHeightChange,
  onDismiss,
  onDeleted,
}: EnvWarningBannerProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedConflicts, setSelectedConflicts] = useState<Set<string>>(
    new Set(),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = bannerRef.current;
    if (!target || !onHeightChange) {
      return;
    }

    const updateHeight = () =>
      onHeightChange(target.getBoundingClientRect().height);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(target);

    return () => observer.disconnect();
  }, [conflicts.length, isExpanded, onHeightChange]);

  if (conflicts.length === 0) return null;

  const toggleSelection = (key: string) => {
    const next = new Set(selectedConflicts);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedConflicts(next);
  };

  const toggleSelectAll = () => {
    if (selectedConflicts.size === conflicts.length) {
      setSelectedConflicts(new Set());
      return;
    }
    setSelectedConflicts(
      new Set(
        conflicts.map(
          (conflict) => `${conflict.varName}:${conflict.sourcePath}`,
        ),
      ),
    );
  };

  const handleDelete = async () => {
    setShowConfirmDialog(false);
    setIsDeleting(true);

    try {
      const conflictsToDelete = conflicts.filter((conflict) =>
        selectedConflicts.has(`${conflict.varName}:${conflict.sourcePath}`),
      );
      if (conflictsToDelete.length === 0) {
        toast.warning(t("env.error.noSelection"));
        return;
      }

      const backupInfo = await deleteEnvVars(conflictsToDelete);
      toast.success(t("env.delete.success"), {
        description: t("env.backup.location", { path: backupInfo.backupPath }),
        duration: 5000,
        closeButton: true,
      });

      setSelectedConflicts(new Set());
      onDeleted();
    } catch (error) {
      console.error("删除环境变量失败:", error);
      toast.error(t("env.delete.error"), {
        description: String(error),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getSourceDescription = (conflict: EnvConflict): string => {
    if (conflict.sourceType !== "system") {
      return conflict.sourcePath;
    }
    if (conflict.sourcePath.includes("HKEY_CURRENT_USER")) {
      return t("env.source.userRegistry");
    }
    if (conflict.sourcePath.includes("HKEY_LOCAL_MACHINE")) {
      return t("env.source.systemRegistry");
    }
    return t("env.source.systemEnv");
  };

  return (
    <>
      <div
        ref={bannerRef}
        className="fixed left-0 right-0 z-[100] animate-slide-down border-b border-yellow-200 bg-yellow-50 shadow-lg dark:border-yellow-900 dark:bg-yellow-950"
        style={{ top: topOffset }}
      >
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
                    {t("env.warning.title")}
                  </h3>
                  <p className="mt-0.5 text-sm text-yellow-800 dark:text-yellow-200">
                    {t("env.warning.description", { count: conflicts.length })}
                  </p>
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-yellow-900 hover:bg-yellow-100 dark:text-yellow-100 dark:hover:bg-yellow-900/50"
                  >
                    {isExpanded ? (
                      <>
                        {t("env.actions.collapse")}
                        <ChevronUp className="ml-1 h-4 w-4" />
                      </>
                    ) : (
                      <>
                        {t("env.actions.expand")}
                        <ChevronDown className="ml-1 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDismiss}
                    className="text-yellow-900 hover:bg-yellow-100 dark:text-yellow-100 dark:hover:bg-yellow-900/50"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 border-b border-yellow-200 pb-2 dark:border-yellow-900/50">
                    <Checkbox
                      id="select-all-env-conflicts"
                      checked={selectedConflicts.size === conflicts.length}
                      onCheckedChange={toggleSelectAll}
                    />
                    <label
                      htmlFor="select-all-env-conflicts"
                      className="cursor-pointer text-sm font-medium text-yellow-900 dark:text-yellow-100"
                    >
                      {t("env.actions.selectAll")}
                    </label>
                  </div>

                  <div className="max-h-96 space-y-2 overflow-y-auto">
                    {conflicts.map((conflict) => {
                      const key = `${conflict.varName}:${conflict.sourcePath}`;
                      return (
                        <div
                          key={key}
                          className="flex items-start gap-3 rounded-md border border-yellow-200 bg-white p-3 dark:border-yellow-900/50 dark:bg-gray-900"
                        >
                          <Checkbox
                            id={key}
                            checked={selectedConflicts.has(key)}
                            onCheckedChange={() => toggleSelection(key)}
                          />

                          <div className="min-w-0 flex-1">
                            <label
                              htmlFor={key}
                              className="block cursor-pointer text-sm font-medium text-foreground"
                            >
                              {conflict.varName}
                            </label>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {t("env.field.value")}: {conflict.varValue}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("env.field.source")}:{" "}
                              {getSourceDescription(conflict)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-yellow-200 pt-2 dark:border-yellow-900/50">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedConflicts(new Set())}
                      disabled={selectedConflicts.size === 0}
                      className="border-yellow-300 text-yellow-900 dark:border-yellow-800 dark:text-yellow-100"
                    >
                      {t("env.actions.clearSelection")}
                    </Button>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowConfirmDialog(true)}
                      disabled={selectedConflicts.size === 0 || isDeleting}
                      className="gap-1"
                    >
                      <Trash2 className="h-4 w-4" />
                      {isDeleting
                        ? t("env.actions.deleting")
                        : t("env.actions.deleteSelected", {
                            count: selectedConflicts.size,
                          })}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("env.confirm.title")}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                {t("env.confirm.message", { count: selectedConflicts.size })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("env.confirm.backupNotice")}
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("env.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
