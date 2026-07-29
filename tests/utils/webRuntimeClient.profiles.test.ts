import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyWebProfile,
  clearWebCurrentProfile,
  createWebProfile,
  updateWebProfile,
} from "@/lib/runtime/client/web";

describe("web runtime profile requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses scoped profile routes and payloads", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createWebProfile("工作", "claude");
    await updateWebProfile("p/1", { name: "工作 2" });
    await applyWebProfile("p/1", "codex");
    await clearWebCurrentProfile("claude-desktop");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8890/api/profiles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "工作", scope: "claude" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8890/api/profiles/p%2F1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "工作 2" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8890/api/profiles/p%2F1/apply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ scope: "codex" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:8890/api/profiles/current/claude-desktop",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
