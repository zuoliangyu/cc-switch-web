import type * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QueryKey } from "@tanstack/react-query";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ProviderCardActions } from "@/components/providers/ProviderCardActions";
import type {
  CardChip as CardChipSpec,
  CardPresentation,
  CardTone,
} from "@/components/providers/presentation";
import { ProviderIconBox } from "@/components/ProviderIconBox";
import UsageFooter from "@/components/UsageFooter";
import CopilotQuotaFooter from "@/components/CopilotQuotaFooter";
import CopilotCliQuotaFooter from "@/components/CopilotCliQuotaFooter";
import {
  copilotByokConfigOf,
  copilotEnvOf,
  isCopilotByok,
} from "@/config/copilotConfig";
import CodexOauthQuotaFooter from "@/components/CodexOauthQuotaFooter";
import XaiOauthQuotaFooter from "@/components/XaiOauthQuotaFooter";
import KimiAccountQuotaFooter from "@/components/KimiAccountQuotaFooter";
import AgyAccountQuotaFooter from "@/components/AgyAccountQuotaFooter";
import ClaudeAccountQuotaFooter from "@/components/ClaudeAccountQuotaFooter";
import { ClaudeBoundAccountLine } from "@/components/providers/forms/ClaudeOfficialSection";
import { claudePlanLabel } from "@/lib/claudePlan";
import {
  subscriptionKeys,
  useClaudeDefaultPlan,
} from "@/lib/query/subscription";
import { useQuotaPlan } from "@/lib/query/accountPlans";
import type { CopilotQuota } from "@/lib/query/copilot";
import { useAgyAccountSupported } from "@/components/providers/forms/AgyOAuthSection";
import { resolveManagedAccountId } from "@/lib/authBinding";
import SubscriptionQuotaFooter from "@/components/SubscriptionQuotaFooter";
import { ProviderHealthBadge } from "@/components/providers/ProviderHealthBadge";
import { PROVIDER_TYPES, TEMPLATE_TYPES } from "@/config/constants";
import { extractProviderBaseUrl } from "@/utils/providerConfigUtils";
import {
  terminalAvailable,
  terminalIsIsolated,
  terminalNeedsRoute,
} from "@/components/providers/OpenTerminalDialog";
import {
  isKimiOfficialAccount,
  resolveCodexOfficialIdentity,
  supportsConnectivityCheck,
} from "@/utils/providerCapabilities";
import { useProviderHealth } from "@/lib/query/failover";
import { useUsageQuery } from "@/lib/query/queries";

interface ProviderCardProps {
  provider: Provider;
  appId: AppId;
  /** 卡片怎么画：模式色、状态 / 按钮、徽标、禁用原因（由列表按应用和正在查看的模式算好） */
  presentation: CardPresentation;
  /** 用来决定官方订阅 / OAuth 额度是否自动查询 */
  isCurrent: boolean;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onConfigureUsage: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onDuplicate?: (provider: Provider) => void;
  onTest?: (provider: Provider) => void;
  onOpenTerminal?: (provider: Provider) => void;
  isTesting?: boolean;
}

/** 当前那张：模式色边框 + 淡底（沿用 Web 主题的卡片高亮）；累加应用的默认那家同直连色。 */
const TONE_CARD: Record<CardTone, { card: string; overlay?: string }> = {
  direct: {
    card: "provider-card-active-primary",
    overlay: "provider-card-overlay-primary",
  },
  route: {
    card: "provider-card-active-success",
    overlay: "provider-card-overlay-success",
  },
  stack: {
    card: "border-violet-400/60 bg-violet-50/40 dark:border-violet-500/50 dark:bg-violet-950/20",
  },
};

