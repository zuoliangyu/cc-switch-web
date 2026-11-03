import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  ManagedAccountsGroup,
  type GroupAccountRow,
} from "@/components/settings/auth/ManagedAccountsGroup";
import { QuotaRefreshCell } from "@/components/settings/auth/AccountQuota";
import {
  dshApi,
  type DshAccountStatus,
  type DshLoginStart,
  type DshWallet,
} from "@/lib/api/dsh";
import { deliverLoginLink } from "@/lib/authLoginLink";
import { extractErrorMessage } from "@/utils/errorUtils";

/** 授权中心和 DeepSeek Harness 供应商页共用一份查询：登录本来就是 Web / Desktop 共用的 */
export const DSH_ACCOUNT_STATUS_KEY = ["dsh-account-status"] as const;

export function useDshAccountStatus(enabled = true) {
  return useQuery({
    queryKey: DSH_ACCOUNT_STATUS_KEY,
    queryFn: dshApi.accountStatus,
    staleTime: 60_000,
    enabled,
  });
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$" };

function formatWallet({ currency, balance }: DshWallet): string {
  const amount = Number(balance);
  const text = Number.isFinite(amount) ? amount.toFixed(2) : balance;
  const symbol = CURRENCY_SYMBOL[currency];
  return symbol ? `${symbol}${text}` : `${text} ${currency}`;
}

export function accountName(
  status: DshAccountStatus,
  fallback: string,
): string {
  return status.profile?.name ?? status.profile?.contact ?? fallback;
}

/**
 * 右侧额度列：余额一行、赠金一行（DeepSeek Harness 也分开显示，免得把赠金当成充值），
 * 写在别的服务「剩余 xx%」那一格的位置；刷新用各服务共用的「x 分钟前 ↻」。
 */
function DshBalance({
  login,
  status,
  queriedAt,
  loading,
  onRefresh,
}: {
  login: string;
  status: DshAccountStatus;
  queriedAt: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const wallets = status.wallets.map(formatWallet).join(" · ");
  const bonus = status.bonusWallets.map(formatWallet).join(" · ");
  // 右边让出倒计时格（52）和间距（8），和别的账号「剩余 xx%」那一格右对齐
  const cell = "me-[60px] self-end text-xs tabular-nums";
  return (
    <>
      <div className="flex w-[212px] shrink-0 flex-col justify-center gap-0.5">
        {status.error ? (
          <span className={`${cell} text-muted-foreground`}>
            {t("dsh.account.balanceFailed")}
          </span>
        ) : (
          <>
            <span className={`${cell} text-foreground`}>
              {t("dsh.account.balance", { amount: wallets || "—" })}
            </span>
            {bonus && (
              <span className={`${cell} text-muted-foreground`}>
                {t("dsh.account.bonus", { amount: bonus })}
              </span>
            )}
          </>
        )}
      </div>
      <QuotaRefreshCell
        login={login}
        queriedAt={queriedAt}
        loading={loading}
        onRefresh={onRefresh}
      />
    </>
  );
}

const POLL_INTERVAL_MS = 2_000;

/**
 * 浏览器登录：后端起本机回调、向平台登记，这里打开授权页并轮询，直到登录写进共用的凭据文件。
 * 回调落在服务端本机，浏览器要和服务端在同一台机器上才能完成授权。
 */
function useDshLogin(onSignedIn: () => void) {
  const { t } = useTranslation();
  const [flow, setFlow] = useState<DshLoginStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flowRef = useRef<DshLoginStart | null>(null);
  flowRef.current = flow;

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const next = await dshApi.loginStart();
      setFlow(next);
      void deliverLoginLink(next.authUrl, t);
    } catch (e) {
      setFlow(null);
      setError(extractErrorMessage(e) || t("dsh.account.signInFailed"));
    } finally {
      setStarting(false);
    }
  }, [t]);

  const cancel = useCallback(() => {
    const current = flowRef.current;
    if (current) void dshApi.loginCancel(current.flowId).catch(() => {});
    setFlow(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!flow || error) return;
    const timer = window.setInterval(() => {
      dshApi
        .loginPoll(flow.flowId)
        .then((done) => {
          if (!done || flowRef.current?.flowId !== flow.flowId) return;
          setFlow(null);
          toast.success(t("dsh.account.signedIn"));
          onSignedIn();
        })
        .catch((e) =>
          setError(extractErrorMessage(e) || t("dsh.account.signInFailed")),
        );
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flow, error, onSignedIn, t]);

  // 离开页面时撤下还在等的登录，本机回调端口随之关闭
  useEffect(
    () => () => {
      const current = flowRef.current;
      if (current) void dshApi.loginCancel(current.flowId).catch(() => {});
    },
    [],
  );

  return {
    start,
    login: {
      starting,
      polling: Boolean(flow) && !error,
      pollingState: error
        ? ("error" as const)
        : flow
          ? ("polling" as const)
          : ("idle" as const),
      // 没有验证码：等待块只显示「在浏览器里继续」和打开授权页的按钮
      deviceCode: flow
        ? { user_code: "", verification_uri: flow.authUrl }
        : null,
      error,
      onCancel: cancel,
      onRetry: () => void start(),
    },
  };
}

interface DshAccountLoginProps {
  helpSide?: "top" | "bottom";
}

/**
 * 授权中心的 DeepSeek 账号组。登录和 DeepSeek Harness Web 走同一套浏览器授权，结果写进
 * `$DSH_HOME/.credentials.yaml`，Web 与 Desktop 共用（运行中的 DeepSeek Harness 会自动重新读取）；
 * 这里显示账号和余额，可以退出（两端同时退出）。
 */
export function DshAccountLogin({ helpSide }: DshAccountLoginProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useDshAccountStatus();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const refreshStatus = useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: DSH_ACCOUNT_STATUS_KEY }),
    [queryClient],
  );
  const { start, login } = useDshLogin(refreshStatus);
  const signOut = useMutation({
    mutationFn: dshApi.accountSignOut,
    onSuccess: async () => {
      setConfirmSignOut(false);
      await queryClient.invalidateQueries({ queryKey: DSH_ACCOUNT_STATUS_KEY });
    },
    onError: (error) =>
      toast.error(t("dsh.account.signOutFailed"), {
        description: extractErrorMessage(error) || undefined,
      }),
  });

  const data = status.data;
  const name = data ? accountName(data, t("dsh.account.unnamed")) : "";
  const rows: GroupAccountRow[] =
    data?.signedIn === true
      ? [
          {
            id: "default",
            login: name,
            avatarUrl: data.profile?.avatarUrl,
            details: data.expired
              ? [t("dsh.account.expired")]
              : [
                  data.profile?.name ? data.profile.contact : null,
                  t("dsh.account.shared"),
                ].filter(Boolean),
            isDefault: false,
            needsReauth: data.expired,
            users: [],
            quota: data.expired ? undefined : (
              <DshBalance
                login={name}
                status={data}
                queriedAt={status.dataUpdatedAt}
                loading={status.isFetching}
                onRefresh={() => void status.refetch()}
              />
            ),
            removeLabel: t("dsh.account.signOut"),
          },
        ]
      : [];

  return (
    <ManagedAccountsGroup
      slug="dsh"
      name="DeepSeek Harness"
      iconName="deepseek"
      help={t("dsh.account.help")}
      helpSide={helpSide}
      accounts={rows}
      status={status.isError ? "error" : status.isSuccess ? "ready" : "loading"}
      statusErrorText={t("dsh.account.statusFailed")}
      onRetryStatus={() => void status.refetch()}
      emptyText={t("dsh.account.empty")}
      onAdd={() => void start()}
      // 只有登录失效的那一行才出「重新登录」
      canReauth
      onReauth={() => void start()}
      onSetDefault={() => undefined}
      settingDefault={false}
      onRemove={() => setConfirmSignOut(true)}
      removing={signOut.isPending}
      login={login}
    >
      <ConfirmDialog
        isOpen={confirmSignOut}
        title={t("dsh.account.signOut")}
        message={t("dsh.account.signOutConfirm", { name })}
        pending={signOut.isPending}
        confirmText={t("dsh.account.signOut")}
        onConfirm={() => signOut.mutate()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </ManagedAccountsGroup>
  );
}

