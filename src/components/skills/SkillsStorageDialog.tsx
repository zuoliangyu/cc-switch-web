import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import type { SkillSyncMethod } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkillStorageLocationSettings } from "@/components/settings/SkillStorageLocationSettings";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
import { toast } from "sonner";
import { ResyncButton } from "@/components/common/ResyncButton";
import { skillsApi } from "@/lib/api/skills";

/** Skills 存储位置与同步方式（Skills 页「⋯」菜单打开）；改完可立即重新同步到各应用 */
export function SkillsStorageDialog({
  open,
  onOpenChange,
  installedCount,
  resyncDisabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedCount: number;
  resyncDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
    enabled: open,
  });
  const save = useMutation({
    mutationFn: async (method: SkillSyncMethod) => {
      const latest = await settingsApi.get();
      await settingsApi.save({ ...latest, skillSyncMethod: method });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
    onError: (e) => toast.error(String(e)),
  });
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-6">
          <DialogHeader>
            <DialogTitle>{t("settings.skillStorage.title")}</DialogTitle>
          </DialogHeader>
          {settings.data ? (
            <div className="space-y-5">
              <SkillStorageLocationSettings
                value={settings.data.skillStorageLocation ?? "cc_switch"}
                installedCount={installedCount}
                onMigrated={() =>
                  void client.invalidateQueries({ queryKey: ["settings"] })
                }
              />
              <fieldset disabled={save.isPending}>
                <SkillSyncMethodSettings
                  value={settings.data.skillSyncMethod ?? "auto"}
                  onChange={(method) => save.mutate(method)}
                />
              </fieldset>
              <p className="text-sm text-muted-foreground">
                {t("skills.resyncAfterSettings")}
              </p>
              <ResyncButton
                run={skillsApi.resync}
                queryKey={["skills", "installed"]}
                disabled={resyncDisabled}
              />
            </div>
          ) : (
            <p>{settings.isError ? t("common.error") : t("common.loading")}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
