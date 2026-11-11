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

  it("列出全部应用，包括 Copilot CLI 等后加的应用", async () => {
    render(<AppSwitcher activeApp="copilot" onSwitch={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Copilot CLI$/, expanded: false }),
    );
    for (const name of [
      "Kimi Code",
      "DeepSeek Harness",
      "Antigravity",
      "Oh My Pi",
      "Copilot CLI",
    ]) {
      expect(
        screen.getByRole("menuitemradio", { name: new RegExp(name) }),
      ).toBeInTheDocument();
    }
  });

  it("空间不足时保留当前应用并把其余应用放入更多菜单", async () => {
    const onSwitch = vi.fn();
    const originalResizeObserver = globalThis.ResizeObserver;
    const offsetWidth = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(40);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(120);
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    render(<AppSwitcher activeApp="codex" onSwitch={onSwitch} />);

    expect(screen.getAllByRole("button", { name: "Codex" })).toHaveLength(2);
    await userEvent.click(
      screen.getByRole("button", { name: "appSwitcher.more" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Hermes$/ }));
    expect(onSwitch).toHaveBeenCalledWith("hermes");

    offsetWidth.mockRestore();
    clientWidth.mockRestore();
    globalThis.ResizeObserver = originalResizeObserver;
  });
});
