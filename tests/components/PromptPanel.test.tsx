import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptPanel from "@/components/prompts/PromptPanel";

const reload = vi.fn();

vi.mock("@/hooks/usePromptActions", () => ({
  usePromptActions: () => ({
    prompts: {
      alpha: { id: "alpha", name: "Alpha", content: "first", enabled: false },
      beta: { id: "beta", name: "Beta", content: "second", enabled: false },
    },
    loading: false,
    reload,
    savePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    toggleEnabled: vi.fn(),
  }),
}));

describe("PromptPanel", () => {
  beforeEach(() => {
    reload.mockClear();
  });

  it("按名称过滤提示词列表", async () => {
    render(<PromptPanel open appId="claude" onOpenChange={() => {}} />);

    await userEvent.type(screen.getByRole("textbox"), "Beta");

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("窗口重新获得焦点时刷新，卸载后移除监听", () => {
    const { unmount } = render(
      <PromptPanel open appId="claude" onOpenChange={() => {}} />,
    );
    reload.mockClear();

    fireEvent(window, new Event("focus"));
    expect(reload).toHaveBeenCalledTimes(1);

    unmount();
    reload.mockClear();
    fireEvent(window, new Event("focus"));
    expect(reload).not.toHaveBeenCalled();
  });
});
