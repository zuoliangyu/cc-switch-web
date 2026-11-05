import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebSidebar } from "@/components/shell/WebSidebar";
import type { VisibleApps } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (options?.defaultValue as string) ?? key,
  }),
}));

const visibleApps = { claude: true, codex: true } as unknown as VisibleApps;

function renderSidebar(settingsHasUpdate?: boolean) {
  const onView = vi.fn();
  render(
    <WebSidebar
      activeApp="claude"
      currentView="providers"
      visibleApps={visibleApps}
      settingsHasUpdate={settingsHasUpdate}
      onApp={vi.fn()}
      onView={onView}
    />,
  );
  return onView;
}

describe("WebSidebar update dot", () => {
  it("marks the settings entry when a new CC Switch Web version is available", () => {
    const onView = renderSidebar(true);
    const settings = screen.getByRole("button", {
      name: "nav.settingsHasUpdate",
    });
    expect(screen.getByTestId("sidebar-dot-settings")).toBeInTheDocument();
    fireEvent.click(settings);
    expect(onView).toHaveBeenCalledWith("settings");
  });

  it("shows no dot without an update", () => {
    renderSidebar(false);
    expect(
      screen.getByRole("button", { name: "settings.title" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-dot-settings")).toBeNull();
  });
});
