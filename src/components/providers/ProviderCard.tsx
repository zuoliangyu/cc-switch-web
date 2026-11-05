import type * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AggregationActions } from "@/components/providers/ProviderActions";
import { ProviderActions } from "@/components/providers/ProviderActions";
import { ProviderIconBox } from "@/components/ProviderIconBox";
import UsageFooter from "@/components/UsageFooter";
import CopilotQuotaFooter from "@/components/CopilotQuotaFooter";
import CodexOauthQuotaFooter from "@/components/CodexOauthQuotaFooter";
import XaiOauthQuotaFooter from "@/components/XaiOauthQuotaFooter";
import KimiAccountQuotaFooter from "@/components/KimiAccountQuotaFooter";
import AgyAccountQuotaFooter from "@/components/AgyAccountQuotaFooter";
import ClaudeAccountQuotaFooter from "@/components/ClaudeAccountQuotaFooter";
import { ClaudeBoundAccountLine } from "@/components/providers/forms/ClaudeOfficialSection";
import { claudePlanLabel } from "@/lib/claudePlan";
import { useClaudeDefaultPlan } from "@/lib/query/subscription";
import { useAgyAccountSupported } from "@/components/providers/forms/AgyOAuthSection";
import { resolveManagedAccountId } from "@/lib/authBinding";
import SubscriptionQuotaFooter from "@/components/SubscriptionQuotaFooter";
import { ProviderHealthBadge } from "@/components/providers/ProviderHealthBadge";
import { FailoverPriorityBadge } from "@/components/providers/FailoverPriorityBadge";
import { PROVIDER_TYPES, TEMPLATE_TYPES } from "@/config/constants";
import { isHermesReadOnlyProvider } from "@/config/hermesProviderPresets";
import { extractProviderBaseUrl } from "@/utils/providerConfigUtils";
import { getRoutingReason } from "@/utils/routingReason";
import {
  terminalAvailable,
  terminalIsIsolated,
} from "@/components/providers/OpenTerminalDialog";
import {
  isKimiOfficialAccount,
  providerNeedsRouting,
  resolveCodexOfficialIdentity,
  supportsConnectivityCheck,
  supportsOfficialProxyTakeover,
} from "@/utils/providerCapabilities";
import { useProviderHealth } from "@/lib/query/failover";
import { useUsageQuery } from "@/lib/query/queries";

interface ProviderCardProps {
  aggregation?: AggregationActions;
  /** 删不掉时的原因（直连指针 / 正在路由的那家） */
  deleteDisabledReason?: string;
  provider: Provider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig?: boolean; // OpenCode: 是否已添加到 opencode.json
  isOmo?: boolean;
  isOmoSlim?: boolean;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onConfigureUsage: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onDuplicate: (provider: Provider) => void;
  onTest?: (provider: Provider) => void;
  onOpenTerminal?: (provider: Provider) => void;
  isTesting?: boolean;
  isProxyRunning: boolean;
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管，切换为热切换）
  isAutoFailoverEnabled?: boolean; // 是否开启自动故障转移
  failoverPriority?: number; // 故障转移优先级（1 = P1, 2 = P2, ...）
  isInFailoverQueue?: boolean; // 是否在故障转移队列中
  onToggleFailover?: (enabled: boolean) => void; // 切换故障转移队列
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  // OpenClaw: default model
  isDefaultModel?: boolean;
  onSetAsDefault?: (modelId?: string) => void;
  defaultModelOptions?: { id: string; name?: string }[];
}

const extractApiUrl = (provider: Provider, fallbackText: string) => {
  if (provider.notes?.trim()) {
    return provider.notes.trim();
  }

  if (provider.websiteUrl) {
    return provider.websiteUrl;
  }

  return extractProviderBaseUrl(provider.settingsConfig) ?? fallbackText;
};

