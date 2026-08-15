import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps?: VisibleApps;
}

const ALL_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
];
const STORAGE_KEY = "cc-switch-last-app";

export function AppSwitcher({
  activeApp,
  onSwitch,
  visibleApps,
}: AppSwitcherProps) {
  const { t } = useTranslation();
  const desktopRootRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const handleSwitch = (app: AppId) => {
    if (app === activeApp) return;
    localStorage.setItem(STORAGE_KEY, app);
    onSwitch(app);
  };
  const iconSize = 20;
  const appIconName: Record<AppId, string> = {
    claude: "claude",
    "claude-desktop": "claude",
    codex: "openai",
    gemini: "gemini",
    grokbuild: "grok",
    opencode: "opencode",
    openclaw: "openclaw",
    hermes: "hermes",
  };
  const appDisplayName: Record<AppId, string> = {
    claude: "Claude",
    "claude-desktop": "Claude Desktop",
    codex: "Codex",
    gemini: "Gemini",
    grokbuild: "Grok Build",
    opencode: "OpenCode",
    openclaw: "OpenClaw",
    hermes: "Hermes",
  };

  // Filter apps based on visibility settings (default all visible)
  const appsToShow = ALL_APPS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });
  const [visibleCount, setVisibleCount] = useState(appsToShow.length);

  useLayoutEffect(() => {
    const root = desktopRootRef.current;
    const slot = root?.parentElement;
    if (!root || !slot || typeof ResizeObserver === "undefined") return;

    const compute = () => {
      const sample = root.querySelector("button");
      if (!sample || sample.offsetWidth <= 0) return;
      const style = window.getComputedStyle(root);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
      const itemWidth = sample.offsetWidth;
      const count = appsToShow.length;
      const allWidth = padding + count * itemWidth + (count - 1) * gap;
      if (allWidth <= slot.clientWidth) {
        setVisibleCount(count);
        return;
      }
      const fit = Math.floor(
        (slot.clientWidth - padding - itemWidth) / (itemWidth + gap),
      );
      setVisibleCount(Math.max(1, Math.min(count - 1, fit)));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [appsToShow.length]);

  const visibleList = appsToShow.slice(0, Math.max(1, visibleCount));
  if (appsToShow.includes(activeApp) && !visibleList.includes(activeApp)) {
    visibleList[visibleList.length - 1] = activeApp;
  }
  const overflowList = appsToShow.filter((app) => !visibleList.includes(app));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted px-2 md:hidden"
            aria-label={appDisplayName[activeApp]}
            title={appDisplayName[activeApp]}
          >
            <ProviderIcon
              icon={appIconName[activeApp]}
              name={appDisplayName[activeApp]}
              size={iconSize}
            />
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 md:hidden">
          <DropdownMenuRadioGroup
            value={activeApp}
            onValueChange={(app) => handleSwitch(app as AppId)}
          >
            {appsToShow.map((app) => (
              <DropdownMenuRadioItem key={app} value={app}>
                <ProviderIcon
                  icon={appIconName[app]}
                  name={appDisplayName[app]}
                  size={iconSize}
                />
                {appDisplayName[app]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div
        ref={desktopRootRef}
        className="hidden bg-muted rounded-xl p-1 gap-1 md:inline-flex"
      >
        {visibleList.map((app) => (
          <button
            key={app}
            type="button"
            onClick={() => handleSwitch(app)}
            title={appDisplayName[app]}
            aria-label={appDisplayName[app]}
            className={cn(
              "group inline-flex items-center px-3 h-8 rounded-md text-sm font-medium transition-all duration-200",
              activeApp === app
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            <ProviderIcon
              icon={appIconName[app]}
              name={appDisplayName[app]}
              size={iconSize}
            />
          </button>
        ))}
        {overflowList.length > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={t("appSwitcher.more")}
                aria-label={t("appSwitcher.more")}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-3 transition-all duration-200",
                  moreOpen
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                )}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-52 p-1">
              {overflowList.map((app) => (
                <button
                  key={app}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    handleSwitch(app);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ProviderIcon
                    icon={appIconName[app]}
                    name={appDisplayName[app]}
                    size={iconSize}
                  />
                  <span className="truncate">{appDisplayName[app]}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </>
  );
}
