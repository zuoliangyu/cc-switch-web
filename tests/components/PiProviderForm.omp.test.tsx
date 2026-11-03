import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { PiProviderForm } from "@/components/providers/forms/PiProviderForm";
import { ompProviderPresets } from "@/config/ompProviderPresets";
import { renderWithQueryClient } from "../utils/testQueryClient";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/JsonEditor", () => ({
  default: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      aria-label={ariaLabel ?? "JSON"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/providers/forms/PiModelsEditor", () => ({
  PiModelsEditor: () => null,
}));

const model = {
  id: "model-a",
  name: "Model A",
  reasoning: true,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
};
const config = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "EXAMPLE_API_KEY",
  api: "openai-completions",
  models: [model],
};

const renderForm = (onSubmit = vi.fn()) => {
  renderWithQueryClient(
    <PiProviderForm
      appId="omp"
      providerId="managed"
      initialData={{ name: "Managed", settingsConfig: config }}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  return onSubmit;
};
const editor = () =>
  screen.getByLabelText(
    "providerForm.nativeConfig.title",
  ) as HTMLTextAreaElement;
const submitted = (onSubmit: ReturnType<typeof vi.fn>) =>
  JSON.parse(onSubmit.mock.calls[0][0].settingsConfig);

describe("Oh My Pi provider form", () => {
  it("shows the provider as its providers node in models.yml", async () => {
    renderForm();
    await waitFor(() =>
      expect(editor().value.startsWith("providers:\n  managed:\n")).toBe(true),
    );
    expect(parseYaml(editor().value)).toEqual({
      providers: { managed: config },
    });
  });

  it("saves without a provider-level name, which omp's schema does not define", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit)).not.toHaveProperty("name");
    expect(onSubmit.mock.calls[0][0].name).toBe("Managed");
  });

  it("drops Pi's thinkingLevelMap and allows no models when discovery is on", async () => {
    const onSubmit = renderForm();
    await waitFor(() => expect(editor().value).not.toBe(""));
    fireEvent.change(editor(), {
      target: {
        value: stringifyYaml({
          providers: {
            managed: {
              ...config,
              discovery: { type: "openai-models-list" },
              models: [],
            },
          },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit)).toMatchObject({
      discovery: { type: "openai-models-list" },
      models: [],
    });

    onSubmit.mockClear();
    fireEvent.change(editor(), {
      target: {
        value: stringifyYaml({
          providers: {
            managed: {
              ...config,
              models: [{ ...model, thinkingLevelMap: { high: "high" } }],
            },
          },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit).models[0]).not.toHaveProperty(
      "thinkingLevelMap",
    );
  });

  it("requires models when discovery is off", async () => {
    const onSubmit = renderForm();
    await waitFor(() => expect(editor().value).not.toBe(""));
    fireEvent.change(editor(), {
      target: {
        value: stringifyYaml({
          providers: { managed: { ...config, models: [] } },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "pi.provider.modelsRequired",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses to save a YAML draft that names another node", async () => {
    const onSubmit = renderForm();
    await waitFor(() => expect(editor().value).not.toBe(""));
    fireEvent.change(editor(), {
      target: { value: stringifyYaml({ providers: { other: config } }) },
    });
    expect(
      screen.getByText("providerForm.nativeConfig.scope"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "providerForm.nativeConfig.scope",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses the Oh My Pi presets, which omit what omp's schema rejects", () => {
    expect(ompProviderPresets.length).toBeGreaterThan(0);
    for (const preset of ompProviderPresets) {
      expect(preset.settingsConfig).not.toHaveProperty("name");
    }
  });
});
