function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * auto mode 的服务端检查只有官方端点支持，经网关时 Claude Code 每个会话都会弹一次需要
 * 确认的提示；设成 "0" 改用 Claude Code 自己的检查，提示不再出现。
 */
export const CLAUDE_AUTO_MODE_SERVER_ENV = "CLAUDE_CODE_AUTO_MODE_SERVER";

/**
 * 新增 Claude 供应商时补上网关默认值：除官方和云服务商（Bedrock、Vertex 直连，服务端
 * 检查随平台上线）外，默认关掉 auto mode 的服务端检查。预设自己写了的以预设为准。
 */
export function withClaudeGatewayDefaults(
  fields: Record<string, unknown>,
  category: string | undefined,
): Record<string, unknown> {
  if (category === "official" || category === "cloud_provider") {
    return fields;
  }
  const env = isRecord(fields.env) ? fields.env : {};
  if (CLAUDE_AUTO_MODE_SERVER_ENV in env) {
    return fields;
  }
  return { ...fields, env: { ...env, [CLAUDE_AUTO_MODE_SERVER_ENV]: "0" } };
}

/** Presets replace provider fields while retaining the live global baseline. */
export function overlayClaudeProviderFields(
  base: Record<string, unknown>,
  fields: Record<string, unknown>,
) {
  const result = { ...base, ...fields };
  if (isRecord(base.env) || isRecord(fields.env)) {
    result.env = {
      ...(isRecord(base.env) ? base.env : {}),
      ...(isRecord(fields.env) ? fields.env : {}),
    };
  }
  return result;
}
