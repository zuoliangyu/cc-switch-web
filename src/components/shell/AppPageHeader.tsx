import type { ReactNode } from "react";
export function AppPageHeader({
  icon,
  title,
  titleExtra,
  actions,
  leading,
  subtitle,
}: {
  icon?: ReactNode;
  title: ReactNode;
  variant?: string;
  truncateTitle?: boolean;
  leading?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  titleExtra?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <div className="flex items-center gap-2">
        {leading}
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
        {titleExtra}
        {subtitle}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
