"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TraceWaterfall } from "@/components/observability/TraceWaterfall";
import { PayloadViewer } from "@/components/observability/PayloadViewer";
import { fetchRecentTraces } from "@/lib/api/traces";
import { cn, formatCost } from "@/lib/utils";

const fmtTime = (t: string | null) => (t ? t.slice(5, 16).replace("T", " ") : "—");

/** Recent traces list + inline waterfall. Trace rollups aren't project-tagged, so
 *  this shows recent org traces even in the project tier. */
export function TracesExplorer() {
  const { data, isLoading } = useQuery({ queryKey: ["recent-traces"], queryFn: ({ signal }) => fetchRecentTraces(signal), staleTime: 30_000 });
  const traces = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spanEventId, setSpanEventId] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);

  useEffect(() => { if (!selected && traces.length > 0) setSelected(traces[0]!.trace_id); }, [traces, selected]);

  if (isLoading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (traces.length === 0) {
    return <div className="p-5"><EmptyState icon={Network} title="No traces yet" description="Traces appear when the gateway or SDK emits spans. Open one to see its waterfall." /></div>;
  }

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      <div className="col-span-12 lg:col-span-4">
        <ChartCard title="Recent traces" contentClassName="p-0">
          <div className="dash-scroll max-h-[560px] overflow-y-auto">
            {traces.map((t) => {
              const dur = t.started_at && t.ended_at ? new Date(t.ended_at).getTime() - new Date(t.started_at).getTime() : 0;
              const dot = t.status === "error" ? "hsl(var(--signal))" : t.status === "active" ? "hsl(var(--primary))" : "hsl(var(--positive))";
              return (
                <button key={t.trace_id} onClick={() => setSelected(t.trace_id)}
                  className={cn("flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0", selected === t.trace_id ? "bg-accent" : "hover:bg-muted")}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} /><span className="truncate font-mono text-xs">{t.trace_id.slice(0, 14)}…</span></span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{fmtTime(t.started_at)}{dur > 0 ? ` · ${dur >= 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`}` : ""}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs">{formatCost(t.total_cost_usd ?? 0)}</span>
                </button>
              );
            })}
          </div>
        </ChartCard>
      </div>
      <div className="col-span-12 lg:col-span-8">
        <ChartCard title="Trace waterfall" subtitle={selected ? "click a span to inspect its payload" : "select a trace"}>
          {selected
            ? <TraceWaterfall traceId={selected} onSelectSpan={(s) => { setSpanEventId(s.span_id); setPayloadOpen(true); }} />
            : <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">Select a trace.</div>}
        </ChartCard>
      </div>
      <PayloadViewer eventId={spanEventId} open={payloadOpen} onOpenChange={setPayloadOpen} />
    </div>
  );
}
