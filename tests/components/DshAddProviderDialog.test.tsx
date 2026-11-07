import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { dshApi, type DshAccountStatus } from "@/lib/api/dsh";
import { createTestQueryClient } from "../utils/testQueryClient";

vi.mock("@/lib/api/dsh", () => ({
  dshApi: {
    accountStatus: vi.fn(),
    accountSignOut: vi.fn(),
    loginStart: vi.fn(),
    loginPoll: vi.fn(),
    loginCancel: vi.fn(),
  },
}));
vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/CodexOAuthSection", () => ({
  CodexOAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => null,
}));
vi.mock("@/components/providers/forms/AgyOAuthSection", () => ({
  AgyOAuthSection: () => null,
  useAgyAccountSupported: () => false,
}));
vi.mock("@/components/providers/forms/ClaudeOfficialSection", () => ({
  ClaudeOfficialSection: () => null,
}));
vi.mock("@/components/providers/KimiAccountLogin", () => ({
  KimiAccountLogin: () => null,
}));
vi.mock("@/components/JsonEditor", () => ({
  default: () => null,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

const signedOut: DshAccountStatus = {
  signedIn: false,
  expired: false,
  issuer: null,
  profile: null,
  wallets: [],
  bonusWallets: [],
  usageUrl: null,
  topUpUrl: null,
  error: null,
};

// Web 的预设按钮带图标（无障碍名里多出图标名）：按按钮里的名称那一格找
async function selectAccountPreset() {
  const preset = await waitFor(() => {
    const button = screen
      .getAllByRole("button")
      .find(
        (candidate) =>
          candidate.querySelector("span.truncate")?.textContent?.trim() ===
          "dsh.account.presetName",
      );
    if (!button) throw new Error("DeepSeek account preset not found");
    return button;
  });
  fireEvent.click(preset);
}

describe("DeepSeek account entry in the DeepSeek Harness add-provider dialog", () => {
  beforeEach(() => {
    vi.mocked(dshApi.accountStatus).mockResolvedValue(signedOut);
  });

  it("directs official sign-in to Auth Center without provider fields or an add footer", async () => {
    const onSubmit = vi.fn();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AddProviderDialog
          open
          appId="dsh"
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </QueryClientProvider>,
    );

    await selectAccountPreset();
    const manage = await screen.findByRole("button", {
      name: "dsh.account.manageAccounts",
    });
    expect(
      screen.queryByRole("button", { name: "common.add" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^API Key/)).not.toBeInTheDocument();

    fireEvent.click(manage);
    const group = await screen.findByRole("region", {
      name: "DeepSeek Harness",
    });
    expect(
      await within(group).findByRole("button", { name: "添加账号" }),
    ).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
