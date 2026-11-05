import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import type { ProviderFormValues } from "@/components/providers/forms/ProviderForm";
import { usePresetStep } from "@/components/providers/forms/presetStep";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

let mockFormValues: ProviderFormValues;
let mockHasPresetSelector = false;
let universalProps: {
  onUniversalPresetSelect?: unknown;
  onManageUniversalProviders?: unknown;
} = {};

vi.mock("@/components/providers/forms/ProviderForm", () => ({
  ProviderForm: ({
    onSubmit,
    onUniversalPresetSelect,
    onManageUniversalProviders,
  }: {
    onSubmit: (values: ProviderFormValues) => void;
    onUniversalPresetSelect?: unknown;
    onManageUniversalProviders?: unknown;
  }) => {
    const presetStep = usePresetStep();
    const registerSelector = presetStep?.registerSelector;
    universalProps = { onUniversalPresetSelect, onManageUniversalProviders };
    useEffect(() => {
      if (mockHasPresetSelector) return registerSelector?.();
    }, [registerSelector]);
    return (
      <form
        id="provider-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(mockFormValues);
        }}
      >
        {mockHasPresetSelector && presetStep?.step === "pick" && presetStep.host
          ? createPortal(
              <button type="button" onClick={() => presetStep.setStep("form")}>
                pick-preset
              </button>,
              presetStep.host,
            )
          : null}
      </form>
    );
  },
}));

describe("AddProviderDialog", () => {
  beforeEach(() => {
    mockHasPresetSelector = false;
    universalProps = {};
    mockFormValues = {
      name: "Test Provider",
      websiteUrl: "https://provider.example.com",
      settingsConfig: JSON.stringify({ env: {}, config: {} }),
      meta: {
        custom_endpoints: {
          "https://api.new-endpoint.com": {
            url: "https://api.new-endpoint.com",
            addedAt: 1,
          },
        },
      },
    };
  });

  it("显示预设填写提示并收紧顶部间距", async () => {
    const { container } = render(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="claude"
        onSubmit={vi.fn()}
      />,
    );

    // 表单里没有预设选择器（ProviderForm 是替身）：编辑视图到了直接进第 2 步
    expect(
      await screen.findByText("provider.addFooterHint"),
    ).toBeInTheDocument();
    expect(container.ownerDocument.querySelector(".pt-3")).not.toBeNull();
  });

  it("使用 ProviderForm 返回的自定义端点", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleOpenChange = vi.fn();

    render(
      <AddProviderDialog
        open
        onOpenChange={handleOpenChange}
        appId="claude"
        onSubmit={handleSubmit}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.meta?.custom_endpoints).toEqual(
      mockFormValues.meta?.custom_endpoints,
    );
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it("在缺少自定义端点时回退到配置中的 baseUrl", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    mockFormValues = {
      name: "Base URL Provider",
      websiteUrl: "",
      settingsConfig: JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://claude.base" },
        config: {},
      }),
    };

    render(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="claude"
        onSubmit={handleSubmit}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.meta?.custom_endpoints).toEqual({
      "https://claude.base": {
        url: "https://claude.base",
        addedAt: expect.any(Number),
        lastUsed: undefined,
      },
    });
  });

  it("从 Grok Build config.toml 提取自定义端点", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    mockFormValues = {
      name: "Grok Relay",
      websiteUrl: "",
      settingsConfig: JSON.stringify({
        config: `[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://grok.example.com/v1"
name = "Grok Relay"
api_key = "secret"
api_backend = "responses"
context_window = 500000
`,
      }),
    };

    render(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="grokbuild"
        onSubmit={handleSubmit}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].meta?.custom_endpoints).toEqual({
      "https://grok.example.com/v1": {
        url: "https://grok.example.com/v1",
        addedAt: expect.any(Number),
        lastUsed: undefined,
      },
    });
  });

  it("Grok Build 官方预设走现有 seed 流程", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    mockFormValues = {
      name: "Grok Official",
      websiteUrl: "https://x.ai/grok",
      settingsConfig: JSON.stringify({ config: "" }),
      presetId: "grokbuild-official",
      presetCategory: "official",
    };

    render(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="grokbuild"
        onSubmit={handleSubmit}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.add" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].ensureGrokBuildOfficialSeed).toBe(
      true,
    );
  });
  it("先选预设再填写，第 2 步的返回回到选预设", async () => {
    mockHasPresetSelector = true;
    const onOpenChange = vi.fn();
    render(
      <AddProviderDialog
        open
        onOpenChange={onOpenChange}
        appId="claude"
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "pick-preset" }));
    expect(
      screen.getByRole("button", { name: "common.add" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "providerPreset.backToPick" }),
    );
    expect(
      screen.getByRole("button", { name: "pick-preset" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common.add" }),
    ).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    // 第 1 步的返回关掉添加页
    fireEvent.click(
      screen.getByRole("button", { name: "provider.backToList" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("只有能接收统一供应商的应用才拿到统一预设入口", async () => {
    const { rerender } = render(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="omp"
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "common.add" });
    expect(universalProps.onUniversalPresetSelect).toBeUndefined();
    expect(universalProps.onManageUniversalProviders).toBeUndefined();

    rerender(
      <AddProviderDialog
        open
        onOpenChange={vi.fn()}
        appId="claude"
        onSubmit={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(universalProps.onUniversalPresetSelect).toBeTypeOf("function"),
    );
    expect(universalProps.onManageUniversalProviders).toBeTypeOf("function");
  });
});
