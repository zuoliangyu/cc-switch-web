import { useId, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { SettingsFormState } from "@/hooks/useSettings";

export const DEFAULT_CODEX_QUOTA_PROTECTION = {
  enabled: false,
  fiveHourThreshold: 95,
  weeklyThreshold: 98,
};

/** Codex 官方额度保护：五小时 / 每周使用率达到阈值时暂停新的官方请求，第三方模型照常可用。 */
export function CodexQuotaProtectionSettings({
  settings,
  onChange,
}: {
  settings: SettingsFormState;
  onChange: (updates: Partial<SettingsFormState>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const config =
    settings.codexQuotaProtection ?? DEFAULT_CODEX_QUOTA_PROTECTION;
  // 输入框的草稿和设置分开：保存失败回滚设置时不丢正在改的值
  const [fiveHourDraft, setFiveHourDraft] = useState<string>();
  const [weeklyDraft, setWeeklyDraft] = useState<string>();
  const fiveHour = fiveHourDraft ?? String(config.fiveHourThreshold);
  const weekly = weeklyDraft ?? String(config.weeklyThreshold);
  const [saving, setSaving] = useState(false);
  const valid = (value: string) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 99;
  const invalid = !valid(fiveHour) || !valid(weekly);
  const dirty =
    Number(fiveHour) !== config.fiveHourThreshold ||
    Number(weekly) !== config.weeklyThreshold;

  const save = async (next: typeof DEFAULT_CODEX_QUOTA_PROTECTION) => {
    setSaving(true);
    try {
      const saved = await onChange({ codexQuotaProtection: next });
      if (saved) {
        setFiveHourDraft(undefined);
        setWeeklyDraft(undefined);
      } else {
        toast.error(t("settings.saveFailedGeneric"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <ToggleRow
        icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}
        title={t("settings.codexQuotaProtection.title")}
        description={t("settings.codexQuotaProtection.help")}
        checked={config.enabled}
        disabled={saving}
        onCheckedChange={(enabled) => void save({ ...config, enabled })}
      />
      {config.enabled && (
        <div className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium">
            {t("settings.codexQuotaProtection.thresholds")}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label
              htmlFor={`${id}-5h`}
              className="space-y-1 text-xs text-muted-foreground"
            >
              <span>{t("settings.codexQuotaProtection.fiveHour")}</span>
              <Input
                id={`${id}-5h`}
                type="number"
                min={1}
                max={99}
                step={1}
                value={fiveHour}
                disabled={saving}
                aria-invalid={!valid(fiveHour)}
                aria-describedby={`${id}-hint`}
                onChange={(event) => setFiveHourDraft(event.target.value)}
                className="w-24"
              />
            </label>
            <label
              htmlFor={`${id}-weekly`}
              className="space-y-1 text-xs text-muted-foreground"
            >
              <span>{t("settings.codexQuotaProtection.weekly")}</span>
              <Input
                id={`${id}-weekly`}
                type="number"
                min={1}
                max={99}
                step={1}
                value={weekly}
                disabled={saving}
                aria-invalid={!valid(weekly)}
                aria-describedby={`${id}-hint`}
                onChange={(event) => setWeeklyDraft(event.target.value)}
                className="w-24"
              />
            </label>
            <Button
              size="sm"
              disabled={saving || invalid || !dirty}
              onClick={() =>
                void save({
                  ...config,
                  fiveHourThreshold: Number(fiveHour),
                  weeklyThreshold: Number(weekly),
                })
              }
            >
              {t("settings.codexQuotaProtection.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() =>
                void save({
                  ...DEFAULT_CODEX_QUOTA_PROTECTION,
                  enabled: config.enabled,
                })
              }
            >
              {t("settings.codexQuotaProtection.reset")}
            </Button>
          </div>
          <p
            id={`${id}-hint`}
            className={
              invalid
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
            role={invalid ? "alert" : undefined}
          >
            {t(
              invalid
                ? "settings.codexQuotaProtection.invalid"
                : "settings.codexQuotaProtection.hint",
            )}
          </p>
        </div>
      )}
    </div>
  );
}
