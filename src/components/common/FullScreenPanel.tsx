import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { isWindows, isLinux } from "@/lib/platform";
import { isTextEditableTarget } from "@/utils/domUtils";
import { useUnsavedChangesTracker } from "@/lib/unsavedChanges";
import { cn } from "@/lib/utils";

interface FullScreenPanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
  /** 默认不做动画：淡入淡出会在开关面板时露出下面的页面 */
  motionPreset?: "none" | "slide-from-right";
  /**
   * 编辑表单：用户改过内容后，用快捷键（⌘/Ctrl+,）离开当前页前会先确认。
   * 只给编辑页打开；测速、只读这类页面不需要。
   */
  trackUnsavedChanges?: boolean;
  /** 返回按钮的无障碍名称（默认「返回」），比如添加供应商第 2 步写「返回选择预设」 */
  backLabel?: string;
  /** 页头标题上方的小字，比如聚合布局的表单写「Codex（聚合模式）」；不传就不显示 */
  subtitle?: string;
}

const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px - match App.tsx
const HEADER_HEIGHT = 64; // px - match App.tsx

let bodyScrollLockCount = 0;
let bodyOverflowBeforeFirstLock: string | null = null;

const lockBodyScroll = () => {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeFirstLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
};

const unlockBodyScroll = () => {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeFirstLock ?? "";
    bodyOverflowBeforeFirstLock = null;
  }
};

/**
 * 打开着的面板，后打开的在最后。面板里再开面板（编辑供应商 → 选图标、编辑定价）时
 * 每层都在 window 上挂了 ESC 监听，stopPropagation 拦不住同一目标上的其他监听，
 * 所以只让栈顶那层响应，一次 ESC 只退一层。
 */
const openPanelStack: object[] = [];

/**
 * Reusable full-screen panel component
 * Handles portal rendering, header with back button, and footer
 * Keeps behavior stable while providing a richer workspace-style shell
 */
export const FullScreenPanel: React.FC<FullScreenPanelProps> = ({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer,
  contentClassName,
  motionPreset = "none",
  trackUnsavedChanges = false,
  backLabel,
}) => {
  // 面板关掉后组件可能还挂着：只在打开时登记，关掉即撤销
  const unsavedChangesHandlers = useUnsavedChangesTracker(
    trackUnsavedChanges && isOpen,
  );
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const shouldSlideFromRight =
    motionPreset === "slide-from-right" && !prefersReducedMotion;

  React.useEffect(() => {
    if (!isOpen) return;

    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  // ESC 键关闭面板
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) return;

    const entry = {};
    openPanelStack.push(entry);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 上面还叠着别的面板：交给最上面那层
        if (openPanelStack[openPanelStack.length - 1] !== entry) {
          return;
        }

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
      const index = openPanelStack.indexOf(entry);
      if (index >= 0) openPanelStack.splice(index, 1);
    };
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          // 淡入淡出会在开关时露出下面的列表（闪一下），默认直接出现、直接消失
          initial={shouldSlideFromRight ? { x: "100%" } : false}
          animate={shouldSlideFromRight ? { x: 0 } : { opacity: 1 }}
          exit={shouldSlideFromRight ? { x: "100%" } : { opacity: 1 }}
          transition={
            shouldSlideFromRight
              ? { duration: 0.26, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0 }
          }
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
                  aria-label={backLabel ?? t("common.back")}
                  title={backLabel}
                  className="h-10 w-10 rounded-2xl border-border-default bg-background/80 select-none"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  {subtitle && (
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {subtitle}
                    </div>
                  )}
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
              {...unsavedChangesHandlers}
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
