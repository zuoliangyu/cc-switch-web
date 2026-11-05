import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/ui/help-tip";

export interface ToggleRowProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** 标题旁的「?」：规则和原理放这里，不占行内位置 */
  help?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({
  icon,
  title,
  description,
  help,
  checked,
  onCheckedChange,
  disabled,
}: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          {icon}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium leading-none">{title}</p>
            {help ? <HelpTip title={title}>{help}</HelpTip> : null}
          </div>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}
