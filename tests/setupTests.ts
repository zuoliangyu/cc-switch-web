import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { server } from "./msw/server";
import { resetProviderState } from "./msw/state";
import "./msw/runtimeMocks";

// findBy* / waitFor 默认只等 1 秒。Linux 容器里满核并行跑全量（pnpm verify:docker）时，
// 页面首屏常要更久，按 1 秒会随机超时；Windows 本机感觉不到。放宽到 5 秒，通过的用例不受影响。
configure({ asyncUtilTimeout: 5000 });

beforeAll(async () => {
  server.listen({ onUnhandledRequest: "warn" });
  await i18n.use(initReactI18next).init({
    lng: "zh",
    fallbackLng: "zh",
    resources: {
      zh: { translation: {} },
      en: { translation: {} },
    },
    interpolation: {
      escapeValue: false,
    },
  });
});

afterEach(() => {
  cleanup();
  resetProviderState();
  server.resetHandlers();
  vi.clearAllMocks();
  // 用量页记住的选择（页签、时间范围、指标等）不能从一个用例带到下一个
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("cc-switch.usage.")) localStorage.removeItem(key);
  }
});

afterAll(() => {
  server.close();
});
