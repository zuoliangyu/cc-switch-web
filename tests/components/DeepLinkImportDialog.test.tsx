import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DeepLinkImportDialog } from "@/components/deeplink/DeepLinkImportDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("DeepLinkImportDialog", () => {
  it("展示遮蔽后的 usage token 和 user id", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeepLinkImportDialog />
      </QueryClientProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("cc-switch-open-deeplink-import", {
          detail: {
            deeplink:
              "ccswitch://v1/import?resource=provider&app=claude&name=Test&usageAccessToken=secret-token&usageUserId=user-42",
          },
        }),
      );
    });

    expect(await screen.findByText("secret-t************")).toBeInTheDocument();
    expect(screen.getByText("user-42")).toBeInTheDocument();
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
  });
});
