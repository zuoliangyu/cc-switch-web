import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";

describe("Antigravity locale parity", () => {
  // Web 只提供 zh / en / ja 三种语言
  const locales = { en, ja, zh } as Record<string, unknown>;
  const collect = (node: unknown, path: string, out: string[]) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        collect(value, path ? `${path}.${key}` : key, out);
      }
    } else if (/(^|\.)agy/i.test(path)) {
      out.push(path);
    }
    return out;
  };
  const reference = collect(zh, "", []);

  it("has agy keys to compare", () => {
    expect(reference).toEqual(
      expect.arrayContaining([
        "apps.agy",
        "provider.form.agy.modelHelp",
        "sessionManager.agyDeleteHint",
      ]),
    );
  });

  it.each(["en", "ja"])("%s defines every agy key", (lng) => {
    const own = new Set(collect(locales[lng], "", []));
    expect(reference.filter((key) => !own.has(key))).toEqual([]);
  });
});
