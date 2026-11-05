import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import type { ProviderCategory, ProviderMeta } from "@/types";
import type { AppMode } from "@/types/proxy";
import type { ModeView } from "@/components/providers/presentation";
import { server } from "../msw/server";
import { createTestQueryClient } from "../utils/testQueryClient";

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: Object.assign(vi.fn(), {
      ...actual.toast,
      warning: toastWarning,
    }),
  };
});

// 上游 fe831f0a：在聚合那格打开（没给就看应用实际是否在聚合模式）时，第三方卡用聚合的简化表单
function mockAppMode(mode: AppMode) {
  server.use(
    http.post("http://runtime.local/get_app_mode", () =>
      HttpResponse.json({
        mode,
        attached: mode !== "direct",
        directProviderId: null,
        routeProviderId: null,
        eligibleProviderIds: [],
        aggregation: { members: [] },
      }),
    ),
  );
}

const CLAUDE_ENV = {
  ANTHROPIC_BASE_URL: "https://relay.example",
  ANTHROPIC_AUTH_TOKEN: "sk-test",
  ANTHROPIC_MODEL: "m-a",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "m-s[1M]",
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Model S",
};

const CODEX_CONFIG =
  'model_provider = "custom"\n\n[model_providers.custom]\nname = "custom"\nbase_url = "https://relay.example/v1"\nexperimental_bearer_token = "sk-test"\n';

function renderForm(
  appId: "claude" | "codex",
  options: {
    modeView?: ModeView;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    onStackLayoutChange?: (stack: boolean) => void;
    onSubmit?: (values: ProviderFormValues) => void;
  } = {},
) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ProviderForm
        appId={appId}
        providerId="relay"
        submitLabel="save-provider"
        onSubmit={options.onSubmit ?? vi.fn()}
        onCancel={vi.fn()}
        modeView={options.modeView}
        onStackLayoutChange={options.onStackLayoutChange}
        initialData={{
          name: "Relay",
          category: options.category ?? "third_party",
          meta: options.meta,
          settingsConfig:
            appId === "claude"
              ? { env: CLAUDE_ENV }
              : {
                  auth: { OPENAI_API_KEY: "sk-test" },
                  config: CODEX_CONFIG,
                },
        }}
      />
    </QueryClientProvider>,
  );
}

async function save(onSubmit: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: "save-provider" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const values = onSubmit.mock.calls[0][0] as ProviderFormValues;
  return { values, settings: JSON.parse(values.settingsConfig) };
}

const stackModelInputs = () =>
  screen.getAllByLabelText(/providerForm.requestModelLabel|实际请求模型/);

