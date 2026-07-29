import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Link2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractErrorMessage } from "@/utils/errorUtils";
import { decodeBase64Utf8 } from "@/lib/utils/base64";
import {
  classifyCommand,
  classifyEndpoint,
  classifyEnvKey,
  decodeDeeplinkPayload,
  maskValue,
  riskI18nKey,
  type RiskKind,
} from "@/utils/deeplinkRisk";
import {
  extractDeepLinkFromLocation,
  mergeDeepLinkConfig,
  parseDeepLinkConfigObject,
  parseDeepLinkUrl,
} from "@/lib/deeplink/parser";
import { importFromDeepLink } from "@/lib/deeplink/importer";
import type { DeepLinkImportRequest } from "@/lib/deeplink/types";

const OPEN_EVENT = "cc-switch-open-deeplink-import";

type ProviderConfigPreview =
  | { kind: "claude"; env: Record<string, unknown> }
  | { kind: "codex"; auth: Record<string, unknown>; tomlConfig: string }
  | { kind: "gemini"; env: Record<string, unknown> }
  | { kind: "generic"; raw: Record<string, unknown> };

const formatPreviewValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildProviderConfigPreview = (
  request: DeepLinkImportRequest | null,
  parsedConfig: Record<string, unknown> | null,
): ProviderConfigPreview | null => {
  if (!request || request.resource !== "provider" || !parsedConfig) {
    return null;
  }

  switch (request.app) {
    case "claude": {
      const env =
        parsedConfig.env &&
        typeof parsedConfig.env === "object" &&
        !Array.isArray(parsedConfig.env)
          ? (parsedConfig.env as Record<string, unknown>)
          : null;
      return env && Object.keys(env).length > 0
        ? { kind: "claude", env }
        : { kind: "generic", raw: parsedConfig };
    }
    case "codex": {
      const auth =
        parsedConfig.auth &&
        typeof parsedConfig.auth === "object" &&
        !Array.isArray(parsedConfig.auth)
          ? (parsedConfig.auth as Record<string, unknown>)
          : {};
      const tomlConfig =
        typeof parsedConfig.config === "string" ? parsedConfig.config : "";
      return Object.keys(auth).length > 0 || tomlConfig
        ? { kind: "codex", auth, tomlConfig }
        : { kind: "generic", raw: parsedConfig };
    }
    case "gemini":
      return Object.keys(parsedConfig).length > 0
        ? { kind: "gemini", env: parsedConfig }
        : { kind: "generic", raw: parsedConfig };
    default:
      return { kind: "generic", raw: parsedConfig };
  }
};

const getTitleKey = (request: DeepLinkImportRequest | null) => {
  switch (request?.resource) {
    case "prompt":
      return "deeplink.importPrompt";
    case "mcp":
      return "deeplink.importMcp";
    case "skill":
      return "deeplink.importSkill";
    default:
      return "deeplink.confirmImport";
  }
};

const getDescriptionKey = (request: DeepLinkImportRequest | null) => {
  switch (request?.resource) {
    case "prompt":
      return "deeplink.importPromptDescription";
    case "mcp":
      return "deeplink.importMcpDescription";
    case "skill":
      return "deeplink.importSkillDescription";
    default:
      return "deeplink.confirmImportDescription";
  }
};