/** 徽标的配色：映射到 Web 主题的胶囊类名，不引入上游的模式令牌 */
const CHIP_TONE: Record<CardChipSpec["tone"], string> = {
  outline: "border border-border-default text-muted-foreground",
  direct: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  route:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  stack:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  success:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  warning:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

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
  if (appId === "copilot") return !isCopilotByok(provider.settingsConfig);

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

/** 副标题末尾的套餐（「· Pro 200」），写法同 Claude 默认登录的套餐 */
function PlanSuffix({ plan }: { plan: string }) {
  return <span className="ms-1 shrink-0 text-muted-foreground">· {plan}</span>;
}

const copilotPlan = (data: unknown) => (data as CopilotQuota).plan;

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

/** Copilot CLI 卡片显示模型（`COPILOT_MODEL`），自带模型卡再带上地址。 */
function extractCopilotSummary(provider: Provider): string | null {
  // 官方卡写的是 --model；自带模型卡写 providers.json 里的第一个模型（打开终端用它）和地址
  if (!isCopilotByok(provider.settingsConfig)) {
    return copilotEnvOf(provider.settingsConfig).COPILOT_MODEL?.trim() || null;
  }
  const { provider: node, models } = copilotByokConfigOf(
    provider.settingsConfig,
  );
  const ids = models.map((model) => model.id.trim()).filter(Boolean);
  const model = ids.length > 1 ? `${ids[0]} +${ids.length - 1}` : ids[0];
  const baseUrl = node.baseUrl.trim();
  if (model && baseUrl) return `${model} · ${baseUrl}`;
  return model || baseUrl || null;
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
  provider,
  appId,
  presentation,
  isCurrent,
  onEdit,
  onDelete,
  onConfigureUsage,
  onOpenWebsite,
  onDuplicate,
  onTest,
  onOpenTerminal,
  isTesting,
}: ProviderCardProps) {
  const { t } = useTranslation();

  const { data: health } = useProviderHealth(
    provider.id,
    appId,
    Boolean(presentation.showHealth),
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
    () =>
      appId === "agy"
        ? extractAgyModel(provider)
        : appId === "copilot"
          ? extractCopilotSummary(provider)
          : null,
    [appId, provider],
  );

  // Copilot CLI 官方卡的 Credits 额度在「配置用量查询」里开关；没设置过时，绑了授权中心账号
  // 的卡默认显示，没绑的默认不显示（打开后跟着 Copilot CLI 当前登录的账号查）。
  const isCopilotCliOfficial = appId === "copilot" && isOfficial;
  const copilotCliBoundAccountId = isCopilotCliOfficial
    ? resolveManagedAccountId(provider.meta, PROVIDER_TYPES.GITHUB_COPILOT)
    : null;
  const copilotCliQuotaEnabled =
    isCopilotCliOfficial &&
    (provider.meta?.usage_script?.enabled ?? Boolean(copilotCliBoundAccountId));
  const isCopilot =
    appId !== "copilot" &&
    (provider.meta?.providerType === PROVIDER_TYPES.GITHUB_COPILOT ||
      provider.meta?.usage_script?.templateType === "github_copilot");
  const isCodexOauth =
    provider.meta?.providerType === PROVIDER_TYPES.CODEX_OAUTH ||
    isBoundCodexOfficial;
  const isXaiOauth = provider.meta?.providerType === PROVIDER_TYPES.XAI_OAUTH;
  // Antigravity 官方卡绑了授权中心的账号：额度查绑定的号（服务端不支持切号时忽略绑定），
  // 与 AgyOfficialQuotaFooter 一致
  const agySupported = useAgyAccountSupported();
  const agyBoundAccountId =
    appId === "agy" && isOfficial && agySupported
      ? resolveManagedAccountId(provider.meta, "agy_oauth")?.trim() || null
      : null;
  // 副标题末尾的套餐：读右边额度那个查询的缓存（键和各额度 footer 一致），额度查到才有，
  // 不另发请求。Claude 官方卡另有写法（ClaudeDefaultPlanSuffix / ClaudeBoundAccountLine）
  const quotaPlanKey: QueryKey | null = isCopilotCliOfficial
    ? copilotCliQuotaEnabled && copilotCliBoundAccountId
      ? ["copilot", "quota", copilotCliBoundAccountId]
      : null
    : isCopilot
      ? [
          "copilot",
          "quota",
          resolveManagedAccountId(
            provider.meta,
            PROVIDER_TYPES.GITHUB_COPILOT,
          ) ?? "default",
        ]
      : isCodexOauth
        ? !isBoundCodexOfficial || usageEnabled
          ? [
              "codex_oauth",
              "quota",
              resolveManagedAccountId(
                provider.meta,
                PROVIDER_TYPES.CODEX_OAUTH,
              ) ?? "default",
            ]
          : null
        : isXaiOauth
          ? [
              "xai_oauth",
              "quota",
              resolveManagedAccountId(
                provider.meta,
                PROVIDER_TYPES.XAI_OAUTH,
              ) ?? "default",
            ]
          : appId === "agy" && isOfficial
            ? agyBoundAccountId
              ? ["agy_oauth", "quota", agyBoundAccountId]
              : subscriptionKeys.quota(appId)
            : appId === "kimi" && isOfficial
              ? ["kimi_oauth", "quota", provider.id]
              : isOfficial && appId !== "claude"
                ? subscriptionKeys.quota(appId)
                : null;
  const quotaPlan = useQuotaPlan(
    quotaPlanKey,
    isCopilot || isCopilotCliOfficial ? copilotPlan : undefined,
  );

  // 获取用量数据以判断是否有多套餐，按用户配置刷新，不依赖供应商启用状态。
  const autoQueryInterval = provider.meta?.usage_script?.autoQueryInterval ?? 0;

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

  const tone = presentation.tone ? TONE_CARD[presentation.tone] : null;

  return (
    <div
      className={cn(
        "glass-card group relative overflow-hidden rounded-2xl border border-border-default text-card-foreground transition-[border-color,box-shadow,background-color] duration-150",
        tone ? tone.card : "hover:border-border-active hover:shadow-sm",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent transition-opacity duration-500",
          tone?.overlay ?? "from-primary/10",
          tone?.overlay ? "opacity-100" : "opacity-0",
        )}
      />
      {/* 一行排开（上游 v7）：图标 → 名称与副标题 → 用量列 → 操作；窄屏时用量与操作换到第二行靠右 */}
      <div className="relative flex min-h-card flex-wrap items-center gap-x-3 gap-y-2 px-3 py-card-y">
        <ProviderIconBox
          icon={provider.icon}
          name={provider.name}
          color={provider.iconColor}
          className={cn(
            // 不垫底色：单色 / 近黑笔画的图标跟随文字色（ProviderIcon 里换成 currentColor），
            // 自带底色的 tile 图标铺满整框（上游 e66441d8）
            "bg-transparent text-foreground",
            presentation.dim && "opacity-60",
          )}
        />

        <div className="min-w-0 flex-1 basis-40">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3
              className={cn(
                "m-0 min-w-0 max-w-full truncate text-sm font-semibold",
                presentation.dim ? "text-muted-foreground" : "text-foreground",
              )}
              title={provider.name}
            >
              {provider.name}
            </h3>

            {presentation.chips.map((chip) => (
              <CardChip
                key={chip.key}
                className={CHIP_TONE[chip.tone]}
                title={chip.title}
              >
                {chip.label}
              </CardChip>
            ))}

            {presentation.showHealth && health && (
              <ProviderHealthBadge
                consecutiveFailures={health.consecutive_failures}
              />
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
              {quotaPlan && <PlanSuffix plan={quotaPlan} />}
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
                {showClaudeDefaultPlan ? (
                  <ClaudeDefaultPlanSuffix />
                ) : (
                  quotaPlan && <PlanSuffix plan={quotaPlan} />
                )}
              </button>
            )
          )}
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-3">
          {/* 额度列最宽 208：带重置倒计时时也不挤占操作位 */}
          <div className="max-w-[208px] text-end">
            <div className="flex items-center justify-end gap-1">
              {isCopilotCliOfficial ? (
                copilotCliQuotaEnabled ? (
                  <CopilotCliQuotaFooter
                    meta={provider.meta}
                    isCurrent={isCurrent}
                  />
                ) : null
              ) : isCopilot ? (
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

          <ProviderCardActions
            providerName={provider.name}
            presentation={presentation}
            onEdit={() => onEdit(provider)}
            onDelete={() => onDelete(provider)}
            onDuplicate={
              onDuplicate && !(appId === "kimi" && isOfficial)
                ? () => onDuplicate(provider)
                : undefined
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
            isTesting={isTesting}
            onConfigureUsage={
              (isOfficial && !isBoundCodexOfficial && !isCopilotCliOfficial) ||
              isCopilot ||
              (isCodexOauth && !isBoundCodexOfficial) ||
              isXaiOauth
                ? undefined
                : () => onConfigureUsage(provider)
            }
            onOpenTerminal={
              onOpenTerminal && terminalAvailable(provider, appId, isCurrent)
                ? () => onOpenTerminal(provider)
                : undefined
            }
            openTerminalIsolated={terminalIsIsolated(provider, appId)}
            openTerminalDisabledReason={
              terminalNeedsRoute(provider, appId)
                ? t("provider.openTerminalNeedsRoute")
                : // Copilot 自带模型卡要先写进 providers.json，终端才能用 --model 选到它
                  appId === "copilot" &&
                    !isOfficial &&
                    provider.meta?.liveConfigManaged !== true
                  ? t("copilot.terminalNeedsAdd")
                  : undefined
            }
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
