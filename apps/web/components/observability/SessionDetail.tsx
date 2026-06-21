"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TraceWaterfall } from "@/components/observability/TraceWaterfall";
import { PayloadViewer } from "@/components/observability/PayloadViewer";
import { fetchSessionTraces } from "@/lib/api/traces";
import { cn, formatCost } from "@/lib/utils";

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtTime = (t: string | null) => (t ? t.slice(5, 19).replace("T", " ") : "—");
const fmtDurMs = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : fmtMs(ms));

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["session-traces", sessionId],
    queryFn: ({ signal }) => fetchSessionTraces(sessionId, signal),
    staleTime: 30_000,
  });
  const traces = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spanEventId, setSpanEventId] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);

  useEffect(() => { if (!selected && traces.length > 0) setSelected(traces[0]!.trace_id); }, [traces, selected]);

  const totalCost = traces.reduce((s, t) => s + (t.total_cost_usd ?? 0), 0);
  const errors = traces.filter((t) => t.status === "error").length;
  const starts = traces.map((t) => (t.started_at ? new Date(t.started_at).getTime() : null)).filter((x): x is number => x != null);
  const ends = traces.map((t) => (t.ended_at ? new Date(t.ended_at).getTime() : null)).filter((x): x is number => x != null);
  const durationMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;

  return (
    <div>
      <div className="border-b border-border px-5 py-4">
        <Link href="/dashboard/sessions" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Sessions</Link>
        <h1 className="text-lg font-medium">Session <span className="font-mono text-base text-muted-foreground">{sessionId.slice(0, 20)}{sessionId.length > 20 ? "…" : ""}</span></h1>
      </div>

      <div className="space-y-3 p-5">
        {isLoading ? <Skeleton className="h-24 w-full" />
          : traces.length === 0 ? (
            <EmptyState icon={Activity} title="No trace data for this session" description="This session has no recorded traces. Traces appear when the gateway or SDK emits spans for a session_id." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label="Total cost" color="gold"   value={formatCost(totalCost)} />
                <KpiCard label="Calls"      color="sky"    value={String(traces.length)} />
                <KpiCard label="Duration"   color="violet" value={durationMs > 0 ? fmtDurMs(durationMs) : "—"} />
                <KpiCard label="Errors"     color={errors > 0 ? "coral" : "emerald"} value={String(errors)} />
              </div>

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 lg:col-span-4">
                  <ChartCard title="Calls" subtitle={`${traces.length} traces`} contentClassName="p-0">
                    <div className="dash-scroll max-h-[480px] overflow-y-auto">
                      {traces.map((t) => {
                        const dur = t.started_at && t.ended_at ? new Date(t.ended_at).getTime() - new Date(t.started_at).getTime() : 0;
                        const dot = t.status === "error" ? "hsl(var(--signal))" : t.status === "active" ? "hsl(var(--primary))" : "hsl(var(--positive))";
                        return (
                          <button key={t.trace_id} onClick={() => setSelected(t.trace_id)}
                            className={cn("flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0", selected === t.trace_id ? "bg-accent" : "hover:bg-muted")}>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} /><span className="truncate font-mono text-xs">{t.trace_id.slice(0, 14)}…</span></span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{fmtTime(t.started_at)}{dur > 0 ? ` · ${fmtMs(dur)}` : ""}</span>
                            </span>
                            <span className="tabular shrink-0 text-xs">{formatCost(t.total_cost_usd ?? 0)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </ChartCard>
                </div>
                <div className="col-span-12 lg:col-span-8">
                  <ChartCard title="Trace waterfall" subtitle={selected ? "click a span to inspect its payload" : "select a call"}>
                    {selected
                      ? <TraceWaterfall traceId={selected} onSelectSpan={(s) => { setSpanEventId(s.span_id); setPayloadOpen(true); }} />
                      : <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">Select a call to view its spans.</div>}
                  </ChartCard>
                </div>
              </div>
            </>
          )}
      </div>

      <PayloadViewer eventId={spanEventId} open={payloadOpen} onOpenChange={setPayloadOpen} />
    </div>
  );
}
