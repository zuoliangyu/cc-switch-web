import { Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { resetProviderState } from "../msw/state";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/providers/ProviderList", () => ({
  ProviderList: ({
    providers,
    currentProviderId,
    onSwitch,
    onEdit,
    onDuplicate,
    onConfigureUsage,
    onOpenWebsite,
    onRemoveFromConfig,
    onCreate,
  }: any) => (
    <div>
      <div data-testid="provider-list">{JSON.stringify(providers)}</div>
      <div data-testid="current-provider">{currentProviderId}</div>
      <button onClick={() => onSwitch(providers[currentProviderId])}>
        switch
      </button>
      <button onClick={() => onEdit(providers[currentProviderId])}>edit</button>
      <button onClick={() => onDuplicate(providers[currentProviderId])}>
        duplicate
      </button>
      <button onClick={() => onConfigureUsage(providers[currentProviderId])}>
        usage
      </button>
      <button onClick={() => onOpenWebsite("https://example.com")}>
        open-website
      </button>
      <button onClick={() => onRemoveFromConfig?.(Object.values(providers)[0])}>
        remove
      </button>
      <button onClick={() => onCreate?.()}>create</button>
    </div>
  ),
}));

vi.mock("@/components/providers/AddProviderDialog", () => ({
  AddProviderDialog: ({ open, onOpenChange, onSubmit, appId }: any) =>
    open ? (
      <div data-testid="add-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              name: `New ${appId} Provider`,
              settingsConfig: {},
              category: "custom",
              sortIndex: 99,
            })
          }
        >
          confirm-add
        </button>
        <button onClick={() => onOpenChange(false)}>close-add</button>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/EditProviderDialog", () => ({
  EditProviderDialog: ({ open, provider, onSubmit, onOpenChange }: any) =>
    open ? (
      <div data-testid="edit-provider-dialog">
        <button
          onClick={() =>
            // 真实组件的 onSubmit 形态是 { provider, originalId }，
            // 这里要保持一致，否则 App.handleEditProvider 解构得到 undefined。
            onSubmit({
              provider: {
                ...provider,
                name: `${provider.name}-edited`,
              },
              originalId: provider.id,
            })
          }
        >
          confirm-edit
        </button>
        <button onClick={() => onOpenChange(false)}>close-edit</button>
      </div>
    ) : null,
}));

vi.mock("@/components/UsageScriptModal", () => ({
  default: ({ isOpen, provider, onSave, onClose }: any) =>
    isOpen ? (
      <div data-testid="usage-modal">
        <span data-testid="usage-provider">{provider?.id}</span>
        <button onClick={() => onSave("script-code")}>save-script</button>
        <button onClick={() => onClose()}>close-usage</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button onClick={() => onConfirm()}>confirm-delete</button>
        <button onClick={() => onCancel()}>cancel-delete</button>
      </div>
    ) : null,
}));

vi.mock("@/components/AppSwitcher", () => ({
  AppSwitcher: ({ activeApp, onSwitch }: any) => (
    <div data-testid="app-switcher">
      <span>{activeApp}</span>
      <button onClick={() => onSwitch("claude")}>switch-claude</button>
      <button onClick={() => onSwitch("codex")}>switch-codex</button>
    </div>
  ),
}));

vi.mock("@/components/UpdateBadge", () => ({
  UpdateBadge: ({ onClick }: any) => (
    <button onClick={onClick}>update-badge</button>
  ),
}));

vi.mock("@/components/mcp/McpPanel", () => ({
  default: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="mcp-panel">
        <button onClick={() => onOpenChange(false)}>close-mcp</button>
      </div>
    ) : (
      <button onClick={() => onOpenChange(true)}>open-mcp</button>
    ),
}));

// App 依赖较多，全量并发时模块转换可能超过单测超时；在收集阶段完成加载，
// 让用例超时只衡量实际交互流程。
const { default: App } = await import("@/App");

const renderApp = (AppComponent: ComponentType) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <AppComponent />
      </Suspense>
    </QueryClientProvider>,
  );
};

