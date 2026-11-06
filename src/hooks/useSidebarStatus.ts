import { useUsageSummary } from "@/lib/query/usage";
import { parseFiniteNumber } from "@/components/usage/format";
import type { UsageRangeSelection } from "@/types/usage";

const TODAY: UsageRangeSelection = { preset: "today" };

/**
 * 侧栏「用量统计」行尾的今日数字（上游 useSidebarStatus 的用量部分）。
 * Web 侧栏不显示模式标签和授权中心提醒，只取今日花费、Token、请求数与命中率。
 */
export function useSidebarStatus() {
  const { data: todaySummary } = useUsageSummary(TODAY, undefined, {
    refetchInterval: 60_000,
  });

  const todayCost = parseFiniteNumber(todaySummary?.totalCost) ?? 0;
  // 和用量页「真实消耗 Tokens」同口径
  const todayTokens = todaySummary?.realTotalTokens ?? 0;
  const todayRequests = todaySummary?.totalRequests ?? 0;
  const todayHitRate = todaySummary?.cacheHitRate ?? 0;

  return { todayCost, todayTokens, todayRequests, todayHitRate };
}
