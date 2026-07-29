import React from "react";
import { RefreshCw, AlertCircle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";
import { useSubscriptionQuota } from "@/lib/query/subscription";
import type { QuotaTier, SubscriptionQuota } from "@/types/subscription";

interface SubscriptionQuotaFooterProps {
  appId: AppId;
  inline?: boolean;
  isCurrent?: boolean;
}

interface SubscriptionQuotaViewProps {
  quota: SubscriptionQuota | undefined;
  loading: boolean;
  refetch: () => void;
  appIdForExpiredHint: string;
  inline?: boolean;
}

export const TIER_I18N_KEYS: Record<string, string> = {
  five_hour: "subscription.fiveHour",
  seven_day: "subscription.sevenDay",
  seven_day_opus: "subscription.sevenDayOpus",
  seven_day_sonnet: "subscription.sevenDaySonnet",
  gemini_pro: "subscription.geminiPro",
  gemini_flash: "subscription.geminiFlash",
  gemini_flash_lite: "subscription.geminiFlashLite",
  weekly_limit: "subscription.weeklyLimit",
  monthly: "subscription.monthly",
  credits: "subscription.credits",
  premium: "subscription.copilotPremium",
};

export function utilizationColor(utilization: number): string {
  if (utilization >= 90) return "text-red-500 dark:text-red-400";
  if (utilization >= 70) return "text-orange-500 dark:text-orange-400";
  return "text-green-600 dark:text-green-400";
}

export function countdownStr(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return null;

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function formatResetTime(
  resetsAt: string | null,
  t: (key: string, options?: Record<string, string>) => string,
): string | null {
  const time = countdownStr(resetsAt);
  if (!time) return null;
  return t("subscription.resetsIn", { time });
}

const HIDDEN_INLINE_TIERS = new Set(["seven_day_sonnet"]);

function formatRelativeTime(
  timestamp: number,
  now: number,
  t: (key: string, options?: { count?: number }) => string,
): string {
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 60) return t("usage.justNow");
  if (diff < 3600) {
    return t("usage.minutesAgo", { count: Math.floor(diff / 60) });
  }
  if (diff < 86400) {
    return t("usage.hoursAgo", { count: Math.floor(diff / 3600) });
  }
  return t("usage.daysAgo", { count: Math.floor(diff / 86400) });
}

export const SubscriptionQuotaView: React.FC<SubscriptionQuotaViewProps> = ({
  quota,
  loading,
  refetch,
  appIdForExpiredHint,
  inline = false,
}) => {
  const { t } = useTranslation();
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (!quota?.queriedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [quota?.queriedAt]);

  if (!quota || quota.credentialStatus === "not_found") return null;
  if (quota.credentialStatus === "parse_error") return null;

  if (quota.credentialStatus === "expired" && !quota.success) {
    if (inline) {
      return (
        <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs shadow-sm dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} />
            <span>{t("subscription.expired")}</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex-shrink-0 rounded p-1 transition-colors hover:bg-muted disabled:opacity-50"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm dark:border-amber-800 dark:bg-amber-900/20">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle size={14} />
            <div>
              <span className="font-medium">{t("subscription.expired")}</span>
              <span className="ml-2 text-amber-500/70 dark:text-amber-400/70">
                {t("subscription.expiredHint", { tool: appIdForExpiredHint })}
              </span>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex-shrink-0 rounded p-1 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-800/30"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
    );
  }

  if (!quota.success) {
    if (inline) {
      return (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-card px-3 py-2 text-xs shadow-sm">
          <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
            <AlertCircle size={12} />
            <span>{quota.error || t("subscription.queryFailed")}</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex-shrink-0 rounded p-1 transition-colors hover:bg-muted disabled:opacity-50"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-xl border border-border-default bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-red-500 dark:text-red-400">
            <AlertCircle size={14} />
            <span>{quota.error || t("subscription.queryFailed")}</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex-shrink-0 rounded p-1 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
    );
  }

  const tiers = quota.tiers || [];
  if (tiers.length === 0) return null;

  if (inline) {
    return (
      <div className="flex flex-shrink-0 flex-col items-end gap-1 whitespace-nowrap text-xs">
        <div className="flex items-center justify-end gap-2">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Clock size={10} />
            {quota.queriedAt
              ? formatRelativeTime(quota.queriedAt, now, t)
              : t("usage.never", { defaultValue: "从未更新" })}
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation();
              refetch();
            }}
            disabled={loading}
            className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {tiers
            .filter((tier) => !HIDDEN_INLINE_TIERS.has(tier.name))
            .map((tier) => (
              <TierBadge key={tier.name} tier={tier} t={t} />
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border-default bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("subscription.title", { defaultValue: "Subscription Quota" })}
        </span>
        <div className="flex items-center gap-2">
          {quota.queriedAt && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Clock size={10} />
              {formatRelativeTime(quota.queriedAt, now, t)}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="rounded p-1 transition-colors hover:bg-muted disabled:opacity-50"
            title={t("subscription.refresh")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {tiers.map((tier) => (
          <TierBar key={tier.name} tier={tier} t={t} />
        ))}
      </div>

      {quota.extraUsage?.isEnabled && (
        <div className="mt-2 border-t border-border-default pt-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium">{t("subscription.extraUsage")}: </span>
          <span className="tabular-nums">
            {quota.extraUsage.currency === "USD" ? "$" : ""}
            {(quota.extraUsage.usedCredits ?? 0).toFixed(2)}
            {quota.extraUsage.monthlyLimit != null && (
              <>
                {" "}
                / {quota.extraUsage.currency === "USD" ? "$" : ""}
                {quota.extraUsage.monthlyLimit.toFixed(2)}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export const TierBadge: React.FC<{
  tier: QuotaTier;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ tier, t }) => {
  const label = TIER_I18N_KEYS[tier.name]
    ? t(TIER_I18N_KEYS[tier.name])
    : tier.name;
  const countdown = countdownStr(tier.resetsAt);

  return (
    <div className="flex items-center gap-0.5">
      <span className="text-gray-500 dark:text-gray-400">{label}:</span>
      <span
        className={`font-semibold tabular-nums ${utilizationColor(tier.utilization)}`}
      >
        {t("subscription.utilization", { value: Math.round(tier.utilization) })}
      </span>
      {countdown && (
        <span className="ml-0.5 flex items-center gap-px text-muted-foreground/60">
          <Clock size={10} />
          {countdown}
        </span>
      )}
    </div>
  );
};

const TierBar: React.FC<{
  tier: QuotaTier;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ tier, t }) => {
  const label = TIER_I18N_KEYS[tier.name]
    ? t(TIER_I18N_KEYS[tier.name])
    : tier.name;
  const resetText = formatResetTime(tier.resetsAt, t);

  return (
    <div className="flex items-center gap-3 text-xs">
      <span
        className="min-w-0 font-medium text-gray-500 dark:text-gray-400"
        style={{ width: "25%" }}
      >
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full rounded-full transition-all ${
            tier.utilization >= 90
              ? "bg-red-500"
              : tier.utilization >= 70
                ? "bg-orange-500"
                : "bg-green-500"
          }`}
          style={{ width: `${Math.min(tier.utilization, 100)}%` }}
        />
      </div>
      <div
        className="flex flex-shrink-0 items-center gap-2"
        style={{ width: "30%" }}
      >
        <span
          className={`font-semibold tabular-nums ${utilizationColor(tier.utilization)}`}
        >
          {Math.round(tier.utilization)}%
        </span>
        {resetText && (
          <span
            className="truncate text-[10px] text-muted-foreground/70"
            title={resetText}
          >
            {resetText}
          </span>
        )}
      </div>
    </div>
  );
};

const SubscriptionQuotaFooter: React.FC<SubscriptionQuotaFooterProps> = ({
  appId,
  inline = false,
  isCurrent = false,
}) => {
  const { data: quota, isFetching: loading, refetch } = useSubscriptionQuota(
    appId,
    isCurrent,
    isCurrent,
  );

  if (!isCurrent) return null;

  return (
    <SubscriptionQuotaView
      quota={quota}
      loading={loading}
      refetch={refetch}
      appIdForExpiredHint={appId}
      inline={inline}
    />
  );
};

export default SubscriptionQuotaFooter;
