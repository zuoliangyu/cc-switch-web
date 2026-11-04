import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Settings } from "@/types";
import type { AppModeSubagentModel } from "@/types/proxy";
import { settingsApi } from "@/lib/api/settings";
import { useSettingsQuery } from "@/lib/query/queries";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Switch } from "@/components/ui/switch";

// 原生 select 的空值代表「不写这个键」：子代理跟随主模型 / 用模型默认档 / 用 Codex 的默认审批模型。
const UNSET = "";

const warningClass = "text-sm text-amber-600 dark:text-amber-400";
const selectClass =
  "w-full rounded-md border border-border bg-background p-2 text-sm";

/**
 * Codex 聚合设置：子代理默认用的模型和推理强度、经典子 agent 工具开关、自动审批（Auto Review）
 * 用的模型。都是设备级设置，改了就保存；后端按合并目录校验再写进客户端（不在目录里就用默认：
 * 子代理跟随主模型，审批用 Codex 的默认），写失败时回滚。
 */
export function CodexStackSettings({
  models,
  routeOfficial = false,
}: {
  /** 能选的模型（后端 `subagentModels` 去掉默认那家：它不发布 `ccs-*` 模型） */
  models: AppModeSubagentModel[];
  /** 默认那家是官方：合并目录里有官方的 codex-auto-review，自动审批默认用它 */
  routeOfficial?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const [saving, setSaving] = useState(false);
  const [forcesMultiAgentV2, setForcesMultiAgentV2] = useState(false);

  const model = settings?.codexStackSubagentModel || undefined;
  const effort = settings?.codexStackSubagentReasoningEffort || undefined;
  const classic = settings?.codexStackClassicTools ?? true;
  const autoReview = settings?.codexStackAutoReviewModel || undefined;
  const selected = models.find((candidate) => candidate.id === model);
  // 选过的模型不在名单里了（成员移除、模型不再发布、成了默认那家）：后端不写
  const unavailable = model !== undefined && selected === undefined;
  const autoReviewUnavailable =
    autoReview !== undefined &&
    !models.some((candidate) => candidate.id === autoReview);

  // config.toml 用 [features] multi_agent_v2 强制了新版工具时，经典开关不生效
  useEffect(() => {
    if (!classic) {
      setForcesMultiAgentV2(false);
      return;
    }
    let cancelled = false;
    void settingsApi
      .codexForcesMultiAgentV2()
      .catch(() => false)
      .then((forced) => {
        if (!cancelled) setForcesMultiAgentV2(forced);
      });
    return () => {
      cancelled = true;
    };
  }, [classic]);

  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      const current = await settingsApi.get();
      await settingsApi.save({ ...current, ...patch });
    } catch (error) {
      toast.error(
        t("webMode.stackSettings.saveFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      await client.invalidateQueries({ queryKey: ["settings"] });
      // 经典开关、审批模型会改合并目录：「Codex 还在用旧的模型列表」提示要重新算
      await client.invalidateQueries({ queryKey: ["appMode", "codex"] });
      setSaving(false);
    }
  };

  const handleModelChange = (next: string) => {
    if (next === UNSET) {
      void save({
        codexStackSubagentModel: undefined,
        codexStackSubagentReasoningEffort: undefined,
      });
      return;
    }
    const candidate = models.find((entry) => entry.id === next);
    // 换模型后旧强度不在新模型的档位里就清掉（否则后端也不会写）
    const keepEffort =
      effort !== undefined && candidate?.efforts.includes(effort)
        ? effort
        : undefined;
    void save({
      codexStackSubagentModel: next,
      codexStackSubagentReasoningEffort: keepEffort,
    });
  };

  const effortValue =
    effort !== undefined && selected?.efforts.includes(effort) ? effort : UNSET;

  return (
    <div
      className="space-y-3 rounded-md border border-border p-3"
      aria-label={t("webMode.stackSettings.title")}
      role="group"
    >
      <p className="text-sm font-medium">{t("webMode.stackSettings.title")}</p>
      <p className="text-sm text-muted-foreground">
        {t("webMode.stackSettings.subagentDescription")}
      </p>
      <label className="block space-y-1 text-sm">
        {t("webMode.stackSettings.subagentModel")}
        <select
          className={selectClass}
          aria-label={t("webMode.stackSettings.subagentModel")}
          value={model ?? UNSET}
          disabled={saving}
          onChange={(event) => handleModelChange(event.target.value)}
        >
          <option value={UNSET}>{t("webMode.stackSettings.followMain")}</option>
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
          {unavailable && (
            <option value={model}>
              {t("webMode.stackSettings.unavailableOption", { model })}
            </option>
          )}
        </select>
      </label>
      {models.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("webMode.stackSettings.noModels")}
        </p>
      )}
      <label className="block space-y-1 text-sm">
        {t("webMode.stackSettings.subagentEffort")}
        <select
          className={selectClass}
          aria-label={t("webMode.stackSettings.subagentEffort")}
          value={effortValue}
          disabled={saving || selected === undefined}
          onChange={(event) =>
            void save({
              codexStackSubagentReasoningEffort:
                event.target.value === UNSET ? undefined : event.target.value,
            })
          }
        >
          <option value={UNSET}>
            {selected?.defaultEffort
              ? t("webMode.stackSettings.effortModelDefaultNamed", {
                  effort: selected.defaultEffort,
                })
              : t("webMode.stackSettings.effortModelDefault")}
          </option>
          {(selected?.efforts ?? []).map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      {unavailable && (
        <p role="status" className={warningClass}>
          {t("webMode.stackSettings.unavailable")}
        </p>
      )}
      {selected && !classic && (
        <p role="status" className={warningClass}>
          {t("webMode.stackSettings.classicOff")}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <label htmlFor="codex-stack-classic-tools">
            {t("webMode.stackSettings.classicTools")}
          </label>
          <p className="text-muted-foreground">
            {t("webMode.stackSettings.classicToolsDescription")}
          </p>
          {/* 开关刚关掉的那一帧检测结果还没清掉；按当前开关判断，不闪旧提示 */}
          {classic && forcesMultiAgentV2 && (
            <p role="status" className={warningClass}>
              {t("webMode.stackSettings.classicToolsForcedV2")}
            </p>
          )}
        </div>
        <Switch
          id="codex-stack-classic-tools"
          checked={classic}
          disabled={saving}
          onCheckedChange={(next) =>
            void save({ codexStackClassicTools: next })
          }
        />
      </div>
      <div className="space-y-1 border-t border-border pt-3 text-sm">
        <label className="block space-y-1">
          {t("webMode.stackSettings.autoReviewModel")}
          <select
            className={selectClass}
            aria-label={t("webMode.stackSettings.autoReviewModel")}
            value={autoReview ?? UNSET}
            disabled={saving}
            onChange={(event) =>
              void save({
                codexStackAutoReviewModel:
                  event.target.value === UNSET ? undefined : event.target.value,
              })
            }
          >
            <option value={UNSET}>
              {routeOfficial
                ? t("webMode.stackSettings.autoReviewDefaultOfficial")
                : t("webMode.stackSettings.autoReviewDefaultMain")}
            </option>
            {models.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
            {autoReviewUnavailable && (
              <option value={autoReview}>
                {t("webMode.stackSettings.unavailableOption", {
                  model: autoReview,
                })}
              </option>
            )}
          </select>
        </label>
        <p className="text-muted-foreground">
          {t("webMode.stackSettings.autoReviewDescription")}
        </p>
        {autoReviewUnavailable && (
          <p role="status" className={warningClass}>
            {t("webMode.stackSettings.autoReviewUnavailable")}
          </p>
        )}
      </div>
    </div>
  );
}
