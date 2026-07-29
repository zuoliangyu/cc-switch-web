import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { isOAuthProviderType } from "@/config/constants";
import {
  extractCodexWireApi,
  isCodexAnthropicWireApi,
  isCodexChatWireApi,
} from "@/utils/providerConfigUtils";

/** 供应商是否必须由当前应用的本地路由接管。 */
export function providerNeedsRouting(
  appId: AppId,
  provider: Provider,
): boolean {
  if (provider.category === "official") return false;
  if (appId !== "claude" && appId !== "codex") return false;
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
