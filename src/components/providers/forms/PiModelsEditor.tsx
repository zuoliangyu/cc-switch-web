import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  normalizeRequestHeaders,
  findRequestHeaderValue,
} from "./helpers/requestHeaders";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import JsonEditor from "@/components/JsonEditor";
import { ModelDropdown } from "./shared/ModelDropdown";
import { GptContextWindowHint } from "./shared/GptContextWindowHint";
import { REQUIRED_LABEL } from "./BasicFormFields";
import {
  FetchedModelPicker,
  type FetchedModelSelection,
} from "./FetchedModelPicker";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { useModelMetadataFill } from "@/hooks/useModelMetadataFill";
import { useLatestRef } from "@/hooks/useLatestRef";
import { piPresetModelSources } from "@/config/presetModelMetadata";
import { PI_THINKING_LEVELS } from "@/config/piThinkingProfiles";
import type { KnownModelMetadata } from "@/lib/modelMetadata";
import {
  piPresetThinkingFor,
  piSendsReasoningEffort,
  piThinkingLevelMapFromEfforts,
  type PiProviderProtocol,
} from "./modelMetadataFill";

type Model = Record<string, unknown>;
const object = (value: unknown): Model =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Model)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** 保留窗口、思考映射和模型级协议覆盖；已知支持时补上推理与图片能力。 */
export function fillPiModel(
  model: Model,
  metadata: KnownModelMetadata,
  provider: PiProviderProtocol,
): Model {
  const next = { ...model };
  if (
    (model.contextWindow === undefined || model.contextWindow === "") &&
    metadata.contextWindow
  )
    next.contextWindow = metadata.contextWindow;
  if (
    (model.maxTokens === undefined || model.maxTokens === "") &&
    metadata.maxOutputTokens
  )
    next.maxTokens = metadata.maxOutputTokens;
  if (metadata.reasoning === true && model.reasoning !== true)
    next.reasoning = true;
  if (metadata.inputModalities?.includes("image"))
    next.input = [
      ...new Set([
        ...(Array.isArray(model.input) ? model.input : ["text"]),
        "image",
      ]),
    ];
  if (model.thinkingLevelMap === undefined && next.reasoning) {
    const effective = {
      ...provider,
      api: text(model.api) || provider.api,
      baseUrl: text(model.baseUrl) || provider.baseUrl,
      compat: { ...provider.compat, ...object(model.compat) },
    };
    const preset = piPresetThinkingFor(metadata.piThinking, effective);
    const map =
      preset?.map ??
      (piSendsReasoningEffort(effective)
        ? piThinkingLevelMapFromEfforts(metadata.reasoningEfforts)
        : undefined);
    if (map) {
      next.thinkingLevelMap = map;
      if (preset && Object.keys(preset.missingCompat).length)
        next.compat = { ...object(model.compat), ...preset.missingCompat };
    }
  }
  return next;
}

