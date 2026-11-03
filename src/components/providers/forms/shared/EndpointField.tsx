import { useTranslation } from "react-i18next";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/ui/help-tip";
import { Link2, Zap } from "lucide-react";

interface EndpointFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** 地址是否必填（Antigravity 只填 Key 时走 Google 默认 API，地址可空） */
  required?: boolean;
  /** 标签旁「?」里的说明 */
  help?: string;
  hint?: string;
  fullUrlHint?: string;
  showManageButton?: boolean;
  onManageClick?: () => void;
  manageButtonLabel?: string;
  showFullUrlToggle?: boolean;
  isFullUrl?: boolean;
  onFullUrlChange?: (value: boolean) => void;
}

export function EndpointField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = true,
  help,
  hint,
  fullUrlHint,
  showManageButton = true,
  onManageClick,
  manageButtonLabel,
  showFullUrlToggle = false,
  isFullUrl = false,
  onFullUrlChange,
}: EndpointFieldProps) {
  const { t } = useTranslation();

  const defaultManageLabel = t("providerForm.manageAndTest", {
    defaultValue: "管理和测速",
  });
  const effectiveHint =
    showFullUrlToggle && isFullUrl
      ? fullUrlHint ??
        t("providerForm.fullUrlHint", {
          defaultValue:
            "💡 请填写完整请求 URL，并且必须开启代理后使用；代理将直接使用此 URL，不拼接路径",
        })
      : hint;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5">
            <FormLabel htmlFor={id}>{label}</FormLabel>
            {help ? (
              <HelpTip title={label}>{help.replace(/^💡\s*/u, "")}</HelpTip>
            ) : null}
          </div>
          {showFullUrlToggle && onFullUrlChange ? (
            <div className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1">
              <Link2
                className={`h-3.5 w-3.5 ${
                  isFullUrl ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isFullUrl ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {t("providerForm.fullUrlLabel", {
                  defaultValue: "完整 URL",
                })}
              </span>
              <Switch
                checked={isFullUrl}
                onCheckedChange={onFullUrlChange}
                aria-label={t("providerForm.fullUrlLabel", {
                  defaultValue: "完整 URL",
                })}
                className="h-5 w-9"
              />
            </div>
          ) : null}
        </div>
        {showManageButton && onManageClick ? (
          <button
            type="button"
            onClick={onManageClick}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            {manageButtonLabel || defaultManageLabel}
          </button>
        ) : null}
      </div>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-required={required}
      />
      {effectiveHint ? (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {effectiveHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}
