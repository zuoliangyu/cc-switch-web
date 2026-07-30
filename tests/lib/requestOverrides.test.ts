import { describe, expect, it } from "vitest";
import {
  buildLocalProxyRequestOverrides,
  isProtectedLocalProxyHeaderName,
  isValidHttpHeaderName,
  isValidHttpHeaderValue,
  parseBodyOverrideJson,
  parseHeaderOverrideJson,
  parseRequestOverrideJson,
} from "@/lib/requestOverrides";

describe("requestOverrides", () => {
  it("将空字段视为未设置", () => {
    expect(buildLocalProxyRequestOverrides("", "   ")).toEqual({});
  });

  it("解析并归一化 Header 与 Body 覆盖", () => {
    expect(
      buildLocalProxyRequestOverrides(
        '{ "X-Test": "ok" }',
        '{ "temperature": 0.2 }',
      ),
    ).toEqual({
      overrides: {
        headers: { "x-test": "ok" },
        body: { temperature: 0.2 },
      },
    });
  });

  it("拒绝非对象 JSON 与非字符串 Header 值", () => {
    expect(parseRequestOverrideJson("[]").error).toBeTruthy();
    expect(parseHeaderOverrideJson('{ "X-Test": 1 }').error).toBeTruthy();
  });

  it("拒绝非法、重复及代理保护的 Header", () => {
    expect(isValidHttpHeaderName("X-Test")).toBe(true);
    expect(isValidHttpHeaderName("X Foo")).toBe(false);
    expect(
      parseHeaderOverrideJson('{ "X-Foo": "a", "x-foo": "b" }').error,
    ).toBeTruthy();
    expect(isProtectedLocalProxyHeaderName("Content-Type")).toBe(true);
    expect(isProtectedLocalProxyHeaderName("X-Test")).toBe(false);
    expect(
      parseHeaderOverrideJson('{ "Authorization": "Bearer x" }').error,
    ).toBeTruthy();
  });

  it("匹配后端控制字符规则", () => {
    expect(isValidHttpHeaderValue("hello\tworld")).toBe(true);
    expect(isValidHttpHeaderValue("hello\nworld")).toBe(false);
  });

  it("拒绝覆盖顶层 stream", () => {
    expect(parseBodyOverrideJson('{ "stream": true }').error).toBeTruthy();
    expect(
      buildLocalProxyRequestOverrides("", '{ "stream": false }').error,
    ).toBeTruthy();
  });
});
