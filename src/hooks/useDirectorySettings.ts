import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi, type AppId } from "@/lib/api";
import type { SettingsFormState } from "./useSettingsForm";

type DirectoryKey =
  | "appConfig"
  | "claude"
  | "codex"
  | "gemini"
  | "grokbuild"
  | "opencode"
  | "openclaw"
  | "hermes";

export interface ResolvedDirectories {
  appConfig: string;
  claude: string;
  codex: string;
  gemini: string;
  grokbuild: string;
  opencode: string;
  openclaw: string;
  hermes: string;
}

const sanitizeDir = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export interface UseDirectorySettingsProps {
  settings?: SettingsFormState | null;
  onUpdateSettings: (updates: Partial<SettingsFormState>) => void;
}

export interface UseDirectorySettingsResult {
  appConfigDir?: string;
  resolvedDirs: ResolvedDirectories;
  isLoading: boolean;
  initialAppConfigDir?: string;
  updateDirectory: (app: AppId, value?: string) => void;
  updateAppConfigDir: (value?: string) => void;
  browseDirectory: (app: AppId) => Promise<void>;
  browseAppConfigDir: () => Promise<void>;
  resetDirectory: (app: AppId) => Promise<void>;
  resetAppConfigDir: () => Promise<void>;
  resetAllDirectories: (
    claudeDir?: string,
    codexDir?: string,
    geminiDir?: string,
    grokDir?: string,
    opencodeDir?: string,
    openclawDir?: string,
    hermesDir?: string,
  ) => void;
}

/**
 * useDirectorySettings - 目录管理
 * 负责：
 * - appConfigDir 状态
 * - resolvedDirs 状态
 * - 目录选择（browse）
 * - 目录重置
 * - 默认值加载（由本地 Rust 服务提供）
 */
