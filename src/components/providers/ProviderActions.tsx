import type * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight,
  ListMinus,
  ListPlus,
  Loader2,
  Minus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/help-tip";
import { HoverTip } from "@/components/ui/hover-tip";
import { cn } from "@/lib/utils";
import type { AppId } from "@/lib/api";
import { isAdditiveAppId } from "@/config/appConfig";

export interface AggregationActions {
  member: boolean;
  default: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onDefault: () => void;
}

interface ProviderActionsProps {
  aggregation?: AggregationActions;
  failoverUnavailable?: boolean;
  deleteDisabled?: boolean;
  /** 删不掉时的原因，写在「更多」菜单里删除项的下面 */
  deleteDisabledReason?: string;
  appId?: AppId;
  isCurrent: boolean;
  isInConfig?: boolean;
  isTesting?: boolean;
  isProxyTakeover?: boolean;
  isOmo?: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  /** 不传就没有「复制」（Kimi 官方账号卡：复制出来的卡没有登录） */
  onDuplicate?: () => void;
  onTest?: () => void;
  onConfigureUsage?: () => void;
  onDelete: () => void;
  onRemoveFromConfig?: () => void;
  onDisableOmo?: () => void;
  onOpenTerminal?: () => void;
  /** 这张卡打开的终端是否与 CC Switch 的切换隔离（见 terminalIsIsolated），决定提示里带不带「环境隔离」 */
  openTerminalIsolated?: boolean;
  isAutoFailoverEnabled?: boolean;
  isInFailoverQueue?: boolean;
  onToggleFailover?: (enabled: boolean) => void;
  isReadOnly?: boolean;
  // OpenClaw / OpenCode / Hermes / Kimi：默认那家
  isDefaultModel?: boolean;
  /** 「更多」菜单里的「设为默认」；OpenClaw / OpenCode 多个模型时传选中的模型 */
  onSetAsDefault?: (modelId?: string) => void;
  /** OpenClaw / OpenCode：可选的默认模型，多于一个时展开子菜单 */
  defaultModelOptions?: { id: string; name?: string }[];
}

type StatusDot = "direct" | "route" | "stack";

const DOT: Record<StatusDot, string> = {
  direct: "bg-blue-500",
  route: "bg-emerald-500",
  stack: "bg-violet-500",
};

interface PrimaryButtonSpec {
  key: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  /** 不能点的原因：按钮照常画出来，原因挂在按钮的说明卡上 */
  disabledReason?: string;
  /** 不能点、也没有可说的原因（例如聚合成员正在保存） */
  disabled?: boolean;
}

interface PrimarySlot {
  status?: { label: string; dot: StatusDot };
  button?: PrimaryButtonSpec;
}

/**
 * 卡片右侧（上游 v7 布局）：主操作位（状态文字或按钮）→ 打开终端 → 编辑 → ⋯。
 * 次要操作都在 ⋯ 里：跟当前模式有关的（聚合的「设为默认」、累加应用的「设为默认」）在最前，
 * 然后是复制、检测连通、配置用量查询、删除。按钮一律纯图标 + HoverTip；有禁用原因时改由
 * DisabledReason 的说明卡报原因。
 */
