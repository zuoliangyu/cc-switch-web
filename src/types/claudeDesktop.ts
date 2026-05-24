/**
 * Claude Desktop 3P 类型（对应后端 claude_desktop_config.rs，serde camelCase）
 */

export type ClaudeDesktopMode = "direct" | "proxy";

export interface ClaudeDesktopStatus {
  supported: boolean;
  configured: boolean;
  appliedId: string | null;
  profilePath: string | null;
  configLibraryPath: string | null;
  mode: ClaudeDesktopMode | null;
  expectedBaseUrl: string | null;
  actualBaseUrl: string | null;
  proxyRunning: boolean;
  staleRawModels: boolean;
  missingRouteMappings: boolean;
  gatewayTokenConfigured: boolean;
}

export interface ClaudeDesktopDefaultRoute {
  routeId: string;
  envKey: string;
  supports1m: boolean;
}

export const getDefaultClaudeDesktopStatus = (): ClaudeDesktopStatus => ({
  supported: false,
  configured: false,
  appliedId: null,
  profilePath: null,
  configLibraryPath: null,
  mode: null,
  expectedBaseUrl: null,
  actualBaseUrl: null,
  proxyRunning: false,
  staleRawModels: false,
  missingRouteMappings: false,
  gatewayTokenConfigured: false,
});
