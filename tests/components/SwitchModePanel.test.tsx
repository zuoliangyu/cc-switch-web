import userEvent from "@testing-library/user-event";
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
import type { Provider } from "@/types";

const providers: Record<string, Provider> = Object.fromEntries(
  [
    ["z", "Zulu"],
    ["a", "alpha"],
    ["o", "Official"],
  ].map(([id, name]) => [id, { id, name, settingsConfig: {} }]),
);

beforeAll(() => {
  // Radix Select 打开时会滚动到选中项、捕获指针，jsdom 没有这些方法
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.releasePointerCapture ??= vi.fn();
});

function ModePanel({
  app = "claude",
  onSwitch = vi.fn(),
  onDelete = vi.fn(),
}: {
  app?: "claude" | "codex" | "claude-desktop";
  onSwitch?: (provider: Provider) => unknown;
  onDelete?: (provider: Provider) => void;
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
      onSwitch={onSwitch}
      onEdit={vi.fn()}
      onDelete={onDelete}
      onDuplicate={vi.fn()}
      onOpenWebsite={vi.fn()}
    />
  );
}

function renderPanel(props: Parameters<typeof ModePanel>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ModePanel {...props} />
    </QueryClientProvider>,
  );
  return client;
}

const tab = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^${name}`) });

describe("模式页签与确认框", () => {
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
    const client = renderPanel({ app: "codex" });
    expect(
      await screen.findByText("webMode.startupFailed", { exact: false }),
    ).toBeInTheDocument();
    // 路由服务没接上：提示请求会失败，可重试或回到直连
    expect(screen.getByText("mode.notice.serviceDown")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "webMode.restartDaemon" }),
    );
    expect(calls).toBe(0);
    // 确认框可能是 alertdialog 也可能是 dialog：一次等两种，不靠前一个查找超时再退回
    const dialog = await waitFor(
      () => screen.queryByRole("alertdialog") ?? screen.getByRole("dialog"),
    );
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
    const client = renderPanel({ app: "codex" });
    expect(
      await screen.findByText("webMode.notice.officialModelsUnavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("webMode.noticeReason.loginStale"),
    ).toBeInTheDocument();
    expect(screen.getByText("webMode.noticeReason.noCli")).toBeInTheDocument();
    client.clear();
  });

  it("页签只查看，确认后才进入聚合；候选按名称排序，框里预览另有哪几家", async () => {
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
          aggregation: {
            active: mode === "aggregation",
            members: [
              { providerId: "z", modelIds: [], route: true, memberModels: 3 },
              { providerId: "a", modelIds: ["m1"], route: false },
            ],
          },
        }),
      ),
      http.post("http://runtime.local/set_app_mode", async ({ request }) => {
        calls.push(await request.json());
        mode = "aggregation";
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const client = renderPanel();
    await user.click(await tab("mode.names.stack"));
    expect(calls).toEqual([]);
    // 正在查看的不是生效的模式：通知条写明后果，按钮才生效
    expect(screen.getByText("mode.activate.viewing")).toBeInTheDocument();
    // 聚合页按状态分组：默认 / 已添加 / 可添加
    expect(
      screen.getByText("providerCard.section.stackDefaultAfterSwitch"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "mode.activate.stack" }),
    );
    const dialog = await screen.findByRole("dialog");
    // 预选上次的默认那家 Zulu：另有 alpha 一家（1 个模型）
    expect(dialog).toHaveTextContent("mode.dialog.stackNoteMembers");
    await user.click(
      within(dialog).getByRole("combobox", {
        name: "mode.dialog.stackDefault",
      }),
    );
    const options = await screen.findAllByRole("option");
    expect(options.map((e) => e.textContent)).toEqual(["alpha", "Zulu"]);
    await user.click(options[0]);
    await user.click(
      within(dialog).getByRole("button", { name: "mode.dialog.confirmStack" }),
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

  // 上游 f9e0d537：回到直连也先确认，说明连到哪家、改写哪个文件；出错就地显示
  it("回到直连先确认，写明直连那家和客户端文件，失败时在确认框里显示错误", async () => {
    const calls: unknown[] = [];
    let fail = true;
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "routing",
          attached: true,
          directProviderId: "a",
          routeProviderId: "z",
          eligibleProviderIds: ["z", "a"],
          aggregation: { active: false, members: [] },
        }),
      ),
      http.post("http://runtime.local/set_app_mode", async ({ request }) => {
        calls.push(await request.json());
        if (fail) {
          fail = false;
          return HttpResponse.json("client file locked", { status: 500 });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const client = renderPanel();
    await user.click(await tab("mode.names.direct"));
    await user.click(
      screen.getByRole("button", { name: "mode.activate.direct" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(calls).toEqual([]);
    expect(dialog).toHaveTextContent("mode.dialog.exitTitle");
    expect(dialog).toHaveTextContent("mode.dialog.exitNoteFile");
    expect(dialog).toHaveTextContent("mode.dialog.exitNoteRouteKept");

    const confirm = within(dialog).getByRole("button", {
      name: "mode.dialog.confirmDirect",
    });
    await user.click(confirm);
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(confirm);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      { appType: "claude", mode: "direct" },
      { appType: "claude", mode: "direct" },
    ]);
    client.clear();
  });

  // 上游 3e9eede4 / b93bf12d：Claude Desktop 也有设备级的直连 / 路由 / 聚合模式
  it("Claude Desktop 提供三种模式，路由页说明只在启动时读取配置", async () => {
    const calls: unknown[] = [];
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "direct",
          attached: false,
          directProviderId: "a",
          routeProviderId: null,
          eligibleProviderIds: ["z", "a"],
          aggregation: { active: false, members: [] },
        }),
      ),
      http.post("http://runtime.local/set_app_mode", async ({ request }) => {
        calls.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const client = renderPanel({ app: "claude-desktop" });
    expect(await tab("mode.names.stack")).toBeInTheDocument();
    expect(screen.queryByText("webMode.desktopRouteNote")).toBeNull();
    await user.click(await tab("mode.names.route"));
    expect(screen.getByText("webMode.desktopRouteNote")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "mode.activate.route" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("mode.dialog.desktopRouteNoteRestart");
    await user.click(
      within(dialog).getByRole("button", { name: "mode.dialog.confirmRoute" }),
    );
    await waitFor(() =>
      expect(calls).toEqual([
        { appType: "claude-desktop", mode: "routing", routeProviderId: "a" },
      ]),
    );
    client.clear();
  });

  it("聚合生效时：加入按钮只改名单，默认那家显示状态且删不掉", async () => {
    const memberCalls: unknown[] = [];
    const onSwitch = vi.fn();
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "aggregation",
          attached: true,
          directProviderId: "a",
          routeProviderId: "z",
          eligibleProviderIds: ["z", "a", "o"],
          aggregation: {
            active: true,
            members: [{ providerId: "z", modelIds: ["m"], route: true }],
          },
        }),
      ),
      http.post(
        "http://runtime.local/set_aggregation_member",
        async ({ request }) => {
          memberCalls.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const user = userEvent.setup();
    const client = renderPanel({ onSwitch });
    expect(
      await screen.findByText("providerCard.section.stackDefault"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("providerCard.status.currentDefault"),
    ).toBeInTheDocument();

    const addButtons = screen.getAllByRole("button", {
      name: "providerCard.action.add",
    });
    await user.click(addButtons[0]);
    await waitFor(() => expect(memberCalls).toHaveLength(1));
    expect(memberCalls[0]).toMatchObject({ enabled: true });
    expect(onSwitch).not.toHaveBeenCalled();

    // 默认那家（Zulu）正在路由：删除项列出来但不能点，写明原因
    const moreButtons = screen.getAllByRole("button", {
      name: "providerCard.action.more",
    });
    await user.click(moreButtons[0]);
    const deleteItem = await screen.findByRole("menuitem", {
      name: /common\.delete/,
    });
    expect(deleteItem).toHaveAttribute("data-disabled");
    expect(deleteItem).toHaveTextContent(
      "providerCard.reason.inUseCannotDelete",
    );
    client.clear();
  });

  it("直连页里需要路由的卡先弹「需要路由」，可以仍然直连切换", async () => {
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          mode: "direct",
          attached: false,
          directProviderId: "a",
          routeProviderId: null,
          eligibleProviderIds: ["z", "a", "o"],
          aggregation: { active: false, members: [] },
        }),
      ),
    );
    const onSwitch = vi.fn();
    const converted: Provider = {
      id: "c",
      name: "Converted",
      settingsConfig: {},
      meta: { apiFormat: "openai_chat" },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Panel() {
      const state = useAppMode("claude");
      return (
        <SwitchModePanel
          app="claude"
          providers={{ ...providers, c: converted }}
          currentProviderId="a"
          isLoading={false}
          state={state}
          serviceRunning={false}
          onSwitch={onSwitch}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
          onOpenWebsite={vi.fn()}
        />
      );
    }
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <Panel />
      </QueryClientProvider>,
    );
    // 卡片按名称 A–Z：alpha（在用）、Converted、Official、Zulu
    expect(
      await screen.findByText("providerCard.status.inUse"),
    ).toBeInTheDocument();
    const switchButtons = await screen.findAllByRole("button", {
      name: "providerCard.action.switch",
    });
    await user.click(switchButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("mode.dialog.needsRouteTitle");
    expect(onSwitch).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "mode.dialog.switchAnyway" }),
    );
    expect(onSwitch).toHaveBeenCalledWith(converted, {
      acknowledgedRouting: true,
    });
    client.clear();
  });
});

describe("运行模式状态徽标", () => {
  const renderWith = async (view: Record<string, unknown>) => {
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json({
          directProviderId: "a",
          routeProviderId: "z",
          eligibleProviderIds: ["a", "z"],
          aggregation: { active: false, members: [] },
          ...view,
        }),
      ),
    );
    renderPanel();
    return await screen.findByTestId("app-mode-status-dot");
  };

  it("已接上路由时用模式色，并写出实际生效的那家", async () => {
    const dot = await renderWith({ mode: "routing", attached: true });
    expect(dot.className).toContain("bg-emerald-500");
    expect(dot.parentElement).toHaveTextContent("Zulu");
  });

  it("路由还没接上客户端时显示灰点", async () => {
    const dot = await renderWith({ mode: "routing", attached: false });
    expect(dot.className).not.toContain("bg-emerald-500");
  });
});
