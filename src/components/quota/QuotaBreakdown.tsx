import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TONE_TEXT } from "./QuotaLines";
import type { QuotaBreakdown, QuotaLine } from "./quotaRules";

/**
 * 一行写不下的额度（存下了好几次重置）：整行（卡片上是那一段）是按钮，点开逐条列出明细
 * （每一次的到期日，同一天到期的并成一条）。授权中心、卡片额度列和展开的额度条共用。
 * 不给 `line` 时标题右边不写值（卡片整列做成一个下拉时，列出的是好几档，没有一个总值）。
 *
 * `className` 给按钮，用调用方原来那一行的排版；左右各外扩 4px 留出悬停底色，文字不挪位。
 */
export function QuotaBreakdownRow({
  line,
  breakdown,
  className,
  align = "start",
  children,
}: {
  line?: QuotaLine;
  breakdown: QuotaBreakdown;
  className?: string;
  /** 弹窗和按钮哪边对齐：卡片额度列靠右，用 end */
  align?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={breakdown.openLabel}
          // 卡片上别让点击冒到卡片
          onClick={(event) => event.stopPropagation()}
          className={cn(
            className,
            "group/breakdown -mx-1 rounded-md px-1 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        aria-label={breakdown.title}
        className="w-[236px] rounded-xl border-border bg-card p-3 shadow-md"
      >
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{breakdown.title}</span>
          {line && (
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {line.value ?? line.text}
            </span>
          )}
        </div>
        <ul className="flex flex-col gap-1 text-xs">
          {breakdown.items.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <span
                className={cn(
                  "whitespace-nowrap",
                  item.tone === "normal"
                    ? "text-foreground"
                    : TONE_TEXT[item.tone],
                )}
              >
                {item.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {item.hint}
              </span>
              <span className="whitespace-nowrap text-end tabular-nums text-muted-foreground">
                {item.value}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** 跟在说明文字后面的 ⌄，点开时翻过来 */
export function QuotaBreakdownChevron() {
  return (
    <ChevronDown
      aria-hidden
      className="h-3 w-3 shrink-0 transition-transform group-hover/breakdown:text-foreground group-data-[state=open]/breakdown:rotate-180"
      strokeWidth={1.5}
    />
  );
}
