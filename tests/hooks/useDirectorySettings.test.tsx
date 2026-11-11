import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDirectorySettings } from "@/hooks/useDirectorySettings";
import type { SettingsFormState } from "@/hooks/useSettingsForm";

const getAppConfigDirOverrideMock = vi.hoisted(() => vi.fn());
const getAppConfigDirMock = vi.hoisted(() => vi.fn());
const getDefaultAppConfigDirMock = vi.hoisted(() => vi.fn());
const getConfigDirMock = vi.hoisted(() => vi.fn());
const getDefaultConfigDirMock = vi.hoisted(() => vi.fn());
const setAppConfigDirOverrideMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  settingsApi: {
    getAppConfigDirOverride: getAppConfigDirOverrideMock,
    getAppConfigDir: getAppConfigDirMock,
    getDefaultAppConfigDir: getDefaultAppConfigDirMock,
    getConfigDir: getConfigDirMock,
    getDefaultConfigDir: getDefaultConfigDirMock,
    setAppConfigDirOverride: setAppConfigDirOverrideMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: (...args: unknown[]) => toastInfoMock(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (options?.defaultValue as string) ?? key,
  }),
}));

const createSettings = (
  overrides: Partial<SettingsFormState> = {},
): SettingsFormState => ({
  claudeConfigDir: "/claude/custom",
  codexConfigDir: "/codex/custom",
  language: "zh",
  ...overrides,
});

