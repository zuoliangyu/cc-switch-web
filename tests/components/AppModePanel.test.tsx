import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { AppModePanel } from "@/components/proxy/AppModePanel";
import { useAppMode } from "@/hooks/useAppMode";
import { ProviderActions } from "@/components/providers/ProviderActions";
import type { Provider } from "@/types";

const providers: Record<string, Provider> = Object.fromEntries(
  [
    ["z", "Zulu"],
    ["a", "alpha"],
    ["o", "Official"],
  ].map(([id, name]) => [id, { id, name, settingsConfig: {} }]),
);
function ModePanel({ app = "claude" }: { app?: "claude" | "codex" }) {
  const state = useAppMode(app);
  return <AppModePanel app={app} providers={providers} state={state} />;
}

describe("模式与聚合操作", () => {
  it("显示恢复错误，守护进程重启需要确认且等待时禁用重复提交", async () => {
    let finish: (() => void) | undefined;
    let calls = 0;
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "aggregation",
          attached: false,
          directProviderId: "a",
          routeProviderId: "a",
          eligibleProviderIds: ["a"],
          startupError: "test restore failure",
          aggregation: {
            active: true,
            members: [],
            staleClients: { daemon: true, others: true },
          },
        }),
      ),
      http.post("http://runtime.local/restart_codex_daemon", async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return HttpResponse.json("restarted");
      }),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <ModePanel app="codex" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "webMode.startupFailed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "webMode.restartDaemon" }),
    );
    expect(calls).toBe(0);
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "common.confirm",
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toBe(1));
    expect(confirm).toBeDisabled();
    finish?.();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    client.clear();
  });
  it("说明 Codex 模型列表为什么没取到", async () => {
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "aggregation",
          attached: true,
          directProviderId: "a",
          routeProviderId: "a",
          eligibleProviderIds: ["a"],
          aggregation: {
            active: true,
            members: [{ providerId: "a", modelIds: [], route: true }],
            notice: "officialModelsUnavailable",
            noticeReasons: ["loginStale", "noCli"],
          },
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ModePanel app="codex" />
      </QueryClientProvider>,
    );
    const notice = await screen.findByText(
      "webMode.notice.officialModelsUnavailable",
      { exact: false },
    );
    expect(notice).toHaveTextContent("webMode.noticeReason.loginStale");
    expect(notice).toHaveTextContent("webMode.noticeReason.noCli");
  });

  it("页签只查看，确认后才进入聚合，候选按名称排序且排除不可路由供应商", async () => {
    let mode = "direct";
    const calls: unknown[] = [];
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode,
          attached: mode !== "direct",
          directProviderId: "a",
          routeProviderId: "z",
          eligibleProviderIds: ["z", "a"],
          aggregation: { active: mode === "aggregation", members: [] },
        }),
      ),
      http.post("http://runtime.local/set_app_mode", async ({ request }) => {
        const payload = await request.json();
        calls.push(payload);
        mode = "aggregation";
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <ModePanel />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "webMode.aggregation" }),
    );
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "webMode.activate" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((e) => e.textContent),
    ).toEqual(["alpha", "Zulu"]);
    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "a" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.confirm" }),
    );
    await waitFor(() =>
      expect(calls).toEqual([
        { appType: "claude", mode: "aggregation", routeProviderId: "a" },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    client.clear();
  });

  it("聚合成员按钮不切换默认，默认卡和直连卡禁止删除", () => {
    const toggle = vi.fn();
    const switchProvider = vi.fn();
    const onDelete = vi.fn();
    const base = {
      isCurrent: false,
      onSwitch: switchProvider,
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete,
    };
    const { rerender } = render(
      <ProviderActions
        {...base}
        deleteDisabled
        aggregation={{
          member: false,
          default: false,
          onToggle: toggle,
          onDefault: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "webMode.join" }));
    expect(toggle).toHaveBeenCalledOnce();
    expect(switchProvider).not.toHaveBeenCalled();
    expect(screen.getByTitle("common.delete")).toBeDisabled();
    rerender(
      <ProviderActions
        {...base}
        isCurrent
        aggregation={{
          member: true,
          default: true,
          onToggle: toggle,
          onDefault: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "webMode.default" }),
    ).toBeDisabled();
    expect(screen.getByTitle("common.delete")).toBeDisabled();
  });
});
