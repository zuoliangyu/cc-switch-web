import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessKeyGate } from "@/components/AccessKeyGate";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getKey: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/lib/runtime/client/web", () => ({
  WEB_AUTH_REQUIRED_EVENT: "cc-switch-web-auth-required",
  getWebAuthStatus: mocks.getStatus,
  getWebAccessKey: mocks.getKey,
  verifyWebAccessKey: mocks.verify,
}));

describe("Web 访问密钥登录", () => {
  beforeEach(() => {
    mocks.getStatus.mockReset();
    mocks.getKey.mockReset();
    mocks.verify.mockReset();
  });

  it("服务端要求认证时仅在有效密钥验证后显示应用", async () => {
    mocks.getStatus.mockResolvedValue({ required: true });
    mocks.getKey.mockReturnValue(null);
    mocks.verify.mockResolvedValue(undefined);

    render(
      <AccessKeyGate>
        <div>protected application</div>
      </AccessKeyGate>,
    );

    const input = await screen.findByLabelText("访问密钥");
    expect(screen.queryByText("protected application")).not.toBeInTheDocument();

    await userEvent.type(input, "correct-access-key");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByText("protected application")).toBeInTheDocument();
    });
    expect(mocks.verify).toHaveBeenCalledWith("correct-access-key");
  });
});
