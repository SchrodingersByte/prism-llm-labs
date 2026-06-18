"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Wallet, Bell, ShieldCheck, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { useCanManage } from "@/components/layout/role-context";
import { fetchAnomalies, fetchOverviewComparison, fetchBudgetStatus, fetchAlerts } from "@/lib/api/metrics";
import { cn, formatCost } from "@/lib/utils";

type Tone = "alarm" | "warn" | "ok" | "neutral";

const TONE: Record<Tone, { rule: string; text: string }> = {
  alarm:   { rule: "card-rule-coral",   text: "signal" },
  warn:    { rule: "card-rule-gold",    text: "brand-text" },
  ok:      { rule: "card-rule-emerald", text: "positive" },
  neutral: { rule: "card-rule",         text: "text-muted-foreground" },
};

function Tile({ href, label, icon: Icon, tone, value, sub, loading }: {
  href: string; label: string; icon: LucideIcon; tone: Tone;
  value: string; sub: string; loading?: boolean;
}) {
  return (
    <Link href={href} className={cn("dash-card block overflow-hidden p-3 transition-colors hover:bg-accent", TONE[tone].rule)}>
      <div className="flex items-center justify-between">
        <span className={cn("text-[10px] font-medium uppercase tracking-wide", TONE[tone].text)}>{label}</span>
        <Icon className={cn("h-3.5 w-3.5", TONE[tone].text)} />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-4 w-28" />
      ) : (
        <>
          <div className="mt-1.5 truncate text-sm font-medium">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </>
      )}
    </Link>
  );
}

/**
 * Command Center triage zone — attention-first status across anomalies, budget,
 * firing alerts, and error rate. Budget is org-manager-only (hidden for developers).
 */
export function TriageRow() {
  const { scope } = useScope();
  const canManage = useCanManage();

  const anomaliesQ = useWidgetData("anomalies", scope, undefined, fetchAnomalies);
  const overviewQ  = useWidgetData("overview-cmp", scope, undefined, fetchOverviewComparison);
  const budgetQ = useQuery({
    queryKey: ["metrics", "budget-status"],
    queryFn: ({ signal }) => fetchBudgetStatus(signal),
    staleTime: 60_000,
    enabled: canManage,
  });
  const alertsQ = useQuery({
    queryKey: ["alerts", "list"],
    queryFn: ({ signal }) => fetchAlerts(signal),
    staleTime: 60_000,
  });

  // Anomaly — latest detected spend spike
  const spike = anomaliesQ.data?.[0];
  const anomalyTone: Tone = spike ? "alarm" : "ok";

  // Error rate — healthy < 1%, watch < 5%, alarm otherwise
  const er = overviewQ.data?.current?.error_rate ?? 0;
  const errTone: Tone = er < 0.01 ? "ok" : er < 0.05 ? "warn" : "alarm";

  // Alerts — "firing" = active rule that fired in the last 24h
  const rules = alertsQ.data ?? [];
  const firing = rules.filter((r) => r.is_active && r.last_fired_at && Date.now() - new Date(r.last_fired_at).getTime() < 86_400_000);
  const activeCount = rules.filter((r) => r.is_active).length;
  const alertTone: Tone = firing.length > 0 ? "alarm" : "ok";

  // Budget — utilization + month-end projection (manager-only)
  const b = budgetQ.data;
  const budgetTone: Tone =
    !b || b.limit_usd == null ? "neutral"
    : b.budget_status === "over_budget" ? "alarm"
    : b.budget_status === "at_risk" ? "warn"
    : "ok";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        href="/dashboard/finops" label="Anomaly" icon={AlertTriangle} tone={anomalyTone}
        loading={anomaliesQ.isLoading}
        value={spike ? `${spike.spike_ratio.toFixed(1)}× spend spike` : "No anomalies"}
        sub={spike ? `${spike.date.slice(5, 10)} · ${formatCost(spike.daily_cost)}` : "within normal range"}
      />

      {canManage && (
        <Tile
          href="/dashboard/finops" label="Budget" icon={Wallet} tone={budgetTone}
          loading={budgetQ.isLoading}
          value={!b || b.limit_usd == null ? "No budget set" : `${Math.round(b.utilization_pct ?? 0)}% of cap`}
          sub={!b || b.limit_usd == null ? "set a monthly cap" : `proj. ${formatCost(b.projected_month_end)} / mo`}
        />
      )}

      <Tile
        href="/dashboard/alerts" label="Alerts" icon={Bell} tone={alertTone}
        loading={alertsQ.isLoading}
        value={firing.length > 0 ? `${firing.length} rule${firing.length > 1 ? "s" : ""} firing` : "All clear"}
        sub={firing.length > 0 ? firing.slice(0, 2).map((r) => r.trigger_type.replace(/_/g, " ")).join(" · ") : `${activeCount} active rule${activeCount === 1 ? "" : "s"}`}
      />

      <Tile
        href="/dashboard/logs" label="Error rate" icon={ShieldCheck} tone={errTone}
        loading={overviewQ.isLoading}
        value={`${(er * 100).toFixed(2)}%`}
        sub={errTone === "ok" ? "within threshold" : errTone === "warn" ? "watch closely" : "above threshold"}
      />
    </div>
  );
}
