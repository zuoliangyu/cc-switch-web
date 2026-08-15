import React from "react";
import { useTranslation } from "react-i18next";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { AppId } from "@/lib/api/types";
import { APP_IDS, APP_ICON_MAP } from "@/config/appConfig";
import { cn } from "@/lib/utils";

interface AppCountBarProps {
  totalLabel: string;
  counts: Partial<Record<AppId, number>>;
  appIds?: readonly AppId[];
  totalCount?: number;
  onToggleAll?: (app: AppId, enabled: boolean) => void | Promise<void>;
  pendingApp?: AppId | null;
  disabled?: boolean;
}

export const AppCountBar: React.FC<AppCountBarProps> = ({
  totalLabel,
  counts,
  appIds = APP_IDS,
  totalCount,
  onToggleAll,
  pendingApp,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const bulkEnabled = totalCount !== undefined && !!onToggleAll;
  const bulkTotal = totalCount ?? 0;
  const hasPending = pendingApp !== undefined && pendingApp !== null;

  return (
    <div className="mb-4 flex flex-shrink-0 items-center gap-4 rounded-xl border border-white/10 px-6 py-4 glass">
      <Badge
        variant="outline"
        className="h-7 shrink-0 whitespace-nowrap bg-background/50 px-3"
      >
        {totalLabel}
      </Badge>
      <div className="min-w-0 flex-1 overflow-x-auto no-scrollbar">
        <div className="ml-auto flex w-max min-w-full items-center justify-end gap-2">
          {appIds.map((app) => {
            const count = counts[app] ?? 0;
            const allEnabled =
              bulkEnabled && bulkTotal > 0 && count >= bulkTotal;
            const partiallyEnabled =
              bulkEnabled && count > 0 && count < bulkTotal;

            if (!bulkEnabled) {
              return (
                <Badge
                  key={app}
                  variant="secondary"
                  className={APP_ICON_MAP[app].badgeClass}
                >
                  <span className="opacity-75">{APP_ICON_MAP[app].label}:</span>
                  <span className="ml-1 font-bold">{count}</span>
                </Badge>
              );
            }

            const actionLabel = allEnabled
              ? t("common.disableAllForApp", { app: APP_ICON_MAP[app].label })
              : t("common.enableAllForApp", { app: APP_ICON_MAP[app].label });
            const pending = pendingApp === app;

            return (
              <button
                key={app}
                type="button"
                role="checkbox"
                aria-checked={partiallyEnabled ? "mixed" : allEnabled}
                aria-busy={pending}
                aria-label={actionLabel}
                title={actionLabel}
                disabled={disabled || bulkTotal === 0 || hasPending}
                onClick={() => void onToggleAll?.(app, !allEnabled)}
                className={cn(
                  badgeVariants({ variant: "secondary" }),
                  APP_ICON_MAP[app].badgeClass,
                  "shrink-0 cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
                  pending && "cursor-wait disabled:cursor-wait",
                )}
              >
                <span className="opacity-75">{APP_ICON_MAP[app].label}:</span>
                <span className="ml-1 font-bold">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
