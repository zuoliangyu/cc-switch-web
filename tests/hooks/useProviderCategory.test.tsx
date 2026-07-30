import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { useProviderCategory } from "@/components/providers/forms/hooks/useProviderCategory";

describe("useProviderCategory", () => {
  it("从 OpenClaw 预设读取分类", async () => {
    const { result } = renderHook(() =>
      useProviderCategory({
        appId: "openclaw",
        selectedPresetId: "openclaw-0",
        isEditMode: false,
      }),
    );

    await waitFor(() =>
      expect(result.current.category).toBe(openclawProviderPresets[0].category),
    );
  });
});
