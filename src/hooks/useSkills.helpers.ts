import type {
  DiscoverableSkill,
  SkillDiscoveryResult,
  SkillRepoFailure,
} from "@/lib/api/skills";

/**
 * 把发现结果里某个仓库的 Skill 和失败记录换成 next（不传就是删掉），
 * 去重、排序规则和后端 discover_available_report 一致。
 *
 * existingSkills 为空说明还没有发现结果，返回 undefined 让调用方不落一份
 * 只含单个仓库的残缺列表（那样 staleTime: Infinity 会让完整发现不再触发）。
 */
export function replaceRepoDiscovery(
  existingSkills: DiscoverableSkill[] | undefined,
  existingFailures: SkillRepoFailure[] | undefined,
  repo: { owner: string; name: string },
  next?: SkillDiscoveryResult,
): SkillDiscoveryResult | undefined {
  if (!existingSkills) return undefined;

  const otherRepo = (owner?: string, name?: string) =>
    owner !== repo.owner || name !== repo.name;
  const seen = new Set<string>();
  const skills = [
    ...existingSkills.filter((s) => otherRepo(s.repoOwner, s.repoName)),
    ...(next?.skills ?? []),
  ]
    .filter((skill) => {
      const key = skill.key.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const failures = [
    ...(existingFailures ?? []).filter((f) => otherRepo(f.owner, f.name)),
    ...(next?.failures ?? []),
  ];
  return { skills, failures };
}
