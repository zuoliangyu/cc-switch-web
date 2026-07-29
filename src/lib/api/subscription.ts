import { invoke } from "@/lib/runtime/client/core";
import type { SubscriptionQuota } from "@/types/subscription";

export const subscriptionApi = {
  getQuota(tool: string): Promise<SubscriptionQuota> {
    return invoke("get_subscription_quota", { tool });
  },
  getCodexOauthQuota(accountId: string | null): Promise<SubscriptionQuota> {
    return invoke("get_codex_oauth_quota", { accountId });
  },
  getXaiOauthQuota(accountId: string | null): Promise<SubscriptionQuota> {
    return invoke("get_xai_oauth_quota", { accountId });
  },
  getCodingPlanQuota(
    baseUrl: string,
    apiKey: string,
  ): Promise<SubscriptionQuota> {
    return invoke("get_coding_plan_quota", { baseUrl, apiKey });
  },
  getBalance(
    baseUrl: string,
    apiKey: string,
  ): Promise<import("@/types").UsageResult> {
    return invoke("get_balance", { baseUrl, apiKey });
  },
};
