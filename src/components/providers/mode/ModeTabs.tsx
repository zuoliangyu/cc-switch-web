import { useTranslation } from "react-i18next";
import { Layers, Plug, Route, Settings2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/ui/help-tip";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  SegmentThumb,
  useSlidingIndicator,
} from "@/components/ui/sliding-indicator";
import { cn } from "@/lib/utils";
import type { ModeView } from "@/components/providers/presentation";

const MODE_ICON = { direct: Plug, route: Route, stack: Layers } as const;

/** 模式色（直连蓝、路由绿、聚合紫）：页头徽标、页签、状态点；沿用 Web 主题的卡片高亮色，不引入上游令牌 */
export const MODE_TONE: Record<ModeView, { text: string; dot: string }> = {
  direct: { text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  route: {
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  stack: {
    text: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
};

interface ModeTabsProps {
  modes: ModeView[];
  active: ModeView;
  view: ModeView;
  onView: (mode: ModeView) => void;
  failover?: {
    enabled: boolean;
    disabled?: boolean;
    onChange: (enabled: boolean) => void;
  };
  /** 路由页签上的「路由设置」（超时、重试、熔断） */
  onOpenRouteSettings?: () => void;
  /** Codex 聚合页签上的「聚合设置」（子代理模型、经典子代理、自动审批） */
  onOpenStackSettings?: () => void;
  /** 供应商搜索框挂在模式行右侧（由列表通过 portal 渲染进来） */
  searchSlotRef?: (node: HTMLDivElement | null) => void;
}

/**
 * 模式行（上游 v7）：页签只负责查看。凸起的底只给正在看的那段；生效的那段只用模式色文字和圆点，
 * 不铺底（否则彩色那格比正在看的更抢眼）。组右边的「?」说明各模式的区别。
 * 右侧依次是搜索框的位置、故障转移开关、路由 / 聚合设置（纯图标 + HoverTip）。
 */
export function ModeTabs({
  modes,
  active,
  view,
  onView,
  failover,
  onOpenRouteSettings,
  onOpenStackSettings,
  searchSlotRef,
}: ModeTabsProps) {
  const { t } = useTranslation();
  const indicator = useSlidingIndicator<HTMLDivElement>(
    '[aria-pressed="true"]',
    view,
  );

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <div
          ref={indicator.ref}
          role="group"
          aria-label={t("mode.tabsLabel")}
          className="relative inline-flex h-9 shrink-0 items-center gap-0.5 rounded-[10px] bg-muted p-[3px]"
        >
          <SegmentThumb
            rect={indicator.rect}
            animate={indicator.animate}
            className="rounded-[7px]"
          />
          {modes.map((mode) => {
            const Icon = MODE_ICON[mode];
            const isActive = mode === active;
            const selected = mode === view;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                onClick={() => onView(mode)}
                className={cn(
                  "relative inline-flex h-[30px] items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm transition-colors duration-150 sm:min-w-[96px] sm:px-4",
                  isActive
                    ? MODE_TONE[mode].text
                    : selected
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  selected || isActive ? "font-semibold" : "font-medium",
                )}
              >
                <Icon
                  className="h-3.5 w-3.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {t(`mode.names.${mode}`)}
                {isActive && (
                  <span
                    aria-label={t("mode.active")}
                    role="img"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      MODE_TONE[mode].dot,
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
        <HelpTip title={t("mode.help.title")}>
          {modes.map((mode) => (
            <span key={mode} className="block">
              {t(`mode.help.${mode}`)}
            </span>
          ))}
        </HelpTip>
      </div>

      <div className="hidden flex-1 sm:block" />
      {searchSlotRef && (
        <div
          ref={searchSlotRef}
          className="flex min-w-0 shrink items-center empty:hidden max-sm:w-full"
        />
      )}

      {failover && (
        <HoverTip content={t("mode.failover")}>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
            <Shuffle
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <Switch
              checked={failover.enabled}
              disabled={failover.disabled}
              onCheckedChange={failover.onChange}
              aria-label={t("mode.failover")}
            />
          </label>
        </HoverTip>
      )}
      {onOpenRouteSettings && (
        <HoverTip content={t("mode.routeSettings")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 px-0"
            aria-label={t("mode.routeSettings")}
            onClick={onOpenRouteSettings}
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </HoverTip>
      )}
      {onOpenStackSettings && (
        <HoverTip content={t("mode.stackSettings.title")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 px-0"
            aria-label={t("mode.stackSettings.title")}
            onClick={onOpenStackSettings}
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </HoverTip>
      )}
    </div>
  );
}
