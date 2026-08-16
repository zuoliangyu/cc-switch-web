import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import type { ImportStatus } from "@/hooks/useImportExport";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api";
import { toast } from "sonner";

interface ImportExportSectionProps {
  isWebMode?: boolean;
  status: ImportStatus;
  selectedFile: string;
  errorMessage: string | null;
  backupId: string | null;
  isImporting: boolean;
  onSelectUpload?: (file: File | null) => void;
  onSelectFile: () => Promise<void>;
  onImport: () => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
  onMigrationSuccess?: () => void | Promise<void>;
}

export function ImportExportSection({
  isWebMode = false,
  status,
  selectedFile,
  errorMessage,
  backupId,
  isImporting,
  onSelectUpload,
  onSelectFile,
  onImport,
  onExport,
  onClear,
  onMigrationSuccess,
}: ImportExportSectionProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationBackupId, setMigrationBackupId] = useState<string | null>(
    null,
  );

  const selectedFileName = useMemo(() => {
    if (!selectedFile) return "";
    const segments = selectedFile.split(/[\\/]/);
    return segments[segments.length - 1] || selectedFile;
  }, [selectedFile]);

  const handleSelectImport = () => {
    if (isWebMode) {
      fileInputRef.current?.click();
      return;
    }
    void onSelectFile();
  };

  const handleOpenDeepLinkImport = () => {
    window.dispatchEvent(
      new CustomEvent("cc-switch-open-deeplink-import"),
    );
  };

  const handleMigrateFromCcSwitch = async () => {
    setShowMigrationConfirm(false);
    if (isMigrating) return;
    setIsMigrating(true);
    setMigrationBackupId(null);
    try {
      const result = await settingsApi.migrateFromCcSwitch();
      setMigrationBackupId(result.backupId);
      await onMigrationSuccess?.();
      toast.success(t("settings.ccSwitchMigration.success"), {
        description: t("settings.ccSwitchMigration.successDescription", {
          backupId: result.backupId,
          version: result.sourceVersion,
        }),
        closeButton: true,
      });
      if (result.warning) {
        toast.warning(result.warning, { closeButton: true });
      }
    } catch (error) {
      toast.error(t("settings.ccSwitchMigration.failed"), {
        description: error instanceof Error ? error.message : String(error),
        closeButton: true,
      });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">
          {t("settings.importExport")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.importExportHint")}
        </p>
      </header>

      <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-6">
        {isWebMode && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,text/plain,application/sql"
            className="hidden"
            onChange={(event) => {
              onSelectUpload?.(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        )}
        {/* Import and Export Buttons Side by Side */}
        <div className="grid grid-cols-2 gap-4 items-stretch">
          {/* Import Button */}
          <div className="relative">
            <Button
              type="button"
              className={`w-full h-auto py-3 px-4 ${selectedFile && !isImporting ? "flex-col items-start" : "items-center"}`}
              onClick={!selectedFile ? handleSelectImport : () => void onImport()}
              disabled={isImporting}
            >
              <div className="flex items-center gap-2 w-full justify-center">
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                ) : selectedFile ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <FolderOpen className="h-4 w-4 flex-shrink-0" />
                )}
                <span className="font-medium">
                  {isImporting
                    ? t("settings.importing")
                    : selectedFile
                      ? t("settings.import")
                      : t("settings.selectConfigFile")}
                </span>
              </div>
              {selectedFile && !isImporting && (
                <div className="mt-2 w-full text-left">
                  <p className="text-xs font-mono text-white/80 truncate">
                    📄 {selectedFileName}
                  </p>
                </div>
              )}
            </Button>
            {selectedFile && (
              <button
                type="button"
                onClick={onClear}
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors z-10"
                aria-label={t("common.clear")}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Export Button */}
          <div>
            <Button
              type="button"
              className="w-full h-full py-3 px-4 items-center"
              onClick={onExport}
            >
              <Save className="mr-2 h-4 w-4" />
              {t("settings.exportConfig")}
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full justify-center"
          onClick={handleOpenDeepLinkImport}
        >
          <Link2 className="mr-2 h-4 w-4" />
          {t("deeplink.openImporter")}
        </Button>

        {isWebMode ? (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">
                {t("settings.ccSwitchMigration.title")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t("settings.ccSwitchMigration.description")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={isImporting || isMigrating}
              onClick={() => setShowMigrationConfirm(true)}
            >
              {isMigrating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {isMigrating
                ? t("settings.ccSwitchMigration.migrating")
                : t("settings.ccSwitchMigration.action")}
            </Button>
            {migrationBackupId ? (
              <p className="text-xs text-muted-foreground" role="status">
                {t("settings.ccSwitchMigration.backupCreated", {
                  backupId: migrationBackupId,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        <ImportStatusMessage
          status={status}
          errorMessage={errorMessage}
          backupId={backupId}
        />
      </div>

      <ConfirmDialog
        isOpen={showMigrationConfirm}
        title={t("settings.ccSwitchMigration.confirmTitle")}
        message={t("settings.ccSwitchMigration.confirmMessage")}
        confirmText={t("settings.ccSwitchMigration.confirmAction")}
        variant="destructive"
        zIndex="top"
        onConfirm={() => void handleMigrateFromCcSwitch()}
        onCancel={() => setShowMigrationConfirm(false)}
      />
    </section>
  );
}

interface ImportStatusMessageProps {
  status: ImportStatus;
  errorMessage: string | null;
  backupId: string | null;
}

function ImportStatusMessage({
  status,
  errorMessage,
  backupId,
}: ImportStatusMessageProps) {
  const { t } = useTranslation();

  if (status === "idle") {
    return null;
  }

  const baseClass =
    "flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed backdrop-blur-sm";

  if (status === "importing") {
    return (
      <div
        className={`${baseClass} theme-panel-info`}
      >
        <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" />
        <div>
          <p className="font-semibold">{t("settings.importing")}</p>
          <p className="opacity-80">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div
        className={`${baseClass} theme-panel-success`}
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="space-y-1.5">
          <p className="font-semibold">{t("settings.importSuccess")}</p>
          {backupId ? (
            <p className="text-xs opacity-80">
              {t("settings.backupId")}: {backupId}
            </p>
          ) : null}
          <p className="opacity-80">{t("settings.autoReload")}</p>
        </div>
      </div>
    );
  }

  if (status === "partial-success") {
    return (
      <div
        className={`${baseClass} theme-panel-warning`}
      >
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="space-y-1.5">
          <p className="font-semibold">{t("settings.importPartialSuccess")}</p>
          <p className="opacity-80">{t("settings.importPartialHint")}</p>
        </div>
      </div>
    );
  }

  const message = errorMessage || t("settings.importFailed");

  return (
    <div
      className={`${baseClass} border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400`}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="space-y-1.5">
        <p className="font-semibold">{t("settings.importFailed")}</p>
        <p className="text-red-600/80 dark:text-red-400/80">{message}</p>
      </div>
    </div>
  );
}
