import { memo, useState } from "react";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SessionMessage } from "@/types";
import {
  formatTimestamp,
  getRoleLabel,
  getRoleTone,
  highlightText,
} from "./utils";

const COLLAPSE_THRESHOLD = 3000;
const COLLAPSED_LENGTH = 1500;

interface SessionMessageItemProps {
  message: SessionMessage;
  isActive: boolean;
  searchQuery?: string;
  onCopy: (content: string) => void;
}

export const SessionMessageItem = memo(function SessionMessageItem({
  message,
  isActive,
  searchQuery,
  onCopy,
}: SessionMessageItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const isLong = (message.content ?? "").length > COLLAPSE_THRESHOLD;
  const hasSearchMatch =
    isLong &&
    !expanded &&
    !!searchQuery &&
    (message.content ?? "").toLowerCase().includes(searchQuery.toLowerCase());
  const collapsed = isLong && !expanded && !hasSearchMatch;
  const displayContent = collapsed
    ? `${(message.content ?? "").slice(0, COLLAPSED_LENGTH)}...`
    : (message.content ?? "");

  return (
    <div
      className={cn(
        "group relative min-w-0 rounded-[22px] border px-4 py-3 transition-all",
        message.role.toLowerCase() === "user"
          ? "ml-6 bg-primary/6 border-primary/20 shadow-[0_10px_24px_hsl(var(--primary)/0.08)]"
          : message.role.toLowerCase() === "assistant"
            ? "mr-6 border-blue-500/20 bg-blue-500/5 shadow-[0_10px_24px_rgba(59,130,246,0.08)]"
            : "border-border/60 bg-background/65",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 size-7 rounded-xl opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onCopy(message.content ?? "")}
          >
            <Copy className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("sessionManager.copyMessage", {
            defaultValue: "复制内容",
          })}
        </TooltipContent>
      </Tooltip>
      <div className="mb-2 flex items-center justify-between gap-3 pr-7 text-xs">
        <span
          className={cn(
            "rounded-full bg-background/80 px-2.5 py-1 font-semibold shadow-sm",
            getRoleTone(message.role),
          )}
        >
          {getRoleLabel(message.role, t)}
        </span>
        {message.ts && (
          <span className="text-muted-foreground">
            {formatTimestamp(message.ts)}
          </span>
        )}
      </div>
      <div className="min-w-0 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
        {searchQuery
          ? highlightText(displayContent, searchQuery)
          : displayContent}
      </div>
      {isLong && !hasSearchMatch && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              {t("sessionManager.collapseContent", {
                defaultValue: "收起",
              })}
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              {t("sessionManager.expandContent", {
                defaultValue: "展开完整内容",
              })}
              <span className="text-muted-foreground/60">
                ({Math.round((message.content ?? "").length / 1000)}k)
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
});
