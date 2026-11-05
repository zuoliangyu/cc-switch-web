import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PiProviderForm } from "@/components/providers/forms/PiProviderForm";
import { piProviderPresets } from "@/config/piProviderPresets";
import { setProviders } from "../msw/state";
import { renderWithQueryClient } from "../utils/testQueryClient";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/JsonEditor", () => ({
  default: () => null,
}));
vi.mock("@/components/providers/forms/PiModelsEditor", () => ({
  PiModelsEditor: () => null,
}));

const kimiPresets = piProviderPresets.filter(
  (preset) => preset.family === "kimi",
);
const kimiKeys = kimiPresets.map((preset) => preset.providerKey);

function renderForm(appId: "pi" | "omp", onSubmit = vi.fn()) {
  renderWithQueryClient(
    <PiProviderForm
      appId={appId}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  return onSubmit;
}

function pickKimi() {
  fireEvent.click(screen.getAllByRole("button", { name: /^Kimi/ })[0]);
}

// Pi / omp 的预设改用共用的分组选择器（上游 PiProviderForm 的做法）
describe("Pi preset selector", () => {
  it("fills the form from a picked preset and saves it as that preset", async () => {
    const onSubmit = renderForm("pi", vi.fn().mockResolvedValue(undefined));
    expect(
      document.querySelector("[data-preset-selector]"),
    ).toBeInTheDocument();

    pickKimi();
    const key = screen.getByLabelText("pi.provider.key") as HTMLInputElement;
    expect(kimiKeys).toContain(key.value);
    const preset = kimiPresets.find(
      (entry) => entry.providerKey === key.value,
    )!;
    expect(screen.getByLabelText("pi.provider.baseUrl")).toHaveValue(
      preset.settingsConfig.baseUrl,
    );
    fireEvent.change(screen.getByLabelText("pi.provider.apiKey"), {
      target: { value: "literal-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      providerKey: preset.providerKey,
      presetCategory: preset.category,
    });
    expect(JSON.parse(onSubmit.mock.calls[0][0].settingsConfig)).toMatchObject({
      baseUrl: preset.settingsConfig.baseUrl,
      api: preset.settingsConfig.api,
      apiKey: "literal-key",
    });
  });

  it("flags a picked preset whose key another card already uses", async () => {
    setProviders(
      "pi",
      Object.fromEntries(
        kimiKeys.map((id) => [
          id,
          { id, name: "Kimi", settingsConfig: { name: "Kimi", models: [] } },
        ]),
      ),
    );
    renderForm("pi");
    pickKimi();
    expect(
      await screen.findByText("pi.form.providerKeyDuplicate"),
    ).toBeInTheDocument();
  });

  it("returns to a blank form when switching back to custom", () => {
    renderForm("pi");
    pickKimi();
    expect(screen.getByLabelText("pi.provider.key")).not.toHaveValue("");

    fireEvent.click(
      screen.getAllByRole("button", { name: /providerPreset\.custom/ })[0],
    );
    expect(screen.getByLabelText("pi.provider.key")).toHaveValue("");
    expect(screen.getByLabelText("pi.provider.baseUrl")).toHaveValue("");
  });

  it("saves omp presets without the Pi-only name field", async () => {
    const onSubmit = renderForm("omp", vi.fn().mockResolvedValue(undefined));
    pickKimi();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(onSubmit.mock.calls[0][0].settingsConfig);
    expect(saved).not.toHaveProperty("name");
    expect(kimiKeys).toContain(onSubmit.mock.calls[0][0].providerKey);
  });

  it("hides the selector when editing an existing card", () => {
    renderWithQueryClient(
      <PiProviderForm
        appId="pi"
        providerId="taken"
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
        initialData={{
          name: "Taken",
          settingsConfig: { name: "Taken", models: [] },
        }}
      />,
    );
    expect(
      document.querySelector("[data-preset-selector]"),
    ).not.toBeInTheDocument();
  });
});
