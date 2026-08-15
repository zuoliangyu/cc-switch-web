import { describe, expect, it } from "vitest";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";

const sections = [
  "providerForm",
  "opencode",
  "openclaw",
  "claudeDesktop",
  "grokBuild",
  "hermes",
] as const;

describe("Provider form locales", () => {
  it.each(sections)("%s keeps the same keys in zh, en, and ja", (section) => {
    const keys = (locale: Record<string, Record<string, unknown>>) =>
      Object.keys(locale[section]).sort();

    expect(keys(en)).toEqual(keys(zh));
    expect(keys(ja)).toEqual(keys(zh));
  });
});
