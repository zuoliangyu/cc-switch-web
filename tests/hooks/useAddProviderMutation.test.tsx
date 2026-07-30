import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddProviderMutation } from "@/lib/query/mutations";
import type { Provider } from "@/types";

const importDefaultMock = vi.hoisted(() => vi.fn());
const getAllMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  providersApi: {
    importDefault: (...args: unknown[]) => importDefaultMock(...args),
    getAll: (...args: unknown[]) => getAllMock(...args),
    add: (...args: unknown[]) => addMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const officialProvider: Provider = {
  id: "grokbuild-official",
  name: "Grok Official",
  category: "official",
  settingsConfig: { config: "" },
};

describe("useAddProviderMutation", () => {
  beforeEach(() => {
    importDefaultMock.mockReset().mockResolvedValue(true);
    getAllMock.mockReset().mockResolvedValue({
      "grokbuild-official": officialProvider,
    });
    addMock.mockReset();
  });

  it("官方 Grok 预设复用 import-default seed，不创建随机 Provider", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddProviderMutation("grokbuild"), {
      wrapper,
    });

    let created: Provider | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        name: "Grok Official",
        category: "official",
        settingsConfig: { config: "" },
        ensureGrokBuildOfficialSeed: true,
      });
    });

    expect(importDefaultMock).toHaveBeenCalledWith("grokbuild");
    expect(getAllMock).toHaveBeenCalledWith("grokbuild");
    expect(addMock).not.toHaveBeenCalled();
    expect(created).toEqual(officialProvider);
  });

  it("Hermes 使用 providerKey 作为 Provider ID", async () => {
    addMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddProviderMutation("hermes"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Hermes Demo",
        settingsConfig: { base_url: "https://api.example.com/v1" },
        providerKey: "hermes-demo",
      });
    });

    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hermes-demo" }),
      "hermes",
      undefined,
    );
  });

  it("Codex 官方预设使用稳定 Provider ID", async () => {
    addMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddProviderMutation("codex"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "OpenAI Official",
        category: "official",
        settingsConfig: { auth: {}, config: "" },
        ensureCodexOfficialSeed: true,
      });
    });

    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex-official" }),
      "codex",
      undefined,
    );
  });
});
