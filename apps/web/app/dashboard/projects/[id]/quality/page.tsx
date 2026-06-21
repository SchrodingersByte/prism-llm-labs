"use client";

import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { useProject } from "@/components/layout/project-context";
import { fetchQuality } from "@/lib/api/metrics";
import { cn } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const scoreText = (v: number) => (v >= 0.8 ? "positive" : v >= 0.6 ? "brand-text" : "signal");

export default function ProjectQualityPage() {
  const project = useProject();
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("quality", scope, project.id, fetchQuality);
  const latest = data?.latest;
  const byModel = [...(data?.by_model ?? [])].sort((a, b) => (b.scores ?? 0) - (a.scores ?? 0));
  const noData = !isLoading && (data?.timeseries.length ?? 0) === 0 && byModel.length === 0;

  return (
    <div>
      <PageHeader title="Quality" description={`Eval scores for ${project.name}.`} />
      <div className="space-y-3 p-5">
        {noData ? (
          <EmptyState icon={ShieldCheck} title="No quality scores" description="Enable an online-eval config to score this project's responses." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Avg score" color="emerald" value={isLoading ? <Skeleton className="h-7 w-14" /> : <span className={cn(latest && scoreText(latest.avg_score))}>{pct(latest?.avg_score)}</span>} />
              <KpiCard label="Pass rate" color="gold"    value={isLoading ? <Skeleton className="h-7 w-14" /> : pct(latest?.pass_rate)} />
              <KpiCard label="Scores"    color="sky"     value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(data?.total_scores ?? 0)} />
              <KpiCard label="Scorers"   color="violet"  value={isLoading ? <Skeleton className="h-7 w-12" /> : String((data?.by_scorer ?? []).length)} />
            </div>
            <ChartCard title="By model">
              {isLoading ? <Skeleton className="h-48 w-full" />
                : byModel.length === 0 ? <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No per-model scores in this range</div>
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Model</th>
                        <th className="text-right font-normal">Avg score</th>
                        <th className="text-right font-normal">Pass rate</th>
                        <th className="pl-3 text-right font-normal">Scores</th>
                      </tr></thead>
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
          </>
        )}
      </div>
    </div>
  );
}
