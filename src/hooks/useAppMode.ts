import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AppId } from "@/lib/api";
import type { AppMode, RouteSwitchResult } from "@/types/proxy";
import { proxyApi } from "@/lib/api/proxy";
import { extractErrorMessage } from "@/utils/errorUtils";
import { appModeQueryKey } from "@/lib/query/appModeKeys";

export const supportsAppMode = (app: AppId) =>
  ["claude", "claude-desktop", "codex", "gemini", "grokbuild"].includes(app);

type Action =
  | { kind: "restartDaemon" }
  | { kind: "adoptCatalog" }
  | { kind: "acknowledgeStale" }
  /** `quiet`：错误由调用方就地显示（确认框里），不再弹 toast */
  | { kind: "mode"; mode: AppMode; route?: string; quiet?: boolean }
  | { kind: "member"; id: string; enabled: boolean }
  | { kind: "route"; id: string };

/**
 * 只读的模式视图（和 useAppMode 同一个查询，不另外轮询）：表单按应用实际的模式给提示。
 * 不支持模式的应用返回 undefined。
 */
export function useAppModeView(app: AppId) {
  return useQuery({
    queryKey: appModeQueryKey(app),
    queryFn: () => proxyApi.getAppMode(app),
    enabled: supportsAppMode(app),
    retry: false,
  }).data;
}

export function useAppMode(app: AppId) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: appModeQueryKey(app),
    queryFn: () => proxyApi.getAppMode(app),
    enabled: supportsAppMode(app),
    // 不定时轮询（同上游）：键在 ["providers", app] 下，进出模式、切换与供应商改动随列表失效
    // 刷新，故障转移与应用项目由服务端推送的 provider-switched 刷新（见 useAppServerEvents），
    // 其余随窗口重新聚焦重取
  });
  const mutation = useMutation({
    mutationFn: (action: Action): Promise<RouteSwitchResult | void> => {
      if (action.kind === "restartDaemon")
        return proxyApi.restartCodexDaemon().then(() => {});
      if (action.kind === "adoptCatalog")
        return proxyApi.adoptCodexStackCatalog().then(() => {});
      if (action.kind === "acknowledgeStale")
        return proxyApi.acknowledgeCodexStaleClients();
      if (action.kind === "mode")
        return proxyApi.setAppMode(app, action.mode, action.route);
      if (action.kind === "member")
        return proxyApi.setAggregationMember(app, action.id, action.enabled);
      return proxyApi.setRoute(app, action.id);
    },
    onError: (error, action) => {
      if (action.kind === "mode" && action.quiet) return;
      toast.error(extractErrorMessage(error));
    },
    onSettled: async () => {
      await Promise.all(
        [
          "providers",
          "proxyStatus",
          "proxyTakeoverStatus",
          "globalProxyConfig",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  return {
    ...query,
    pending: mutation.isPending,
    change: mutation.mutateAsync,
    /** 指定路由目标（聚合模式下是默认那家），返回后端实际生效的结果 */
    setRoute: (id: string) =>
      mutation
        .mutateAsync({ kind: "route", id })
        .then((result) => result as RouteSwitchResult),
  };
}
