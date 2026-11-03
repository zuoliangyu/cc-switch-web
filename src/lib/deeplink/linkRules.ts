/**
 * 深链接供应商的通用规则：可导入的应用、接口格式（apiFormat）换算、
 * 累加式应用会展开的危险写法（上游 cc-switch deeplink/provider.rs 的 Web 适配）。
 */
import type { AppId } from "@/lib/api";
import type { DeepLinkApiFormat, DeepLinkImportRequest } from "./types";

/** 可以通过链接导入的供应商应用 */
export const PROVIDER_LINK_APPS: readonly AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
];

/** 可以通过链接导入提示词的应用 */
export const PROMPT_LINK_APPS: readonly AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
];

/** MCP 链接 `apps` 里可以出现的应用（Web 端 Pi 不支持 MCP 投影） */
export const MCP_LINK_APPS: readonly AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "mcode",
];

/** 累加式应用：没有「切换」，开关决定写不写进应用的配置文件（同后端 `is_additive_mode`） */
const ADDITIVE_APPS = new Set<AppId>([
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
]);

export const isAdditiveLinkApp = (app: AppId | undefined): boolean =>
  !!app && ADDITIVE_APPS.has(app);

const API_FORMAT_VALUES: readonly DeepLinkApiFormat[] = [
  "anthropic",
  "openai_chat",
  "openai_responses",
  "gemini_native",
];

/**
 * 链接声明的格式在各应用里对应的值；没有这一项表示应用不支持这种接口。
 *
 * Claude Code、Codex、Grok Build 写进 `meta.apiFormat`（非原生格式由本地路由转换）；
 * 其余应用写进各自配置里选择协议的字段：OpenCode 的 `npm`、OpenClaw / Pi 的 `api`、
 * Hermes 的 `api_mode`。Gemini CLI 只有原生接口。
 */
const NATIVE_VALUES: Partial<
  Record<AppId, Partial<Record<DeepLinkApiFormat, string>>>
> = {
  claude: {
    anthropic: "anthropic",
    openai_chat: "openai_chat",
    openai_responses: "openai_responses",
    gemini_native: "gemini_native",
  },
  codex: {
    anthropic: "anthropic",
    openai_chat: "openai_chat",
    openai_responses: "openai_responses",
  },
  grokbuild: {
    anthropic: "anthropic",
    openai_chat: "openai_chat",
    openai_responses: "openai_responses",
  },
  gemini: { gemini_native: "gemini_native" },
  opencode: {
    anthropic: "@ai-sdk/anthropic",
    openai_chat: "@ai-sdk/openai-compatible",
    openai_responses: "@ai-sdk/openai",
    gemini_native: "@ai-sdk/google",
  },
  openclaw: {
    anthropic: "anthropic-messages",
    openai_chat: "openai-completions",
    openai_responses: "openai-responses",
    gemini_native: "google-generative-ai",
  },
  pi: {
    anthropic: "anthropic-messages",
    openai_chat: "openai-completions",
    openai_responses: "openai-responses",
    gemini_native: "google-generative-ai",
  },
  hermes: {
    anthropic: "anthropic_messages",
    openai_chat: "chat_completions",
    openai_responses: "codex_responses",
  },
};

/** 链接没写 `apiFormat` 时各应用用的格式（保持旧链接的行为） */
const defaultApiFormat = (app: AppId): DeepLinkApiFormat => {
  switch (app) {
    case "claude":
    case "claude-desktop":
      return "anthropic";
    case "codex":
    case "grokbuild":
      return "openai_responses";
    case "gemini":
      return "gemini_native";
    default:
      return "openai_chat";
  }
};

const parseApiFormat = (value: string): DeepLinkApiFormat => {
  const trimmed = value.trim() as DeepLinkApiFormat;
  if (!API_FORMAT_VALUES.includes(trimmed)) {
    throw new Error(
      `不支持的 apiFormat：${value.trim()}，可选值为 ${API_FORMAT_VALUES.join(", ")}`,
    );
  }
  return trimmed;
};

/** 核对链接的 `apiFormat` 在这个应用上是否可用（解析和导入两处都调） */
export const checkApiFormat = (
  app: AppId,
  value: string,
): DeepLinkApiFormat => {
  const format = parseApiFormat(value);
  if (!NATIVE_VALUES[app]?.[format]) {
    throw new Error(`apiFormat ${format} 不适用于 ${app}`);
  }
  return format;
};

/** 链接声明的格式，已核对过这个应用支持它；没写时为 undefined */
export const linkApiFormat = (
  request: Pick<DeepLinkImportRequest, "app" | "apiFormat">,
): DeepLinkApiFormat | undefined => {
  if (!request.apiFormat || !request.app) return undefined;
  return checkApiFormat(request.app, request.apiFormat);
};

/** 应用配置里选择协议的字段值：链接写了就按链接，没写用应用默认 */
export const nativeProtocol = (
  app: AppId,
  format: DeepLinkApiFormat | undefined,
): string => {
  const values = NATIVE_VALUES[app] ?? {};
  return (
    (format ? values[format] : undefined) ?? values[defaultApiFormat(app)] ?? ""
  );
};

/** Claude Code、Codex、Grok Build 记在 `meta.apiFormat` 上的值；链接没写时为 undefined */
export const routedApiFormat = (
  app: AppId,
  format: DeepLinkApiFormat | undefined,
): DeepLinkApiFormat | undefined => {
  if (!format) return undefined;
  if (app !== "claude" && app !== "codex" && app !== "grokbuild") {
    return undefined;
  }
  return NATIVE_VALUES[app]?.[format] ? format : undefined;
};

/**
 * 值里有没有环境变量或文件引用。`${` 和 OpenCode 的 `{env:` / `{file:` 对所有累加式应用
 * 都拒绝；Pi 还会展开不带花括号的 `$NAME`。
 */
const hasDynamicReference = (value: string, isPi: boolean) => {
  if (
    value.includes("${") ||
    value.includes("{env:") ||
    value.includes("{file:")
  ) {
    return true;
  }
  return isPi && /\$[A-Za-z_]/.test(value);
};

/**
 * 累加式应用读配置时会解释的字符串写法，链接带了就拒绝导入。
 *
 * - Pi：`apiKey` 以 `!` 开头会被当成 shell 命令执行；`$NAME`、`${NAME}` 会换成环境变量。
 * - OpenCode：`{env:NAME}` 读环境变量，`{file:path}` 读本机文件。
 * - OpenClaw、Hermes：`${NAME}` 读环境变量。
 *
 * 链接是不可信输入：这些写法会让客户端执行链接里的命令，或把本机的密钥、文件内容随请求
 * 发到链接给的地址。确认框把 Key 打码显示，用户也看不出来，所以直接拒绝。
 * 名称、地址、Key、模型都会写进这些应用的配置，都要查（解析、合并 config、导入三处都调）。
 */
export const checkLinkValues = (
  request: Pick<
    DeepLinkImportRequest,
    "app" | "name" | "endpoint" | "apiKey" | "model"
  >,
) => {
  if (!isAdditiveLinkApp(request.app)) return;
  const isPi = request.app === "pi";
  const fields: Array<[string, string | undefined]> = [
    ["name", request.name],
    ["endpoint", request.endpoint],
    ["apiKey", request.apiKey],
    ["model", request.model],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    const command =
      isPi && field === "apiKey" && value.trimStart().startsWith("!");
    if (command || hasDynamicReference(value, isPi)) {
      throw new Error(
        `链接的 ${field} 使用了 ${request.app} 会展开成命令、环境变量或本机文件的写法，不能从链接导入，请手动添加供应商`,
      );
    }
  }
};
