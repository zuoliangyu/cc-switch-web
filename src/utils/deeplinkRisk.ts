export type RiskKind = "envHijack" | "privateEndpoint" | "shellCommand";

const ENV_HIJACK_PATTERNS = [
  /^LD_/i,
  /^DYLD_/i,
  /^NODE_OPTIONS$/i,
  /^NODE_EXTRA_CA_CERTS$/i,
  /^PYTHONPATH$/i,
  /^PYTHONSTARTUP$/i,
  /^RUBYOPT$/i,
  /^PERL5OPT$/i,
  /^JAVA_TOOL_OPTIONS$/i,
  /^BASH_ENV$/i,
  /^ENV$/i,
  /^IFS$/i,
  /^PATH$/i,
  /^HTTPS?_PROXY$/i,
];

const SHELL_INTERPRETERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const isInlineCommandFlag = (arg: string) => {
  const lower = arg.toLowerCase();
  return (
    /^\/[ck]\b/.test(lower) ||
    /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/.test(lower) ||
    lower === "-encodedcommand" ||
    lower === "-e" ||
    lower === "-ec" ||
    /^-[a-z]*c[a-z]*$/.test(lower)
  );
};

/**
 * 取出主机的 IPv4 前两段，兼容 IPv4-mapped、IPv4-compatible、SIIT 与 NAT64 等 IPv6 嵌入形式。
 *
 * `new URL()` 会把 `[::ffff:127.0.0.1]` 归一成 `[::ffff:7f00:1]`，把 `[::127.0.0.1]`
 * 归一成 `[::7f00:1]`，把 `[64:ff9b::127.0.0.1]` 归一成 `[64:ff9b::7f00:1]`，点分形式在这一步
 * 消失。若仅匹配标准点分与 `::ffff:`，`[::169.254.169.254]`、`[::ffff:0:169.254.169.254]`
 * 与 NAT64 前缀均会绕过内网判定。
 */
const extractIpv4Octets = (bare: string): [number, number] | null => {
  const dotted = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return [Number(dotted[1]), Number(dotted[2])];

  // IPv6 嵌入 IPv4 形式（十六进制归一化）：
  // - IPv4-mapped: ::ffff:7f00:1
  // - SIIT IPv4-translated (RFC 6052 / RFC 7915): ::ffff:0:7f00:1
  // - NAT64 well-known / local prefix (RFC 6052 / RFC 8215): 64:ff9b::7f00:1, 64:ff9b:1::7f00:1
  // - IPv4-compatible (RFC 4291): ::7f00:1
  const hexMapped = bare.match(
    /^(?:(?:64:ff9b(?::1)?|)::|::ffff:(?:0:)?)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
  );
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    return [(high >> 8) & 0xff, high & 0xff];
  }

  // 少数实现或原始形式保留点分尾巴：
  // ::ffff:127.0.0.1, ::ffff:0:127.0.0.1, 64:ff9b::127.0.0.1, ::127.0.0.1
  const dottedMapped = bare.match(
    /^(?:(?:64:ff9b(?::1)?|)::|::ffff:(?:0:)?)(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i,
  );
  return dottedMapped
    ? [Number(dottedMapped[1]), Number(dottedMapped[2])]
    : null;
};

export const classifyEndpoint = (rawUrl: unknown): RiskKind | null => {
  if (typeof rawUrl !== "string") return null;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    bare === "::1" ||
    bare === "::" ||
    bare === "0.0.0.0"
  ) {
    return "privateEndpoint";
  }

  const octets = extractIpv4Octets(bare);
  if (octets) {
    const [a, b] = octets;
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return "privateEndpoint";
    }
  }

  return /^f[cd][0-9a-f]{2}:/.test(bare) || /^fe[89ab][0-9a-f]:/.test(bare)
    ? "privateEndpoint"
    : null;
};

export const classifyEnvKey = (key: unknown): RiskKind | null =>
  typeof key === "string" &&
  ENV_HIJACK_PATTERNS.some((pattern) => pattern.test(key))
    ? "envHijack"
    : null;

export const classifyCommand = (
  command: unknown,
  args?: unknown,
): RiskKind | null => {
  if (typeof command !== "string" || !command || !Array.isArray(args)) {
    return null;
  }
  const base = command.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return SHELL_INTERPRETERS.has(base) &&
    args.some((arg) => typeof arg === "string" && isInlineCommandFlag(arg))
    ? "shellCommand"
    : null;
};

export const maskValue = (key: string, value: string): string =>
  ["TOKEN", "KEY", "SECRET", "PASSWORD"].some((part) =>
    key.toUpperCase().includes(part),
  ) && value.length > 8
    ? `${value.slice(0, 8)}${"*".repeat(12)}`
    : value;

export const riskI18nKey = (kind: RiskKind) => `deeplink.risk.${kind}`;

export const decodeDeeplinkPayload = (
  encoded: unknown,
  decode: (value: string) => string,
): string => {
  if (typeof encoded !== "string") return "";
  try {
    return decode(encoded) || encoded;
  } catch {
    return encoded;
  }
};
