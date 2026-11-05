import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderActions } from "@/components/providers/ProviderActions";

const base = {
  isCurrent: false,
  onSwitch: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

async function openMoreMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "更多" }));
  return user;
}

describe("ProviderActions", () => {
  // 上游 ADDITIVE_APP_IDS 含 MiniMax Code：卡片是「添加 / 移除」，不是「启用 / 使用中」
  it("treats MiniMax Code cards as additive", async () => {
    const onSwitch = vi.fn();
    const onRemoveFromConfig = vi.fn();
    const { rerender } = render(
      <ProviderActions
        {...base}
        appId="mcode"
        isCurrent
        isInConfig={false}
        onSwitch={onSwitch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onSwitch).toHaveBeenCalled();

    rerender(
      <ProviderActions
        {...base}
        appId="mcode"
        isCurrent
        isInConfig
        onRemoveFromConfig={onRemoveFromConfig}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    expect(onRemoveFromConfig).toHaveBeenCalled();
    // 累加应用的卡可以删，不看 isCurrent；删除在「更多」菜单里
    await openMoreMenu();
    expect(
      await screen.findByRole("menuitem", { name: "common.delete" }),
    ).not.toHaveAttribute("data-disabled");
  });

  it("puts set-default for an added OpenCode card in the more menu with a model submenu", async () => {
    const onSetAsDefault = vi.fn();
    render(
      <ProviderActions
        {...base}
        appId="opencode"
        isInConfig
        onSetAsDefault={onSetAsDefault}
        defaultModelOptions={[{ id: "m1", name: "Model One" }, { id: "m2" }]}
      />,
    );
    // 卡片上不再有单独的「设为默认」按钮
    expect(
      screen.queryByRole("button", { name: "设为默认" }),
    ).not.toBeInTheDocument();
    const user = await openMoreMenu();
    await user.click(await screen.findByRole("menuitem", { name: "设为默认" }));
    // 子菜单里每个模型一项：名字在上、ID 在下
    const option = await screen.findByRole("menuitem", { name: /Model One/ });
    expect(option).toHaveTextContent("m1");
    fireEvent.click(option);
    expect(onSetAsDefault).toHaveBeenCalledWith("m1");
  });

  it("hides set-default for an OpenCode card that declares no models", async () => {
    render(
      <ProviderActions
        {...base}
        appId="opencode"
        isInConfig
        onSetAsDefault={vi.fn()}
        defaultModelOptions={[]}
      />,
    );
    await openMoreMenu();
    expect(
      await screen.findByRole("menuitem", { name: "common.delete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "设为默认" }),
    ).not.toBeInTheDocument();
  });

  it("marks the default Hermes card and explains why it cannot be removed", async () => {
    render(
      <ProviderActions
        {...base}
        appId="hermes"
        isInConfig
        isDefaultModel
        onSetAsDefault={vi.fn()}
        onRemoveFromConfig={vi.fn()}
      />,
    );
    expect(screen.getByText("当前默认")).toBeInTheDocument();
    // 按钮照常画出来，不能点的原因挂在说明卡上
    const remove = screen.getByRole("button", { name: "移除" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription(
      "默认那家不能移除，先把别家设为默认。",
    );
    await openMoreMenu();
    expect(
      screen.queryByRole("menuitem", { name: "设为默认" }),
    ).not.toBeInTheDocument();
  });

  it("selects set-default for a single-model Hermes card from the more menu", async () => {
    const onSetAsDefault = vi.fn();
    render(
      <ProviderActions
        {...base}
        appId="hermes"
        isInConfig
        onSetAsDefault={onSetAsDefault}
      />,
    );
    const user = await openMoreMenu();
    await user.click(await screen.findByRole("menuitem", { name: "设为默认" }));
    expect(onSetAsDefault).toHaveBeenCalledWith(undefined);
  });

  it("explains why the delete item is disabled", async () => {
    render(
      <ProviderActions
        {...base}
        appId="claude"
        deleteDisabled
        deleteDisabledReason="退出路由后会回到这家"
      />,
    );
    await openMoreMenu();
    const item = await screen.findByRole("menuitem", {
      name: /common\.delete/,
    });
    expect(item).toHaveAttribute("data-disabled");
    expect(item).toHaveTextContent("退出路由后会回到这家");
  });

  // 上游 0c07d509：主操作位定宽，按钮和「● 使用中」互换时左边的用量列不跳
  it("keeps the primary slot at a fixed minimum width for status and buttons", () => {
    const { rerender } = render(
      <ProviderActions {...base} appId="claude" isCurrent />,
    );
    const status = screen.getByText("使用中");
    expect(status.parentElement).toHaveClass("min-w-20");

    rerender(<ProviderActions {...base} appId="claude" />);
    const enable = screen.getByRole("button", { name: "启用" });
    expect(enable.closest(".min-w-20")).not.toBeNull();
  });

  it("keeps secondary actions in the more menu", async () => {
    const onDuplicate = vi.fn();
    const onTest = vi.fn();
    const onConfigureUsage = vi.fn();
    render(
      <ProviderActions
        {...base}
        appId="claude"
        onDuplicate={onDuplicate}
        onTest={onTest}
        onConfigureUsage={onConfigureUsage}
      />,
    );
    // 卡上只剩主操作、编辑、更多
    expect(screen.getByRole("button", { name: "common.edit" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "provider.duplicate" }),
    ).not.toBeInTheDocument();
    const user = await openMoreMenu();
    await user.click(
      await screen.findByRole("menuitem", { name: "provider.duplicate" }),
    );
    expect(onDuplicate).toHaveBeenCalled();
    await openMoreMenu();
    await user.click(await screen.findByRole("menuitem", { name: "测试模型" }));
    expect(onTest).toHaveBeenCalled();
    await openMoreMenu();
    await user.click(
      await screen.findByRole("menuitem", { name: "provider.configureUsage" }),
    );
    expect(onConfigureUsage).toHaveBeenCalled();
  });

  it("does not let the in-use card be deleted and says why", async () => {
    render(<ProviderActions {...base} appId="claude" isCurrent />);
    await openMoreMenu();
    const item = await screen.findByRole("menuitem", {
      name: /common\.delete/,
    });
    expect(item).toHaveAttribute("data-disabled");
    expect(item).toHaveTextContent("正在用的这家不能删除，先切到别家。");
  });

  it("turns failover queue membership into add / remove queue buttons", () => {
    const onToggleFailover = vi.fn();
    const { rerender } = render(
      <ProviderActions
        {...base}
        appId="claude"
        isAutoFailoverEnabled
        onToggleFailover={onToggleFailover}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "加入队列" }));
    expect(onToggleFailover).toHaveBeenLastCalledWith(true);

    rerender(
      <ProviderActions
        {...base}
        appId="claude"
        isAutoFailoverEnabled
        isInFailoverQueue
        onToggleFailover={onToggleFailover}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "移出队列" }));
    expect(onToggleFailover).toHaveBeenLastCalledWith(false);
  });
});
