import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Terminal,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getVersion } from "@/lib/runtime/client/app";
import { settingsApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import appIcon from "@/assets/icons/app-icon.png";
import { isWindows } from "@/lib/platform";
import { useUpdate } from "@/contexts/UpdateContext";

interface ToolVersion {
  name: string;
  version: string | null;
  latest_version: string | null;
  error: string | null;
  env_type: "windows" | "wsl" | "macos" | "linux" | "unknown";
  wsl_distro: string | null;
}

const TOOL_NAMES = ["claude", "codex", "gemini", "opencode"] as const;
type ToolName = (typeof TOOL_NAMES)[number];

type WslShellPreference = {
  wslShell?: string | null;
  wslShellFlag?: string | null;
};

const WSL_SHELL_OPTIONS = ["sh", "bash", "zsh", "fish", "dash"] as const;
// UI-friendly order: login shell first.
const WSL_SHELL_FLAG_OPTIONS = ["-lic", "-lc", "-c"] as const;

const ENV_BADGE_CONFIG: Record<
  string,
  { labelKey: string; className: string }
> = {
  wsl: {
    labelKey: "settings.envBadge.wsl",
    className: "theme-chip-warm border-transparent",
  },
  windows: {
    labelKey: "settings.envBadge.windows",
    className: "theme-chip-primary border-transparent",
  },
  macos: {
    labelKey: "settings.envBadge.macos",
    className: "theme-chip-neutral border-transparent",
  },
  linux: {
    labelKey: "settings.envBadge.linux",
    className: "theme-chip-success border-transparent",
  },
};

const ONE_CLICK_INSTALL_COMMANDS = `# Claude Code (Native install - recommended)
curl -fsSL https://claude.ai/install.sh | bash
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
curl -fsSL https://opencode.ai/install | bash`;

const WEB_REPOSITORY_URL =
  "https://github.com/zuoliangyu/zuoliangyu-cc-switch-web";
const AUTHOR_BILIBILI_URL = "https://space.bilibili.com/27619688";

export function AboutSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);
  const [toolVersions, setToolVersions] = useState<ToolVersion[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(true);
  const { hasUpdate, latestRelease, updateInfo, isChecking, checkUpdate } =
    useUpdate();

  const [wslShellByTool, setWslShellByTool] = useState<
    Record<string, WslShellPreference>
  >({});
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});

  const refreshToolVersions = useCallback(
    async (
      toolNames: ToolName[],
      wslOverrides?: Record<string, WslShellPreference>,
    ) => {
      if (toolNames.length === 0) return;

      // 单工具刷新使用统一后端入口（get_tool_versions）并带工具过滤。
      setLoadingTools((prev) => {
        const next = { ...prev };
        for (const name of toolNames) next[name] = true;
        return next;
      });

      try {
        const updated = await settingsApi.getToolVersions(
          toolNames,
          wslOverrides,
        );

        setToolVersions((prev) => {
          if (prev.length === 0) return updated;
          const byName = new Map(updated.map((t) => [t.name, t]));
          const merged = prev.map((t) => byName.get(t.name) ?? t);
          const existing = new Set(prev.map((t) => t.name));
          for (const u of updated) {
            if (!existing.has(u.name)) merged.push(u);
          }
          return merged;
        });
      } catch (error) {
        console.error("[AboutSection] Failed to refresh tools", error);
      } finally {
        setLoadingTools((prev) => {
          const next = { ...prev };
          for (const name of toolNames) next[name] = false;
          return next;
        });
      }
    },
    [],
  );

  const loadAllToolVersions = useCallback(async () => {
    setIsLoadingTools(true);
    try {
      // Respect current UI overrides (shell / flag) when doing a full refresh.
      const versions = await settingsApi.getToolVersions(
        [...TOOL_NAMES],
        wslShellByTool,
      );
      setToolVersions(versions);
    } catch (error) {
      console.error("[AboutSection] Failed to load tool versions", error);
    } finally {
      setIsLoadingTools(false);
    }
  }, [wslShellByTool]);

  const handleToolShellChange = async (toolName: ToolName, value: string) => {
    const wslShell = value === "auto" ? null : value;
    const nextPref: WslShellPreference = {
      ...(wslShellByTool[toolName] ?? {}),
      wslShell,
    };
    setWslShellByTool((prev) => ({ ...prev, [toolName]: nextPref }));
    await refreshToolVersions([toolName], { [toolName]: nextPref });
  };

  const handleToolShellFlagChange = async (
    toolName: ToolName,
    value: string,
  ) => {
    const wslShellFlag = value === "auto" ? null : value;
    const nextPref: WslShellPreference = {
      ...(wslShellByTool[toolName] ?? {}),
      wslShellFlag,
    };
    setWslShellByTool((prev) => ({ ...prev, [toolName]: nextPref }));
    await refreshToolVersions([toolName], { [toolName]: nextPref });
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [appVersion] = await Promise.all([
          getVersion(),
          ...(isWindows() ? [] : [loadAllToolVersions()]),
        ]);

        if (active) {
          setVersion(appVersion);
        }
      } catch (error) {
        console.error("[AboutSection] Failed to load info", error);
        if (active) {
          setVersion(null);
        }
      } finally {
        if (active) {
          setIsLoadingVersion(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
    // Mount-only: loadAllToolVersions is intentionally excluded to avoid
    // re-fetching all tools whenever wslShellByTool changes. Single-tool
    // refreshes are handled by refreshToolVersions in the shell/flag handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenReleaseNotes = useCallback(async () => {
    try {
      if (hasUpdate && latestRelease?.htmlUrl) {
        await settingsApi.openExternal(latestRelease.htmlUrl);
        return;
      }

      const targetVersion = version ?? "";
      const displayVersion = targetVersion.startsWith("v")
        ? targetVersion
        : targetVersion
          ? `v${targetVersion}`
          : "";

      if (!displayVersion) {
        await settingsApi.openExternal(`${WEB_REPOSITORY_URL}/releases`);
        return;
      }

      await settingsApi.openExternal(
        `${WEB_REPOSITORY_URL}/releases/tag/${displayVersion}`,
      );
    } catch (error) {
      console.error("[AboutSection] Failed to open release notes", error);
      toast.error(t("settings.openReleaseNotesFailed"));
    }
  }, [hasUpdate, latestRelease?.htmlUrl, t, version]);

  const handleOpenRepository = useCallback(async () => {
    try {
      await settingsApi.openExternal(WEB_REPOSITORY_URL);
    } catch (error) {
      console.error("[AboutSection] Failed to open repository", error);
      toast.error(t("settings.openProjectRepoFailed"));
    }
  }, [t]);

  const handleCheckLatestRelease = useCallback(async () => {
    try {
      const available = await checkUpdate();
      if (!available) {
        toast.success(t("settings.upToDate"), { closeButton: true });
      }
    } catch (error) {
      console.error("[AboutSection] Failed to check latest release", error);
      toast.error(t("settings.checkUpdateFailed"));
    }
  }, [checkUpdate, t]);

  const handleOpenAuthorContact = useCallback(async () => {
    try {
      await settingsApi.openExternal(AUTHOR_BILIBILI_URL);
    } catch (error) {
      console.error("[AboutSection] Failed to open author contact", error);
      toast.error(t("settings.openAuthorContactFailed"));
    }
  }, [t]);

  const handleCopyInstallCommands = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ONE_CLICK_INSTALL_COMMANDS);
      toast.success(t("settings.installCommandsCopied"), { closeButton: true });
    } catch (error) {
      console.error("[AboutSection] Failed to copy install commands", error);
      toast.error(t("settings.installCommandsCopyFailed"));
    }
  }, [t]);

  const displayVersion = version ?? t("common.unknown");

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("common.about")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.aboutHint")}
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-6 space-y-5 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <img src={appIcon} alt="CC Switch Web" className="h-5 w-5" />
              <h4 className="text-lg font-semibold text-foreground">
                CC Switch Web
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 bg-background/80">
                <span className="text-muted-foreground">
                  {t("common.version")}
                </span>
                {isLoadingVersion ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="font-medium">{`v${displayVersion}`}</span>
                )}
              </Badge>
              {latestRelease && (
                <Badge
                  variant={hasUpdate ? "secondary" : "outline"}
                  className="gap-1.5 bg-background/80"
                >
                  {hasUpdate
                    ? t("settings.updateAvailable", {
                        version: latestRelease.latestVersion,
                      })
                    : t("settings.upToDate")}
                </Badge>
              )}
            </div>
          </div>

          {/* 上游 f8821c03：引导用户为 Web 仓库点 Star */}
          <p className="min-w-0 flex-1 text-xs leading-relaxed sm:text-right">
            <a
              href={WEB_REPOSITORY_URL}
              onClick={(event) => {
                event.preventDefault();
                handleOpenRepository();
              }}
              className="font-medium text-primary hover:underline"
            >
              {t("settings.starPrompt")}
            </a>
            <span aria-hidden="true" className="ml-1.5">
              👉
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenRepository}
              className="h-8 gap-1.5 border-primary/30 bg-primary/10 text-xs text-primary hover:bg-primary/20 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.projectRepo")}
              <span
                aria-hidden="true"
                className="inline-block animate-[spin_4s_linear_infinite] motion-reduce:animate-none"
              >
                ⭐
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCheckLatestRelease}
              disabled={isChecking}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw
                className={isChecking ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
              />
              {isChecking ? t("settings.checking") : t("settings.checkLatestRelease")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenAuthorContact}
              className="h-8 gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.authorBilibili")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenReleaseNotes}
              className="h-8 gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.releaseNotes")}
            </Button>
          </div>
        </div>

        {hasUpdate && updateInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm"
          >
            <p className="mb-1 font-medium text-primary">
              {t("settings.updateAvailable", {
                version: updateInfo.latestVersion,
              })}
            </p>
            {updateInfo.notes && (
              <p className="line-clamp-4 leading-relaxed text-muted-foreground">
                {updateInfo.notes}
              </p>
            )}
          </motion.div>
        )}
      </motion.div>

      {!isWindows() && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium">
              {t("settings.localEnvCheck")}
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => loadAllToolVersions()}
              disabled={isLoadingTools}
            >
              <RefreshCw
                className={
                  isLoadingTools ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
                }
              />
              {isLoadingTools ? t("common.refreshing") : t("common.refresh")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 px-1">
            {TOOL_NAMES.map((toolName, index) => {
              const tool = toolVersions.find((item) => item.name === toolName);
              // Special case for OpenCode (capital C), others use capitalize
              const displayName =
                toolName === "opencode"
                  ? "OpenCode"
                  : toolName.charAt(0).toUpperCase() + toolName.slice(1);
              const title = tool?.version || tool?.error || t("common.unknown");

              return (
                <motion.div
                  key={toolName}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.15 + index * 0.05 }}
                  whileHover={{ scale: 1.02 }}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 shadow-sm transition-colors hover:border-primary/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{displayName}</span>
                      {/* Environment Badge */}
                      {tool?.env_type && ENV_BADGE_CONFIG[tool.env_type] && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full border ${ENV_BADGE_CONFIG[tool.env_type].className}`}
                        >
                          {t(ENV_BADGE_CONFIG[tool.env_type].labelKey)}
                        </span>
                      )}
                      {/* WSL Shell Selector */}
                      {tool?.env_type === "wsl" && (
                        <Select
                          value={wslShellByTool[toolName]?.wslShell || "auto"}
                          onValueChange={(v) =>
                            handleToolShellChange(toolName, v)
                          }
                          disabled={isLoadingTools || loadingTools[toolName]}
                        >
                          <SelectTrigger className="h-6 w-[70px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              {t("common.auto")}
                            </SelectItem>
                            {WSL_SHELL_OPTIONS.map((shell) => (
                              <SelectItem key={shell} value={shell}>
                                {shell}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {/* WSL Shell Flag Selector */}
                      {tool?.env_type === "wsl" && (
                        <Select
                          value={
                            wslShellByTool[toolName]?.wslShellFlag || "auto"
                          }
                          onValueChange={(v) =>
                            handleToolShellFlagChange(toolName, v)
                          }
                          disabled={isLoadingTools || loadingTools[toolName]}
                        >
                          <SelectTrigger className="h-6 w-[70px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              {t("common.auto")}
                            </SelectItem>
                            {WSL_SHELL_FLAG_OPTIONS.map((flag) => (
                              <SelectItem key={flag} value={flag}>
                                {flag}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {isLoadingTools || loadingTools[toolName] ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : tool?.version ? (
                      tool.latest_version &&
                      tool.version !== tool.latest_version ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                          {tool.latest_version}
                        </span>
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )
                    ) : (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    )}
                  </div>
                  <div
                    className="text-xs font-mono text-muted-foreground truncate"
                    title={title}
                  >
                    {isLoadingTools
                      ? t("common.loading")
                      : tool?.version
                        ? tool.version
                        : tool?.error || t("common.notInstalled")}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {!isWindows() && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="space-y-3"
        >
          <h3 className="text-sm font-medium px-1">
            {t("settings.oneClickInstall")}
          </h3>
          <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t("settings.oneClickInstallHint")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyInstallCommands}
                className="h-7 gap-1.5 text-xs"
              >
                <Copy className="h-3.5 w-3.5" />
                {t("common.copy")}
              </Button>
            </div>
            <pre className="text-xs font-mono bg-background/80 px-3 py-2.5 rounded-lg border border-border/60 overflow-x-auto">
              {ONE_CLICK_INSTALL_COMMANDS}
            </pre>
          </div>
        </motion.div>
      )}
    </motion.section>
  );
}
