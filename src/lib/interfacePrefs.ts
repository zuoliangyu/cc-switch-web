import { useSyncExternalStore } from "react";

/**
 * 界面密度（设置 › 通用 › 外观，上游 4e7413c5）。只影响这个浏览器，存在 localStorage 里，
 * 和明暗一样不进后端设置。
 *
 * - 密度：写到 <html data-density>，src/index.css 按它换一组字号 / 控件高度变量。
 *   main.tsx 在渲染任何界面之前先调 initializeInterfacePrefs。
 * - 缩放：上游桌面端另有 90–125% 的缩放档位与 Ctrl / ⌘ + = − 0 快捷键（webview 原生缩放）。
 *   Web 版运行在浏览器里，浏览器自带同样的缩放和快捷键（按站点记住），不另做，也不拦截这几个键。
 */

export type Density = "comfortable" | "compact";

export const DENSITY_STORAGE_KEY = "cc-switch-density";
export const DEFAULT_DENSITY: Density = "compact";

interface InterfacePrefs {
  density: Density;
}

function readDensity(): Density {
  try {
    const saved = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (saved === "comfortable" || saved === "compact") return saved;
  } catch {
    // 读不到就用默认
  }
  return DEFAULT_DENSITY;
}

let prefs: InterfacePrefs = { density: readDensity() };
const listeners = new Set<() => void>();

function emit(next: InterfacePrefs) {
  prefs = next;
  listeners.forEach((listener) => listener());
}

export function setDensity(density: Density) {
  document.documentElement.dataset.density = density;
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // 记不住也不影响这次切换
  }
  emit({ ...prefs, density });
}

/** 页面启动时调一次：把记住的密度用上。 */
export function initializeInterfacePrefs() {
  document.documentElement.dataset.density = prefs.density;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInterfacePrefs(): InterfacePrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
