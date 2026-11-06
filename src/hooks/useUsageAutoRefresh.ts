import { useCallback, useEffect, useRef } from "react";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/usage";
import { usageKeys } from "@/lib/query/usage";
import type { SessionSyncResult } from "@/types/usage";

interface UsageAutoRefreshOptions {
  refreshIntervalMs: number;
  sessionAutoSyncEnabled: boolean;
  paused?: boolean;
  /** 时间范围随「现在」移动（今天、最近 24 小时等） */
  rollingRange?: boolean;
}

/** 随时间移动的范围多久重算一次：跨过午夜、滚动窗口移出旧记录都靠它 */
const ROLLING_RANGE_REFRESH_MS = 60_000;

/**
 * 用量页打开期间按所选间隔刷新：打开即刷一次，之后每隔一段刷一次，
 * 窗口隐藏时停、重新显示时立刻补刷。后台只有 10 分钟一次的兜底扫描。
 *
 * 自动扫描开着时每轮先扫描会话日志。和上游桌面端不同，Web 的服务端不推送
 * `usage-log-recorded` 事件，所以每轮结束都重读整页统计（会话导入和路由记账
 * 都靠这一下出现）；自动扫描关着时只重读、不扫描。
 * 范围随时间移动时另有每分钟一次的重查，否则跨过午夜「今天」还停在昨天。
 */
export function useUsageAutoRefresh({
  refreshIntervalMs,
  sessionAutoSyncEnabled,
  paused = false,
  rollingRange = false,
}: UsageAutoRefreshOptions) {
  const queryClient = useQueryClient();
  const pendingSync = useRef<Promise<SessionSyncResult> | null>(null);

  // 手动同步复用尚未完成的静默扫描；慢扫描不会在后端互斥锁前排队累积。
  const syncSessionUsage = useCallback(() => {
    if (!pendingSync.current) {
      pendingSync.current = usageApi.syncSessionUsage().finally(() => {
        pendingSync.current = null;
      });
    }
    return pendingSync.current;
  }, []);

  useEffect(() => {
    if (refreshIntervalMs <= 0 || paused) return;
    let disposed = false;

    const refresh = async () => {
      if (!focusManager.isFocused() || pendingSync.current) return;
      if (sessionAutoSyncEnabled) {
        try {
          const result = await syncSessionUsage();
          if (result.errors.length > 0) {
            console.warn(
              "[UsageDashboard] Session auto-sync errors",
              result.errors,
            );
          }
        } catch (error) {
          // 静默扫描失败不弹提示，下一轮继续重试
          console.warn("[UsageDashboard] Session auto-sync failed", error);
        }
      }
      if (!disposed) {
        await queryClient.invalidateQueries({ queryKey: usageKeys.all });
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    const unsubscribe = focusManager.subscribe((focused) => {
      if (focused) void refresh();
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [
    paused,
    queryClient,
    refreshIntervalMs,
    sessionAutoSyncEnabled,
    syncSessionUsage,
  ]);

  useEffect(() => {
    if (!rollingRange) return;
    const timer = window.setInterval(() => {
      if (focusManager.isFocused()) {
        void queryClient.invalidateQueries({ queryKey: usageKeys.all });
      }
    }, ROLLING_RANGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [queryClient, rollingRange]);

  return { syncSessionUsage };
}
