import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parse as parseToml } from "smol-toml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrokBuildProviderForm } from "@/components/providers/forms/GrokBuildProviderForm";

const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/providers/forms/BasicFormFields", () => ({
  BasicFormFields: ({ form }: any) => (
    <>
      <input aria-label="name" {...form.register("name")} />
      <input aria-label="website" {...form.register("websiteUrl")} />
      <input aria-label="notes" {...form.register("notes")} />
    </>
  ),
}));

vi.mock("@/components/JsonEditor", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      aria-label="raw-config"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const envConfig = `[models]
default = "grok-profile"

[model."grok-profile"]
model = "grok-4.5"
base_url = "https://old.example.com/v1"
name = "Env Relay"
env_key = "XAI_API_KEY"
api_backend = "responses"
context_window = 500000
`;

describe("GrokBuildProviderForm", () => {
  beforeEach(() => toastErrorMock.mockClear());

  it("保存自定义配置时保留 env_key 并更新结构化字段", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrokBuildProviderForm
        submitLabel="save"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        initialData={{
          name: "Env Relay",
          category: "custom",
          settingsConfig: { config: envConfig },
          meta: { customUserAgent: "claude-code/0.1.0" },
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("grokBuild.baseUrl"), {
      target: { value: "https://new.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("providerForm.customUserAgent"), {
      target: { value: "claude-cli/2.1.161" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    const parsedSettings = JSON.parse(payload.settingsConfig);
    const parsedToml = parseToml(parsedSettings.config) as Record<string, any>;
    expect(parsedToml.model["grok-profile"]).toMatchObject({
      base_url: "https://new.example.com/v1",
      env_key: "XAI_API_KEY",
    });
    expect(parsedToml.model["grok-profile"]).not.toHaveProperty("api_key");
    expect(payload.meta.apiFormat).toBe("openai_responses");
    expect(payload.meta.customUserAgent).toBe("claude-cli/2.1.161");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("允许官方 Provider 以空 config 保存元信息", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrokBuildProviderForm
        submitLabel="save"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        initialData={{
          name: "Grok Official",
          category: "official",
          settingsConfig: { config: "" },
          icon: "grok",
          meta: { customUserAgent: "stale-agent" },
        }}
      />,
    );

    expect(screen.queryByLabelText("grokBuild.baseUrl")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(JSON.parse(payload.settingsConfig)).toEqual({ config: "" });
    expect(payload.presetCategory).toBe("official");
    expect(payload.meta.customUserAgent).toBeUndefined();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("应用 Grok 预设并生成对应 TOML", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrokBuildProviderForm
        submitLabel="save"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /PackyCode/ }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    const parsedSettings = JSON.parse(payload.settingsConfig);
    const parsedToml = parseToml(parsedSettings.config) as Record<string, any>;
    expect(parsedToml.model["grok-4.5"]).toMatchObject({
      model: "grok-4.5",
      base_url: "https://www.packyapi.ai/v1",
      api_key: "secret",
    });
    expect(payload.presetId).toBe("grokbuild-0");
    expect(payload.presetCategory).toBe("third_party");
  });
});
