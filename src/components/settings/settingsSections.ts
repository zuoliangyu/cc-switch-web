/**
 * 设置页的分组（上游 v7 的设置目录）：通用、应用配置、本地路由、网络、数据、关于。
 */
export type SettingsSection =
  | "general"
  | "appConfig"
  | "routing"
  | "network"
  | "data"
  | "about";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  "general",
  "appConfig",
  "routing",
  "network",
  "data",
  "about",
];
