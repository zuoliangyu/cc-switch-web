import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppCountBar } from "@/components/common/AppCountBar";

describe("AppCountBar", () => {
  it("部分启用时提供全部启用操作", async () => {
    const onToggleAll = vi.fn();
    render(
      <AppCountBar
        totalLabel="2 MCP"
        counts={{ claude: 1 }}
        appIds={["claude"]}
        totalCount={2}
        onToggleAll={onToggleAll}
      />,
    );

    const button = screen.getByRole("checkbox");
    expect(button).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(button);
    expect(onToggleAll).toHaveBeenCalledWith("claude", true);
  });
});
