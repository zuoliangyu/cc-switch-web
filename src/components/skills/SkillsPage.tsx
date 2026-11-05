import { WindowedRows } from "@/components/common/WindowedRows";
import { SkillRepoFailures } from "./SkillRepoFailures";
import { useSkillRepoFailures } from "@/hooks/useSkills";
import {
  useState,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Search,
  Loader2,
  FolderGit2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SkillCard } from "./SkillCard";
import { RepoManagerPanel } from "./RepoManagerPanel";
import {
  useDiscoverableSkills,
  useRefreshDiscoverableSkills,
  useInstalledSkills,
  useInstallSkill,
  useSkillRepos,
  useAddSkillRepo,
  useRemoveSkillRepo,
  useSearchSkillsSh,
} from "@/hooks/useSkills";
import type { AppId } from "@/lib/api/types";
import type {
  DiscoverableSkill,
  SkillRepo,
  SkillsShDiscoverableSkill,
} from "@/lib/api/skills";
import { formatSkillError } from "@/lib/errors/skillErrorParser";

interface SkillsPageProps {
  initialApp?: AppId;
}

export interface SkillsPageHandle {
  refresh: () => void;
  openRepoManager: () => void;
}

type SearchSource = "repos" | "skillssh";

const SKILLSSH_PAGE_SIZE = 20;

/**
 * Skills 发现面板
 * 用于浏览和安装来自仓库或 skills.sh 的 Skills
 */
