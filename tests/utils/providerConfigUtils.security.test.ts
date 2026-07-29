import { afterEach, describe, expect, it } from "vitest";
import {
  hasCommonConfigSnippet,
  updateCommonConfigSnippet,
} from "@/utils/providerConfigUtils";

describe("common config prototype guards", () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it("merges safe keys without touching Object.prototype", () => {
    const snippet = JSON.stringify({
      env: { SHARED_TIMEOUT_MS: "1000" },
      ["__proto__"]: { polluted: "YES" },
    });

    const result = updateCommonConfigSnippet("{}", snippet, true);

    expect(result.error).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(result.updatedConfig).env.SHARED_TIMEOUT_MS).toBe("1000");
    expect(hasCommonConfigSnippet(result.updatedConfig, snippet)).toBe(true);
  });

  it("does not treat a forbidden-only snippet as applied", () => {
    expect(hasCommonConfigSnippet("{}", '{"__proto__":{}}')).toBe(false);
    expect(
      hasCommonConfigSnippet(
        '{"env":{"A":"1"}}',
        '{"constructor":{"prototype":{"polluted":true}}}',
      ),
    ).toBe(false);
  });

  it("does not delete inherited properties", () => {
    (Object.prototype as Record<string, unknown>).polluted = "YES";
    const snippet = JSON.stringify({ ["__proto__"]: { polluted: "YES" } });

    updateCommonConfigSnippet("{}", snippet, false);

    expect(({} as Record<string, unknown>).polluted).toBe("YES");
  });
});
