"use client";

import { Download } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { BarList } from "@/components/charts/BarList";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchTrainingCostSummary } from "@/lib/api/metrics";
import { formatCost } from "@/lib/utils";
import type { TrainingCostSummary } from "@/lib/tinybird/queries";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

function exportCsv(rows: TrainingCostSummary[]) {
  const head = ["provider", "training_type", "base_model", "run_count", "total_cost_usd", "avg_cost_per_run", "total_tokens_trained"];
  const body = rows.map((r) => [`"${r.provider}"`, `"${r.training_type}"`, `"${r.base_model}"`, r.run_count, r.total_cost_usd, r.avg_cost_per_run, r.total_tokens_trained].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "training-costs.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function Training() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("training", scope, undefined, fetchTrainingCostSummary);
  const rows = [...(data ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd);

  const totalCost = rows.reduce((s, r) => s + r.total_cost_usd, 0);
  const totalRuns = rows.reduce((s, r) => s + r.run_count, 0);
  const totalTokens = rows.reduce((s, r) => s + r.total_tokens_trained, 0);

  const byModel = new Map<string, number>();
  for (const r of rows) byModel.set(r.base_model || "—", (byModel.get(r.base_model || "—") ?? 0) + r.total_cost_usd);
  const bars = Array.from(byModel.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Training cost"  color="gold"    value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
        <KpiCard label="Runs"           color="sky"     value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(totalRuns)} />
        <KpiCard label="Avg / run"      color="violet"  value={isLoading ? <Skeleton className="h-7 w-16" /> : formatCost(totalRuns > 0 ? totalCost / totalRuns : 0)} />
        <KpiCard label="Tokens trained" color="emerald" value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(totalTokens)} />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="Cost by base model">
            {isLoading ? <Skeleton className="h-40 w-full" /> : bars.length === 0 ? <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">No training runs in this range</div> : <BarList items={bars} valueFormatter={formatCost} />}
          </ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="Training runs" actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(rows)} disabled={rows.length === 0}><Download className="h-3.5 w-3.5" />Export</Button>}>
            {isLoading ? <Skeleton className="h-40 w-full" />
              : rows.length === 0 ? <div className="flex h-[160px] items-center justify-center px-4 text-center text-xs text-muted-foreground">No training or fine-tune runs recorded. Sync fine-tuning jobs from your provider to see costs here.</div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Base model</th>
                        <th className="text-left font-normal">Type</th>
                        <th className="text-left font-normal">Provider</th>
                        <th className="text-right font-normal">Runs</th>
                        <th className="text-right font-normal">Cost</th>
                        <th className="pl-3 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.provider}/${r.base_model}/${r.training_type}/${i}`} className="border-b border-border/60 last:border-0">
                          <td className="py-2 font-medium">{r.base_model || "—"}</td>
                          <td className="capitalize text-muted-foreground">{r.training_type}</td>
                          <td className="capitalize text-muted-foreground">{r.provider}</td>
                          <td className="tabular text-right text-muted-foreground">{r.run_count}</td>
                          <td className="tabular text-right">{formatCost(r.total_cost_usd)}</td>
                          <td className="tabular pl-3 text-right text-muted-foreground">{fmtNum(r.total_tokens_trained)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
