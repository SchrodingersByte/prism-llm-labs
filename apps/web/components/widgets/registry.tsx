"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, Activity, Cpu, AlertTriangle, Timer } from "lucide-react";
import { KpiCard, type KpiDelta } from "@/components/patterns/KpiCard";
import { ChartCard } from "@/components/patterns/ChartCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarList } from "@/components/charts/BarList";
import { Sparkline } from "@/components/charts/Sparkline";
import { Gauge } from "@/components/charts/Gauge";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { Skeleton } from "@/components/ui/skeleton";
import { useWidgetData } from "@/hooks/useWidgetData";
import {
  fetchOverviewComparison, fetchSpendByModel, fetchTimeseriesDaily,
  fetchSpendByProject, fetchProjects, fetchBudgetStatus, fetchSpendByProvider,
  fetchSpendByFeature, fetchEfficiency, fetchSessionDistribution, fetchProviderHealth,
} from "@/lib/api/metrics";
import { VIZ } from "@/lib/charts/theme";
import { cn, formatCost } from "@/lib/utils";
import type { Scope } from "@/lib/scope";
import type { NavRole } from "@/lib/nav";

export interface WidgetProps { scope: Scope; projectId?: string }
export type WidgetSize = "sm" | "md" | "lg" | "wide" | "third";

export interface WidgetDef {
  id: string;
  title: string;
  description?: string;
  category: "kpi" | "spend" | "efficiency";
  size: WidgetSize;
  roles?: NavRole[];
  Component: React.ComponentType<WidgetProps>;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

function NoData() {
  return <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">No data in this range</div>;
}

/**
 * Period-over-period delta. `mode` sets tone: `cost`/`quality` treat an increase
 * as negative (spend up, errors up = bad); `neutral` shows direction without tone.
 */
function pctDelta(cur: number | undefined, prev: number | undefined, mode: "cost" | "neutral" | "quality"): KpiDelta | undefined {
  if (cur == null || prev == null || !isFinite(prev) || prev === 0) return undefined;
  const change = (cur - prev) / Math.abs(prev);
  const direction: "up" | "down" | "flat" = change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat";
  const tone: "positive" | "negative" | "neutral" =
    direction === "flat" || mode === "neutral" ? "neutral" : direction === "up" ? "negative" : "positive";
  return { value: `${Math.abs(change * 100).toFixed(1)}% vs prev`, direction, tone };
}

// ── KPI widgets — share the "overview-cmp" source so the four dedupe to one pair of requests ──

function SpendKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview-cmp", scope, projectId, fetchOverviewComparison);
  const ts = useWidgetData("timeseries", scope, projectId, fetchTimeseriesDaily);
  const spark = (ts.data ?? []).map((p) => p.cost_usd);
  return <KpiCard label="Total spend" color="gold" icon={DollarSign}
    value={isLoading ? <Skeleton className="h-7 w-24" /> : formatCost(data?.current?.total_cost_usd ?? 0)}
    delta={pctDelta(data?.current?.total_cost_usd, data?.previous?.total_cost_usd, "cost")}
    chart={spark.length > 1 ? <Sparkline data={spark} /> : undefined} />;
}
function RequestsKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview-cmp", scope, projectId, fetchOverviewComparison);
  return <KpiCard label="Requests" color="sky" icon={Activity}
    value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(data?.current?.total_requests ?? 0)}
    delta={pctDelta(data?.current?.total_requests, data?.previous?.total_requests, "neutral")} />;
}
function TokensKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview-cmp", scope, projectId, fetchOverviewComparison);
  const tokens = (c?: { total_input_tokens: number; total_output_tokens: number } | null) =>
    (c?.total_input_tokens ?? 0) + (c?.total_output_tokens ?? 0);
  return <KpiCard label="Tokens" color="violet" icon={Cpu}
    value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(tokens(data?.current))}
    delta={pctDelta(tokens(data?.current), tokens(data?.previous), "neutral")} />;
}
function ErrorRateKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview-cmp", scope, projectId, fetchOverviewComparison);
  return <KpiCard label="Error rate" color="amber" icon={AlertTriangle}
    value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtPct(data?.current?.error_rate ?? 0)}
    delta={pctDelta(data?.current?.error_rate, data?.previous?.error_rate, "quality")} />;
}

// ── Chart widgets ──

function SpendTrend({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("timeseries", scope, projectId, fetchTimeseriesDaily);
  const total = (data ?? []).reduce((s, p) => s + p.cost_usd, 0);
  return (
    <ChartCard title="Spend over time" subtitle="daily · USD" value={isLoading ? undefined : formatCost(total)}>
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : !data || data.length === 0 ? <NoData />
        : <AreaTrend data={data as unknown as Record<string, unknown>[]} xKey="date" yKey="cost_usd" height={180}
            valueFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />}
    </ChartCard>
  );
}

