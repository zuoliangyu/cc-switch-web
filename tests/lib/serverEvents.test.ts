import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServerEventHub,
  createSseParser,
  defaultBackoffMs,
  SERVER_EVENT_RESYNC,
} from "@/lib/runtime/client/serverEvents";

const encoder = new TextEncoder();

/** 可手动推数据、手动结束的 SSE 响应 */
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSseParser", () => {
  it("parses named events, joins multi-line data and skips comments", () => {
    const parser = createSseParser();
    expect(
      parser.feed(
        ':keep-alive\n\nevent: provider-switched\ndata: {"appType":"claude"}\n\ndata: a\ndata: b\n\n',
      ),
    ).toEqual([
      { event: "provider-switched", data: '{"appType":"claude"}' },
      { event: "message", data: "a\nb" },
    ]);
  });

  it("keeps incomplete blocks until the rest arrives and accepts CRLF", () => {
    const parser = createSseParser();
    expect(parser.feed("event: usage-log-recorded\r\nda")).toEqual([]);
    expect(parser.feed("ta: null\r\n\r\n")).toEqual([
      { event: "usage-log-recorded", data: "null" },
    ]);
  });
});

describe("createServerEventHub", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares one connection, dispatches by name and disconnects after the last unsubscribe", async () => {
    const stream = controllableStream();
    const open = vi.fn(async () => stream.response);
    const hub = createServerEventHub({ open });
    const switched = vi.fn();
    const usage = vi.fn();

    const offSwitched = hub.subscribe("provider-switched", switched);
    const offUsage = hub.subscribe("usage-log-recorded", usage);
    await flush();
    expect(open).toHaveBeenCalledTimes(1);

    stream.push('event: provider-switched\ndata: {"appType":"codex"}\n\n');
    stream.push("event: usage-log-recorded\ndata: null\n\n");
    stream.push('event: other\ndata: "x"\n\n');
    await flush();
    expect(switched).toHaveBeenCalledWith({ appType: "codex" });
    expect(usage).toHaveBeenCalledWith(null);

    offSwitched();
    expect(hub.isConnected()).toBe(true);
    offUsage();
    expect(hub.isConnected()).toBe(false);
    // 退订两次不会把计数减成负数
    offUsage();
    expect(hub.isConnected()).toBe(false);
  });

  it("reconnects with backoff after failures and dispatches resync once reconnected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = controllableStream();
    const second = controllableStream();
    const open = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValueOnce(first.response)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("nope", { status: 502 }))
      .mockResolvedValueOnce(second.response);
    const waits: number[] = [];
    const hub = createServerEventHub({
      open,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const resync = vi.fn();
    const usage = vi.fn();
    const offResync = hub.subscribe(SERVER_EVENT_RESYNC, resync);
    const offUsage = hub.subscribe("usage-log-recorded", usage);
    await flush();
    // 第一次连上不算重连
    expect(resync).not.toHaveBeenCalled();

    first.close();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(4));
    await flush();
    expect(waits).toEqual([
      defaultBackoffMs(0),
      defaultBackoffMs(0),
      defaultBackoffMs(1),
    ]);
    expect(resync).toHaveBeenCalledTimes(1);

    second.push("event: usage-log-recorded\ndata: null\n\n");
    await flush();
    expect(usage).toHaveBeenCalledTimes(1);
    offResync();
    offUsage();
  });

  it("forwards server-sent resync events", async () => {
    const stream = controllableStream();
    const hub = createServerEventHub({ open: async () => stream.response });
    const resync = vi.fn();
    const off = hub.subscribe(SERVER_EVENT_RESYNC, resync);
    await flush();
    stream.push("event: resync\ndata: null\n\n");
    await flush();
    expect(resync).toHaveBeenCalledTimes(1);
    off();
  });

  it("caps the backoff at 30 seconds", () => {
    expect(defaultBackoffMs(0)).toBe(1000);
    expect(defaultBackoffMs(3)).toBe(8000);
    expect(defaultBackoffMs(20)).toBe(30_000);
  });
});
