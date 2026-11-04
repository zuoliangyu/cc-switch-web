import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AppId } from "@/lib/api";
import type { AppMode } from "@/types/proxy";
import { proxyApi } from "@/lib/api/proxy";
import { extractErrorMessage } from "@/utils/errorUtils";

export const supportsAppMode = (app: AppId) =>
  ["claude", "claude-desktop", "codex", "gemini", "grokbuild"].includes(app);

type Action =
  | { kind: "restartDaemon" }
  | { kind: "adoptCatalog" }
  | { kind: "acknowledgeStale" }
  | { kind: "mode"; mode: AppMode; route?: string }
  | { kind: "member"; id: string; enabled: boolean }
  | { kind: "route"; id: string };

export function useAppMode(app: AppId) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["appMode", app],
    queryFn: () => proxyApi.getAppMode(app),
    enabled: supportsAppMode(app),
    refetchInterval: 3000,
  });
  const mutation = useMutation({
    mutationFn: (action: Action) => {
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
    onError: (error) => toast.error(extractErrorMessage(error)),
    onSettled: async () => {
      await Promise.all(
        [
          "appMode",
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
  };
}
