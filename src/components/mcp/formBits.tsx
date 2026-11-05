import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export const FIELD_CLASS =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 read-only:bg-muted";
export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono text-xs`;
export const CHECKBOX_CLASS = "h-4 w-4 accent-primary";
export const LABEL_CLASS = "text-sm font-medium text-foreground";

export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <span id={id} className="flex items-start gap-1 text-xs text-destructive">
      <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}
export function RequiredMark({ srText }: { srText: string }) {
  return (
    <>
      <span aria-hidden className="ms-0.5 text-destructive">
        *
      </span>
      <span className="sr-only">{srText}</span>
    </>
  );
}
export function DisclosureButton({
  open,
  controls,
  onToggle,
  children,
  hint,
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex h-8 items-center gap-1.5 self-start rounded-md text-sm font-medium hover:bg-muted"
    >
      <Icon aria-hidden className="h-4 w-4" />
      {children}
      {hint && (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  );
}
export function MiniSegmented<T extends string>({
  items,
  value,
  onValueChange,
  label,
}: {
  items: { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
}) {
  return (
    <SegmentedControl
      items={items}
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      size="sm"
    />
  );
}

/** v7 对话框外壳：宽 480（或传入）、padding 24。 */
export function V7Dialog({
  open,
  onOpenChange,
  width = 480,
  className,
  children,
  describedBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: number;
  className?: string;
  children: ReactNode;
  /** 没有 DialogDescription 时传 undefined 关掉 Radix 的提示 */
  describedBy?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          zIndex="alert"
          aria-describedby={describedBy}
          style={{ maxWidth: width }}
          className={cn(
            "max-h-[calc(100vh-48px)] gap-4 rounded-xl border-border bg-card p-6 text-foreground shadow-lg sm:rounded-xl",
            className,
          )}
        >
          {children}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** 确认框：后果写在正文里，取消默认聚焦；不可撤销的操作（danger）确认键用红底，可恢复的传 danger={false}。
 *  details 放在正文下面（正文是 <p>，列表这类块级内容放这里）。 */
export function V7ConfirmDialog({
  open,
  title,
  body,
  details,
  confirmLabel,
  danger = true,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  details?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <V7Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <DialogTitle className="text-base font-semibold [overflow-wrap:anywhere]">
          {title}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {body}
        </DialogDescription>
      </div>
      {details}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          autoFocus
          disabled={pending}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant={danger ? "destructive" : "default"}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </V7Dialog>
  );
}
