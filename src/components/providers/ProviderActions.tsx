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
  BarChart3,
  Check,
  Copy,
  Edit,
  Loader2,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  Terminal,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
  /** 删不掉时的原因，挂在删除按钮的提示上 */
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
  const iconButtonClass = "h-8 w-8 p-1";

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

  const handleMainButtonClick = () => {
    if (isTerminalOnly) {
      onOpenTerminal?.();
      return;
    }
    if (failoverUnavailable && isAutoFailoverEnabled && !aggregation) return;
    if (aggregation) {
      aggregation.onToggle();
      return;
    }
    if (isOmo) {
      if (isCurrent) {
        onDisableOmo?.();
      } else {
        onSwitch();
      }
    } else if (isAdditiveMode) {
      // 累加模式：切换配置状态（添加/移除）
      if (isInConfig) {
        if (onRemoveFromConfig) {
          onRemoveFromConfig();
        } else {
          onDelete();
        }
      } else {
        onSwitch(); // 添加到配置
      }
    } else if (isFailoverMode) {
      onToggleFailover(!isInFailoverQueue);
    } else {
      onSwitch();
    }
  };

  const getMainButtonState = () => {
    if (isTerminalOnly) {
      return {
        disabled: !onOpenTerminal,
        variant: "default" as const,
        className: "theme-primary-solid",
        icon: <Terminal className="h-4 w-4" />,
        text: t("provider.openTerminal", { defaultValue: "打开终端" }),
      };
    }
    if (aggregation)
      return {
        disabled: aggregation.disabled || aggregation.default,
        variant: "secondary" as const,
        className: "",
        icon: aggregation.member ? (
          <Check className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        ),
        text: t(
          aggregation.default
            ? "webMode.default"
            : aggregation.member
              ? "webMode.member"
              : "webMode.join",
        ),
      };
    if (isOmo) {
      if (isCurrent) {
        return {
          disabled: false,
          variant: "secondary" as const,
          className: "theme-chip-neutral hover:text-inherit",
          icon: <Check className="h-4 w-4" />,
          text: t("provider.inUse"),
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className: "",
        icon: <Play className="h-4 w-4" />,
        text: t("provider.enable"),
      };
    }

    // 累加模式（OpenCode 非 OMO / OpenClaw）
    if (isAdditiveMode) {
      if (isInConfig) {
        return {
          disabled: isReadOnly || isDefaultModel === true,
          variant: "secondary" as const,
          className: cn(
            "theme-chip-warm hover:text-inherit",
            (isReadOnly || isDefaultModel) && "opacity-40 cursor-not-allowed",
          ),
          icon: <Minus className="h-4 w-4" />,
          text: t("provider.removeFromConfig", { defaultValue: "移除" }),
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className: "theme-success-solid",
        icon: <Plus className="h-4 w-4" />,
        text: t("provider.addToConfig", { defaultValue: "添加" }),
      };
    }

    if (isFailoverMode) {
      if (isInFailoverQueue) {
        return {
          disabled: false,
          variant: "secondary" as const,
          className: "theme-chip-primary hover:text-inherit",
          icon: <Check className="h-4 w-4" />,
          text: t("failover.inQueue", { defaultValue: "已加入" }),
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className: "theme-primary-solid",
        icon: <Plus className="h-4 w-4" />,
        text: t("failover.addQueue", { defaultValue: "加入" }),
      };
    }

    if (isCurrent) {
      return {
        disabled: true,
        variant: "secondary" as const,
        className: "theme-chip-neutral hover:text-inherit",
        icon: <Check className="h-4 w-4" />,
        text: t("provider.inUse"),
      };
    }

    return {
      disabled: false,
      variant: "default" as const,
      className: isProxyTakeover ? "theme-success-solid" : "",
      icon: <Play className="h-4 w-4" />,
      text: t("provider.enable"),
    };
  };

  const buttonState = getMainButtonState();

  const canDelete =
    !deleteDisabled &&
    !isReadOnly &&
    (isOmo || isAdditiveMode || isTerminalOnly ? true : !isCurrent);
  const readOnlyHint = t("provider.managedByHermesHint", {
    defaultValue: "由 Hermes 管理，请在 Hermes Web UI 中编辑",
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {failoverUnavailable && isAutoFailoverEnabled && !aggregation && (
        <span className="max-w-56 text-xs text-muted-foreground">
          {t("failover.officialUnavailable")}
        </span>
      )}
      {hasDefaultProvider && isDefaultModel && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-1 text-sm font-medium text-foreground">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-blue-500"
          />
          {t("provider.isDefault", { defaultValue: "当前默认" })}
        </span>
      )}

      <Button
        size="sm"
        variant={buttonState.variant}
        onClick={handleMainButtonClick}
        disabled={
          buttonState.disabled ||
          (failoverUnavailable && isAutoFailoverEnabled && !aggregation)
        }
        className={cn("w-[4.5rem] px-2.5", buttonState.className)}
      >
        {buttonState.icon}
        {buttonState.text}
      </Button>

      {(aggregation || canSetDefault) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label={
                aggregation
                  ? t("webMode.more")
                  : t("common.more", { defaultValue: "更多" })
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {aggregation && (
              <DropdownMenuItem
                disabled={aggregation.default || aggregation.disabled}
                onSelect={aggregation.onDefault}
              >
                {t("webMode.setDefault")}
              </DropdownMenuItem>
            )}
            {aggregation && canSetDefault && <DropdownMenuSeparator />}
            {canSetDefault &&
              (modelOptions.length > 1 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {t("provider.setAsDefault", { defaultValue: "设为默认" })}
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={isReadOnly ? undefined : onEdit}
          disabled={isReadOnly}
          title={isReadOnly ? readOnlyHint : t("common.edit")}
          className={cn(
            iconButtonClass,
            isReadOnly && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <Edit className="h-4 w-4" />
        </Button>

        {onDuplicate && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onDuplicate}
            title={t("provider.duplicate")}
            className={iconButtonClass}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={onTest || undefined}
          disabled={isTesting}
          title={t("modelTest.testProvider", "测试模型")}
          className={cn(
            iconButtonClass,
            !onTest && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          {isTesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TestTube2 className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onConfigureUsage || undefined}
          title={t("provider.configureUsage")}
          className={cn(
            iconButtonClass,
            !onConfigureUsage &&
              "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <BarChart3 className="h-4 w-4" />
        </Button>

        {onOpenTerminal && !isTerminalOnly && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onOpenTerminal}
            title={t(
              openTerminalIsolated
                ? "provider.openTerminalIsolated"
                : "provider.openTerminal",
            )}
            className={cn(
              iconButtonClass,
              "hover:text-emerald-600 dark:hover:text-emerald-400",
            )}
          >
            <Terminal className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={canDelete ? onDelete : undefined}
          disabled={!canDelete}
          title={
            isReadOnly
              ? readOnlyHint
              : !canDelete && deleteDisabledReason
                ? deleteDisabledReason
                : t("common.delete")
          }
          className={cn(
            iconButtonClass,
            canDelete && "hover:text-red-500 dark:hover:text-red-400",
            !canDelete && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
