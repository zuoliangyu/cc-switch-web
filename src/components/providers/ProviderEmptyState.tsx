import { Download, Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import type { AppId } from "@/lib/api/types";

interface ProviderEmptyStateProps {
  appId: AppId;
  onCreate?: () => void;
  onImport?: () => void;
}

/**
 * 供应商页空状态（上游 v7 空状态规则）：列表区居中，标题 + 操作按钮；
 * 辅助说明收进帮助卡，只保留各应用自己的说明和「切换只替换关键字段」这一句。
 */
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
  // 只有切换时写关键字段的应用说这句；Antigravity 没有切换，不成立
  const showKeyFieldsHint =
    appId === "claude" ||
    appId === "codex" ||
    appId === "gemini" ||
    appId === "grokbuild";

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <Server className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">
        {t(emptyCopyNs ? `${emptyCopyNs}.empty.title` : "provider.noProviders")}
      </h3>
      {emptyCopyNs && (
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          {t(`${emptyCopyNs}.empty.description`)}
        </p>
      )}
      {showKeyFieldsHint && (
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          {t("provider.noProvidersDescriptionKeyFields")}
        </p>
      )}
      {(onImport || onCreate) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onImport && (
            <Button variant="outline" onClick={onImport}>
              <Download className="mr-2 h-4 w-4" />
              {t("provider.importCurrent")}
            </Button>
          )}
          {onCreate && (
            <Button variant="outline" onClick={onCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t("provider.addProvider")}
            </Button>
          )}
          {!emptyCopyNs && onImport && (
            <HelpTip title={t("provider.noProviders")}>
              {t("provider.noProvidersDescription")}
            </HelpTip>
          )}
        </div>
      )}
    </div>
  );
}
