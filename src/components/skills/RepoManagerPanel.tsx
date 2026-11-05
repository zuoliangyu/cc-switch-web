import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Trash2,
  ExternalLink,
  Plus,
  FolderGit2,
  GitBranch,
} from "lucide-react";
import { settingsApi } from "@/lib/api";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { DiscoverableSkill, SkillRepo } from "@/lib/api/skills";

interface RepoManagerPanelProps {
  repos: SkillRepo[];
  skills: DiscoverableSkill[];
  onAdd: (repo: SkillRepo) => Promise<void>;
  onRemove: (owner: string, name: string) => Promise<void>;
  /** 勾掉 = 停用（不参与发现），不删除 */
  onToggle?: (repo: SkillRepo, enabled: boolean) => Promise<void>;
  onClose: () => void;
}

/** 这个仓库（含分支）在发现结果里有几个 Skill */
export function countRepoSkills(skills: DiscoverableSkill[], repo: SkillRepo) {
  return skills.filter(
    (skill) =>
      skill.repoOwner === repo.owner &&
      skill.repoName === repo.name &&
      (skill.repoBranch || "main") === (repo.branch || "main"),
  ).length;
}

export function RepoManagerPanel({
  repos,
  skills,
  onAdd,
  onRemove,
  onToggle,
  onClose,
}: RepoManagerPanelProps) {
  const { t } = useTranslation();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");

  const getSkillCount = (repo: SkillRepo) => countRepoSkills(skills, repo);

  const parseRepoUrl = (
    url: string,
  ): { owner: string; name: string } | null => {
    let cleaned = url.trim();
    cleaned = cleaned.replace(/^https?:\/\/github\.com\//, "");
    cleaned = cleaned.replace(/\.git$/, "");

    const parts = cleaned.split("/");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], name: parts[1] };
    }

    return null;
  };

  const handleAdd = async () => {
    setError("");

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      setError(t("skills.repo.invalidUrl"));
      return;
    }

    try {
      await onAdd({
        owner: parsed.owner,
        name: parsed.name,
        branch: branch || "main",
        enabled: true,
      });

      setRepoUrl("");
      setBranch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skills.repo.addFailed"));
    }
  };

  const handleOpenRepo = async (owner: string, name: string) => {
    try {
      await settingsApi.openExternal(`https://github.com/${owner}/${name}`);
    } catch (error) {
      console.error("Failed to open URL:", error);
    }
  };

  return (
    <FullScreenPanel
      isOpen={true}
      title={t("skills.repo.title")}
      onClose={onClose}
    >
      <div className="space-y-6">
        <div className="glass-card rounded-[28px] border border-border-default p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {t("skills.repo.workspaceLabel", {
                  defaultValue: "Repo Workspace",
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                  {t("skills.repo.title")}
                </h3>
                <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                  {t("skills.count", { count: repos.length })}
                </span>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {t("skills.repo.workspaceDescription", {
                  defaultValue:
                    "在这里维护 Skills 仓库来源，统一查看每个仓库当前识别到的技能数量和分支信息。",
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
          <div className="glass-card rounded-[28px] border border-border-default p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background/80 shadow-sm">
                <FolderGit2 className="h-5 w-5 theme-primary-text" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {t("skills.addRepo")}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("skills.repo.formDescription", {
                    defaultValue:
                      "支持填入 `owner/name` 或 GitHub 完整地址，新仓库会立即进入发现流程。",
                  })}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="repo-url" className="text-foreground">
                  {t("skills.repo.url")}
                </Label>
                <Input
                  id="repo-url"
                  placeholder={t("skills.repo.urlPlaceholder")}
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="mt-2 h-11 rounded-2xl border-border-default bg-background/80"
                />
              </div>
              <div>
                <Label htmlFor="branch" className="text-foreground">
                  {t("skills.repo.branch")}
                </Label>
                <Input
                  id="branch"
                  placeholder={t("skills.repo.branchPlaceholder")}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="mt-2 h-11 rounded-2xl border-border-default bg-background/80"
                />
              </div>
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}
              <Button
                onClick={handleAdd}
                className="theme-primary-solid h-11 w-full rounded-2xl"
                type="button"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("skills.repo.add")}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {t("skills.repo.list")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("skills.repo.listDescription", {
                    defaultValue:
                      "每个仓库条目会显示当前分支和已识别技能数量，方便快速判断来源是否生效。",
                  })}
                </p>
              </div>
              <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                {repos.length}
              </span>
            </div>
            {repos.length === 0 ? (
              <div className="glass-card rounded-[24px] border border-dashed border-border-default px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                  <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mt-4 text-base font-semibold text-foreground">
                  {t("skills.repo.empty")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {repos.map((repo) => (
                  <div
                    key={`${repo.owner}/${repo.name}`}
                    className="glass-card flex items-center justify-between gap-4 rounded-[24px] border border-border-default px-5 py-4"
                  >
                    {onToggle && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary"
                        checked={repo.enabled}
                        aria-label={t("skillsPage.repos.enableAria", {
                          repo: `${repo.owner}/${repo.name}`,
                        })}
                        onChange={(event) =>
                          void onToggle(repo, event.target.checked)
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold text-foreground">
                        {repo.owner}/{repo.name}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1">
                          <GitBranch className="mr-1.5 h-3 w-3" />
                          {repo.branch || "main"}
                        </span>
                        <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1">
                          {t("skills.repo.skillCount", {
                            count: getSkillCount(repo),
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => handleOpenRepo(repo.owner, repo.name)}
                        title={t("common.view", { defaultValue: "查看" })}
                        className="rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => onRemove(repo.owner, repo.name)}
                        title={t("common.delete")}
                        className="rounded-xl hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </FullScreenPanel>
  );
}
