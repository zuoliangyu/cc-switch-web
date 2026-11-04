import { ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeStackModel } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FetchedModelPicker } from "./FetchedModelPicker";
import type { FetchedModel } from "@/lib/api/model-fetch";
import {
  hasClaudeOneMMarker,
  stripClaudeOneMMarker,
} from "./hooks/useModelState";

export function normalizeAggregationModels(
  rows: ClaudeStackModel[],
): ClaudeStackModel[] {
  const models: ClaudeStackModel[] = [];
  for (const row of rows) {
    const model = stripClaudeOneMMarker(row.model.trim()).trim();
    if (!model) continue;
    const oneM = row.oneM === true || hasClaudeOneMMarker(row.model);
    const displayName = row.displayName?.trim() || undefined;
    const existing = models.find((m) => m.model === model);
    if (existing) {
      if (oneM) existing.oneM = true;
      if (!existing.displayName && displayName)
        existing.displayName = displayName;
    } else
      models.push({
        model,
        ...(oneM ? { oneM: true } : {}),
        ...(displayName ? { displayName } : {}),
      });
  }
  return models;
}

export function ClaudeAggregationModels({
  value,
  onChange,
  fetchedModels = [],
  onFetchModels,
  isFetching = false,
}: {
  value?: ClaudeStackModel[];
  onChange: (models: ClaudeStackModel[] | undefined) => void;
  fetchedModels?: FetchedModel[];
  onFetchModels?: () => void;
  isFetching?: boolean;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<ClaudeStackModel>) =>
    onChange(
      value?.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">
        {t("webMode.models.title")}
      </legend>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value !== undefined}
          onCheckedChange={(enabled) =>
            onChange(enabled ? [{ model: "" }] : undefined)
          }
        />
        {t("webMode.models.custom")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("webMode.models.hint")}
      </p>
      {value?.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            aria-label={t("webMode.models.id", { index: index + 1 })}
            value={row.model}
            onChange={(e) => update(index, { model: e.target.value })}
          />
          <Input
            className="min-w-32 flex-1"
            aria-label={t("webMode.models.name", { index: index + 1 })}
            value={row.displayName ?? ""}
            onChange={(e) => update(index, { displayName: e.target.value })}
          />
          <label className="flex items-center gap-1 text-sm">
            <Checkbox
              checked={row.oneM === true}
              onCheckedChange={(oneM) => update(index, { oneM: oneM === true })}
            />
            1M
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={index === 0}
            aria-label={t("webMode.models.first")}
            onClick={() =>
              onChange([row, ...value.filter((_, i) => i !== index)])
            }
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("common.delete")}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {value && (
        <div className="flex flex-wrap gap-2">
          {(onFetchModels || fetchedModels.length > 0) && (
            <FetchedModelPicker
              models={fetchedModels}
              configuredModelIds={normalizeAggregationModels(value).map(
                (row) => row.model,
              )}
              onApply={({ add, remove }) => {
                const removed = new Set(remove);
                const kept = value.filter(
                  (row) =>
                    !removed.has(
                      stripClaudeOneMMarker(row.model.trim()).trim(),
                    ),
                );
                onChange(
                  normalizeAggregationModels([
                    ...kept,
                    ...add.map((model) => ({ model })),
                  ]),
                );
              }}
              onFetch={onFetchModels ?? (() => {})}
              isFetching={isFetching}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1"
            onClick={() => onChange([...value, { model: "" }])}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("webMode.models.add")}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