describe("按打开的那格选表单布局（Claude Code）", () => {
  it("从聚合那格打开：简化面板的模型列表跟着映射，没有模型映射", async () => {
    mockAppMode("direct");
    const onStackLayoutChange = vi.fn();
    renderForm("claude", { modeView: "stack", onStackLayoutChange });

    // 没存过列表：从模型映射生成行（主模型在前，去掉 1M 标记、带上显示名）
    expect(
      stackModelInputs().map((input) => (input as HTMLInputElement).value),
    ).toEqual(["m-a", "m-s"]);
    expect(screen.getByDisplayValue("Model S")).toBeInTheDocument();
    expect(screen.queryByText("providerForm.modelMappingLabel")).toBeNull();
    // 上游格式放在 Key 前面，不进高级选项
    expect(screen.getAllByText("上游格式").length).toBeGreaterThan(0);
    await waitFor(() => expect(onStackLayoutChange).toHaveBeenCalledWith(true));
  });

  it("没动过列表时保存不写 stackModels，ANTHROPIC_MODEL 不变", async () => {
    mockAppMode("direct");
    const onSubmit = vi.fn();
    renderForm("claude", { modeView: "stack", onSubmit });

    const { values, settings } = await save(onSubmit);
    expect(values.meta?.stackModels).toBeUndefined();
    expect(settings.env.ANTHROPIC_MODEL).toBe("m-a");
  });

  it("删掉第一行，保存时 ANTHROPIC_MODEL 跟着新的第一行", async () => {
    mockAppMode("direct");
    const onSubmit = vi.fn();
    renderForm("claude", { modeView: "stack", onSubmit });

    fireEvent.click(
      screen.getAllByRole("button", { name: "common.delete" })[0],
    );

    const { values, settings } = await save(onSubmit);
    expect(values.meta?.stackModels).toEqual([
      { model: "m-s", displayName: "Model S", oneM: true },
    ]);
    expect(settings.env.ANTHROPIC_MODEL).toBe("m-s[1M]");
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("m-s[1M]");
  });

  it("存过列表就用它；加一行保存，第一行没变时 ANTHROPIC_MODEL 也不变", async () => {
    mockAppMode("direct");
    const onSubmit = vi.fn();
    renderForm("claude", {
      modeView: "stack",
      onSubmit,
      meta: { stackModels: [{ model: "m-b", displayName: "B" }] },
    });

    expect(screen.getByDisplayValue("m-b")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("m-a")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: /providerForm\.addStackModel|手动添加/,
      }),
    );
    fireEvent.change(stackModelInputs()[1], { target: { value: "m-c[1M]" } });

    const { values, settings } = await save(onSubmit);
    expect(values.meta?.stackModels).toEqual([
      { model: "m-b", displayName: "B" },
      { model: "m-c", oneM: true },
    ]);
    expect(settings.env.ANTHROPIC_MODEL).toBe("m-a");
  });

  it("清空列表后保存为空列表（不发布模型），只提醒不拦", async () => {
    mockAppMode("direct");
    toastWarning.mockClear();
    const onSubmit = vi.fn();
    renderForm("claude", { modeView: "stack", onSubmit });

    // 从最后一行删起：第一行一直没变，删光了也不碰 ANTHROPIC_MODEL
    for (const button of screen
      .getAllByRole("button", { name: "common.delete" })
      .reverse()) {
      fireEvent.click(button);
    }
    const { values, settings } = await save(onSubmit);
    expect(values.meta?.stackModels).toEqual([]);
    expect(settings.env.ANTHROPIC_MODEL).toBe("m-a");
    expect(toastWarning).toHaveBeenCalledWith(
      "providerForm.stackLayout.noModels",
    );
  });

  it("从直连那格打开：完整表单有模型映射，保存时原样保留列表", async () => {
    mockAppMode("aggregation");
    const onSubmit = vi.fn();
    renderForm("claude", {
      modeView: "direct",
      onSubmit,
      meta: { stackModels: [{ model: "m-b", oneM: true }] },
    });

    const toggle = screen.getByRole("button", {
      name: "providerForm.advancedOptionsToggle",
    });
    if (toggle.getAttribute("aria-expanded") !== "true")
      fireEvent.click(toggle);
    expect(
      screen.getAllByText("providerForm.modelMappingLabel").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("m-b")).toBeNull();

    const { values } = await save(onSubmit);
    expect(values.meta?.stackModels).toEqual([{ model: "m-b", oneM: true }]);
  });

  it("没给那格时按应用实际模式：聚合生效就用简化面板", async () => {
    mockAppMode("aggregation");
    renderForm("claude");

    expect(await screen.findByDisplayValue("m-s")).toBeInTheDocument();
  });

  it("官方卡不用简化面板", () => {
    mockAppMode("direct");
    const onStackLayoutChange = vi.fn();
    renderForm("claude", {
      modeView: "stack",
      category: "official",
      onStackLayoutChange,
    });

    expect(
      screen.queryByLabelText(/providerForm.requestModelLabel|实际请求模型/),
    ).toBeNull();
    expect(onStackLayoutChange).not.toHaveBeenCalledWith(true);
  });

  it("把用不用简化面板报给页头，卸载时报 false", () => {
    mockAppMode("direct");
    const onStackLayoutChange = vi.fn();
    const { unmount } = renderForm("claude", {
      modeView: "stack",
      onStackLayoutChange,
    });
    expect(onStackLayoutChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onStackLayoutChange).toHaveBeenLastCalledWith(false);
  });
});

describe("按打开的那格选表单布局（Codex）", () => {
  it("简化面板不显示子代理、自动审批与配置编辑器，上游格式在 Key 前面", () => {
    mockAppMode("direct");
    renderForm("codex", { modeView: "stack" });

    expect(screen.getByText("codexConfig.modelListTitle")).toBeInTheDocument();
    expect(
      screen.getByText("codexConfig.upstreamFormatLabel"),
    ).toBeInTheDocument();
    expect(screen.queryByText("codexConfig.subagentModelLabel")).toBeNull();
    expect(screen.queryByText("codexConfig.autoReviewModelLabel")).toBeNull();
    expect(screen.queryByText("codexConfig.authJson")).toBeNull();
  });

  it("完整表单照常显示子代理", () => {
    mockAppMode("direct");
    renderForm("codex", { modeView: "route" });

    expect(
      screen.getByText("codexConfig.subagentModelLabel"),
    ).toBeInTheDocument();
  });

  it("简化面板里一个模型都没有时提醒，仍可保存", async () => {
    mockAppMode("direct");
    toastWarning.mockClear();
    const onSubmit = vi.fn();
    renderForm("codex", { modeView: "stack", onSubmit });

    await save(onSubmit);
    expect(toastWarning).toHaveBeenCalledWith(
      "providerForm.stackLayout.noModels",
    );
  });
});
