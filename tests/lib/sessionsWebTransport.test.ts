import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadableStream } from "node:stream/web";
import { streamWebSession } from "@/lib/runtime/client/web";
import type { TranscriptChunk } from "@/types";

afterEach(() => vi.unstubAllGlobals());

function mockStream(text: string, split = 1) {
  const bytes = new TextEncoder().encode(text);
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split)
          controller.enqueue(bytes.slice(i, i + split));
        controller.close();
      },
    }),
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Web transcript transport", () => {
  it("reassembles split UTF-8 and lines, carries auth and encodes source paths", async () => {
    sessionStorage.setItem("cc-switch-web-access-key", "fixture-key");
    const chunks: TranscriptChunk[] = [
      { type: "header", total: 1, turns: [], cached: false, parseMs: 0 },
      {
        type: "messages",
        start: 0,
        messages: [{ role: "user", content: "中文😀" }],
      },
      { type: "done", payloadBytes: 42 },
    ];
    const fetch = mockStream(chunks.map((c) => JSON.stringify(c)).join("\n"));
    const seen: TranscriptChunk[] = [];
    await streamWebSession("claude", "C:\\会话&a.jsonl", (c) => seen.push(c));
    expect(seen).toEqual(chunks);
    expect(fetch.mock.calls[0]).toEqual([
      expect.stringContaining("sourcePath=C%3A%5C%E4%BC%9A%E8%AF%9D%26a.jsonl"),
      {
        headers: {
          Accept: "application/x-ndjson",
          Authorization: "Bearer fixture-key",
        },
      },
    ]);
    sessionStorage.removeItem("cc-switch-web-access-key");
  });
  it("rejects a truncated stream instead of accepting partial content", async () => {
    mockStream(
      JSON.stringify({
        type: "header",
        total: 1,
        turns: [],
        cached: false,
        parseMs: 0,
      }) + "\n",
    );
    await expect(
      streamWebSession("claude", "fixture", () => {}),
    ).rejects.toThrow("Incomplete");
  });
  it("surfaces backend source validation errors", async () => {
    mockStream(
      JSON.stringify({ type: "error", message: "outside provider roots" }) +
        "\n",
    );
    await expect(
      streamWebSession("claude", "fixture", () => {}),
    ).rejects.toThrow("outside provider roots");
  });
});
