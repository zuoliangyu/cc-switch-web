// Provider 类型常量
export const PROVIDER_TYPES = {
  GITHUB_COPILOT: "github_copilot",
  CODEX_OAUTH: "codex_oauth",
} as const;

const OAUTH_PROVIDER_TYPES = new Set<string>(Object.values(PROVIDER_TYPES));

/** 托管 OAuth 的凭据由本地路由注入。 */
export function isOAuthProviderType(
  providerType: string | null | undefined,
): boolean {
  return (
    typeof providerType === "string" && OAUTH_PROVIDER_TYPES.has(providerType)
  );
}

// 用量脚本模板类型常量
export const TEMPLATE_TYPES = {
  CUSTOM: "custom",
  GENERAL: "general",
  NEW_API: "newapi",
  GITHUB_COPILOT: "github_copilot",
  TOKEN_PLAN: "token_plan",
  BALANCE: "balance",
} as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[keyof typeof TEMPLATE_TYPES];
