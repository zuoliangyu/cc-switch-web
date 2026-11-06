import type { SkillRepoFailure } from "@/lib/api/skills";
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  skillsApi,
  type SkillArchiveInstallResult,
  type SkillBackupEntry,
  type DiscoverableSkill,
  type ImportSkillSelection,
  type InstalledSkill,
  type SkillDiscoveryResult,
  type SkillRepo,
  type SkillsShSearchResult,
  type SkillUpdateCheckResult,
  type SkillUpdateInfo,
} from "@/lib/api/skills";
import type { AppId } from "@/lib/api/types";
import { runSequentialBulkAction } from "@/lib/utils/sequentialBulkAction";
import { replaceRepoDiscovery } from "@/hooks/useSkills.helpers";

function mergeInstalledSkills(
  existing: InstalledSkill[] | undefined,
  incoming: InstalledSkill[],
): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();
  existing?.forEach((skill) => {
    merged.set(skill.id, skill);
  });
  incoming.forEach((skill) => {
    merged.set(skill.id, skill);
  });
  return Array.from(merged.values());
}

/**
 * 查询所有已安装的 Skills
 * 使用 staleTime: Infinity 和 placeholderData: keepPreviousData
 * 实现首次进入使用缓存，只有刷新时才重新获取
 */
export function useInstalledSkills() {
  return useQuery({
    queryKey: ["skills", "installed"],
    queryFn: () => skillsApi.getInstalled(),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useSkillBackups() {
  return useQuery({
    queryKey: ["skills", "backups"],
    queryFn: () => skillsApi.getBackups(),
    enabled: false,
  });
}

export function useDeleteSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => skillsApi.deleteBackup(backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", "backups"] });
    },
  });
}

const DISCOVERABLE_QUERY_KEY = ["skills", "discoverable"];
const DISCOVERABLE_FAILURES_KEY = ["skills", "discoverable-failures"];
// 下一次发现绕过后端按仓库的缓存（只有手动刷新会置位）
let discoverForceNext = false;

/**
 * 发现可安装的 Skills（从仓库获取）
 * 使用 staleTime: Infinity 和 placeholderData: keepPreviousData
 * 实现首次进入使用缓存，只有刷新时才重新获取
 */
export function useDiscoverableSkills() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: DISCOVERABLE_QUERY_KEY,
    queryFn: async () => {
      const force = discoverForceNext;
      discoverForceNext = false;
      const report = await skillsApi.discoverReport(force);
      queryClient.setQueryData(DISCOVERABLE_FAILURES_KEY, report.failures);
      return report.skills;
    },
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/**
 * 手动刷新发现列表：绕过后端缓存，所有启用的仓库都重新下载
 */
export function useRefreshDiscoverableSkills() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    discoverForceNext = true;
    return queryClient.refetchQueries({
      queryKey: DISCOVERABLE_QUERY_KEY,
      exact: true,
    });
  }, [queryClient]);
}

/**
 * 只改发现缓存里一个仓库的部分（next 不传就是删掉这个仓库）。
 * 先取消进行中的整体发现：它读的是改动前的仓库表，晚到会把这次改动盖掉。
 */
async function patchRepoDiscovery(
  queryClient: QueryClient,
  repo: { owner: string; name: string },
  next?: SkillDiscoveryResult,
) {
  await queryClient.cancelQueries({
    queryKey: DISCOVERABLE_QUERY_KEY,
    exact: true,
  });
  const updated = replaceRepoDiscovery(
    queryClient.getQueryData<DiscoverableSkill[]>(DISCOVERABLE_QUERY_KEY),
    queryClient.getQueryData<SkillRepoFailure[]>(DISCOVERABLE_FAILURES_KEY),
    repo,
    next,
  );
  // 还没有任何发现结果（首次发现被上面取消了，或压根没开始）：没有底可以
  // 打补丁，重新整体发现一次，此时读到的仓库表已包含这次改动
  if (!updated) {
    void queryClient.invalidateQueries({
      queryKey: DISCOVERABLE_QUERY_KEY,
      exact: true,
    });
    return;
  }
  queryClient.setQueryData(DISCOVERABLE_QUERY_KEY, updated.skills);
  queryClient.setQueryData(DISCOVERABLE_FAILURES_KEY, updated.failures);
}

