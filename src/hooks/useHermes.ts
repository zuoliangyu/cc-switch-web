import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { providersApi } from "@/lib/api/providers";
import { hermesApi } from "@/lib/api/hermes";
import type { HermesMemoryKind } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";

export const HERMES_WEB_OFFLINE_ERROR = "hermes_web_offline";

export const hermesKeys = {
  all: ["hermes"] as const,
  health: ["hermes", "health"] as const,
  liveProviderIds: ["hermes", "liveProviderIds"] as const,
  modelConfig: ["hermes", "modelConfig"] as const,
  memory: (kind: HermesMemoryKind) => ["hermes", "memory", kind] as const,
  memoryLimits: ["hermes", "memoryLimits"] as const,
};

export function invalidateHermesProviderCaches(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: hermesKeys.liveProviderIds }),
    queryClient.invalidateQueries({ queryKey: hermesKeys.modelConfig }),
    queryClient.invalidateQueries({ queryKey: hermesKeys.health }),
  ]);
}

export function useHermesLiveProviderIds(enabled: boolean) {
  return useQuery({
    queryKey: hermesKeys.liveProviderIds,
    queryFn: () => providersApi.getHermesLiveProviderIds(),
    enabled,
  });
}

export function useHermesHealth(enabled: boolean) {
  return useQuery({
    queryKey: hermesKeys.health,
    queryFn: () => hermesApi.scanHealth(),
    staleTime: 30_000,
    enabled,
  });
}

export function useHermesModelConfig(enabled: boolean) {
  return useQuery({
    queryKey: hermesKeys.modelConfig,
    queryFn: () => hermesApi.getModelConfig(),
    enabled,
  });
}

export function useOpenHermesWebUI(onOffline?: () => void) {
  const { t } = useTranslation();

  return useCallback(
    async (path?: string) => {
      try {
        await hermesApi.openWebUI(path);
      } catch (error) {
        const detail = extractErrorMessage(error);
        if (detail === HERMES_WEB_OFFLINE_ERROR) {
          if (onOffline) {
            onOffline();
          } else {
            toast.error(t("hermes.webui.offline"));
          }
          return;
        }

        toast.error(t("hermes.webui.openFailed"), {
          description: detail || undefined,
        });
      }
    },
    [onOffline, t],
  );
}

export function useHermesMemory(kind: HermesMemoryKind, enabled: boolean) {
  return useQuery({
    queryKey: hermesKeys.memory(kind),
    queryFn: () => hermesApi.getMemory(kind),
    enabled,
  });
}

export function useHermesMemoryLimits(enabled: boolean) {
  return useQuery({
    queryKey: hermesKeys.memoryLimits,
    queryFn: () => hermesApi.getMemoryLimits(),
    staleTime: 60_000,
    enabled,
  });
}

export function useSaveHermesMemory() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      kind,
      content,
    }: {
      kind: HermesMemoryKind;
      content: string;
    }) => hermesApi.setMemory(kind, content),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: hermesKeys.memory(variables.kind),
      });
    },
    onError: (error) => {
      toast.error(t("hermes.memory.saveFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    },
  });
}

export function useToggleHermesMemoryEnabled() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      kind,
      enabled,
    }: {
      kind: HermesMemoryKind;
      enabled: boolean;
    }) => hermesApi.setMemoryEnabled(kind, enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: hermesKeys.memoryLimits,
      });
    },
    onError: (error) => {
      toast.error(t("hermes.memory.toggleFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    },
  });
}
