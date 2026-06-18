"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import {
  fetchBudgetStatus, fetchSpendByProvider, fetchInfraBreakdown,
  fetchSpendByCostCenter, fetchEfficiency, fetchAnomalies, fetchVectorDb,
} from "@/lib/api/metrics";
import { VIZ, CHART_GRID, axisProps, tooltipContentStyle, tooltipLabelStyle, seriesColor } from "@/lib/charts/theme";
import { formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

function ViewAll({ href }: { href: string }) {
  return <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">View all</Link>;
}
function PanelEmpty({ msg }: { msg: string }) {
  return <div className="flex h-[140px] items-center justify-center px-4 text-center text-xs text-muted-foreground">{msg}</div>;
}

// Budget status backs both the forecast chart and the stat tiles — one shared query.
function useBudget() {
  return useQuery({
    queryKey: ["metrics", "budget-status"],
    queryFn: ({ signal }) => fetchBudgetStatus(signal),
    staleTime: 60_000,
  });
}

export function BudgetForecast() {
  const { data: b, isLoading } = useBudget();
  const series = (b?.forecast_series ?? []).map((p) => ({ date: p.date.slice(5), value: p.projected_cumulative }));
  const limit = b?.limit_usd ?? null;
  return (
    <ChartCard title="Month to date vs budget" subtitle="cumulative spend, with month-end projection">
      {isLoading ? <Skeleton className="h-[200px] w-full" />
        : series.length === 0 ? <PanelEmpty msg="No spend recorded this month yet." />
        : <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="bud-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VIZ.gold} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={VIZ.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="date" {...axisProps} minTickGap={28} />
              <YAxis {...axisProps} width={44} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCost(Number(v))} />
              {limit ? <ReferenceLine y={limit} stroke={VIZ.coral} strokeDasharray="5 4"
                label={{ value: `Budget ${formatCost(limit)}`, position: "insideTopRight", fill: VIZ.coral, fontSize: 11 }} /> : null}
              <Area type="monotone" dataKey="value" stroke={VIZ.gold} strokeWidth={2} fill="url(#bud-grad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>}
    </ChartCard>
  );
}

export function BudgetStats() {
  const { data: b } = useBudget();
  const over = b?.budget_status === "over_budget" || (b != null && b.limit_usd != null && b.projected_month_end > b.limit_usd);
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      <KpiCard label="MTD spend" color="gold" value={b ? formatCost(b.spend_usd) : "—"} />
      <KpiCard label="Projected" color={over ? "coral" : "emerald"} value={b ? formatCost(b.projected_month_end) : "—"} />
      <KpiCard label="Utilization" color="amber" value={b?.utilization_pct != null ? `${Math.round(b.utilization_pct)}%` : "No cap"} />
      <KpiCard label="Burn / day" color="sky" value={b ? `${formatCost(b.daily_burn_rate)}` : "—"} />
    </div>
  );
}

export function VendorTable() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("providers", scope, undefined, fetchSpendByProvider);
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + r.total_cost_usd, 0) || 1;
  return (
    <ChartCard title="Spend by vendor" actions={<ViewAll href="/dashboard/models" />}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : rows.length === 0 ? <PanelEmpty msg="No vendor spend in this range." />
        : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-normal text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Provider</th>
                  <th className="text-right font-normal">Spend</th>
                  <th className="text-right font-normal">%</th>
                  <th className="text-right font-normal">$/1M</th>
                  <th className="pl-3 text-right font-normal">7d</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r) => {
                  const spark = (r.daily_series ?? []).map(([, c]) => c);
                  return (
                    <tr key={r.provider} className="border-b border-border/60 last:border-0">
                      <td className="py-2">
                        <Link href={`/dashboard/models?provider=${encodeURIComponent(r.provider)}`} className="capitalize hover:text-primary">{r.provider}</Link>
                      </td>
                      <td className="tabular text-right">{formatCost(r.total_cost_usd)}</td>
                      <td className="tabular text-right text-muted-foreground">{Math.round((r.total_cost_usd / total) * 100)}%</td>
                      <td className="tabular text-right text-muted-foreground">${r.cost_per_1m_tokens.toFixed(2)}</td>
                      <td className="pl-3"><div className="ml-auto h-5 w-16">{spark.length > 1 ? <Sparkline data={spark} /> : null}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
    </ChartCard>
  );
}

function infraLabel(category: string): string {
  if (category.startsWith("gpu_inference")) return "GPU";
  const map: Record<string, string> = { llm: "LLM", mcp: "MCP tools", tool: "MCP tools", vector: "Vector DB", vector_db: "Vector DB", training: "Training" };
  return map[category] ?? category;
}

