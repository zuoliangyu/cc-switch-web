import { useQuery, type QueryClient } from "@tanstack/react-query";
import { piApi, type PiFamilyAppId } from "@/lib/api/pi";

export const piKeys = {
  all: ["pi"] as const,
  state: ["pi", "state"] as const,
  promptFile: (kind: string) => ["pi", "prompt-file", kind] as const,
  promptTemplates: ["pi", "prompt-templates"] as const,
  sessionDiscovery: ["pi", "session-discovery"] as const,
};

/** Pi 与 Oh My Pi 各自的当前状态缓存（Pi 的就是 piKeys.state） */
export const piStateKey = (app: PiFamilyAppId) => [app, "state"] as const;

export const invalidatePiProviderCaches = (
  queryClient: QueryClient,
  app: PiFamilyAppId = "pi",
) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: piStateKey(app) }),
    queryClient.invalidateQueries({ queryKey: ["providers", app] }),
    ...(app === "pi"
      ? [queryClient.invalidateQueries({ queryKey: ["piLiveProviderIds"] })]
      : []),
  ]);

/** 改了 Pi / Oh My Pi 的配置目录：状态、供应商、技能和会话都换了来源 */
export const invalidatePiDirectoryCaches = (
  queryClient: QueryClient,
  app: PiFamilyAppId = "pi",
) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: [app] }),
    queryClient.invalidateQueries({ queryKey: ["providers", app] }),
    queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
    queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  ]);

export function usePiCurrentState(enabled = true, app: PiFamilyAppId = "pi") {
  return useQuery({
    queryKey: piStateKey(app),
    queryFn: () => piApi.getCurrentState(app),
    enabled,
  });
}

export function usePiSessionDiscovery(enabled = true) {
  return useQuery({
    queryKey: piKeys.sessionDiscovery,
    queryFn: piApi.getSessionDiscovery,
    enabled,
  });
}
