import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { Provider } from "@/types";
import { ProviderList } from "@/components/providers/ProviderList";

const providerCardRenderSpy = vi.fn();
const getClaudeDesktopStatusMock = vi.hoisted(() => vi.fn());
const importDefaultMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/api/providers", () => ({
  providersApi: {
    importDefault: importDefaultMock,
    importOpenCodeFromLive: vi.fn(),
    importOpenClawFromLive: vi.fn(),
    getOpenCodeLiveProviderIds: vi.fn(),
  },
}));

vi.mock("@/lib/api/claudeDesktop", () => ({
  claudeDesktopApi: { getStatus: getClaudeDesktopStatusMock },
}));

vi.mock("@/components/providers/ProviderCard", () => ({
  ProviderCard: (props: any) => {
    providerCardRenderSpy(props);
    const {
      provider,
      onSwitch,
      onEdit,
      onDelete,
      onDuplicate,
      onConfigureUsage,
    } = props;

    return (
      <div data-testid={`provider-card-${provider.id}`}>
        <button
          data-testid={`switch-${provider.id}`}
          onClick={() => onSwitch(provider)}
        >
          switch
        </button>
        <button
          data-testid={`edit-${provider.id}`}
          onClick={() => onEdit(provider)}
        >
          edit
        </button>
        <button
          data-testid={`duplicate-${provider.id}`}
          onClick={() => onDuplicate(provider)}
        >
          duplicate
        </button>
        <button
          data-testid={`usage-${provider.id}`}
          onClick={() => onConfigureUsage(provider)}
        >
          usage
        </button>
        <button
          data-testid={`delete-${provider.id}`}
          onClick={() => onDelete(provider)}
        >
          delete
        </button>
        <span data-testid={`is-current-${provider.id}`}>
          {props.isCurrent ? "current" : "inactive"}
        </span>
      </div>
    );
  },
}));

const dshAccountStatusMock = vi.fn();

vi.mock("@/components/providers/DshAccount", () => ({
  useDshAccountStatus: (enabled: boolean) =>
    enabled ? dshAccountStatusMock() : { data: undefined },
  accountName: (status: any, fallback: string) =>
    status.profile?.name ?? fallback,
  DshAccountCard: ({ status }: any) => (
    <div data-testid="dsh-account-card">{status.profile?.name}</div>
  ),
}));

vi.mock("@/components/UsageFooter", () => ({
  default: () => <div data-testid="usage-footer" />,
}));

// Mock hooks that use QueryClient
vi.mock("@/hooks/useStreamCheck", () => ({
  useStreamCheck: () => ({
    checkProvider: vi.fn(),
    isChecking: () => false,
  }),
}));

vi.mock("@/lib/query/failover", () => ({
  useAutoFailoverEnabled: () => ({ data: false }),
  useFailoverQueue: () => ({ data: [] }),
  useAddToFailoverQueue: () => ({ mutate: vi.fn() }),
  useRemoveFromFailoverQueue: () => ({ mutate: vi.fn() }),
  useReorderFailoverQueue: () => ({ mutate: vi.fn() }),
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: overrides.id ?? "provider-1",
    name: overrides.name ?? "Test Provider",
    settingsConfig: overrides.settingsConfig ?? {},
    category: overrides.category,
    createdAt: overrides.createdAt,
    sortIndex: overrides.sortIndex,
    meta: overrides.meta,
    websiteUrl: overrides.websiteUrl,
  };
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
    queryClient,
  };
}

beforeEach(() => {
  providerCardRenderSpy.mockClear();
  importDefaultMock.mockReset();
  toastErrorMock.mockReset();
  getClaudeDesktopStatusMock.mockResolvedValue({
    supported: true,
    configured: false,
    appliedId: null,
    profilePath: null,
    configLibraryPath: null,
    mode: null,
    expectedBaseUrl: null,
    actualBaseUrl: null,
    proxyRunning: false,
    staleRawModels: false,
    missingRouteMappings: false,
    gatewayTokenConfigured: false,
  });
});

