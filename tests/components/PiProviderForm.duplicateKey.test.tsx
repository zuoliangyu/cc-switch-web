import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PiProviderForm } from "@/components/providers/forms/PiProviderForm";
import type { Provider } from "@/types";
import { setProviders } from "../msw/state";
import { renderWithQueryClient } from "../utils/testQueryClient";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/JsonEditor", () => ({
  default: () => null,
}));
vi.mock("@/components/providers/forms/PiModelsEditor", () => ({
  PiModelsEditor: () => null,
}));

const existing: Provider = {
  id: "taken",
  name: "Taken",
  settingsConfig: { name: "Taken", models: [] },
};

describe("Pi provider key (upstream 1e2559ef / 5f642640)", () => {
  it("flags a key another Pi card already uses and blocks saving", async () => {
    setProviders("pi", { taken: existing });
    const onSubmit = vi.fn();
    renderWithQueryClient(
      <PiProviderForm
        appId="pi"
        submitLabel="Save"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const key = screen.getByLabelText("pi.provider.key");
    fireEvent.change(key, { target: { value: "taken" } });
    expect(
      await screen.findByText("pi.form.providerKeyDuplicate"),
    ).toBeInTheDocument();
    expect(key).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "pi.form.providerKeyDuplicate",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(key, { target: { value: "fresh" } });
    expect(
      screen.queryByText("pi.form.providerKeyDuplicate"),
    ).not.toBeInTheDocument();
  });

  it("keeps request headers in a collapsed advanced section", () => {
    renderWithQueryClient(
      <PiProviderForm
        appId="pi"
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: "providerForm.advancedOptionsToggle",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
