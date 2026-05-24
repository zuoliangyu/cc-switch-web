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
      return "/remote/opencode";
    });
    getDefaultConfigDirMock.mockImplementation(async (app: string) => {
      if (app === "claude") return "/default/claude";
      if (app === "codex") return "/default/codex";
      if (app === "gemini") return "/default/gemini";
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
      opencode: "/remote/opencode",
      openclaw: "/remote/opencode",
      hermes: "/remote/opencode",
    });
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
        "/server/opencode",
      );
    });

    expect(result.current.resolvedDirs.claude).toBe("/server/claude");
    expect(result.current.resolvedDirs.codex).toBe("/server/codex");
    expect(result.current.resolvedDirs.gemini).toBe("/server/gemini");
    expect(result.current.resolvedDirs.opencode).toBe("/server/opencode");
  });
});
