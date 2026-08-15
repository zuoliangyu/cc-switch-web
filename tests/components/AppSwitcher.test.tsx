import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "@/components/AppSwitcher";

describe("AppSwitcher", () => {
  it("可从移动端菜单切换应用", async () => {
    const onSwitch = vi.fn();
    render(<AppSwitcher activeApp="claude" onSwitch={onSwitch} />);

    await userEvent.click(
      screen.getByRole("button", { name: /^Claude$/, expanded: false }),
    );
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Codex/ }));

    expect(onSwitch).toHaveBeenCalledWith("codex");
  });
});
