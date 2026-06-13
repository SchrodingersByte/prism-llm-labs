import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("dash-card flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className={cn("flex-1 p-4", contentClassName)}>{children}</div>
    </div>
  );
}
