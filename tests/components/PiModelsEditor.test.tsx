import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillPiModel,
  PiModelsEditor,
} from "@/components/providers/forms/PiModelsEditor";
import type { ResolvedModelMetadata } from "@/lib/modelMetadata";

const mocks = vi.hoisted(() => ({
  fill: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/hooks/useModelMetadataFill", () => ({
  useModelMetadataFill: () => mocks.fill,
}));
vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: mocks.fetch,
  showFetchModelsError: vi.fn(),
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
      aria-label="JSON"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/providers/forms/FetchedModelPicker", () => ({
  FetchedModelPicker: ({
    onFetch,
    onApply,
    isFetching,
    configuredModelIds,
  }: {
    onFetch: () => void;
    onApply: (selection: { add: string[]; remove: string[] }) => void;
    isFetching: boolean;
    configuredModelIds: string[];
  }) => (
    <>
      <button type="button" onClick={onFetch} disabled={isFetching}>
        fetchModels
      </button>
      <button
        type="button"
        onClick={() =>
          onApply({ add: ["old", "picked-a", "picked-b"], remove: [] })
        }
      >
        apply-picker
      </button>
      <button
        type="button"
        onClick={() => onApply({ add: [], remove: ["old"] })}
      >
        remove-old
      </button>
      <output data-testid="configured">{configuredModelIds.join(",")}</output>
    </>
  ),
}));
vi.mock("@/components/providers/forms/shared/ModelDropdown", () => ({
  ModelDropdown: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect("new-model")}>
      pick-model
    </button>
  ),
}));

const protocol = {
  api: "openai-responses",
  baseUrl: "https://fixture.invalid/v1",
  providerId: "fixture",
  compat: {},
};
const metadata: ResolvedModelMetadata = {
  contextWindow: 128000,
  maxOutputTokens: 8000,
  reasoning: true,
  reasoningEfforts: ["high", "none"],
  inputModalities: ["text", "image"],
  sources: ["models-dev"],
};

describe("Pi model metadata", () => {
  it("preserves user limits, map and unknown options while filling missing capabilities", () => {
    const model = {
      id: "x",
      contextWindow: 1000,
      thinkingLevelMap: {},
      input: ["audio", "text"],
      cost: { input: 2 },
      custom: true,
    };
    const next = fillPiModel(model, metadata, protocol);
    expect(next).toMatchObject({
      contextWindow: 1000,
      maxTokens: 8000,
      thinkingLevelMap: {},
      input: ["audio", "text", "image"],
      cost: { input: 2 },
      custom: true,
      reasoning: true,
    });
    expect(model).not.toHaveProperty("maxTokens");
  });
  it("honors the model-level protocol before generating thinking maps", () => {
    expect(
      fillPiModel({ api: "anthropic-messages" }, metadata, protocol),
    ).not.toHaveProperty("thinkingLevelMap");
    expect(fillPiModel({}, metadata, protocol)).toMatchObject({
      thinkingLevelMap: { off: "none", high: "high", low: null },
    });
  });
});

function Editor() {
  const [value, setValue] = useState(
    JSON.stringify([
      {
        id: "old",
        name: "old",
        reasoning: false,
        input: ["text"],
        extra: "keep",
      },
    ]),
  );
  return (
    <>
      <PiModelsEditor
        value={value}
        onChange={setValue}
        protocol={protocol}
        apiKey="fixture"
      />
      <output data-testid="draft">{value}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);
const selectModel = async () => {
  fireEvent.click(
    screen.getByRole("button", { name: /获取模型|拉取模型|fetchModels/i }),
  );
  await waitFor(() =>
    expect(screen.getByText("pick-model")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText("pick-model"));
  return mocks.fill.mock.calls[0][1] as (
    metadata: ResolvedModelMetadata,
  ) => boolean;
};

describe("Pi structured model editing", () => {
  beforeEach(() => {
    mocks.fill.mockReset();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue([{ id: "new-model", ownedBy: null }]);
  });
  it("accepts delayed metadata in two passes and keeps raw JSON coherent", async () => {
    render(<Editor />);
    const apply = await selectModel();
    expect(mocks.fetch).toHaveBeenCalledWith(
      protocol.baseUrl,
      "fixture",
      undefined,
      undefined,
      undefined,
      { apiFormat: "openai-responses", requestHeaders: {} },
    );
    act(() => {
      expect(apply({ sources: ["preset"], contextWindow: 64000 })).toBe(true);
    });
    act(() => {
      expect(apply(metadata)).toBe(true);
    });
    expect(draft()[0]).toMatchObject({
      id: "new-model",
      name: "new-model",
      contextWindow: 64000,
      maxTokens: 8000,
      reasoning: true,
      extra: "keep",
    });
  });
  it("does not apply late metadata after the user edits the row", async () => {
    render(<Editor />);
    const apply = await selectModel();
    fireEvent.change(screen.getByLabelText("ID 1"), {
      target: { value: "user-choice" },
    });
    act(() => {
      expect(apply(metadata)).toBe(false);
    });
    expect(draft()[0].id).toBe("user-choice");
    expect(draft()[0]).not.toHaveProperty("contextWindow");
  });
  it("does not apply metadata after a JSON replacement", async () => {
    render(<Editor />);
    const apply = await selectModel();
    fireEvent.change(screen.getByLabelText("JSON"), {
      target: {
        value: JSON.stringify([
          { id: "new-model", name: "replacement", contextWindow: 42 },
        ]),
      },
    });
    act(() => {
      expect(apply(metadata)).toBe(false);
    });
    expect(draft()[0]).toEqual({
      id: "new-model",
      name: "replacement",
      contextWindow: 42,
    });
  });
});

describe("Pi fetched model picker", () => {
  beforeEach(() => {
    mocks.fill.mockReset();
  });

  it("adds checked models as rows, drops unchecked ones and fills each row quietly", () => {
    render(<Editor />);
    expect(screen.getByTestId("configured")).toHaveTextContent("old");

    fireEvent.click(screen.getByText("apply-picker"));

    // 勾上的按弹窗顺序接在后面，已配置的不重复加
    expect(draft().map((model: { id: string }) => model.id)).toEqual([
      "old",
      "picked-a",
      "picked-b",
    ]);
    expect(mocks.fill.mock.calls.map((call) => call[0])).toEqual([
      "picked-a",
      "picked-b",
    ]);
    for (const call of mocks.fill.mock.calls) {
      expect(call[2]).toMatchObject({ silent: true });
    }

    // 同一批的几行各自补完，后补的不因前一行的补全被当成外部改动
    const applies = mocks.fill.mock.calls.map(
      (call) => call[1] as (metadata: ResolvedModelMetadata) => boolean,
    );
    act(() => {
      expect(applies[1](metadata)).toBe(true);
      expect(applies[0](metadata)).toBe(true);
    });
    const rows = draft();
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: "old", extra: "keep" }),
    );
    expect(rows[0]).not.toHaveProperty("contextWindow");
    expect(rows[1]).toMatchObject({ id: "picked-a", contextWindow: 128000 });
    expect(rows[2]).toMatchObject({ id: "picked-b", contextWindow: 128000 });

    // 取消勾选的已配置模型连行一起移除
    fireEvent.click(screen.getByText("remove-old"));
    expect(draft().map((model: { id: string }) => model.id)).toEqual([
      "picked-a",
      "picked-b",
    ]);
  });
});
