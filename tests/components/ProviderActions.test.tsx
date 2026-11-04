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

describe("ProviderActions", () => {
  // 上游 ADDITIVE_APP_IDS 含 MiniMax Code：卡片是「添加 / 移除」，不是「启用 / 使用中」
  it("treats MiniMax Code cards as additive", () => {
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
    // 累加应用的卡可以删，不看 isCurrent
    expect(screen.getByTitle("common.delete")).toBeEnabled();
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
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "设为默认" }));
    // 子菜单里每个模型一项：名字在上、ID 在下
    const option = await screen.findByRole("menuitem", { name: /Model One/ });
    expect(option).toHaveTextContent("m1");
    fireEvent.click(option);
    expect(onSetAsDefault).toHaveBeenCalledWith("m1");
  });

  it("hides set-default for an OpenCode card that declares no models", () => {
    render(
      <ProviderActions
        {...base}
        appId="opencode"
        isInConfig
        onSetAsDefault={vi.fn()}
        defaultModelOptions={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "更多" }),
    ).not.toBeInTheDocument();
  });

  it("marks the default Hermes card and keeps its remove button disabled", () => {
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
    expect(screen.getByRole("button", { name: "移除" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "更多" }),
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
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "设为默认" }));
    expect(onSetAsDefault).toHaveBeenCalledWith(undefined);
  });

  it("explains why the delete button is disabled", () => {
    render(
      <ProviderActions
        {...base}
        appId="claude"
        deleteDisabled
        deleteDisabledReason="退出路由后会回到这家"
      />,
    );
    const button = screen.getByTitle("退出路由后会回到这家");
    expect(button).toBeDisabled();
  });
});
