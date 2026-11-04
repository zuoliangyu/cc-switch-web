import { useTranslation } from "react-i18next";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/ui/help-tip";
import { Zap } from "lucide-react";

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
  showManageButton?: boolean;
  onManageClick?: () => void;
  manageButtonLabel?: string;
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
  showManageButton = true,
  onManageClick,
  manageButtonLabel,
}: EndpointFieldProps) {
  const { t } = useTranslation();

  const defaultManageLabel = t("providerForm.manageAndTest", {
    defaultValue: "管理和测速",
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <FormLabel htmlFor={id}>{label}</FormLabel>
          {help ? (
            <HelpTip title={label}>{help.replace(/^💡\s*/u, "")}</HelpTip>
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
      {hint ? (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <p className="text-xs text-amber-600 dark:text-amber-400">{hint}</p>
        </div>
      ) : null}
    </div>
  );
}
