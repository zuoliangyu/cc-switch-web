import { invoke } from "@/lib/runtime/client/core";
import type { AppId } from "@/lib/api/types";
import type { UsageScript } from "@/types";

/** Oh My Pi 是 Pi 的分支，供应商状态和用量脚本走同一套命令 */
export type PiFamilyAppId = Extract<AppId, "pi" | "omp">;

export interface PiCurrentState {
  enabledProviderIds: string[];
  defaultProviderId: string | null;
}

export type PiPromptFileKind = "system_override" | "system_append";

export interface PiPromptFileSnapshot {
  exists: boolean;
  revision: string;
  content: string;
}

export interface PiPromptTemplate {
  slug: string;
  content: string;
  revision: string;
}

export type PiSessionDiscovery =
  | { status: "available" }
  | { status: "requires_project_context"; configuredPath: string }
  | { status: "unavailable"; reason: string };

export const piApi = {
  getCurrentState: (app: PiFamilyAppId = "pi") =>
    invoke<PiCurrentState>(`get_${app}_current_state`),
  updateProviderUsageScript: (
    id: string,
    usageScript: UsageScript,
    app: PiFamilyAppId = "pi",
  ) =>
    invoke<boolean>("update_pi_provider_usage_script", {
      app,
      id,
      usageScript,
    }),
  getPromptFile: (kind: PiPromptFileKind) =>
    invoke<PiPromptFileSnapshot>("get_pi_prompt_file", { kind }),
  savePromptFile: (
    kind: PiPromptFileKind,
    expectedRevision: string,
    content: string,
  ) =>
    invoke<PiPromptFileSnapshot>("save_pi_prompt_file", {
      kind,
      expectedRevision,
      content,
    }),
  deletePromptFile: (kind: PiPromptFileKind, expectedRevision: string) =>
    invoke<boolean>("delete_pi_prompt_file", { kind, expectedRevision }),
  listPromptTemplates: () =>
    invoke<PiPromptTemplate[]>("list_pi_prompt_templates"),
  savePromptTemplate: (
    slug: string,
    originalSlug: string | undefined,
    expectedRevision: string,
    content: string,
  ) =>
    invoke<PiPromptTemplate>("save_pi_prompt_template", {
      slug,
      originalSlug,
      expectedRevision,
      content,
    }),
  deletePromptTemplate: (slug: string, expectedRevision: string) =>
    invoke<boolean>("delete_pi_prompt_template", {
      slug,
      expectedRevision,
    }),
  getSessionDiscovery: () =>
    invoke<PiSessionDiscovery>("get_pi_session_discovery"),
};
