// 供应商配置处理工具函数

import type { TemplateValueConfig } from "../config/claudeProviderPresets";
import { normalizeTomlText } from "@/utils/textNormalization";
import { parse as parseToml } from "smol-toml";
import type { CodexApiFormat } from "@/types";

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return Object.prototype.toString.call(value) === "[object Object]";
};

const FORBIDDEN_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const sanitizeSnippet = (value: any): any => {
  if (Array.isArray(value)) return value.map(sanitizeSnippet);
  if (!isPlainObject(value)) return value;

  const cleaned: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MERGE_KEYS.has(key)) continue;
    cleaned[key] = sanitizeSnippet(child);
  }
  return cleaned;
};

const deepMerge = (
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> => {
  Object.entries(source).forEach(([key, value]) => {
    if (FORBIDDEN_MERGE_KEYS.has(key)) return;

    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      // 直接覆盖非对象字段（数组/基础类型）
      target[key] = value;
    }
  });
  return target;
};

const deepRemove = (
  target: Record<string, any>,
  source: Record<string, any>,
) => {
  Object.entries(source).forEach(([key, value]) => {
    if (FORBIDDEN_MERGE_KEYS.has(key)) return;
    if (!(key in target)) return;

    if (isPlainObject(value) && isPlainObject(target[key])) {
      // 只移除完全匹配的嵌套属性
      deepRemove(target[key], value);
      if (Object.keys(target[key]).length === 0) {
        delete target[key];
      }
    } else if (isSubset(target[key], value)) {
      // 只有当值完全匹配时才删除
      delete target[key];
    }
  });
};

const isSubset = (target: any, source: any): boolean => {
  if (isPlainObject(source)) {
    if (!isPlainObject(target)) return false;
    return Object.entries(source).every(([key, value]) => {
      if (FORBIDDEN_MERGE_KEYS.has(key)) return false;
      if (!Object.prototype.hasOwnProperty.call(target, key)) return false;
      return isSubset(target[key], value);
    });
  }

  if (Array.isArray(source)) {
    if (!Array.isArray(target) || target.length !== source.length) return false;
    return source.every((item, index) => isSubset(target[index], item));
  }

  return target === source;
};

