import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { createTestQueryClient } from "../utils/testQueryClient";
import { server } from "../msw/server";
import { setSettings } from "../msw/state";
import { parse as parseToml } from "smol-toml";
import type { ProviderFormProps } from "@/components/providers/forms/ProviderForm";
import { providerNeedsRouting } from "@/utils/providerCapabilities";

vi.mock("@/components/JsonEditor", () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} />
  ),
}));
vi.mock("@/components/providers/forms/hooks", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/providers/forms/hooks")
  >()),
  useManagedAuth: () => ({ isAuthenticated: false, accounts: [] }),
}));
vi.mock("@/components/providers/forms/ProviderPresetSelector", () => ({
  ProviderPresetSelector: ({
    onPresetChange,
  }: {
    onPresetChange: (id: string) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onPresetChange(
            `codex-${codexProviderPresets.findIndex((preset) => preset.category !== "official")}`,
          )
        }
      >
        choose-preset
      </button>
      <button type="button" onClick={() => onPresetChange("custom")}>
        choose-custom
      </button>
    </>
  ),
}));

describe("Codex editor global baseline", () => {
  it("原生 Responses 保存自定义模型目录后仍可直连", async () => {
    setSettings({ commonConfigConfirmed: true });
    const onSubmit = vi.fn<ProviderFormProps["onSubmit"]>();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProviderForm
          appId="codex"
          initialData={{
            name: "Direct Responses",
            category: "custom",
            settingsConfig: {
              auth: { OPENAI_API_KEY: "sk-test" },
              config:
                'model_provider = "custom"\n[model_providers.custom]\nname = "Direct"\nbase_url = "https://example.com/v1"\nwire_api = "responses"\n',
            },
          }}
          submitLabel="save-provider"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.advancedOptionsToggle",
      }),
    );
    expect(
      screen.queryByRole("switch", { name: "codexConfig.localRoutingToggle" }),
    ).not.toBeInTheDocument();
    // 模型列表常驻在高级选项外面，留空即不生成目录（上游 0dae89e2）
    fireEvent.click(
      screen.getByRole("button", { name: "codexConfig.addCatalogModel" }),
    );
    fireEvent.change(
      screen.getByLabelText("codexConfig.catalogColumnDisplay"),
      { target: { value: "MiMo" } },
    );
    fireEvent.change(screen.getByLabelText("codexConfig.catalogColumnModel"), {
      target: { value: "mimo-v2.5-pro" },
    });
    fireEvent.change(
      screen.getByLabelText("codexConfig.catalogColumnContext"),
      { target: { value: "262144" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "save-provider" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    const settingsConfig = JSON.parse(submitted.settingsConfig);
    expect(settingsConfig.modelCatalog.models).toEqual([
      expect.objectContaining({
        model: "mimo-v2.5-pro",
        displayName: "MiMo",
        contextWindow: 262144,
      }),
    ]);
    expect(parseToml(settingsConfig.config)).toMatchObject({
      model: "mimo-v2.5-pro",
      model_providers: {
        custom: { base_url: "https://example.com/v1", wire_api: "responses" },
      },
    });
    expect(
      providerNeedsRouting("codex", {
        id: "direct",
        name: submitted.name,
        settingsConfig,
        meta: submitted.meta,
      }),
    ).toBe(false);
  });

  it("删光模型列表仍保留 Chat 的思考与缓存参数", async () => {
    setSettings({ commonConfigConfirmed: true });
    const onSubmit = vi.fn<ProviderFormProps["onSubmit"]>();
    const reasoning = { supportsThinking: true, supportsEffort: true };
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProviderForm
          appId="codex"
          initialData={{
            name: "Chat provider",
            category: "custom",
            settingsConfig: {
              auth: { OPENAI_API_KEY: "sk-test" },
              config:
                'model = "chat-model"\nmodel_provider = "custom"\n[model_providers.custom]\nname = "Chat"\nbase_url = "https://example.com/v1"\nwire_api = "responses"\n',
              modelCatalog: { models: [{ model: "chat-model" }] },
            },
            meta: {
              apiFormat: "openai_chat",
              codexChatReasoning: reasoning,
              promptCacheRouting: "disabled",
            },
          }}
          submitLabel="save-provider"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    expect(
      screen.queryByLabelText("codexConfig.catalogColumnModel"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("codexConfig.promptCacheRoutingLabel"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("codexConfig.reasoningModeToggle"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save-provider" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    const settingsConfig = JSON.parse(submitted.settingsConfig);
    expect(settingsConfig.modelCatalog).toBeUndefined();
    expect(submitted.meta).toMatchObject({
      apiFormat: "openai_chat",
      codexChatReasoning: reasoning,
      promptCacheRouting: "disabled",
    });
    expect(
      providerNeedsRouting("codex", {
        id: "chat",
        name: submitted.name,
        settingsConfig,
        meta: submitted.meta,
      }),
    ).toBe(true);
  });

  it("retains live globals when choosing a preset and returning to custom", async () => {
    setSettings({ commonConfigConfirmed: true });
    const snippetApps: string[] = [];
    server.use(
      http.post(
        "http://runtime.local/get_common_config_snippet",
        async ({ request }) => {
          const body = (await request.json()) as { app: string };
          snippetApps.push(body.app);
          return HttpResponse.json(null);
        },
      ),
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProviderForm
          appId="codex"
          providerLiveBase={{
            auth: {},
            config:
              "approval_policy = 'on-request'\n[agents]\nmax_threads = 4\n[mcp_servers.mine]\ncommand = 'local'\n",
          }}
          submitLabel="save-provider"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const assertGlobals = async () => {
      await waitFor(() => {
        const values = screen
          .getAllByRole("textbox")
          .map((element) => (element as HTMLInputElement).value);
        expect(
          values.some(
            (value) =>
              value.includes('approval_policy = "on-request"') &&
              value.includes("[mcp_servers.mine]") &&
              value.includes("max_threads = 4"),
          ),
        ).toBe(true);
      });
    };
    await assertGlobals();
    fireEvent.click(screen.getByText("choose-preset"));
    await assertGlobals();
    fireEvent.click(screen.getByText("choose-custom"));
    await assertGlobals();
    expect(snippetApps).not.toContain("codex");
    expect(
      screen.queryByText("codexConfig.writeCommonConfig"),
    ).not.toBeInTheDocument();
  });
});
