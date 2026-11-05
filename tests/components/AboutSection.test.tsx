import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutSection } from "@/components/settings/AboutSection";

const { getToolVersions, copy } = vi.hoisted(() => ({
  getToolVersions: vi.fn().mockResolvedValue([
    {
      name: "mcode",
      version: "1.2.3",
      latest_version: "1.2.4",
      error: null,
      env_type: "linux",
      wsl_distro: null,
    },
  ]),
  copy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/platform", () => ({ isWindows: () => false }));
vi.mock("@/lib/runtime/client/app", () => ({
  getVersion: async () => "2.2.0",
}));
vi.mock("@/lib/api", () => ({
  settingsApi: { getToolVersions, openExternal: vi.fn() },
}));
vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({
    hasUpdate: false,
    latestRelease: null,
    updateInfo: null,
    isChecking: false,
    checkUpdate: vi.fn(),
  }),
}));

describe("AboutSection tool detection", () => {
  it("requests and displays the MiniMax Code version", async () => {
    render(<AboutSection />);
    await waitFor(() =>
      expect(getToolVersions).toHaveBeenCalledWith(
        ["claude", "codex", "gemini", "mcode", "opencode"],
        {},
      ),
    );
    expect(await screen.findByText("MiniMax Code")).toBeInTheDocument();
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
  });

  it("copies MiniMax install instructions with required native dependency flags", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    render(<AboutSection />);
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy.mock.calls[0][0]).toContain(
      'npm i -g @minimax-ai/code@latest --ignore-scripts=false --include=optional "--allow-scripts=@minimax-ai/code,better-sqlite3"',
    );
  });
});

describe("AboutSection star prompt", () => {
  it("shows the star strip until dismissed, then restores the repository button", async () => {
    localStorage.removeItem("cc-switch-web:about:starPromptDismissed");
    const { unmount } = render(<AboutSection />);
    expect(screen.getByText("settings.starPrompt")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings\.starOnGithub/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /settings\.projectRepo/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.queryByText("settings.starPrompt")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings\.projectRepo/ }),
    ).toBeInTheDocument();
    expect(
      localStorage.getItem("cc-switch-web:about:starPromptDismissed"),
    ).toBe("1");

    // 关掉是本机偏好，重新打开仍保持关闭
    unmount();
    render(<AboutSection />);
    expect(screen.queryByText("settings.starPrompt")).not.toBeInTheDocument();
    localStorage.removeItem("cc-switch-web:about:starPromptDismissed");
  });
});
