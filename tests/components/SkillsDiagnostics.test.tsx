import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, vi, expect } from "vitest";
import { ResyncButton } from "@/components/common/ResyncButton";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
const mocks = vi.hoisted(() => ({
  toggle: vi.fn(),
}));
describe("resource diagnostics", () => {
  it("keeps Auto distinct from forced symlink and copy", () => {
    render(<SkillSyncMethodSettings value="auto" onChange={mocks.toggle} />);
    fireEvent.click(
      screen.getByRole("button", { name: "settings.skillSync.auto" }),
    );
    expect(mocks.toggle).toHaveBeenCalledWith("auto");
  });
  it("reports partial resync failures, then refreshes cached membership", async () => {
    const run = vi.fn().mockResolvedValue([
      { app: "claude", ok: true },
      {
        app: "codex",
        ok: false,
        failedSkills: [{ directory: "bad", error: "invalid config" }],
      },
    ]);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <ResyncButton run={run} queryKey={["skills", "installed"]} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.resync" }));
    await waitFor(() =>
      expect(
        screen.getByText(/codex: bad: invalid config/),
      ).toBeInTheDocument(),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["skills", "installed"],
    });
  });
});