export function InfraBreakdown() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("infra", scope, undefined, fetchInfraBreakdown);
  const byLabel = new Map<string, number>();
  for (const r of data ?? []) byLabel.set(infraLabel(r.category), (byLabel.get(infraLabel(r.category)) ?? 0) + r.cost_usd);
  const items = Array.from(byLabel.entries()).map(([label, cost]) => ({ label, cost })).sort((a, b) => b.cost - a.cost);
  const total = items.reduce((s, i) => s + i.cost, 0);
  return (
    <ChartCard title="Total AI cost" actions={<ViewAll href="/dashboard/spend/infrastructure" />}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : total === 0 ? <PanelEmpty msg="No infrastructure costs recorded." />
        : <div>
            <div className="tabular text-2xl font-medium tracking-tight">{formatCost(total)}</div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
              {items.map((it, i) => <div key={it.label} style={{ width: `${(it.cost / total) * 100}%`, background: seriesColor(i) }} />)}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {items.map((it, i) => (
                <div key={it.label} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: seriesColor(i) }} />{it.label}</span>
                  <span className="tabular text-muted-foreground">{formatCost(it.cost)}</span>
                </div>
              ))}
            </div>
          </div>}
    </ChartCard>
  );
}

export function CostCenters() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("cost-centers", scope, undefined, fetchSpendByCostCenter);
  const rows = (data ?? []).slice(0, 6);
  const max = Math.max(...rows.map((r) => r.cost_usd), 1);
  return (
    <ChartCard title="Cost centers" subtitle="GL chargeback" actions={<ViewAll href="/dashboard/spend/attribution" />}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : rows.length === 0 ? <PanelEmpty msg="No cost centers yet — set a cost_center_code on your projects." />
        : <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.cost_center || "unassigned"}>
                <div className="flex justify-between text-xs">
                  <span className="truncate">{r.cost_center || "Unassigned"}</span>
                  <span className="tabular text-muted-foreground">{formatCost(r.cost_usd)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${(r.cost_usd / max) * 100}%`, background: "hsl(var(--primary))" }} />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{r.project_count} projects · {r.key_count} keys</div>
              </div>
            ))}
          </div>}
    </ChartCard>
  );
}

export function EfficiencyPanel() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("efficiency", scope, undefined, fetchEfficiency);
  const series = data ?? [];
  const latest = series[series.length - 1];
  return (
    <ChartCard title="Efficiency" subtitle="tokens per $" actions={<ViewAll href="/dashboard/models" />}>
      {isLoading ? <Skeleton className="h-[150px] w-full" />
        : series.length === 0 ? <PanelEmpty msg="No efficiency data in this range." />
        : <>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={series as unknown as Record<string, unknown>[]} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="eff-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIZ.emerald} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={VIZ.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={28} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis {...axisProps} width={44} tickFormatter={fmtNum} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => fmtNum(Number(v))} />
                <Area type="monotone" dataKey="tokens_per_dollar" stroke={VIZ.emerald} strokeWidth={2} fill="url(#eff-grad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            {latest && <div className="mt-1 text-xs text-muted-foreground">cache hit {Math.round((latest.cache_hit_rate || 0) * 100)}% · {fmtNum(latest.tokens_per_dollar || 0)} tokens/$</div>}
          </>}
    </ChartCard>
  );
}

export function AnomalyWatchlist() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("anomalies", scope, undefined, fetchAnomalies);
  const rows = (data ?? []).slice(0, 6);
  return (
    <ChartCard title="Anomaly watchlist" actions={<ViewAll href="/dashboard/spend/anomalies" />}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : rows.length === 0 ? <PanelEmpty msg="No spend anomalies detected." />
        : <div className="flex flex-col gap-2.5">
            {rows.map((a, i) => (
              <Link key={i} href="/dashboard/spend/anomalies" className="flex items-center gap-2.5 text-sm hover:text-primary">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.spike_ratio >= 2 ? "hsl(var(--signal))" : "hsl(var(--primary))" }} />
                <span>{a.date.slice(5)} · {a.spike_ratio.toFixed(1)}× {a.spike_ratio >= 2 ? "spike" : "watch"}</span>
                <span className="tabular ml-auto text-muted-foreground">{formatCost(a.daily_cost)}</span>
              </Link>
            ))}
          </div>}
    </ChartCard>
  );
}

export function VectorDbPanel() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("vector-db", scope, undefined, fetchVectorDb);
  const reconByResource = new Map((data?.reconciled ?? []).map((r) => [r.resource, r.total_actual_usd]));
  const merged = (data?.estimated ?? []).map((e) => ({ resource: e.resource, est: e.estimated_cost_usd, actual: reconByResource.get(e.resource) ?? null }));
  for (const r of data?.reconciled ?? []) {
    if (!merged.some((m) => m.resource === r.resource)) merged.push({ resource: r.resource, est: 0, actual: r.total_actual_usd });
  }
  const top = merged.sort((a, b) => (b.actual ?? b.est) - (a.actual ?? a.est)).slice(0, 6);
  return (
    <ChartCard title="Vector DB" subtitle="estimated · actual" actions={<ViewAll href="/dashboard/spend/infrastructure" />}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : top.length === 0 ? <PanelEmpty msg="No vector DB usage — set downstream_resource on tool calls." />
        : <div className="flex flex-col gap-2.5 text-sm">
            {top.map((r) => (
              <div key={r.resource} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{r.resource}</span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatCost(r.est)} · {r.actual != null ? <span className="positive">{formatCost(r.actual)}</span> : <span className="text-muted-foreground/60">pending</span>}
                </span>
              </div>
            ))}
          </div>}
    </ChartCard>
  );
}
