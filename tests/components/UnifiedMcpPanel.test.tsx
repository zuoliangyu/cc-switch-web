import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";

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
  it("搜索过滤时批量开关仍作用于完整列表", async () => {
    render(<UnifiedMcpPanel onOpenChange={() => {}} />);

    await userEvent.type(screen.getByRole("textbox"), "Alpha");
    await userEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(bulkToggle).toHaveBeenCalledWith({
      serverIds: ["alpha", "beta"],
      app: "claude",
      enabled: true,
    });
  });
});
