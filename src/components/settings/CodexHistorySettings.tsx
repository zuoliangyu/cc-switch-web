import { useState } from "react";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { SettingsFormState } from "@/hooks/useSettings";
import { settingsApi } from "@/lib/api";

interface CodexHistorySettingsProps {
  settings: SettingsFormState;
  onChange: (updates: Partial<SettingsFormState>) => Promise<boolean>;
}

export function CodexHistorySettings({
  settings,
  onChange,
}: CodexHistorySettingsProps) {
  const { t } = useTranslation();
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);

  const handleToggle = (checked: boolean) => {
    if (checked) {
      setShowEnableConfirm(true);
      return;
    }
    void settingsApi
      .hasCodexUnifyHistoryBackup()
      .catch(() => false)
      .then((available) => {
        setHasBackup(available);
        setShowDisableConfirm(true);
      });
  };

  const handleEnable = (migrateExisting: boolean) => {
    setShowEnableConfirm(false);
    void onChange({
      unifyCodexSessionHistory: true,
      unifyCodexMigrateExisting: migrateExisting,
    });
  };

  const handleDisable = async (restoreBackup: boolean) => {
    setShowDisableConfirm(false);
    const saved = await onChange({
      unifyCodexSessionHistory: false,
      unifyCodexMigrateExisting: false,
    });
    if (!saved || !restoreBackup) return;

    try {
      const result = await settingsApi.restoreCodexUnifiedHistory();
      if (result.skippedReason) {
        toast.info(
          result.skippedReason === "unify_toggle_on"
            ? t("settings.unifyCodexHistoryRestoreSkippedToggleOn")
            : t("settings.unifyCodexHistoryRestoreNothing"),
        );
        return;
      }
      toast.success(
        t("settings.unifyCodexHistoryRestoreCompleted", {
          files: result.restoredJsonlFiles,
          rows: result.restoredStateRows,
        }),
      );
    } catch (error) {
      console.error("Failed to restore Codex unified history", error);
      toast.error(t("settings.unifyCodexHistoryRestoreFailed"));
    }
  };

  const showRestoreOption =
    hasBackup || (settings.unifyCodexMigrateExisting ?? false);

  return (
    <>
      <ToggleRow
        icon={<History className="h-4 w-4 text-sky-500" />}
        title={t("settings.unifyCodexSessionHistory")}
        description={t("settings.unifyCodexSessionHistoryDescription")}
        checked={settings.unifyCodexSessionHistory ?? false}
        onCheckedChange={handleToggle}
      />

      <ConfirmDialog
        isOpen={showEnableConfirm}
        title={t("confirm.unifyCodexHistory.title")}
        message={t("confirm.unifyCodexHistory.message")}
        checkboxLabel={t("confirm.unifyCodexHistory.migrateExisting")}
        confirmText={t("confirm.unifyCodexHistory.confirm")}
        variant="info"
        onConfirm={handleEnable}
        onCancel={() => setShowEnableConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showDisableConfirm}
        title={t("confirm.unifyCodexHistoryOff.title")}
        message={t("confirm.unifyCodexHistoryOff.message")}
        checkboxLabel={
          showRestoreOption
            ? t("confirm.unifyCodexHistoryOff.restoreBackup")
            : undefined
        }
        checkboxDefaultChecked
        confirmText={t("confirm.unifyCodexHistoryOff.confirm")}
        onConfirm={(restore) => void handleDisable(restore)}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </>
  );
}
