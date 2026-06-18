"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/DataTable";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchSpendByModel, fetchEfficiency, fetchProviderHealth } from "@/lib/api/metrics";
import { VIZ } from "@/lib/charts/theme";
import { cn, formatCost } from "@/lib/utils";
import type { ModelSpend } from "@/lib/tinybird/queries";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

const columns: ColumnDef<ModelSpend>[] = [
  {
    accessorKey: "model", header: "Model",
    cell: ({ row }) => (
      <span><span className="font-medium">{row.original.model}</span><span className="ml-1.5 text-xs text-muted-foreground">{row.original.provider}</span></span>
    ),
  },
  { accessorKey: "total_cost_usd",       header: "Spend",    cell: ({ getValue }) => <span className="tabular">{formatCost(getValue<number>())}</span> },
  { accessorKey: "requests",             header: "Requests", cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
  { accessorKey: "avg_cost_per_request", header: "$/req",    cell: ({ getValue }) => <span className="tabular">${getValue<number>().toFixed(3)}</span> },
  { accessorKey: "cache_hit_rate",       header: "Cache",    cell: ({ getValue }) => { const v = getValue<number>(); return <span className={cn("tabular", v >= 0.3 && "positive")}>{(v * 100).toFixed(0)}%</span>; } },
  { accessorKey: "tokens_per_dollar",    header: "tok/$",    cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
  { accessorKey: "error_rate",           header: "Err",      cell: ({ getValue }) => { const v = getValue<number>(); return <span className={cn("tabular", v > 0.005 && "signal")}>{(v * 100).toFixed(1)}%</span>; } },
  { accessorKey: "avg_latency_ms",       header: "Latency",  cell: ({ getValue }) => <span className="tabular">{fmtMs(getValue<number>())}</span> },
];

function exportCsv(rows: ModelSpend[]) {
  const head = ["model", "provider", "cost_usd", "requests", "input_tokens", "output_tokens", "cached_tokens", "avg_cost_per_request", "cache_hit_rate", "tokens_per_dollar", "error_rate", "avg_latency_ms"];
  const body = rows.map((r) => [
    `"${r.model}"`, `"${r.provider}"`, r.total_cost_usd, r.requests, r.input_tokens, r.output_tokens,
    r.cached_tokens, r.avg_cost_per_request, r.cache_hit_rate, r.tokens_per_dollar, r.error_rate, r.avg_latency_ms,
  ].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "models.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function ModelsOverview() {
  const { scope } = useScope();
  const providerFilter = useSearchParams().get("provider");
  const [q, setQ] = useState("");
  const { data, isLoading } = useWidgetData("models", scope, undefined, fetchSpendByModel);
  const rows = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!providerFilter || r.provider === providerFilter) &&
      (!needle || `${r.model} ${r.provider}`.toLowerCase().includes(needle)),
    );
  }, [rows, providerFilter, q]);

  const totalCost = filtered.reduce((s, r) => s + r.total_cost_usd, 0);
  const totalReq = filtered.reduce((s, r) => s + r.requests, 0) || 1;
  const wAvgCache = filtered.reduce((s, r) => s + r.cache_hit_rate * r.requests, 0) / totalReq;
  const wAvgLatency = filtered.reduce((s, r) => s + r.avg_latency_ms * r.requests, 0) / totalReq;

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Models in use" color="violet" value={isLoading ? <Skeleton className="h-7 w-12" /> : String(filtered.length)} />
        <KpiCard label="Model spend" color="gold" value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
        <KpiCard label="Avg cache hit" color="emerald" value={isLoading ? <Skeleton className="h-7 w-14" /> : `${(wAvgCache * 100).toFixed(0)}%`} />
        <KpiCard label="Avg latency" color="amber" value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtMs(wAvgLatency)} />
      </div>

      <ChartCard
        title="Model performance"
        subtitle="click a column to sort"
        actions={
          <div className="flex items-center gap-2">
            {providerFilter && (
              <Link href="/dashboard/models" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-accent">
                {providerFilter}<X className="h-3 w-3" />
              </Link>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" className="h-8 w-40 pl-7 text-xs" />
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" />Export
            </Button>
          </div>
        }
      >
        {isLoading ? <Skeleton className="h-64 w-full" />
          : <DataTable columns={columns} data={filtered} empty={q || providerFilter ? "No models match this filter." : "No model usage in this range."} />}
      </ChartCard>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8"><EfficiencyTrend /></div>
        <div className="col-span-12 lg:col-span-4"><ProviderHealth /></div>
      </div>
    </div>
  );
}

function EfficiencyTrend() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("efficiency", scope, undefined, fetchEfficiency);
  const series = data ?? [];
  return (
    <ChartCard title="Efficiency" subtitle="tokens per $">
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : series.length === 0 ? <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">No efficiency data in this range</div>
        : <AreaTrend data={series as unknown as Record<string, unknown>[]} xKey="date" yKey="tokens_per_dollar" color={VIZ.emerald} height={180} valueFormatter={fmtNum} />}
    </ChartCard>
  );
}

function ProviderHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ["metrics", "provider-health"],
    queryFn: ({ signal }) => fetchProviderHealth(signal),
    staleTime: 60_000,
  });
  const rows = data ?? [];
  const dot = (s: string) => (s === "ok" ? "hsl(var(--positive))" : s === "warning" ? "hsl(var(--primary))" : "hsl(var(--signal))");
  return (
    <ChartCard title="Provider health">
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : rows.length === 0 ? <div className="flex h-[180px] items-center justify-center px-4 text-center text-xs text-muted-foreground">Live provider health is available to managers.</div>
        : <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.provider} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 capitalize"><span className="h-2 w-2 rounded-full" style={{ background: dot(r.status) }} />{r.provider}</span>
                <span className="tabular text-xs text-muted-foreground">{(r.error_rate * 100).toFixed(1)}% err</span>
              </div>
            ))}
          </div>}
    </ChartCard>
  );
}
