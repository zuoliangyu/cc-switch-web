import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  settingsApi: { save: mocks.save },
}));

vi.mock("@/lib/query", () => ({
  useSettingsQuery: () => ({
    data: { firstRunNoticeConfirmed: false },
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

describe("首次运行提示", () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.toastError.mockReset();
  });

  it("确认保存成功后立即关闭", async () => {
    mocks.save.mockResolvedValue(true);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FirstRunNoticeDialog />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "firstRunNotice.confirm" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("firstRunNotice.title"),
      ).not.toBeInTheDocument();
    });
    expect(mocks.save).toHaveBeenCalledWith({
      firstRunNoticeConfirmed: true,
    });
  });

  it("保存失败时保留弹窗并提示错误", async () => {
    mocks.save.mockRejectedValue(new Error("disk is read-only"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FirstRunNoticeDialog />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "firstRunNotice.confirm" }),
    );

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "firstRunNotice.saveFailed",
      );
    });
    expect(screen.getByText("firstRunNotice.title")).toBeInTheDocument();
  });
});
