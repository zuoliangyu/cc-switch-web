import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import { DEFAULT_VISIBLE_APPS } from "@/config/appConfig";
import { settingsApi } from "@/lib/api";

const bulkToggle = vi.fn().mockResolvedValue({ succeeded: [], failed: [] });

vi.mock("@/hooks/useMcp", () => ({
  useAllMcpServers: () => ({
    data: {
      alpha: {
        id: "alpha",
        name: "Alpha",
        server: { command: "alpha" },
        apps: {},
      },
      beta: {
        id: "beta",
        name: "Beta",
        server: { command: "beta" },
        apps: {},
      },
    },
    isLoading: false,
  }),
  useToggleMcpApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkToggleMcpApp: () => ({
    mutateAsync: bulkToggle,
    isPending: false,
    variables: undefined,
  }),
  useDeleteMcpServer: () => ({ mutateAsync: vi.fn() }),
  useImportMcpFromApps: () => ({ mutateAsync: vi.fn() }),
}));

describe("UnifiedMcpPanel", () => {
  it("部分失败时撤销只恢复已经成功的条目", async () => {
    const success = vi.spyOn(toast, "success");
    bulkToggle.mockClear();
    bulkToggle.mockResolvedValueOnce({
      succeeded: ["alpha"],
      failed: [{ item: "beta", error: "offline" }],
    });
    render(<UnifiedMcpPanel onOpenChange={() => {}} />);
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(success).toHaveBeenCalled());
    const action = success.mock.calls.at(-1)?.[1]?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("missing undo action");
    action.onClick({} as React.MouseEvent<HTMLButtonElement>);
    await waitFor(() =>
      expect(bulkToggle).toHaveBeenLastCalledWith({
        serverIds: ["alpha"],
        app: "claude",
        enabled: false,
      }),
    );
    success.mockRestore();
  });

  it("搜索过滤时批量开关只作用于匹配列表", async () => {
    render(<UnifiedMcpPanel onOpenChange={() => {}} />);

    await userEvent.type(screen.getByRole("textbox"), "Alpha");
    await userEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(bulkToggle).toHaveBeenCalledWith({
      serverIds: ["alpha"],
      app: "claude",
      enabled: true,
    });
  });

  it("Oh My Pi 显示时说明它还会发现其他 Agent 的配置", async () => {
    const openExternal = vi
      .spyOn(settingsApi, "openExternal")
      .mockResolvedValue(undefined);
    const { unmount } = render(<UnifiedMcpPanel onOpenChange={() => {}} />);
    await userEvent.click(
      screen.getByRole("button", { name: "appMatrix.ompDiscovery.docsLink" }),
    );
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining("oh-my-pi/blob/main/docs/context-files.md"),
    );
    unmount();

    render(
      <UnifiedMcpPanel
        onOpenChange={() => {}}
        visibleApps={{ ...DEFAULT_VISIBLE_APPS, omp: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "appMatrix.ompDiscovery.docsLink" }),
    ).not.toBeInTheDocument();
    openExternal.mockRestore();
  });
});

function render(ui: React.ReactElement) {
  return rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