// 深拷贝函数
const deepClone = <T>(obj: T): T => {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (obj instanceof Array) return obj.map((item) => deepClone(item)) as T;
  if (obj instanceof Object) {
    const clonedObj = {} as T;
    for (const key in obj) {
      if (
        !FORBIDDEN_MERGE_KEYS.has(key) &&
        Object.prototype.hasOwnProperty.call(obj, key)
      ) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
  return obj;
};

export interface UpdateCommonConfigResult {
  updatedConfig: string;
  error?: string;
}

// 验证JSON配置格式
export const validateJsonConfig = (
  value: string,
  fieldName: string = "配置",
): string => {
  if (!value.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${fieldName}必须是 JSON 对象`;
    }
    return "";
  } catch {
    return `${fieldName}JSON格式错误，请检查语法`;
  }
};

// 将通用配置片段写入/移除 settingsConfig
export const updateCommonConfigSnippet = (
  jsonString: string,
  snippetString: string,
  enabled: boolean,
): UpdateCommonConfigResult => {
  let config: Record<string, any>;
  try {
    config = jsonString ? JSON.parse(jsonString) : {};
  } catch (err) {
    return {
      updatedConfig: jsonString,
      error: "配置 JSON 解析失败，无法写入通用配置",
    };
  }

  if (!snippetString.trim()) {
    return {
      updatedConfig: JSON.stringify(config, null, 2),
    };
  }

  // 使用统一的验证函数
  const snippetError = validateJsonConfig(snippetString, "通用配置片段");
  if (snippetError) {
    return {
      updatedConfig: JSON.stringify(config, null, 2),
      error: snippetError,
    };
  }

  const snippet = JSON.parse(snippetString) as Record<string, any>;

  if (enabled) {
    const merged = deepMerge(deepClone(config), snippet);
    return {
      updatedConfig: JSON.stringify(merged, null, 2),
    };
  }

  const cloned = deepClone(config);
  deepRemove(cloned, snippet);
  return {
    updatedConfig: JSON.stringify(cloned, null, 2),
  };
};

// 检查当前配置是否已包含通用配置片段
export const hasCommonConfigSnippet = (
  jsonString: string,
  snippetString: string,
): boolean => {
  try {
    if (!snippetString.trim()) return false;
    const config = jsonString ? JSON.parse(jsonString) : {};
    const parsed = JSON.parse(snippetString);
    if (!isPlainObject(parsed)) return false;
    const snippet = sanitizeSnippet(parsed);
    if (Object.keys(snippet).length === 0) return false;
    return isSubset(config, snippet);
  } catch (err) {
    return false;
  }
};

// 读取配置中的 API Key（支持 Claude, Codex, Gemini）
export const getApiKeyFromConfig = (
  jsonString: string,
  appType?: string,
): string => {
  try {
    const config = JSON.parse(jsonString);

    // Claude Code 从此环境变量读取 Bedrock API Key，优先于旧版顶层字段。
    const bedrockToken = config?.env?.AWS_BEARER_TOKEN_BEDROCK;
    if (typeof bedrockToken === "string" && bedrockToken) {
      return bedrockToken;
    }

    // 保留旧版顶层 apiKey 的兼容读取。
    if (
      typeof config?.apiKey === "string" &&
      config.apiKey &&
      !config.apiKey.includes("${")
    ) {
      return config.apiKey;
    }

    const env = config?.env;

    if (!env) return "";

    // Gemini API Key
    if (appType === "gemini") {
      const geminiKey = env.GEMINI_API_KEY;
      return typeof geminiKey === "string" ? geminiKey : "";
    }

    // Codex API Key
    if (appType === "codex") {
      const codexKey = env.CODEX_API_KEY;
      return typeof codexKey === "string" ? codexKey : "";
    }

    // Claude API Key (优先 ANTHROPIC_AUTH_TOKEN，其次 ANTHROPIC_API_KEY)
    const token = env.ANTHROPIC_AUTH_TOKEN;
    const apiKey = env.ANTHROPIC_API_KEY;
    const value =
      typeof token === "string"
        ? token
        : typeof apiKey === "string"
          ? apiKey
          : "";
    return value;
  } catch (err) {
    return "";
  }
};

// 模板变量替换
export const applyTemplateValues = (
  config: any,
  templateValues: Record<string, TemplateValueConfig> | undefined,
): any => {
  const resolvedValues = Object.fromEntries(
    Object.entries(templateValues ?? {}).map(([key, value]) => {
      const resolvedValue =
        value.editorValue !== undefined
          ? value.editorValue
          : (value.defaultValue ?? "");
      return [key, resolvedValue];
    }),
  );

  const replaceInString = (str: string): string => {
    return Object.entries(resolvedValues).reduce((acc, [key, value]) => {
      const placeholder = `\${${key}}`;
      if (!acc.includes(placeholder)) {
        return acc;
      }
      return acc.split(placeholder).join(value ?? "");
    }, str);
  };

  const traverse = (obj: any): any => {
    if (typeof obj === "string") {
      return replaceInString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(traverse);
    }
    if (obj && typeof obj === "object") {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = traverse(value);
      }
      return result;
    }
    return obj;
  };

  return traverse(config);
};

// 判断配置中是否存在 API Key 字段
export const hasApiKeyField = (
  jsonString: string,
  appType?: string,
): boolean => {
  try {
    const config = JSON.parse(jsonString);

    // 检查顶层 apiKey 字段（用于 Bedrock API Key 等预设）
    if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
      return true;
    }

    const env = config?.env ?? {};

    if (Object.prototype.hasOwnProperty.call(env, "AWS_BEARER_TOKEN_BEDROCK")) {
      return true;
    }

    if (appType === "gemini") {
      return Object.prototype.hasOwnProperty.call(env, "GEMINI_API_KEY");
    }

    if (appType === "codex") {
      return Object.prototype.hasOwnProperty.call(env, "CODEX_API_KEY");
    }

    return (
      Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_AUTH_TOKEN") ||
      Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_API_KEY")
    );
  } catch (err) {
    return false;
  }
};

// 写入/更新配置中的 API Key，默认不新增缺失字段
export const setApiKeyInConfig = (
  jsonString: string,
  apiKey: string,
  options: {
    createIfMissing?: boolean;
    appType?: string;
    apiKeyField?: string;
  } = {},
): string => {
  const { createIfMissing = false, appType, apiKeyField } = options;
  try {
    const config = JSON.parse(jsonString);

    // 新版 Bedrock 预设写回原生环境变量，旧行仍按原字段保存。
    if (
      config?.env &&
      Object.prototype.hasOwnProperty.call(
        config.env,
        "AWS_BEARER_TOKEN_BEDROCK",
      )
    ) {
      config.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;
      return JSON.stringify(config, null, 2);
    }

    if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
      config.apiKey = apiKey;
      return JSON.stringify(config, null, 2);
    }

    if (!config.env) {
      if (!createIfMissing) return jsonString;
      config.env = {};
    }
    const env = config.env as Record<string, any>;

    // Gemini API Key
    if (appType === "gemini") {
      if ("GEMINI_API_KEY" in env) {
        env.GEMINI_API_KEY = apiKey;
      } else if (createIfMissing) {
        env.GEMINI_API_KEY = apiKey;
      } else {
        return jsonString;
      }
      return JSON.stringify(config, null, 2);
    }

    // Codex API Key
    if (appType === "codex") {
      if ("CODEX_API_KEY" in env) {
        env.CODEX_API_KEY = apiKey;
      } else if (createIfMissing) {
        env.CODEX_API_KEY = apiKey;
      } else {
        return jsonString;
      }
      return JSON.stringify(config, null, 2);
    }

    // Claude API Key (优先写入已存在的字段；若两者均不存在且允许创建，则使用 apiKeyField 或默认 AUTH_TOKEN 字段)
    if ("ANTHROPIC_AUTH_TOKEN" in env) {
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    } else if ("ANTHROPIC_API_KEY" in env) {
      env.ANTHROPIC_API_KEY = apiKey;
    } else if (createIfMissing) {
      env[apiKeyField ?? "ANTHROPIC_AUTH_TOKEN"] = apiKey;
    } else {
      return jsonString;
    }
    return JSON.stringify(config, null, 2);
  } catch (err) {
    return jsonString;
  }
};

// ========== TOML Config Utilities ==========

// Check if TOML config already contains the common config snippet (structural subset check)
export const hasTomlCommonConfigSnippet = (
  tomlString: string,
  snippetString: string,
): boolean => {
  if (!snippetString.trim()) return false;

  try {
    const config = parseToml(normalizeTomlText(tomlString || ""));
    const snippet = sanitizeSnippet(
      parseToml(normalizeTomlText(snippetString)),
    );
    if (!isPlainObject(snippet) || Object.keys(snippet).length === 0) {
      return false;
    }
    return isSubset(config, snippet);
  } catch {
    // Fallback to text-based matching if TOML parsing fails
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    return norm(tomlString).includes(norm(snippetString));
  }
};

// ========== Codex base_url utils ==========

// 也认数组表头 `[[...]]`（上游 ddcb1117）：否则 provider 表的范围会越过它
const TOML_SECTION_HEADER_PATTERN = /^\s*\[{1,2}([^\]\r\n]+)\]{1,2}\s*$/;
const TOML_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
// 点分键的一段（基本字符串、字面字符串或裸键）及其后的 "." 或结尾
const TOML_DOTTED_KEY_SEGMENT_PATTERN =
  /\s*(?:"((?:\\.|[^"\\\r\n])*)"|'([^'\r\n]*)'|([A-Za-z0-9_-]+))\s*(\.|$)/y;
const TOML_BASE_URL_PATTERN =
  /^\s*base_url\s*=\s*(["'])([^"'\r\n]+)\1\s*(?:#.*)?$/;
const TOML_MODEL_DOUBLE_QUOTED_PATTERN =
  /^\s*model\s*=\s*"((?:[^"\\\r\n]|\\.)*)"\s*(?:#.*)?$/;
const TOML_MODEL_SINGLE_QUOTED_PATTERN =
  /^\s*model\s*=\s*'([^'\r\n]*)'\s*(?:#.*)?$/;
const TOML_WIRE_API_PATTERN =
  /^\s*wire_api\s*=\s*(["'])([^"'\r\n]+)\1\s*(?:#.*)?$/;
const TOML_MODEL_PROVIDER_LINE_PATTERN =
  /^\s*model_provider\s*=\s*(["'])([^"'\r\n]+)\1\s*(?:#.*)?$/;
// 任意值（含空串、非字符串）的顶层 model_provider 行：改选路时整行替换，免得写出重复键
const TOML_ANY_MODEL_PROVIDER_LINE_PATTERN = /^\s*model_provider\s*=/;
// 后端写 live 时用的路由表 id（ROUTE_ID）
const CODEX_CUSTOM_ROUTE_ID = "custom";
const TOML_MODEL_PROVIDER_PATTERN =
  /^\s*model_provider\s*=\s*(["'])([^"'\r\n]+)\1\s*(?:#.*)?$/m;

interface TomlSectionRange {
  bodyEndIndex: number;
  bodyStartIndex: number;
}

interface TomlAssignmentMatch {
  index: number;
  sectionName?: string;
  value: string;
}

const finalizeTomlText = (lines: string[]): string =>
  lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");

// 表名的规范写法：能用裸键的段用裸键，其余用基本字符串
const tomlTableName = (...segments: string[]): string =>
  segments
    .map((segment) =>
      TOML_BARE_KEY_PATTERN.test(segment) ? segment : tomlBasicString(segment),
    )
    .join(".");

// `[model_providers."custom"]`、`[ model_providers . custom ]` 与
// `[model_providers.custom]` 是同一张表（上游 #8271），比较表头前先统一成规范写法；
// 认不出的表头原样返回
const normalizeTomlTableName = (header: string): string => {
  const segments: string[] = [];
  let index = 0;
  for (;;) {
    TOML_DOTTED_KEY_SEGMENT_PATTERN.lastIndex = index;
    const match = TOML_DOTTED_KEY_SEGMENT_PATTERN.exec(header);
    if (!match) return header;
    const [, basic, literal, bare, separator] = match;
    segments.push(
      basic !== undefined ? unescapeTomlBasicString(basic) : (literal ?? bare),
    );
    if (separator !== ".") return tomlTableName(...segments);
    index = TOML_DOTTED_KEY_SEGMENT_PATTERN.lastIndex;
  }
};

// 标出以多行字符串（""" 或 '''）内部开头的行。这些行是字符串内容，像表头或赋值也不算：
// 说明文字里的 `[model_providers."custom"]` 示例不能被当成真正的 provider 表。
// 逐字符跟踪字符串和注释状态；单行字符串和注释到行尾为止。
const getTomlMultilineStringLines = (lines: string[]): boolean[] => {
  let delimiter: '"""' | "'''" | undefined;
  return lines.map((line) => {
    const insideString = delimiter !== undefined;
    let index = 0;
    while (index < line.length) {
      if (delimiter) {
        if (delimiter === '"""' && line[index] === "\\") {
          index += 2;
          continue;
        }
        if (line.startsWith(delimiter, index)) {
          // 结束符前最多可以再贴两个引号，它们属于字符串内容
          const quote = delimiter[0];
          let end = index + 3;
          while (end < index + 5 && line[end] === quote) end += 1;
          delimiter = undefined;
          index = end;
          continue;
        }
        index += 1;
        continue;
      }

      const ch = line[index];
      if (ch === "#") break;
      if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
        delimiter = line.startsWith('"""', index) ? '"""' : "'''";
        index += 3;
        continue;
      }
      if (ch === '"') {
        index += 1;
        while (index < line.length && line[index] !== '"') {
          index += line[index] === "\\" ? 2 : 1;
        }
        index += 1;
        continue;
      }
      if (ch === "'") {
        const end = line.indexOf("'", index + 1);
        index = end === -1 ? line.length : end + 1;
        continue;
      }
      index += 1;
    }
    return insideString;
  });
};

const getTomlSectionRange = (
  lines: string[],
  sectionName: string,
): TomlSectionRange | undefined => {
  const targetName = normalizeTomlTableName(sectionName);
  const stringLines = getTomlMultilineStringLines(lines);
  let headerLineIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (stringLines[index]) continue;
    const match = lines[index].match(TOML_SECTION_HEADER_PATTERN);
    if (!match) {
      continue;
    }

    if (headerLineIndex === -1) {
      if (normalizeTomlTableName(match[1]) === targetName) {
        headerLineIndex = index;
      }
      continue;
    }

    return {
      bodyStartIndex: headerLineIndex + 1,
      bodyEndIndex: index,
    };
  }

  if (headerLineIndex === -1) {
    return undefined;
  }

  return {
    bodyStartIndex: headerLineIndex + 1,
    bodyEndIndex: lines.length,
  };
};

const getTopLevelEndIndex = (lines: string[]): number => {
  const stringLines = getTomlMultilineStringLines(lines);
  const firstSectionIndex = lines.findIndex(
    (line, index) =>
      !stringLines[index] && TOML_SECTION_HEADER_PATTERN.test(line),
  );
  return firstSectionIndex === -1 ? lines.length : firstSectionIndex;
};

const TOML_BASIC_STRING_ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

const tomlBasicString = (value: string): string =>
  `"${value.replace(/["\\\u0000-\u001f]/g, (character) => {
    const escaped = TOML_BASIC_STRING_ESCAPES[character];
    return (
      escaped ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  })}"`;

const TOML_BASIC_STRING_UNESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
};

const unescapeTomlBasicString = (value: string): string =>
  value.replace(
    /\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(.))/g,
    (match, u4, u8, character) => {
      if (u4 || u8) return String.fromCodePoint(parseInt(u4 || u8, 16));
      return TOML_BASIC_STRING_UNESCAPES[character] ?? match;
    },
  );

