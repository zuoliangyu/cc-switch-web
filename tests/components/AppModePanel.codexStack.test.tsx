import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { AppModePanel } from "@/components/proxy/AppModePanel";
import { useAppMode } from "@/hooks/useAppMode";
import type { Provider, Settings } from "@/types";
import type { AppModeView } from "@/types/proxy";

const providers: Record<string, Provider> = Object.fromEntries(
  [
    ["a", "Alpha"],
    ["b", "Beta"],
  ].map(([id, name]) => [id, { id, name, settingsConfig: {} }]),
);

function ModePanel() {
  const state = useAppMode("codex");
  return <AppModePanel app="codex" providers={providers} state={state} />;
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ModePanel />
    </QueryClientProvider>,
  );
  return client;
}

function modeView(
  aggregation: Partial<AppModeView["aggregation"]>,
  mode: AppModeView["mode"] = "aggregation",
): AppModeView {
  return {
    mode,
    attached: true,
    directProviderId: "a",
    routeProviderId: "a",
    eligibleProviderIds: ["a", "b"],
    aggregation: {
      active: mode === "aggregation",
      members: [],
      ...aggregation,
    },
  };
}

describe("Codex 聚合：目录、旧客户端与聚合设置", () => {
  it("默认那家自己的模型目录挡住聚合时，可以改用 CC Switch 的目录", async () => {
    let adopted = 0;
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json(
          modeView(adopted ? {} : { notice: "routeOwnsCatalog" }),
        ),
      ),
      http.post("http://runtime.local/adopt_codex_stack_catalog", () => {
        adopted += 1;
        return HttpResponse.json(null);
      }),
    );
    const client = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "webMode.adoptCatalog" }),
    );
    await waitFor(() => expect(adopted).toBe(1));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "webMode.adoptCatalog" }),
      ).not.toBeInTheDocument(),
    );
    client.clear();
  });

  it("旧客户端提示不分模式；看不到进程时关掉提示会告诉后端，同一份不再显示", async () => {
    let acknowledged = 0;
    let revision = "r1";
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json(
          modeView(
            {
              staleClients: {
                daemon: false,
                others: true,
                auth: true,
                unverified: true,
              },
              staleRevision: revision,
            },
            "direct",
          ),
        ),
      ),
      http.post("http://runtime.local/acknowledge_codex_stale_clients", () => {
        acknowledged += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = renderPanel();
    expect(
      await screen.findByText("webMode.staleClients.unverifiedTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("webMode.staleClients.unverifiedHint"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    await waitFor(() => expect(acknowledged).toBe(1));
    expect(
      screen.queryByText("webMode.staleClients.unverifiedTitle"),
    ).not.toBeInTheDocument();

    // 目录或登录又变了：revision 变了，重新显示
    revision = "r2";
    await client.invalidateQueries({ queryKey: ["appMode"] });
    expect(
      await screen.findByText("webMode.staleClients.unverifiedTitle"),
    ).toBeInTheDocument();
    client.clear();
  });

  it("聚合设置：子代理模型去掉默认那家，换模型清掉不支持的强度，经典工具被 config.toml 覆盖时提示", async () => {
    let settings: Settings = {
      codexStackSubagentModel: "ccs-b/b-pro",
      codexStackSubagentReasoningEffort: "xhigh",
    } as Settings;
    const saved: Settings[] = [];
    server.use(
      http.post("http://runtime.local/get_app_mode", () =>
        HttpResponse.json(
          modeView({
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
                defaultEffort: "low",
              },
              {
                id: "ccs-b/b-mini",
                providerId: "b",
                displayName: "b-mini（Beta）",
                efforts: ["low"],
              },
            ],
          }),
        ),
      ),
      http.post("http://runtime.local/get_settings", () =>
        HttpResponse.json(settings),
      ),
      http.post("http://runtime.local/save_settings", async ({ request }) => {
        const body = (await request.json()) as { settings: Settings };
        settings = body.settings;
        saved.push(body.settings);
        return HttpResponse.json(true);
      }),
      http.post("http://runtime.local/codex_forces_multi_agent_v2", () =>
        HttpResponse.json(true),
      ),
    );
    const client = renderPanel();
    const model = (await screen.findByRole("combobox", {
      name: "webMode.stackSettings.subagentModel",
    })) as HTMLSelectElement;
    await waitFor(() => expect(model.value).toBe("ccs-b/b-pro"));
    // 默认那家（a）不发布 `ccs-*` 模型，不列出
    expect(Array.from(model.options).map((option) => option.value)).toEqual([
      "",
      "ccs-b/b-pro",
      "ccs-b/b-mini",
    ]);
    expect(
      await screen.findByText("webMode.stackSettings.classicToolsForcedV2"),
    ).toBeInTheDocument();

    fireEvent.change(model, { target: { value: "ccs-b/b-mini" } });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].codexStackSubagentModel).toBe("ccs-b/b-mini");
    expect(saved[0].codexStackSubagentReasoningEffort).toBeUndefined();

    const review = screen.getByRole("combobox", {
      name: "webMode.stackSettings.autoReviewModel",
    });
    await waitFor(() => expect(review).not.toBeDisabled());
    fireEvent.change(review, { target: { value: "ccs-b/b-pro" } });
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1].codexStackAutoReviewModel).toBe("ccs-b/b-pro");
    client.clear();
  });
});
