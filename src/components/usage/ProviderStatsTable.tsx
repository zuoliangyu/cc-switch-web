import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProviderStats } from "@/lib/query/usage";
import { TablePagination, useClientPagination } from "./TablePagination";
import { cn } from "@/lib/utils";
import {
  fmtInt,
  formatTokensCompact,
  getLocaleFromLanguage,
  getResolvedLang,
} from "./format";
import { usageTable } from "./usageTable";
import { getUsageProviderLabel, usageProviderTitle } from "./providerLabel";
import { PerformanceCells, PerformanceHeaders } from "./statsColumns";
import type { UsageRangeSelection } from "@/types/usage";
import { useMoneyFormat } from "@/hooks/useMoneyFormat";

interface ProviderStatsTableProps {
  range: UsageRangeSelection;
  appType?: string;
  providerName?: string;
  model?: string;
  refreshIntervalMs: number;
}

export function ProviderStatsTable({
  range,
  appType,
  providerName,
  model,
  refreshIntervalMs,
}: ProviderStatsTableProps) {
  const { t, i18n } = useTranslation();
  const { money, moneyTitle } = useMoneyFormat();
  const locale = getLocaleFromLanguage(getResolvedLang(i18n));
  const { data: stats, isLoading } = useProviderStats(
    range,
    { appType, providerName, model },
    {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  );

  // Web 的供应商列表一律按显示名称 A–Z（忽略大小写），不按请求数或金额排名；
  // 上游这里按请求数从多到少。同名供应商在不同应用下各一行，再按应用排
  const rows = useMemo(
    () =>
      [...(stats ?? [])].sort(
        (a, b) =>
          getUsageProviderLabel(a.providerName, t).label.localeCompare(
            getUsageProviderLabel(b.providerName, t).label,
            undefined,
            { sensitivity: "base" },
          ) || (a.appType ?? "").localeCompare(b.appType ?? ""),
      ),
    [stats, t],
  );
  const pagination = useClientPagination(
    rows,
    JSON.stringify([range, appType, providerName, model]),
  );

  if (isLoading) {
    return <div className={usageTable.skeleton} />;
  }

  return (
    <div className="flex flex-col">
      <div className={usageTable.scroller}>
        {/* 和请求日志同一套列组与取宽：按内容取宽、至少铺满面板，放不下横向滚动 */}
        <table
          className={cn(usageTable.table, "w-max min-w-full")}
          aria-label={t("usage.providerStats")}
        >
          <thead>
            <tr className={usageTable.headRow}>
              <th className={usageTable.th} aria-sort="ascending">
                {t("usage.provider")}
              </th>
              <th className={usageTable.th}>{t("usage.requests")}</th>
              <th className={cn(usageTable.th, usageTable.groupGap)}>
                {t("usage.cost")}
              </th>
              <th className={cn(usageTable.th, usageTable.groupGap)}>
                {t("usage.tokens")}
              </th>
              <PerformanceHeaders />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={usageTable.empty}>
                  {t("usage.noData")}
                </td>
              </tr>
            ) : (
              pagination.pageRows.map((stat) => {
                const provider = getUsageProviderLabel(stat.providerName, t);
                return (
                  <tr
                    key={JSON.stringify([stat.appType, stat.providerId])}
                    className={usageTable.row}
                  >
                    <td className={usageTable.td}>
                      <span title={usageProviderTitle(provider)}>
                        {provider.label}
                      </span>
                    </td>
                    <td className={usageTable.td}>
                      {fmtInt(stat.requestCount, locale)}
                    </td>
                    <td
                      className={cn(
                        usageTable.td,
                        usageTable.groupGap,
                        "font-medium",
                      )}
                      title={moneyTitle(stat.totalCost, 6)}
                    >
                      {money(stat.totalCost, 2)}
                    </td>
                    <td
                      className={cn(usageTable.td, usageTable.groupGap)}
                      title={fmtInt(stat.totalTokens, locale)}
                    >
                      {formatTokensCompact(stat.totalTokens, locale)}
                    </td>
                    <PerformanceCells stat={stat} />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
