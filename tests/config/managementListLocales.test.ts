import { describe, expect, it } from "vitest";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";

const keys = [
  "common.enableAllForApp",
  "common.disableAllForApp",
  "common.bulkToggleFailed",
  "mcp.unifiedPanel.searchPlaceholder",
  "mcp.unifiedPanel.searchAriaLabel",
  "mcp.unifiedPanel.noSearchResults",
  "prompts.searchPlaceholder",
  "prompts.searchAriaLabel",
  "prompts.noSearchResults",
  "skills.installedSearchPlaceholder",
  "skills.installedSearchAriaLabel",
  "skills.noInstalledSearchResults",
  "appSwitcher.more",
];

function read(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

describe("管理列表三语键", () => {
  it.each(keys)("%s 在三语中均存在", (key) => {
    for (const locale of [zh, en, ja]) {
      expect(read(locale, key)).toEqual(expect.any(String));
    }
  });
});
