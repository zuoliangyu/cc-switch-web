import { invoke } from "@/lib/runtime/client/core";
import type {
  ClaudeAccountPlan,
  ClaudeAccountQuota,
  SubscriptionQuota,
} from "@/types/subscription";

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
  /** 绑了账号的 Claude 官方卡：按那个账号自己的登录查，带上它的套餐 */
  getClaudeAccountQuota(accountId: string): Promise<ClaudeAccountQuota> {
    return invoke("get_claude_account_quota", { accountId });
  },
  /** Claude Code 默认登录的套餐（没绑账号的官方卡显示） */
  getClaudeDefaultPlan(): Promise<ClaudeAccountPlan | null> {
    return invoke("get_claude_default_plan");
  },
  /** Antigravity 某个账号的剩余额度：用它自己的令牌直接查，不用先切号 */
  getAgyAccountQuota(accountId: string): Promise<SubscriptionQuota> {
    return invoke("agy_account_quota", { accountId });
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
