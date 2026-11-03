import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepLinkImportDialog } from "@/components/deeplink/DeepLinkImportDialog";
import { encodeBase64Utf8 } from "@/lib/utils/base64";

const importFromDeepLinkMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/deeplink/importer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/deeplink/importer")>();
  return { ...actual, importFromDeepLink: importFromDeepLinkMock };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const renderDialog = () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <DeepLinkImportDialog />
    </QueryClientProvider>,
  );
  return { invalidate };
};

const openLink = async (deeplink: string) => {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("cc-switch-open-deeplink-import", {
        detail: { deeplink },
      }),
    );
  });
};

const providerLink = (app: string, extra = "") =>
  `ccswitch://v1/import?resource=provider&app=${app}&name=Test&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-test&model=m${extra}`;

const switchById = (id: string) =>
  document.getElementById(id) as HTMLButtonElement;

describe("DeepLinkImportDialog", () => {
  beforeEach(() => {
    importFromDeepLinkMock.mockReset();
  });

  it("展示遮蔽后的 usage token 和 user id", async () => {
    renderDialog();

    await openLink(
      "ccswitch://v1/import?resource=provider&app=claude&name=Test&usageAccessToken=secret-token&usageUserId=user-42",
    );

    expect(await screen.findByText("secret-t************")).toBeInTheDocument();
    expect(screen.getByText("user-42")).toBeInTheDocument();
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
  });

  it("切换式应用的开关按链接的 enabled 初始化，打开时提示会立即切换", async () => {
    renderDialog();
    await openLink(providerLink("claude"));
    expect(switchById("deeplink-activate-after-import")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.queryByText("deeplink.providerEnabledWarning"),
    ).not.toBeInTheDocument();

    await openLink(providerLink("claude", "&enabled=true"));
    expect(switchById("deeplink-activate-after-import")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByText("deeplink.providerEnabledWarning"),
    ).toBeInTheDocument();
  });

  it("累加式应用默认打开「添加到应用」，导入时以开关为准", async () => {
    importFromDeepLinkMock.mockResolvedValue({ type: "provider", id: "x" });
    renderDialog();
    await openLink(providerLink("opencode"));
    expect(
      screen.getByText("deeplink.addToAppAfterImport"),
    ).toBeInTheDocument();
    const toggle = switchById("deeplink-activate-after-import");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    await act(async () => {
      fireEvent.click(screen.getByText("deeplink.import"));
    });
    expect(importFromDeepLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ app: "opencode", enabled: false }),
    );
  });

  it("OpenCode 导入后刷新 live 状态和运行时模型", async () => {
    importFromDeepLinkMock.mockResolvedValue({ type: "provider", id: "x" });
    const { invalidate } = renderDialog();
    await openLink(providerLink("opencode"));
    await act(async () => {
      fireEvent.click(screen.getByText("deeplink.import"));
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["opencodeLiveProviderIds"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["opencode", "runtime-models"],
    });
  });

  it("用量徽章与导入逻辑一致：带脚本或套餐地址默认启用", async () => {
    renderDialog();
    const script = encodeURIComponent(encodeBase64Utf8("({})"));
    await openLink(providerLink("claude", `&usageScript=${script}`));
    expect(screen.getByText("deeplink.usageScriptEnabled")).toBeInTheDocument();

    await openLink(
      providerLink("claude", `&usageScript=${script}&usageEnabled=false`),
    );
    expect(
      screen.getByText("deeplink.usageScriptDisabled"),
    ).toBeInTheDocument();

    await openLink(
      "ccswitch://v1/import?resource=provider&app=claude&name=Kimi&endpoint=https%3A%2F%2Fapi.kimi.com%2Fcoding%2F&apiKey=sk",
    );
    expect(
      screen.getByText(
        "deeplink.usageScriptEnabled · deeplink.usageCodingPlan",
      ),
    ).toBeInTheDocument();
  });

  it("提示词的启用开关决定导入后是否启用", async () => {
    importFromDeepLinkMock.mockResolvedValue({ type: "prompt", id: "p" });
    renderDialog();
    const content = encodeURIComponent(encodeBase64Utf8("# hi"));
    await openLink(
      `ccswitch://v1/import?resource=prompt&app=claude&name=P&content=${content}`,
    );
    const toggle = switchById("deeplink-prompt-enable-after-import");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByText("deeplink.prompt.enabledWarning"),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("deeplink.import"));
    });
    expect(importFromDeepLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "prompt", enabled: true }),
    );
  });

  it("导入完成时不关掉期间新到链接的确认框", async () => {
    let finishFirst: (value: unknown) => void = () => {};
    importFromDeepLinkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    renderDialog();
    await openLink(providerLink("claude", "").replace("name=Test", "name=A"));
    await act(async () => {
      fireEvent.click(screen.getByText("deeplink.import"));
    });

    // A 还在导入时来了 B
    await openLink(providerLink("claude", "").replace("name=Test", "name=B"));
    await act(async () => {
      finishFirst({ type: "provider", id: "a" });
    });
    // B 的确认框还在
    expect(screen.getByText("B")).toBeInTheDocument();

    importFromDeepLinkMock.mockResolvedValueOnce({ type: "provider", id: "b" });
    await act(async () => {
      fireEvent.click(screen.getByText("deeplink.import"));
    });
    expect(importFromDeepLinkMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "B" }),
    );
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });

  it("configUrl 链接在解析阶段报错", async () => {
    renderDialog();
    await openLink(
      providerLink("claude", "&configUrl=https%3A%2F%2Fexample.com%2Fc.json"),
    );
    expect(screen.getByText(/暂不支持 configUrl/)).toBeInTheDocument();
    expect(screen.queryByText("deeplink.providerName")).not.toBeInTheDocument();
  });
});
