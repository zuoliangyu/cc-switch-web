import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillCard } from "@/components/skills/SkillCard";
import { settingsApi } from "@/lib/api";
import type { DiscoverableSkill } from "@/lib/api/skills";

function makeSkill(
  overrides: Partial<DiscoverableSkill> = {},
): DiscoverableSkill & { installed: boolean } {
  return {
    key: "owner-a/repo-a:repo-skill",
    name: "Repo Skill",
    description: "",
    directory: "repo-skill",
    repoOwner: "owner-a",
    repoName: "repo-a",
    repoBranch: "main",
    installed: false,
    ...overrides,
  };
}

describe("SkillCard docs link", () => {
  it("opens the skill's readme when it has one", async () => {
    const open = vi
      .spyOn(settingsApi, "openExternal")
      .mockResolvedValue(undefined as never);
    render(
      <SkillCard
        skill={makeSkill({
          readmeUrl: "https://github.com/owner-a/repo-a/tree/main/repo-skill",
        })}
        onInstall={vi.fn()}
        onUninstall={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /skills\.view/ }));
    expect(open).toHaveBeenLastCalledWith(
      "https://github.com/owner-a/repo-a/tree/main/repo-skill",
    );
    open.mockRestore();
  });

  it("falls back to the repository home page without a readme", async () => {
    const open = vi
      .spyOn(settingsApi, "openExternal")
      .mockResolvedValue(undefined as never);
    render(
      <SkillCard
        skill={makeSkill()}
        onInstall={vi.fn()}
        onUninstall={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /skills\.view/ }));
    expect(open).toHaveBeenLastCalledWith("https://github.com/owner-a/repo-a");
    open.mockRestore();
  });
});
