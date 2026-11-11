import type { AppId } from "@/lib/api";

/**
 * 模式视图的查询键。挂在 ["providers", app] 前缀下（同上游）：切换、增删卡片、改故障转移队列等
 * 失效供应商列表的操作会连带重取模式视图，不需要定时轮询。
 */
export const appModeQueryKey = (app: AppId) =>
  ["providers", app, "mode"] as const;

/** 是否为任一应用的模式视图查询（用于一次失效全部应用的模式视图） */
export const isAppModeQueryKey = (queryKey: readonly unknown[]) =>
  queryKey[0] === "providers" && queryKey[2] === "mode";
