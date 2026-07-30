import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isWindows, isLinux } from "@/lib/platform";
import { isTextEditableTarget } from "@/utils/domUtils";
import { cn } from "@/lib/utils";

interface FullScreenPanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
}

const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px - match App.tsx
const HEADER_HEIGHT = 64; // px - match App.tsx

/**
 * Reusable full-screen panel component
 * Handles portal rendering, header with back button, and footer
 * Keeps behavior stable while providing a richer workspace-style shell
 */
export const FullScreenPanel: React.FC<FullScreenPanelProps> = ({
  isOpen,
  title,
  onClose,
  children,
  footer,
  contentClassName,
}) => {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ESC 键关闭面板
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 子组件（例如 Radix 的 Select/Dialog/Dropdown）如果已经消费了 ESC，就不要再关闭整个面板
        if (event.defaultPrevented) {
          return;
        }

        if (isTextEditableTarget(event.target)) {
          return; // 让输入框自己处理 ESC（比如清空、失焦等）
        }

        event.stopPropagation(); // 阻止事件继续冒泡到 window，避免触发 App.tsx 的全局监听
        onCloseRef.current();
      }
    };

    // 使用冒泡阶段监听，让子组件（如 Radix UI）优先处理 ESC
    window.addEventListener("keydown", handleKeyDown, false);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.992 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.992 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="app-shell fixed inset-0 z-[60] flex flex-col bg-background"
        >
          {/* Drag region - match App.tsx */}
          <div style={{ height: DRAG_BAR_HEIGHT }} />

          {/* Header - match App.tsx */}
          <div
            className="sticky top-0 z-10 flex flex-shrink-0 items-center border-b border-border-default/70 bg-gradient-to-b from-background via-background/95 to-background/75 backdrop-blur-xl"
            style={
              {
                height: HEADER_HEIGHT,
              } as React.CSSProperties
            }
          >
            <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
              <div className="glass-card flex w-full items-center gap-4 rounded-[24px] border border-border-default px-3 py-2 shadow-lg sm:px-4">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onClose}
                  className="h-10 w-10 rounded-2xl border-border-default bg-background/80 select-none"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Workspace Panel
                  </div>
                  <h2 className="truncate text-lg font-semibold text-foreground select-none sm:text-xl">
                    {title}
                  </h2>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scroll-overlay">
            <div
              className={cn(
                "mx-auto w-full max-w-7xl space-y-6 px-4 py-5 sm:px-6 sm:py-6",
                contentClassName,
              )}
            >
              {children}
            </div>
          </div>

          {/* Footer */}
          {footer && (
            <div className="flex-shrink-0 border-t border-border-default/70 bg-background/90 py-4 backdrop-blur-xl">
              <div className="mx-auto flex w-full max-w-7xl items-center justify-end gap-3 px-4 sm:px-6">
                <div className="glass-card flex w-full items-center justify-end gap-3 rounded-[22px] border border-border-default px-3 py-2 sm:w-auto sm:px-4">
                  {footer}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
