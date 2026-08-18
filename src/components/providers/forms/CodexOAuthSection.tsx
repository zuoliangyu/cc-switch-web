import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  LogOut,
  Copy,
  Check,
  ExternalLink,
  Plus,
  X,
  Sparkles,
  User,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useManagedAuth } from "./hooks/useManagedAuth";
import { copyText } from "@/lib/clipboard";
import CodexOauthAccountQuota from "@/components/CodexOauthAccountQuota";

interface CodexOAuthSectionProps {
  className?: string;
  showAccountQuota?: boolean;
  selectedAccountId?: string | null;
  onAccountSelect?: (accountId: string | null) => void;
}

export const CodexOAuthSection: React.FC<CodexOAuthSectionProps> = ({
  className,
  showAccountQuota = false,
  selectedAccountId,
  onAccountSelect,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const {
    accounts,
    defaultAccountId,
    hasAnyAccount,
    pollingState,
    deviceCode,
    error,
    isPolling,
    isAddingAccount,
    isRemovingAccount,
    isSettingDefaultAccount,
    addAccount,
    removeAccount,
    setDefaultAccount,
    cancelAuth,
    logout,
  } = useManagedAuth("codex_oauth");

  const copyUserCode = async () => {
    if (!deviceCode?.user_code) return;
    await copyText(deviceCode.user_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAccountSelect = (value: string) => {
    onAccountSelect?.(value === "none" ? null : value);
  };

  const handleRemoveAccount = (accountId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    removeAccount(accountId);
    if (selectedAccountId === accountId) {
      onAccountSelect?.(null);
    }
  };

  return (
    <div className={`space-y-4 ${className || ""}`}>
      <div className="flex items-center justify-between">
        <Label>{t("codexOauth.authStatus", "认证状态")}</Label>
        <Badge
          variant={hasAnyAccount ? "default" : "secondary"}
          className={hasAnyAccount ? "bg-green-500 hover:bg-green-600" : ""}
        >
          {hasAnyAccount
            ? t("codexOauth.accountCount", {
                count: accounts.length,
                defaultValue: `${accounts.length} 个账号`,
              })
            : t("codexOauth.notAuthenticated", "未认证")}
        </Badge>
      </div>

      {hasAnyAccount && onAccountSelect && (
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            {t("codexOauth.selectAccount", "选择账号")}
          </Label>
          <Select
            value={selectedAccountId || "none"}
            onValueChange={handleAccountSelect}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  "codexOauth.selectAccountPlaceholder",
                  "选择一个 ChatGPT 账号",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">
                  {t("codexOauth.useDefaultAccount", "使用默认账号")}
                </span>
              </SelectItem>
              {accounts.map((account) => (
                <SelectItem
                  key={account.id}
                  value={account.id}
                  disabled={account.reauth_required}
                >
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{account.login}</span>
                    {account.reauth_required && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        {t("codexOauth.reauthBadge", "需要重新登录")}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {hasAnyAccount && (
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            {t("codexOauth.loggedInAccounts", "已登录账号")}
          </Label>
          <div className="space-y-1">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="space-y-2 rounded-md border bg-muted/30 p-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">{account.login}</span>
                    {defaultAccountId === account.id && (
                      <Badge variant="secondary" className="text-xs">
                        {t("codexOauth.defaultAccount", "默认")}
                      </Badge>
                    )}
                    {selectedAccountId === account.id && (
                      <Badge variant="outline" className="text-xs">
                        {t("codexOauth.selected", "已选中")}
                      </Badge>
                    )}
                    {account.reauth_required && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-400 text-xs text-amber-700"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {t("codexOauth.reauthBadge", "需要重新登录")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {account.reauth_required && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={addAccount}
                        disabled={isAddingAccount}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t("codexOauth.reauthLogin", "重新登录")}
                      </Button>
                    )}
                    {defaultAccountId !== account.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => setDefaultAccount(account.id)}
                        disabled={isSettingDefaultAccount}
                      >
                        {t("codexOauth.setAsDefault", "设为默认")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-500"
                      onClick={(event) =>
                        handleRemoveAccount(account.id, event)
                      }
                      disabled={isRemovingAccount}
                      title={t("codexOauth.removeAccount", "移除账号")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {showAccountQuota && (
                  <CodexOauthAccountQuota accountId={account.id} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnyAccount && pollingState === "idle" && (
        <Button
          type="button"
          onClick={addAccount}
          className="w-full"
          variant="outline"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t("codexOauth.loginWithChatGPT", "使用 ChatGPT 登录")}
        </Button>
      )}

      {hasAnyAccount && pollingState === "idle" && (
        <Button
          type="button"
          onClick={addAccount}
          className="w-full"
          variant="outline"
          disabled={isAddingAccount}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("codexOauth.addAnotherAccount", "添加其他账号")}
        </Button>
      )}

      {isPolling && deviceCode && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("codexOauth.waitingForAuth", "等待授权中...")}
          </div>

          <div className="text-center">
            <p className="mb-1 text-xs text-muted-foreground">
              {t("codexOauth.enterCode", "在浏览器中输入以下代码：")}
            </p>
            <div className="flex items-center justify-center gap-2">
              <code className="rounded border bg-background px-4 py-2 font-mono text-2xl font-bold tracking-wider">
                {deviceCode.user_code}
              </code>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={copyUserCode}
                title={t("codexOauth.copyCode", "复制代码")}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="text-center">
            <a
              href={deviceCode.verification_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {deviceCode.verification_uri}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelAuth}
            >
              {t("common.cancel", "取消")}
            </Button>
          </div>
        </div>
      )}

      {pollingState === "error" && error && (
        <div className="space-y-2">
          <p className="text-sm text-red-500">{error}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={addAccount}
              variant="outline"
              size="sm"
            >
              {t("codexOauth.retry", "重试")}
            </Button>
            <Button
              type="button"
              onClick={cancelAuth}
              variant="ghost"
              size="sm"
            >
              {t("common.cancel", "取消")}
            </Button>
          </div>
        </div>
      )}

      {hasAnyAccount && accounts.length > 1 && (
        <Button
          type="button"
          variant="outline"
          onClick={logout}
          className="w-full text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("codexOauth.logoutAll", "注销所有账号")}
        </Button>
      )}
    </div>
  );
};

export default CodexOAuthSection;
