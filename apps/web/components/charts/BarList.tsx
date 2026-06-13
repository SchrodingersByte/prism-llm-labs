import { cn } from "@/lib/utils";
import { seriesColor } from "@/lib/charts/theme";

export interface BarListItem {
  label: string;
  value: number;
}

/** Ranked horizontal bar list — dense, server-safe (pure CSS, no chart lib). */
export function BarList({
  items,
  valueFormatter,
  className,
}: {
  items: BarListItem[];
  valueFormatter?: (v: number) => string;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {items.map((it, i) => (
        <div key={it.label} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-foreground">{it.label}</span>
            <span className="tabular shrink-0 text-muted-foreground">
              {valueFormatter ? valueFormatter(it.value) : it.value}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(it.value / max) * 100}%`, background: seriesColor(i) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
