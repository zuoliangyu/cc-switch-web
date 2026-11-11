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
  | "hermes"
  | "pi"
  | "omp"
  | "dsh";

export interface ResolvedDirectories {
  appConfig: string;
  claude: string;
  codex: string;
  gemini: string;
  grokbuild: string;
  opencode: string;
  openclaw: string;
  hermes: string;
  pi: string;
  omp: string;
  dsh: string;
}

type AppDirectoryKey = Exclude<DirectoryKey, "appConfig">;

const DIRECTORY_KEY_TO_SETTINGS_FIELD: Record<
  AppDirectoryKey,
  keyof SettingsFormState
> = {
  claude: "claudeConfigDir",
  codex: "codexConfigDir",
  gemini: "geminiConfigDir",
  grokbuild: "grokConfigDir",
  opencode: "opencodeConfigDir",
  openclaw: "openclawConfigDir",
  hermes: "hermesConfigDir",
  pi: "piConfigDir",
  omp: "ompConfigDir",
  dsh: "dshConfigDir",
};

const APP_DIRECTORY_KEYS = Object.keys(
  DIRECTORY_KEY_TO_SETTINGS_FIELD,
) as AppDirectoryKey[];

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
  markAppConfigDirSaved: (value?: string) => void;
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
    piDir?: string,
    ompDir?: string,
    dshDir?: string,
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
  settings,
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
    pi: "",
    omp: "",
    dsh: "",
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
    pi: "",
    omp: "",
    dsh: "",
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
          piDir,
          ompDir,
          dshDir,
          defaultAppConfig,
          defaultClaudeDir,
          defaultCodexDir,
          defaultGeminiDir,
          defaultGrokDir,
          defaultOpencodeDir,
          defaultOpenclawDir,
          defaultHermesDir,
          defaultPiDir,
          defaultOmpDir,
          defaultDshDir,
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
          settingsApi.getConfigDir("pi"),
          settingsApi.getConfigDir("omp"),
          settingsApi.getConfigDir("dsh"),
          settingsApi.getDefaultAppConfigDir(),
          settingsApi.getDefaultConfigDir("claude"),
          settingsApi.getDefaultConfigDir("codex"),
          settingsApi.getDefaultConfigDir("gemini"),
          settingsApi.getDefaultConfigDir("grokbuild"),
          settingsApi.getDefaultConfigDir("opencode"),
          settingsApi.getDefaultConfigDir("openclaw"),
          settingsApi.getDefaultConfigDir("hermes"),
          settingsApi.getDefaultConfigDir("pi"),
          settingsApi.getDefaultConfigDir("omp"),
          settingsApi.getDefaultConfigDir("dsh"),
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
          pi: defaultPiDir ?? "",
          omp: defaultOmpDir ?? "",
          dsh: defaultDshDir ?? "",
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
          pi: piDir || defaultsRef.current.pi,
          omp: ompDir || defaultsRef.current.omp,
          dsh: dshDir || defaultsRef.current.dsh,
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

  // 设置被重新读取时（例如别的设置项自动保存后），表单里的目录草稿会回到已保存的值；
  // 显示的目录跟着回去，本地刚改的那次不算（上游 99277921）。
  const previousSettingsRef = useRef(settings);
  const localDirectoryUpdatesRef = useRef<
    Partial<Record<AppDirectoryKey, string | undefined>>
  >({});
  // 每个目录的显示版本号：较新的编辑 / 重置之后，晚到的后端解析结果不再覆盖
  const directoryRevisionsRef = useRef<
    Partial<Record<AppDirectoryKey, number>>
  >({});
  const bumpRevision = (key: AppDirectoryKey) => {
    const revision = (directoryRevisionsRef.current[key] ?? 0) + 1;
    directoryRevisionsRef.current[key] = revision;
    return revision;
  };
  useEffect(() => {
    const previousSettings = previousSettingsRef.current;
    previousSettingsRef.current = settings;
    if (!previousSettings || !settings) return;

    for (const key of APP_DIRECTORY_KEYS) {
      const field = DIRECTORY_KEY_TO_SETTINGS_FIELD[key];
      const value = sanitizeDir(settings[field] as string | undefined);
      if (
        value === sanitizeDir(previousSettings[field] as string | undefined)
      ) {
        continue;
      }
      if (
        key in localDirectoryUpdatesRef.current &&
        localDirectoryUpdatesRef.current[key] === value
      ) {
        delete localDirectoryUpdatesRef.current[key];
        continue;
      }
      delete localDirectoryUpdatesRef.current[key];
      const revision = bumpRevision(key);
      setResolvedDirs((prev) => ({
        ...prev,
        [key]: value ?? defaultsRef.current[key],
      }));
      if (value !== undefined) continue;

      // 清掉的覆盖交给后端解析：默认目录可能随平台或环境变量变化
      void settingsApi.getConfigDir(key as AppId).then(
        (resolved) => {
          setResolvedDirs((prev) =>
            directoryRevisionsRef.current[key] === revision
              ? { ...prev, [key]: resolved }
              : prev,
          );
        },
        (error) => {
          console.error(
            "[useDirectorySettings] Failed to resolve config dir",
            error,
          );
        },
      );
    }
  }, [settings]);

  useEffect(
    () => () => {
      for (const key of APP_DIRECTORY_KEYS) bumpRevision(key);
    },
    [],
  );

  const updateDirectoryState = useCallback(
    (key: DirectoryKey, value?: string) => {
      const sanitized = sanitizeDir(value);
      if (key === "appConfig") {
        setAppConfigDir(sanitized);
      } else {
        // 本地编辑已在下面更新显示，等这次改动回到 settings 时不再重复处理；
        // 也不让更早发出的后端解析盖掉它
        bumpRevision(key);
        localDirectoryUpdatesRef.current[key] = sanitized;
        onUpdateSettings({ [DIRECTORY_KEY_TO_SETTINGS_FIELD[key]]: sanitized });
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
                    : app === "hermes"
                      ? "hermes"
                      : app === "omp"
                        ? "omp"
                        : app === "dsh"
                          ? "dsh"
                          : "pi",
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
                    : app === "hermes"
                      ? "hermes"
                      : app === "omp"
                        ? "omp"
                        : app === "dsh"
                          ? "dsh"
                          : "pi";
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
      piDir?: string,
      ompDir?: string,
      dshDir?: string,
    ) => {
      for (const key of APP_DIRECTORY_KEYS) bumpRevision(key);
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
        pi: piDir ?? defaultsRef.current.pi,
        omp: ompDir ?? defaultsRef.current.omp,
        dsh: dshDir ?? defaultsRef.current.dsh,
      });
    },
    [],
  );

  const markAppConfigDirSaved = useCallback((value?: string) => {
    initialAppConfigDirRef.current = value;
  }, []);

  return {
    appConfigDir,
    resolvedDirs,
    isLoading,
    initialAppConfigDir: initialAppConfigDirRef.current,
    markAppConfigDirSaved,
    updateDirectory,
    updateAppConfigDir,
    browseDirectory,
    browseAppConfigDir,
    resetDirectory,
    resetAppConfigDir,
    resetAllDirectories,
  };
}
