/**
 * 深链接附带的 `config.toml` 白名单（上游 cc-switch deeplink/codex_link.rs、grok_link.rs 的 Web 适配）。
 *
 * 链接是不可信输入。导入的行在切换时由投影写进客户端的 config.toml，所以只收属于这个供应商的
 * 部分；让客户端执行命令、读本机凭据或环境变量的键直接拒绝，不能悄悄换成另一种鉴权方式；
 * `env_key` 丢掉，Key 用链接自己给的（只给了 `env_key` 的链接由调用方拒绝）。
 */
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

type TomlTable = Record<string, unknown>;

const isTable = (value: unknown): value is TomlTable =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const nonEmptyStr = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

/** 整数读成 BigInt、写回时浮点数保留小数点，避免 `1.0` 这类值在往返时变成整数 */
const parseTomlDoc = (text: string, label: string): TomlTable => {
  try {
    return parseToml(text, { integersAsBigInt: true }) as TomlTable;
  } catch (error) {
    throw new Error(
      `${label} config.toml 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const stringifyTomlDoc = (doc: TomlTable): string =>
  stringifyToml(doc, { numbersAsFloat: true });

/** 链接 config 里的 JSON 对象（整份就是 config.toml 的 JSON 写法）转成 TOML 文本 */
const jsonToTomlText = (config: TomlTable, label: string): string => {
  try {
    return stringifyToml(config);
  } catch (error) {
    throw new Error(
      `${label} 配置无效：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** 把 TOML 值写成 TOML 字符串字面量（用于没带 config 时的固定模板） */
export const tomlString = (value: string): string =>
  stringifyToml({ v: value }).replace(/^v = /, "").trimEnd();

// ============ Codex ============

/** 与后端 `live::project::codex::ROUTE_ID` 一致：导入的行一律选路到 `[model_providers.custom]` */
const CODEX_ROUTE_ID = "custom";

/** 顶层的关键字段（后端 `live::project::codex::ROW_TOP_FIELDS`） */
const CODEX_ROW_TOP_FIELDS = [
  "model",
  "review_model",
  "model_reasoning_effort",
  "plan_mode_reasoning_effort",
  "disable_response_storage",
];

/** Codex 的供应商独有字段（后端 `live::floor::CODEX_EXCLUSIVE_TOP`） */
const CODEX_EXCLUSIVE_TOP = [
  "web_search",
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_supports_reasoning_summaries",
  "model_verbosity",
];

/** 嵌在 `[agents]`、`[memories]` 里的模型名（后端 `live::floor::CODEX_FLOOR_NESTED`） */
const CODEX_FLOOR_NESTED: ReadonlyArray<readonly [string, string]> = [
  ["agents", "default_subagent_model"],
  ["agents", "default_subagent_reasoning_effort"],
  ["memories", "extract_model"],
  ["memories", "consolidation_model"],
];

/** 选路表里可以从链接带进来的键（Codex 0.162 的 `ModelProviderInfo`，去掉下面两类） */
const CODEX_TABLE_KEYS = [
  "name",
  "base_url",
  "wire_api",
  "requires_openai_auth",
  "experimental_bearer_token",
  "model_catalog_url",
  "capabilities",
  "query_params",
  "http_headers",
  "request_max_retries",
  "stream_max_retries",
  "stream_idle_timeout_ms",
  "websocket_connect_timeout_ms",
  "supports_websockets",
  "supports_standalone_web_search",
];

/** 让 Codex 执行命令（`auth`）、读本机的云凭据（`aws`、`gateway_oauth`）或环境变量取凭据 */
const CODEX_REJECTED_TABLE_KEYS = [
  "auth",
  "aws",
  "gateway_oauth",
  "env_http_headers",
];

/** 从环境变量取 Key：丢掉，改用链接给的 Key */
const CODEX_ENV_KEY_FIELDS = ["env_key", "env_key_instructions"];

/**
 * 链接 config 参数里的 Codex 配置文本。
 *
 * 两种写法：`{"auth": {...}, "config": "<toml 文本>"}`（和供应商行同形），或者整份就是
 * `config.toml`（`configFormat=toml`，或 JSON 写的同一份内容）。只带 `auth` 的返回 null。
 */
export const codexLinkConfigText = (
  config: TomlTable,
  rawToml?: string,
): string | null => {
  if (typeof config.config === "string") return config.config;
  const keys = Object.keys(config);
  if (keys.length === 0 || "auth" in config || "config" in config) {
    return null;
  }
  return rawToml ?? jsonToTomlText(config, "Codex");
};

/** Codex 取模型目录时带着这个供应商的鉴权，目录地址必须和请求地址同源 */
const checkCatalogOrigin = (catalog: string, endpoint: string) => {
  let sameOrigin = false;
  try {
    const catalogOrigin = new URL(catalog).origin;
    sameOrigin =
      catalogOrigin !== "null" && catalogOrigin === new URL(endpoint).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    throw new Error(
      `model_catalog_url 必须和 endpoint ${endpoint} 同源，当前为 ${catalog}`,
    );
  }
};

export interface CodexLinkConfig {
  /** 选中的表里的地址 */
  baseUrl: () => string | undefined;
  model: () => string | undefined;
  /** 选中的表用 `env_key` 取 Key */
  declaresEnvKey: boolean;
  /** 写成供应商行的 `config`；地址、模型名、Key 用合并后的值（URL 参数已经盖过配置里的） */
  render: (
    displayName: string,
    endpoint: string,
    model: string,
    apiKey: string,
  ) => string;
}

export const parseCodexLinkConfig = (text: string): CodexLinkConfig => {
  const doc = parseTomlDoc(text, "Codex");

  // 链接选中的供应商表：`model_provider` 指向的那张，没写选路时取唯一的一张
  let source: TomlTable | undefined;
  const providers = doc.model_providers;
  if (isTable(providers)) {
    const id = nonEmptyStr(doc.model_provider);
    if (id) {
      source = isTable(providers[id]) ? providers[id] : undefined;
    } else {
      const entries = Object.values(providers);
      if (entries.length === 1 && isTable(entries[0])) source = entries[0];
    }
  }

  let declaresEnvKey = false;
  let table: TomlTable | undefined;
  if (source) {
    const rejected = CODEX_REJECTED_TABLE_KEYS.find((key) => key in source!);
    if (rejected) {
      throw new Error(
        `Codex 配置使用了 ${rejected}，会让 Codex 执行命令或读取本机凭据，不能从链接导入，请手动添加供应商`,
      );
    }
    declaresEnvKey = CODEX_ENV_KEY_FIELDS.some((key) => key in source!);
    table = {};
    for (const key of CODEX_TABLE_KEYS) {
      if (key in source) table[key] = source[key];
    }
  }

  const top: Array<[string, unknown]> = [];
  for (const key of [...CODEX_ROW_TOP_FIELDS, ...CODEX_EXCLUSIVE_TOP]) {
    const value = doc[key];
    if (value !== undefined && !isTable(value)) top.push([key, value]);
  }
  const nested: Array<[readonly [string, string], unknown]> = [];
  for (const segments of CODEX_FLOOR_NESTED) {
    const parent = doc[segments[0]];
    const value = isTable(parent) ? parent[segments[1]] : undefined;
    if (value !== undefined && !isTable(value)) nested.push([segments, value]);
  }

  return {
    baseUrl: () => nonEmptyStr(table?.base_url),
    model: () => nonEmptyStr(top.find(([key]) => key === "model")?.[1]),
    declaresEnvKey,
    render: (displayName, endpoint, model, apiKey) => {
      const out: TomlTable = { model_provider: CODEX_ROUTE_ID, model };
      for (const [key, value] of top) {
        if (key !== "model") out[key] = value;
      }
      for (const [[parent, key], value] of nested) {
        const target = isTable(out[parent]) ? out[parent] : {};
        target[key] = value;
        out[parent] = target;
      }

      const sourceTable = table ?? {};
      const route: TomlTable = {
        name: nonEmptyStr(sourceTable.name) ?? displayName,
        base_url: endpoint,
        wire_api: sourceTable.wire_api ?? "responses",
        requires_openai_auth: sourceTable.requires_openai_auth ?? true,
      };
      for (const [key, value] of Object.entries(sourceTable)) {
        if (key in route) continue;
        // 只留一份 Key：和 auth 里的同值，旧版把行里的 config 写进 live 也不会拿到过期的 Key
        route[key] = key === "experimental_bearer_token" ? apiKey : value;
      }
      const catalog = nonEmptyStr(route.model_catalog_url);
      if (catalog) checkCatalogOrigin(catalog, endpoint);

      out.model_providers = { [CODEX_ROUTE_ID]: route };
      return stringifyTomlDoc(out);
    },
  };
};

// ============ Grok Build ============

/** Grok Build 默认值（同后端 grok_config 的模板默认值） */
export const GROK_DEFAULT_MODEL = "grok-4.5";
export const GROK_DEFAULT_API_BACKEND = "responses";
export const GROK_DEFAULT_CONTEXT_WINDOW = 500000;

/** 可以从链接带进来的键（Grok Build 1.0.50 的模型表，去掉地址、凭据和下面拒绝的） */
const GROK_PROFILE_KEYS = [
  "name",
  "description",
  "notice",
  "model_family",
  "api_backend",
  "auth_scheme",
  "extra_headers",
  "query_params",
  "context_window",
  "context_windows",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "max_request_bytes",
  "auto_compact_threshold_percent",
  "system_prompt_label",
  "use_concise",
  "agent_type",
  "inference_idle_timeout_secs",
  "max_retries",
  "rate_limit_retry_threshold",
  "subagent_rate_limit_max_attempts",
  "hidden",
  "supports_reasoning_effort",
  "reasoning_efforts",
  "supports_backend_search",
  "compaction_at_tokens",
  "show_model_fingerprint",
  "stream_tool_calls",
  "reasoning_summary",
];

/** 运行凭据提供器、读环境变量或本机证书：链接带了就拒绝导入 */
const GROK_REJECTED_PROFILE_KEYS = [
  "auth_provider",
  "env_http_headers",
  "mtls_cert_dir",
];

/**
 * 链接 config 参数里的 Grok Build `config.toml` 文本：`{"config": "<toml 文本>"}`，或者
 * 整份就是 config.toml（`configFormat=toml`，或 JSON 写的同一份内容）。
 */
export const grokLinkConfigText = (
  config: TomlTable,
  rawToml?: string,
): string => {
  if (typeof config.config === "string") return config.config;
  return rawToml ?? jsonToTomlText(config, "Grok Build");
};

export interface GrokLinkProfile {
  /** 表名（`models.default` 指向的名字） */
  name: string;
  model: string | undefined;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  /** 表用 `env_key` 取 Key */
  declaresEnvKey: boolean;
  /** 写成供应商行的 `config`；表里没写显示名、接口类型、窗口时补上和模板一样的默认值 */
  render: (
    displayName: string,
    model: string,
    endpoint: string,
    apiKey: string,
  ) => string;
}

const NO_GROK_TABLE = 'Grok Build 配置里没有可导入的 [model."<名称>"] 表';

/**
 * 一个供应商在 live 里只拥有一张模型表，所以只收 `[models] default` 指向的那张（没写或指不到
 * 时取唯一的一张）。显示名、说明、接口类型、窗口等照搬；地址、Key、模型名用合并后的值。
 */
export const parseGrokLinkProfile = (text: string): GrokLinkProfile => {
  const doc = parseTomlDoc(text, "Grok Build");
  const tables = doc.model;
  if (!isTable(tables)) throw new Error(NO_GROK_TABLE);

  let selected: [string, TomlTable] | undefined;
  const models = doc.models;
  const defaultName = isTable(models) ? nonEmptyStr(models.default) : undefined;
  if (defaultName && isTable(tables[defaultName])) {
    selected = [defaultName, tables[defaultName] as TomlTable];
  } else {
    const candidates = Object.entries(tables).filter(
      (entry): entry is [string, TomlTable] => isTable(entry[1]),
    );
    if (candidates.length === 0) throw new Error(NO_GROK_TABLE);
    if (candidates.length > 1) {
      throw new Error(
        "Grok Build 配置里有多张 [model.*] 表，请用 [models] default 指明要导入的那张",
      );
    }
    selected = candidates[0];
  }

  const [name, source] = selected;
  const rejected = GROK_REJECTED_PROFILE_KEYS.find((key) => key in source);
  if (rejected) {
    throw new Error(
      `Grok Build 配置使用了 ${rejected}，会让 Grok 运行凭据提供器或读取本机凭据，不能从链接导入，请手动添加供应商`,
    );
  }
  const profile: TomlTable = {};
  for (const key of GROK_PROFILE_KEYS) {
    if (key in source) profile[key] = source[key];
  }

  return {
    name,
    model: nonEmptyStr(source.model),
    baseUrl: nonEmptyStr(source.base_url),
    apiKey: nonEmptyStr(source.api_key),
    declaresEnvKey: "env_key" in source,
    render: (displayName, model, endpoint, apiKey) => {
      const table: TomlTable = {
        model,
        base_url: endpoint,
        name: nonEmptyStr(profile.name) ? profile.name : displayName,
        api_key: apiKey,
        api_backend: profile.api_backend ?? GROK_DEFAULT_API_BACKEND,
        context_window:
          profile.context_window ?? BigInt(GROK_DEFAULT_CONTEXT_WINDOW),
      };
      for (const [key, value] of Object.entries(profile)) {
        if (!(key in table)) table[key] = value;
      }
      return stringifyTomlDoc({
        models: { default: name },
        model: { [name]: table },
      });
    },
  };
};
