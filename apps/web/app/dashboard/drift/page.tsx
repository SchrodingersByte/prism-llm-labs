"use client";

import { useState } from "react";
import { Radar } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchDrift } from "@/lib/api/metrics";
import { VIZ } from "@/lib/charts/theme";
import { cn } from "@/lib/utils";

const METRICS = [
  { key: "psi", label: "PSI", color: VIZ.gold },
  { key: "js", label: "JS divergence", color: VIZ.sky },
  { key: "centroid_cosine", label: "Centroid", color: VIZ.violet },
] as const;

const fmtVal = (v: number | undefined) => (v == null ? "—" : v.toFixed(3));
// PSI/JS convention: <0.1 stable · 0.1–0.2 moderate · >0.2 significant drift
const driftTone = (v: number | undefined) => (v == null ? "text-muted-foreground" : v >= 0.2 ? "signal" : v >= 0.1 ? "brand-text" : "positive");

export default function DriftPage() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("drift", scope, undefined, fetchDrift);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("psi");
  const m = METRICS.find((x) => x.key === metric)!;

  const latest = data?.latest ?? {};
  const clusters = data?.clusters ?? [];
  const series = (data?.metrics ?? [])
    .filter((p) => p.metric === metric)
    .map((p) => ({ date: p.computed_at.slice(0, 10), value: p.value }));

  const noData = !isLoading && (data?.metrics.length ?? 0) === 0 && clusters.length === 0;
  if (noData) {
    return (
      <div>
        <PageHeader title="Drift" description="Distribution drift and topic clusters over time." />
        <div className="p-5"><EmptyState icon={Radar} title="No drift data yet" description="Drift metrics (PSI · JS · centroid) and topic clusters are computed by the drift cron once enough embeddings accumulate." /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Drift" description="Distribution drift (PSI · JS · centroid) and topic clusters." />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="PSI"       color="gold"   value={isLoading ? <Skeleton className="h-7 w-14" /> : <span className={driftTone(latest.psi)}>{fmtVal(latest.psi)}</span>} />
          <KpiCard label="JS"        color="sky"    value={isLoading ? <Skeleton className="h-7 w-14" /> : <span className={driftTone(latest.js)}>{fmtVal(latest.js)}</span>} />
          <KpiCard label="Centroid"  color="violet" value={isLoading ? <Skeleton className="h-7 w-14" /> : fmtVal(latest.centroid_cosine)} />
          <KpiCard label="Clusters"  color="emerald" value={isLoading ? <Skeleton className="h-7 w-12" /> : String(clusters.length)} />
        </div>

        <ChartCard
          title="Drift trend"
          subtitle="lower is more stable"
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
            : series.length === 0 ? <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">No {m.label} data in this range</div>
            : <AreaTrend data={series as unknown as Record<string, unknown>[]} xKey="date" yKey="value" color={m.color} height={240} valueFormatter={(v) => v.toFixed(3)} />}
        </ChartCard>

        <ChartCard title="Topic clusters" subtitle="emerging themes in recent traffic">
          {isLoading ? <Skeleton className="h-40 w-full" />
            : clusters.length === 0 ? <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">No clusters computed yet</div>
            : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {clusters.map((c) => (
                  <div key={c.id} className="dash-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.label || "Unlabeled"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.size}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(c.keywords ?? []).slice(0, 6).map((k) => <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{k}</span>)}
                    </div>
                  </div>
                ))}
              </div>}
        </ChartCard>
      </div>
    </div>
  );
}
