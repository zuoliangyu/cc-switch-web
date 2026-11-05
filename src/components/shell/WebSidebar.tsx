import { SkillsIcon } from "@/components/BrandIcons";
import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart2,
  Book,
  History,
  KeyRound,
  LayoutGrid,
  Menu,
  Network,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { orderAppIds } from "@/config/appConfig";
import { APP_DISPLAY_NAME, AppGlyph } from "./AppGlyph";
import { cn } from "@/lib/utils";

export type GlobalView =
  | "providers"
  | "mcp"
  | "skills"
  | "prompts"
  | "universal"
  | "sessions"
  | "usage"
  | "accounts"
  | "apps"
  | "settings";

/** Expansion is local to the sidebar. The page keeps a fixed rail, so toggling never reflows the reader/editor. */
export const WebSidebar = memo(function WebSidebar({
  activeApp,
  currentView,
  visibleApps,
  appOrder,
  onApp,
  onView,
}: {
  activeApp: AppId;
  currentView: string;
  visibleApps: VisibleApps;
  /** 应用页拖出来的顺序（`settings.appOrder`） */
  appOrder?: readonly string[];
  onApp: (app: AppId) => void;
  onView: (view: GlobalView) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("cc-switch-web-sidebar-expanded") === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () =>
    setExpanded((value) => {
      localStorage.setItem("cc-switch-web-sidebar-expanded", String(!value));
      return !value;
    });
  const selectView = (view: GlobalView) => {
    onView(view);
    setMobileOpen(false);
  };
  const item = (id: GlobalView, label: string, icon: ReactNode) => (
    <button
      key={id}
      type="button"
      aria-label={label}
      title={!expanded ? label : undefined}
      aria-current={currentView === id ? "page" : undefined}
      onClick={() => selectView(id)}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        currentView === id && "bg-accent font-medium",
      )}
    >
      {icon}
      <span
        className={cn(
          "whitespace-nowrap",
          !expanded && !mobileOpen && "sr-only",
        )}
      >
        {label}
      </span>
    </button>
  );
  return (
    <>
      <button
        type="button"
        aria-label={t("nav.menu", { defaultValue: "导航菜单" })}
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-5 left-3 z-[65] rounded-full border bg-card p-3 shadow-md md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && (
        <button
          aria-label={t("common.close")}
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-[64] bg-black/30 md:hidden"
        />
      )}
      <aside
        aria-label={t("nav.menu", { defaultValue: "导航菜单" })}
        data-web-sidebar
        className={cn(
          "fixed inset-y-0 left-0 z-[65] flex flex-col border-r border-border bg-card/95 p-2 backdrop-blur-md",
          expanded || mobileOpen ? "w-56 shadow-lg" : "w-14",
          !mobileOpen && "max-md:hidden",
        )}
      >
        <button
          type="button"
          onClick={mobileOpen ? () => setMobileOpen(false) : toggle}
          aria-label={t(
            expanded ? "nav.collapseSidebar" : "nav.expandSidebar",
            { defaultValue: expanded ? "收起侧栏" : "展开侧栏" },
          )}
          className="mb-2 flex h-10 shrink-0 items-center gap-3 rounded-md px-2 hover:bg-accent"
        >
          <PanelLeftClose className="h-5 w-5 shrink-0" />
          <span
            className={cn(
              "font-semibold",
              !expanded && !mobileOpen && "sr-only",
            )}
          >
            CC Switch Web
          </span>
        </button>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {item("mcp", "MCP", <Network className="h-4 w-4 shrink-0" />)}
          {item(
            "skills",
            "Skills",
            <SkillsIcon className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "prompts",
            t("nav.prompts"),
            <Book className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "universal",
            t("universalProvider.title"),
            <Network className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "sessions",
            t("nav.sessions"),
            <History className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "usage",
            t("nav.usage"),
            <BarChart2 className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "accounts",
            t("settings.authCenter.title"),
            <KeyRound className="h-4 w-4 shrink-0" />,
          )}
          <div className="my-2 border-t border-border" />
          {orderAppIds(appOrder)
            .filter((app) => visibleApps[app])
            .map((app) => (
              <button
                key={app}
                type="button"
                aria-label={APP_DISPLAY_NAME[app]}
                title={!expanded ? APP_DISPLAY_NAME[app] : undefined}
                aria-current={
                  activeApp === app && currentView === "providers"
                    ? "page"
                    : undefined
                }
                onClick={() => {
                  onApp(app);
                  setMobileOpen(false);
                }}
                className={cn(
                  "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm hover:bg-accent",
                  activeApp === app &&
                    currentView === "providers" &&
                    "bg-accent font-medium",
                )}
              >
                <AppGlyph
                  app={app}
                  className={activeApp !== app ? "grayscale opacity-60" : ""}
                />
                <span
                  className={cn(
                    "whitespace-nowrap",
                    !expanded && !mobileOpen && "sr-only",
                  )}
                >
                  {APP_DISPLAY_NAME[app]}
                </span>
              </button>
            ))}
        </nav>
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {item(
            "apps",
            t("nav.apps"),
            <LayoutGrid className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "settings",
            t("settings.title"),
            <Settings className="h-4 w-4 shrink-0" />,
          )}
        </div>
      </aside>
    </>
  );
});
