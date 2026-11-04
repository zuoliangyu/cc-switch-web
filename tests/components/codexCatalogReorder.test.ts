import { describe, expect, it } from "vitest";
import { reorderCatalogRows } from "@/components/providers/forms/CodexFormFields";

// 上游 05034a4e / 9f7ac1fa：模型列表行可拖动换序，第一行就是默认模型
const rows = (...models: string[]) =>
  models.map((model, i) => ({ rowId: `r${i}`, model }));

describe("reorderCatalogRows", () => {
  it("makes the row moved to the top the new default model", () => {
    const result = reorderCatalogRows(rows("a", "b", "c"), "r2", "r0", "a");
    expect(result?.rows.map((row) => row.model)).toEqual(["c", "a", "b"]);
    expect(result?.defaultModel).toBe("c");
  });

  it("keeps the default when the first row stays in place", () => {
    const result = reorderCatalogRows(rows("a", "b", "c"), "r2", "r1", "a");
    expect(result?.rows.map((row) => row.model)).toEqual(["a", "c", "b"]);
    expect(result?.defaultModel).toBeUndefined();
  });

  it("skips a blank row moved to the top, like removing a row does", () => {
    const result = reorderCatalogRows(rows("a", "b", ""), "r2", "r0", "a");
    expect(result?.rows.map((row) => row.model)).toEqual(["", "a", "b"]);
    expect(result?.defaultModel).toBeUndefined();
    const moved = reorderCatalogRows(rows("a", "", "c"), "r0", "r2", "a");
    expect(moved?.rows.map((row) => row.model)).toEqual(["", "c", "a"]);
    expect(moved?.defaultModel).toBe("c");
  });

  it("leaves the default alone when the first row does not stand for it", () => {
    const result = reorderCatalogRows(rows("a", "b"), "r1", "r0", null);
    expect(result?.rows.map((row) => row.model)).toEqual(["b", "a"]);
    expect(result?.defaultModel).toBeUndefined();
  });

  it("returns null for a drop on itself or an unknown row", () => {
    expect(reorderCatalogRows(rows("a", "b"), "r0", "r0", "a")).toBeNull();
    expect(reorderCatalogRows(rows("a", "b"), "r0", "x", "a")).toBeNull();
  });
});
