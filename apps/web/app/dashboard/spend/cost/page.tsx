"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchTimeseriesDaily } from "@/lib/api/metrics";
import { VIZ } from "@/lib/charts/theme";
import { cn, formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

const METRICS = [
  { key: "cost_usd",     label: "Cost",     color: VIZ.gold,   fmt: (v: number) => `$${(v / 1000).toFixed(1)}k` },
  { key: "requests",     label: "Requests", color: VIZ.sky,    fmt: fmtNum },
  { key: "total_tokens", label: "Tokens",   color: VIZ.violet, fmt: fmtNum },
] as const;

function exportCsv(rows: { date: string; cost_usd: number; requests: number; total_tokens: number }[]) {
  const head = ["date", "cost_usd", "requests", "total_tokens"];
  const body = rows.map((r) => [r.date, r.cost_usd, r.requests, r.total_tokens].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "spend-by-day.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function CostPage() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("timeseries", scope, undefined, fetchTimeseriesDaily);
  const series = data ?? [];
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("cost_usd");
  const m = METRICS.find((x) => x.key === metric)!;

  const totalCost = series.reduce((s, p) => s + p.cost_usd, 0);
  const totalReq = series.reduce((s, p) => s + p.requests, 0);
  const avgDay = series.length > 0 ? totalCost / series.length : 0;
  const peak = series.reduce((mx, p) => Math.max(mx, p.cost_usd), 0);
  const tableRows = [...series].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total spend"    color="gold"   value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
        <KpiCard label="Avg cost / day" color="violet" value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(avgDay)} />
        <KpiCard label="Peak day"       color="amber"  value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(peak)} />
        <KpiCard label="Requests"       color="sky"    value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(totalReq)} />
      </div>

      <ChartCard
        title="Cost over time"
        subtitle="daily"
        actions={
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {METRICS.map((x) => (
              <button key={x.key} onClick={() => setMetric(x.key)}
                className={cn("rounded px-2 py-1 text-xs transition-colors", metric === x.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {x.label}
              </button>
            ))}
          </div>
        }
      >
        {isLoading ? <Skeleton className="h-[260px] w-full" />
          : series.length === 0 ? <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">No spend in this range</div>
          : <AreaTrend data={series as unknown as Record<string, unknown>[]} xKey="date" yKey={m.key} color={m.color} height={260} valueFormatter={m.fmt} />}
      </ChartCard>

      <ChartCard
        title="Daily breakdown"
        actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(tableRows)} disabled={tableRows.length === 0}><Download className="h-3.5 w-3.5" />Export</Button>}
      >
        {isLoading ? <Skeleton className="h-48 w-full" />
          : tableRows.length === 0 ? <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">No spend in this range</div>
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Date</th>
                    <th className="text-right font-normal">Cost</th>
                    <th className="text-right font-normal">Requests</th>
                    <th className="text-right font-normal">Tokens</th>
                    <th className="pl-3 text-right font-normal">$/req</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.date} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{r.date.slice(0, 10)}</td>
                      <td className="tabular text-right">{formatCost(r.cost_usd)}</td>
                      <td className="tabular text-right text-muted-foreground">{fmtNum(r.requests)}</td>
                      <td className="tabular text-right text-muted-foreground">{fmtNum(r.total_tokens)}</td>
                      <td className="tabular pl-3 text-right">{r.requests > 0 ? `$${(r.cost_usd / r.requests).toFixed(4)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