export function useDirectorySettings({
  settings: _settings,
  onUpdateSettings,
}: UseDirectorySettingsProps): UseDirectorySettingsResult {
  const { t } = useTranslation();

  const [appConfigDir, setAppConfigDir] = useState<string | undefined>(
    undefined,
  );
  const [resolvedDirs, setResolvedDirs] = useState<ResolvedDirectories>({
    appConfig: "",
    claude: "",
    codex: "",
    gemini: "",
    grokbuild: "",
    opencode: "",
    openclaw: "",
    hermes: "",
  });
  const [isLoading, setIsLoading] = useState(true);

  const defaultsRef = useRef<ResolvedDirectories>({
    appConfig: "",
    claude: "",
    codex: "",
    gemini: "",
    grokbuild: "",
    opencode: "",
    openclaw: "",
    hermes: "",
  });
  const initialAppConfigDirRef = useRef<string | undefined>(undefined);

  // 加载目录信息
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const load = async () => {
      try {
        const [
          overrideRaw,
          resolvedAppConfigDir,
          claudeDir,
          codexDir,
          geminiDir,
          grokDir,
          opencodeDir,
          openclawDir,
          hermesDir,
          defaultAppConfig,
          defaultClaudeDir,
          defaultCodexDir,
          defaultGeminiDir,
          defaultGrokDir,
          defaultOpencodeDir,
          defaultOpenclawDir,
          defaultHermesDir,
        ] = await Promise.all([
          settingsApi.getAppConfigDirOverride(),
          settingsApi.getAppConfigDir(),
          settingsApi.getConfigDir("claude"),
          settingsApi.getConfigDir("codex"),
          settingsApi.getConfigDir("gemini"),
          settingsApi.getConfigDir("grokbuild"),
          settingsApi.getConfigDir("opencode"),
          settingsApi.getConfigDir("openclaw"),
          settingsApi.getConfigDir("hermes"),
          settingsApi.getDefaultAppConfigDir(),
          settingsApi.getDefaultConfigDir("claude"),
          settingsApi.getDefaultConfigDir("codex"),
          settingsApi.getDefaultConfigDir("gemini"),
          settingsApi.getDefaultConfigDir("grokbuild"),
          settingsApi.getDefaultConfigDir("opencode"),
          settingsApi.getDefaultConfigDir("openclaw"),
          settingsApi.getDefaultConfigDir("hermes"),
        ]);

        if (!active) return;

        const normalizedOverride = sanitizeDir(overrideRaw ?? undefined);

        defaultsRef.current = {
          appConfig: defaultAppConfig ?? "",
          claude: defaultClaudeDir ?? "",
          codex: defaultCodexDir ?? "",
          gemini: defaultGeminiDir ?? "",
          grokbuild: defaultGrokDir ?? "",
          opencode: defaultOpencodeDir ?? "",
          openclaw: defaultOpenclawDir ?? "",
          hermes: defaultHermesDir ?? "",
        };

        setAppConfigDir(normalizedOverride);
        initialAppConfigDirRef.current = normalizedOverride;

        setResolvedDirs({
          appConfig:
            normalizedOverride ??
            resolvedAppConfigDir ??
            defaultsRef.current.appConfig,
          claude: claudeDir || defaultsRef.current.claude,
          codex: codexDir || defaultsRef.current.codex,
          gemini: geminiDir || defaultsRef.current.gemini,
          grokbuild: grokDir || defaultsRef.current.grokbuild,
          opencode: opencodeDir || defaultsRef.current.opencode,
          openclaw: openclawDir || defaultsRef.current.openclaw,
          hermes: hermesDir || defaultsRef.current.hermes,
        });
      } catch (error) {
        console.error(
          "[useDirectorySettings] Failed to load directory info",
          error,
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const updateDirectoryState = useCallback(
    (key: DirectoryKey, value?: string) => {
      const sanitized = sanitizeDir(value);
      if (key === "appConfig") {
        setAppConfigDir(sanitized);
      } else {
        onUpdateSettings(
          key === "claude"
            ? { claudeConfigDir: sanitized }
            : key === "codex"
              ? { codexConfigDir: sanitized }
              : key === "gemini"
                ? { geminiConfigDir: sanitized }
                : key === "grokbuild"
                  ? { grokConfigDir: sanitized }
                  : key === "opencode"
                    ? { opencodeConfigDir: sanitized }
                    : key === "openclaw"
                      ? { openclawConfigDir: sanitized }
                      : { hermesConfigDir: sanitized },
        );
      }

      setResolvedDirs((prev) => ({
        ...prev,
        [key]: sanitized ?? defaultsRef.current[key],
      }));
    },
    [onUpdateSettings],
  );

  const updateAppConfigDir = useCallback(
    (value?: string) => {
      updateDirectoryState("appConfig", value);
    },
    [updateDirectoryState],
  );

  const updateDirectory = useCallback(
    (app: AppId, value?: string) => {
      updateDirectoryState(
        app === "claude"
          ? "claude"
          : app === "codex"
            ? "codex"
            : app === "gemini"
              ? "gemini"
              : app === "grokbuild"
                ? "grokbuild"
                : app === "opencode"
                  ? "opencode"
                  : app === "openclaw"
                    ? "openclaw"
                    : "hermes",
        value,
      );
    },
    [updateDirectoryState],
  );

  const browseDirectory = useCallback(
    async (_app: AppId) => {
      toast.info(
        t("settings.selectFileFailed", {
          defaultValue: "Web 版请直接手动填写目录路径",
        }),
      );
    },
    [t],
  );

  const browseAppConfigDir = useCallback(async () => {
    toast.info(
      t("settings.selectFileFailed", {
        defaultValue: "Web 版请直接手动填写目录路径",
      }),
    );
  }, [t]);

  const resetDirectory = useCallback(
    async (app: AppId) => {
      const key: DirectoryKey =
        app === "claude"
          ? "claude"
          : app === "codex"
            ? "codex"
            : app === "gemini"
              ? "gemini"
              : app === "grokbuild"
                ? "grokbuild"
                : app === "opencode"
                  ? "opencode"
                  : app === "openclaw"
                    ? "openclaw"
                    : "hermes";
      if (!defaultsRef.current[key]) {
        try {
          const fallback = await settingsApi.getDefaultConfigDir(app);
          defaultsRef.current = {
            ...defaultsRef.current,
            [key]: fallback,
          };
        } catch (error) {
          console.error(
            "[useDirectorySettings] Failed to reload default config dir",
            error,
          );
        }
      }
      updateDirectoryState(key, undefined);
    },
    [updateDirectoryState],
  );

  const resetAppConfigDir = useCallback(async () => {
    if (!defaultsRef.current.appConfig) {
      try {
        const fallback = await settingsApi.getDefaultAppConfigDir();
        defaultsRef.current = {
          ...defaultsRef.current,
          appConfig: fallback,
        };
      } catch (error) {
        console.error(
          "[useDirectorySettings] Failed to reload default app config dir",
          error,
        );
      }
    }
    updateDirectoryState("appConfig", undefined);
  }, [updateDirectoryState]);

  const resetAllDirectories = useCallback(
    (
      claudeDir?: string,
      codexDir?: string,
      geminiDir?: string,
      grokDir?: string,
      opencodeDir?: string,
      openclawDir?: string,
      hermesDir?: string,
    ) => {
      setAppConfigDir(initialAppConfigDirRef.current);
      setResolvedDirs({
        appConfig:
          initialAppConfigDirRef.current ?? defaultsRef.current.appConfig,
        claude: claudeDir ?? defaultsRef.current.claude,
        codex: codexDir ?? defaultsRef.current.codex,
        gemini: geminiDir ?? defaultsRef.current.gemini,
        grokbuild: grokDir ?? defaultsRef.current.grokbuild,
        opencode: opencodeDir ?? defaultsRef.current.opencode,
        openclaw: openclawDir ?? defaultsRef.current.openclaw,
        hermes: hermesDir ?? defaultsRef.current.hermes,
      });
    },
    [],
  );

  return {
    appConfigDir,
    resolvedDirs,
    isLoading,
    initialAppConfigDir: initialAppConfigDirRef.current,
    updateDirectory,
    updateAppConfigDir,
    browseDirectory,
    browseAppConfigDir,
    resetDirectory,
    resetAppConfigDir,
    resetAllDirectories,
  };
}