const getTomlSectionInsertIndex = (
  lines: string[],
  sectionRange: TomlSectionRange,
): number => {
  let insertIndex = sectionRange.bodyEndIndex;
  while (
    insertIndex > sectionRange.bodyStartIndex &&
    lines[insertIndex - 1].trim() === ""
  ) {
    insertIndex -= 1;
  }
  return insertIndex;
};

const getCodexModelProviderName = (configText: string): string | undefined => {
  const match = configText.match(TOML_MODEL_PROVIDER_PATTERN);
  const providerName = match?.[2]?.trim();
  return providerName || undefined;
};

const isCodexUnifiedSessionProjection = (configText: string): boolean => {
  try {
    const parsed = parseToml(normalizeTomlText(configText)) as Record<
      string,
      any
    >;
    const custom = parsed.model_providers?.custom;
    return (
      parsed.model_provider === "custom" &&
      isPlainObject(custom) &&
      Object.keys(custom).length === 4 &&
      custom.name === "OpenAI" &&
      custom.requires_openai_auth === true &&
      custom.supports_websockets === true &&
      custom.wire_api === "responses"
    );
  } catch {
    return false;
  }
};

export const hasExplicitNonOpenAiCodexModelProvider = (
  configText: string | undefined | null,
): boolean => {
  if (typeof configText !== "string") return false;
  if (isCodexUnifiedSessionProjection(configText)) return false;
  const providerName = getCodexModelProviderName(configText);
  // 与后端一致按大小写精确匹配：Codex 内置 provider 查找区分大小写，
  // `OpenAI` 会路由到自定义表，属于第三方上游而非官方 provider。
  return Boolean(providerName && providerName.trim() !== "openai");
};