// 同一仓库的增删改各记一个序号：单仓库发现要下载归档，期间如果又停用 /
// 删除 / 改了分支，晚到的旧结果不能再写回缓存
const repoMutationSeq = new Map<string, number>();
const nextRepoMutation = (repo: { owner: string; name: string }) => {
  const key = `${repo.owner}/${repo.name}`;
  const seq = (repoMutationSeq.get(key) ?? 0) + 1;
  repoMutationSeq.set(key, seq);
  return { key, seq };
};
const isLatestRepoMutation = (ctx?: { key: string; seq: number }) =>
  !!ctx && repoMutationSeq.get(ctx.key) === ctx.seq;

/**
 * 安装 Skill
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skill,
      currentApp,
    }: {
      skill: DiscoverableSkill;
      currentApp: AppId;
    }) => skillsApi.installUnified(skill, currentApp),
    onSuccess: (installedSkill, _vars, _ctx) => {
      const { skill } = _vars;
      // 直接更新 installed 缓存
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed"],
        (oldData) => {
          if (!oldData) return [installedSkill];
          return [...oldData, installedSkill];
        },
      );

      // 更新 discoverable 缓存中对应技能的 installed 状态
      const installName =
        skill.directory.split(/[/\\]/).pop()?.toLowerCase() ||
        skill.directory.toLowerCase();
      const skillKey = `${installName}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;

      queryClient.setQueryData<DiscoverableSkill[]>(
        ["skills", "discoverable"],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.map((s) => {
            if (s.key === skillKey) {
              return { ...s, installed: true };
            }
            return s;
          });
        },
      );
    },
  });
}

/**
 * 卸载 Skill
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, skillKey }: { id: string; skillKey: string }) =>
      skillsApi
        .uninstallUnified(id)
        .then((result) => ({ ...result, skillKey })),
    onSuccess: ({ skillKey }, _vars) => {
      // 直接更新 installed 缓存，移除该 skill
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed"],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.filter((s) => s.id !== _vars.id);
        },
      );

      // 更新 discoverable 缓存中对应技能的 installed 状态
      queryClient.setQueryData<DiscoverableSkill[]>(
        ["skills", "discoverable"],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.map((s) => {
            if (s.key === skillKey) {
              return { ...s, installed: false };
            }
            return s;
          });
        },
      );
    },
  });
}

export function useRestoreSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      backupId,
      currentApp,
    }: {
      backupId: string;
      currentApp: AppId;
    }) => skillsApi.restoreBackup(backupId, currentApp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
      queryClient.invalidateQueries({ queryKey: ["skills", "backups"] });
    },
  });
}

/**
 * 切换 Skill 在特定应用的启用状态
 */
export function useToggleSkillApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      app,
      enabled,
    }: {
      id: string;
      app: AppId;
      enabled: boolean;
    }) => skillsApi.toggleApp(id, app, enabled),
    // 乐观更新：点了格子立刻翻过来，不等写完再刷新；失败时回滚
    onMutate: async ({ id, app, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["skills", "installed"] });
      const previous = queryClient.getQueryData<InstalledSkill[]>([
        "skills",
        "installed",
      ]);
      if (previous) {
        queryClient.setQueryData<InstalledSkill[]>(
          ["skills", "installed"],
          previous.map((skill) =>
            skill.id === id
              ? { ...skill, apps: { ...skill.apps, [app]: enabled } }
              : skill,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["skills", "installed"], context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
  });
}

export function useBulkToggleSkillApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ids,
      app,
      enabled,
    }: {
      ids: string[];
      app: AppId;
      enabled: boolean;
    }) =>
      runSequentialBulkAction(ids, (id) =>
        skillsApi.toggleApp(id, app, enabled),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
  });
}

/**
 * 扫描未管理的 Skills
 *
 * - 传 { enabled: true }（Skill 面板挂载时）会在进入页面时自动静默扫描一次，
 *   30s 内复用结果，避免来回切页时重复磁盘 IO。
 * - 默认 enabled: false：只订阅共享缓存，不主动触发扫描。
 */
export function useScanUnmanagedSkills(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["skills", "unmanaged"],
    queryFn: () => skillsApi.scanUnmanaged(),
    enabled: options?.enabled ?? false,
    staleTime: 30 * 1000,
  });
}

/**
 * 从应用目录导入 Skills
 * 成功后先合并缓存，结束后再重读已安装与可导入列表（按名称排好序、以服务端为准）
 */
