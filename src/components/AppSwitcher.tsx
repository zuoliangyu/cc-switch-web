import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps?: VisibleApps;
  compact?: boolean;
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
  compact,
}: AppSwitcherProps) {
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

      <div className="hidden bg-muted rounded-xl p-1 gap-1 md:inline-flex">
        {appsToShow.map((app) => (
          <button
            key={app}
            type="button"
            onClick={() => handleSwitch(app)}
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
            <span
              className={cn(
                "transition-all duration-200 whitespace-nowrap overflow-hidden",
                compact
                  ? "max-w-0 opacity-0 ml-0"
                  : "max-w-[80px] opacity-100 ml-2",
              )}
            >
              {appDisplayName[app]}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