export function DeepLinkImportDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [rawValue, setRawValue] = useState("");
  const [request, setRequest] = useState<DeepLinkImportRequest | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const resetState = () => {
    setRawValue("");
    setRequest(null);
    setParseError(null);
    setIsImporting(false);
    setIsParsing(false);
  };

  const parseAndOpen = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setOpen(true);
      return;
    }

    setIsParsing(true);
    try {
      const parsed = parseDeepLinkUrl(trimmed);
      setRawValue(trimmed);
      setParseError(null);
      setRequest(parsed);
      setOpen(true);

      try {
        const merged = await mergeDeepLinkConfig(parsed);
        setRequest(merged);
      } catch (error) {
        toast.error(t("deeplink.configMergeError"), {
          description: extractErrorMessage(error),
          closeButton: true,
        });
      }
    } catch (error) {
      const message = extractErrorMessage(error);
      setRawValue(trimmed);
      setRequest(null);
      setParseError(message);
      setOpen(true);
      toast.error(t("deeplink.parseError"), {
        description: message,
        closeButton: true,
      });
    } finally {
      setIsParsing(false);
    }
  };

  useEffect(() => {
    const autoDeepLink = extractDeepLinkFromLocation(window.location);
    if (!autoDeepLink) {
      return;
    }

    void parseAndOpen(autoDeepLink);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("deeplink");
    window.history.replaceState(
      {},
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ deeplink?: string }>).detail;
      void parseAndOpen(detail?.deeplink ?? "");
    };
    window.addEventListener(OPEN_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(OPEN_EVENT, handler as EventListener);
  }, []);

  const parsedConfig = useMemo(() => {
    if (!request) {
      return null;
    }

    try {
      return parseDeepLinkConfigObject(request);
    } catch {
      return null;
    }
  }, [request]);

  const decodedPromptContent = useMemo(() => {
    return decodeDeeplinkPayload(request?.content, decodeBase64Utf8);
  }, [request?.content]);

  const mcpServers = useMemo(() => {
    if (request?.resource !== "mcp" || !parsedConfig) {
      return {};
    }
    if (
      "mcpServers" in parsedConfig &&
      parsedConfig.mcpServers &&
      typeof parsedConfig.mcpServers === "object"
    ) {
      return parsedConfig.mcpServers as Record<string, unknown>;
    }
    return parsedConfig;
  }, [parsedConfig, request?.resource]);

  const mcpRisks = useMemo(() => {
    const found = new Set<RiskKind>();
    for (const spec of Object.values(mcpServers)) {
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
      const server = spec as Record<string, unknown>;
      const commandRisk = classifyCommand(server.command, server.args);
      const endpointRisk = classifyEndpoint(server.url);
      if (commandRisk) found.add(commandRisk);
      if (endpointRisk) found.add(endpointRisk);
      if (server.env && typeof server.env === "object") {
        for (const key of Object.keys(server.env)) {
          const risk = classifyEnvKey(key);
          if (risk) found.add(risk);
        }
      }
    }
    return [...found];
  }, [mcpServers]);

  const targetApps = useMemo(() => {
    if (request?.resource !== "mcp") {
      return [];
    }
    return (request.apps ?? "")
      .split(",")
      .map((app) => app.trim())
      .filter(Boolean);
  }, [request?.apps, request?.resource]);

  const providerConfigPreview = useMemo(
    () => buildProviderConfigPreview(request, parsedConfig),
    [parsedConfig, request],
  );

  const handleParse = () => {
    void parseAndOpen(rawValue);
  };

  const handleImport = async () => {
    if (!request) {
      return;
    }

    setIsImporting(true);
    try {
      const result = await importFromDeepLink(request);

      if (result.type === "provider") {
        await queryClient.invalidateQueries({
          queryKey: ["providers"],
          refetchType: "all",
        });
        toast.success(t("deeplink.importSuccess"), {
          description: t("deeplink.importSuccessDescription", {
            name: request.name,
          }),
          closeButton: true,
        });
      } else if (result.type === "prompt") {
        window.dispatchEvent(
          new CustomEvent("prompt-imported", {
            detail: { app: request.app, id: result.id },
          }),
        );
        toast.success(t("deeplink.promptImportSuccess"), {
          description: t("deeplink.promptImportSuccessDescription", {
            name: request.name,
          }),
          closeButton: true,
        });
      } else if (result.type === "mcp") {
        await queryClient.invalidateQueries({
          queryKey: ["mcp", "all"],
          refetchType: "all",
        });
        if (result.failed.length > 0) {
          toast.warning(t("deeplink.mcpPartialSuccess"), {
            description: t("deeplink.mcpPartialSuccessDescription", {
              success: result.importedCount,
              failed: result.failed.length,
            }),
            closeButton: true,
          });
        } else {
          toast.success(t("deeplink.mcpImportSuccess"), {
            description: t("deeplink.mcpImportSuccessDescription", {
              count: result.importedCount,
            }),
            closeButton: true,
          });
        }
      } else if (result.type === "skill") {
        await queryClient.invalidateQueries({
          queryKey: ["skills"],
          refetchType: "all",
        });
        toast.success(t("deeplink.skillImportSuccess"), {
          description: t("deeplink.skillImportSuccessDescription", {
            repo: result.key,
          }),
          closeButton: true,
        });
      }

      setOpen(false);
      resetState();
    } catch (error) {
      toast.error(t("deeplink.importError"), {
        description: extractErrorMessage(error),
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>{t(getTitleKey(request))}</DialogTitle>
          <DialogDescription>{t(getDescriptionKey(request))}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("deeplink.manualInput")}
            </label>
            <Textarea
              value={rawValue}
              onChange={(event) => setRawValue(event.target.value)}
              rows={4}
              placeholder="ccswitch://v1/import?resource=provider&app=claude&name=..."
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleParse}
                disabled={isParsing}
              >
                <Wand2 className="mr-2 h-4 w-4" />
                {t("deeplink.parse")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("deeplink.manualInputHint")}
              </p>
            </div>
          </div>

          {parseError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {parseError}
            </div>
          )}

          {request && (
            <div className="max-h-[52vh] space-y-4 overflow-y-auto rounded-xl border border-border bg-muted/30 p-4">
              {request.resource === "provider" && (
                <div className="space-y-3">
                  {request.icon && (
                    <div className="flex justify-center pb-1 pt-2">
                      <ProviderIcon
                        icon={request.icon}
                        name={request.name || request.icon}
                        size={80}
                        className="drop-shadow-sm"
                      />
                    </div>
                  )}
                  <InfoRow
                    label={t("deeplink.app")}
                    value={request.app ?? "-"}
                  />
                  <InfoRow
                    label={t("deeplink.providerName")}
                    value={request.name ?? "-"}
                  />
                  <InfoRow
                    label={t("deeplink.homepage")}
                    value={request.homepage ?? "-"}
                    mono
                  />
                  <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
                    <div className="text-sm font-medium text-muted-foreground">
                      {t("deeplink.endpoint")}
                    </div>
                    <div className="space-y-1 text-sm font-mono break-all">
                      {(request.endpoint ?? "-")
                        .split(",")
                        .map((endpoint) => endpoint.trim())
                        .filter(Boolean)
                        .map((endpoint, index, items) => (
                          <div
                            key={`${endpoint}-${index}`}
                            className={`${
                              index === 0 ? "font-medium" : "text-muted-foreground"
                            } ${
                              classifyEndpoint(endpoint)
                                ? "text-yellow-700 dark:text-yellow-400"
                                : ""
                            }`}
                          >
                            {classifyEndpoint(endpoint) && "⚠ "}
                            {index === 0 ? "🔹 " : "└ "}
                            {endpoint}
                            {index === 0 && items.length > 1 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({t("deeplink.primaryEndpoint")})
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                  <InfoRow
                    label={t("deeplink.apiKey")}
                    value={
                      request.apiKey
                        ? maskValue("apiKey", request.apiKey)
                        : "****"
                    }
                    mono
                  />
                  {request.model && (
                    <InfoRow
                      label={t(
                        request.app === "claude"
                          ? "deeplink.multiModel"
                          : "deeplink.model",
                      )}
                      value={request.model}
                      mono
                    />
                  )}
                  {request.haikuModel && (
                    <InfoRow
                      label={t("deeplink.haikuModel")}
                      value={request.haikuModel}
                      mono
                    />
                  )}
                  {request.sonnetModel && (
                    <InfoRow
                      label={t("deeplink.sonnetModel")}
                      value={request.sonnetModel}
                      mono
                    />
                  )}
                  {request.opusModel && (
                    <InfoRow
                      label={t("deeplink.opusModel")}
                      value={request.opusModel}
                      mono
                    />
                  )}
                  {request.notes && (
                    <InfoRow
                      label={t("deeplink.notes")}
                      value={request.notes}
                    />
                  )}
                  {(request.config || request.configUrl) && (
                    <InfoRow
                      label={t("deeplink.configSource")}
                      value={`${request.configUrl ? t("deeplink.configRemote") : t("deeplink.configEmbedded")}${
                        request.configFormat
                          ? ` (${request.configFormat.toUpperCase()})`
                          : ""
                      }`}
                    />
                  )}
                  {request.configUrl && (
                    <InfoRow
                      label={t("deeplink.configUrl")}
                      value={request.configUrl}
                      mono
                    />
                  )}
                  {providerConfigPreview && (
                    <PreviewCard title={t("deeplink.configDetails")}>
                      {providerConfigPreview.kind === "codex" ? (
                        <div className="space-y-3">
                          {Object.keys(providerConfigPreview.auth).length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("deeplink.configAuth")}
                              </div>
                              <ConfigEntryList
                                entries={Object.entries(providerConfigPreview.auth)}
                              />
                            </div>
                          )}
                          {providerConfigPreview.tomlConfig && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("deeplink.configToml")}
                              </div>
                              <pre className="max-h-24 overflow-x-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs">
                                {providerConfigPreview.tomlConfig.slice(0, 300)}
                                {providerConfigPreview.tomlConfig.length > 300
                                  ? "..."
                                  : ""}
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : providerConfigPreview.kind === "claude" ||
                        providerConfigPreview.kind === "gemini" ? (
                        <ConfigEntryList
                          entries={Object.entries(providerConfigPreview.env)}
                        />
                      ) : (
                        <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                          {JSON.stringify(providerConfigPreview.raw, null, 2).slice(
                            0,
                            1200,
                          )}
                        </pre>
                      )}
                    </PreviewCard>
                  )}
                  {(request.usageScript ||
                    request.usageEnabled !== undefined ||
                    request.usageApiKey ||
                    request.usageBaseUrl ||
                    request.usageAutoInterval !== undefined) && (
                    <PreviewCard title={t("deeplink.usageScript")}>
                      <div className="space-y-3">
                        <InfoRow
                          label={t("deeplink.usageScript")}
                          value={
                            request.usageEnabled === true
                              ? t("deeplink.usageScriptEnabled")
                              : t("deeplink.usageScriptDisabled")
                          }
                        />
                        {request.usageScript && (
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-muted-foreground">
                              {t("deeplink.usageScriptCode")}
                            </div>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/40 p-2 font-mono text-xs">
                              {decodeDeeplinkPayload(
                                request.usageScript,
                                decodeBase64Utf8,
                              )}
                            </pre>
                            <div className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-300">
                              <span aria-hidden="true">⚠️</span>
                              <span>{t("deeplink.usageScriptWarning")}</span>
                            </div>
                          </div>
                        )}
                        {request.usageApiKey &&
                          request.usageApiKey !== request.apiKey && (
                            <InfoRow
                              label={t("deeplink.usageApiKey")}
                              value={maskValue(
                                "usageApiKey",
                                request.usageApiKey,
                              )}
                              mono
                            />
                          )}
                        {request.usageBaseUrl &&
                          request.usageBaseUrl !== request.endpoint && (
                            <InfoRow
                              label={t("deeplink.usageBaseUrl")}
                              value={request.usageBaseUrl}
                              mono
                            />
                          )}
                        {request.usageAutoInterval &&
                          request.usageAutoInterval > 0 && (
                            <InfoRow
                              label={t("deeplink.usageAutoInterval")}
                              value={t("deeplink.usageAutoIntervalValue", {
                                minutes: request.usageAutoInterval,
                              })}
                            />
                          )}
                      </div>
                    </PreviewCard>
                  )}
                </div>
              )}

              {request.resource === "prompt" && (
                <div className="space-y-3">
                  <div className="text-lg font-semibold">
                    {t("deeplink.prompt.title")}
                  </div>
                  <InfoRow
                    label={t("deeplink.prompt.app")}
                    value={request.app ?? "-"}
                  />
                  <InfoRow
                    label={t("deeplink.prompt.name")}
                    value={request.name ?? "-"}
                  />
                  {request.description && (
                    <InfoRow
                      label={t("deeplink.prompt.description")}
                      value={request.description}
                    />
                  )}
                  <PreviewCard title={t("deeplink.prompt.contentPreview")}>
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                      {decodedPromptContent.slice(0, 1200)}
                      {decodedPromptContent.length > 1200 ? "..." : ""}
                    </pre>
                  </PreviewCard>
                  {request.enabled && (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
                      {t("deeplink.prompt.enabledWarning")}
                    </div>
                  )}
                </div>
              )}

              {request.resource === "mcp" && (
                <div className="space-y-3">
                  <div className="text-lg font-semibold">
                    {t("deeplink.mcp.title")}
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      {t("deeplink.mcp.targetApps")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {targetApps.length > 0 ? (
                        targetApps.map((app) => (
                          <span
                            key={app}
                            className="rounded-full bg-primary/10 px-2.5 py-1 text-xs capitalize text-primary"
                          >
                            {app}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t("deeplink.mcp.serverCount", {
                      count: Object.keys(mcpServers).length,
                    })}
                  </div>
                  {Object.keys(mcpServers).length > 0 && (
                    <PreviewCard title={t("deeplink.mcp.serverPreview")}>
                      <div className="space-y-2">
                        {Object.entries(mcpServers).map(([id, spec]) => {
                          const server =
                            spec &&
                            typeof spec === "object" &&
                            !Array.isArray(spec)
                              ? (spec as Record<string, unknown>)
                              : null;
                          const args = Array.isArray(server?.args)
                            ? server.args
                            : [];
                          const env =
                            server?.env && typeof server.env === "object"
                              ? (server.env as Record<string, unknown>)
                              : {};
                          const commandRisk = classifyCommand(
                            server?.command,
                            server?.args,
                          );
                          return (
                            <div
                              key={id}
                              className="rounded-lg border border-border bg-background/70 p-3"
                            >
                              <div className="mb-1 text-sm font-medium">{id}</div>
                              <div className="space-y-1">
                                {server?.command !== undefined && (
                                  <McpRow
                                    label={t("deeplink.mcp.command")}
                                    value={formatPreviewValue(server.command)}
                                    risk={commandRisk}
                                  />
                                )}
                                {args.map((arg, index) => (
                                  <McpRow
                                    key={index}
                                    label={
                                      index === 0 ? t("deeplink.mcp.args") : ""
                                    }
                                    value={formatPreviewValue(arg)}
                                    risk={commandRisk}
                                  />
                                ))}
                                {server?.url !== undefined && (
                                  <McpRow
                                    label={t("deeplink.mcp.url")}
                                    value={formatPreviewValue(server.url)}
                                    risk={classifyEndpoint(server.url)}
                                  />
                                )}
                                {Object.entries(env).map(([key, value], index) => (
                                  <McpRow
                                    key={key}
                                    label={index === 0 ? t("deeplink.mcp.env") : ""}
                                    value={`${key}=${maskValue(
                                      key,
                                      formatPreviewValue(value),
                                    )}`}
                                    risk={classifyEnvKey(key)}
                                  />
                                ))}
                                {!server && (
                                  <McpRow value={formatPreviewValue(spec)} label="" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </PreviewCard>
                  )}
                  {!parsedConfig && request.config && (
                    <PreviewCard title={t("deeplink.mcp.rawPayload")}>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-yellow-700 dark:text-yellow-300">
                        {decodeDeeplinkPayload(
                          request.config,
                          decodeBase64Utf8,
                        )}
                      </pre>
                    </PreviewCard>
                  )}
                  {mcpRisks.length > 0 && (
                    <div className="space-y-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                      {mcpRisks.map((risk) => (
                        <div
                          key={risk}
                          className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-300"
                        >
                          <span aria-hidden="true">⚠️</span>
                          <span>{t(riskI18nKey(risk))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
                    {t("deeplink.mcp.enabledWarning")}
                  </div>
                </div>
              )}

              {request.resource === "skill" && (
                <div className="space-y-3">
                  <div className="text-lg font-semibold">
                    {t("deeplink.skill.title")}
                  </div>
                  <InfoRow
                    label={t("deeplink.skill.repo")}
                    value={request.repo ?? "-"}
                    mono
                  />
                  <InfoRow
                    label={t("deeplink.skill.directory")}
                    value={request.directory ?? "-"}
                    mono
                  />
                  <InfoRow
                    label={t("deeplink.skill.branch")}
                    value={request.branch || "main"}
                    mono
                  />
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                    <p>{t("deeplink.skill.hint")}</p>
                    <p className="mt-1">{t("deeplink.skill.hintDetail")}</p>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("deeplink.warning")}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isImporting || isParsing}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleImport}
            disabled={!request || isImporting || isParsing}
          >
            {isImporting ? (
              <>
                <Download className="mr-2 h-4 w-4 animate-pulse" />
                {t("deeplink.importing")}
              </>
            ) : (
              <>
                <Link2 className="mr-2 h-4 w-4" />
                {t("deeplink.import")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div
        className={mono ? "break-all font-mono text-sm" : "break-words text-sm"}
      >
        {value}
      </div>
    </div>
  );
}

function PreviewCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/80 p-3">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function McpRow({
  label,
  value,
  risk,
}: {
  label: string;
  value: string;
  risk?: RiskKind | null;
}) {
  return (
    <div className="grid grid-cols-[4rem_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`break-all font-mono ${
          risk ? "font-semibold text-yellow-700 dark:text-yellow-400" : ""
        }`}
      >
        {risk && <span aria-hidden="true">⚠ </span>}
        {value}
      </span>
    </div>
  );
}

function ConfigEntryList({
  entries,
}: {
  entries: Array<[string, unknown]>;
}) {
  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-2 gap-2 text-xs">
          <span
            className={`break-all font-mono ${
              classifyEnvKey(key)
                ? "font-semibold text-yellow-700 dark:text-yellow-400"
                : "text-muted-foreground"
            }`}
          >
            {classifyEnvKey(key) && <span aria-hidden="true">⚠ </span>}
            {key}
          </span>
          <span className="break-all font-mono">
            {maskValue(key, formatPreviewValue(value))}
          </span>
        </div>
      ))}
    </div>
  );
}
