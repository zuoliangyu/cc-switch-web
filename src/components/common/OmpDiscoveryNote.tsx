import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HelpTip } from "@/components/ui/help-tip";
import { settingsApi } from "@/lib/api";

const OMP_DISCOVERY_DOCS_URL =
  "https://github.com/can1357/oh-my-pi/blob/main/docs/context-files.md#disabling-discovery-providers";

/**
 * Oh My Pi 还会从其他 Agent 的目录发现 MCP、技能等，实际加载的可能比这里勾的多。
 * 上游放在矩阵 Oh My Pi 列头的弹层里；Web 没有列头，MCP 和 Skills 面板在计数条下面放一行。
 */
export function OmpDiscoveryNote() {
  const { t } = useTranslation();
  return (
    <div className="-mt-2 mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{t("appMatrix.ompDiscovery.title")}</span>
      <HelpTip title={t("appMatrix.ompDiscovery.title")}>
        {t("appMatrix.ompDiscovery.help")}
      </HelpTip>
      <button
        type="button"
        onClick={() =>
          void settingsApi
            .openExternal(OMP_DISCOVERY_DOCS_URL)
            .catch(() => undefined)
        }
        className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
      >
        <BookOpen className="h-3 w-3" />
        {t("appMatrix.ompDiscovery.docsLink")}
      </button>
    </div>
  );
}
