import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettingsQuery } from "@/lib/query";
import { settingsApi } from "@/lib/api";

/** 首次运行欢迎提示：仅当 firstRunNoticeConfirmed 仍未确认时弹出。 */
export function FirstRunNoticeDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const isOpen =
    !acknowledged &&
    settings != null &&
    settings.firstRunNoticeConfirmed !== true;

  const handleAcknowledge = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const { webdavSync: _ignoredWebdavSync, ...rest } = settings;
      await settingsApi.save({ ...rest, firstRunNoticeConfirmed: true });
      queryClient.setQueryData(["settings"], {
        ...settings,
        firstRunNoticeConfirmed: true,
      });
      setAcknowledged(true);
    } catch (error) {
      console.error("Failed to save firstRunNoticeConfirmed:", error);
      toast.error(t("firstRunNotice.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) void handleAcknowledge();
      }}
    >
      <DialogContent className="max-w-md" zIndex="top">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            {t("firstRunNotice.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6 py-5">
          <DialogDescription className="whitespace-pre-line leading-relaxed">
            {t("firstRunNotice.bodyDefault")}
          </DialogDescription>
          <DialogDescription className="whitespace-pre-line leading-relaxed">
            {t("firstRunNotice.bodyOfficial")}
          </DialogDescription>
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => void handleAcknowledge()}
          >
            {t("firstRunNotice.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
