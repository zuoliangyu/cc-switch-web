import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { useState } from "react";
import { describe, it, expect } from "vitest";
import {
  ClaudeAggregationModels,
  normalizeAggregationModels,
} from "@/components/providers/forms/ClaudeAggregationModels";
import type { ClaudeStackModel } from "@/types";

describe("Claude 聚合模型", () => {
  it("在选择弹窗里加入远端模型、取消勾选移除，保留默认项和自定义名称", async () => {
    function Form() {
      const [value, setValue] = useState<ClaudeStackModel[] | undefined>([
        { model: "a", displayName: "Custom" },
        { model: "c[1M]" },
      ]);
      return (
        <>
          <ClaudeAggregationModels
            value={value}
            onChange={setValue}
            fetchedModels={[
              { id: "a", ownedBy: null },
              { id: "b", ownedBy: null },
            ]}
          />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Form />);
    // 拉过模型后按钮直接打开选择弹窗（上游 f7244745）
    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.modelPicker.title" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: "a" })).toBeChecked();
    // 配置里有、供应商没返回的模型按去掉 [1M] 后的 ID 列出
    expect(within(dialog).getByRole("checkbox", { name: "c" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "b" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "c" }));
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "providerForm.modelPicker.apply",
      }),
    );
    expect(screen.getByTestId("value")).toHaveTextContent(
      '[{"model":"a","displayName":"Custom"},{"model":"b"}]',
    );
  });
  it("保留默认顺序，合并同名模型的 1M 和显示名称，丢弃空行", () => {
    expect(
      normalizeAggregationModels([
        { model: " b " },
        { model: "a[1M]" },
        { model: "a", displayName: " Alpha " },
        { model: "b", oneM: true },
        { model: " " },
      ]),
    ).toEqual([
      { model: "b", oneM: true },
      { model: "a", oneM: true, displayName: "Alpha" },
    ]);
  });
  it("区分沿用映射与显式空列表，并允许把所选模型移到默认位置", () => {
    function Form() {
      const [value, setValue] = useState<ClaudeStackModel[] | undefined>([
        { model: "b" },
        { model: "a" },
      ]);
      return (
        <>
          <ClaudeAggregationModels value={value} onChange={setValue} />
          <output data-testid="value">
            {JSON.stringify(value) ?? "fallback"}
          </output>
        </>
      );
    }
    render(<Form />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "webMode.models.first" })[1],
    );
    expect(screen.getByTestId("value")).toHaveTextContent(
      '[{"model":"a"},{"model":"b"}]',
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "common.delete" })[0],
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "common.delete" })[0],
    );
    expect(screen.getByTestId("value")).toHaveTextContent("[]");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "webMode.models.custom" }),
    );
    expect(screen.getByTestId("value")).toHaveTextContent("fallback");
  });
});
