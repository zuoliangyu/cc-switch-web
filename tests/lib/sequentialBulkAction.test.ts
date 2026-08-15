import { describe, expect, it, vi } from "vitest";
import { runSequentialBulkAction } from "@/lib/utils/sequentialBulkAction";

describe("runSequentialBulkAction", () => {
  it("按顺序执行并汇总单项失败", async () => {
    const order: number[] = [];
    const action = vi.fn(async (item: number) => {
      order.push(item);
      if (item === 2) throw new Error("failed");
    });

    const result = await runSequentialBulkAction([1, 2, 3], action);

    expect(order).toEqual([1, 2, 3]);
    expect(result.succeeded).toEqual([1, 3]);
    expect(result.failed.map(({ item }) => item)).toEqual([2]);
  });
});