describe("ProviderList Component", () => {
  it("MiniMax 空列表说明自动读取原生配置，不提示不存在的导入按钮", async () => {
    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="mcode"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    await screen.findByText("mcode.empty.title");
    expect(screen.getByText("mcode.empty.description")).toBeInTheDocument();
    expect(
      screen.queryByText("provider.noProvidersDescription"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "provider.importCurrent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "provider.addProvider" }),
    ).toBeInTheDocument();
  });
  it("should render skeleton placeholders when loading", () => {
    const { container } = renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        isLoading
      />,
    );

    const placeholders = container.querySelectorAll(
      ".border-dashed.border-muted-foreground\\/40",
    );
    expect(placeholders).toHaveLength(3);
  });

  it("should show empty state and trigger create callback when no providers exist", () => {
    const handleCreate = vi.fn();

    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        onCreate={handleCreate}
      />,
    );

    const addButton = screen.getByRole("button", {
      name: "provider.addProvider",
    });
    fireEvent.click(addButton);

    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  it("shows string import errors and refreshes providers after failure", async () => {
    importDefaultMock.mockRejectedValueOnce("live config is invalid");
    const { queryClient } = renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(
      screen.getByRole("button", { name: "provider.importCurrent" }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("live config is invalid"),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["providers", "claude"],
    });
  });

  it("按名称忽略大小写排序，忽略旧排名、创建时间和当前项，并保留操作回调", () => {
    const providerA = createProvider({
      id: "a",
      name: "alpha",
      sortIndex: 9,
      createdAt: 200,
    });
    const providerB = createProvider({
      id: "b",
      name: "Beta",
      sortIndex: 0,
      createdAt: 100,
    });

    const handleSwitch = vi.fn();
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();
    const handleDuplicate = vi.fn();
    const handleUsage = vi.fn();
    const handleOpenWebsite = vi.fn();

    renderWithQueryClient(
      <ProviderList
        providers={{ b: providerB, a: providerA }}
        currentProviderId="b"
        appId="claude"
        onSwitch={handleSwitch}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onConfigureUsage={handleUsage}
        onOpenWebsite={handleOpenWebsite}
      />,
    );

    // Verify sort order
    expect(providerCardRenderSpy).toHaveBeenCalledTimes(2);
    expect(providerCardRenderSpy.mock.calls[0][0].provider.id).toBe("a");
    expect(providerCardRenderSpy.mock.calls[1][0].provider.id).toBe("b");

    // Verify current provider marker
    expect(providerCardRenderSpy.mock.calls[1][0].isCurrent).toBe(true);

    // Trigger action buttons
    fireEvent.click(screen.getByTestId("switch-b"));
    fireEvent.click(screen.getByTestId("edit-b"));
    fireEvent.click(screen.getByTestId("duplicate-b"));
    fireEvent.click(screen.getByTestId("usage-b"));
    fireEvent.click(screen.getByTestId("delete-a"));

    expect(handleSwitch).toHaveBeenCalledWith(providerB);
    expect(handleEdit).toHaveBeenCalledWith(providerB);
    expect(handleDuplicate).toHaveBeenCalledWith(providerB);
    expect(handleUsage).toHaveBeenCalledWith(providerB);
    expect(handleDelete).toHaveBeenCalledWith(providerA);
  });

  it("filters providers with the search input", () => {
    const providerAlpha = createProvider({ id: "alpha", name: "Alpha Labs" });
    const providerBeta = createProvider({ id: "beta", name: "Beta Works" });

    renderWithQueryClient(
      <ProviderList
        providers={{ alpha: providerAlpha, beta: providerBeta }}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const searchInput = screen.getByPlaceholderText(
      "Search name, notes, or URL...",
    );
    // Initially both providers are rendered
    expect(screen.getByTestId("provider-card-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "beta" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "gamma" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-card-beta")).not.toBeInTheDocument();
    expect(
      screen.getByText("No providers match your search."),
    ).toBeInTheDocument();
  });

  it("shows Claude Desktop configuration drift", async () => {
    const provider = createProvider();
    getClaudeDesktopStatusMock.mockResolvedValueOnce({
      supported: true,
      configured: true,
      appliedId: provider.id,
      profilePath: "profile.json",
      configLibraryPath: "configLibrary",
      mode: "proxy",
      expectedBaseUrl: "http://127.0.0.1:15721/claude-desktop/v1",
      actualBaseUrl: "https://stale.example.com/v1",
      proxyRunning: true,
      staleRawModels: true,
      missingRouteMappings: true,
      gatewayTokenConfigured: false,
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ [provider.id]: provider }}
        currentProviderId={provider.id}
        appId="claude-desktop"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("claudeDesktop.statusTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("claudeDesktop.statusStaleRawModels"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("claudeDesktop.statusMissingRouteMappings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("claudeDesktop.statusGatewayTokenMissing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("claudeDesktop.statusBaseUrlMismatch"),
    ).toBeInTheDocument();
  });

  it("shows the signed-in DeepSeek account as an official card", async () => {
    dshAccountStatusMock.mockReturnValue({
      data: { signedIn: true, expired: false, profile: { name: "Jason" } },
    });
    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="dsh"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("dsh-account-card")).toHaveTextContent(
      "Jason",
    );
  });

  it("keeps the empty state and no account card while signed out of DeepSeek", async () => {
    dshAccountStatusMock.mockReturnValue({
      data: { signedIn: false, expired: false, profile: null },
    });
    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="dsh"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(await screen.findByText("dsh.empty.title")).toBeInTheDocument();
    expect(screen.queryByTestId("dsh-account-card")).not.toBeInTheDocument();
  });
});
