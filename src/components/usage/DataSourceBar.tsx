import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usageApi } from "@/lib/api/usage";
import { usageKeys } from "@/lib/query/usage";

interface DataSourceBarProps {
  refreshIntervalMs: number;
}

const DATA_SOURCE_ICONS: Record<string, ReactNode> = {
  proxy: <Database className="h-3.5 w-3.5" />,
  session_log: <FileText className="h-3.5 w-3.5" />,
  codex_db: <Database className="h-3.5 w-3.5" />,
  codex_session: <FileText className="h-3.5 w-3.5" />,
  gemini_session: <FileText className="h-3.5 w-3.5" />,
  grok_session: <FileText className="h-3.5 w-3.5" />,
};

export function DataSourceBar({ refreshIntervalMs }: DataSourceBarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: sources } = useQuery({
    queryKey: [...usageKeys.all, "data-sources"],
    queryFn: usageApi.getDataSourceBreakdown,
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    refetchIntervalInBackground: false,
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await usageApi.syncSessionUsage();
      if (result.imported > 0) {
        toast.success(
          t("usage.sessionSync.imported", { count: result.imported }),
        );
        queryClient.invalidateQueries({ queryKey: usageKeys.all });
      } else {
        toast.info(t("usage.sessionSync.upToDate"));
      }
    } catch {
      toast.error(t("usage.sessionSync.failed"));
    } finally {
      setSyncing(false);
    }
  };

  if (!sources || sources.length === 0) {
    return null;
  }

  const hasNonProxy = sources.some((source) => source.dataSource !== "proxy");

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/70">
        {t("usage.dataSources")}:
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {sources.map((source) => (
          <div
            key={source.dataSource}
            className="flex items-center gap-1.5 rounded-md bg-background/50 px-2 py-1"
          >
            {DATA_SOURCE_ICONS[source.dataSource] ?? (
              <Database className="h-3.5 w-3.5" />
            )}
            <span>{t(`usage.dataSource.${source.dataSource}`)}</span>
            <span className="font-mono font-medium text-foreground/80">
              {source.requestCount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      <div className="ml-auto">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleSync}
          disabled={syncing}
          title={t("usage.sessionSync.trigger")}
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">
            {hasNonProxy
              ? t("usage.sessionSync.resync")
              : t("usage.sessionSync.import")}
          </span>
        </Button>
      </div>
    </div>
  );
}
