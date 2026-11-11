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
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
  "kimi",
  "dsh",
  "agy",
  "omp",
  "copilot",
];

/** Claude Desktop、OpenClaw 不由 CC Switch 管理 MCP；Pi 1.0 起内置 MCP（`~/.pi/agent/mcp.json`） */
export const MCP_APP_IDS = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "hermes",
  "pi",
  "mcode",
  "kimi",
  "dsh",
  "agy",
  "omp",
  "copilot",
] as const satisfies readonly AppId[];
export type McpAppId = (typeof MCP_APP_IDS)[number];

export function isMcpAppId(appId: string): appId is McpAppId {
  return (MCP_APP_IDS as readonly string[]).includes(appId);
}

export const SKILLS_APP_IDS = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "hermes",
  "mcode",
  "kimi",
  "dsh",
  "agy",
  "pi",
  "omp",
  "copilot",
] as const satisfies readonly AppId[];

export function getAppLabel(appId: string): string {
  return APP_ICON_MAP[appId as AppId]?.label ?? appId;
}

export const APP_ICON_MAP: Record<AppId, AppConfig> = {
  claude: {
    label: "Claude",
    icon: <ClaudeIcon size={14} />,
    activeClass: "theme-chip-warm",
    badgeClass: "theme-chip-warm border-0 gap-1.5",
  },
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
  grokbuild: {
    label: "Grok Build",
    icon: (
      <ProviderIcon
        icon="grok"
        name="Grok Build"
        size={14}
        showFallback={false}
      />
    ),
    activeClass: "theme-chip-tertiary",
    badgeClass: "theme-chip-tertiary border-0 gap-1.5",
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
  mcode: {
    label: "MiniMax Code",
    icon: <ProviderIcon icon="minimax" name="MiniMax Code" size={14} />,
    activeClass: "theme-chip-warning",
    badgeClass: "theme-chip-warning border-0 gap-1.5",
  },
  pi: {
    label: "Pi",
    icon: <ProviderIcon icon="pi" name="Pi" size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
  agy: {
    label: "Antigravity",
    icon: <ProviderIcon icon="antigravity" name="Antigravity" size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
  dsh: {
    label: "DeepSeek Harness",
    icon: <ProviderIcon icon="deepseek" name="DeepSeek Harness" size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
  kimi: {
    label: "Kimi Code",
    icon: <ProviderIcon icon="kimi" name="Kimi Code" size={14} />,
    activeClass: "theme-chip-primary",
    badgeClass: "theme-chip-primary border-0 gap-1.5",
  },
  omp: {
    label: "Oh My Pi",
    icon: (
      <ProviderIcon icon="omp" name="Oh My Pi" size={14} showFallback={false} />
    ),
    activeClass: "theme-chip-tertiary",
    badgeClass: "theme-chip-tertiary border-0 gap-1.5",
  },
  copilot: {
    label: "Copilot CLI",
    icon: (
      <ProviderIcon
        icon="githubcopilot"
        name="GitHub Copilot CLI"
        size={14}
        showFallback={false}
      />
    ),
    activeClass: "theme-chip-neutral",
    badgeClass: "theme-chip-neutral border-0 gap-1.5",
  },
};

export const DEFAULT_VISIBLE_APPS: import("@/types").VisibleApps = { claude: true, "claude-desktop": true, codex: true, gemini: true, grokbuild: true, opencode: true, openclaw: true, hermes: true, pi: true, mcode: true, kimi: true, dsh: true, agy: true, omp: true, copilot: true };

/**
 * 应用页和侧栏的应用顺序：先按用户拖出来的顺序（`settings.appOrder`，不认识的 ID 忽略），
 * 没在里面的应用（比如新版本加的）插回默认顺序里它前一个应用的后面。
 */
export function orderAppIds(saved: readonly string[] | undefined): AppId[] {
  if (!saved?.length) return [...APP_IDS];
  const known = new Set<string>(APP_IDS);
  const ordered: AppId[] = [];
  for (const id of saved) {
    if (known.has(id) && !ordered.includes(id as AppId)) {
      ordered.push(id as AppId);
    }
  }
  APP_IDS.forEach((app, index) => {
    if (ordered.includes(app)) return;
    const previous = APP_IDS.slice(0, index)
      .reverse()
      .find((id) => ordered.includes(id));
    ordered.splice(previous ? ordered.indexOf(previous) + 1 : 0, 0, app);
  });
  return ordered;
}

/** Oh My Pi 是 Pi 的分支：供应商表单、启用状态和用量脚本命令与 Pi 共用。 */
export type PiFamilyAppId = Extract<AppId, "pi" | "omp">;
export const PI_FAMILY_APP_IDS: PiFamilyAppId[] = ["pi", "omp"];

export function isPiFamilyApp(appId: string): appId is PiFamilyAppId {
  return (PI_FAMILY_APP_IDS as string[]).includes(appId);
}

/** 用 Gemini 那套表单（env + settings.json）的应用：Antigravity 的卡与 Gemini 同形 */
export function usesGeminiStyleForm(appId: string): boolean {
  return appId === "gemini" || appId === "agy";
}
