import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettings } from "@/hooks/useSettings";
import type { Settings } from "@/types";

const mutateAsyncMock = vi.fn();
const useSettingsQueryMock = vi.fn();
const setAppConfigDirOverrideMock = vi.fn();
const syncCurrentProvidersLiveMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

let settingsFormMock: any;
let directorySettingsMock: any;
let metadataMock: any;
let serverSettings: Settings;

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/hooks/useSettingsForm", () => ({
  useSettingsForm: () => settingsFormMock,
}));

vi.mock("@/hooks/useDirectorySettings", () => ({
  useDirectorySettings: () => directorySettingsMock,
}));

vi.mock("@/hooks/useSettingsMetadata", () => ({
  useSettingsMetadata: () => metadataMock,
}));

vi.mock("@/lib/query", () => ({
  useSettingsQuery: (...args: unknown[]) => useSettingsQueryMock(...args),
  useSaveSettingsMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: (...args: unknown[]) =>
        invalidateQueriesMock(...args),
    }),
  };
});

vi.mock("@/lib/api", () => ({
  settingsApi: {
    setAppConfigDirOverride: (...args: unknown[]) =>
      setAppConfigDirOverrideMock(...args),
    syncCurrentProvidersLive: (...args: unknown[]) =>
      syncCurrentProvidersLiveMock(...args),
  },
}));

const createSettingsFormMock = (overrides: Record<string, unknown> = {}) => ({
  settings: {
    claudeConfigDir: "/claude",
    codexConfigDir: "/codex",
    language: "zh",
  },
  isLoading: false,
  initialLanguage: "zh",
  updateSettings: vi.fn(),
  resetSettings: vi.fn(),
  syncLanguage: vi.fn(),
  ...overrides,
});

const createDirectorySettingsMock = (
  overrides: Record<string, unknown> = {},
) => ({
  appConfigDir: undefined,
  resolvedDirs: {
    appConfig: "/home/mock/.cc-switch",
    claude: "/default/claude",
    codex: "/default/codex",
  },
  isLoading: false,
  markAppConfigDirSaved: vi.fn(),
  initialAppConfigDir: undefined,
  updateDirectory: vi.fn(),
  updateAppConfigDir: vi.fn(),
  browseDirectory: vi.fn(),
  browseAppConfigDir: vi.fn(),
  resetDirectory: vi.fn(),
  resetAppConfigDir: vi.fn(),
  resetAllDirectories: vi.fn(),
  ...overrides,
});

const createMetadataMock = (overrides: Record<string, unknown> = {}) => ({
  requiresRestart: false,
  isLoading: false,
  acknowledgeRestart: vi.fn(),
  setRequiresRestart: vi.fn(),
  ...overrides,
});

