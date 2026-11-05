import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import type { CodexStaleClients } from "@/types/proxy";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface CodexStaleClientsNoticeProps {
  staleClients: CodexStaleClients;
  pending?: boolean;
  /** 重启守护进程；失败由调用方提示，确认框在完成后关闭 */
  onRestartDaemon: () => Promise<unknown>;
  onDismiss: () => void;
}

/**
 * Codex 客户端可能缓存着旧账号或模型列表（模型目录只在启动时读，切换账号或直连、路由、聚合
 * 模式后都会变）。命令行连的守护进程确认后一键重启；桌面版、编辑器插件只提示用户彻底退出再
 * 开。重启会中断守护进程里正在运行的任务，执行期间确认框保持打开。看不到桌面版、编辑器插件
 * 进程时（Windows）只能说「可能」，关掉提示时让后端记下现在这份（由调用方处理），同一份不再提示。
 */
export function CodexStaleClientsNotice({
  staleClients,
  pending = false,
  onRestartDaemon,
  onDismiss,
}: CodexStaleClientsNoticeProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Notice
        tone="warning"
        title={t(
          staleClients.unverified
            ? "webMode.staleClients.unverifiedTitle"
            : staleClients.auth
              ? "webMode.staleClients.authTitle"
              : "webMode.staleClients.title",
        )}
        onDismiss={onDismiss}
        dismissLabel={t("common.close")}
        actions={
          staleClients.daemon ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              <RotateCw
                className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
              />
              {t("webMode.restartDaemon")}
            </Button>
          ) : undefined
        }
      >
        {staleClients.daemon && (
          <span className="block">{t("webMode.staleClients.daemon")}</span>
        )}
        {staleClients.others && (
          <span className="block">{t("webMode.staleClients.others")}</span>
        )}
        {staleClients.unverified && (
          <span className="block">
            {t("webMode.staleClients.unverifiedHint")}
          </span>
        )}
      </Notice>
      <ConfirmDialog
        isOpen={confirming}
        variant="info"
        title={t("webMode.restartDaemon")}
        message={t("webMode.restartDaemonConfirm")}
        confirmText={t("common.confirm")}
        pending={pending}
        onConfirm={() => {
          void onRestartDaemon()
            .catch(() => {})
            .finally(() => setConfirming(false));
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
