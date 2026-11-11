import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@/lib/runtime/client/event";

/**
 * 在 useEffect 中订阅服务端推送的事件（对应上游 `useTauriEvent`），自动管理异步注册和卸载清理。
 * handler 用 ref 保持最新，事件名不变时不重新订阅。
 */
export function useServerEvent<P>(
  eventName: string,
  handler: (payload: P) => void | Promise<void>,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const off = await listen<P>(eventName, (event) => {
          void handlerRef.current(event.payload);
        });
        if (disposed) {
          void off();
        } else {
          unlisten = off;
        }
      } catch (error) {
        console.error(`Failed to subscribe ${eventName} event`, error);
      }
    })();

    return () => {
      disposed = true;
      void unlisten?.();
    };
  }, [eventName]);
}
