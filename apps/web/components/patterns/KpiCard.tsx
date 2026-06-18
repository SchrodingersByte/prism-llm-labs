import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlowColor =
  | "gold" | "coral" | "emerald" | "sky" | "violet" | "amber"
  | "indigo" | "cyan" | "rose"; // back-compat aliases

const RULE: Record<GlowColor, string> = {
  gold:    "card-rule-gold",
  amber:   "card-rule-gold",
  indigo:  "card-rule-gold",    // ← legacy alias
  coral:   "card-rule-coral",
  rose:    "card-rule-coral",   // ← legacy alias
  emerald: "card-rule-emerald",
  sky:     "card-rule-sky",
  cyan:    "card-rule-sky",     // ← legacy alias
  violet:  "card-rule-violet",
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
  color = "gold",
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
  const chipStyle: React.CSSProperties | undefined =
    delta?.tone === "positive" ? { background: "hsl(var(--positive) / 0.12)", color: "hsl(var(--positive-text))" }
    : delta?.tone === "negative" ? { background: "hsl(var(--signal) / 0.12)", color: "hsl(var(--signal-text))" }
    : undefined;

  return (
    <div className={cn("dash-card relative overflow-hidden p-4", RULE[color], className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium", !chipStyle && "bg-muted text-muted-foreground")} style={chipStyle}>
            {delta.direction === "up" ? <ArrowUpRight className="h-3 w-3" /> : delta.direction === "down" ? <ArrowDownRight className="h-3 w-3" /> : null}
            {delta.value}
          </span>
        )}
      </div>
      {chart && <div className="mt-3 h-10 w-full">{chart}</div>}
    </div>
  );
}
