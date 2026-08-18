import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/components/providers/ProviderCard";
import type { Provider } from "@/types";

const codexQuotaFooterProps = vi.hoisted(() => vi.fn());
const useUsageQueryOptions = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/query/failover", () => ({
  useProviderHealth: () => ({ data: undefined }),
}));
vi.mock("@/lib/query/queries", () => ({
  useUsageQuery: (_providerId: string, _appId: string, options: unknown) => {
    useUsageQueryOptions(options);
    return { data: undefined };
  },
}));
vi.mock("@/utils/providerCapabilities", () => ({
  providerNeedsRouting: () => false,
  supportsOfficialProxyTakeover: () => false,
  resolveCodexOfficialIdentity: (appId: string, provider: Provider) =>
    appId === "codex" &&
    provider.meta?.authBinding?.source === "managed_account" &&
    provider.meta.authBinding.authProvider === "codex_oauth"
      ? "managed_account"
      : null,
}));
vi.mock("@/components/providers/ProviderActions", () => ({
  ProviderActions: (props: { onConfigureUsage?: () => void }) =>
    props.onConfigureUsage ? (
      <button onClick={props.onConfigureUsage}>configure-usage</button>
    ) : null,
}));
vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("@/components/UsageFooter", () => ({ default: () => null }));
vi.mock("@/components/CopilotQuotaFooter", () => ({ default: () => null }));
vi.mock("@/components/CodexOauthQuotaFooter", () => ({
  default: (props: unknown) => {
    codexQuotaFooterProps(props);
    return <div data-testid="codex-quota" />;
  },
}));
vi.mock("@/components/XaiOauthQuotaFooter", () => ({
  default: () => <div data-testid="xai-quota" />,
}));
vi.mock("@/components/SubscriptionQuotaFooter", () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid={`${appId}-quota`} />
  ),
}));
vi.mock("@/components/providers/ProviderHealthBadge", () => ({
  ProviderHealthBadge: () => null,
}));
vi.mock("@/components/providers/FailoverPriorityBadge", () => ({
  FailoverPriorityBadge: () => null,
}));

function renderCard(
  provider: Provider,
  appId: "codex" | "grokbuild",
  onConfigureUsage = vi.fn(),
) {
  return render(
    <ProviderCard
      provider={provider}
      isCurrent
      appId={appId}
      onSwitch={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onConfigureUsage={onConfigureUsage}
      onOpenWebsite={vi.fn()}
      onDuplicate={vi.fn()}
      isProxyRunning={false}
    />,
  );
}

describe("ProviderCard subscription quota", () => {
  beforeEach(() => {
    codexQuotaFooterProps.mockClear();
    useUsageQueryOptions.mockClear();
  });

  it("xAI OAuth Provider 使用绑定账号额度 footer", () => {
    renderCard(
      {
        id: "xai-oauth",
        name: "xAI OAuth",
        category: "third_party",
        settingsConfig: {},
        meta: { providerType: "xai_oauth" },
      } as Provider,
      "codex",
    );

    expect(screen.getByTestId("xai-quota")).toBeInTheDocument();
  });

  it("Grok Build 官方 Provider 使用官方订阅额度 footer", () => {
    renderCard(
      {
        id: "grokbuild-official",
        name: "Grok Official",
        category: "official",
        settingsConfig: { config: "" },
      } as Provider,
      "grokbuild",
    );

    expect(screen.getByTestId("grokbuild-quota")).toBeInTheDocument();
  });

  it("任意 Follow Login 别名默认展示额度并开放配置", () => {
    const onConfigureUsage = vi.fn();
    const provider = {
      id: "my-work-login",
      name: "Work account",
      category: "custom",
      settingsConfig: { auth: {}, config: "" },
      meta: {
        authBinding: {
          source: "managed_account",
          authProvider: "codex_oauth",
          accountId: "account-1",
        },
      },
    } as Provider;

    renderCard(provider, "codex", onConfigureUsage);

    expect(screen.getByTestId("codex-quota")).toBeInTheDocument();
    expect(codexQuotaFooterProps).toHaveBeenCalledWith(
      expect.objectContaining({ autoQueryInterval: 5 }),
    );
    expect(useUsageQueryOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "configure-usage" }));
    expect(onConfigureUsage).toHaveBeenCalledWith(provider);
  });

  it("绑定账号尊重关闭状态和自定义轮询间隔", () => {
    const baseProvider = {
      id: "another-login",
      name: "Another account",
      category: "custom",
      settingsConfig: { auth: {}, config: "" },
      meta: {
        authBinding: {
          source: "managed_account",
          authProvider: "codex_oauth",
          accountId: "account-2",
        },
        usage_script: {
          enabled: false,
          language: "javascript",
          code: "",
          templateType: "official_subscription",
          autoQueryInterval: 12,
        },
      },
    } as Provider;

    const { unmount } = renderCard(baseProvider, "codex");
    expect(screen.queryByTestId("codex-quota")).not.toBeInTheDocument();
    unmount();

    renderCard(
      {
        ...baseProvider,
        meta: {
          ...baseProvider.meta,
          usage_script: {
            ...baseProvider.meta!.usage_script!,
            enabled: true,
          },
        },
      } as Provider,
      "codex",
    );
    expect(codexQuotaFooterProps).toHaveBeenCalledWith(
      expect.objectContaining({ autoQueryInterval: 12 }),
    );
  });

  it("旧式 codex_oauth Provider 保持固定额度行为", () => {
    renderCard(
      {
        id: "legacy-codex-oauth",
        name: "Legacy OAuth",
        category: "third_party",
        settingsConfig: {},
        meta: {
          providerType: "codex_oauth",
          usage_script: {
            enabled: false,
            language: "javascript",
            code: "",
            autoQueryInterval: 0,
          },
        },
      } as Provider,
      "codex",
    );

    expect(screen.getByTestId("codex-quota")).toBeInTheDocument();
    expect(codexQuotaFooterProps).toHaveBeenCalledWith(
      expect.objectContaining({ autoQueryInterval: undefined }),
    );
    expect(
      screen.queryByRole("button", { name: "configure-usage" }),
    ).not.toBeInTheDocument();
  });
});
