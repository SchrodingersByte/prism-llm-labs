"use client";

import { Download } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { Donut } from "@/components/charts/Donut";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchInfraBreakdown, fetchVectorDb } from "@/lib/api/metrics";
import { seriesColor } from "@/lib/charts/theme";
import { cn, formatCost } from "@/lib/utils";

function infraLabel(category: string): string {
  if (category.startsWith("gpu_inference")) return "GPU";
  const map: Record<string, string> = { llm: "LLM", mcp: "MCP tools", tool: "MCP tools", vector: "Vector DB", vector_db: "Vector DB", training: "Training" };
  return map[category] ?? category;
}

interface VecRow { resource: string; est: number; actual: number | null; ops: Record<string, number> }

function exportCsv(rows: VecRow[]) {
  const head = ["resource", "estimated_usd", "actual_usd"];
  const body = rows.map((r) => [`"${r.resource}"`, r.est, r.actual ?? ""].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "vector-db-costs.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function Infrastructure() {
  const { scope } = useScope();
  const infra = useWidgetData("infra", scope, undefined, fetchInfraBreakdown);
  const vec = useWidgetData("vector-db", scope, undefined, fetchVectorDb);

  // Infra cost by category
  const byLabel = new Map<string, { cost: number; events: number }>();
  for (const r of infra.data ?? []) {
    const k = infraLabel(r.category);
    const cur = byLabel.get(k) ?? { cost: 0, events: 0 };
    cur.cost += r.cost_usd; cur.events += r.events;
    byLabel.set(k, cur);
  }
  const categories = Array.from(byLabel.entries()).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.cost - a.cost);
  const infraTotal = categories.reduce((s, c) => s + c.cost, 0);
  const llmPct = infraTotal > 0 ? ((byLabel.get("LLM")?.cost ?? 0) / infraTotal) * 100 : 0;

  // Vector DB: merge estimated + reconciled by resource
  const reconMap = new Map((vec.data?.reconciled ?? []).map((r) => [r.resource, r]));
  const merged: VecRow[] = (vec.data?.estimated ?? []).map((e) => {
    const r = reconMap.get(e.resource);
    return { resource: e.resource, est: e.estimated_cost_usd, actual: r?.total_actual_usd ?? null, ops: r?.operations ?? {} };
  });
  for (const r of vec.data?.reconciled ?? []) {
    if (!merged.some((m) => m.resource === r.resource)) merged.push({ resource: r.resource, est: 0, actual: r.total_actual_usd, ops: r.operations });
  }
  merged.sort((a, b) => (b.actual ?? b.est) - (a.actual ?? a.est));
  const vectorTotal = merged.reduce((s, m) => s + (m.actual ?? m.est), 0);
  const coverage = merged.length > 0 ? (merged.filter((m) => m.actual != null).length / merged.length) * 100 : 0;

  const loading = infra.isLoading || vec.isLoading;

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total infra cost" color="gold"    value={loading ? <Skeleton className="h-7 w-20" /> : formatCost(infraTotal)} />
        <KpiCard label="LLM share"         color="violet"  value={loading ? <Skeleton className="h-7 w-14" /> : `${Math.round(llmPct)}%`} />
        <KpiCard label="Vector DB cost"    color="sky"     value={loading ? <Skeleton className="h-7 w-20" /> : formatCost(vectorTotal)} />
        <KpiCard label="Reconciled"        color="emerald" value={loading ? <Skeleton className="h-7 w-14" /> : `${Math.round(coverage)}%`} />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="Cost by category" subtitle="LLM · MCP · vector · training · GPU">
            {loading ? <Skeleton className="h-48 w-full" />
              : categories.length === 0 ? <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">No infrastructure costs recorded.</div>
              : <>
                  <Donut data={categories.map((c) => ({ name: c.label, value: c.cost }))} valueFormatter={formatCost} />
                  <div className="mt-3 flex flex-col gap-1.5">
                    {categories.map((c, i) => (
                      <div key={c.label} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: seriesColor(i) }} />{c.label}</span>
                        <span className="tabular text-muted-foreground">{formatCost(c.cost)} · {c.events} events</span>
                      </div>
                    ))}
                  </div>
                </>}
          </ChartCard>
        </div>

        <div className="col-span-12 lg:col-span-7">
          <ChartCard
            title="Vector DB by resource"
            subtitle="estimated vs reconciled actual"
            actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(merged)} disabled={merged.length === 0}><Download className="h-3.5 w-3.5" />Export</Button>}
          >
            {loading ? <Skeleton className="h-48 w-full" />
              : merged.length === 0 ? <div className="flex h-[180px] items-center justify-center px-4 text-center text-xs text-muted-foreground">No vector DB usage — set <code className="mx-1">downstream_resource</code> on tool calls to attribute costs.</div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Resource</th>
                        <th className="text-right font-normal">Estimated</th>
                        <th className="text-right font-normal">Actual</th>
                        <th className="pl-3 text-right font-normal">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merged.map((m) => {
                        const variance = m.actual != null ? m.actual - m.est : null;
                        const ops = Object.entries(m.ops);
                        return (
                          <tr key={m.resource} className="border-b border-border/60 last:border-0">
                            <td className="py-2">
                              <span className="font-mono text-xs">{m.resource}</span>
                              {ops.length > 0 && <span className="ml-2 text-[11px] text-muted-foreground">{ops.map(([k, v]) => `${k} ${formatCost(v)}`).join(" · ")}</span>}
                            </td>
                            <td className="tabular text-right text-muted-foreground">{formatCost(m.est)}</td>
                            <td className="tabular text-right">{m.actual != null ? formatCost(m.actual) : <span className="text-muted-foreground/60">pending</span>}</td>
                            <td className={cn("tabular pl-3 text-right", variance == null ? "text-muted-foreground/60" : variance > 0 ? "signal" : "positive")}>
                              {variance == null ? "—" : `${variance >= 0 ? "+" : "−"}${formatCost(Math.abs(variance))}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