describe("App integration with MSW", () => {
  beforeEach(() => {
    resetProviderState();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  // 模块加载已在收集阶段完成，默认超时只衡量实际交互流程。
  it("covers basic provider flows via real hooks", async () => {
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    fireEvent.click(screen.getByText("usage"));
    // 弹窗按需加载，首次打开需等待
    expect(await screen.findByTestId("usage-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-script"));
    fireEvent.click(screen.getByText("close-usage"));

    fireEvent.click(screen.getByText("create"));
    expect(
      await screen.findByTestId("add-provider-dialog"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-add"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /New codex Provider/,
      ),
    );

    fireEvent.click(screen.getByText("edit"));
    expect(
      await screen.findByTestId("edit-provider-dialog"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-edit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /-edited/,
      ),
    );

    fireEvent.click(screen.getByText("switch"));
    fireEvent.click(screen.getByText("duplicate"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(/copy/),
    );

    fireEvent.click(screen.getByText("open-website"));

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("resets provider view scroll when switching apps", async () => {
    const { container } = renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    const mainScrollContainer = container.querySelector("main") as HTMLElement;
    const providerScrollContainer = Array.from(
      container.querySelectorAll<HTMLElement>(".overflow-y-auto"),
    ).find(
      (element) =>
        element !== mainScrollContainer && element.className.includes("pb-12"),
    );

    expect(mainScrollContainer).not.toBeNull();
    expect(providerScrollContainer).toBeDefined();

    mainScrollContainer.scrollTop = 320;
    mainScrollContainer.scrollLeft = 12;
    providerScrollContainer!.scrollTop = 640;
    providerScrollContainer!.scrollLeft = 24;

    fireEvent.click(screen.getByText("switch-codex"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    expect(mainScrollContainer.scrollTop).toBe(0);
    expect(mainScrollContainer.scrollLeft).toBe(0);
    expect(providerScrollContainer!.scrollTop).toBe(0);
    expect(providerScrollContainer!.scrollLeft).toBe(0);
  });

  // 上游 09c5d39d：MiniMax Code 从配置移除后需刷新供应商列表（成员关系来自 meta）。
  it("refreshes MiniMax Code provider membership after removing it from live config", async () => {
    localStorage.setItem("cc-switch-last-app", "mcode");
    let liveConfigManaged = true;
    let providerRequests = 0;
    server.use(
      http.post("http://runtime.local/get_providers", async ({ request }) => {
        const { app } = (await request.json()) as { app: string };
        if (app !== "mcode") return;
        providerRequests += 1;
        return HttpResponse.json({
          custom: {
            id: "custom",
            name: "Custom MiniMax Code",
            settingsConfig: {},
            meta: { liveConfigManaged },
          },
        });
      }),
      http.post(
        "http://runtime.local/remove_provider_from_live_config",
        async ({ request }) => {
          expect(await request.json()).toEqual({ id: "custom", app: "mcode" });
          liveConfigManaged = false;
          return HttpResponse.json(true);
        },
      ),
    );

    try {
      renderApp(App);

      await waitFor(() =>
        expect(screen.getByTestId("provider-list")).toHaveTextContent(
          '"liveConfigManaged":true',
        ),
      );
      const requestsBeforeRemoval = providerRequests;
      fireEvent.click(screen.getByText("remove"));
      fireEvent.click(screen.getByText("confirm-delete"));

      await waitFor(() =>
        expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument(),
      );
      expect(liveConfigManaged).toBe(false);
      await waitFor(() =>
        expect(screen.getByTestId("provider-list")).toHaveTextContent(
          '"liveConfigManaged":false',
        ),
      );
      expect(providerRequests).toBeGreaterThan(requestsBeforeRemoval);
      expect(screen.getByTestId("provider-list")).toHaveTextContent(
        "Custom MiniMax Code",
      );
    } finally {
      localStorage.removeItem("cc-switch-last-app");
    }
  });
});
