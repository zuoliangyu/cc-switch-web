import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenClawFormFields } from "@/components/providers/forms/OpenClawFormFields";

const apiKeySectionMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/form", () => ({
  FormLabel: ({ children }: { children: ReactNode }) => (
    <label>{children}</label>
  ),
}));

vi.mock("@/components/providers/forms/shared", () => ({
  ApiKeySection: (props: { category?: string }) => {
    apiKeySectionMock(props);
    return (
      <input aria-label="API Key" disabled={props.category === "official"} />
    );
  },
}));

describe("OpenClawFormFields", () => {
  it("官方分类仍允许用户填写 API Key", () => {
    render(
      <OpenClawFormFields
        baseUrl="https://api.example.com/v1"
        onBaseUrlChange={vi.fn()}
        apiKey=""
        onApiKeyChange={vi.fn()}
        category="official"
        shouldShowApiKeyLink
        websiteUrl="https://example.com/keys"
        api="openai-completions"
        onApiChange={vi.fn()}
        models={[]}
        onModelsChange={vi.fn()}
        userAgent={false}
        onUserAgentChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "API Key" })).toBeEnabled();
    expect(apiKeySectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: undefined,
        shouldShowLink: true,
        websiteUrl: "https://example.com/keys",
      }),
    );
  });
});
