import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { ProxyPanel } from "@/components/proxy/ProxyPanel";

// 上游 f88068b9：连接地址只存在本机，保存时按新地址重写接上路由的客户端
describe("代理面板的连接地址", () => {
  it("回显已存的地址，按监听地址给占位，拒绝 0.0.0.0，保存时去掉首尾空白", async () => {
    const saved: unknown[] = [];
    server.use(
      http.post("http://runtime.local/get_global_proxy_config", () =>
        HttpResponse.json({
          proxyEnabled: false,
          listenAddress: "0.0.0.0",
          listenPort: 15721,
          enableLogging: true,
        }),
      ),
      http.post("http://runtime.local/get_proxy_client_host", () =>
        HttpResponse.json(""),
      ),
      http.post(
        "http://runtime.local/set_proxy_client_host",
        async ({ request }) => {
          saved.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <ProxyPanel
          enableLocalProxy
          onEnableLocalProxyChange={() => {}}
          onToggleProxy={async () => {}}
          isProxyPending={false}
        />
      </QueryClientProvider>,
    );
    const input = await screen.findByLabelText(
      "proxy.settings.clientHost.label",
    );
    await waitFor(() =>
      expect(input).toHaveAttribute("placeholder", "127.0.0.1"),
    );
    const save = screen.getAllByRole("button", { name: "common.save" })[0];
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.change(input, { target: { value: "0.0.0.0" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "proxy.settings.clientHost.invalid",
    );
    expect(saved).toEqual([]);

    fireEvent.change(input, { target: { value: " 172.25.144.1 " } });
    fireEvent.click(save);
    await waitFor(() => expect(saved).toEqual([{ host: "172.25.144.1" }]));
    client.clear();
  });
});
