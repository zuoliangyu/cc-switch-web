import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import type { AppId } from "@/lib/api";
import { invalidatePiProviderCaches } from "@/lib/query/pi";
import { proxyKeys } from "@/lib/query/proxy";
import { SERVER_EVENT_RESYNC } from "@/lib/runtime/client/serverEvents";
import type { SubscriptionQuota } from "@/types/subscription";
import {
  CODEX_UNIFY_MIGRATION_FINISHED_EVENT,
  showCodexUnifyMigrationFinished,
  type CodexUnifyMigrationFinished,
} from "@/utils/codexHistorySplitHint";
import { useServerEvent } from "./useServerEvent";

interface ProviderSwitchEvent {
  appType: AppId;
  providerId?: string;
  source?: string;
}

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

/**
 * 全局的服务端事件处理（对应上游 App.tsx 里的各个 Tauri 事件监听）：
 * 故障转移 / 应用项目等后端主动的切换、统一供应商同步、WebDAV 自动同步结果、
 * 本地路由被系统代理接走的提示、Codex 统一会话历史的后台迁入结果，以及断线重连后的整体重取。
 */
export function useAppServerEvents() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useServerEvent<ProviderSwitchEvent>("provider-switched", async (event) => {
    // 按前缀失效：故障转移只改路由指针，「路由中」标记读的模式视图也在这个前缀下
    await queryClient.invalidateQueries({
      queryKey: ["providers", event.appType],
    });
    if (event.appType === "pi" || event.appType === "omp") {
      await invalidatePiProviderCaches(queryClient, event.appType);
    }
    if (event.appType === "claude") {
      // 应用项目同样可能把默认登录收成新账号
      await queryClient.invalidateQueries({
        queryKey: ["managed-auth-status", "claude_official"],
      });
    }
    // 切换会顺带刷新托管 ChatGPT 账号的令牌：重查停在失败上的账号额度，
    // 免得主界面一直显示旧的「登录过期」
    await queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "codex_oauth" &&
        query.queryKey[1] === "quota" &&
        (query.state.status === "error" ||
          (query.state.data as SubscriptionQuota | undefined)?.success ===
            false),
    });
  });

  useServerEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
  });

  // 应用项目后刷新相关缓存（providers 由 provider-switched 承接；
  // 代理状态由后端直接改，不走 mutation，必须显式刷新）
  useServerEvent("profile-applied", async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.takeoverStatus,
    });
    await queryClient.invalidateQueries({ queryKey: proxyKeys.status });
    await queryClient.invalidateQueries({
      queryKey: ["providers", "claude-desktop"],
    });
  });

  useServerEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  // Codex / Grok Build 跟随系统代理发请求：发往本地路由的请求被系统代理接走时客户端只看到
  // 空正文 502，CC Switch 这边没有日志（#9221）。进入路由时服务端自检一次，没回来就提示。
  useServerEvent<{ appType: AppId; origin: string }>(
    "proxy-loopback-hijacked",
    (payload) => {
      const app = APP_DISPLAY_NAME[payload.appType] ?? payload.appType;
      toast.warning(
        t("notifications.proxyLoopbackHijacked", {
          app,
          origin: payload.origin,
        }),
        { duration: 15000 },
      );
    },
  );

  // 开启统一会话历史后的后台迁入跑完了：提示用户现在可以重启 Codex。放在 App 级，
  // 迁入期间离开设置页也能看到。
  useServerEvent<CodexUnifyMigrationFinished>(
    CODEX_UNIFY_MIGRATION_FINISHED_EVENT,
    (payload) => showCodexUnifyMigrationFinished(payload, t),
  );

  // 断线期间可能漏了事件（或服务端判定落后）：整体重取
  useServerEvent(SERVER_EVENT_RESYNC, async () => {
    await queryClient.invalidateQueries();
  });
}
