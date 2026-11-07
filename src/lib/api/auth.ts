import { invoke } from "@/lib/runtime/client/core";

export type ManagedAuthProvider =
  | "github_copilot"
  | "codex_oauth"
  | "xai_oauth"
  | "agy_oauth"
  | "claude_official";

/** 授权中心里可以定位到的分组：托管账号之外还有 Kimi Code 与 DeepSeek Harness 的登录 */
export type AuthCenterTarget =
  | ManagedAuthProvider
  | "kimi_oauth"
  | "dsh_account";

/** ChatGPT 托管账号的登录方式：浏览器（PKCE，回调落在服务端本机 1455 端口）或设备码 */
export type CodexLoginMethod = "browser" | "device_code";
/**
 * 传给 `auth_start_login` 的登录方式（不传＝各服务的默认方式）。`copy_link` 只给 Claude 官方账号：
 * Web 服务端从不替用户开浏览器，授权页地址总是交回前端。
 */
export type ManagedLoginMethod = CodexLoginMethod | "copy_link";

export const CODEX_OAUTH_DUPLICATE_ACCOUNT_ERROR =
  "codex_oauth_duplicate_account";

export interface ManagedAuthAccount {
  id: string;
  provider: ManagedAuthProvider;
  login: string;
  avatar_url: string | null;
  authenticated_at: number;
  is_default: boolean;
  github_domain?: string;
  /** Codex-only: the account lacks identity or workspace metadata required for binding. */
  reauth_required?: boolean;
  /** xAI-only: the refresh credential is invalid and the account is unusable. */
  requires_reauth: boolean;
  /** Claude official only: when the sign-in of an account not in Claude Code's default slot expires (ms, as last recorded). */
  login_expires_at?: number | null;
  /** Claude official only: plan (`pro` / `max` / `team` / `enterprise`) from the account's sign-in. */
  plan?: string | null;
  /** Claude official only: `rateLimitTier` (e.g. `default_claude_max_20x`), tells Max 5x from 20x. */
  rate_limit_tier?: string | null;
}

export interface ManagedAuthStatus {
  provider: ManagedAuthProvider;
  authenticated: boolean;
  default_account_id: string | null;
  migration_error?: string | null;
  accounts: ManagedAuthAccount[];
}

export interface ManagedAuthDeviceCodeResponse {
  provider: ManagedAuthProvider;
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function authStartLogin(
  authProvider: ManagedAuthProvider,
  targetAccountId?: string,
  loginMethod?: ManagedLoginMethod,
): Promise<ManagedAuthDeviceCodeResponse> {
  return invoke<ManagedAuthDeviceCodeResponse>("auth_start_login", {
    authProvider,
    targetAccountId: targetAccountId || null,
    ...(loginMethod ? { loginMethod } : {}),
  });
}

export async function authPollForAccount(
  authProvider: ManagedAuthProvider,
  deviceCode: string,
): Promise<ManagedAuthAccount | null> {
  return invoke<ManagedAuthAccount | null>("auth_poll_for_account", {
    authProvider,
    deviceCode,
  });
}

export async function authCancelLogin(
  authProvider: ManagedAuthProvider,
  deviceCode: string,
): Promise<boolean> {
  return invoke<boolean>("auth_cancel_login", {
    authProvider,
    deviceCode,
  });
}

export async function authListAccounts(
  authProvider: ManagedAuthProvider,
): Promise<ManagedAuthAccount[]> {
  return invoke<ManagedAuthAccount[]>("auth_list_accounts", {
    authProvider,
  });
}

export async function authGetStatus(
  authProvider: ManagedAuthProvider,
): Promise<ManagedAuthStatus> {
  return invoke<ManagedAuthStatus>("auth_get_status", {
    authProvider,
  });
}

export async function authRemoveAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
): Promise<void> {
  return invoke("auth_remove_account", {
    authProvider,
    accountId,
  });
}

export async function authSetDefaultAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
): Promise<void> {
  return invoke("auth_set_default_account", {
    authProvider,
    accountId,
  });
}

export async function authLogout(
  authProvider: ManagedAuthProvider,
): Promise<void> {
  return invoke("auth_logout", {
    authProvider,
  });
}

/** 切号后提醒用：在跑的 agy 还用旧账号，续期时可能把旧登录写回钥匙串。 */
export async function agyAccountIsRunning(): Promise<boolean> {
  return invoke<boolean>("agy_account_is_running");
}

/** Claude 官方账号登录：浏览器回不到服务端本机时，把落地页地址或页面上的代码交给正在等待的登录。 */
export async function claudeAccountSubmitPaste(
  flowId: string,
  pasted: string,
): Promise<void> {
  return invoke("claude_account_submit_paste", { flowId, pasted });
}

/** 切卡时切换 Claude Code 登录的状态。 */
export interface ClaudeLoginSwitchStatus {
  /** 切到选了账号的官方卡时会切换登录（没被挡住） */
  active: boolean;
  /** 不切换登录的原因：配置目录在 WSL 里（账号功能不可用）；设了别的 Claude 配置目录覆盖 */
  blocked: "wsl" | "overrideDir" | null;
  /** Claude Code 现在登录的账号 key */
  live: string | null;
}

export async function getClaudeLoginSwitch(): Promise<ClaudeLoginSwitchStatus> {
  return invoke<ClaudeLoginSwitchStatus>("get_claude_login_switch");
}

export const authApi = {
  agyAccountIsRunning,
  claudeAccountSubmitPaste,
  getClaudeLoginSwitch,
  authStartLogin,
  authPollForAccount,
  authCancelLogin,
  authListAccounts,
  authGetStatus,
  authRemoveAccount,
  authSetDefaultAccount,
  authLogout,
};
