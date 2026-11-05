import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { SwitchModePanel } from "@/components/providers/mode/SwitchModePanel";
import { useAppMode } from "@/hooks/useAppMode";
import type { Provider, Settings } from "@/types";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: Object.assign(vi.fn(), { ...actual.toast, success: toastSuccess }),
  };
});

const providers: Record<string, Provider> = Object.fromEntries(
  [
    ["a", "Alpha"],
    ["b", "Beta"],
  ].map(([id, name]) => [id, { id, name, settingsConfig: {} }]),
);

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.releasePointerCapture ??= vi.fn();
});

function ModePanel({
  app,
  onViewChange,
}: {
  app: "claude" | "codex";
  onViewChange?: (app: string, view: string) => void;
}) {
  const state = useAppMode(app);
  return (
    <SwitchModePanel
      app={app}
      providers={providers}
      currentProviderId="a"
      isLoading={false}
      state={state}
      serviceRunning
      onSwitch={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onOpenWebsite={vi.fn()}
      onViewChange={onViewChange}
    />
  );
}

function renderPanel(props: Parameters<typeof ModePanel>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ModePanel {...props} />
    </QueryClientProvider>,
  );
  return client;
}

function mockSettings(initial: Partial<Settings>) {
  let settings = initial as Settings;
  const saved: Settings[] = [];
  server.use(
    http.post("http://runtime.local/get_settings", () =>
      HttpResponse.json(settings),
    ),
    http.post("http://runtime.local/save_settings", async ({ request }) => {
      const body = (await request.json()) as { settings: Settings };
      settings = body.settings;
      saved.push(body.settings);
      return HttpResponse.json(true);
    }),
  );
  return saved;
}

describe("模式行的故障转移、路由设置与聚合设置（上游 v7）", () => {
  it("路由生效时模式行有故障转移开关与路由设置；第一次打开故障转移先确认", async () => {
    const saved = mockSettings({ failoverConfirmed: false });
    const toggles: unknown[] = [];
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "routing",
          attached: true,
          directProviderId: "a",
          routeProviderId: "a",
          eligibleProviderIds: ["a", "b"],
          aggregation: { members: [] },
        }),
      ),
      http.post("http://runtime.local/get_auto_failover_enabled", () =>
        HttpResponse.json(false),
      ),
      http.post(
        "http://runtime.local/set_auto_failover_enabled",
        async ({ request }) => {
          toggles.push(await request.json());
          return HttpResponse.json(null);
        },
      ),
    );
    const client = renderPanel({ app: "claude" });
    const failover = await screen.findByRole("switch", {
      name: "mode.failover",
    });
    expect(
      screen.getByRole("button", { name: "mode.routeSettings" }),
    ).toBeInTheDocument();

    fireEvent.click(failover);
    const dialog = await screen.findByRole("dialog");
    expect(toggles).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "confirm.failover.confirm" }),
    );
    await waitFor(() => expect(saved.at(-1)?.failoverConfirmed).toBe(true));
    await waitFor(() => expect(toggles).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "mode.routeSettings" }));
    expect(
      await screen.findByText("mode.routeSettingsTitle"),
    ).toBeInTheDocument();
    client.clear();
  });

  it("切换到 Codex 聚合的确认框里可以选子代理，确认时先存设置再进聚合，成功后提示", async () => {
    const saved = mockSettings({ codexStackClassicTools: true });
    const calls: unknown[] = [];
    let mode = "direct";
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode,
          attached: mode !== "direct",
          directProviderId: "a",
          routeProviderId: "a",
          eligibleProviderIds: ["a", "b"],
          aggregation: {
            active: mode === "aggregation",
            members: [
              { providerId: "a", modelIds: [], route: true },
              { providerId: "b", modelIds: ["b-pro"], route: false },
            ],
            subagentModels: [
              {
                id: "ccs-a/a-model",
                providerId: "a",
                displayName: "a-model（Alpha）",
                efforts: ["low"],
              },
              {
                id: "ccs-b/b-pro",
                providerId: "b",
                displayName: "b-pro（Beta）",
                efforts: ["low", "xhigh"],
              },
            ],
          },
        }),
      ),
      http.post("http://runtime.local/codex_forces_multi_agent_v2", () =>
        HttpResponse.json(false),
      ),
      http.post("http://runtime.local/set_app_mode", async ({ request }) => {
        calls.push(await request.json());
        mode = "aggregation";
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onViewChange = vi.fn();
    toastSuccess.mockClear();
    const client = renderPanel({ app: "codex", onViewChange });
    await waitFor(() =>
      expect(onViewChange).toHaveBeenLastCalledWith("codex", "direct"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^mode\.names\.stack/ }),
    );
    expect(onViewChange).toHaveBeenLastCalledWith("codex", "stack");
    fireEvent.click(
      screen.getByRole("button", { name: "mode.activate.stack" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("mode.dialog.stackSubagentLead");
    const model = within(dialog).getByRole("combobox", {
      name: "mode.stackSettings.subagentModel",
    }) as HTMLSelectElement;
    // 默认那家（a）不发布 `ccs-*` 模型，不列出
    expect(Array.from(model.options).map((option) => option.value)).toEqual([
      "",
      "ccs-b/b-pro",
    ]);
    fireEvent.change(model, { target: { value: "ccs-b/b-pro" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "mode.dialog.confirmStack" }),
    );
    await waitFor(() =>
      expect(calls).toEqual([
        { appType: "codex", mode: "aggregation", routeProviderId: "a" },
      ]),
    );
    expect(saved[0]?.codexStackSubagentModel).toBe("ccs-b/b-pro");
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "mode.toast.enteredStack",
        expect.anything(),
      ),
    );
    client.clear();
  });
});
