import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlowColor = "indigo" | "cyan" | "violet" | "emerald" | "amber" | "rose";

const GLOW: Record<GlowColor, string> = {
  indigo:  "card-glow-indigo",
  cyan:    "card-glow-cyan",
  violet:  "card-glow-violet",
  emerald: "card-glow-emerald",
  amber:   "card-glow-amber",
  rose:    "card-glow-rose",
};

export interface KpiDelta {
  value: string;
  direction: "up" | "down" | "flat";
  tone?: "positive" | "negative" | "neutral";
}

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  color = "indigo",
  chart,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: KpiDelta;
  icon?: LucideIcon;
  color?: GlowColor;
  chart?: React.ReactNode; // optional sparkline slot (caller supplies a client chart)
  className?: string;
}) {
  return (
    <div className={cn("dash-card relative overflow-hidden p-4", GLOW[color], className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/60" />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="tabular text-2xl font-medium tracking-tight">{value}</span>
        {chart && <div className="h-8 w-20 shrink-0">{chart}</div>}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-xs",
            delta.tone === "positive" ? "text-emerald-500" : delta.tone === "negative" ? "text-rose-500" : "text-muted-foreground",
          )}
        >
          {delta.direction === "up" ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta.direction === "down" ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
          <span>{delta.value}</span>
        </div>
      )}
    </div>
  );
}
