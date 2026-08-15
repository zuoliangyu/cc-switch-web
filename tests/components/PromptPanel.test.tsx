import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PromptPanel from "@/components/prompts/PromptPanel";

vi.mock("@/hooks/usePromptActions", () => ({
  usePromptActions: () => ({
    prompts: {
      alpha: { id: "alpha", name: "Alpha", content: "first", enabled: false },
      beta: { id: "beta", name: "Beta", content: "second", enabled: false },
    },
    loading: false,
    reload: vi.fn(),
    savePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    toggleEnabled: vi.fn(),
  }),
}));

describe("PromptPanel", () => {
  it("按名称过滤提示词列表", async () => {
    render(<PromptPanel open appId="claude" onOpenChange={() => {}} />);

    await userEvent.type(screen.getByRole("textbox"), "Beta");

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
});