export function useImportSkillsFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imports: ImportSkillSelection[]) =>
      skillsApi.importFromApps(imports),
    onSuccess: (importedSkills) => {
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed"],
        (oldData) => mergeInstalledSkills(oldData, importedSkills),
      );
    },
    // 导入可能在后面某项失败前已写入部分 Skills；弹窗只等这两个列表，
    // 不等「发现」重拉（要从 GitHub 下载仓库，等它会让弹窗一直锁着）
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
        queryClient.invalidateQueries({ queryKey: ["skills", "unmanaged"] }),
      ]),
  });
}

/**
 * 获取仓库列表
 */
export function useSkillRepos() {
  return useQuery({
    queryKey: ["skills", "repos"],
    queryFn: () => skillsApi.getRepos(),
  });
}

/**
 * 添加仓库
 */
export function useAddSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (repo: SkillRepo) => {
      await skillsApi.addRepo(repo);
      // 写库后马上刷新仓库列表：勾选框读的是它，不能等下面的归档下载完
      void queryClient.invalidateQueries({ queryKey: ["skills", "repos"] });
      if (!repo.enabled) return { skills: [], failures: [] };
      try {
        return await skillsApi.discoverRepo(repo.owner, repo.name);
      } catch (error) {
        console.error("[useAddSkillRepo] discover repo failed", error);
        return null;
      }
    },
    onMutate: nextRepoMutation,
    onSuccess: async (discovery, repo, ctx) => {
      if (!isLatestRepoMutation(ctx)) return;
      if (discovery) {
        await patchRepoDiscovery(queryClient, repo, discovery);
      } else {
        void queryClient.invalidateQueries({
          queryKey: DISCOVERABLE_QUERY_KEY,
        });
      }
    },
  });
}

/**
 * 删除仓库
 */
export function useRemoveSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      skillsApi.removeRepo(owner, name),
    onMutate: nextRepoMutation,
    onSuccess: async (_result, repo, ctx) => {
      void queryClient.invalidateQueries({ queryKey: ["skills", "repos"] });
      if (!isLatestRepoMutation(ctx)) return;
      await patchRepoDiscovery(queryClient, repo);
    },
  });
}

/**
 * Web 模式下从上传的多个 ZIP 归档安装 Skills
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useInstallSkillArchives() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, currentApp }: { files: File[]; currentApp: AppId }) =>
      skillsApi.installFromArchives(files, currentApp),
    onSuccess: (results) => {
      const installedSkills = results.flatMap((result) => result.installed);
      if (installedSkills.length === 0) {
        return;
      }

      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed"],
        (oldData) => mergeInstalledSkills(oldData, installedSkills),
      );
    },
  });
}

/**
 * 检查 Skills 更新（手动触发）
 */
export function useCheckSkillUpdates() {
  // 可更新的 Skill 和没读到的仓库一起返回（同上游）
  return useQuery({
    queryKey: ["skills", "updates"],
    queryFn: () => skillsApi.checkUpdatesReport(),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 更新单个 Skill
 */
export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.updateSkill(id),
    onSuccess: (updatedSkill) => {
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed"],
        (oldData) => {
          if (!oldData) return [updatedSkill];
          return oldData.map((skill) =>
            skill.id === updatedSkill.id ? updatedSkill : skill,
          );
        },
      );
      queryClient.setQueryData<SkillUpdateCheckResult>(
        ["skills", "updates"],
        (oldData) =>
          oldData && {
            ...oldData,
            updates: oldData.updates.filter(
              (update) => update.id !== updatedSkill.id,
            ),
          },
      );
    },
  });
}

/**
 * 搜索 skills.sh 公共目录
 */
export function useSearchSkillsSh(
  query: string,
  limit: number,
  offset: number,
) {
  return useQuery({
    queryKey: ["skills", "skillssh", query, limit, offset],
    queryFn: () => skillsApi.searchSkillsSh(query, limit, offset),
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ========== 辅助类型 ==========

export type {
  InstalledSkill,
  DiscoverableSkill,
  ImportSkillSelection,
  SkillBackupEntry,
  SkillArchiveInstallResult,
  SkillUpdateInfo,
  SkillsShSearchResult,
  AppId,
};

/**
 * 发现时没读到的仓库（发现请求写进缓存，这里只订阅）
 */
export function useDiscoverableSkillsFailures() {
  return useSkillRepoFailures("discoverable");
}

export function useSkillRepoFailures(kind: "discoverable" | "updates") {
  return useQuery<SkillRepoFailure[]>({
    queryKey: ["skills", `${kind}-failures`],
    queryFn: async () => [],
    enabled: false,
  });
}
export function useResyncSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => skillsApi.resync(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
  });
}
