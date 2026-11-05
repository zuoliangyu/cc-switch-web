import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "@/types";
import type { AppModeSubagentModel } from "@/types/proxy";
import { settingsApi } from "@/lib/api/settings";
import { SettingsSwitchRow } from "@/components/settings/SettingsLayout";

// 原生 select 的空值代表「不写这个键」：子代理跟随主模型 / 用模型默认档。
const UNSET = "";

export const STACK_WARNING_CLASS =
  "rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400";
export const STACK_SELECT_CLASS =
  "h-9 w-full rounded-md border border-border-default bg-background px-2 text-sm";
export const STACK_LABEL_CLASS = "text-xs font-semibold text-muted-foreground";

export interface StackSubagentValue {
  model?: string;
  effort?: string;
  classic: boolean;
}

/** 子代理设置 → settings.json 字段（未设置的键写 undefined，保存时去掉）。 */
export function stackSubagentSettings(
  value: StackSubagentValue,
): Partial<Settings> {
  return {
    codexStackSubagentModel: value.model,
    codexStackSubagentReasoningEffort: value.effort,
    codexStackClassicTools: value.classic,
  };
}

/** settings.json → 子代理设置。 */
export function stackSubagentValue(settings?: Settings): StackSubagentValue {
  return {
    model: settings?.codexStackSubagentModel || undefined,
    effort: settings?.codexStackSubagentReasoningEffort || undefined,
    classic: settings?.codexStackClassicTools ?? true,
  };
}

export function sameStackSubagent(
  a: StackSubagentValue,
  b: StackSubagentValue,
): boolean {
  return (
    a.model === b.model && a.effort === b.effort && a.classic === b.classic
  );
}

interface StackSubagentFieldsProps {
  /** 能选的模型：已去掉默认那家（它不发布 `ccs-*` 模型） */
  models: AppModeSubagentModel[];
  value: StackSubagentValue;
  onChange: (next: StackSubagentValue) => void;
  disabled?: boolean;
}

/**
 * Codex 聚合的子代理模型、推理强度和经典子代理开关（上游 6aeaeb17）。聚合设置面板（改了就保存）
 * 和切换到聚合的确认框（确认时一起保存）共用。
 */
export function StackSubagentFields({
  models,
  value,
  onChange,
  disabled,
}: StackSubagentFieldsProps) {
  const { t } = useTranslation();
  const [forcesMultiAgentV2, setForcesMultiAgentV2] = useState(false);
  const { model, effort, classic } = value;
  const selected = models.find((candidate) => candidate.id === model);
  // 选过的模型不在名单里了（成员移除、模型不再发布、成了默认那家）：后端不写，跟随主模型
  const unavailable = model !== undefined && selected === undefined;

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

  const handleModelChange = (next: string) => {
    if (next === UNSET) {
      onChange({ ...value, model: undefined, effort: undefined });
      return;
    }
    const candidate = models.find((entry) => entry.id === next);
    // 换模型后旧强度不在新模型的档位里就清掉（否则后端也不会写）
    const keepEffort =
      effort !== undefined && candidate?.efforts.includes(effort)
        ? effort
        : undefined;
    onChange({ ...value, model: next, effort: keepEffort });
  };

  const modelLabel = t("mode.stackSettings.subagentModel");
  const effortLabel = t("mode.stackSettings.subagentEffort");
  const classicLabel = t("settings.codexStackClassicSubagents");
  const effortValue =
    effort !== undefined && selected?.efforts.includes(effort) ? effort : UNSET;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className={STACK_LABEL_CLASS} htmlFor="stack-subagent-model">
          {modelLabel}
        </label>
        <select
          id="stack-subagent-model"
          className={STACK_SELECT_CLASS}
          aria-label={modelLabel}
          value={model ?? UNSET}
          disabled={disabled}
          onChange={(event) => handleModelChange(event.target.value)}
        >
          <option value={UNSET}>{t("mode.stackSettings.followMain")}</option>
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
          {unavailable && (
            <option value={model}>
              {t("mode.stackSettings.unavailableOption", { model })}
            </option>
          )}
        </select>
        {models.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("mode.stackSettings.noModels")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className={STACK_LABEL_CLASS} htmlFor="stack-subagent-effort">
          {effortLabel}
        </label>
        <select
          id="stack-subagent-effort"
          className={STACK_SELECT_CLASS}
          aria-label={effortLabel}
          value={effortValue}
          disabled={disabled || selected === undefined}
          onChange={(event) =>
            onChange({
              ...value,
              effort:
                event.target.value === UNSET ? undefined : event.target.value,
            })
          }
        >
          <option value={UNSET}>
            {selected?.defaultEffort
              ? t("mode.stackSettings.effortModelDefaultNamed", {
                  effort: selected.defaultEffort,
                })
              : t("mode.stackSettings.effortModelDefault")}
          </option>
          {(selected?.efforts ?? []).map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>

      {unavailable && (
        <p
          role="status"
          data-testid="stack-subagent-unavailable"
          className={STACK_WARNING_CLASS}
        >
          {t("mode.stackSettings.unavailable")}
        </p>
      )}
      {selected && !classic && (
        <p
          role="status"
          data-testid="stack-subagent-classic-off"
          className={STACK_WARNING_CLASS}
        >
          {t("mode.stackSettings.classicOff")}
        </p>
      )}

      <SettingsSwitchRow
        label={classicLabel}
        help={{
          title: classicLabel,
          body: t("settings.codexStackClassicSubagentsDescription"),
        }}
        description={
          // 开关刚关掉的那一帧检测结果还没清掉；按当前开关判断，不闪旧提示
          classic && forcesMultiAgentV2 ? (
            <span role="status" className="text-amber-700 dark:text-amber-400">
              {t("settings.codexStackClassicSubagentsForcedV2")}
            </span>
          ) : undefined
        }
        checked={classic}
        disabled={disabled}
        onCheckedChange={(next) => onChange({ ...value, classic: next })}
      />
    </div>
  );
}
