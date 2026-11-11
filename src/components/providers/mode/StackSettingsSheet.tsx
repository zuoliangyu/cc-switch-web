import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Settings } from "@/types";
import type { AppModeSubagentModel } from "@/types/proxy";
import { settingsApi } from "@/lib/api/settings";
import { useSettingsQuery } from "@/lib/query/queries";
import { extractErrorMessage } from "@/utils/errorUtils";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import {
  STACK_LABEL_CLASS,
  STACK_SELECT_CLASS,
  STACK_WARNING_CLASS,
  StackSubagentFields,
  stackSubagentSettings,
  stackSubagentValue,
} from "./StackSubagentFields";
import { appModeQueryKey } from "@/lib/query/appModeKeys";
import { CodexPauseOfficialLoginSection } from "./CodexPauseOfficialLogin";

// 原生 select 的空值：不写覆盖、用 Codex 的默认审批模型。
const CODEX_DEFAULT_REVIEWER = "";

interface StackSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 能选的模型（后端 `subagentModels` 去掉默认那家） */
  models: AppModeSubagentModel[];
  /** 默认那家是官方：合并目录里有官方的 codex-auto-review，自动审批默认用它 */
  routeOfficial?: boolean;
}

/**
 * Codex 聚合页签上的「聚合设置」（上游 6aeaeb17）：最上面是「暂停使用官方登录」，下面是子代理
 * 默认用的模型和推理强度、经典子代理开关，以及自动审批（Auto Review）用的模型。都是设备级设置，改了就保存；后端按合并目录校验再写进
 * 客户端（不在目录里就用默认：子代理跟随主模型，审批用 Codex 的默认）。
 */
export function StackSettingsSheet({
  open,
  onOpenChange,
  models,
  routeOfficial = false,
}: StackSettingsSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      const current = await settingsApi.get();
      await settingsApi.save({ ...current, ...patch });
    } catch (error) {
      console.error("[StackSettingsSheet] Failed to save", error);
      toast.error(
        t("mode.stackSettings.saveFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      // 经典开关、审批模型会改合并目录：「Codex 还在用旧的模型列表」提示要重新算
      await queryClient.invalidateQueries({
        queryKey: appModeQueryKey("codex"),
      });
      setSaving(false);
    }
  };

  const autoReviewModel = settings?.codexStackAutoReviewModel || undefined;
  const autoReviewSelected = models.find(
    (candidate) => candidate.id === autoReviewModel,
  );
  // 选过的模型不在名单里了：后端不写，用 Codex 的默认审批模型
  const autoReviewUnavailable =
    autoReviewModel !== undefined && autoReviewSelected === undefined;
  const autoReviewLabel = t("mode.stackSettings.autoReviewModel");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width={420} closeLabel={t("common.close")}>
        <SheetHeader>
          <SheetTitle>{t("mode.stackSettings.title")}</SheetTitle>
          <SheetDescription>{APP_DISPLAY_NAME.codex}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3">
          <CodexPauseOfficialLoginSection />
          <p className="text-xs text-muted-foreground">
            {t("mode.stackSettings.subagentDescription")}
          </p>
          <StackSubagentFields
            models={models}
            value={stackSubagentValue(settings)}
            onChange={(value) => void save(stackSubagentSettings(value))}
            disabled={saving}
          />

          <div className="space-y-1.5 border-t border-border-default pt-3">
            <label className={STACK_LABEL_CLASS} htmlFor="stack-auto-review">
              {autoReviewLabel}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("mode.stackSettings.autoReviewDescription")}
            </p>
            <select
              id="stack-auto-review"
              className={STACK_SELECT_CLASS}
              aria-label={autoReviewLabel}
              value={autoReviewModel ?? CODEX_DEFAULT_REVIEWER}
              disabled={saving}
              onChange={(event) =>
                void save({
                  codexStackAutoReviewModel:
                    event.target.value === CODEX_DEFAULT_REVIEWER
                      ? undefined
                      : event.target.value,
                })
              }
            >
              <option value={CODEX_DEFAULT_REVIEWER}>
                {routeOfficial
                  ? t("mode.stackSettings.autoReviewDefaultOfficial")
                  : t("mode.stackSettings.autoReviewDefaultMain")}
              </option>
              {models.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
              {autoReviewUnavailable && (
                <option value={autoReviewModel}>
                  {t("mode.stackSettings.unavailableOption", {
                    model: autoReviewModel,
                  })}
                </option>
              )}
            </select>
            {autoReviewUnavailable && (
              <p
                role="status"
                data-testid="stack-auto-review-unavailable"
                className={STACK_WARNING_CLASS}
              >
                {t("mode.stackSettings.autoReviewUnavailable")}
              </p>
            )}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
