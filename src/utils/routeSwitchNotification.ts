import type { TFunction } from "i18next";
import type { AppId } from "@/lib/api/types";
import type { RouteSwitchResult } from "@/types/proxy";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";

/** 这几个客户端只在启动时读配置：改写了客户端文件才提示重启（Claude Code 会自己重读）。 */
const RESTART_TO_APPLY = new Set<AppId>([
  "codex",
  "gemini",
  "grokbuild",
  "claude-desktop",
]);

/**
 * 路由切换的提示按后端实际生效的结果给出：路由当场换上游，和客户端启动时读的配置无关；
 * 只有客户端文件也改写了才提示重启。
 */
export function routeSwitchNotification(
  result: RouteSwitchResult,
  app: AppId,
  provider: string,
  t: TFunction,
): string {
  let message: string;
  switch (result.kind) {
    case "remembered":
      message = t("webMode.toast.routeRemembered", { provider });
      break;
    case "route":
      message = result.clientConfigChanged
        ? t("webMode.toast.routeTargetChanged", { provider })
        : t("webMode.toast.routeSwitched", { provider });
      break;
    case "stack":
      message = t("webMode.toast.stackDefaultChanged", { provider });
      break;
  }
  if (
    result.kind !== "remembered" &&
    result.clientConfigChanged &&
    RESTART_TO_APPLY.has(app)
  ) {
    message += t("webMode.toast.clientConfigChanged", {
      app: APP_DISPLAY_NAME[app],
    });
  }
  return message;
}
