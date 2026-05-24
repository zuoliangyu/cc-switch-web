/**
 * Claude Desktop 3P 状态 Hook（5s 轮询，对应 cc-switch ProviderList banner）
 */
import { useQuery } from "@tanstack/react-query";
import { claudeDesktopApi } from "@/lib/api";
import type { ClaudeDesktopStatus } from "@/types/claudeDesktop";
import { getDefaultClaudeDesktopStatus } from "@/types/claudeDesktop";

export function useClaudeDesktopStatus(enabled = true) {
  const { data, isLoading } = useQuery<ClaudeDesktopStatus>({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => claudeDesktopApi.getStatus(),
    enabled,
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
  });

  return {
    status: data ?? getDefaultClaudeDesktopStatus(),
    isLoading,
  };
}
