import { describe, expect, it } from "vitest";
import { reorderCatalogRows } from "@/components/providers/forms/CodexFormFields";

// 上游 05034a4e：模型目录行可拖动换序（Web 的默认模型是单独字段，只换顺序）
describe("reorderCatalogRows", () => {
  const rows = [
    { rowId: "a", model: "m-a" },
    { rowId: "b", model: "m-b" },
    { rowId: "c", model: "m-c" },
  ];

  it("moves the dragged row onto the target position", () => {
    expect(reorderCatalogRows(rows, "c", "a")?.map((row) => row.rowId)).toEqual(
      ["c", "a", "b"],
    );
    expect(reorderCatalogRows(rows, "a", "b")?.map((row) => row.rowId)).toEqual(
      ["b", "a", "c"],
    );
  });

  it("returns null when nothing moves or an id is unknown", () => {
    expect(reorderCatalogRows(rows, "a", "a")).toBeNull();
    expect(reorderCatalogRows(rows, "x", "a")).toBeNull();
  });
});