const getCodexProviderSectionName = (
  configText: string,
): string | undefined => {
  const providerName = getCodexModelProviderName(configText);
  return providerName
    ? tomlTableName("model_providers", providerName)
    : undefined;
};

const findTomlAssignmentInRange = (
  lines: string[],
  pattern: RegExp,
  startIndex: number,
  endIndex: number,
  sectionName?: string,
): TomlAssignmentMatch | undefined => {
  const stringLines = getTomlMultilineStringLines(lines);
  for (let index = startIndex; index < endIndex; index += 1) {
    if (stringLines[index]) continue;
    const match = lines[index].match(pattern);
    if (match?.[2]) {
      return {
        index,
        sectionName,
        value: match[2],
      };
    }
  }

  return undefined;
};

const findTomlAssignments = (
  lines: string[],
  pattern: RegExp,
): TomlAssignmentMatch[] => {
  const assignments: TomlAssignmentMatch[] = [];
  let currentSectionName: string | undefined;
  const stringLines = getTomlMultilineStringLines(lines);

  lines.forEach((line, index) => {
    if (stringLines[index]) return;
    const sectionMatch = line.match(TOML_SECTION_HEADER_PATTERN);
    if (sectionMatch) {
      currentSectionName = normalizeTomlTableName(sectionMatch[1]);
      return;
    }

    const match = line.match(pattern);
    if (!match?.[2]) {
      return;
    }

    assignments.push({
      index,
      sectionName: currentSectionName,
      value: match[2],
    });
  });

  return assignments;
};

const isMcpServerSection = (sectionName?: string): boolean =>
  sectionName === "mcp_servers" ||
  sectionName?.startsWith("mcp_servers.") === true;

const isOtherProviderSection = (
  sectionName: string | undefined,
  targetSectionName: string | undefined,
): boolean =>
  Boolean(
    sectionName &&
    sectionName !== targetSectionName &&
    (sectionName === "model_providers" ||
      sectionName.startsWith("model_providers.")),
  );

const getRecoverableBaseUrlAssignments = (
  assignments: TomlAssignmentMatch[],
  targetSectionName: string | undefined,
): TomlAssignmentMatch[] =>
  assignments.filter(
    ({ sectionName }) =>
      sectionName !== targetSectionName &&
      !isMcpServerSection(sectionName) &&
      !isOtherProviderSection(sectionName, targetSectionName),
  );

// 跟随上游 cc-switch 1c82b8a3：wire_api 字段与 base_url 共用恢复策略
const getRecoverableCodexProviderAssignments = getRecoverableBaseUrlAssignments;

const getTopLevelModelProviderLineIndex = (lines: string[]): number => {
  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const stringLines = getTomlMultilineStringLines(lines);

  for (let index = 0; index < topLevelEndIndex; index += 1) {
    if (
      !stringLines[index] &&
      TOML_MODEL_PROVIDER_LINE_PATTERN.test(lines[index])
    ) {
      return index;
    }
  }

  return -1;
};

// ---------------------------------------------------------------------------
// Codex wire_api 处理（跟随上游 cc-switch 1c82b8a3）
// Codex 客户端的 TOML 配置里 wire_api 字段决定它发往代理的协议方向：
//   "responses" → 原生 Codex Responses（默认）
//   "chat" / "openai_chat" / ... → OpenAI Chat Completions
// 当用户在前端选择 "openai_chat" 时，代理需要把 Responses 请求转换成
// Chat Completions 发到上游；这里提供 wire_api 的解析/写回工具。
// ---------------------------------------------------------------------------

const CODEX_CHAT_WIRE_API_VALUES = new Set([
  "chat",
  "chat_completions",
  "chat-completions",
  "openai_chat",
  "openai-chat",
  "openai_chat_completions",
]);

// 判断给定的 wire_api 字符串是否表示 Codex 的 Chat Completions 协议
export const isCodexChatWireApi = (
  wireApi: string | undefined | null,
): boolean =>
  CODEX_CHAT_WIRE_API_VALUES.has((wireApi ?? "").trim().toLowerCase());

export const isCodexAnthropicWireApi = (
  wireApi: string | undefined | null,
): boolean =>
  [
    "anthropic",
    "anthropic_messages",
    "anthropic-messages",
    "messages",
    "claude",
  ].includes((wireApi ?? "").trim().toLowerCase());

export const codexApiFormatFromWireApi = (
  wireApi: string | undefined | null,
): CodexApiFormat | undefined => {
  if (isCodexChatWireApi(wireApi)) return "openai_chat";
  if (isCodexAnthropicWireApi(wireApi)) return undefined;
  return ["responses", "openai_responses", "openai-responses"].includes(
    (wireApi ?? "").trim().toLowerCase(),
  )
    ? "openai_responses"
    : undefined;
};

// 从 Codex 的 TOML 配置文本中提取 wire_api（支持单/双引号）
export const extractCodexWireApi = (
  configText: string | undefined | null,
): string | undefined => {
  try {
    const raw = typeof configText === "string" ? configText : "";
    const text = normalizeTomlText(raw);
    if (!text) return undefined;

    const lines = text.split("\n");
    const targetSectionName = getCodexProviderSectionName(text);

    if (targetSectionName) {
      const sectionRange = getTomlSectionRange(lines, targetSectionName);
      if (sectionRange) {
        const match = findTomlAssignmentInRange(
          lines,
          TOML_WIRE_API_PATTERN,
          sectionRange.bodyStartIndex,
          sectionRange.bodyEndIndex,
          targetSectionName,
        );
        if (match?.value) {
          return match.value;
        }
      }
    }

    const topLevelMatch = findTomlAssignmentInRange(
      lines,
      TOML_WIRE_API_PATTERN,
      0,
      getTopLevelEndIndex(lines),
    );
    if (topLevelMatch?.value) {
      return topLevelMatch.value;
    }

    const fallbackAssignments = getRecoverableCodexProviderAssignments(
      findTomlAssignments(lines, TOML_WIRE_API_PATTERN),
      targetSectionName,
    );
    return fallbackAssignments.length === 1
      ? fallbackAssignments[0].value
      : undefined;
  } catch {
    return undefined;
  }
};

