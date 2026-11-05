import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ToggleRow } from "@/components/ui/toggle-row";
import { formatBytes } from "@/components/settings/BackupStorageSection";
import { settingsApi } from "@/lib/api";
import { useSettingsQuery } from "@/lib/query/queries";

/**
 * Codex 会话压缩开关（`config.toml` 的 `[features] local_thread_store_compression`）。
 * 状态以 config.toml 为准，不走设置表单的自动保存。
 */
export function CodexSessionCompressionSettings() {
  const { t } = useTranslation();
  // 后端按已保存的目录读写 config.toml，同页保存新目录后要跟着重读
  const { data: savedSettings } = useSettingsQuery();
  const codexConfigDir = savedSettings?.codexConfigDir;
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessionsBytes, setSessionsBytes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessionsBytes(null);
    void settingsApi
      .getCodexSessionCompression()
      .catch(() => false)
      .then((value) => {
        if (!cancelled) setEnabled(value);
      });
    void settingsApi
      .getCodexSessionsDiskUsage()
      .catch(() => null)
      .then((bytes) => {
        if (!cancelled) setSessionsBytes(bytes);
      });
    return () => {
      cancelled = true;
    };
  }, [codexConfigDir]);

  const handleChange = async (checked: boolean) => {
    setSaving(true);
    try {
      setEnabled(await settingsApi.setCodexSessionCompression(checked));
    } catch (error) {
      console.error("Failed to toggle codex session compression:", error);
      toast.error(t("settings.codexSessionCompressionFailed"));
    } finally {
      setSaving(false);
    }
  };

  const usage =
    sessionsBytes === null
      ? null
      : t("settings.codexSessionCompressionUsage", {
          size: formatBytes(sessionsBytes),
        });

  return (
    <ToggleRow
      icon={<Archive className="h-4 w-4 text-sky-500" />}
      title={t("settings.codexSessionCompression")}
      description={[t("settings.codexSessionCompressionDescription"), usage]
        .filter(Boolean)
        .join(" ")}
      checked={enabled}
      disabled={saving}
      onCheckedChange={(value) => void handleChange(value)}
    />
  );
}
