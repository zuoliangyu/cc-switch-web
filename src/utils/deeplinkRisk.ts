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

const extractIpv4Octets = (bare: string): [number, number] | null => {
  const dotted = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return [Number(dotted[1]), Number(dotted[2])];

  const mapped = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    return [(high >> 8) & 0xff, high & 0xff];
  }

  const mappedDotted = bare.match(
    /^::ffff:(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/,
  );
  return mappedDotted
    ? [Number(mappedDotted[1]), Number(mappedDotted[2])]
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
