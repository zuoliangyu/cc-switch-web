import type { TFunction } from "i18next";
import { toast } from "sonner";

export interface BulkToggleResult {
  succeeded: string[];
  failed: unknown[];
}

/**
 * 批量启用 / 停用之后的提示：全部失败报错，部分失败给警告（成功的那些仍可撤销），
 * 全部成功才提示已保存。撤销也按实际结果提示，不一律说「已撤销」。
 */
export function showBulkToggleResult(
  result: BulkToggleResult,
  t: TFunction,
  undo: (ids: string[]) => Promise<BulkToggleResult>,
) {
  const failed = result.failed.length;
  const undoAction =
    result.succeeded.length > 0
      ? {
          label: t("common.undo"),
          onClick: () => {
            void undo(result.succeeded)
              .then((undone) => {
                if (undone.failed.length) {
                  toast[undone.succeeded.length ? "warning" : "error"](
                    t("common.bulkToggleFailed", {
                      count: undone.failed.length,
                    }),
                    { closeButton: true },
                  );
                } else {
                  toast.success(t("common.undone"), { closeButton: true });
                }
              })
              .catch((error) =>
                toast.error(t("common.error"), { description: String(error) }),
              );
          },
        }
      : undefined;

  if (failed === 0) {
    toast.success(t("common.saved"), { closeButton: true, action: undoAction });
    return;
  }
  toast[result.succeeded.length ? "warning" : "error"](
    t("common.bulkToggleFailed", { count: failed }),
    { closeButton: true, action: undoAction },
  );
}
