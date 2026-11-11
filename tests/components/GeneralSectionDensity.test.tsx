import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSection } from "@/components/settings/sections/GeneralSection";
import { setDensity } from "@/lib/interfacePrefs";
import type { SettingsFormState } from "@/hooks/useSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("@/components/settings/ThemeSettings", () => ({
  ThemePaletteControl: () => null,
}));
vi.mock("@/components/settings/TerminalSettings", () => ({
  TerminalSelect: () => null,
}));
vi.mock("@/components/usage/ModelTestConfigPanel", () => ({
  ModelTestConfigPanel: () => null,
}));

describe("GeneralSection interface density", () => {
  afterEach(() => {
    setDensity("compact");
    localStorage.clear();
  });

  it("switches density from the appearance block and remembers it", async () => {
    render(
      <GeneralSection
        settings={{ language: "zh" } as SettingsFormState}
        onAutoSave={vi.fn().mockResolvedValue(true)}
        onOpenApps={vi.fn()}
      />,
    );

    const group = screen.getByRole("group", {
      name: "settings.general.density",
    });
    const compact = screen.getByRole("button", {
      name: "settings.general.densityCompact",
    });
    const comfortable = screen.getByRole("button", {
      name: "settings.general.densityComfortable",
    });
    expect(group).toContainElement(comfortable);
    expect(compact).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(comfortable);

    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(localStorage.getItem("cc-switch-density")).toBe("comfortable");
    expect(comfortable).toHaveAttribute("aria-pressed", "true");
    // Web 用浏览器自带的缩放，不另设缩放档位
    expect(screen.queryByText("settings.general.zoom")).not.toBeInTheDocument();
  });
});