export const SkillsPage = forwardRef<SkillsPageHandle, SkillsPageProps>(
  ({ initialApp = "claude" }, ref) => {
    const { t } = useTranslation();
    const { data: discoveryFailures } = useSkillRepoFailures("discoverable");
    const [repoManagerOpen, setRepoManagerOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRepo, setFilterRepo] = useState<string>("all");
    const [filterStatus, setFilterStatus] = useState<
      "all" | "installed" | "uninstalled"
    >("all");
    const [searchSource, setSearchSource] = useState<SearchSource>("repos");
    const [skillsShInput, setSkillsShInput] = useState("");
    const [skillsShQuery, setSkillsShQuery] = useState("");
    const [skillsShOffset, setSkillsShOffset] = useState(0);
    const [accumulatedResults, setAccumulatedResults] = useState<
      SkillsShDiscoverableSkill[]
    >([]);

    const currentApp = initialApp;

    const { data: discoverableSkills, isLoading: loadingDiscoverable } =
      useDiscoverableSkills();
    // 手动刷新绕过后端按仓库的发现缓存
    const refreshDiscoverable = useRefreshDiscoverableSkills();
    const { data: installedSkills } = useInstalledSkills();
    const { data: repos = [], refetch: refetchRepos } = useSkillRepos();
    const {
      data: skillsShResult,
      isLoading: loadingSkillsSh,
      isFetching: fetchingSkillsSh,
      isError: skillsShFailed,
      refetch: refetchSkillsSh,
    } = useSearchSkillsSh(skillsShQuery, SKILLSSH_PAGE_SIZE, skillsShOffset);

    useEffect(() => {
      if (!skillsShResult) {
        return;
      }
      if (skillsShOffset === 0) {
        setAccumulatedResults(skillsShResult.skills);
      } else {
        setAccumulatedResults((prev) => [...prev, ...skillsShResult.skills]);
      }
    }, [skillsShResult, skillsShOffset]);

    const handleSkillsShSearch = () => {
      const trimmed = skillsShInput.trim();
      if (trimmed.length < 2) {
        return;
      }
      setSkillsShOffset(0);
      setAccumulatedResults([]);
      setSkillsShQuery(trimmed);
    };

    const installMutation = useInstallSkill();
    const addRepoMutation = useAddSkillRepo();
    const removeRepoMutation = useRemoveSkillRepo();

    const installedKeys = useMemo(() => {
      if (!installedSkills) return new Set<string>();
      return new Set(
        installedSkills.map((skill) => {
          const owner = skill.repoOwner?.toLowerCase() || "";
          const name = skill.repoName?.toLowerCase() || "";
          return `${skill.directory.toLowerCase()}:${owner}:${name}`;
        }),
      );
    }, [installedSkills]);

    type DiscoverableSkillItem = DiscoverableSkill & { installed: boolean };

    const repoOptions = useMemo(() => {
      if (!discoverableSkills) return [];
      const repoSet = new Set<string>();
      discoverableSkills.forEach((skill) => {
        if (skill.repoOwner && skill.repoName) {
          repoSet.add(`${skill.repoOwner}/${skill.repoName}`);
        }
      });
      return Array.from(repoSet).sort();
    }, [discoverableSkills]);

    const skills: DiscoverableSkillItem[] = useMemo(() => {
      if (!discoverableSkills) return [];
      return discoverableSkills.map((skill) => {
        const installName =
          skill.directory.split(/[/\\]/).pop()?.toLowerCase() ||
          skill.directory.toLowerCase();
        const key = `${installName}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;
        return {
          ...skill,
          installed: installedKeys.has(key),
        };
      });
    }, [discoverableSkills, installedKeys]);

    const isSkillsShInstalled = (skill: SkillsShDiscoverableSkill): boolean => {
      const key = `${skill.directory.toLowerCase()}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;
      return installedKeys.has(key);
    };

    const loading =
      searchSource === "repos"
        ? loadingDiscoverable && !discoverableSkills
        : false;

    useImperativeHandle(ref, () => ({
      refresh: () => {
        void refreshDiscoverable();
        refetchRepos();
      },
      openRepoManager: () => setRepoManagerOpen(true),
    }));

    const toDiscoverableSkill = (
      skill: SkillsShDiscoverableSkill,
    ): DiscoverableSkill => ({
      key: skill.key,
      name: skill.name,
      description: "",
      directory: skill.directory,
      repoOwner: skill.repoOwner,
      repoName: skill.repoName,
      repoBranch: skill.repoBranch,
      readmeUrl: skill.readmeUrl,
    });

    const handleInstall = async (directory: string) => {
      let skill: DiscoverableSkill | undefined;

      if (searchSource === "skillssh") {
        const found = accumulatedResults.find(
          (item) => item.directory === directory,
        );
        if (found) {
          skill = toDiscoverableSkill(found);
        }
      } else {
        skill = discoverableSkills?.find(
          (item) =>
            item.directory === directory ||
            item.directory.split("/").pop() === directory,
        );
      }

      if (!skill) {
        toast.error(t("skills.notFound"));
        return;
      }

      try {
        await installMutation.mutateAsync({
          skill,
          currentApp,
        });
        toast.success(t("skills.installSuccess", { name: skill.name }), {
          closeButton: true,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const { title, description } = formatSkillError(
          errorMessage,
          t,
          "skills.installFailed",
        );
        toast.error(title, {
          description,
          duration: 10000,
        });
        console.error("Install skill failed:", error);
      }
    };

    const handleUninstall = async (_directory: string) => {
      toast.info(t("skills.uninstallInMainPanel"));
    };

    const handleAddRepo = async (repo: SkillRepo) => {
      try {
        // 只发现这一个仓库，不重拉其它仓库
        const discovery = await addRepoMutation.mutateAsync(repo);
        const count =
          discovery?.skills.filter(
            (skill) =>
              skill.repoOwner === repo.owner &&
              skill.repoName === repo.name &&
              (skill.repoBranch || "main") === (repo.branch || "main"),
          ).length ?? 0;
        toast.success(
          t("skills.repo.addSuccess", {
            owner: repo.owner,
            name: repo.name,
            count,
          }),
          { closeButton: true },
        );
      } catch (error) {
        toast.error(t("common.error"), {
          description: String(error),
        });
      }
    };

    const handleRemoveRepo = async (owner: string, name: string) => {
      try {
        await removeRepoMutation.mutateAsync({ owner, name });
        toast.success(t("skills.repo.removeSuccess", { owner, name }), {
          closeButton: true,
        });
      } catch (error) {
        toast.error(t("common.error"), {
          description: String(error),
        });
      }
    };

    const filteredSkills = useMemo(() => {
      const byRepo = skills.filter((skill) => {
        if (filterRepo === "all") return true;
        const skillRepo = `${skill.repoOwner}/${skill.repoName}`;
        return skillRepo === filterRepo;
      });

      const byStatus = byRepo.filter((skill) => {
        if (filterStatus === "installed") return skill.installed;
        if (filterStatus === "uninstalled") return !skill.installed;
        return true;
      });

      if (!searchQuery.trim()) return byStatus;

      const query = searchQuery.toLowerCase();
      return byStatus.filter((skill) => {
        const name = skill.name?.toLowerCase() || "";
        const repo =
          skill.repoOwner && skill.repoName
            ? `${skill.repoOwner}/${skill.repoName}`.toLowerCase()
            : "";

        return name.includes(query) || repo.includes(query);
      });
    }, [skills, searchQuery, filterRepo, filterStatus]);

    const hasMoreSkillsSh =
      skillsShResult && accumulatedResults.length < skillsShResult.totalCount;

    const effectiveSource =
      searchSource === "repos" && skills.length === 0 && !loading
        ? "skillssh"
        : searchSource;

    return (
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden px-4 sm:px-6">
        <div className="scroll-overlay flex-1 overflow-y-auto overflow-x-hidden animate-fade-in">
          <div className="space-y-4 py-4 sm:py-5">
            <SkillRepoFailures failures={discoveryFailures} />
            <div className="glass-card rounded-[30px] border border-border-default p-5 sm:p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {t("skills.workspaceLabel", {
                      defaultValue: "Skills Workspace",
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                      {t("skills.title", {
                        defaultValue: "技能工作台",
                      })}
                    </h2>
                    <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                      {effectiveSource === "repos"
                        ? t("skills.count", {
                            count: filteredSkills.length,
                          })
                        : t("skills.count", {
                            count: accumulatedResults.length,
                          })}
                    </span>
                    <span className="theme-chip-tertiary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                      {effectiveSource === "repos"
                        ? t("skills.searchSource.repos")
                        : t("skills.searchSource.skillssh")}
                    </span>
                    {effectiveSource === "repos" ? (
                      <span className="theme-chip-success inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                        {t("skills.filter.installed")}：
                        {skills.filter((skill) => skill.installed).length}
                      </span>
                    ) : null}
                    {searchQuery.trim() || skillsShQuery.trim() ? (
                      <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                        {t("skills.search", { defaultValue: "搜索技能" })}
                      </span>
                    ) : null}
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    {effectiveSource === "repos"
                      ? searchQuery.trim()
                        ? t("skills.workspaceSearchDescription", {
                            defaultValue:
                              "正在按照技能名称和仓库来源过滤结果，便于快速定位可安装项。",
                          })
                        : t("skills.workspaceDescription", {
                            defaultValue:
                              "集中浏览来自仓库的技能、确认安装状态，并在一个面板里完成来源管理与筛选。",
                          })
                      : skills.length === 0 && searchSource === "repos"
                        ? t("skills.workspaceFallbackDescription", {
                            defaultValue:
                              "当前仓库源还没有可发现技能，已自动切换到 skills.sh 继续探索公开目录。",
                          })
                        : t("skills.skillssh.workspaceDescription", {
                            defaultValue:
                              "从 skills.sh 搜索更广泛的技能目录，按关键词逐批加载并直接安装到当前应用。",
                          })}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-[8rem]"
                    onClick={() => setRepoManagerOpen(true)}
                  >
                    <FolderGit2 className="mr-2 h-4 w-4" />
                    {t("skills.repoManager", {
                      defaultValue: "仓库管理",
                    })}
                  </Button>
                  {effectiveSource === "repos" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-[8rem]"
                      onClick={() => {
                        void refreshDiscoverable();
                        refetchRepos();
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {t("common.refresh", { defaultValue: "刷新" })}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="glass-card rounded-[28px] border border-border-default p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-background/80 shadow-sm">
                  {effectiveSource === "repos" ? (
                    <SlidersHorizontal className="h-5 w-5 theme-primary-text" />
                  ) : (
                    <Sparkles className="h-5 w-5 theme-tertiary-text" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {effectiveSource === "repos"
                      ? t("skills.filtersTitle", {
                          defaultValue: "来源与筛选",
                        })
                      : t("skills.skillssh.discoveryTitle", {
                          defaultValue: "公开目录搜索",
                        })}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {effectiveSource === "repos"
                      ? t("skills.filtersDescription", {
                          defaultValue:
                            "按仓库、安装状态和关键字快速收敛候选技能。",
                        })
                      : t("skills.skillssh.discoveryDescription", {
                          defaultValue:
                            "输入关键词搜索 skills.sh，支持继续加载更多结果。",
                        })}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="inline-flex w-full flex-wrap gap-1 rounded-2xl border border-border-default bg-background/80 p-1 md:w-auto">
                  <Button
                    type="button"
                    size="sm"
                    variant={effectiveSource === "repos" ? "default" : "ghost"}
                    className={
                      effectiveSource === "repos"
                        ? "min-w-[7rem] rounded-xl shadow-sm"
                        : "min-w-[7rem] rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                    onClick={() => setSearchSource("repos")}
                  >
                    {t("skills.searchSource.repos")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      effectiveSource === "skillssh" ? "default" : "ghost"
                    }
                    className={
                      effectiveSource === "skillssh"
                        ? "min-w-[7rem] rounded-xl shadow-sm"
                        : "min-w-[7rem] rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                    onClick={() => setSearchSource("skillssh")}
                  >
                    {t("skills.searchSource.skillssh")}
                  </Button>
                </div>

                {effectiveSource === "repos" ? (
                  <>
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_220px_160px]">
                      <div className="relative min-w-0">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder={t("skills.searchPlaceholder")}
                          value={searchQuery}
                          onChange={(event) =>
                            setSearchQuery(event.target.value)
                          }
                          className="h-11 rounded-2xl border-border-default bg-background/80 pl-10 pr-3"
                        />
                      </div>
                      <Select value={filterRepo} onValueChange={setFilterRepo}>
                        <SelectTrigger className="h-11 rounded-2xl border-border-default bg-background/80 text-foreground shadow-none">
                          <SelectValue
                            placeholder={t("skills.filter.repo")}
                            className="text-left truncate"
                          />
                        </SelectTrigger>
                        <SelectContent className="max-h-64 min-w-[var(--radix-select-trigger-width)] bg-card text-foreground shadow-lg">
                          <SelectItem
                            value="all"
                            className="text-left pr-3 [&[data-state=checked]>span:first-child]:hidden"
                          >
                            {t("skills.filter.allRepos")}
                          </SelectItem>
                          {repoOptions.map((repo) => (
                            <SelectItem
                              key={repo}
                              value={repo}
                              className="text-left pr-3 [&[data-state=checked]>span:first-child]:hidden"
                              title={repo}
                            >
                              <span className="block max-w-[200px] truncate">
                                {repo}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={filterStatus}
                        onValueChange={(value) =>
                          setFilterStatus(
                            value as "all" | "installed" | "uninstalled",
                          )
                        }
                      >
                        <SelectTrigger className="h-11 rounded-2xl border-border-default bg-background/80 text-foreground shadow-none">
                          <SelectValue
                            placeholder={t("skills.filter.placeholder")}
                            className="text-left"
                          />
                        </SelectTrigger>
                        <SelectContent className="bg-card text-foreground shadow-lg">
                          <SelectItem
                            value="all"
                            className="text-left pr-3 [&[data-state=checked]>span:first-child]:hidden"
                          >
                            {t("skills.filter.all")}
                          </SelectItem>
                          <SelectItem
                            value="installed"
                            className="text-left pr-3 [&[data-state=checked]>span:first-child]:hidden"
                          >
                            {t("skills.filter.installed")}
                          </SelectItem>
                          <SelectItem
                            value="uninstalled"
                            className="text-left pr-3 [&[data-state=checked]>span:first-child]:hidden"
                          >
                            {t("skills.filter.uninstalled")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 font-medium">
                        {filterRepo === "all"
                          ? t("skills.filter.allRepos")
                          : filterRepo}
                      </span>
                      <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 font-medium">
                        {filterStatus === "all"
                          ? t("skills.filter.all")
                          : filterStatus === "installed"
                            ? t("skills.filter.installed")
                            : t("skills.filter.uninstalled")}
                      </span>
                      {searchQuery.trim() && (
                        <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 font-medium">
                          {t("skills.count", { count: filteredSkills.length })}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="relative min-w-0">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder={t("skills.skillssh.searchPlaceholder")}
                          value={skillsShInput}
                          onChange={(event) =>
                            setSkillsShInput(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              handleSkillsShSearch();
                            }
                          }}
                          className="h-11 rounded-2xl border-border-default bg-background/80 pl-10 pr-3"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSkillsShSearch}
                        disabled={
                          skillsShInput.trim().length < 2 || fetchingSkillsSh
                        }
                        className="h-11 rounded-2xl px-5 lg:min-w-[8rem]"
                      >
                        {fetchingSkillsSh ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t("skills.search")}
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 font-medium">
                        {skillsShQuery.trim()
                          ? t("skills.skillssh.poweredBy")
                          : t("skills.skillssh.searchPlaceholder")}
                      </span>
                      {skillsShQuery.trim() && skillsShResult ? (
                        <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 font-medium">
                          {t("skills.count", {
                            count: skillsShResult.totalCount,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </div>

            {effectiveSource === "repos" ? (
              loading ? (
                <div className="glass-card flex h-64 items-center justify-center rounded-[28px] border border-border-default">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : skills.length === 0 ? (
                <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                    <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="mt-4 text-lg font-semibold text-foreground">
                    {t("skills.empty")}
                  </div>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {t("skills.emptyDescription")}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <Button onClick={() => setRepoManagerOpen(true)}>
                      <FolderGit2 className="mr-2 h-4 w-4" />
                      {t("skills.addRepo")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setSearchSource("skillssh")}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("skills.searchSource.skillssh")}
                    </Button>
                  </div>
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-10 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                    <Search className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="mt-4 text-lg font-semibold text-foreground">
                    {t("skills.noResults")}
                  </div>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {t("skills.workspaceNoResultsHint", {
                      defaultValue:
                        "试试放宽仓库或安装状态筛选，或者清空关键字后重新浏览全部技能。",
                    })}
                  </p>
                </div>
              ) : (
                <WindowedRows grid>
                  {filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.key}
                      skill={skill}
                      onInstall={handleInstall}
                      onUninstall={handleUninstall}
                    />
                  ))}
                </WindowedRows>
              )
            ) : loadingSkillsSh && accumulatedResults.length === 0 ? (
              <div className="glass-card flex h-64 items-center justify-center rounded-[28px] border border-border-default">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-3 text-sm text-muted-foreground">
                  {t("skills.skillssh.loading")}
                </span>
              </div>
            ) : skillsShFailed ? (
              <div className="rounded-lg border p-4">
                <p>{t("skills.searchFailed")}</p>
                <Button
                  onClick={() => {
                    if (skillsShOffset === 0) void refetchSkillsSh();
                    else {
                      setAccumulatedResults([]);
                      setSkillsShOffset(0);
                    }
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : skillsShQuery.length < 2 ? (
              <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                  <Sparkles className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="mt-4 text-lg font-semibold text-foreground">
                  {t("skills.skillssh.discoveryTitle", {
                    defaultValue: "从 skills.sh 发现公开技能",
                  })}
                </div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {t("skills.skillssh.searchPlaceholder")}
                </p>
              </div>
            ) : accumulatedResults.length === 0 && !loadingSkillsSh ? (
              <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="mt-4 text-lg font-semibold text-foreground">
                  {t("skills.skillssh.noResults", { query: skillsShQuery })}
                </div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {t("skills.skillssh.noResultsHint", {
                    defaultValue:
                      "可以尝试更短的关键词、英文别名，或切换回仓库来源查看私有技能源。",
                  })}
                </p>
              </div>
            ) : (
              <>
                <WindowedRows grid>
                  {accumulatedResults.map((skill) => {
                    const installed = isSkillsShInstalled(skill);
                    return (
                      <SkillCard
                        key={skill.key}
                        skill={{
                          ...toDiscoverableSkill(skill),
                          installed,
                        }}
                        installs={skill.installs}
                        onInstall={handleInstall}
                        onUninstall={handleUninstall}
                      />
                    );
                  })}
                </WindowedRows>

                <div className="glass-card mt-2 rounded-[24px] border border-border-default px-4 py-5">
                  <div className="flex flex-col items-center gap-2 text-center">
                    {hasMoreSkillsSh ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={fetchingSkillsSh}
                        onClick={() =>
                          setSkillsShOffset((prev) => prev + SKILLSSH_PAGE_SIZE)
                        }
                      >
                        {fetchingSkillsSh ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {t("skills.skillssh.loadMore")}
                      </Button>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {t("skills.skillssh.poweredBy")}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {repoManagerOpen ? (
          <RepoManagerPanel
            repos={repos}
            skills={skills}
            onAdd={handleAddRepo}
            onRemove={handleRemoveRepo}
            onClose={() => setRepoManagerOpen(false)}
          />
        ) : null}
      </div>
    );
  },
);

SkillsPage.displayName = "SkillsPage";