describe("useDirectorySettings", () => {
  const onUpdateSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    getAppConfigDirOverrideMock.mockResolvedValue(null);
    getAppConfigDirMock.mockResolvedValue("/default/app");
    getDefaultAppConfigDirMock.mockResolvedValue("/default/app");
    getConfigDirMock.mockImplementation(async (app: string) => {
      if (app === "claude") return "/remote/claude";
      if (app === "codex") return "/remote/codex";
      if (app === "gemini") return "/remote/gemini";
      if (app === "grokbuild") return "/remote/grokbuild";
      if (app === "dsh") return "/remote/dsh";
      return "/remote/opencode";
    });
    getDefaultConfigDirMock.mockImplementation(async (app: string) => {
      if (app === "claude") return "/default/claude";
      if (app === "codex") return "/default/codex";
      if (app === "gemini") return "/default/gemini";
      if (app === "grokbuild") return "/default/grokbuild";
      if (app === "dsh") return "/default/dsh";
      return "/default/opencode";
    });
  });

  it("initializes directories using overrides and remote defaults", async () => {
    getAppConfigDirOverrideMock.mockResolvedValue("  /override/app  ");

    const { result } = renderHook(() =>
      useDirectorySettings({ settings: createSettings(), onUpdateSettings }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.appConfigDir).toBe("/override/app");
    expect(result.current.resolvedDirs).toEqual({
      appConfig: "/override/app",
      claude: "/remote/claude",
      codex: "/remote/codex",
      gemini: "/remote/gemini",
      grokbuild: "/remote/grokbuild",
      opencode: "/remote/opencode",
      openclaw: "/remote/opencode",
      hermes: "/remote/opencode",
      pi: "/remote/opencode",
      omp: "/remote/opencode",
      dsh: "/remote/dsh",
    });
  });

  it.each([
    ["claude", "claudeConfigDir"],
    ["codex", "codexConfigDir"],
    ["gemini", "geminiConfigDir"],
    ["grokbuild", "grokConfigDir"],
    ["opencode", "opencodeConfigDir"],
    ["openclaw", "openclawConfigDir"],
    ["hermes", "hermesConfigDir"],
    ["pi", "piConfigDir"],
    ["omp", "ompConfigDir"],
    ["dsh", "dshConfigDir"],
  ] as const)(
    "syncs the %s display when form drafts are discarded",
    async (app, field) => {
      const initialSettings = createSettings({ [field]: undefined });
      const { result, rerender } = renderHook(
        ({ settings }) => useDirectorySettings({ settings, onUpdateSettings }),
        { initialProps: { settings: initialSettings } },
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const backendDirectory = result.current.resolvedDirs[app];
      rerender({
        settings: { ...initialSettings, skipClaudeOnboarding: true },
      });
      expect(result.current.resolvedDirs[app]).toBe(backendDirectory);

      act(() => result.current.updateAppConfigDir("/unsaved/app"));
      rerender({
        settings: { ...initialSettings, [field]: "/unsaved/config" },
      });
      expect(result.current.resolvedDirs[app]).toBe("/unsaved/config");

      // 别的设置自动保存后重新读取：草稿被丢弃，显示回到后端解析的目录
      rerender({ settings: initialSettings });
      await waitFor(() =>
        expect(result.current.resolvedDirs[app]).toBe(backendDirectory),
      );
      expect(result.current.appConfigDir).toBe("/unsaved/app");
      expect(result.current.resolvedDirs.appConfig).toBe("/unsaved/app");

      rerender({ settings: { ...initialSettings, [field]: "/saved/config" } });
      expect(result.current.resolvedDirs[app]).toBe("/saved/config");
    },
  );

  it.each(["edit", "resetAll"] as const)(
    "ignores an older backend resolution after a newer %s",
    async (action) => {
      const initialSettings = createSettings({ claudeConfigDir: undefined });
      const { result, rerender } = renderHook(
        ({ settings }) => useDirectorySettings({ settings, onUpdateSettings }),
        { initialProps: { settings: initialSettings } },
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      rerender({
        settings: { ...initialSettings, claudeConfigDir: "/discarded" },
      });
      let finishResolution!: (directory: string) => void;
      getConfigDirMock.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishResolution = resolve;
          }),
      );
      rerender({ settings: initialSettings });

      if (action === "resetAll") {
        act(() => result.current.resetAllDirectories("/reset/claude"));
      } else {
        act(() => result.current.updateDirectory("claude", "/newer/draft"));
        rerender({
          settings: { ...initialSettings, claudeConfigDir: "/newer/draft" },
        });
      }
      await act(async () => finishResolution("/older/backend"));
      expect(result.current.resolvedDirs.claude).toBe(
        action === "edit" ? "/newer/draft" : "/reset/claude",
      );
    },
  );

  it("does not resolve a local reset against the persisted custom directory", async () => {
    const initialSettings = createSettings();
    const { result, rerender } = renderHook(
      ({ settings }) => useDirectorySettings({ settings, onUpdateSettings }),
      { initialProps: { settings: initialSettings } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    getConfigDirMock.mockClear();
    await act(() => result.current.resetDirectory("claude"));
    rerender({ settings: { ...initialSettings, claudeConfigDir: undefined } });
    expect(result.current.resolvedDirs.claude).toBe("/default/claude");
    expect(getConfigDirMock).not.toHaveBeenCalled();
  });

  it("shows manual input notice when browsing directory in web mode", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({
        settings: createSettings({ claudeConfigDir: undefined }),
        onUpdateSettings,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.browseDirectory("claude");
    });

    expect(toastInfoMock).toHaveBeenCalled();
    expect(onUpdateSettings).not.toHaveBeenCalled();
    expect(result.current.resolvedDirs.claude).toBe("/remote/claude");
  });

  it("browseDirectory does not mutate state in web mode", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({ settings: createSettings(), onUpdateSettings }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.browseDirectory("codex");
    });

    expect(result.current.resolvedDirs.codex).toBe("/remote/codex");
    expect(onUpdateSettings).not.toHaveBeenCalledWith({
      codexConfigDir: expect.anything(),
    });
    expect(toastInfoMock).toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows manual input notice when browsing app config directory in web mode", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({
        settings: createSettings(),
        onUpdateSettings,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.browseAppConfigDir();
    });

    expect(result.current.appConfigDir).toBeUndefined();
    expect(result.current.resolvedDirs.appConfig).toBe("/default/app");
    expect(toastInfoMock).toHaveBeenCalled();
  });

  it("resets directories to computed defaults", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({
        settings: createSettings({
          claudeConfigDir: "/custom/claude",
          codexConfigDir: "/custom/codex",
        }),
        onUpdateSettings,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.resetDirectory("claude");
      await result.current.resetDirectory("codex");
      await result.current.resetAppConfigDir();
    });

    expect(onUpdateSettings).toHaveBeenCalledWith({
      claudeConfigDir: undefined,
    });
    expect(onUpdateSettings).toHaveBeenCalledWith({
      codexConfigDir: undefined,
    });
    expect(result.current.resolvedDirs.claude).toBe("/default/claude");
    expect(result.current.resolvedDirs.codex).toBe("/default/codex");
    expect(result.current.resolvedDirs.appConfig).toBe("/default/app");
  });

  it("resetAllDirectories applies provided resolved values", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({ settings: createSettings(), onUpdateSettings }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.resetAllDirectories(
        "/server/claude",
        "/server/codex",
        "/server/gemini",
        "/server/grokbuild",
        "/server/opencode",
        undefined,
        undefined,
        "/server/pi",
      );
    });

    expect(result.current.resolvedDirs.claude).toBe("/server/claude");
    expect(result.current.resolvedDirs.codex).toBe("/server/codex");
    expect(result.current.resolvedDirs.gemini).toBe("/server/gemini");
    expect(result.current.resolvedDirs.grokbuild).toBe("/server/grokbuild");
    expect(result.current.resolvedDirs.opencode).toBe("/server/opencode");
    expect(result.current.resolvedDirs.pi).toBe("/server/pi");
  });
  it("reset uses the baseline moved after a successful save", async () => {
    const { result } = renderHook(() =>
      useDirectorySettings({ settings: createSettings(), onUpdateSettings }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      result.current.markAppConfigDirSaved("/saved/new-dir");
      result.current.updateAppConfigDir("/unsaved/draft");
    });
    act(() =>
      result.current.resetAllDirectories(undefined, undefined, undefined),
    );
    expect(result.current.appConfigDir).toBe("/saved/new-dir");
  });
});