export function PiModelsEditor({
  value,
  onChange,
  protocol,
  apiKey,
  headers = {},
  locked = false,
}: {
  value: string;
  onChange: (value: string) => void;
  protocol: PiProviderProtocol;
  apiKey: string;
  headers?: Record<string, string>;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const models = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) &&
        parsed.every(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
        ? (parsed as Model[])
        : null;
    } catch {
      return null;
    }
  }, [value]);
  const latest = useLatestRef(models);
  const valueRef = useLatestRef(value);
  const protocolRef = useLatestRef(protocol);
  const onChangeRef = useLatestRef(onChange);
  const lockedRef = useLatestRef(locked);
  const scope = JSON.stringify([protocol, apiKey, headers]);
  const scopeRef = useLatestRef(scope);
  const revision = useRef(0);
  // 最近一次补全写下的内容：同一批加入的几行各自补参数，别的行的补全不算外部改动
  const lastFill = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [catalog, setCatalog] = useState<{
    scope: string;
    models: FetchedModel[];
  } | null>(null);
  const [fetching, setFetching] = useState(false);
  const fetched = catalog?.scope === scope ? catalog.models : [];
  const fill = useModelMetadataFill({
    baseUrl: protocol.baseUrl,
    presets: piPresetModelSources,
    prefetch: fetched.length > 0,
  });
  const commit = (next: Model[]) => {
    if (lockedRef.current) return;
    latest.current = next;
    valueRef.current = JSON.stringify(next, null, 2);
    onChangeRef.current(valueRef.current);
  };
  const edit = (index: number, patch: Model) => {
    revision.current++;
    commit(
      (latest.current ?? []).map((model, i) =>
        i === index ? { ...model, ...patch } : model,
      ),
    );
  };
  const select = (index: number, id: string) => {
    const current = latest.current?.[index];
    if (!current) return;
    edit(index, {
      id,
      ...(!current.name || current.name === current.id ? { name: id } : {}),
    });
    fillRow(index, id);
  };
  /** 按模型 ID 补窗口、推理、图片与思考映射；`silent` 时不弹补全提示（弹窗里已显示过）。 */
  const fillRow = (index: number, id: string, silent?: boolean) => {
    const current = latest.current?.[index];
    if (!current) return;
    const selectedRevision = revision.current;
    const selectedScope = scopeRef.current;
    let expectedValue = valueRef.current;
    fill(
      id,
      (metadata) => {
        const rows = latest.current;
        // 外部 JSON、预设替换、删行、切地址或继续手改后，迟到补全不得覆盖新草稿。
        if (
          !alive.current ||
          lockedRef.current ||
          revision.current !== selectedRevision ||
          scopeRef.current !== selectedScope ||
          !rows ||
          rows[index]?.id !== id
        )
          return false;
        if (
          valueRef.current !== expectedValue &&
          valueRef.current !== lastFill.current
        )
          return false;
        const next = fillPiModel(rows[index], metadata, protocolRef.current);
        if (JSON.stringify(next) === JSON.stringify(rows[index])) return false;
        const nextRows = rows.map((row, i) => (i === index ? next : row));
        expectedValue = JSON.stringify(nextRows, null, 2);
        commit(nextRows);
        lastFill.current = valueRef.current;
        return true;
      },
      { baseUrl: text(current.baseUrl) || protocol.baseUrl, silent },
    );
  };
  const applyFetched = ({ add, remove }: FetchedModelSelection) => {
    const removed = new Set(remove);
    const kept = (latest.current ?? []).filter(
      (model) => !removed.has(text(model.id)),
    );
    const configured = new Set(kept.map((model) => text(model.id)));
    const added = add.filter((id) => !configured.has(id));
    revision.current++;
    commit([
      ...kept,
      ...added.map((id) => ({
        id,
        name: id,
        reasoning: false,
        input: ["text"],
      })),
    ]);
    // 每行各自补参数：迟到的补全按行号与 ID 核对，期间又改过就不覆盖
    added.forEach((id, offset) => fillRow(kept.length + offset, id, true));
  };
  const fetch = async () => {
    const requestScope = scope;
    const requestHeaders = normalizeRequestHeaders(headers);
    const hasApiKey = Boolean(apiKey) || Object.keys(requestHeaders).length > 0;
    if (!protocol.baseUrl.trim() || !hasApiKey) {
      showFetchModelsError(null, t, {
        hasBaseUrl: Boolean(protocol.baseUrl.trim()),
        hasApiKey,
      });
      return;
    }
    setFetching(true);
    try {
      const result = await fetchModelsForConfig(
        protocol.baseUrl.trim(),
        apiKey,
        undefined,
        undefined,
        findRequestHeaderValue(requestHeaders, "user-agent"),
        { apiFormat: protocol.api, requestHeaders },
      );
      if (alive.current && scopeRef.current === requestScope) {
        const seen = new Set<string>();
        setCatalog({
          scope: requestScope,
          models: result.filter((model) => {
            if (seen.has(model.id)) return false;
            seen.add(model.id);
            return true;
          }),
        });
        if (result.length === 0) toast.info(t("providerForm.fetchModelsEmpty"));
      }
    } catch (error) {
      if (alive.current && scopeRef.current === requestScope)
        showFetchModelsError(error, t, {
          hasBaseUrl: Boolean(protocol.baseUrl),
          hasApiKey,
        });
    } finally {
      if (alive.current) setFetching(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={locked || !models}
          onClick={() => {
            revision.current++;
            commit([
              ...(latest.current ?? []),
              { id: "", name: "", reasoning: false, input: ["text"] },
            ]);
          }}
        >
          {t("pi.modelsEditor.add")}
        </Button>
        {locked || !models ? (
          <Button type="button" variant="outline" size="sm" disabled>
            {t("providerForm.fetchModels")}
          </Button>
        ) : (
          <FetchedModelPicker
            models={fetched}
            configuredModelIds={models.map((model) => text(model.id))}
            onApply={applyFetched}
            onFetch={() => void fetch()}
            isFetching={fetching}
            metadataSource={{
              baseUrl: protocol.baseUrl,
              presets: piPresetModelSources,
            }}
          />
        )}
      </div>
      {!models && (
        <p role="alert" className="text-sm text-destructive">
          {t("pi.provider.invalidJson")}
        </p>
      )}
      {models?.map((model, index) => (
        <fieldset
          key={index}
          disabled={locked}
          className="min-w-0 space-y-3 rounded-lg border p-4"
        >
          <legend className="px-1 text-sm font-medium">
            {text(model.name) ||
              text(model.id) ||
              `${t("pi.modelsEditor.model")} ${index + 1}`}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className={REQUIRED_LABEL}>ID</span>
              <div className="flex gap-1">
                <Input
                  aria-label={`ID ${index + 1}`}
                  value={text(model.id)}
                  onChange={(event) => edit(index, { id: event.target.value })}
                />
                {fetched.length > 0 && (
                  <ModelDropdown
                    models={fetched}
                    onSelect={(id) => select(index, id)}
                  />
                )}
              </div>
            </label>
            <label className="space-y-1 text-sm">
              <span className={REQUIRED_LABEL}>
                {t("pi.modelsEditor.name")}
              </span>
              <Input
                value={text(model.name)}
                onChange={(event) => edit(index, { name: event.target.value })}
              />
            </label>
            {(["contextWindow", "maxTokens"] as const).map((field) => (
              <label key={field} className="space-y-1 text-sm">
                <span className={REQUIRED_LABEL}>
                  {t(`pi.modelsEditor.${field}`)}
                </span>
                <Input
                  type="number"
                  min={1}
                  value={typeof model[field] === "number" ? model[field] : ""}
                  onChange={(event) =>
                    edit(index, {
                      [field]:
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                    })
                  }
                />
                {field === "contextWindow" && (
                  <GptContextWindowHint
                    modelId={text(model.id)}
                    contextWindow={model.contextWindow}
                  />
                )}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={model.reasoning === true}
                onChange={(event) =>
                  edit(index, { reasoning: event.target.checked })
                }
              />
              {t("pi.modelsEditor.reasoning")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  Array.isArray(model.input) && model.input.includes("image")
                }
                onChange={(event) =>
                  edit(index, {
                    input: [
                      ...(Array.isArray(model.input)
                        ? model.input.filter((item) => item !== "image")
                        : ["text"]),
                      ...(event.target.checked ? ["image"] : []),
                    ],
                  })
                }
              />
              {t("pi.modelsEditor.image")}
            </label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              {t("pi.modelsEditor.thinking")}
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PI_THINKING_LEVELS.map((level) => {
                const map = object(model.thinkingLevelMap);
                const mode =
                  map[level] === undefined
                    ? "default"
                    : map[level] === null
                      ? "unsupported"
                      : "custom";
                return (
                  <div
                    key={level}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <span className="w-14 shrink-0">{level}</span>
                    <select
                      aria-label={`${level} ${index + 1}`}
                      className="h-9 min-w-0 rounded border bg-background"
                      value={mode}
                      onChange={(event) => {
                        const next = { ...map };
                        if (event.target.value === "default")
                          delete next[level];
                        else
                          next[level] =
                            event.target.value === "unsupported" ? null : level;
                        edit(index, { thinkingLevelMap: next });
                      }}
                    >
                      <option value="default">
                        {t("pi.modelsEditor.default")}
                      </option>
                      <option value="unsupported">
                        {t("pi.modelsEditor.unsupported")}
                      </option>
                      <option value="custom">
                        {t("pi.modelsEditor.custom")}
                      </option>
                    </select>
                    {mode === "custom" && (
                      <Input
                        aria-label={`${level} ${t("pi.modelsEditor.value")} ${index + 1}`}
                        value={text(map[level])}
                        onChange={(event) =>
                          edit(index, {
                            thinkingLevelMap: {
                              ...map,
                              [level]: event.target.value,
                            },
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </details>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              revision.current++;
              commit((latest.current ?? []).filter((_, i) => i !== index));
            }}
          >
            {t("common.delete")}
          </Button>
        </fieldset>
      ))}
      <details>
        <summary className="cursor-pointer text-sm">
          {t("pi.modelsEditor.json")}
        </summary>
        <div className="mt-2">
          <JsonEditor
            value={value}
            onChange={(next) => {
              revision.current++;
              onChange(next);
            }}
            rows={12}
          />
        </div>
      </details>
    </div>
  );
}
