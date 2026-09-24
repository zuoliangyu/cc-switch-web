import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Database, FileText } from "lucide-react";
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

// 会话日志同步入口已迁到用量面板的"自动扫描会话记录"卡片（上游 cc-switch 5ff199b5）：
// 自动模式由后台定时扫描，手动模式在卡片上提供"立即同步"。
export function DataSourceBar({ refreshIntervalMs }: DataSourceBarProps) {
  const { t } = useTranslation();

  const { data: sources } = useQuery({
    queryKey: [...usageKeys.all, "data-sources"],
    queryFn: usageApi.getDataSourceBreakdown,
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    refetchIntervalInBackground: false,
  });

  if (!sources || sources.length === 0) {
    return null;
  }

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
    </div>
  );
}
