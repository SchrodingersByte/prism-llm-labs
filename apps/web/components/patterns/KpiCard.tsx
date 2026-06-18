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
  return (
    <div className={cn("dash-card relative overflow-hidden p-4", RULE[color], className)}>
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
            delta.tone === "positive" ? "positive" : delta.tone === "negative" ? "signal" : "text-muted-foreground",
          )}
        >
          {delta.direction === "up" ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta.direction === "down" ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
          <span>{delta.value}</span>
        </div>
      )}
    </div>
  );
}
