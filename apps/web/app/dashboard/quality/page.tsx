"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchQuality } from "@/lib/api/metrics";
import { VIZ } from "@/lib/charts/theme";
import { cn } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const pct = (v: number) => `${Math.round((v ?? 0) * 100)}%`;
const scoreText = (v: number) => (v >= 0.8 ? "positive" : v >= 0.6 ? "brand-text" : "signal");
const scoreBar = (v: number) => (v >= 0.8 ? "hsl(var(--positive))" : v >= 0.6 ? "hsl(var(--primary))" : "hsl(var(--signal))");

const METRICS = [
  { key: "avg_score", label: "Avg score", color: VIZ.emerald },
  { key: "pass_rate", label: "Pass rate", color: VIZ.gold },
] as const;

export default function QualityPage() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("quality", scope, undefined, fetchQuality);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("avg_score");
  const m = METRICS.find((x) => x.key === metric)!;

  const ts = data?.timeseries ?? [];
  const byModel = [...(data?.by_model ?? [])].sort((a, b) => (b.scores ?? 0) - (a.scores ?? 0));
  const byScorer = [...(data?.by_scorer ?? [])].sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0));
  const latest = data?.latest;

  const noData = !isLoading && ts.length === 0 && byModel.length === 0;

  if (noData) {
    return (
      <div className="p-5">
        <EmptyState icon={ShieldCheck} title="No quality scores yet"
          description="Enable an online-eval config (judge model + scorers) under Quality settings to start scoring sampled responses. Scores will trend here." />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Avg score"   color="emerald" value={isLoading ? <Skeleton className="h-7 w-14" /> : <span className={cn(latest && scoreText(latest.avg_score))}>{latest ? pct(latest.avg_score) : "—"}</span>} />
        <KpiCard label="Pass rate"   color="gold"    value={isLoading ? <Skeleton className="h-7 w-14" /> : latest ? pct(latest.pass_rate) : "—"} />
        <KpiCard label="Scores"      color="sky"     value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(data?.total_scores ?? 0)} />
        <KpiCard label="Scorers"     color="violet"  value={isLoading ? <Skeleton className="h-7 w-12" /> : String(byScorer.length)} />
      </div>

      <ChartCard
        title="Score trend"
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
        {isLoading ? <Skeleton className="h-[240px] w-full" />
          : ts.length === 0 ? <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">No scores in this range</div>
          : <AreaTrend data={ts as unknown as Record<string, unknown>[]} xKey="date" yKey={m.key} color={m.color} height={240} valueFormatter={pct} />}
      </ChartCard>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="By model" subtitle="quality per model">
            {isLoading ? <Skeleton className="h-48 w-full" />
              : byModel.length === 0 ? <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No per-model scores in this range</div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Model</th>
                        <th className="text-right font-normal">Avg score</th>
                        <th className="text-right font-normal">Pass rate</th>
                        <th className="pl-3 text-right font-normal">Scores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((r) => (
                        <tr key={r.model} className="border-b border-border/60 last:border-0">
                          <td className="py-2 font-medium">{r.model}</td>
                          <td className={cn("tabular text-right", scoreText(r.avg_score))}>{pct(r.avg_score)}</td>
                          <td className="tabular text-right text-muted-foreground">{pct(r.pass_rate)}</td>
                          <td className="tabular pl-3 text-right text-muted-foreground">{fmtNum(r.scores ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="By scorer" subtitle="rubric · faithfulness · relevancy · …">
            {isLoading ? <Skeleton className="h-48 w-full" />
              : byScorer.length === 0 ? <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No scorer breakdown in this range</div>
              : <div className="flex flex-col gap-3">
                  {byScorer.map((s) => (
                    <div key={s.scorer_type}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize">{s.scorer_type.replace(/_/g, " ")}</span>
                        <span className={cn("tabular", scoreText(s.avg_score))}>{pct(s.avg_score)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${Math.min((s.avg_score ?? 0) * 100, 100)}%`, background: scoreBar(s.avg_score) }} />
                      </div>
                    </div>
                  ))}
                </div>}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