function TopModels({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("models", scope, projectId, fetchSpendByModel);
  const items = (data ?? []).slice(0, 6).map((m) => ({ label: m.model, value: m.total_cost_usd }));
  return (
    <ChartCard title="Top models">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

/**
 * Launchpad — one card per org project (from Supabase, so zero-spend projects like
 * a freshly-created default still appear), enriched with Tinybird spend + a budget
 * bar (project.monthly_budget_usd, else share of the top spender). Click to drill in.
 */
function ProjectLaunchpad({ scope, projectId }: WidgetProps) {
  const projectsQ = useQuery({
    queryKey: ["projects-list"],
    queryFn: ({ signal }) => fetchProjects(signal),
    staleTime: 60_000,
  });
  const spendQ = useWidgetData("projects", scope, projectId, fetchSpendByProject);

  const spendById = new Map((spendQ.data ?? []).map((p) => [p.project_id, p]));
  const merged = (projectsQ.data ?? [])
    .map((p) => {
      const s = spendById.get(p.id);
      return { id: p.id, name: p.name, budget: p.monthly_budget_usd ?? 0, cost: s?.cost_usd ?? 0, requests: s?.requests ?? 0 };
    })
    .sort((a, b) => b.cost - a.cost);
  const items = merged.slice(0, 6);
  const maxCost = Math.max(...items.map((p) => p.cost), 1);

  return (
    <ChartCard title="Projects" actions={<Link href="/dashboard/projects" className="text-xs text-muted-foreground hover:text-foreground">View all</Link>}>
      {projectsQ.isLoading ? <Skeleton className="h-32 w-full" />
        : items.length === 0 ? <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">No projects yet</div>
        : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const hasBudget = p.budget > 0;
              const overBudget = hasBudget && p.cost > p.budget;
              const pct = hasBudget ? Math.min((p.cost / p.budget) * 100, 100) : (p.cost / maxCost) * 100;
              return (
                <Link key={p.id} href={`/dashboard/projects/${p.id}`}
                  className="dash-card block p-3 transition-colors hover:bg-accent">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", overBudget ? "bg-[hsl(var(--signal))]" : "bg-[hsl(var(--positive))]")} />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="tabular mt-1 text-lg font-medium tracking-tight">{formatCost(p.cost)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {fmtNum(p.requests)} req{hasBudget ? ` · ${Math.round((p.cost / p.budget) * 100)}% of budget` : ""}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: overBudget ? "hsl(var(--signal))" : "hsl(var(--primary))" }} />
                  </div>
                </Link>
              );
            })}
          </div>}
    </ChartCard>
  );
}

