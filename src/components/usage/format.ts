export function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function fmtInt(
  value: unknown,
  locale?: string,
  fallback: string = "--",
): string {
  const num = parseFiniteNumber(value);
  if (num == null) return fallback;
  return new Intl.NumberFormat(locale).format(Math.trunc(num));
}

export function fmtUsd(
  value: unknown,
  digits: number,
  fallback: string = "--",
): string {
  const num = parseFiniteNumber(value);
  if (num == null) return fallback;
  return `$${num.toFixed(digits)}`;
}

interface OutputTokensPerSecondInput {
  outputTokens: unknown;
  latencyMs: unknown;
  firstTokenMs?: unknown;
  durationMs?: unknown;
}

function getOutputGenerationDurationMs(
  log: OutputTokensPerSecondInput,
): number | null {
  const durationMs = parseFiniteNumber(log.durationMs);
  if (durationMs != null && durationMs > 0) return durationMs;

  const firstTokenMs = parseFiniteNumber(log.firstTokenMs);
  if (firstTokenMs != null) {
    const latencyMs = parseFiniteNumber(log.latencyMs);
    if (latencyMs == null) return null;
    const generationMs = latencyMs - firstTokenMs;
    return generationMs > 0 ? generationMs : null;
  }

  const latencyMs = parseFiniteNumber(log.latencyMs);
  return latencyMs != null && latencyMs > 0 ? latencyMs : null;
}

export function getOutputTokensPerSecond(
  log: OutputTokensPerSecondInput,
): number | null {
  const outputTokens = parseFiniteNumber(log.outputTokens);
  if (outputTokens == null || outputTokens <= 0) return null;

  const durationMs = getOutputGenerationDurationMs(log);
  if (durationMs == null) return null;

  const tps = outputTokens / (durationMs / 1000);
  return Number.isFinite(tps) && tps > 0 ? tps : null;
}

export function formatOutputTokensPerSecond(
  log: OutputTokensPerSecondInput,
): string | null {
  const tps = getOutputTokensPerSecond(log);
  if (tps == null) return null;
  return tps >= 1 ? Math.round(tps).toString() : tps.toFixed(1);
}

export function getLocaleFromLanguage(language: string): string {
  if (!language) return "en-US";
  if (language.startsWith("zh")) return "zh-CN";
  if (language.startsWith("ja")) return "ja-JP";
  return "en-US";
}
