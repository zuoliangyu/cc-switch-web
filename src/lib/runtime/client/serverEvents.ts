/**
 * 服务端事件推送客户端（对应上游 Tauri 的 `listen`）。
 *
 * 后端在 `GET /api/events` 上以 SSE 推送 `provider-switched`、`usage-log-recorded` 等事件。
 * 全应用共享一条连接：第一个订阅者到来时建连，最后一个退订时断开；断线后指数退避重连
 * （上限 30 秒），重连成功后派发一次 `resync`，订阅方据此整体重取（断线期间可能漏了事件）。
 * 服务端判定订阅者落后时也会发 `resync`。
 */

import { openWebServerEventStream } from "./web";

/** 断线重连或服务端判定落后时派发：订阅方应整体重取 */
export const SERVER_EVENT_RESYNC = "resync";

export type ServerEventHandler = (payload: unknown) => void;

export interface ServerSentEvent {
  event: string;
  data: string;
}

/**
 * 增量解析 SSE 文本。`feed` 传入新到的文本，返回已完整的事件；不完整的尾部留到下次。
 * 注释行（`:` 开头，如 keep-alive）忽略；多行 `data:` 以换行拼接；未写 `event:` 时为 `message`。
 */
export function createSseParser() {
  let buffer = "";
  return {
    feed(text: string): ServerSentEvent[] {
      buffer += text.replace(/\r\n?/g, "\n");
      const events: ServerSentEvent[] = [];
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = "message";
        const data: string[] = [];
        let hasData = false;
        for (const line of block.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon >= 0 ? line.slice(0, colon) : line;
          let value = colon >= 0 ? line.slice(colon + 1) : "";
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") event = value;
          else if (field === "data") {
            data.push(value);
            hasData = true;
          }
        }
        if (hasData) events.push({ event, data: data.join("\n") });
      }
      return events;
    },
  };
}

function parsePayload(data: string): unknown {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export interface ServerEventHubOptions {
  /** 打开一条事件流；失败时抛错或返回非 2xx */
  open: (signal: AbortSignal) => Promise<Response>;
  /** 第 n 次（从 0 起）连续失败后的等待时间 */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_BACKOFF_MS = 30_000;

export const defaultBackoffMs = (attempt: number) =>
  Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5));

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

export function createServerEventHub(options: ServerEventHubOptions) {
  const backoffMs = options.backoffMs ?? defaultBackoffMs;
  const sleep = options.sleep ?? abortableSleep;
  const handlers = new Map<string, Set<ServerEventHandler>>();
  let subscriberCount = 0;
  let controller: AbortController | null = null;

  const dispatch = (name: string, payload: unknown) => {
    const set = handlers.get(name);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[server-events] ${name} handler failed`, error);
      }
    }
  };

  const run = async (signal: AbortSignal) => {
    let failures = 0;
    let connectedBefore = false;
    while (!signal.aborted) {
      let opened = false;
      try {
        const response = await options.open(signal);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("Missing event stream body");
        opened = true;
        failures = 0;
        // 断线期间的事件已经漏了：重连上之后让订阅方整体重取
        if (connectedBefore) dispatch(SERVER_EVENT_RESYNC, null);
        connectedBefore = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        try {
          while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const event of parser.feed(
              decoder.decode(value, { stream: true }),
            )) {
              dispatch(event.event, parsePayload(event.data));
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!opened) failures += 1;
        console.warn("[server-events] connection lost", error);
      }
      if (signal.aborted) return;
      // 连上过又断开（服务重启等）按第一次失败等待，连不上则逐次加长
      await sleep(backoffMs(opened ? 0 : Math.max(0, failures - 1)), signal);
    }
  };

  const start = () => {
    if (controller) return;
    controller = new AbortController();
    void run(controller.signal);
  };

  const stop = () => {
    controller?.abort();
    controller = null;
  };

  return {
    subscribe(name: string, handler: ServerEventHandler): () => void {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      // 同一个函数订阅两次也各算一次，退订时只删自己那一份
      const entry: ServerEventHandler = (payload) => handler(payload);
      set.add(entry);
      subscriberCount += 1;
      start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set!.delete(entry);
        if (set!.size === 0) handlers.delete(name);
        subscriberCount -= 1;
        if (subscriberCount === 0) stop();
      };
    },
    /** 测试用：当前是否持有连接 */
    isConnected: () => controller !== null,
  };
}

let defaultHub: ReturnType<typeof createServerEventHub> | null = null;

function getDefaultHub() {
  if (!defaultHub) {
    defaultHub = createServerEventHub({
      open: openWebServerEventStream,
    });
  }
  return defaultHub;
}

/** 订阅一个服务端事件，返回退订函数（非 React 场景用）。 */
export function subscribeServerEvent(
  name: string,
  handler: ServerEventHandler,
): () => void {
  return getDefaultHub().subscribe(name, handler);
}