/** Compact ranked bar list of spend by project — optional palette alternative to the launchpad. */
function SpendByProjectWidget({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("projects", scope, projectId, fetchSpendByProject);
  const items = (data ?? []).slice(0, 6).map((p) => ({ label: p.project_name || p.project_id, value: p.cost_usd }));
  return (
    <ChartCard title="Spend by project">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

// ── Palette widgets (added to canvas via the Customize rail) ──

function SpendByProvider({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("providers", scope, projectId, fetchSpendByProvider);
  const items = (data ?? []).slice(0, 6).map((p) => ({ label: p.provider, value: p.total_cost_usd }));
  return (
    <ChartCard title="Spend by provider">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

function CostByFeature({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("features", scope, projectId, fetchSpendByFeature);
  const items = (data ?? []).slice(0, 6).map((f) => ({ label: f.feature || "untagged", value: f.cost_usd }));
  return (
    <ChartCard title="Cost by feature">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

function EfficiencyTrend({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("efficiency", scope, projectId, fetchEfficiency);
  return (
    <ChartCard title="Efficiency" subtitle="tokens per $">
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : !data || data.length === 0 ? <NoData />
        : <AreaTrend data={data as unknown as Record<string, unknown>[]} xKey="date" yKey="tokens_per_dollar" color={VIZ.emerald} height={180} valueFormatter={fmtNum} />}
    </ChartCard>
  );
}

function SessionsP90({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("session-dist", scope, projectId, fetchSessionDistribution);
  return <KpiCard label="Session cost P90" color="violet" icon={Timer}
    value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(data?.p90_cost_usd ?? 0)} />;
}

function BudgetTracker() {
  const { data: b, isLoading } = useQuery({
    queryKey: ["metrics", "budget-status"],
    queryFn: ({ signal }) => fetchBudgetStatus(signal),
    staleTime: 60_000,
  });
  const tone = !b || b.limit_usd == null ? "var(--primary)"
    : b.budget_status === "over_budget" ? "var(--signal)"
    : b.budget_status === "at_risk" ? "var(--primary)" : "var(--positive)";
  const pct = b && b.limit_usd ? Math.min((b.spend_usd / b.limit_usd) * 100, 100) : 0;
  return (
    <ChartCard title="Budget tracker">
      {isLoading ? <Skeleton className="h-24 w-full" />
        : !b || b.limit_usd == null ? (
          <div className="flex h-[140px] flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            No monthly budget set
            <Link href="/dashboard/finops" className="text-primary hover:underline">Set a budget</Link>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <span className="tabular text-xl font-medium tracking-tight">{formatCost(b.spend_usd)}</span>
              <span className="text-xs text-muted-foreground">of {formatCost(b.limit_usd)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `hsl(${tone})` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              Projected {formatCost(b.projected_month_end)} · {b.days_remaining}d left
            </p>
          </div>
        )}
    </ChartCard>
  );
}

function ProviderHealthWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["metrics", "provider-health"],
    queryFn: ({ signal }) => fetchProviderHealth(signal),
    staleTime: 60_000,
  });
  const rows = data ?? [];
  const dot = (s: string) => s === "ok" ? "hsl(var(--positive))" : s === "warning" ? "hsl(var(--primary))" : "hsl(var(--signal))";
  return (
    <ChartCard title="Provider health">
      {isLoading ? <Skeleton className="h-32 w-full" /> : rows.length === 0 ? <NoData />
        : <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.provider} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 capitalize">
                  <span className="h-2 w-2 rounded-full" style={{ background: dot(r.status) }} />
                  {r.provider}
                </span>
                <span className="tabular text-xs text-muted-foreground">{(r.error_rate * 100).toFixed(1)}% err</span>
              </div>
            ))}
          </div>}
    </ChartCard>
  );
}

function CacheHitGauge({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("efficiency", scope, projectId, fetchEfficiency);
  const series = data ?? [];
  const latest = series[series.length - 1];
  const rate = latest?.cache_hit_rate ?? 0;
  return (
    <ChartCard title="Cache hit rate" subtitle="latest day">
      {isLoading ? <Skeleton className="h-[150px] w-full" />
        : series.length === 0 ? <NoData />
        : <Gauge value={rate} label={`${Math.round(rate * 100)}%`} sublabel={`${fmtNum(latest?.tokens_per_dollar ?? 0)} tokens/$`} />}
    </ChartCard>
  );
}

function TokenScatter({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("timeseries", scope, projectId, fetchTimeseriesDaily);
  const points = (data ?? []).map((p) => ({ requests: p.requests, tokens: p.total_tokens }));
  return (
    <ChartCard title="Tokens vs requests" subtitle="daily">
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : points.length === 0 ? <NoData />
        : <ScatterPlot data={points} xKey="requests" yKey="tokens" height={180} xFormatter={fmtNum} yFormatter={fmtNum} />}
    </ChartCard>
  );
}

// ── Registry ──

export const REGISTRY: WidgetDef[] = [
  { id: "kpi-spend",        title: "Total spend",      category: "kpi",   size: "sm",    Component: SpendKpi },
  { id: "kpi-requests",     title: "Requests",         category: "kpi",   size: "sm",    Component: RequestsKpi },
  { id: "kpi-tokens",       title: "Tokens",           category: "kpi",   size: "sm",    Component: TokensKpi },
  { id: "kpi-errors",       title: "Error rate",       category: "kpi",   size: "sm",    Component: ErrorRateKpi },
  { id: "spend-trend",      title: "Spend over time",  category: "spend", size: "wide",  Component: SpendTrend },
  { id: "top-models",       title: "Top models",       category: "spend", size: "third", Component: TopModels },
  { id: "projects",         title: "Projects",         category: "spend", size: "lg",    Component: ProjectLaunchpad },
  { id: "spend-by-project", title: "Spend by project", category: "spend", size: "md",    Component: SpendByProjectWidget },
  // Palette additions — manager-only routes carry `roles` so devs never see them.
  { id: "sessions-p90",     title: "Session cost P90", description: "P90 cost per session", category: "kpi",        size: "sm", Component: SessionsP90 },
  { id: "efficiency",       title: "Efficiency (tokens/$)", description: "Tokens-per-dollar trend", category: "efficiency", size: "md", Component: EfficiencyTrend },
  { id: "spend-by-provider", title: "Spend by provider", category: "spend", size: "md", roles: ["owner", "administrator"], Component: SpendByProvider },
  { id: "cost-by-feature",  title: "Cost by feature",  category: "spend", size: "md", roles: ["owner", "administrator"], Component: CostByFeature },
  { id: "budget-tracker",   title: "Budget tracker",   category: "spend", size: "md", roles: ["owner", "administrator"], Component: BudgetTracker },
  { id: "provider-health",  title: "Provider health",  category: "efficiency", size: "md", roles: ["owner", "administrator"], Component: ProviderHealthWidget },
  { id: "cache-gauge",      title: "Cache hit rate",   description: "Cache-hit dial", category: "efficiency", size: "md", Component: CacheHitGauge },
  { id: "token-scatter",    title: "Tokens vs requests", description: "Token/requests scatter", category: "efficiency", size: "md", Component: TokenScatter },
];

const BY_ID = new Map(REGISTRY.map((w) => [w.id, w]));
export function getWidget(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_ORG_VIEW = [
  "kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors",
  "spend-trend", "top-models", "cache-gauge", "projects",
];
export const DEFAULT_PROJECT_VIEW = [
  "kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors",
  "spend-trend", "top-models",
];
