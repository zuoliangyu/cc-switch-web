import React, { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import type { Settings } from "@/types";
import { SettingsPage } from "@/components/settings/SettingsPage";
import {
  resetProviderState,
  getSettings,
  setSettings,
  getAppConfigDirOverride,
} from "../msw/state";
import { server } from "../msw/server";

const RUNTIME = "http://runtime.local";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
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

// 「数据」一节的其他卡片有自己的接口，这里只测目录和导入导出
vi.mock("@/components/settings/BackupListSection", () => ({
  BackupListSection: () => <div>backup-list-section</div>,
}));
vi.mock("@/components/settings/WebdavSyncSection", () => ({
  WebdavSyncSection: () => <div>webdav-sync-section</div>,
}));
vi.mock("@/components/settings/LogConfigPanel", () => ({
  LogConfigPanel: () => <div>log-config-panel</div>,
}));
vi.mock("@/components/settings/CodexAuthSettings", () => ({
  CodexAuthSettings: () => <div>codex-auth-settings</div>,
}));

vi.mock("@/components/settings/ImportExportSection", () => ({
  ImportExportSection: ({ onExport }: any) => (
    <div>
      <button onClick={onExport}>settings.exportConfig</button>
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
        <SettingsPage
          section="data"
          onSectionChange={() => {}}
          onOpenApps={() => {}}
          onOpenApp={() => {}}
          {...props}
        />
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

    const appInput = await screen.findByPlaceholderText(
      "settings.browsePlaceholderApp",
    );
    // MSW handler get_app_config_dir 无 override 时返回 `/default/app`
    await waitFor(() =>
      expect((appInput as HTMLInputElement).value).toBe("/default/app"),
    );
  });

  it("saves settings and handles restart prompt", async () => {
    renderDialog();

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

  // Web 的目录在服务所在电脑上，浏览器选不了文件夹：没有「浏览」，只能手填和恢复默认
  it("resets the data directory without a folder picker", async () => {
    renderDialog();

    const appInput = (await screen.findByPlaceholderText(
      "settings.browsePlaceholderApp",
    )) as HTMLInputElement;
    await waitFor(() => expect(appInput.value).toBe("/default/app"));
    expect(
      screen.queryByRole("button", { name: "settings.browseDirectory" }),
    ).not.toBeInTheDocument();

    fireEvent.change(appInput, { target: { value: "/draft/app" } });
    expect(appInput.value).toBe("/draft/app");
    fireEvent.click(
      screen.getByRole("button", { name: "settings.resetDefault" }),
    );
    await waitFor(() => expect(appInput.value).toBe("/default/app"));
  });

  it("edits and resets an app's config directory", async () => {
    renderDialog({ section: "appConfig" });

    const claudeInput = (await screen.findByPlaceholderText(
      "settings.browsePlaceholderClaude",
    )) as HTMLInputElement;
    fireEvent.change(claudeInput, { target: { value: "/custom/claude" } });
    await waitFor(() => expect(claudeInput.value).toBe("/custom/claude"));

    fireEvent.click(
      screen.getAllByRole("button", { name: "settings.resetDefault" })[0],
    );
    await waitFor(() => expect(claudeInput.value).toBe("/default/claude"));
  });

  // 上游 99277921：别的设置项自动保存时只写已确认的目录，丢掉目录草稿
  it.each([undefined, "/saved/claude"])(
    "discards directory drafts after unrelated autosave with saved directory %s",
    async (savedDirectory) => {
      setSettings({ claudeConfigDir: savedDirectory });
      const resolvedDirectory = savedDirectory ?? "/home/mock/.claude";
      const saves: Settings[] = [];
      const syncLive = vi.fn();
      server.use(
        http.post(`${RUNTIME}/get_config_dir`, async ({ request }) => {
          const { app } = (await request.json()) as { app: string };
          return HttpResponse.json(
            app === "claude" ? resolvedDirectory : `/default/${app}`,
          );
        }),
        http.post(`${RUNTIME}/save_settings`, async ({ request }) => {
          const { settings } = (await request.json()) as { settings: Settings };
          saves.push(settings);
          setSettings(settings);
          return HttpResponse.json(true);
        }),
        http.post(`${RUNTIME}/sync_current_providers_live`, () => {
          syncLive();
          return HttpResponse.json(true);
        }),
      );
      renderDialog({ section: "appConfig" });

      const directory = await screen.findByPlaceholderText(
        "settings.browsePlaceholderClaude",
      );
      await waitFor(() => expect(directory).toHaveValue(resolvedDirectory));
      fireEvent.change(directory, { target: { value: "/unsaved/claude" } });
      expect(directory).toHaveValue("/unsaved/claude");
      expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
      expect(saves).toHaveLength(0);

      const toggle = screen.getByRole("switch", {
        name: "settings.skipClaudeOnboarding",
      });
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(getSettings().skipClaudeOnboarding).toBe(true),
      );
      expect(saves[0].claudeConfigDir).toBe(savedDirectory);
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "common.save" }),
        ).toBeNull(),
      );
      await waitFor(() => expect(directory).toHaveValue(resolvedDirectory));

      fireEvent.click(toggle);
      await waitFor(() =>
        expect(getSettings().skipClaudeOnboarding).toBe(false),
      );
      expect(saves).toHaveLength(2);
      expect(saves[1].claudeConfigDir).toBe(savedDirectory);
      expect(directory).toHaveValue(resolvedDirectory);
      expect(syncLive).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "hermes",
      "hermesConfigDir",
      "settings.browsePlaceholderHermes",
      "/env/hermes-home",
    ],
    ["pi", "piConfigDir", "settings.browsePlaceholderPi", "/env/pi-agent"],
  ] as const)(
    "restores backend-resolved %s default after draft discard",
    async (targetApp, field, placeholder, backendDefault) => {
      setSettings({ [field]: undefined });
      const saves: Settings[] = [];
      server.use(
        http.post(`${RUNTIME}/get_config_dir`, async ({ request }) => {
          const { app } = (await request.json()) as { app: string };
          return HttpResponse.json(
            app === targetApp ? backendDefault : `/default/${app}`,
          );
        }),
        http.post(`${RUNTIME}/save_settings`, async ({ request }) => {
          const { settings } = (await request.json()) as { settings: Settings };
          saves.push(settings);
          setSettings({ ...settings, [field]: settings[field] });
          return HttpResponse.json(true);
        }),
      );
      renderDialog({ section: "appConfig" });
      const directory = await screen.findByPlaceholderText(placeholder);
      await waitFor(() => expect(directory).toHaveValue(backendDefault));
      fireEvent.change(directory, { target: { value: `/draft/${targetApp}` } });
      expect(directory).toHaveValue(`/draft/${targetApp}`);
      fireEvent.click(
        screen.getByRole("switch", { name: "settings.skipClaudeOnboarding" }),
      );
      await waitFor(() =>
        expect(getSettings().skipClaudeOnboarding).toBe(true),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "common.save" }),
        ).toBeNull(),
      );
      expect(saves[0][field]).toBeUndefined();
      await waitFor(() => expect(directory).toHaveValue(backendDefault));
    },
  );
});