function isOfficialProvider(provider: Provider, appId: AppId): boolean {
  if (appId === "kimi") return isKimiOfficialAccount(provider);
  if (provider.category === "official") return true;

  const config = provider.settingsConfig as Record<string, any>;

  if (appId === "claude") {
    const baseUrl = config?.env?.ANTHROPIC_BASE_URL;
    return !baseUrl || (typeof baseUrl === "string" && baseUrl.trim() === "");
  }

  if (appId === "codex") {
    const apiKey = config?.auth?.OPENAI_API_KEY;
    return !apiKey || (typeof apiKey === "string" && apiKey.trim() === "");
  }

  if (appId === "gemini" || appId === "agy") {
    // 无 GEMINI_API_KEY 且无 GOOGLE_GEMINI_BASE_URL → Google 登录的官方模式
    const apiKey = config?.env?.GEMINI_API_KEY;
    const baseUrl = config?.env?.GOOGLE_GEMINI_BASE_URL;
    return (
      (!apiKey || (typeof apiKey === "string" && apiKey.trim() === "")) &&
      (!baseUrl || (typeof baseUrl === "string" && baseUrl.trim() === ""))
    );
  }

  return false;
}

/** 没绑账号的 Claude 官方卡用 Claude Code 的默认登录：套餐跟在地址后面（「官网 · Max 20x」） */
function ClaudeDefaultPlanSuffix() {
  const { t } = useTranslation();
  const { data: plan } = useClaudeDefaultPlan(true);
  const label = claudePlanLabel(t, plan?.subscriptionType, plan?.rateLimitTier);
  if (!label) return null;
  return <span className="ms-1 shrink-0 text-muted-foreground">· {label}</span>;
}

/**
 * Antigravity 官方卡的额度：绑了授权中心账号就按那个号查，不用先切号；切号只实现了
 * macOS 钥匙串，服务端不支持时按 agy 当前登录查，忽略卡上的绑定。
 */
function AgyOfficialQuotaFooter({
  provider,
  isCurrent,
}: {
  provider: Provider;
  isCurrent: boolean;
}) {
  const supported = useAgyAccountSupported();
  const boundAccountId = supported
    ? resolveManagedAccountId(provider.meta, "agy_oauth")?.trim() || null
    : null;
  return boundAccountId ? (
    <AgyAccountQuotaFooter
      accountId={boundAccountId}
      inline={true}
      isCurrent={isCurrent}
    />
  ) : (
    <SubscriptionQuotaFooter appId="agy" inline={true} isCurrent={isCurrent} />
  );
}

/** Antigravity 卡片直接显示当前模型，省得进编辑才知道。 */
function extractAgyModel(provider: Provider): string | null {
  const config = provider.settingsConfig as Record<string, any>;
  const model = config?.config?.model?.name;
  if (typeof model === "string" && model.trim()) return model.trim();
  const envModel = config?.env?.GEMINI_MODEL;
  return typeof envModel === "string" && envModel.trim()
    ? envModel.trim()
    : null;
}