describe("useSettings hook", () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    useSettingsQueryMock.mockReset();
    setAppConfigDirOverrideMock.mockReset();
    syncCurrentProvidersLiveMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    window.localStorage.clear();

    serverSettings = {
      claudeConfigDir: "/server/claude",
      codexConfigDir: "/server/codex",
      language: "zh",
    };

    useSettingsQueryMock.mockReturnValue({
      data: serverSettings,
      isLoading: false,
    });

    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        language: "zh",
      },
    });
    directorySettingsMock = createDirectorySettingsMock();
    metadataMock = createMetadataMock();

    mutateAsyncMock.mockResolvedValue(true);
    setAppConfigDirOverrideMock.mockResolvedValue(true);
  });

  it("saves settings and flags restart when app config directory changes", async () => {
    serverSettings = {
      ...serverSettings,
      claudeConfigDir: "/server/claude",
      codexConfigDir: undefined,
      language: "en",
    };
    useSettingsQueryMock.mockReturnValue({
      data: serverSettings,
      isLoading: false,
    });

    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        claudeConfigDir: "  /custom/claude  ",
        codexConfigDir: "   ",
        language: "en",
      },
      initialLanguage: "en",
    });

    directorySettingsMock = createDirectorySettingsMock({
      appConfigDir: "  /override/app  ",
      markAppConfigDirSaved: vi.fn(),
  initialAppConfigDir: "/previous/app",
    });

    const { result } = renderHook(() => useSettings());

    let saveResult: { requiresRestart: boolean } | null = null;
    await act(async () => {
      saveResult = await result.current.saveSettings();
    });

    expect(saveResult).toEqual({ requiresRestart: true });
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const payload = mutateAsyncMock.mock.calls[0][0] as Settings;
    expect(payload.claudeConfigDir).toBe("/custom/claude");
    expect(payload.codexConfigDir).toBeUndefined();
    expect(payload.language).toBe("en");
    expect(setAppConfigDirOverrideMock).toHaveBeenCalledWith("/override/app");
    expect(metadataMock.setRequiresRestart).toHaveBeenCalledWith(true);
    expect(window.localStorage.getItem("language")).toBe("en");
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(syncCurrentProvidersLiveMock).toHaveBeenCalledTimes(1);
  });

  it("saves settings without restart when directory unchanged", async () => {
    serverSettings = {
      ...serverSettings,
    };
    useSettingsQueryMock.mockReturnValue({
      data: serverSettings,
      isLoading: false,
    });

    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        language: "zh",
      },
      initialLanguage: "zh",
    });

    directorySettingsMock = createDirectorySettingsMock({
      appConfigDir: undefined,
      markAppConfigDirSaved: vi.fn(),
  initialAppConfigDir: undefined,
    });

    const { result } = renderHook(() => useSettings());

    let saveResult: { requiresRestart: boolean } | null = null;
    await act(async () => {
      saveResult = await result.current.saveSettings();
    });

    expect(saveResult).toEqual({ requiresRestart: false });
    expect(setAppConfigDirOverrideMock).toHaveBeenCalledWith(null);
    expect(metadataMock.setRequiresRestart).toHaveBeenCalledWith(false);
    expect(syncCurrentProvidersLiveMock).not.toHaveBeenCalled();
  });

  it("refreshes DeepSeek Harness data when its home directory changes", async () => {
    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        dshConfigDir: "  /wsl/dsh  ",
        language: "zh",
      },
    });
    invalidateQueriesMock.mockReset();

    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.saveSettings();
    });

    const payload = mutateAsyncMock.mock.calls[0][0] as Settings;
    expect(payload.dshConfigDir).toBe("/wsl/dsh");
    const keys = invalidateQueriesMock.mock.calls.map(
      ([filters]) => (filters as { queryKey: unknown[] }).queryKey,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        ["providers", "dsh"],
        ["skills", "installed"],
        ["sessions"],
        ["dsh-account-status"],
      ]),
    );
    expect(syncCurrentProvidersLiveMock).not.toHaveBeenCalled();
  });

  it("resets form, language and directories using server data", () => {
    serverSettings = {
      ...serverSettings,
      claudeConfigDir: "  /server/claude  ",
      codexConfigDir: "   ",
      language: "zh",
    };
    useSettingsQueryMock.mockReturnValue({
      data: serverSettings,
      isLoading: false,
    });

    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        language: "zh",
      },
      initialLanguage: "zh",
    });
    directorySettingsMock = createDirectorySettingsMock();

    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.resetSettings();
    });

    expect(settingsFormMock.resetSettings).toHaveBeenCalledWith(serverSettings);
    expect(settingsFormMock.syncLanguage).toHaveBeenCalledWith(
      settingsFormMock.initialLanguage,
    );
    expect(directorySettingsMock.resetAllDirectories).toHaveBeenCalledWith(
      "/server/claude",
      undefined, // codexConfigDir
      undefined, // geminiConfigDir
      undefined, // grokConfigDir
      undefined, // opencodeConfigDir
      undefined, // openclawConfigDir
      undefined, // hermesConfigDir
      undefined, // piConfigDir
      undefined, // ompConfigDir
      undefined, // dshConfigDir
    );
    expect(metadataMock.setRequiresRestart).toHaveBeenCalledWith(false);
  });

  it("returns null immediately when settings state is missing", async () => {
    settingsFormMock = createSettingsFormMock({
      settings: null,
    });

    const { result } = renderHook(() => useSettings());

    let resultValue: { requiresRestart: boolean } | null = null;
    await act(async () => {
      resultValue = await result.current.saveSettings();
    });

    expect(resultValue).toBeNull();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(setAppConfigDirOverrideMock).not.toHaveBeenCalled();
  });

  it("throws when save mutation rejects and keeps restart flag untouched", async () => {
    settingsFormMock = createSettingsFormMock();
    directorySettingsMock = createDirectorySettingsMock({
      appConfigDir: "/override/app",
      markAppConfigDirSaved: vi.fn(),
  initialAppConfigDir: "/override/app",
    });
    const rejection = new Error("save failed");
    mutateAsyncMock.mockRejectedValueOnce(rejection);

    const { result } = renderHook(() => useSettings());

    await expect(
      act(async () => {
        await result.current.saveSettings();
      }),
    ).rejects.toThrow("save failed");

    expect(setAppConfigDirOverrideMock).not.toHaveBeenCalled();
    expect(metadataMock.setRequiresRestart).not.toHaveBeenCalledWith(true);
  });

  it("keeps directory drafts out of unrelated autosaves", async () => {
    settingsFormMock = createSettingsFormMock({
      settings: {
        ...serverSettings,
        claudeConfigDir: "/unsaved/claude",
        codexConfigDir: undefined,
        language: "zh",
      },
    });

    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await result.current.autoSaveSettings({ skipClaudeOnboarding: true });
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const payload = mutateAsyncMock.mock.calls[0][0] as Record<string, unknown>;
    // 草稿只由显式「保存」写入，自动保存沿用已确认的目录
    expect(payload.claudeConfigDir).toBe("/server/claude");
    expect(payload.codexConfigDir).toBe("/server/codex");
    expect(payload.skipClaudeOnboarding).toBe(true);
  });

  it("autosaves a directory when the update names it explicitly", async () => {
    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await result.current.autoSaveSettings({
        claudeConfigDir: "/explicit/claude",
      });
    });

    const payload = mutateAsyncMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.claudeConfigDir).toBe("/explicit/claude");
    expect(payload.codexConfigDir).toBe("/server/codex");
  });
});
