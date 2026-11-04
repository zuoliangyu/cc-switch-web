import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import type { ProviderMeta } from "@/types";
import type { AppMode } from "@/types/proxy";
import { server } from "../msw/server";
import { createTestQueryClient } from "../utils/testQueryClient";

// 上游 e615a6f4：完整表单按应用实际的模式提示后果——直连时非原生格式发不出请求，
// 正在直连用的卡一保存就坏，别的卡要先开路由。
function mockAppMode(mode: AppMode, directProviderId: string | null) {
  server.use(
    http.post("http://runtime.local/get_app_mode", () =>
      HttpResponse.json({
        mode,
        attached: mode !== "direct",
        directProviderId,
        routeProviderId: null,
        eligibleProviderIds: [],
        aggregation: { members: [] },
      }),
    ),
  );
}

function renderClaude(meta?: ProviderMeta, env: Record<string, string> = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ProviderForm
        appId="claude"
        providerId="relay"
        submitLabel="save-provider"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        initialData={{
          name: "Relay",
          category: "third_party",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://relay.example",
              ANTHROPIC_AUTH_TOKEN: "sk-test",
              ANTHROPIC_MODEL: "m-a",
              ...env,
            },
          },
          meta,
        }}
      />
    </QueryClientProvider>,
  );
}

function expandAdvanced() {
  const toggle = screen.getByRole("button", {
    name: "providerForm.advancedOptionsToggle",
  });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
}

describe("完整表单按实际模式提示（Claude Code）", () => {
  it("正在直连用的卡选了非原生格式：提示保存后请求会失败", async () => {
    mockAppMode("direct", "relay");
    renderClaude({ apiFormat: "openai_chat" });
    expandAdvanced();
    expect(
      await screen.findByText("providerForm.directModeFormatInUse"),
    ).toBeInTheDocument();
  });

  it("直连下别的卡选了非原生格式：提示要先开路由", async () => {
    mockAppMode("direct", "other");
    renderClaude({ apiFormat: "openai_responses" });
    expandAdvanced();
    expect(
      await screen.findByText("providerForm.directModeFormatSwitch"),
    ).toBeInTheDocument();
  });

  it("路由模式下不提示格式后果，兜底模型填了也不提示", async () => {
    mockAppMode("routing", null);
    renderClaude({ apiFormat: "openai_chat" });
    expandAdvanced();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("providerForm.directModeFormatInUse")).toBeNull();
    expect(
      screen.queryByText("providerForm.directModeFormatSwitch"),
    ).toBeNull();
    expect(screen.queryByText("providerForm.fallbackModelMissing")).toBeNull();
  });

  it("路由模式下兜底模型没填：提示没落到档位的请求会用原始模型名", async () => {
    mockAppMode("routing", null);
    renderClaude(undefined, { ANTHROPIC_MODEL: "" });
    expandAdvanced();
    expect(
      await screen.findByText("providerForm.fallbackModelMissing"),
    ).toBeInTheDocument();
  });

  it("完整 URL 开关在高级选项里", () => {
    mockAppMode("routing", null);
    renderClaude();
    expandAdvanced();
    const advanced = screen
      .getByRole("button", { name: "providerForm.advancedOptionsToggle" })
      .closest("div");
    expect(
      advanced?.querySelector('[role="switch"][aria-label="完整 URL"]'),
    ).not.toBeNull();
  });
});

describe("完整表单按实际模式提示（Codex）", () => {
  it("正在直连用的卡选了 Chat 格式：提示保存后请求会失败", async () => {
    mockAppMode("direct", "relay");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProviderForm
          appId="codex"
          providerId="relay"
          submitLabel="save-provider"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          initialData={{
            name: "Relay",
            category: "third_party",
            settingsConfig: {
              auth: { OPENAI_API_KEY: "sk-test" },
              config:
                'model_provider = "custom"\nmodel = "m-1"\n[model_providers.custom]\nname = "custom"\nbase_url = "https://relay.example/v1"\nwire_api = "responses"\n',
            },
            meta: { apiFormat: "openai_chat" },
          }}
        />
      </QueryClientProvider>,
    );
    expandAdvanced();
    expect(
      await screen.findByText("providerForm.directModeFormatInUse"),
    ).toBeInTheDocument();
  });
});
