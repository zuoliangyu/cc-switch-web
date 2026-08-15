import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManagementListSearch } from "@/components/common/ManagementListSearch";

describe("ManagementListSearch", () => {
  it("按 Esc 清空已有查询", async () => {
    const onValueChange = vi.fn();
    render(
      <ManagementListSearch
        value="codex"
        onValueChange={onValueChange}
        placeholder="搜索"
        ariaLabel="搜索管理列表"
        clearLabel="清空"
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "{Escape}");

    expect(onValueChange).toHaveBeenCalledWith("");
  });
});