// 在 Codex 的 TOML 配置文本中写入或更新 wire_api 字段
export const setCodexWireApi = (
  configText: string,
  wireApi: "responses" | "chat",
): string => {
  const normalizedText = normalizeTomlText(configText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const targetSectionName = getCodexProviderSectionName(normalizedText);
  const replacementLine = `wire_api = "${wireApi}"`;
  const allAssignments = findTomlAssignments(lines, TOML_WIRE_API_PATTERN);
  const recoverableAssignments = getRecoverableCodexProviderAssignments(
    allAssignments,
    targetSectionName,
  );

  if (targetSectionName) {
    let targetSectionRange = getTomlSectionRange(lines, targetSectionName);
    const targetMatch = targetSectionRange
      ? findTomlAssignmentInRange(
          lines,
          TOML_WIRE_API_PATTERN,
          targetSectionRange.bodyStartIndex,
          targetSectionRange.bodyEndIndex,
          targetSectionName,
        )
      : undefined;

    if (targetMatch) {
      lines[targetMatch.index] = replacementLine;
      return finalizeTomlText(lines);
    }

    if (recoverableAssignments.length === 1) {
      lines.splice(recoverableAssignments[0].index, 1);
      targetSectionRange = getTomlSectionRange(lines, targetSectionName);
    }

    if (targetSectionRange) {
      const insertIndex = getTomlSectionInsertIndex(lines, targetSectionRange);
      lines.splice(insertIndex, 0, replacementLine);
      return finalizeTomlText(lines);
    }

    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(`[${targetSectionName}]`, replacementLine);
    return finalizeTomlText(lines);
  }

  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const topLevelMatch = findTomlAssignmentInRange(
    lines,
    TOML_WIRE_API_PATTERN,
    0,
    topLevelEndIndex,
  );
  if (topLevelMatch) {
    lines[topLevelMatch.index] = replacementLine;
    return finalizeTomlText(lines);
  }

  const modelProviderIndex = getTopLevelModelProviderLineIndex(lines);
  if (modelProviderIndex !== -1) {
    lines.splice(modelProviderIndex + 1, 0, replacementLine);
    return finalizeTomlText(lines);
  }

  if (lines.length === 0) {
    return `${replacementLine}\n`;
  }

  lines.splice(topLevelEndIndex, 0, replacementLine);
  return finalizeTomlText(lines);
};

// 从 Codex 的 TOML 配置文本中提取 base_url（支持单/双引号）
export const extractCodexBaseUrl = (
  configText: string | undefined | null,
): string | undefined => {
  try {
    const raw = typeof configText === "string" ? configText : "";
    const text = normalizeTomlText(raw);
    if (!text) return undefined;

    const lines = text.split("\n");
    const targetSectionName = getCodexProviderSectionName(text);

    if (targetSectionName) {
      const sectionRange = getTomlSectionRange(lines, targetSectionName);
      if (sectionRange) {
        const match = findTomlAssignmentInRange(
          lines,
          TOML_BASE_URL_PATTERN,
          sectionRange.bodyStartIndex,
          sectionRange.bodyEndIndex,
          targetSectionName,
        );
        if (match?.value) {
          return match.value;
        }
      }
    }

    const topLevelMatch = findTomlAssignmentInRange(
      lines,
      TOML_BASE_URL_PATTERN,
      0,
      getTopLevelEndIndex(lines),
    );
    if (topLevelMatch?.value) {
      return topLevelMatch.value;
    }

    const fallbackAssignments = getRecoverableBaseUrlAssignments(
      findTomlAssignments(lines, TOML_BASE_URL_PATTERN),
      targetSectionName,
    );
    return fallbackAssignments.length === 1
      ? fallbackAssignments[0].value
      : undefined;
  } catch {
    return undefined;
  }
};

// 与后端 backend/src/codex_config.rs 的 CODEX_RESERVED_MODEL_PROVIDER_IDS 保持同步。
const CODEX_RESERVED_MODEL_PROVIDER_IDS = new Set([
  "amazon-bedrock",
  "amazon-bedrock-runtime",
  "openai",
  "ollama",
  "lmstudio",
]);

// 与上游 Codex 及后端判定一致按大小写精确匹配："OpenAI" 等是合法自定义 id。
const isCustomCodexModelProviderId = (providerName: string): boolean => {
  const id = providerName.trim();
  return Boolean(id) && !CODEX_RESERVED_MODEL_PROVIDER_IDS.has(id);
};

export const extractCodexExperimentalBearerToken = (
  configText: string | undefined | null,
): string | undefined => {
  try {
    const text = normalizeTomlText(
      typeof configText === "string" ? configText : "",
    );
    if (!text) return undefined;
    const parsed = parseToml(text) as Record<string, any>;
    const providerName =
      typeof parsed.model_provider === "string"
        ? parsed.model_provider.trim()
        : undefined;
    // 保留 id 的表不承载 bearer token，只读顶层字段。
    const providerToken =
      providerName && isCustomCodexModelProviderId(providerName)
        ? parsed.model_providers?.[providerName]?.experimental_bearer_token
        : undefined;
    const value =
      typeof providerToken === "string"
        ? providerToken
        : parsed.experimental_bearer_token;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

// 从 Provider 对象中提取 Codex base_url（当 settingsConfig.config 为 TOML 字符串时）
export const getCodexBaseUrl = (
  provider: { settingsConfig?: Record<string, any> } | undefined | null,
): string | undefined => {
  try {
    const text =
      typeof provider?.settingsConfig?.config === "string"
        ? (provider as any).settingsConfig.config
        : "";
    return extractCodexBaseUrl(text);
  } catch {
    return undefined;
  }
};

// 解析后的 TOML 值转成可比较的普通值：键排序，日期按文本比
const comparableTomlValue = (value: unknown): unknown => {
  if (value instanceof Date) return { $date: String(value) };
  if (Array.isArray(value)) return value.map(comparableTomlValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          comparableTomlValue((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
};

// 没有选路时把地址写进选中的 custom 表：Codex 不认顶层 base_url（#8039）。逐行改写认不全
// TOML 的写法（内联表、带注释的表头、多行字符串里像赋值的行），所以改完按解析结果核对：
// 除了选路、地址和收进表里的顶层 wire_api，其余值都没变才采用；否则返回 undefined，由
// 调用方照旧写顶层 base_url（后端会把这种旧形态归一成 custom 表）。
const moveCodexBaseUrlIntoCustomTable = (
  text: string,
  url: string,
): string | undefined => {
  let before: Record<string, unknown>;
  try {
    before = parseToml(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const lines = text ? text.split("\n") : [];
  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const topLevelWireApi = findTomlAssignmentInRange(
    lines,
    TOML_WIRE_API_PATTERN,
    0,
    topLevelEndIndex,
  )?.value;
  for (let index = topLevelEndIndex - 1; index >= 0; index -= 1) {
    if (
      TOML_BASE_URL_PATTERN.test(lines[index]) ||
      TOML_WIRE_API_PATTERN.test(lines[index]) ||
      TOML_ANY_MODEL_PROVIDER_LINE_PATTERN.test(lines[index])
    ) {
      lines.splice(index, 1);
    }
  }
  lines.unshift(`model_provider = "${CODEX_CUSTOM_ROUTE_ID}"`);

  const sectionName = `model_providers.${CODEX_CUSTOM_ROUTE_ID}`;
  const hadSection = Boolean(getTomlSectionRange(lines, sectionName));
  if (!hadSection) {
    if (lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(
      `[${sectionName}]`,
      `name = "${CODEX_CUSTOM_ROUTE_ID}"`,
      `wire_api = ${tomlBasicString(topLevelWireApi ?? "responses")}`,
    );
  }
  const candidate = setCodexBaseUrl(finalizeTomlText(lines), url);

  let after: unknown;
  try {
    after = parseToml(candidate);
  } catch {
    return undefined;
  }
  const expected = comparableTomlValue(before) as Record<string, any>;
  delete expected.base_url;
  delete expected.wire_api;
  expected.model_provider = CODEX_CUSTOM_ROUTE_ID;
  expected.model_providers ??= {};
  if (!hadSection) {
    expected.model_providers[CODEX_CUSTOM_ROUTE_ID] = {
      name: CODEX_CUSTOM_ROUTE_ID,
      wire_api: topLevelWireApi ?? "responses",
    };
  }
  if (typeof expected.model_providers[CODEX_CUSTOM_ROUTE_ID] !== "object") {
    return undefined;
  }
  expected.model_providers[CODEX_CUSTOM_ROUTE_ID].base_url = url;
  return JSON.stringify(comparableTomlValue(expected)) ===
    JSON.stringify(comparableTomlValue(after))
    ? candidate
    : undefined;
};

// 从任一应用的 settingsConfig 中取出请求地址：各应用存法不同（env 变量 / baseUrl /
// base_url / options.baseURL / models[].baseUrl / Codex 风格 TOML），按已知形态依次找
export const extractProviderBaseUrl = (
  settingsConfig: unknown,
): string | undefined => {
  if (!settingsConfig || typeof settingsConfig !== "object") return undefined;
  const object = settingsConfig as Record<string, any>;

  const envBase =
    object.env?.ANTHROPIC_BASE_URL || object.env?.GOOGLE_GEMINI_BASE_URL;
  if (typeof envBase === "string" && envBase.trim()) {
    return envBase;
  }

  const directBaseUrl =
    (isPlainObject(object.provider) ? object.provider.base_url : undefined) ||
    object.baseUrl ||
    object.base_url ||
    object.options?.baseURL ||
    (Array.isArray(object.models)
      ? object.models.find(
          (model: unknown) =>
            model &&
            typeof model === "object" &&
            typeof (model as Record<string, unknown>).baseUrl === "string",
        )?.baseUrl
      : undefined);
  if (typeof directBaseUrl === "string" && directBaseUrl.trim()) {
    return directBaseUrl;
  }

  if (typeof object.config === "string" && object.config.includes("base_url")) {
    return extractCodexBaseUrl(object.config) || undefined;
  }

  return undefined;
};

// 在 Codex 的 TOML 配置文本中写入或更新 base_url 字段
export const setCodexBaseUrl = (
  configText: string,
  baseUrl: string,
): string => {
  const trimmed = baseUrl.trim();
  const normalizedText = normalizeTomlText(configText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const targetSectionName = getCodexProviderSectionName(normalizedText);
  const allAssignments = findTomlAssignments(lines, TOML_BASE_URL_PATTERN);
  const recoverableAssignments = getRecoverableBaseUrlAssignments(
    allAssignments,
    targetSectionName,
  );

  if (!trimmed) {
    if (!normalizedText) return normalizedText;

    if (targetSectionName) {
      const sectionRange = getTomlSectionRange(lines, targetSectionName);
      const targetMatch = sectionRange
        ? findTomlAssignmentInRange(
            lines,
            TOML_BASE_URL_PATTERN,
            sectionRange.bodyStartIndex,
            sectionRange.bodyEndIndex,
            targetSectionName,
          )
        : undefined;

      if (targetMatch) {
        lines.splice(targetMatch.index, 1);
        return finalizeTomlText(lines);
      }
    }

    if (recoverableAssignments.length === 1) {
      lines.splice(recoverableAssignments[0].index, 1);
      return finalizeTomlText(lines);
    }

    return finalizeTomlText(lines);
  }

  const normalizedUrl = trimmed.replace(/\s+/g, "");
  const replacementLine = `base_url = "${normalizedUrl}"`;

  if (targetSectionName) {
    let targetSectionRange = getTomlSectionRange(lines, targetSectionName);
    const targetMatch = targetSectionRange
      ? findTomlAssignmentInRange(
          lines,
          TOML_BASE_URL_PATTERN,
          targetSectionRange.bodyStartIndex,
          targetSectionRange.bodyEndIndex,
          targetSectionName,
        )
      : undefined;

    if (targetMatch) {
      lines[targetMatch.index] = replacementLine;
      return finalizeTomlText(lines);
    }

    if (recoverableAssignments.length === 1) {
      lines.splice(recoverableAssignments[0].index, 1);
      targetSectionRange = getTomlSectionRange(lines, targetSectionName);
    }

    if (targetSectionRange) {
      const insertIndex = getTomlSectionInsertIndex(lines, targetSectionRange);
      lines.splice(insertIndex, 0, replacementLine);
      return finalizeTomlText(lines);
    }

    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(`[${targetSectionName}]`, replacementLine);
    return finalizeTomlText(lines);
  }

  const moved = moveCodexBaseUrlIntoCustomTable(normalizedText, normalizedUrl);
  if (moved !== undefined) return moved;

  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const topLevelMatch = findTomlAssignmentInRange(
    lines,
    TOML_BASE_URL_PATTERN,
    0,
    topLevelEndIndex,
  );
  if (topLevelMatch) {
    lines[topLevelMatch.index] = replacementLine;
    return finalizeTomlText(lines);
  }

  const modelProviderIndex = getTopLevelModelProviderLineIndex(lines);
  if (modelProviderIndex !== -1) {
    lines.splice(modelProviderIndex + 1, 0, replacementLine);
    return finalizeTomlText(lines);
  }

  if (lines.length === 0) {
    return `${replacementLine}\n`;
  }

  const insertIndex = topLevelEndIndex;
  lines.splice(insertIndex, 0, replacementLine);
  return finalizeTomlText(lines);
};

// ========== Codex model name utils ==========

const findTopLevelModelLineIndex = (
  lines: string[],
  topLevelEndIndex: number,
): number => {
  for (let index = 0; index < topLevelEndIndex; index += 1) {
    if (
      TOML_MODEL_DOUBLE_QUOTED_PATTERN.test(lines[index]) ||
      TOML_MODEL_SINGLE_QUOTED_PATTERN.test(lines[index])
    ) {
      return index;
    }
  }
  return -1;
};

// 从 Codex 的 TOML 配置文本中提取顶层 model 字段
export const extractCodexModelName = (
  configText: string | undefined | null,
): string | undefined => {
  try {
    const raw = typeof configText === "string" ? configText : "";
    const text = normalizeTomlText(raw);
    if (!text) return undefined;
    const lines = text.split("\n");
    const topLevelEndIndex = getTopLevelEndIndex(lines);
    for (let index = 0; index < topLevelEndIndex; index += 1) {
      const doubleQuoted = lines[index].match(TOML_MODEL_DOUBLE_QUOTED_PATTERN);
      if (doubleQuoted) return unescapeTomlBasicString(doubleQuoted[1]);
      const singleQuoted = lines[index].match(TOML_MODEL_SINGLE_QUOTED_PATTERN);
      if (singleQuoted) return singleQuoted[1];
    }
    return undefined;
  } catch {
    return undefined;
  }
};

// 在 Codex 的 TOML 配置文本中写入或更新 model 字段
// ========== Codex [agents] subagent defaults ==========

// 子代理的默认模型和推理强度（Codex 的 `[agents]` 表）。后端把这两个键当关键字段，随供应商
// 切换；聚合模式下不写行里的（改用聚合设置）。
export type CodexAgentsStringKey =
  | "default_subagent_model"
  | "default_subagent_reasoning_effort";

const CODEX_AGENTS_SECTION = "agents";

const tomlStringAssignmentPatterns = (key: string) => ({
  doubleQuoted: new RegExp(
    `^\\s*${key}\\s*=\\s*"((?:[^"\\\\\\r\\n]|\\\\.)*)"\\s*(?:#.*)?$`,
  ),
  singleQuoted: new RegExp(`^\\s*${key}\\s*=\\s*'([^'\\r\\n]*)'\\s*(?:#.*)?$`),
  anyValue: new RegExp(`^\\s*${key}\\s*=`),
});

export const extractCodexAgentsString = (
  configText: string | undefined | null,
  key: CodexAgentsStringKey,
): string | undefined => {
  const text = normalizeTomlText(
    typeof configText === "string" ? configText : "",
  );
  if (!text) return undefined;
  try {
    const value = (parseToml(text) as Record<string, any>)[
      CODEX_AGENTS_SECTION
    ]?.[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    // 编辑中的 TOML 解析不了时按行在 [agents] 里找。
  }
  const lines = text.split("\n");
  const range = getTomlSectionRange(lines, CODEX_AGENTS_SECTION);
  if (!range) return undefined;
  const patterns = tomlStringAssignmentPatterns(key);
  for (let i = range.bodyStartIndex; i < range.bodyEndIndex; i += 1) {
    const doubleQuoted = lines[i].match(patterns.doubleQuoted);
    if (doubleQuoted) return unescapeTomlBasicString(doubleQuoted[1]);
    const singleQuoted = lines[i].match(patterns.singleQuoted);
    if (singleQuoted) return singleQuoted[1];
  }
  return undefined;
};

// 在 `[agents]` 里写入一个键（valueText 为 undefined 时删除），并删掉 dropKeys 里的同义写法；
// 删完表里没别的就连表头一起删。用户把 agents 写成行内表或点号键时按行改不了：改完解析失败
// 就原样返回。
const writeCodexAgentsLine = (
  configText: string,
  key: string,
  valueText: string | undefined,
  dropKeys: string[] = [],
): string => {
  const normalizedText = normalizeTomlText(configText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const range = getTomlSectionRange(lines, CODEX_AGENTS_SECTION);
  const replacementLine = `${key} = ${valueText}`;

  if (range) {
    const headerLineIndex = range.bodyStartIndex - 1;
    let bodyEndIndex = range.bodyEndIndex;
    const findLine = (name: string) => {
      const pattern = tomlStringAssignmentPatterns(name).anyValue;
      const stringLines = getTomlMultilineStringLines(lines);
      for (let i = range.bodyStartIndex; i < bodyEndIndex; i += 1) {
        if (!stringLines[i] && pattern.test(lines[i])) return i;
      }
      return -1;
    };
    let removed = false;
    for (const name of valueText === undefined
      ? [key, ...dropKeys]
      : dropKeys) {
      const index = findLine(name);
      if (index === -1) continue;
      lines.splice(index, 1);
      bodyEndIndex -= 1;
      removed = true;
    }
    if (valueText === undefined) {
      if (!removed) return normalizedText;
      const bodyEmpty = lines
        .slice(range.bodyStartIndex, bodyEndIndex)
        .every((line) => line.trim() === "");
      if (bodyEmpty) {
        lines.splice(headerLineIndex, bodyEndIndex - headerLineIndex);
      }
    } else {
      const lineIndex = findLine(key);
      if (lineIndex !== -1) {
        lines[lineIndex] = replacementLine;
      } else {
        lines.splice(
          getTomlSectionInsertIndex(lines, { ...range, bodyEndIndex }),
          0,
          replacementLine,
        );
      }
    }
  } else {
    if (valueText === undefined) return normalizedText;
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(`[${CODEX_AGENTS_SECTION}]`, replacementLine, "");
  }

  const candidate = finalizeTomlText(lines);
  try {
    parseToml(normalizedText);
  } catch {
    return candidate;
  }
  try {
    parseToml(candidate);
    return candidate;
  } catch {
    return normalizedText;
  }
};

// 写入或删除 `[agents]` 里的一个字符串键；空值删除。
export const setCodexAgentsString = (
  configText: string,
  key: CodexAgentsStringKey,
  value: string,
): string => {
  const trimmed = value.trim();
  return writeCodexAgentsLine(
    configText,
    key,
    trimmed ? tomlBasicString(trimmed) : undefined,
  );
};

// ========== Codex [agents] sub-agent concurrency limit ==========

// 子代理并发上限（不含主线程）。Codex 的全局设置，不随供应商切换。codex-rs 0.150 起改名
// max_concurrent_threads_per_session，旧名 max_threads 留作别名：新写入用旧名（各版本都认），
// 已经写了新名就改新名。两种写法同时出现 Codex 报重复字段，所以只留一个（上游 a9e607c3）。
const CODEX_AGENTS_MAX_THREADS_KEY = "max_threads";
const CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY =
  "max_concurrent_threads_per_session";

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;

export const extractCodexAgentsMaxThreads = (
  configText: string | undefined | null,
): number | undefined => {
  const text = normalizeTomlText(
    typeof configText === "string" ? configText : "",
  );
  if (!text) return undefined;
  try {
    const agents = (parseToml(text) as Record<string, any>)[
      CODEX_AGENTS_SECTION
    ];
    return (
      positiveInteger(agents?.[CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY]) ??
      positiveInteger(agents?.[CODEX_AGENTS_MAX_THREADS_KEY])
    );
  } catch {
    // 编辑中的 TOML 解析不了时按行在 [agents] 里找。
  }
  const lines = text.split("\n");
  const range = getTomlSectionRange(lines, CODEX_AGENTS_SECTION);
  if (!range) return undefined;
  for (const key of [
    CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY,
    CODEX_AGENTS_MAX_THREADS_KEY,
  ]) {
    const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`);
    for (let i = range.bodyStartIndex; i < range.bodyEndIndex; i += 1) {
      const match = lines[i].match(pattern);
      if (match) return positiveInteger(Number(match[1]));
    }
  }
  return undefined;
};

// 写入上限；undefined 删掉两种写法，回到 Codex 默认值。
export const setCodexAgentsMaxThreads = (
  configText: string,
  maxThreads: number | undefined,
): string => {
  const lines = normalizeTomlText(configText).split("\n");
  const range = getTomlSectionRange(lines, CODEX_AGENTS_SECTION);
  const canonicalPattern = tomlStringAssignmentPatterns(
    CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY,
  ).anyValue;
  const hasCanonical =
    !!range &&
    lines
      .slice(range.bodyStartIndex, range.bodyEndIndex)
      .some((line) => canonicalPattern.test(line));
  const [key, other] = hasCanonical
    ? [CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY, CODEX_AGENTS_MAX_THREADS_KEY]
    : [CODEX_AGENTS_MAX_THREADS_KEY, CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY];
  return writeCodexAgentsLine(
    configText,
    key,
    positiveInteger(maxThreads)?.toString(),
    [other],
  );
};

// `[features.multi_agent_v2]` 里含主线程的总数：写了就盖过新版子 agent 工具的上限。
export const extractCodexMultiAgentV2Total = (
  configText: string | undefined | null,
): number | undefined => {
  const text = normalizeTomlText(
    typeof configText === "string" ? configText : "",
  );
  if (!text) return undefined;
  try {
    const v2 = (parseToml(text) as Record<string, any>).features
      ?.multi_agent_v2;
    return typeof v2 === "object" && v2 !== null
      ? positiveInteger(v2[CODEX_AGENTS_MAX_THREADS_CANONICAL_KEY])
      : undefined;
  } catch {
    return undefined;
  }
};

export const setCodexModelName = (
  configText: string,
  modelName: string,
): string => {
  const trimmed = modelName.trim();
  const normalizedText = normalizeTomlText(configText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const modelLineIndex = findTopLevelModelLineIndex(lines, topLevelEndIndex);

  if (!trimmed) {
    if (!normalizedText) return normalizedText;
    if (modelLineIndex !== -1) {
      lines.splice(modelLineIndex, 1);
    }
    return finalizeTomlText(lines);
  }

  const replacementLine = `model = ${tomlBasicString(trimmed)}`;
  if (modelLineIndex !== -1) {
    lines[modelLineIndex] = replacementLine;
    return finalizeTomlText(lines);
  }

  const modelProviderIndex = getTopLevelModelProviderLineIndex(lines);
  if (modelProviderIndex !== -1) {
    lines.splice(modelProviderIndex + 1, 0, replacementLine);
    return finalizeTomlText(lines);
  }

  if (lines.length === 0) {
    return `${replacementLine}\n`;
  }

  lines.splice(topLevelEndIndex, 0, replacementLine);
  return finalizeTomlText(lines);
};

// ========== Codex top-level integer field utils ==========

const tomlTopLevelIntPattern = (field: string) =>
  new RegExp(`^\\s*${field}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`);

const findTopLevelIntMatch = (
  lines: string[],
  fieldName: string,
  topLevelEndIndex: number,
): { index: number; value: number } | undefined => {
  const pattern = tomlTopLevelIntPattern(fieldName);
  for (let i = 0; i < topLevelEndIndex; i += 1) {
    const m = lines[i].match(pattern);
    if (m) {
      return { index: i, value: Number(m[1]) };
    }
  }
  return undefined;
};

// 从 Codex TOML 配置中提取顶级整数字段
export const extractCodexTopLevelInt = (
  configText: string | undefined | null,
  fieldName: string,
): number | undefined => {
  try {
    const raw = typeof configText === "string" ? configText : "";
    const text = normalizeTomlText(raw);
    if (!text) return undefined;
    const lines = text.split("\n");
    return findTopLevelIntMatch(lines, fieldName, getTopLevelEndIndex(lines))
      ?.value;
  } catch {
    return undefined;
  }
};

// 在 Codex TOML 配置中设置或更新顶级整数字段
export const setCodexTopLevelInt = (
  configText: string,
  fieldName: string,
  value: number,
): string => {
  const normalizedText = normalizeTomlText(configText);
  const lines = normalizedText ? normalizedText.split("\n") : [];
  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const existing = findTopLevelIntMatch(lines, fieldName, topLevelEndIndex);
  const replacementLine = `${fieldName} = ${value}`;

  if (existing) {
    lines[existing.index] = replacementLine;
    return finalizeTomlText(lines);
  }

  // 插入位置：顶级区域末尾（section header 之前）
  if (lines.length === 0) {
    return `${replacementLine}\n`;
  }

  lines.splice(topLevelEndIndex, 0, replacementLine);
  return finalizeTomlText(lines);
};

// 从 Codex TOML 配置中移除顶级字段行
export const removeCodexTopLevelField = (
  configText: string,
  fieldName: string,
): string => {
  const normalizedText = normalizeTomlText(configText);
  if (!normalizedText) return normalizedText;
  const lines = normalizedText.split("\n");
  const topLevelEndIndex = getTopLevelEndIndex(lines);
  const existing = findTopLevelIntMatch(lines, fieldName, topLevelEndIndex);
  if (existing) {
    lines.splice(existing.index, 1);
  }
  return finalizeTomlText(lines);
};
