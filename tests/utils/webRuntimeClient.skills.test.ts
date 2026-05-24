import { afterEach, describe, expect, it, vi } from "vitest";

import {
  toggleWebSkillApp,
  uninstallWebSkillUnified,
} from "@/lib/runtime/client/web";

describe("web runtime skill requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes repo-based skill id when uninstalling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ backupPath: "/tmp/backup" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await uninstallWebSkillUnified("owner/repo:adobe-automation");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8890/api/skills/uninstall",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          id: "owner/repo:adobe-automation",
        }),
      }),
    );
  });

  it("sends repo-based skill id in request body when toggling app binding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(true), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await toggleWebSkillApp("owner/repo:adobe-automation", "claude", true);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8890/api/skills/apps/toggle",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          id: "owner/repo:adobe-automation",
          app: "claude",
          enabled: true,
        }),
      }),
    );
  });
});