export function ProviderActions({
  aggregation,
  failoverUnavailable = false,
  deleteDisabled = false,
  deleteDisabledReason,
  appId,
  isCurrent,
  isInConfig = false,
  isTesting,
  isProxyTakeover = false,
  isOmo = false,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onConfigureUsage,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onOpenTerminal,
  openTerminalIsolated = false,
  isAutoFailoverEnabled = false,
  isInFailoverQueue = false,
  onToggleFailover,
  isReadOnly = false,
  isDefaultModel = false,
  onSetAsDefault,
  defaultModelOptions,
}: ProviderActionsProps) {
  const { t } = useTranslation();

  // 累加模式应用（OpenCode 非 OMO / OpenClaw / Hermes / Pi / MiniMax Code / Kimi / DSH）
  const isAdditiveMode =
    appId !== undefined &&
    isAdditiveAppId(appId) &&
    !(appId === "opencode" && isOmo);

  // 有「默认那家」的累加应用：「设为默认」收在「更多」菜单里，卡上只标出默认那家
  const hasDefaultProvider =
    isInConfig &&
    (appId === "openclaw" ||
      (appId === "opencode" && !isOmo) ||
      appId === "hermes" ||
      appId === "kimi");
  const modelOptions = defaultModelOptions ?? [];
  // OpenCode 内置供应商可以不列模型（运行时才有），给不出选项就不显示
  const canSetDefault =
    hasDefaultProvider &&
    !isDefaultModel &&
    !!onSetAsDefault &&
    (appId !== "opencode" || modelOptions.length > 0);

  // 故障转移模式下的按钮逻辑（累加模式和 OMO 应用不支持故障转移）
  const isFailoverMode =
    !isAdditiveMode && !isOmo && isAutoFailoverEnabled && onToggleFailover;

  // Antigravity 的卡只作用于它打开的终端，没有「启用」：主按钮就是「打开终端」
  const isTerminalOnly = appId === "agy";

  const readOnlyHint = t("provider.managedByHermesHint", {
    defaultValue: "由 Hermes 管理，请在 Hermes Web UI 中编辑",
  });

  const primary = ((): PrimarySlot => {
    if (isTerminalOnly) {
      return {
        button: {
          key: "openTerminal",
          icon: SquareTerminal,
          label: t("provider.openTerminal", { defaultValue: "打开终端" }),
          onClick: onOpenTerminal,
          disabled: !onOpenTerminal,
        },
      };
    }
    if (aggregation) {
      if (aggregation.default) {
        return {
          status: {
            label: t("webMode.default", { defaultValue: "默认" }),
            dot: "stack",
          },
        };
      }
      return {
        button: aggregation.member
          ? {
              key: "remove",
              icon: Minus,
              label: t("webMode.leave", { defaultValue: "移出聚合" }),
              onClick: aggregation.onToggle,
              disabled: aggregation.disabled,
            }
          : {
              key: "add",
              icon: Plus,
              label: t("webMode.join", { defaultValue: "加入" }),
              onClick: aggregation.onToggle,
              disabled: aggregation.disabled,
            },
      };
    }
    if (isOmo) {
      // OMO / Slim：插件配置，同一时间只启用一个
      return {
        button: isCurrent
          ? {
              key: "disable",
              icon: PowerOff,
              label: t("provider.disable", { defaultValue: "停用" }),
              onClick: onDisableOmo,
            }
          : {
              key: "enable",
              icon: Power,
              label: t("provider.enable", { defaultValue: "启用" }),
              onClick: onSwitch,
            },
      };
    }
    if (isAdditiveMode) {
      if (!isInConfig) {
        return {
          button: {
            key: "add",
            icon: Plus,
            label: t("provider.addToConfig", { defaultValue: "添加" }),
            onClick: onSwitch,
          },
        };
      }
      const removeReason = isReadOnly
        ? readOnlyHint
        : isDefaultModel
          ? t("providerCard.reason.defaultCannotRemove", {
              defaultValue: "默认那家不能移除，先把别家设为默认。",
            })
          : undefined;
      return {
        status:
          hasDefaultProvider && isDefaultModel
            ? {
                label: t("provider.isDefault", { defaultValue: "当前默认" }),
                dot: "direct",
              }
            : undefined,
        button: {
          key: "remove",
          icon: Minus,
          label: t("provider.removeFromConfig", { defaultValue: "移除" }),
          onClick: onRemoveFromConfig ?? onDelete,
          disabledReason: removeReason,
        },
      };
    }
    if (isFailoverMode) {
      const unavailable = failoverUnavailable
        ? t("failover.officialUnavailable", {
            defaultValue: "官方账号不支持加入故障转移队列。",
          })
        : undefined;
      return {
        button: isInFailoverQueue
          ? {
              key: "queueRemove",
              icon: ListMinus,
              label: t("providerCard.action.removeFromQueue", {
                defaultValue: "移出队列",
              }),
              onClick: () => onToggleFailover(false),
              disabledReason: unavailable,
            }
          : {
              key: "queueAdd",
              icon: ListPlus,
              label: t("providerCard.action.addToQueue", {
                defaultValue: "加入队列",
              }),
              onClick: () => onToggleFailover(true),
              disabledReason: unavailable,
            },
      };
    }
    if (isCurrent) {
      return {
        status: {
          label: t("provider.inUse", { defaultValue: "使用中" }),
          dot: isProxyTakeover ? "route" : "direct",
        },
      };
    }
    return {
      button: {
        key: "switch",
        icon: Play,
        label: t("provider.enable", { defaultValue: "启用" }),
        onClick: onSwitch,
      },
    };
  })();

  const canDelete =
    !deleteDisabled &&
    !isReadOnly &&
    (isOmo || isAdditiveMode || isTerminalOnly ? true : !isCurrent);
  const deleteReason = canDelete
    ? undefined
    : isReadOnly
      ? readOnlyHint
      : (deleteDisabledReason ??
        (isCurrent
          ? t("providerCard.reason.inUseCannotDelete", {
              defaultValue: "正在用的这家不能删除，先切到别家。",
            })
          : undefined));

  const hasModeItems = Boolean(aggregation) || canSetDefault;
  const hasToolItems = Boolean(onDuplicate || onTest || onConfigureUsage);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* 主操作位定宽：图标按钮和「● 使用中」这类状态文字宽度不同，不定宽的话
          切换后左边的用量会被推开、跟其他卡片对不齐。按最长的常见状态留宽，靠右对齐 */}
      <div className="flex min-w-20 items-center justify-end gap-1">
        {primary.status && (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-1 text-sm font-medium text-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                DOT[primary.status.dot],
              )}
            />
            {primary.status.label}
          </span>
        )}
        {primary.button && <PrimaryButton button={primary.button} />}
      </div>

      {onOpenTerminal && !isTerminalOnly && (
        <HoverTip
          content={t(
            openTerminalIsolated
              ? "provider.openTerminalIsolated"
              : "provider.openTerminal",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t("provider.openTerminal", {
              defaultValue: "打开终端",
            })}
            onClick={onOpenTerminal}
          >
            <SquareTerminal className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </HoverTip>
      )}

      <IconAction
        tip={t("common.edit")}
        disabledReason={isReadOnly ? readOnlyHint : undefined}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t("common.edit")}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </IconAction>

      <DropdownMenu>
        <HoverTip content={t("common.more", { defaultValue: "更多" })}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("common.more", { defaultValue: "更多" })}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
        </HoverTip>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {aggregation && (
            <DropdownMenuItem
              disabled={aggregation.default || aggregation.disabled}
              onSelect={aggregation.onDefault}
            >
              {t("webMode.setDefault")}
            </DropdownMenuItem>
          )}
          {canSetDefault &&
            (modelOptions.length > 1 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("provider.setAsDefault", { defaultValue: "设为默认" })}
                  <ChevronRight
                    aria-hidden="true"
                    className="ml-auto h-3.5 w-3.5 text-muted-foreground"
                  />
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
                    <DropdownMenuLabel>
                      {t("openclaw.selectDefaultModel", {
                        defaultValue: "选择默认模型",
                      })}
                    </DropdownMenuLabel>
                    {modelOptions.map((model) => {
                      const name = model.name?.trim();
                      return (
                        <DropdownMenuItem
                          key={model.id}
                          onSelect={() => onSetAsDefault?.(model.id)}
                          className="flex min-w-0 flex-col items-start gap-0.5"
                        >
                          <span className="max-w-72 truncate">
                            {name || model.id}
                          </span>
                          {name && name !== model.id && (
                            <span className="max-w-72 truncate font-mono text-xs text-muted-foreground">
                              {model.id}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem
                disabled={isReadOnly}
                onSelect={() => onSetAsDefault?.(modelOptions[0]?.id)}
              >
                {t("provider.setAsDefault", { defaultValue: "设为默认" })}
              </DropdownMenuItem>
            ))}
          {hasModeItems && <DropdownMenuSeparator />}
          {onDuplicate && (
            <DropdownMenuItem onSelect={onDuplicate}>
              {t("provider.duplicate")}
            </DropdownMenuItem>
          )}
          {onTest && (
            <DropdownMenuItem disabled={isTesting} onSelect={onTest}>
              {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("modelTest.testProvider", "测试模型")}
            </DropdownMenuItem>
          )}
          {onConfigureUsage && (
            <DropdownMenuItem onSelect={onConfigureUsage}>
              {t("provider.configureUsage")}
            </DropdownMenuItem>
          )}
          {hasToolItems && <DropdownMenuSeparator />}
          <DropdownMenuItem
            disabled={!canDelete}
            onSelect={onDelete}
            className="flex-col items-start gap-0.5 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
          >
            {t("common.delete")}
            {deleteReason && (
              <span className="max-w-64 text-xs text-muted-foreground">
                {deleteReason}
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 有禁用原因时只挂说明卡（报原因），否则挂 HoverTip（报名字），两者不叠。 */
function IconAction({
  tip,
  disabledReason,
  children,
}: {
  tip: string;
  disabledReason?: string;
  children: React.ReactElement;
}) {
  if (disabledReason) {
    return (
      <DisabledReason reason={disabledReason} align="end">
        {children}
      </DisabledReason>
    );
  }
  return <HoverTip content={tip}>{children}</HoverTip>;
}

function PrimaryButton({ button }: { button: PrimaryButtonSpec }) {
  const Icon = button.icon;
  return (
    <IconAction tip={button.label} disabledReason={button.disabledReason}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={button.label}
        disabled={button.disabled}
        onClick={button.onClick}
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </Button>
    </IconAction>
  );
}
