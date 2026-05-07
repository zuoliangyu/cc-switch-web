import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "i18next";
import { useSettingsForm } from "@/hooks/useSettingsForm";

const useSettingsQueryMock = vi.fn();

vi.mock("@/lib/query", () => ({
  useSettingsQuery: (...args: unknown[]) => useSettingsQueryMock(...args),
}));

// 把 useTranslation 返回的 i18n 锁成全局唯一引用：useSettingsForm
// 依赖的 readPersistedLanguage / syncLanguage 是 useCallback 包了 i18n 的，
// 如果每次 render i18n 引用变（react-i18next 内部行为）这两个 callback 就
// 会重生成，触发初始化 useEffect 反复跑，把 resetSettings 设置的状态又倒回去。
vi.mock("react-i18next", async () => {
  const actual =
    await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n,
    }),
  };
});

let changeLanguageSpy: ReturnType<typeof vi.spyOn<any, any>>;

beforeEach(() => {
  useSettingsQueryMock.mockReset();
  window.localStorage.clear();
  (i18n as any).language = "zh";
  changeLanguageSpy = vi
    .spyOn(i18n, "changeLanguage")
    .mockImplementation(async (lang?: string) => {
      (i18n as any).language = lang;
      return i18n.t;
    });
});

afterEach(() => {
  changeLanguageSpy.mockRestore();
});

describe("useSettingsForm Hook", () => {
  it("should normalize settings and sync language on initialization", async () => {
    useSettingsQueryMock.mockReturnValue({
      data: {
        claudeConfigDir: "  /Users/demo  ",
        codexConfigDir: "   ",
        language: "en",
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useSettingsForm());

    await waitFor(() => {
      expect(result.current.settings).not.toBeNull();
    });

    const settings = result.current.settings!;
    expect(settings.claudeConfigDir).toBe("/Users/demo");
    expect(settings.codexConfigDir).toBeUndefined();
    expect(settings.language).toBe("en");
    expect(result.current.initialLanguage).toBe("en");
    expect(changeLanguageSpy).toHaveBeenCalledWith("en");
  });

  it("should support japanese language preference from server data", async () => {
    useSettingsQueryMock.mockReturnValue({
      data: {
        claudeConfigDir: "/Users/demo",
        codexConfigDir: null,
        language: "ja",
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useSettingsForm());

    await waitFor(() => {
      expect(result.current.settings?.language).toBe("ja");
    });

    expect(result.current.initialLanguage).toBe("ja");
    expect(changeLanguageSpy).toHaveBeenCalledWith("ja");
  });

  it("should prioritize reading language from local storage in readPersistedLanguage", () => {
    useSettingsQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    window.localStorage.setItem("language", "en");

    const { result } = renderHook(() => useSettingsForm());

    const lang = result.current.readPersistedLanguage();
    expect(lang).toBe("en");
    expect(changeLanguageSpy).not.toHaveBeenCalled();
  });

  it("should update fields and sync language when language changes in updateSettings", () => {
    useSettingsQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useSettingsForm());

    act(() => {
      result.current.updateSettings({ language: "en" });
    });

    expect(result.current.settings?.language).toBe("en");
    expect(changeLanguageSpy).toHaveBeenCalledWith("en");
  });

  it("should reset with server data and restore initial language in resetSettings", async () => {
    useSettingsQueryMock.mockReturnValue({
      data: {
        claudeConfigDir: "/origin",
        codexConfigDir: null,
        language: "en",
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useSettingsForm());

    await waitFor(() => {
      expect(result.current.settings).not.toBeNull();
    });

    changeLanguageSpy.mockClear();
    // 用 mock 直接改语言，不触发 i18n 内部 emit，避免 useTranslation
    // 在 hook re-render 时给出新的 i18n 引用，从而让初始化 useEffect
    // 因为依赖闭包 identity 变化重跑、把 settingsState 倒回 /origin。
    (i18n as any).language = "zh";

    act(() => {
      result.current.resetSettings({
        claudeConfigDir: "  /reset  ",
        codexConfigDir: "   ",
        language: "zh",
      });
    });

    // useTranslation 的 i18n 引用稳定性在不同 react-i18next 版本下不一致，
    // 用 waitFor 接受 hook 收敛到目标值（如果中间被 effect 倒回 /origin
    // 也会很快被 resetSettings 的 setState 再次改回来，最终稳定到 /reset）。
    await waitFor(() => {
      expect(result.current.settings?.claudeConfigDir).toBe("/reset");
    });

    const settings = result.current.settings!;
    expect(settings.claudeConfigDir).toBe("/reset");
    expect(settings.codexConfigDir).toBeUndefined();
    expect(settings.language).toBe("zh");
    expect(result.current.initialLanguage).toBe("en");
    expect(changeLanguageSpy).toHaveBeenCalledWith("en");
  });

  it("should not call changeLanguage repeatedly when language is consistent in syncLanguage", async () => {
    useSettingsQueryMock.mockReturnValue({
      data: {
        claudeConfigDir: null,
        codexConfigDir: null,
        language: "zh",
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useSettingsForm());

    await waitFor(() => {
      expect(result.current.settings).not.toBeNull();
    });

    changeLanguageSpy.mockClear();
    (i18n as any).language = "zh";

    act(() => {
      result.current.syncLanguage("zh");
    });

    expect(changeLanguageSpy).not.toHaveBeenCalled();
  });
});
