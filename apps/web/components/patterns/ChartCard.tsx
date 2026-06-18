import { cn } from "@/lib/utils";

export interface ChartCardDelta { value: string; tone?: "positive" | "negative" | "neutral" }

export function ChartCard({
  title,
  subtitle,
  value,
  delta,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  subtitle?: string;
  /** Optional headline metric shown under the title (Portkey "big number above the chart"). */
  value?: React.ReactNode;
  delta?: ChartCardDelta;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const deltaClass = delta?.tone === "positive" ? "positive" : delta?.tone === "negative" ? "signal" : "text-muted-foreground";
  return (
    <div className={cn("dash-card flex flex-col", className)}>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {value !== undefined ? (
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tabular text-xl font-semibold tracking-tight">{value}</span>
              {delta && <span className={cn("text-xs font-medium", deltaClass)}>{delta.value}</span>}
            </div>
          ) : subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className={cn("flex-1 p-4", contentClassName)}>{children}</div>
    </div>
  );
}
