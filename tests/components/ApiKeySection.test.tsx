import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiKeySection } from "@/components/providers/forms/shared/ApiKeySection";
import type { ProviderCategory } from "@/types";

it("必填提示不会拦截空 Key 提交确认", () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <ApiKeySection
        required
        value=""
        onChange={vi.fn()}
        shouldShowLink={false}
        websiteUrl=""
      />
      <button type="submit">保存</button>
    </form>,
  );
  const input = screen.getByLabelText("API Key *");
  expect(input).toHaveAttribute("aria-required", "true");
  expect(input).not.toHaveAttribute("required");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it.each<{
  category?: ProviderCategory;
  disabled?: boolean;
  required?: boolean;
}>([
  { category: "official", required: true, disabled: false },
  { category: "cloud_provider", required: true },
  { disabled: true, required: true },
  {},
])("无需校验的 Key 不标记为必填：%j", (props) => {
  render(
    <ApiKeySection
      {...props}
      value=""
      onChange={vi.fn()}
      shouldShowLink={false}
      websiteUrl=""
    />,
  );
  const input = screen.getByLabelText("API Key");
  expect(input).not.toHaveAttribute("aria-required");
  expect(input).not.toHaveAttribute("required");
});

it("合作元数据不产生推广内容，仍提供 API Key 获取链接", () => {
  const { container, rerender } = render(
    <ApiKeySection
      value=""
      onChange={vi.fn()}
      shouldShowLink
      websiteUrl="https://example.com/keys"
    />,
  );
  const ordinary = container.innerHTML;
  rerender(
    <ApiKeySection
      value=""
      onChange={vi.fn()}
      shouldShowLink
      websiteUrl="https://example.com/keys"
      isPartner
      partnerPromotionKey="providerForm.partnerPromotion"
    />,
  );
  expect(container.innerHTML).toBe(ordinary);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "https://example.com/keys",
  );
});

// 上游 9be88e3e：明文手打 Key 时不让 macOS 自动改大写、自动纠错
it("turns off autocorrect and auto-capitalization on the key input", () => {
  render(
    <ApiKeySection
      value="sk-test"
      onChange={vi.fn()}
      shouldShowLink={false}
      websiteUrl=""
    />,
  );
  const input = screen.getByLabelText("API Key");

  expect(input).toHaveAttribute("autocorrect", "off");
  expect(input).toHaveAttribute("autocapitalize", "off");
  expect(input).toHaveAttribute("spellcheck", "false");
});
