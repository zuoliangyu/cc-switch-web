import React, { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SettingsPage } from "@/components/settings/SettingsPage";
import {
  resetProviderState,
  getSettings,
  getAppConfigDirOverride,
} from "../msw/state";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

const TabsContext = React.createContext<{
  value: string;
  onValueChange?: (value: string) => void;
}>({
  value: "general",
});

vi.mock("@/components/ui/tabs", () => {
  return {
    Tabs: ({ value, onValueChange, children }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        {children}
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: any) => {
      const ctx = React.useContext(TabsContext);
      return (
        <button type="button" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: any) => {
      const ctx = React.useContext(TabsContext);
      return ctx.value === value ? (
        <div data-testid={`tab-${value}`}>{children}</div>
      ) : null;
    },
  };
});

vi.mock("@/components/settings/LanguageSettings", () => ({
  LanguageSettings: ({ value, onChange }: any) => (
    <div>
      <span>language:{value}</span>
      <button onClick={() => onChange("en")}>change-language</button>
    </div>
  ),
}));

vi.mock("@/components/settings/ThemeSettings", () => ({
  ThemeSettings: () => <div data-testid="theme-settings">theme</div>,
}));

vi.mock("@/components/settings/DirectorySettings", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/settings/DirectorySettings")
  >("@/components/settings/DirectorySettings");
  return actual;
});

vi.mock("@/components/settings/ImportExportSection", () => ({
  ImportExportSection: ({
    status,
    selectedFile,
    errorMessage,
    isImporting,
    onSelectFile,
    onImport,
    onExport,
    onClear,
  }: any) => (
    <div>
      <div data-testid="import-status">{status}</div>
      <div data-testid="selected-file">{selectedFile || "none"}</div>
      <button onClick={onSelectFile}>settings.selectConfigFile</button>
      <button onClick={onImport} disabled={!selectedFile || isImporting}>
        {isImporting ? "settings.importing" : "settings.import"}
      </button>
      <button onClick={onExport}>settings.exportConfig</button>
      <button onClick={onClear}>common.clear</button>
      {errorMessage ? <span>{errorMessage}</span> : null}
    </div>
  ),
}));

vi.mock("@/components/settings/AboutSection", () => ({
  AboutSection: () => <div>about</div>,
}));

const renderDialog = (
  props?: Partial<React.ComponentProps<typeof SettingsPage>>,
) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <SettingsPage open onOpenChange={() => {}} {...props} />
      </Suspense>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  resetProviderState();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SettingsPage integration", () => {
  it("loads default settings from MSW", async () => {
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("language:zh")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("settings.tabAdvanced"));
    fireEvent.click(screen.getByText("settings.advanced.configDir.title"));
    const appInput = await screen.findByPlaceholderText(
      "settings.browsePlaceholderApp",
    );
    // MSW handler get_app_config_dir 返回 `/default/app`（无 override 时），
    // 不再是早期 Tauri 测试假定的 `/home/mock/.cc-switch`。
    expect((appInput as HTMLInputElement).value).toBe("/default/app");
  });

  // Web 模式下 selectImportFile 只是给 toast 提示（没有原生文件选择器对话框），
  // 真实流程必须通过 selectImportUpload(File) 注入文件。这条端到端 import 流测试
  // 基于旧 Tauri 行为，已不适用 Web。useImportExport hook 里有等价的单元覆盖。
  it.skip("imports configuration and triggers success callback", async () => {
    const onImportSuccess = vi.fn();
    renderDialog({ onImportSuccess });

    await waitFor(() =>
      expect(screen.getByText("language:zh")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("settings.tabAdvanced"));
    fireEvent.click(screen.getByText("settings.advanced.data.title"));
    fireEvent.click(screen.getByText("settings.selectConfigFile"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-file").textContent).toContain(
        "/mock/import-settings.json",
      ),
    );

    fireEvent.click(screen.getByText("settings.import"));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    await waitFor(() => expect(onImportSuccess).toHaveBeenCalled(), {
      timeout: 4000,
    });
    expect(getSettings().language).toBe("en");
  });

  it("saves settings and handles restart prompt", async () => {
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("language:zh")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("settings.tabAdvanced"));
    fireEvent.click(screen.getByText("settings.advanced.configDir.title"));
    const appInput = await screen.findByPlaceholderText(
      "settings.browsePlaceholderApp",
    );
    fireEvent.change(appInput, { target: { value: "/custom/app" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    await screen.findByText("settings.restartRequired");
    fireEvent.click(screen.getByText("settings.restartLater"));
    await waitFor(() =>
      expect(
        screen.queryByText("settings.restartRequired"),
      ).not.toBeInTheDocument(),
    );

    expect(getAppConfigDirOverride()).toBe("/custom/app");
  });

  // Web 模式下 DirectorySettings 的「浏览目录」按钮被 allowBrowse 守卫隐藏
  // （没有原生目录选择器），目录改动只能通过手输实现。这条原生 browse 流程
  // 测试已不适用 Web。reset 行为有 useDirectorySettings 的单元测试覆盖。
  it.skip("allows browsing and resetting directories", async () => {
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("language:zh")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("settings.tabAdvanced"));
    fireEvent.click(screen.getByText("settings.advanced.configDir.title"));

    const browseButtons = screen.getAllByTitle("settings.browseDirectory");
    const resetButtons = screen.getAllByTitle("settings.resetDefault");

    const appInput = (await screen.findByPlaceholderText(
      "settings.browsePlaceholderApp",
    )) as HTMLInputElement;
    expect(appInput.value).toBe("/home/mock/.cc-switch");

    fireEvent.click(browseButtons[0]);
    await waitFor(() =>
      expect(appInput.value).toBe("/home/mock/.cc-switch/picked"),
    );

    fireEvent.click(resetButtons[0]);
    await waitFor(() => expect(appInput.value).toBe("/home/mock/.cc-switch"));

    const claudeInput = (await screen.findByPlaceholderText(
      "settings.browsePlaceholderClaude",
    )) as HTMLInputElement;
    fireEvent.change(claudeInput, { target: { value: "/custom/claude" } });
    await waitFor(() => expect(claudeInput.value).toBe("/custom/claude"));

    fireEvent.click(browseButtons[1]);
    await waitFor(() =>
      expect(claudeInput.value).toBe("/custom/claude/picked"),
    );

    fireEvent.click(resetButtons[1]);
    await waitFor(() => expect(claudeInput.value).toBe("/home/mock/.claude"));
  });

});
