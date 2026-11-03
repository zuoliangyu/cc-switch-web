import { Download, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AppId } from "@/lib/api/types";

interface ProviderEmptyStateProps {
  appId: AppId;
  onCreate?: () => void;
  onImport?: () => void;
}

export function ProviderEmptyState({
  appId,
  onCreate,
  onImport,
}: ProviderEmptyStateProps) {
  const { t } = useTranslation();
  // MiniMax Code 自动合并原生自定义供应商，不提供手动导入入口。
  // Kimi 的列表同样直接读原生 config.toml，没有可导入的“当前配置”；
  // Oh My Pi、DeepSeek Harness 的空状态提示从 + 添加 API Key 供应商
  const emptyCopyNs =
    appId === "mcode" || appId === "kimi" || appId === "omp" || appId === "dsh"
      ? appId
      : null;
  const showSnippetHint =
    appId === "claude" || appId === "codex" || appId === "gemini";

  return (
    <div className="glass-card flex flex-col items-center justify-center rounded-[30px] border border-dashed border-border-default p-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background/80 shadow-sm">
        <Users className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {t("provider.workspaceLabel", {
          defaultValue: "Provider Workspace",
        })}
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-tight">
        {t(emptyCopyNs ? `${emptyCopyNs}.empty.title` : "provider.noProviders")}
      </h3>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {t(
          emptyCopyNs
            ? `${emptyCopyNs}.empty.description`
            : "provider.noProvidersDescription",
        )}
      </p>
      {showSnippetHint && (
        <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
          {t("provider.noProvidersDescriptionSnippet")}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {onImport && (
          <Button onClick={onImport} className="theme-primary-solid">
            <Download className="mr-2 h-4 w-4" />
            {t("provider.importCurrent")}
          </Button>
        )}
        {onCreate && (
          <Button variant={onImport ? "outline" : "default"} onClick={onCreate}>
            {t("provider.addProvider")}
          </Button>
        )}
      </div>
    </div>
  );
}
