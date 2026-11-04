import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { isOAuthProviderType } from "@/config/constants";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
  extractCodexWireApi,
  hasExplicitNonOpenAiCodexModelProvider,
  isCodexAnthropicWireApi,
  isCodexChatWireApi,
} from "@/utils/providerConfigUtils";
import { resolveManagedAccountId } from "@/lib/authBinding";

export const GROKBUILD_OFFICIAL_PROVIDER_ID = "grokbuild-official";
export const CODEX_OFFICIAL_PROVIDER_ID = "codex-official";
export const KIMI_OFFICIAL_PROVIDER_ID = "managed:kimi-code";

/** Kimi 官方账号卡：config.toml 里 type = "kimi" 且带 OAuth 引用（与后端 is_official_provider 一致） */
export function isKimiOfficialAccount(
  provider: Pick<Provider, "settingsConfig">,
): boolean {
  const config = provider.settingsConfig?.provider as
    | { type?: string; oauth?: { key?: unknown } }
    | undefined;
  const key = config?.oauth?.key;
  return (
    config?.type === "kimi" && typeof key === "string" && key.trim().length > 0
  );
}

export type CodexOfficialIdentity =
  | "native_login"
  | "managed_account"
  | "api_key";

const nonEmptyString = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

function hasExplicitCodexThirdPartyUpstream(
  settings: Record<string, unknown>,
): boolean {
  const config = typeof settings.config === "string" ? settings.config : "";
  return (
    nonEmptyString(settings.baseUrl) ||
    nonEmptyString(settings.baseURL) ||
    nonEmptyString(settings.base_url) ||
    Boolean(extractCodexExperimentalBearerToken(config)) ||
    Boolean(extractCodexBaseUrl(config)) ||
    hasExplicitNonOpenAiCodexModelProvider(config)
  );
}

export function resolveCodexOfficialIdentity(
  appId: AppId,
  provider: Pick<Provider, "id" | "category" | "meta" | "settingsConfig">,
): CodexOfficialIdentity | null {
  if (appId !== "codex") return null;
  const managedAccountId = resolveManagedAccountId(
    provider.meta,
    "codex_oauth",
  )?.trim();
  const fixedOfficial = provider.id === CODEX_OFFICIAL_PROVIDER_ID;
  if (fixedOfficial && provider.category === "official") {
    return managedAccountId ? "managed_account" : "native_login";
  }
  const settings = provider.settingsConfig as Record<string, unknown>;
  const auth = settings?.auth;
  if (
    !auth ||
    typeof auth !== "object" ||
    Array.isArray(auth) ||
    (settings.config != null && typeof settings.config !== "string") ||
    hasExplicitCodexThirdPartyUpstream(settings)
  ) {
    return null;
  }
  if (managedAccountId) return "managed_account";
  const apiKey = (auth as Record<string, unknown>).OPENAI_API_KEY;
  if (nonEmptyString(apiKey))
    return provider.category === "official" ? "api_key" : null;
  return fixedOfficial || provider.category === "official"
    ? "native_login"
    : null;
}

/**
 * 能否做「检测连通」（对 base_url 的可达性探测）。
 *
 * 探测需要一个真实的上游地址，所以两类卡片不参与：
 * - 官方账号卡：base_url 故意留空，走客户端默认 / OAuth 端点；
 * - OMO / OMO Slim：`settings_config` 里只有 agents / categories 的模型映射，
 *   没有 `npm` 与 `options.baseURL`，后端无从解析探测目标。要测上游请到它引用的
 *   OpenCode 供应商卡片上测。
 */
export function supportsConnectivityCheck(
  appId: AppId,
  provider: Pick<Provider, "category">,
): boolean {
  if (appId === "mcode" || appId === "dsh" || appId === "kimi") return false;
  return (
    provider.category !== "official" &&
    provider.category !== "omo" &&
    provider.category !== "omo-slim"
  );
}

export function supportsOfficialProxyTakeover(
  appId: AppId,
  provider: Pick<Provider, "id" | "category" | "meta" | "settingsConfig">,
): boolean {
  const identity = resolveCodexOfficialIdentity(appId, provider);
  return Boolean(identity && identity !== "api_key");
}

/** 供应商是否必须由当前应用的本地路由接管。 */
export function providerNeedsRouting(
  appId: AppId,
  provider: Provider,
): boolean {
  if (
    provider.category === "official" ||
    resolveCodexOfficialIdentity(appId, provider)
  ) {
    return false;
  }

  const isManagedOAuth = isOAuthProviderType(provider.meta?.providerType);

  // Desktop：模型映射卡（上游模型名 Desktop 不认）、托管 OAuth（凭据由路由注入）要经路由；
  // 和后端 claude_desktop_config::needs_routing 同一条规则
  if (appId === "claude-desktop") {
    return isManagedOAuth || provider.meta?.claudeDesktopMode === "proxy";
  }

  if (appId !== "claude" && appId !== "codex" && appId !== "grokbuild") {
    return false;
  }
  if (isManagedOAuth) return true;

  const format = provider.meta?.apiFormat;
  if (appId === "claude") {
    return (
      provider.meta?.isFullUrl === true || (!!format && format !== "anthropic")
    );
  }

  if (
    provider.meta?.isFullUrl === true ||
    format === "openai_chat" ||
    format === "anthropic"
  ) {
    return true;
  }

  const config = (provider.settingsConfig as Record<string, unknown>)?.config;
  if (typeof config !== "string") return false;
  const wireApi = extractCodexWireApi(config);
  return isCodexChatWireApi(wireApi) || isCodexAnthropicWireApi(wireApi);
}
