"use client";

import { TriangleAlert } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchErrorClusters } from "@/lib/api/metrics";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtTime = (t: string) => (t ? t.slice(0, 16).replace("T", " ") : "—");

export default function ErrorsPage() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("error-clusters", scope, undefined, fetchErrorClusters);
  const clusters = [...(data ?? [])].sort((a, b) => b.occurrences - a.occurrences);
  const total = clusters.reduce((s, c) => s + c.occurrences, 0);
  const llm = clusters.filter((c) => c.source === "llm").reduce((s, c) => s + c.occurrences, 0);
  const span = clusters.filter((c) => c.source === "span").reduce((s, c) => s + c.occurrences, 0);
  const max = Math.max(...clusters.map((c) => c.occurrences), 1);

  if (!isLoading && clusters.length === 0) {
    return (
      <div className="p-5">
        <EmptyState icon={TriangleAlert} title="No errors in this range" description="Failing LLM calls (HTTP ≥ 400) and errored spans are clustered here by signature. Nothing's failing right now." />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total errors"   color="coral"  value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(total)} />
        <KpiCard label="Signatures"     color="violet" value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(clusters.length)} />
        <KpiCard label="LLM errors"     color="gold"   value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(llm)} />
        <KpiCard label="Span errors"    color="sky"    value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(span)} />
      </div>

      <ChartCard title="Error clusters" subtitle="grouped by signature, most frequent first">
        {isLoading ? <Skeleton className="h-64 w-full" />
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Signature</th>
                    <th className="text-left font-normal">Source</th>
                    <th className="w-40 text-right font-normal">Occurrences</th>
                    <th className="pl-3 text-left font-normal">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c, i) => (
                    <tr key={`${c.signature}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.signature}</code></td>
                      <td><span className={c.source === "llm" ? "brand-text" : "text-[hsl(var(--viz-sky))]"}>{c.source}</span></td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full" style={{ width: `${(c.occurrences / max) * 100}%`, background: "hsl(var(--signal))" }} />
                          </div>
                          <span className="tabular w-10 text-right">{fmtNum(c.occurrences)}</span>
                        </div>
                      </td>
                      <td className="pl-3 text-muted-foreground">{fmtTime(c.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
