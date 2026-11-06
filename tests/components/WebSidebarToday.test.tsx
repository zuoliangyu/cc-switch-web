import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSidebar } from "@/components/shell/WebSidebar";
import type { Settings, VisibleApps } from "@/types";
import { createTestQueryClient } from "../utils/testQueryClient";

// 上游 tests/components/shell/SidebarToday.test.tsx 按 Web 侧栏改写：
// Web 侧栏默认收起，行尾小字只在展开时显示；完整说法走原生 title 而不是悬停卡片
const status = vi.hoisted(() => ({
  todayCost: 47.2,
  todayTokens: 120_400_000,
  todayRequests: 663,
  todayHitRate: 0.986,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: string; defaultValue?: string }) =>
      options?.value != null
        ? `${key}:${options.value}`
        : (options?.defaultValue ?? key),
    i18n: { resolvedLanguage: "en" },
  }),
}));

vi.mock("@/hooks/useSidebarStatus", () => ({
  useSidebarStatus: () => ({
    todayCost: status.todayCost,
    todayTokens: status.todayTokens,
    todayRequests: status.todayRequests,
    todayHitRate: status.todayHitRate,
  }),
}));

const renderSidebar = (settings: Partial<Settings>) => {
  const client = createTestQueryClient();
  // 不让设置查询回头去 mock 后端重取，盖掉这里给的值
  client.setQueryDefaults(["settings"], { staleTime: Infinity });
  client.setQueryData(["settings"], settings);
  render(
    <QueryClientProvider client={client}>
      <WebSidebar
        activeApp="claude"
        currentView="usage"
        visibleApps={{} as VisibleApps}
        onApp={vi.fn()}
        onView={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

describe("sidebar Today label", () => {
  beforeEach(() => {
    localStorage.setItem("cc-switch-web-sidebar-expanded", "true");
  });
  afterEach(() => {
    localStorage.removeItem("cc-switch-web-sidebar-expanded");
  });

  it.each([
    [undefined, "nav.today:$47.20"],
    [["tokens"], "nav.today:120M"],
    [["requests"], "nav.today:nav.todayRequests:663"],
    [["hitRate"], "nav.today:nav.todayHitRate:98.6%"],
  ])("shows %s", (items, label) => {
    status.todayCost = 47.2;
    status.todayTokens = 120_400_000;
    status.todayRequests = 663;
    renderSidebar({ usageDisplay: { sidebarTodayItems: items } });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `nav.usage · ${label}` }),
    ).toBeInTheDocument();
  });

  it("stacks only the numbers when showing two items", () => {
    // 带上「今日」一行放不下长币种；完整说法在读屏名字和悬停标题里
    status.todayCost = 47.2;
    status.todayTokens = 120_400_000;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["cost", "tokens"] } });
    expect(screen.getByText("$47.20")).toBeInTheDocument();
    expect(screen.getByText("120M")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: "nav.usage · nav.today:$47.20 · 120M",
    });
    expect(button).toHaveAttribute(
      "title",
      "nav.usage · nav.today:$47.20 · 120M",
    );
  });

  it("puts the label only into the name while the sidebar is collapsed", () => {
    localStorage.setItem("cc-switch-web-sidebar-expanded", "false");
    status.todayCost = 47.2;
    renderSidebar({});
    expect(screen.queryByText("nav.today:$47.20")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "nav.usage · nav.today:$47.20" }),
    ).toBeInTheDocument();
  });

  it("shows nothing when hidden", () => {
    renderSidebar({ usageDisplay: { sidebarTodayItems: [] } });
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });

  it("skips the parts that are zero", () => {
    // 没配定价时金额是 0：金额 + Token 只剩 Token，只勾金额就整个不显示
    status.todayCost = 0;
    status.todayTokens = 5_000;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["cost", "tokens"] } });
    expect(screen.getByText("nav.today:5,000")).toBeInTheDocument();
  });

  it("leaves out the hit rate before the first request of the day", () => {
    status.todayRequests = 0;
    status.todayTokens = 0;
    status.todayCost = 0;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["hitRate"] } });
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });

  it("hides the cost-only label while nothing is priced", () => {
    status.todayCost = 0;
    status.todayTokens = 5_000;
    renderSidebar({});
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });
});
