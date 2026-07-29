import { describe, expect, it } from "vitest";

import type { Profile } from "@/lib/api/profiles";
import {
  APP_PROFILE_SCOPE,
  hasScopeSnapshot,
} from "@/components/profiles/scope";

const emptyProfile: Profile = {
  id: "profile-1",
  name: "工作",
  payload: {
    providers: { claude: null, "claude-desktop": null, codex: null },
    mcp: { claude: null, "claude-desktop": null, codex: null },
    skills: { claude: null, "claude-desktop": null, codex: null },
    prompts: { claude: null, "claude-desktop": null, codex: null },
  },
};

describe("profile scope", () => {
  it("maps supported apps and treats captured empty collections as snapshots", () => {
    expect(APP_PROFILE_SCOPE.claude).toBe("claude");
    expect(APP_PROFILE_SCOPE["claude-desktop"]).toBe("claude-desktop");
    expect(APP_PROFILE_SCOPE.codex).toBe("codex");
    expect(APP_PROFILE_SCOPE.gemini).toBeUndefined();
    expect(hasScopeSnapshot(emptyProfile, "codex")).toBe(false);

    const capturedEmpty: Profile = {
      ...emptyProfile,
      payload: {
        ...emptyProfile.payload,
        mcp: { ...emptyProfile.payload.mcp, codex: [] },
      },
    };
    expect(hasScopeSnapshot(capturedEmpty, "codex")).toBe(true);
    expect(hasScopeSnapshot(capturedEmpty, "claude")).toBe(false);
  });
});
