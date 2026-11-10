import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestLog } from "@/types/usage";
import { RequestDetailPanel } from "@/components/usage/RequestDetailPanel";

const detail = vi.hoisted(() => ({ current: null as RequestLog | null }));

vi.mock("@/lib/query/usage", () => ({
  useRequestDetail: () => ({
    data: detail.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/query", () => ({
  useSettingsQuery: () => ({ data: undefined }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh" },
  }),
}));

function makeLog(overrides: Partial<RequestLog>): RequestLog {
  return {
    requestId: "req-1",
    providerId: "p1",
    providerName: "Packy",
    appType: "claude",
    model: "kimi-k2",
    requestModel: "claude-sonnet-4-6",
    costMultiplier: "1",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    inputCostUsd: "0.01",
    outputCostUsd: "0.02",
    cacheReadCostUsd: "0",
    cacheCreationCostUsd: "0",
    totalCostUsd: "0.03",
    isStreaming: false,
    latencyMs: 100,
    statusCode: 200,
    createdAt: 1_760_000_000,
    ...overrides,
  } as RequestLog;
}

describe("RequestDetailPanel 计价模型", () => {
  beforeEach(() => {
    detail.current = null;
  });

  it("计价模型与模型不同时单列一行", () => {
    detail.current = makeLog({ pricingModel: "claude-sonnet-4-6" });
    render(<RequestDetailPanel requestId="req-1" onClose={() => {}} />);
    expect(screen.getByText("usage.pricingModel")).toBeInTheDocument();
  });

  it("计价模型与模型相同或为空时不重复显示", () => {
    detail.current = makeLog({ pricingModel: "kimi-k2" });
    const { unmount } = render(
      <RequestDetailPanel requestId="req-1" onClose={() => {}} />,
    );
    expect(screen.queryByText("usage.pricingModel")).not.toBeInTheDocument();
    unmount();

    detail.current = makeLog({ pricingModel: undefined });
    render(<RequestDetailPanel requestId="req-1" onClose={() => {}} />);
    expect(screen.queryByText("usage.pricingModel")).not.toBeInTheDocument();
  });
});
