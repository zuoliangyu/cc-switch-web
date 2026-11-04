import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  extractCodexAgentsMaxThreads,
  extractCodexAgentsString,
  extractCodexBaseUrl,
  extractCodexMultiAgentV2Total,
  setCodexAgentsMaxThreads,
  setCodexAgentsString,
  setCodexBaseUrl as setCodexBaseUrlInConfig,
  extractCodexModelName,
  setCodexModelName as setCodexModelNameInConfig,
} from "@/utils/providerConfigUtils";
import { normalizeTomlText } from "@/utils/textNormalization";
import type { CodexCatalogModel } from "@/types";

interface UseCodexConfigStateProps {
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
}

/**
 * 管理 Codex 配置状态
 * Codex 配置包含两部分：auth.json (JSON) 和 config.toml (TOML 字符串)
 */
export function useCodexConfigState({ initialData }: UseCodexConfigStateProps) {
  const [codexAuth, setCodexAuthState] = useState("");
  const [codexConfig, setCodexConfigState] = useState("");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [codexBaseUrl, setCodexBaseUrl] = useState("");
  const [codexModelName, setCodexModelName] = useState("");
  const [codexCatalogModels, setCodexCatalogModels] = useState<
    CodexCatalogModel[]
  >([]);
  // 自动审批（Auto Review）用的模型：`modelCatalog.autoReviewModel`，空串 = 用 Codex 的默认
  const [codexAutoReviewModel, setCodexAutoReviewModel] = useState("");
  const [codexAuthError, setCodexAuthError] = useState("");

  const isUpdatingCodexBaseUrlRef = useRef(false);
  const isUpdatingCodexModelNameRef = useRef(false);

  // 初始化 Codex 配置（编辑模式）
  useEffect(() => {
    if (!initialData) return;

    const config = initialData.settingsConfig;
    if (typeof config === "object" && config !== null) {
      // 设置 auth.json
      const auth = (config as any).auth || {};
      setCodexAuthState(JSON.stringify(auth, null, 2));

      // 设置 config.toml
      const configStr =
        typeof (config as any).config === "string"
          ? (config as any).config
          : "";
      setCodexConfigState(configStr);

      const modelCatalog = (config as any).modelCatalog;
      setCodexAutoReviewModel(
        typeof modelCatalog?.autoReviewModel === "string"
          ? modelCatalog.autoReviewModel.trim()
          : "",
      );
      const rawCatalogModels = Array.isArray(modelCatalog?.models)
        ? modelCatalog.models
        : [];
      setCodexCatalogModels(
        rawCatalogModels
          .map((item: any) => {
            const supportsParallelToolCalls =
              typeof item?.supportsParallelToolCalls === "boolean"
                ? item.supportsParallelToolCalls
                : typeof item?.supports_parallel_tool_calls === "boolean"
                  ? item.supports_parallel_tool_calls
                  : undefined;
            const inputModalities = Array.isArray(item?.inputModalities)
              ? item.inputModalities
              : Array.isArray(item?.input_modalities)
                ? item.input_modalities
                : undefined;
            const baseInstructions =
              typeof item?.baseInstructions === "string"
                ? item.baseInstructions
                : typeof item?.base_instructions === "string"
                  ? item.base_instructions
                  : undefined;
            const reasoningLevels = Array.isArray(item?.reasoningLevels)
              ? item.reasoningLevels
              : Array.isArray(item?.reasoning_levels)
                ? item.reasoning_levels
                : undefined;
            const defaultReasoningLevel =
              typeof item?.defaultReasoningLevel === "string"
                ? item.defaultReasoningLevel
                : typeof item?.default_reasoning_level === "string"
                  ? item.default_reasoning_level
                  : undefined;
            return {
              model: typeof item?.model === "string" ? item.model : "",
              displayName:
                typeof item?.displayName === "string"
                  ? item.displayName
                  : typeof item?.display_name === "string"
                    ? item.display_name
                    : "",
              contextWindow:
                typeof item?.contextWindow === "string" ||
                typeof item?.contextWindow === "number"
                  ? item.contextWindow
                  : typeof item?.context_window === "string" ||
                      typeof item?.context_window === "number"
                    ? item.context_window
                    : "",
              ...(supportsParallelToolCalls !== undefined
                ? { supportsParallelToolCalls }
                : {}),
              ...(inputModalities ? { inputModalities } : {}),
              ...(baseInstructions ? { baseInstructions } : {}),
              ...(reasoningLevels?.length ? { reasoningLevels } : {}),
              ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
            };
          })
          .filter((item: CodexCatalogModel) => item.model.trim()),
      );

      // 提取 Base URL
      const initialBaseUrl = extractCodexBaseUrl(configStr);
      if (initialBaseUrl) {
        setCodexBaseUrl(initialBaseUrl);
      }

      // 提取 Model Name
      const initialModelName = extractCodexModelName(configStr);
      if (initialModelName) {
        setCodexModelName(initialModelName);
      }

      // 提取 API Key
      try {
        if (auth && typeof auth.OPENAI_API_KEY === "string") {
          setCodexApiKey(auth.OPENAI_API_KEY);
        }
      } catch {
        // ignore
      }
    }
  }, [initialData]);

  // 与 TOML 配置保持基础 URL 同步
  useEffect(() => {
    if (isUpdatingCodexBaseUrlRef.current) {
      return;
    }
    const extracted = extractCodexBaseUrl(codexConfig) || "";
    setCodexBaseUrl((prev) => (prev === extracted ? prev : extracted));
  }, [codexConfig]);

  // 与 TOML 配置保持模型名称同步
  useEffect(() => {
    if (isUpdatingCodexModelNameRef.current) {
      return;
    }
    const extracted = extractCodexModelName(codexConfig) || "";
    setCodexModelName((prev) => (prev === extracted ? prev : extracted));
  }, [codexConfig]);

  // 获取 API Key（从 auth JSON）
  const getCodexAuthApiKey = useCallback((authString: string): string => {
    try {
      const auth = JSON.parse(authString || "{}");
      return typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "";
    } catch {
      return "";
    }
  }, []);

  // 从 codexAuth 中提取并同步 API Key
  useEffect(() => {
    const extractedKey = getCodexAuthApiKey(codexAuth);
    if (extractedKey !== codexApiKey) {
      setCodexApiKey(extractedKey);
    }
  }, [codexAuth, codexApiKey]);

  // 验证 Codex Auth JSON
  const validateCodexAuth = useCallback((value: string): string => {
    if (!value.trim()) return "";
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "Auth JSON must be an object";
      }
      return "";
    } catch {
      return "Invalid JSON format";
    }
  }, []);

  // 设置 auth 并验证
  const setCodexAuth = useCallback(
    (value: string) => {
      setCodexAuthState(value);
      setCodexAuthError(validateCodexAuth(value));
    },
    [validateCodexAuth],
  );

  // 设置 config (支持函数更新)
  const setCodexConfig = useCallback(
    (value: string | ((prev: string) => string)) => {
      setCodexConfigState((prev) =>
        typeof value === "function"
          ? (value as (input: string) => string)(prev)
          : value,
      );
    },
    [],
  );

  // 处理 Codex API Key 输入并写回 auth.json
  const handleCodexApiKeyChange = useCallback(
    (key: string) => {
      const trimmed = key.trim();
      setCodexApiKey(trimmed);
      try {
        const auth = JSON.parse(codexAuth || "{}");
        auth.OPENAI_API_KEY = trimmed;
        setCodexAuth(JSON.stringify(auth, null, 2));
      } catch {
        // ignore
      }
    },
    [codexAuth, setCodexAuth],
  );

  // 处理 Codex Base URL 变化
  const handleCodexBaseUrlChange = useCallback(
    (url: string) => {
      const sanitized = url.trim();
      setCodexBaseUrl(sanitized);

      isUpdatingCodexBaseUrlRef.current = true;
      setCodexConfig((prev) => setCodexBaseUrlInConfig(prev, sanitized));
      setTimeout(() => {
        isUpdatingCodexBaseUrlRef.current = false;
      }, 0);
    },
    [setCodexConfig],
  );

  // 处理 Codex Model Name 变化
  const handleCodexModelNameChange = useCallback(
    (modelName: string) => {
      const sanitized = modelName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      setCodexModelName(sanitized);

      isUpdatingCodexModelNameRef.current = true;
      setCodexConfig((prev) => setCodexModelNameInConfig(prev, sanitized));
      setTimeout(() => {
        isUpdatingCodexModelNameRef.current = false;
      }, 0);
    },
    [setCodexConfig],
  );

  // 处理 config 变化（同步 Base URL 和 Model Name）
  const handleCodexConfigChange = useCallback(
    (value: string) => {
      // 归一化中文/全角/弯引号，避免 TOML 解析报错
      const normalized = normalizeTomlText(value);
      setCodexConfig(normalized);

      if (!isUpdatingCodexBaseUrlRef.current) {
        const extracted = extractCodexBaseUrl(normalized) || "";
        if (extracted !== codexBaseUrl) {
          setCodexBaseUrl(extracted);
        }
      }

      if (!isUpdatingCodexModelNameRef.current) {
        const extractedModel = extractCodexModelName(normalized) || "";
        if (extractedModel !== codexModelName) {
          setCodexModelName(extractedModel);
        }
      }
    },
    [setCodexConfig, codexBaseUrl, codexModelName],
  );

  // 子代理的默认模型和推理强度（`[agents]` 表）：直接从 TOML 读，改动实时写回，清空则删键
  const codexSubagentModel = useMemo(
    () => extractCodexAgentsString(codexConfig, "default_subagent_model") || "",
    [codexConfig],
  );
  const codexSubagentReasoningEffort = useMemo(
    () =>
      extractCodexAgentsString(
        codexConfig,
        "default_subagent_reasoning_effort",
      ) || "",
    [codexConfig],
  );

  const handleCodexSubagentModelChange = useCallback(
    (model: string) => {
      const sanitized = model.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      setCodexConfig((prev) =>
        setCodexAgentsString(prev, "default_subagent_model", sanitized),
      );
    },
    [setCodexConfig],
  );

  const handleCodexSubagentReasoningEffortChange = useCallback(
    (effort: string) => {
      setCodexConfig((prev) =>
        setCodexAgentsString(prev, "default_subagent_reasoning_effort", effort),
      );
    },
    [setCodexConfig],
  );

  // 子代理并发上限（`[agents] max_threads`）：Codex 的全局设置，保存时写进 live，不随供应商切换。
  // 只收数字，清空或 0 删键，回到 Codex 默认值
  const codexAgentMaxThreads = useMemo(
    () => extractCodexAgentsMaxThreads(codexConfig)?.toString() ?? "",
    [codexConfig],
  );
  const codexMultiAgentV2Total = useMemo(
    () => extractCodexMultiAgentV2Total(codexConfig),
    [codexConfig],
  );

  const handleCodexAgentMaxThreadsChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, 4);
      setCodexConfig((prev) =>
        setCodexAgentsMaxThreads(prev, digits ? Number(digits) : undefined),
      );
    },
    [setCodexConfig],
  );

  // 重置配置（用于预设切换）
  const resetCodexConfig = useCallback(
    (
      auth: Record<string, unknown>,
      config: string,
      modelCatalogModels: CodexCatalogModel[] = [],
    ) => {
      const authString = JSON.stringify(auth, null, 2);
      setCodexAuth(authString);
      setCodexConfig(config);
      setCodexCatalogModels(modelCatalogModels);
      setCodexAutoReviewModel("");

      const baseUrl = extractCodexBaseUrl(config);
      if (baseUrl) {
        setCodexBaseUrl(baseUrl);
      }

      const modelName = extractCodexModelName(config);
      if (modelName) {
        setCodexModelName(modelName);
      } else {
        setCodexModelName("");
      }

      // 提取 API Key
      try {
        if (auth && typeof auth.OPENAI_API_KEY === "string") {
          setCodexApiKey(auth.OPENAI_API_KEY);
        } else {
          setCodexApiKey("");
        }
      } catch {
        setCodexApiKey("");
      }
    },
    [setCodexAuth, setCodexConfig],
  );

  return {
    codexAuth,
    codexConfig,
    codexApiKey,
    codexBaseUrl,
    codexModelName,
    codexCatalogModels,
    codexAutoReviewModel,
    codexSubagentModel,
    codexSubagentReasoningEffort,
    codexAgentMaxThreads,
    codexMultiAgentV2Total,
    codexAuthError,
    setCodexAuth,
    setCodexConfig,
    setCodexCatalogModels,
    setCodexAutoReviewModel,
    handleCodexApiKeyChange,
    handleCodexBaseUrlChange,
    handleCodexModelNameChange,
    handleCodexSubagentModelChange,
    handleCodexSubagentReasoningEffortChange,
    handleCodexAgentMaxThreadsChange,
    handleCodexConfigChange,
    resetCodexConfig,
    getCodexAuthApiKey,
    validateCodexAuth,
  };
}
