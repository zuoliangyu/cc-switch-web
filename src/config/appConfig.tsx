import React from "react";
import type { AppId } from "@/lib/api/types";
import {
  ClaudeIcon,
  CodexIcon,
  GeminiIcon,
  OpenClawIcon,
} from "@/components/BrandIcons";
import { ProviderIcon } from "@/components/ProviderIcon";

export interface AppConfig {
  label: string;
  icon: React.ReactNode;
  activeClass: string;
  badgeClass: string;
}

export const APP_IDS: AppId[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
];

/** App IDs shown in MCP & Skills panels (excludes OpenClaw) */
export const MCP_SKILLS_APP_IDS: AppId[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
];

export const APP_ICON_MAP: Record<AppId, AppConfig> = {
  claude: {
    label: "Claude",
    icon: <ClaudeIcon size={14} />,
    activeClass: "theme-chip-warm",
    badgeClass: "theme-chip-warm border-0 gap-1.5",
  },
  // C-Phase0 脚手架：claude-desktop 目标已建型，但未加入 APP_IDS（UI 暂不暴露）
  "claude-desktop": {
    label: "Claude Desktop",
    icon: <ClaudeIcon size={14} />,
    activeClass: "theme-chip-warm",
    badgeClass: "theme-chip-warm border-0 gap-1.5",
  },
  codex: {
    label: "Codex",
    icon: <CodexIcon size={14} />,
    activeClass: "theme-chip-success",
    badgeClass: "theme-chip-success border-0 gap-1.5",
  },
  gemini: {
    label: "Gemini",
    icon: <GeminiIcon size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
  opencode: {
    label: "OpenCode",
    icon: (
      <ProviderIcon
        icon="opencode"
        name="OpenCode"
        size={14}
        showFallback={false}
      />
    ),
    activeClass: "theme-chip-tertiary",
    badgeClass: "theme-chip-tertiary border-0 gap-1.5",
  },
  openclaw: {
    label: "OpenClaw",
    icon: <OpenClawIcon size={14} />,
    activeClass: "theme-chip-warning",
    badgeClass: "theme-chip-warning border-0 gap-1.5",
  },
  hermes: {
    label: "Hermes",
    icon: <ProviderIcon icon="hermes" name="Hermes" size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
};
