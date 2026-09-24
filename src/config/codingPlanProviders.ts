/**
 * Coding Plan 供应商的 base_url 路由表（上游 cc-switch 270a4ff3 的 Web 适配）。
 *
 * 与后端 `backend/src/services/coding_plan.rs::detect_provider` 保持一致：
 * 后端靠 `url.contains(...)` 做子串判断（MiniMax 例外，按 host 标签匹配），
 * 前端这里用 RegExp 做同效匹配。Web 后端目前支持 Kimi / 智谱 / MiniMax /
 * OpenCode Go 四类，新增供应商时改这一处即可（UsageScriptModal 下拉 +
 * useProviderActions 新建自动注入复用）。
 */
import type { UsageScript } from "@/types";
import { TEMPLATE_TYPES } from "@/config/constants";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";

export interface CodingPlanProviderEntry {
  /** 与 `meta.usage_script.codingPlanProvider` 取值对齐 */
  id: "kimi" | "zhipu" | "minimax" | "opencode_go";
  /** UsageScriptModal 下拉显示用 */
  label: string;
  /** base_url 匹配规则 */
  pattern: RegExp;
}

export const CODING_PLAN_PROVIDERS: readonly CodingPlanProviderEntry[] = [
  { id: "kimi", label: "Kimi For Coding", pattern: /api\.kimi\.com\/coding/i },
  {
    id: "zhipu",
    label: "Zhipu GLM (智谱)",
    pattern: /bigmodel\.cn|api\.z\.ai/i,
  },
  {
    id: "minimax",
    label: "MiniMax",
    // 与后端 host 标签匹配同效：国内新推理域名 api.minimax.cn 与旧域名
    // api.minimaxi.com、国际站 api.minimax.io；不命中 *.example.com 之类后缀伪装
    pattern:
      /^(?:https?:\/\/)?(?:[^/?#@]*@)?(?:[\w-]+\.)*api\.(?:minimaxi\.com|minimax\.(?:io|cn))(?=[:/?#]|$)/i,
  },
  {
    // OpenCode Go（$10/月订阅，三时间窗口美元额度）。用量端点只认
    // Authorization: Bearer；base 分 /zen/go 与 /zen/go/v1 两档，子串同时覆盖；
    // Zen 按量版（/zen/v1）没有用量 API，刻意不命中。
    id: "opencode_go",
    label: "OpenCode Go",
    pattern: /opencode\.ai\/zen\/go/i,
  },
] as const;

/** 根据 Base URL 自动检测 Coding Plan 供应商；未命中返回 null */
export function detectCodingPlanProvider(
  baseUrl: string | null | undefined,
): CodingPlanProviderEntry["id"] | null {
  if (!baseUrl) return null;
  const hit = CODING_PLAN_PROVIDERS.find((entry) =>
    entry.pattern.test(baseUrl),
  );
  return hit ? hit.id : null;
}

/**
 * 按 app 从 settingsConfig 里取出 base_url，供自动注入检测用。
 * 提取路径与后端 `Provider::resolve_usage_credentials` 的各 app 分支对齐
 * （token_plan 查询最终用的就是那份凭据，两边不一致会注入了却查不到）。
 */
export function extractBaseUrlForUsageDetection(
  appId: string,
  settingsConfig: Record<string, any> | undefined,
): string | null {
  if (!settingsConfig) return null;
  let raw: unknown;
  switch (appId) {
    case "claude":
    case "claude-desktop":
      raw = settingsConfig.env?.ANTHROPIC_BASE_URL;
      break;
    case "codex":
      raw = extractCodexBaseUrl(
        typeof settingsConfig.config === "string"
          ? settingsConfig.config
          : null,
      );
      break;
    case "opencode":
      raw = settingsConfig.options?.baseURL;
      break;
    case "pi":
      raw = settingsConfig.baseUrl;
      break;
    default:
      return null;
  }
  return typeof raw === "string" ? raw : null;
}

/**
 * 新建供应商时，若 base_url 命中 Coding Plan 路由表，自动把
 * `meta.usage_script` 标记为 token_plan 并启用。
 *
 * - 仅在 `meta.usage_script` 完全缺失时注入，不覆盖已有配置
 * - Claude app 命中任意 Coding Plan 供应商都注入；其余 app
 *   （claude-desktop/codex/opencode/pi）仅对 OpenCode Go 注入
 * - code 置空：后端走专用 `coding_plan::get_coding_plan_quota`，不执行 JS 脚本
 */
export function injectCodingPlanUsageScript<
  T extends {
    settingsConfig?: Record<string, any>;
    meta?: Record<string, any>;
  },
>(appId: string, provider: T): T {
  if (provider.meta?.usage_script) return provider;

  const baseUrl = extractBaseUrlForUsageDetection(
    appId,
    provider.settingsConfig,
  );
  const codingPlanProvider = detectCodingPlanProvider(baseUrl);
  if (!codingPlanProvider) return provider;
  if (appId !== "claude" && codingPlanProvider !== "opencode_go") {
    return provider;
  }

  const usageScript: UsageScript = {
    enabled: true,
    language: "javascript",
    code: "",
    timeout: 10,
    autoQueryInterval: 5,
    templateType: TEMPLATE_TYPES.TOKEN_PLAN,
    codingPlanProvider,
  };

  return {
    ...provider,
    meta: {
      ...(provider.meta ?? {}),
      usage_script: usageScript,
    },
  };
}
