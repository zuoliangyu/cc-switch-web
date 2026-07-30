import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getWebAccessKey,
  getWebAuthStatus,
  verifyWebAccessKey,
  WEB_AUTH_REQUIRED_EVENT,
} from "@/lib/runtime/client/web";

type GateState = "checking" | "locked" | "unlocked" | "unavailable";

export function AccessKeyGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>("checking");
  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const checkAccess = useCallback(async () => {
    setState("checking");
    setInvalid(false);
    try {
      const { required } = await getWebAuthStatus();
      if (!required) {
        setState("unlocked");
        return;
      }

      const savedKey = getWebAccessKey();
      if (!savedKey) {
        setState("locked");
        return;
      }

      try {
        await verifyWebAccessKey(savedKey);
        setState("unlocked");
      } catch {
        setState("locked");
      }
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void checkAccess();
    const lock = () => setState("locked");
    window.addEventListener(WEB_AUTH_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(WEB_AUTH_REQUIRED_EVENT, lock);
  }, [checkAccess]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessKey.trim()) return;
    setSubmitting(true);
    setInvalid(false);
    try {
      await verifyWebAccessKey(accessKey);
      setAccessKey("");
      setState("unlocked");
    } catch {
      setInvalid(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "unlocked") return children;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      {state === "checking" ? (
        <LoaderCircle
          className="h-7 w-7 animate-spin text-primary"
          aria-label={t("auth.checking", "正在检查访问权限")}
        />
      ) : (
        <section className="w-full max-w-sm rounded-lg border border-border-default bg-card p-6 shadow-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">CC Switch Web</h1>
              <p className="text-sm text-muted-foreground">
                {state === "unavailable"
                  ? t("auth.serviceUnavailable", "服务暂时不可用")
                  : t("auth.prompt", "请输入访问密钥以继续")}
              </p>
            </div>
          </div>

          {state === "unavailable" ? (
            <Button className="w-full" onClick={() => void checkAccess()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("auth.retry", "重试")}
            </Button>
          ) : (
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="web-access-key" className="text-sm font-medium">
                  {t("auth.accessKey", "访问密钥")}
                </label>
                <div className="relative">
                  <Input
                    id="web-access-key"
                    type={showKey ? "text" : "password"}
                    value={accessKey}
                    onChange={(event) => setAccessKey(event.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    aria-invalid={invalid}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={t(
                      showKey ? "auth.hideKey" : "auth.showKey",
                      showKey ? "隐藏访问密钥" : "显示访问密钥",
                    )}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {invalid && (
                  <p className="text-sm text-destructive" role="alert">
                    {t("auth.invalidKey", "访问密钥无效")}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !accessKey.trim()}
              >
                {submitting && (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t(
                  submitting ? "auth.signingIn" : "auth.signIn",
                  submitting ? "正在登录..." : "登录",
                )}
              </Button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
