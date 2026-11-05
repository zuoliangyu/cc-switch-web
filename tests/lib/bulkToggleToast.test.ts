import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { showBulkToggleResult } from "@/lib/bulkToggleToast";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const t = ((key: string) => key) as unknown as TFunction;

type ToastOptions = { action?: { onClick: () => void } };
const lastOptions = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.at(-1)?.[1] as ToastOptions | undefined;

describe("showBulkToggleResult", () => {
  beforeEach(() => {
    Object.values(toastMocks).forEach((mock) => mock.mockReset());
  });

  it("reports success with an undo action when nothing failed", () => {
    showBulkToggleResult({ succeeded: ["a", "b"], failed: [] }, t, vi.fn());
    expect(toastMocks.success).toHaveBeenCalledWith(
      "common.saved",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    expect(toastMocks.warning).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("warns on a partial failure and keeps undo for the ones that worked", async () => {
    const undo = vi.fn(async () => ({ succeeded: ["a"], failed: [] }));
    showBulkToggleResult(
      { succeeded: ["a"], failed: [new Error("x")] },
      t,
      undo,
    );
    expect(toastMocks.warning).toHaveBeenCalledWith(
      "common.bulkToggleFailed",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    expect(toastMocks.success).not.toHaveBeenCalled();

    lastOptions(toastMocks.warning)?.action?.onClick();
    await vi.waitFor(() =>
      expect(toastMocks.success).toHaveBeenCalledWith("common.undone", {
        closeButton: true,
      }),
    );
    expect(undo).toHaveBeenCalledWith(["a"]);
  });

  it("errors without an undo action when everything failed", () => {
    showBulkToggleResult(
      { succeeded: [], failed: [new Error("x"), new Error("y")] },
      t,
      vi.fn(),
    );
    expect(toastMocks.error).toHaveBeenCalledWith("common.bulkToggleFailed", {
      closeButton: true,
      action: undefined,
    });
  });

  it("reports the undo's own failures instead of claiming it was undone", async () => {
    const undo = vi.fn(async () => ({
      succeeded: [],
      failed: [new Error("x")],
    }));
    showBulkToggleResult({ succeeded: ["a"], failed: [] }, t, undo);
    lastOptions(toastMocks.success)?.action?.onClick();
    await vi.waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("common.bulkToggleFailed", {
        closeButton: true,
      }),
    );
    expect(toastMocks.success).toHaveBeenCalledTimes(1);
  });
});
