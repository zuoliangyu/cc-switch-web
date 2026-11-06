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
import { useModelStats } from "@/lib/query/usage";
import type { UsageRangeSelection } from "@/types/usage";
import { fmtUsd } from "./format";

interface ModelStatsTableProps {
  range: UsageRangeSelection;
  appType?: string;
  refreshIntervalMs: number;
}

export function ModelStatsTable({
  range,
  appType,
  refreshIntervalMs,
}: ModelStatsTableProps) {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useModelStats(
    range,
    { appType },
    {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  );

  const pagination = useClientPagination(
    stats ?? [],
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
            <TableHead>{t("usage.model", "模型")}</TableHead>
            <TableHead className="text-right">
              {t("usage.requests", "请求数")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.tokens", "Tokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.totalCost", "总成本")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.avgCost", "平均成本")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats?.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground"
              >
                {t("usage.noData", "暂无数据")}
              </TableCell>
            </TableRow>
          ) : (
            pagination.pageRows.map((stat) => (
              <TableRow key={stat.model}>
                <TableCell className="font-mono text-sm">
                  {stat.model}
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
                  {fmtUsd(stat.avgCostPerRequest, 6)}
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
