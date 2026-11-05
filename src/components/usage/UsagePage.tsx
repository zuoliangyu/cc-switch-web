import { useSettings } from "@/hooks/useSettings";
import { UsageDashboard } from "./UsageDashboard";

/**
 * 侧栏「用量统计」全局页（上游 UsagePage）：会话日志自动同步的开关跟着设置走。
 * 原先这个开关只在设置页的「用量」页签里，设置页按上游改成分组目录后用量页签去掉了。
 */
export function UsagePage() {
  const { settings, autoSaveSettings } = useSettings();

  return (
    <UsageDashboard
      sessionAutoSyncEnabled={settings?.sessionAutoSyncEnabled ?? true}
      onSessionAutoSyncEnabledChange={async (sessionAutoSyncEnabled) => {
        try {
          await autoSaveSettings({ sessionAutoSyncEnabled });
        } catch {
          // useSettings 已提示保存失败
        }
      }}
    />
  );
}
