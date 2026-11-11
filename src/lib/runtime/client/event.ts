import { subscribeServerEvent } from "./serverEvents";

export type UnlistenFn = () => void | Promise<void>;

export interface RuntimeEvent<T = unknown> {
  payload: T;
}

/**
 * 订阅服务端推送的事件（与上游 `@tauri-apps/api/event` 的 `listen` 同形）。
 * 事件经 `GET /api/events` 的共享 SSE 连接到达，见 `serverEvents.ts`。
 */
export async function listen<T = unknown>(
  event: string,
  handler: (event: RuntimeEvent<T>) => void | Promise<void>,
): Promise<UnlistenFn> {
  return subscribeServerEvent(event, (payload) => {
    void handler({ payload: payload as T });
  });
}
