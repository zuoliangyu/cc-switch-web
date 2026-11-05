import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, vi, expect } from "vitest";
import { SkillRepoFailures } from "@/components/skills/SkillRepoFailures";
import { ResyncButton } from "@/components/common/ResyncButton";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
import { SkillsPage } from "@/components/skills/SkillsPage";
const mocks = vi.hoisted(() => ({
  retry: vi.fn().mockResolvedValue({}),
  toggle: vi.fn(),
}));
vi.mock("@/hooks/useSkills", () => ({
  useSkillRepoFailures: () => ({ data: [] }),
  useRefreshDiscoverableSkills: () => vi.fn(),
  useDiscoverableSkills: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useInstalledSkills: () => ({ data: [] }),
  useSkillRepos: () => ({ data: [], refetch: vi.fn() }),
  useSearchSkillsSh: () => ({
    isError: true,
    isLoading: false,
    isFetching: false,
    refetch: mocks.retry,
  }),
  useInstallSkill: () => ({ mutateAsync: vi.fn() }),
  useAddSkillRepo: () => ({ mutateAsync: vi.fn() }),
  useRemoveSkillRepo: () => ({ mutateAsync: vi.fn() }),
}));
describe("resource diagnostics", () => {
  it("retries skills.sh on an already-zero offset", () => {
    render(<SkillsPage />);
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
  it("shows failed repository coordinates and reason", () => {
    render(
      <SkillRepoFailures
        failures={[
          {
            owner: "owner",
            name: "broken",
            branch: "main",
            error: "download timeout",
          },
        ]}
      />,
    );
    expect(screen.getByText("owner/broken (main)")).toBeInTheDocument();
    expect(screen.getByText("download timeout")).toBeInTheDocument();
  });
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
