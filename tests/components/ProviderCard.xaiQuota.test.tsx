import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/components/providers/ProviderCard";
import type { Provider } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/query/failover", () => ({
  useProviderHealth: () => ({ data: undefined }),
}));
vi.mock("@/lib/query/queries", () => ({
  useUsageQuery: () => ({ data: undefined }),
}));
vi.mock("@/utils/providerCapabilities", () => ({
  providerNeedsRouting: () => false,
}));
vi.mock("@/components/providers/ProviderActions", () => ({
  ProviderActions: () => null,
}));
vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("@/components/UsageFooter", () => ({ default: () => null }));
vi.mock("@/components/CopilotQuotaFooter", () => ({ default: () => null }));
vi.mock("@/components/CodexOauthQuotaFooter", () => ({
  default: () => null,
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

function renderCard(provider: Provider, appId: "codex" | "grokbuild") {
  render(
    <ProviderCard
      provider={provider}
      isCurrent
      appId={appId}
      onSwitch={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onConfigureUsage={vi.fn()}
      onOpenWebsite={vi.fn()}
      onDuplicate={vi.fn()}
      isProxyRunning={false}
    />,
  );
}

describe("ProviderCard subscription quota", () => {
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
});
