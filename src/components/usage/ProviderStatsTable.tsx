import { TablePagination, useClientPagination } from "./TablePagination";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProviderStats } from "@/lib/query/usage";
import type { UsageRangeSelection } from "@/types/usage";
import {
  fmtUsd,
  formatTokensPerSecond,
  getAggregateTokensPerSecond,
} from "./format";
import { compareProviderNames } from "@/utils/providerSort";

interface ProviderStatsTableProps {
  range: UsageRangeSelection;
  appType?: string;
  refreshIntervalMs: number;
}

export function ProviderStatsTable({
  range,
  appType,
  refreshIntervalMs,
}: ProviderStatsTableProps) {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useProviderStats(
    range,
    { appType },
    {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  );

  const pagination = useClientPagination(
    [...(stats ?? [])].sort((a, b) =>
      compareProviderNames(a.providerName, b.providerName),
    ),
    JSON.stringify([range, appType]),
  );

  if (isLoading) {
    return <div className="h-[400px] animate-pulse rounded bg-gray-100" />;
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.provider", "Provider")}</TableHead>
            <TableHead className="text-right">
              {t("usage.requests", "请求数")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.tokens", "Tokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.cost", "成本")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.successRate", "成功率")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.avgLatency", "平均延迟")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.outputSpeed", "输出速度")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.estimatedSpeed", "估算速度")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats?.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-center text-muted-foreground"
              >
                {t("usage.noData", "暂无数据")}
              </TableCell>
            </TableRow>
          ) : (
            pagination.pageRows.map((stat) => (
              <TableRow key={stat.providerId}>
                <TableCell className="font-medium">
                  {stat.providerName}
                </TableCell>
                <TableCell className="text-right">
                  {stat.requestCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {stat.totalTokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {fmtUsd(stat.totalCost, 4)}
                </TableCell>
                <TableCell className="text-right">
                  {stat.successRate.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {stat.avgLatencyMs}ms
                </TableCell>
                <TableCell className="text-right">
                  {formatTokensPerSecond(
                    getAggregateTokensPerSecond(
                      stat.speedOutputTokens,
                      stat.speedGenerationMs,
                    ),
                  ) ?? "—"}{" "}
                  tps
                </TableCell>
                <TableCell className="text-right">
                  {formatTokensPerSecond(
                    getAggregateTokensPerSecond(
                      stat.estSpeedOutputTokens,
                      stat.estSpeedDurationMs,
                    ),
                  ) ?? "—"}{" "}
                  tps
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <TablePagination {...pagination} onPageChange={pagination.setPage} />
    </div>
  );
}
