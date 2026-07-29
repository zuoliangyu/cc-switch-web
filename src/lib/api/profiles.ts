import { invoke } from "@/lib/runtime/client/core";

export type ProfileScope = "claude" | "claude-desktop" | "codex";

export interface PerApp<T> {
  claude: T;
  "claude-desktop": T;
  codex: T;
}

export interface ProfilePayload {
  providers: PerApp<string | null>;
  mcp: PerApp<string[] | null>;
  skills: PerApp<string[] | null>;
  prompts: PerApp<string | null>;
}

export interface Profile {
  id: string;
  name: string;
  payload: ProfilePayload;
  createdAt?: number;
  updatedAt?: number;
}

export interface CurrentProfileIds {
  claude: string | null;
  claudeDesktop: string | null;
  codex: string | null;
}

export interface ProfilesResponse {
  profiles: Profile[];
  currentIds: CurrentProfileIds;
}

export interface UpdateProfileOptions {
  name?: string;
  resnapshot?: boolean;
  scope?: ProfileScope;
}

export const profilesApi = {
  list: () => invoke<ProfilesResponse>("list_profiles"),
  create: (name: string, scope: ProfileScope) =>
    invoke<Profile>("create_profile", { name, scope }),
  update: (id: string, options: UpdateProfileOptions) =>
    invoke<Profile>("update_profile", { id, ...options }),
  delete: (id: string) => invoke<void>("delete_profile", { id }),
  apply: (id: string, scope: ProfileScope) =>
    invoke<string[]>("apply_profile", { id, scope }),
  clearCurrent: (scope: ProfileScope) =>
    invoke<void>("clear_current_profile", { scope }),
};
