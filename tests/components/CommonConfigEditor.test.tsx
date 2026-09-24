import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommonConfigEditor } from "@/components/providers/forms/CommonConfigEditor";

vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({
    isOpen,
    title,
    onClose,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="common-config-panel">
        <button type="button" onClick={onClose}>
          panel-close
        </button>
        <h2>{title}</h2>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("@/components/JsonEditor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="settings-json-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function renderEditor(value: string, onChange = vi.fn()) {
  render(
    <CommonConfigEditor
      value={value}
      onChange={onChange}
      useCommonConfig={false}
      onCommonConfigToggle={() => {}}
      commonConfigSnippet="{}"
      onCommonConfigSnippetChange={() => {}}
      commonConfigError=""
      onEditClick={() => {}}
      isModalOpen={false}
      onModalClose={() => {}}
    />,
  );
  return onChange;
}

const hideAttributionCheckbox = () =>
  screen.getByRole("checkbox", { name: "claudeConfig.hideAttribution" });

const disableArtifactCheckbox = () =>
  screen.getByRole("checkbox", { name: "claudeConfig.disableArtifact" });

describe("CommonConfigEditor hide attribution toggle", () => {
  it("requires sessionUrl=false to treat attribution as hidden", () => {
    renderEditor(
      JSON.stringify({ attribution: { commit: "", pr: "" } }, null, 2),
    );

    expect(hideAttributionCheckbox()).not.toBeChecked();
  });

  it("disables commit, PR, and session URL attribution", () => {
    const onChange = renderEditor("{}");

    fireEvent.click(hideAttributionCheckbox());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({
      attribution: {
        commit: "",
        pr: "",
        sessionUrl: false,
      },
    });
  });
});

// 上游 deb0e874：Disable Artifact Tool 快捷开关写入 CLAUDE_CODE_DISABLE_ARTIFACT。
describe("CommonConfigEditor disable artifact toggle", () => {
  it("reflects CLAUDE_CODE_DISABLE_ARTIFACT from env", () => {
    renderEditor(
      JSON.stringify({ env: { CLAUDE_CODE_DISABLE_ARTIFACT: "1" } }, null, 2),
    );

    expect(disableArtifactCheckbox()).toBeChecked();
  });

  it("adds and removes the env flag", () => {
    const onChange = renderEditor("{}");

    fireEvent.click(disableArtifactCheckbox());

    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({
      env: { CLAUDE_CODE_DISABLE_ARTIFACT: "1" },
    });

    fireEvent.click(disableArtifactCheckbox());

    expect(JSON.parse(onChange.mock.calls[1][0])).toEqual({});
  });
});
