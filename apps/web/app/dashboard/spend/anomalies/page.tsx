"use client";

import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/patterns/KpiCard";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchAnomalies } from "@/lib/api/metrics";
import { VIZ, CHART_GRID, axisProps, tooltipContentStyle, tooltipLabelStyle } from "@/lib/charts/theme";
import { formatCost } from "@/lib/utils";

export default function AnomaliesPage() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("anomalies", scope, undefined, fetchAnomalies);
  const rows = data ?? [];

  if (isLoading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (rows.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          icon={AlertTriangle}
          title="No anomalies detected"
          description="Daily spend has stayed within 2× the trailing 7-day average. Spikes will appear here when they happen."
        />
      </div>
    );
  }

  const spikes = rows.filter((r) => r.spike_ratio >= 2);
  const maxSpike = rows.reduce((m, r) => Math.max(m, r.spike_ratio), 0);
  const anomalousSpend = spikes.reduce((s, r) => s + r.daily_cost, 0);
  const byDateDesc = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const chart = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date.slice(5), daily: r.daily_cost, avg: r.rolling_7d_avg, spike: r.spike_ratio >= 2 }));

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Spikes detected" color="coral" value={String(spikes.length)} />
        <KpiCard label="Largest spike" color="amber" value={`${maxSpike.toFixed(1)}×`} />
        <KpiCard label="Anomalous spend" color="gold" value={formatCost(anomalousSpend)} />
      </div>

      <ChartCard title="Daily cost vs 7-day average" subtitle="spikes (≥2× the trailing average) in coral">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="date" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={44} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCost(Number(v))} />
            <Bar dataKey="daily" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {chart.map((c, i) => <Cell key={i} fill={c.spike ? VIZ.coral : VIZ.gold} />)}
            </Bar>
            <Line type="monotone" dataKey="avg" stroke={VIZ.slate} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="All anomalies">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-normal">Date</th>
                <th className="text-right font-normal">Daily cost</th>
                <th className="text-right font-normal">7-day avg</th>
                <th className="text-right font-normal">Ratio</th>
                <th className="pl-3 text-right font-normal">Severity</th>
              </tr>
            </thead>
            <tbody>
              {byDateDesc.map((a, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{a.date.slice(0, 10)}</td>
                  <td className="tabular text-right">{formatCost(a.daily_cost)}</td>
                  <td className="tabular text-right text-muted-foreground">{formatCost(a.rolling_7d_avg)}</td>
                  <td className="tabular text-right">{a.spike_ratio.toFixed(2)}×</td>
                  <td className="pl-3 text-right">
                    <span className={a.spike_ratio >= 2 ? "signal" : "brand-text"}>{a.spike_ratio >= 2 ? "spike" : "watch"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
