import { useMemo } from "react";
import { FolderSearch, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

/** 一个目录输入框：可手填、（桌面端）浏览选择、恢复默认。设置 → 应用配置 / 数据里共用。 */
export interface DirectoryInputProps {
  allowBrowse: boolean;
  label: string;
  description?: string;
  value?: string;
  resolvedValue: string;
  placeholder?: string;
  onChange: (value?: string) => void;
  onBrowse: () => Promise<void>;
  onReset: () => Promise<void>;
}

export function DirectoryInput({
  allowBrowse,
  label,
  description,
  value,
  resolvedValue,
  placeholder,
  onChange,
  onBrowse,
  onReset,
}: DirectoryInputProps) {
  const { t } = useTranslation();
  const displayValue = useMemo(
    () => value ?? resolvedValue ?? "",
    [value, resolvedValue],
  );

  return (
    <div className="space-y-1.5">
      {label || description ? (
        <div className="space-y-1">
          {label ? (
            <p className="text-xs font-medium text-foreground">{label}</p>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          value={displayValue}
          placeholder={placeholder}
          className="text-xs"
          onChange={(event) => onChange(event.target.value)}
        />
        {allowBrowse && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onBrowse}
            title={t("settings.browseDirectory")}
          >
            <FolderSearch className="h-4 w-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onReset}
          title={t("settings.resetDefault")}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
