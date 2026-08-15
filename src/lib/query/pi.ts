import { useQuery, type QueryClient } from "@tanstack/react-query";
import { piApi } from "@/lib/api/pi";

export const piKeys = {
  all: ["pi"] as const,
  state: ["pi", "state"] as const,
  promptFile: (kind: string) => ["pi", "prompt-file", kind] as const,
  promptTemplates: ["pi", "prompt-templates"] as const,
  sessionDiscovery: ["pi", "session-discovery"] as const,
};

export const invalidatePiProviderCaches = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: piKeys.state }),
    queryClient.invalidateQueries({ queryKey: ["providers", "pi"] }),
    queryClient.invalidateQueries({ queryKey: ["piLiveProviderIds"] }),
  ]);

export function usePiCurrentState(enabled = true) {
  return useQuery({
    queryKey: piKeys.state,
    queryFn: piApi.getCurrentState,
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
