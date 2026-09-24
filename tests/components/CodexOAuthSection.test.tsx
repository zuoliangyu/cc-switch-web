import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexOAuthSection } from "@/components/providers/forms/CodexOAuthSection";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";

const mocks = vi.hoisted(() => ({
  useManagedAuth: vi.fn(),
  renderAccountQuota: vi.fn(),
  addAccount: vi.fn(),
  reauthAccount: vi.fn(),
  retryAuth: vi.fn(),
}));

vi.mock("@/components/providers/forms/hooks/useManagedAuth", () => ({
  useManagedAuth: mocks.useManagedAuth,
}));

vi.mock("@/components/CodexOauthAccountQuota", () => ({
  default: ({ accountId }: { accountId: string }) => {
    mocks.renderAccountQuota(accountId);
    return <div data-testid="account-quota">{accountId}</div>;
  },
}));

vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => <div />,
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => <div />,
}));

describe("CodexOAuthSection", () => {
  beforeEach(() => {
    mocks.addAccount.mockReset();
    mocks.reauthAccount.mockReset();
    mocks.retryAuth.mockReset();
    mocks.useManagedAuth.mockReturnValue({
      accounts: [{ id: "account-1", login: "user@example.com" }],
      defaultAccountId: "account-1",
      hasAnyAccount: true,
      pollingState: "idle",
      deviceCode: null,
      error: null,
      isPolling: false,
      isAddingAccount: false,
      isRemovingAccount: false,
      isSettingDefaultAccount: false,
      addAccount: mocks.addAccount,
      reauthAccount: mocks.reauthAccount,
      retryAuth: mocks.retryAuth,
      removeAccount: vi.fn(),
      setDefaultAccount: vi.fn(),
      cancelAuth: vi.fn(),
      logout: vi.fn(),
    });
  });

  it("普通 Provider 表单不查询账号额度", () => {
    render(<CodexOAuthSection />);
    expect(screen.queryByTestId("account-quota")).not.toBeInTheDocument();
  });

  it("认证中心展示每个账号的额度", () => {
    render(<AuthCenterPanel />);
    expect(mocks.renderAccountQuota).toHaveBeenCalledWith("account-1");
    expect(screen.getByTestId("account-quota")).toHaveTextContent("account-1");
  });

  it("旧账号提示重新登录且不能继续选择", () => {
    mocks.useManagedAuth.mockReturnValue({
      ...mocks.useManagedAuth(),
      accounts: [
        {
          id: "legacy-account",
          login: "legacy@example.com",
          reauth_required: true,
        },
      ],
      defaultAccountId: null,
    });

    render(<CodexOAuthSection selectedAccountId="legacy-account" />);

    expect(screen.getAllByText("需要重新登录").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /重新登录/ }));
    expect(mocks.reauthAccount).toHaveBeenCalledWith("legacy-account");
    expect(mocks.addAccount).not.toHaveBeenCalled();
  });

  it("已有正常账号也可原地重新登录", () => {
    render(<CodexOAuthSection />);

    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));

    expect(mocks.reauthAccount).toHaveBeenCalledWith("account-1");
    expect(mocks.addAccount).not.toHaveBeenCalled();
  });

  it("登录失败后重试沿用原目标账号", () => {
    mocks.useManagedAuth.mockReturnValue({
      ...mocks.useManagedAuth(),
      pollingState: "error",
      error: "start failed",
    });

    render(<CodexOAuthSection />);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(mocks.retryAuth).toHaveBeenCalledTimes(1);
    expect(mocks.addAccount).not.toHaveBeenCalled();
  });
});
