import { useQuery } from "@tanstack/react-query";
import { subscriptionApi } from "@/lib/api/subscription";
import type { AppId } from "@/lib/api/types";
import type { ProviderMeta } from "@/types";
import { resolveManagedAccountId } from "@/lib/authBinding";
import { PROVIDER_TYPES } from "@/config/constants";

const REFETCH_INTERVAL = 5 * 60 * 1000;

export function useSubscriptionQuota(
  appId: AppId,
  enabled: boolean,
  autoQuery = false,
) {
  return useQuery({
    queryKey: ["subscription", "quota", appId],
    queryFn: () => subscriptionApi.getQuota(appId),
    enabled:
      enabled && ["claude", "codex", "gemini", "grokbuild"].includes(appId),
    refetchInterval: autoQuery ? REFETCH_INTERVAL : false,
    refetchIntervalInBackground: autoQuery,
    refetchOnWindowFocus: autoQuery,
    staleTime: REFETCH_INTERVAL,
    retry: 1,
  });
}

export interface UseCodexOauthQuotaOptions {
  enabled?: boolean;
  autoQuery?: boolean;
  autoQueryIntervalMinutes?: number;
}

export function useCodexOauthQuota(
  meta: ProviderMeta | undefined,
  options: UseCodexOauthQuotaOptions = {},
) {
  const accountId = resolveManagedAccountId(meta, PROVIDER_TYPES.CODEX_OAUTH);
  return useCodexOauthQuotaByAccountId(accountId, options);
}

export function useCodexOauthQuotaByAccountId(
  accountId: string | null,
  options: UseCodexOauthQuotaOptions = {},
) {
  const {
    enabled = true,
    autoQuery = false,
    autoQueryIntervalMinutes = 5,
  } = options;
  const configuredInterval =
    autoQueryIntervalMinutes > 0
      ? Math.max(autoQueryIntervalMinutes, 1) * 60 * 1000
      : false;
  const refetchInterval = autoQuery ? configuredInterval : false;

  return useQuery({
    queryKey: ["codex_oauth", "quota", accountId ?? "default"],
    queryFn: () => subscriptionApi.getCodexOauthQuota(accountId),
    enabled,
    refetchInterval,
    refetchIntervalInBackground: Boolean(refetchInterval),
    refetchOnWindowFocus: Boolean(refetchInterval),
    staleTime: configuredInterval || REFETCH_INTERVAL,
    retry: 1,
  });
}

export function useXaiOauthQuota(
  meta: ProviderMeta | undefined,
  options: {
    enabled?: boolean;
    autoQuery?: boolean;
  } = {},
) {
  const { enabled = true, autoQuery = false } = options;
  const accountId = resolveManagedAccountId(meta, PROVIDER_TYPES.XAI_OAUTH);

  return useQuery({
    queryKey: ["xai_oauth", "quota", accountId ?? "default"],
    queryFn: () => subscriptionApi.getXaiOauthQuota(accountId),
    enabled,
    refetchInterval: autoQuery ? REFETCH_INTERVAL : false,
    refetchIntervalInBackground: autoQuery,
    refetchOnWindowFocus: autoQuery,
    staleTime: REFETCH_INTERVAL,
    retry: 1,
  });
}
