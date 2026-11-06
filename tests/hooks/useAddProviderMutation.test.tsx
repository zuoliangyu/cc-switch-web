import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddProviderMutation } from "@/lib/query/mutations";
import type { Provider } from "@/types";

const importDefaultMock = vi.hoisted(() => vi.fn());
const getAllMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  providersApi: {
    importDefault: (...args: unknown[]) => importDefaultMock(...args),
    getAll: (...args: unknown[]) => getAllMock(...args),
    add: (...args: unknown[]) => addMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
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
  it("passes Claude editor context separately from the stored provider", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddProviderMutation("claude"), {
      wrapper,
    });
    const editorSave = { base: { hooks: {} }, onConflict: "refuse" as const };
    await act(async () => {
      await result.current.mutateAsync({
        name: "Claude",
        settingsConfig: { env: {} },
        editorSave,
      });
    });
    const [row, app, , context] = addMock.mock.calls[0];
    expect(row).not.toHaveProperty("editorSave");
    expect(app).toBe("claude");
    expect(context).toEqual(editorSave);
  });
  beforeEach(() => {
    importDefaultMock.mockReset().mockResolvedValue(true);
    getAllMock.mockReset().mockResolvedValue({
      "grokbuild-official": officialProvider,
    });
    addMock.mockReset();
    updateMock.mockReset().mockResolvedValue(true);
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

  it("official Grok creation saves global edits with the resolved stable row", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddProviderMutation("grokbuild"), {
      wrapper,
    });
    const editorSave = { base: { config: "" }, onConflict: "refuse" as const };
    await act(async () => {
      await result.current.mutateAsync({
        name: "Grok",
        category: "official",
        settingsConfig: { config: "[ui]\ntheme = 'light'\n" },
        ensureGrokBuildOfficialSeed: true,
        editorSave,
      });
    });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "grokbuild-official",
        settingsConfig: { config: "[ui]\ntheme = 'light'\n" },
      }),
      "grokbuild",
      undefined,
      editorSave,
    );
    expect(updateMock.mock.calls[0][0]).not.toHaveProperty("editorSave");
    expect(addMock).not.toHaveBeenCalled();
  });

  it.each(["hermes", "mcode"] as const)(
    "%s 使用 providerKey 作为 Provider ID",
    async (appId) => {
      addMock.mockResolvedValue(undefined);
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      const { result } = renderHook(() => useAddProviderMutation(appId), {
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
        appId,
        undefined,
      );
    },
  );

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

  it.each([
    [{}, true],
    [
      {
        "claude-desktop-official": {
          id: "claude-desktop-official",
          name: "Claude Desktop Official",
          category: "official",
          settingsConfig: { env: {} },
        },
      },
      false,
    ],
  ])(
    "Claude Desktop 官方预设落到固定 id，已有官方卡时不再加第二张（%#）",
    async (existing, shouldAdd) => {
      addMock.mockReset();
      addMock.mockResolvedValue(undefined);
      getAllMock.mockReset();
      getAllMock.mockResolvedValue(existing);
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      const { result } = renderHook(
        () => useAddProviderMutation("claude-desktop"),
        { wrapper },
      );

      let returned: Provider | undefined;
      await act(async () => {
        returned = await result.current.mutateAsync({
          name: "Claude Desktop Official",
          category: "official",
          settingsConfig: { env: {} },
          ensureClaudeDesktopOfficialSeed: true,
        });
      });

      expect(returned?.id).toBe("claude-desktop-official");
      if (shouldAdd) {
        expect(addMock).toHaveBeenCalledWith(
          expect.objectContaining({ id: "claude-desktop-official" }),
          "claude-desktop",
          undefined,
        );
      } else {
        expect(addMock).not.toHaveBeenCalled();
      }
    },
  );
});
