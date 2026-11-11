import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacyFilterConfigPanel } from "@/components/settings/PrivacyFilterConfigPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { toastError, api } = vi.hoisted(() => ({
  toastError: vi.fn(),
  api: {
    getPrivacyFilterConfig: vi.fn(),
    setPrivacyFilterConfig: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/api/settings", () => ({ settingsApi: api }));

const key = (name: string) => `settings.advanced.privacyFilter.${name}`;

describe("PrivacyFilterConfigPanel", () => {
  beforeEach(() => {
    toastError.mockReset();
    api.getPrivacyFilterConfig
      .mockReset()
      .mockResolvedValue({ enabled: false, filterToolResults: false });
    api.setPrivacyFilterConfig.mockReset().mockResolvedValue(true);
  });

  it("默认关闭，工具结果子开关在总开关打开前不可用", async () => {
    render(<PrivacyFilterConfigPanel />);
    const main = await screen.findByRole("switch", { name: key("enabled") });
    const tools = screen.getByRole("switch", {
      name: key("filterToolResults"),
    });
    expect(main).not.toBeChecked();
    expect(tools).toBeDisabled();

    fireEvent.click(main);
    await waitFor(() =>
      expect(api.setPrivacyFilterConfig).toHaveBeenCalledWith({
        enabled: true,
        filterToolResults: false,
      }),
    );
    expect(tools).toBeEnabled();
    fireEvent.click(tools);
    await waitFor(() =>
      expect(api.setPrivacyFilterConfig).toHaveBeenLastCalledWith({
        enabled: true,
        filterToolResults: true,
      }),
    );
  });

  it("保存失败时提示并回到原来的状态", async () => {
    api.setPrivacyFilterConfig.mockRejectedValue(new Error("disk full"));
    render(<PrivacyFilterConfigPanel />);
    const main = await screen.findByRole("switch", { name: key("enabled") });
    fireEvent.click(main);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(main).not.toBeChecked();
  });
});
