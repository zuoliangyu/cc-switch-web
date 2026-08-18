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
  if (appId !== "claude" && appId !== "codex" && appId !== "grokbuild") {
    return false;
  }
  if (isOAuthProviderType(provider.meta?.providerType)) return true;

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
