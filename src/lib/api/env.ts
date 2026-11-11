import { invoke } from "@/lib/runtime/client/core";
import type { BackupInfo, EnvConflict } from "@/types/env";

export async function checkEnvConflicts(
  appType: string,
): Promise<EnvConflict[]> {
  return invoke("check_env_conflicts", { app: appType });
}

export async function deleteEnvVars(
  conflicts: EnvConflict[],
): Promise<BackupInfo> {
  return invoke("delete_env_vars", { conflicts });
}

export async function restoreEnvBackup(backupPath: string): Promise<void> {
  return invoke("restore_env_backup", { backupPath });
}

export async function checkAllEnvConflicts(): Promise<
  Record<string, EnvConflict[]>
> {
  const apps = ["claude", "codex", "gemini"];
  const results: Record<string, EnvConflict[]> = {};

  await Promise.all(
    apps.map(async (app) => {
      try {
        results[app] = await checkEnvConflicts(app);
      } catch (error) {
        console.error(`检查 ${app} 环境变量失败:`, error);
        results[app] = [];
      }
    }),
  );

  return results;
}