export function ProviderCard({
  aggregation,
  deleteDisabledReason,
  provider,
  isCurrent,
  appId,
  isInConfig = true,
  isOmo = false,
  isOmoSlim = false,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onConfigureUsage,
  onOpenWebsite,
  onDuplicate,
  onTest,
  onOpenTerminal,
  isTesting,
  isProxyRunning,
  isProxyTakeover = false,
  isAutoFailoverEnabled = false,
  failoverPriority,
  isInFailoverQueue = false,
  onToggleFailover,
  activeProviderId,
  // OpenClaw: default model
  isDefaultModel,
  onSetAsDefault,
  defaultModelOptions,
}: ProviderCardProps) {
  const { t } = useTranslation();

  // OMO and OMO Slim share the same card behavior
  const isAnyOmo = isOmo || isOmoSlim;
  const handleDisableAnyOmo = isOmoSlim ? onDisableOmoSlim : onDisableOmo;
  const isAdditiveMode =
    (appId === "opencode" && !isAnyOmo) ||
    appId === "pi" ||
    appId === "omp" ||
    appId === "mcode" ||
    appId === "kimi" ||
    appId === "dsh";

  const { data: health } = useProviderHealth(
    provider.id,
    appId,
    appId !== "pi" && appId !== "omp",
  );

  const fallbackUrlText = t("provider.notConfigured", {
    defaultValue: "未配置接口地址",
  });

  const displayUrl = useMemo(() => {
    return extractApiUrl(provider, fallbackUrlText);
  }, [provider, fallbackUrlText]);

  const isClickableUrl = useMemo(() => {
    if (provider.notes?.trim()) {
      return false;
    }
    if (displayUrl === fallbackUrlText) {
      return false;
    }
    return true;
  }, [provider.notes, displayUrl, fallbackUrlText]);

  const isBoundCodexOfficial =
    resolveCodexOfficialIdentity(appId, provider) === "managed_account";
  const isOfficial = isOfficialProvider(provider, appId);
  // Claude 官方卡绑了 Claude 官方账号：副标题写账号，额度按这个号查
  const claudeBoundAccountId =
    appId === "claude" && isOfficial
      ? resolveManagedAccountId(provider.meta, "claude_official")?.trim() ||
        null
      : null;
  // 绑了账号的官方卡（Codex / Claude）默认查额度，和 Kimi、agy 的账号卡一样
  const usageEnabled =
    provider.meta?.usage_script?.enabled ??
    (isBoundCodexOfficial || Boolean(claudeBoundAccountId));
  // 没绑账号的 Claude 官方卡用 Claude Code 的默认登录：开了官方订阅额度查询时，地址后面跟默认登录的套餐
  const showClaudeDefaultPlan =
    appId === "claude" &&
    isOfficial &&
    !claudeBoundAccountId &&
    usageEnabled &&
    provider.meta?.usage_script?.templateType ===
      TEMPLATE_TYPES.OFFICIAL_SUBSCRIPTION;
  const agyModel = useMemo(
    () => (appId === "agy" ? extractAgyModel(provider) : null),
    [appId, provider],
  );

  const isCopilot =
    provider.meta?.providerType === PROVIDER_TYPES.GITHUB_COPILOT ||
    provider.meta?.usage_script?.templateType === "github_copilot";
  const isHermesReadOnly =
    appId === "hermes" && isHermesReadOnlyProvider(provider.settingsConfig);
  const isCodexOauth =
    provider.meta?.providerType === PROVIDER_TYPES.CODEX_OAUTH ||
    isBoundCodexOfficial;
  const isXaiOauth = provider.meta?.providerType === PROVIDER_TYPES.XAI_OAUTH;

  const needsRouting = providerNeedsRouting(appId, provider);
  // 徽标的说明：这家为什么需要路由（和直连切换时的提示同一份）
  const routingReason = needsRouting
    ? getRoutingReason(appId, provider, t)
    : null;
  const supportsOfficialRouting = supportsOfficialProxyTakeover(
    appId,
    provider,
  );

  // 获取用量数据以判断是否有多套餐
  // 累加模式应用（OpenCode/OpenClaw/Hermes）：使用 isInConfig 代替 isCurrent
  const shouldAutoQuery =
    appId === "opencode" ||
    appId === "openclaw" ||
    appId === "hermes" ||
    appId === "pi" ||
    appId === "omp"
      ? isInConfig
      : isCurrent;
  const autoQueryInterval = shouldAutoQuery
    ? provider.meta?.usage_script?.autoQueryInterval || 0
    : 0;

  // 脚本用量只在「已启用 + 非官方 + 非官方订阅模板 + 非托管 Codex 官方账号」时才查询；
  // 展开判定必须复用同一谓词，因为禁用的 React Query observer 仍会返回同 key 的旧缓存
  // （上游 cc-switch 2c735bd9）。官方供应商走 SubscriptionQuotaFooter，不展示脚本用量。
  const isOfficialSubscriptionUsage =
    provider.meta?.usage_script?.templateType ===
    TEMPLATE_TYPES.OFFICIAL_SUBSCRIPTION;
  const scriptUsageActive =
    usageEnabled &&
    !isBoundCodexOfficial &&
    !isOfficial &&
    !isOfficialSubscriptionUsage;
  const { data: usage } = useUsageQuery(provider.id, appId, {
    enabled: scriptUsageActive,
    autoQueryInterval,
  });

  const isTokenPlan =
    provider.meta?.usage_script?.templateType === "token_plan";
  // 官方订阅的额度窗口不能按普通多套餐展开；缓存残留的旧脚本结果同样不认。
  const hasMultiplePlans =
    scriptUsageActive &&
    !isTokenPlan &&
    usage?.success &&
    usage.data &&
    usage.data.length > 1;

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (hasMultiplePlans) {
      setIsExpanded(true);
    }
  }, [hasMultiplePlans]);

  const handleOpenWebsite = () => {
    if (!isClickableUrl) {
      return;
    }
    onOpenWebsite(displayUrl);
  };

  // 判断是否是"当前使用中"的供应商
  // - OMO/OMO Slim 供应商：使用 isCurrent
  // - OpenClaw：使用默认模型归属的 provider 作为当前项（蓝色边框）
  // - OpenCode（非 OMO）：不存在"当前"概念，返回 false
  // - 故障转移模式：代理实际使用的供应商（activeProviderId）
  // - 普通模式：isCurrent
  const isActiveProvider = isAnyOmo
    ? isCurrent
    : appId === "openclaw"
      ? Boolean(isDefaultModel)
      : appId === "opencode"
        ? Boolean(isDefaultModel)
        : appId === "mcode" || appId === "dsh"
          ? false
          : appId === "pi" || appId === "omp"
            ? false
            : isAutoFailoverEnabled
              ? activeProviderId === provider.id
              : isCurrent;

  const shouldUseViolet = Boolean(aggregation?.member);
  const shouldUseGreen =
    !aggregation && !isAnyOmo && isProxyTakeover && isActiveProvider;
  const hasPersistentConfigHighlight = isAdditiveMode && isInConfig;
  const shouldUseBlue =
    !aggregation &&
    ((isAnyOmo && isActiveProvider) ||
      (!isAnyOmo &&
        !isProxyTakeover &&
        (isActiveProvider || hasPersistentConfigHighlight)));

  return (
    <div
      className={cn(
        "glass-card group relative overflow-hidden rounded-2xl border border-border-default text-card-foreground transition-[border-color,box-shadow,background-color] duration-150",
        isAutoFailoverEnabled || isProxyTakeover
          ? "hover:border-[hsl(var(--success)/0.45)]"
          : "hover:border-border-active",
        shouldUseViolet &&
          "border-violet-400/60 bg-violet-50/40 dark:border-violet-500/50 dark:bg-violet-950/20",
        shouldUseGreen && "provider-card-active-success",
        shouldUseBlue && "provider-card-active-primary",
        !(isActiveProvider || hasPersistentConfigHighlight) &&
          "hover:shadow-sm",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent transition-opacity duration-500",
          shouldUseGreen && "provider-card-overlay-success",
          shouldUseBlue && "provider-card-overlay-primary",
          !(isActiveProvider || hasPersistentConfigHighlight) &&
            "from-primary/10",
          isActiveProvider || hasPersistentConfigHighlight
            ? "opacity-100"
            : "opacity-0",
        )}
      />
      {/* 一行排开（上游 v7）：图标 → 名称与副标题 → 用量列 → 操作；窄屏时用量与操作换到第二行靠右 */}
      <div className="relative flex min-h-[58px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <ProviderIconBox
          icon={provider.icon}
          name={provider.name}
          color={provider.iconColor}
          className="bg-background/80"
        />

        <div className="min-w-0 flex-1 basis-40">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3
              className="m-0 min-w-0 max-w-full truncate text-sm font-semibold text-foreground"
              title={provider.name}
            >
              {provider.name}
            </h3>

            {isOmo && <CardChip className="theme-chip-primary">OMO</CardChip>}

            {isOmoSlim && (
              <CardChip className="theme-chip-tertiary">Slim</CardChip>
            )}

            {isProxyRunning && isInFailoverQueue && health && (
              <ProviderHealthBadge
                consecutiveFailures={health.consecutive_failures}
              />
            )}

            {isAutoFailoverEnabled && isInFailoverQueue && failoverPriority && (
              <FailoverPriorityBadge priority={failoverPriority} />
            )}

            {needsRouting && (
              <CardChip
                className="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                title={routingReason ?? undefined}
              >
                {t("codex.needsRouting", {
                  defaultValue: "需要路由",
                })}
              </CardChip>
            )}

            {supportsOfficialRouting && (
              <CardChip className="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {isProxyTakeover
                  ? t("codex.officialRouting", {
                      defaultValue: "官方账号路由",
                    })
                  : t("codex.nativeLogin", {
                      defaultValue: "Codex 登录",
                    })}
              </CardChip>
            )}

            {isHermesReadOnly && (
              <CardChip
                className="border border-border-default text-muted-foreground"
                title={t("provider.managedByHermesHint")}
              >
                {t("provider.managedByHermes")}
              </CardChip>
            )}
          </div>

          {claudeBoundAccountId ? (
            <ClaudeBoundAccountLine
              accountId={claudeBoundAccountId}
              providerName={provider.name}
              showPlan={usageEnabled}
            />
          ) : agyModel ? (
            <div
              className="mt-0.5 flex min-w-0 items-center text-xs text-muted-foreground"
              title={agyModel}
            >
              <span className="min-w-0 truncate">{agyModel}</span>
            </div>
          ) : (
            displayUrl && (
              <button
                type="button"
                onClick={handleOpenWebsite}
                className={cn(
                  "mt-0.5 inline-flex max-w-full items-center overflow-hidden text-start text-xs",
                  isClickableUrl
                    ? "cursor-pointer text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline"
                    : "cursor-default text-muted-foreground",
                )}
                title={displayUrl}
                disabled={!isClickableUrl}
              >
                <span className="min-w-0 truncate">{displayUrl}</span>
                {showClaudeDefaultPlan && <ClaudeDefaultPlanSuffix />}
              </button>
            )
          )}
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-3">
          {/* 额度列最宽 208：带重置倒计时时也不挤占操作位 */}
          <div className="max-w-[208px] text-end">
            <div className="flex items-center justify-end gap-1">
              {isCopilot ? (
                <CopilotQuotaFooter
                  meta={provider.meta}
                  inline={true}
                  isCurrent={isCurrent}
                />
              ) : isCodexOauth ? (
                !isBoundCodexOfficial || usageEnabled ? (
                  <CodexOauthQuotaFooter
                    meta={provider.meta}
                    inline={true}
                    isCurrent={isCurrent}
                    autoQueryInterval={
                      isBoundCodexOfficial
                        ? (provider.meta?.usage_script?.autoQueryInterval ?? 5)
                        : undefined
                    }
                  />
                ) : null
              ) : isXaiOauth ? (
                <XaiOauthQuotaFooter
                  meta={provider.meta}
                  inline={true}
                  isCurrent={isCurrent}
                />
              ) : appId === "agy" && isOfficial ? (
                <AgyOfficialQuotaFooter
                  provider={provider}
                  isCurrent={isCurrent}
                />
              ) : claudeBoundAccountId ? (
                usageEnabled ? (
                  <ClaudeAccountQuotaFooter
                    accountId={claudeBoundAccountId}
                    inline={true}
                    isCurrent={isCurrent}
                    autoQueryInterval={
                      provider.meta?.usage_script?.autoQueryInterval ?? 5
                    }
                  />
                ) : null
              ) : appId === "kimi" && isOfficial ? (
                // 每张 Kimi 官方卡就是授权中心里的一个账号，额度按卡上那个号查
                <KimiAccountQuotaFooter
                  accountId={provider.id}
                  name={provider.name}
                  inline={true}
                  isCurrent={isCurrent}
                />
              ) : isOfficial ? (
                <SubscriptionQuotaFooter
                  appId={appId}
                  inline={true}
                  isCurrent={isCurrent}
                />
              ) : hasMultiplePlans ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {t("usage.multiplePlans", {
                    count: usage?.data?.length || 0,
                    defaultValue: `${usage?.data?.length || 0} 个套餐`,
                  })}
                </span>
              ) : (
                <UsageFooter
                  provider={provider}
                  providerId={provider.id}
                  appId={appId}
                  usageEnabled={usageEnabled}
                  isCurrent={isCurrent}
                  isInConfig={isInConfig}
                  inline={true}
                />
              )}
              {hasMultiplePlans && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                  title={
                    isExpanded
                      ? t("usage.collapse", { defaultValue: "收起" })
                      : t("usage.expand", { defaultValue: "展开" })
                  }
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
              )}
            </div>
          </div>

          <ProviderActions
            aggregation={aggregation}
            failoverUnavailable={
              appId === "codex" &&
              resolveCodexOfficialIdentity(appId, provider) !== null
            }
            deleteDisabledReason={
              deleteDisabledReason ??
              // 仍在 Kimi 里的官方卡不能直接删：删号在授权中心（连登录一起删）
              (appId === "kimi" && isOfficial && isInConfig
                ? t("kimi.oauth.managedHint")
                : undefined)
            }
            deleteDisabled={
              Boolean(deleteDisabledReason) ||
              (appId === "kimi" && isOfficial && isInConfig)
            }
            appId={appId}
            isCurrent={isCurrent}
            isInConfig={isInConfig}
            isTesting={isTesting}
            isProxyTakeover={isProxyTakeover}
            isReadOnly={isHermesReadOnly}
            isOmo={isAnyOmo}
            onSwitch={() => onSwitch(provider)}
            onEdit={() => onEdit(provider)}
            onDuplicate={
              appId === "kimi" && isOfficial
                ? undefined
                : () => onDuplicate(provider)
            }
            onTest={
              onTest &&
              supportsConnectivityCheck(appId, provider) &&
              !isOfficial &&
              !isCopilot &&
              !isCodexOauth &&
              !isXaiOauth
                ? () => onTest(provider)
                : undefined
            }
            onConfigureUsage={
              (isOfficial && !isBoundCodexOfficial) ||
              isCopilot ||
              (isCodexOauth && !isBoundCodexOfficial) ||
              isXaiOauth
                ? undefined
                : () => onConfigureUsage(provider)
            }
            onDelete={() => onDelete(provider)}
            onRemoveFromConfig={
              onRemoveFromConfig
                ? () => onRemoveFromConfig(provider)
                : undefined
            }
            onDisableOmo={handleDisableAnyOmo}
            onOpenTerminal={
              onOpenTerminal && terminalAvailable(provider, appId, isCurrent)
                ? () => onOpenTerminal(provider)
                : undefined
            }
            openTerminalIsolated={terminalIsIsolated(provider, appId)}
            isAutoFailoverEnabled={isAutoFailoverEnabled}
            isInFailoverQueue={isInFailoverQueue}
            onToggleFailover={onToggleFailover}
            isDefaultModel={isDefaultModel}
            onSetAsDefault={onSetAsDefault}
            defaultModelOptions={defaultModelOptions}
          />
        </div>
      </div>

      {isExpanded && hasMultiplePlans && (
        <div className="relative mx-4 mb-3 border-t border-border-default pt-3">
          <UsageFooter
            provider={provider}
            providerId={provider.id}
            appId={appId}
            usageEnabled={usageEnabled}
            isCurrent={isCurrent}
            isInConfig={isInConfig}
            inline={false}
          />
        </div>
      )}
    </div>
  );
}

/** 名称后面的小标签（上游 v7 的胶囊样式，颜色沿用 Web 主题） */
function CardChip({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium",
        title && "cursor-help",
        className,
      )}
    >
      {children}
    </span>
  );
}