/**
 * DeepSeek Harness 供应商页最前面的官方账号卡：登录了才有。账号下的模型由 DeepSeek Harness
 * 自带的账号插件提供，不写进 profile，所以这张卡不是供应商行，不能编辑或移除；登录、退出在授权中心。
 */
export function DshAccountCard({ status }: { status: DshAccountStatus }) {
  const { t } = useTranslation();
  const name = accountName(status, t("dsh.account.unnamed"));
  const balance = status.wallets.map(formatWallet).join(" · ");
  return (
    <div
      className="glass-card relative overflow-hidden rounded-[28px] border border-border-default p-5 text-card-foreground sm:p-6"
      title={t("dsh.account.managedHint")}
    >
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-border-default bg-background/80 shadow-sm">
            <ProviderIcon icon="deepseek" name={name} size={20} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-h-7 flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-semibold leading-none tracking-tight">
                {name}
              </h3>
              <span className="inline-flex items-center rounded-md border border-border-default px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {t("providerCard.chip.official")}
              </span>
              {status.expired && (
                <span
                  className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  title={t("dsh.account.expired")}
                >
                  {t("dsh.account.expiredChip")}
                </span>
              )}
            </div>
            <p className="m-0 truncate text-sm text-muted-foreground">
              {t("dsh.account.cardSubtitle")}
            </p>
          </div>
        </div>
        {balance && !status.error && !status.expired && (
          <span className="max-w-[208px] truncate text-xs tabular-nums text-muted-foreground">
            {t("dsh.account.balance", { amount: balance })}
          </span>
        )}
      </div>
    </div>
  );
}
