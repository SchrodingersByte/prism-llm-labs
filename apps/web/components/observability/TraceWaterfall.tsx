"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchTraceView } from "@/lib/api/traces";
import { formatCost } from "@/lib/utils";
import type { TraceSpanRow } from "@/lib/traces/service";

const KIND_COLOR: Record<string, string> = {
  llm:       "var(--viz-gold)",
  tool:      "var(--viz-sky)",
  retrieval: "var(--viz-violet)",
  guardrail: "var(--viz-coral)",
  chain:     "var(--viz-emerald)",
};
const kindColor = (k: string) => KIND_COLOR[k] ?? "var(--viz-slate)";
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

/** Time-positioned span waterfall for one trace. Click a span to inspect its payload. */
export function TraceWaterfall({ traceId, onSelectSpan }: { traceId: string; onSelectSpan: (span: TraceSpanRow) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trace", traceId],
    queryFn: ({ signal }) => fetchTraceView(traceId, signal),
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const spans = data?.spans ?? [];
  if (spans.length === 0) return <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">No spans recorded for this trace.</div>;

  const starts = spans.map((s) => new Date(s.timestamp).getTime());
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...spans.map((s) => new Date(s.timestamp).getTime() + s.latency_ms));
  const total = Math.max(maxEnd - minStart, 1);

  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depthOf = (s: TraceSpanRow): number => {
    let d = 0, cur = s; const seen = new Set<string>();
    while (cur.parent_span_id && byId.has(cur.parent_span_id) && !seen.has(cur.parent_span_id)) {
      seen.add(cur.parent_span_id); cur = byId.get(cur.parent_span_id)!; d++; if (d > 8) break;
    }
    return d;
  };

  const ordered = [...spans].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <div className="space-y-0.5">
      {ordered.map((s) => {
        const left = ((new Date(s.timestamp).getTime() - minStart) / total) * 100;
        const width = Math.max((s.latency_ms / total) * 100, 1.5);
        const err = s.status_int >= 400 || s.status_str === "error";
        return (
          <button key={s.span_id} onClick={() => onSelectSpan(s)} className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-accent">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex w-40 shrink-0 items-center gap-1.5 truncate" style={{ paddingLeft: depthOf(s) * 12 }}>
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: kindColor(s.span_kind) }} />
                <span className="truncate">{s.operation || s.span_kind}</span>
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded bg-muted/50">
                <span className="absolute inset-y-0 rounded" style={{ left: `${left}%`, width: `${width}%`, background: err ? "hsl(var(--signal))" : kindColor(s.span_kind) }} />
              </span>
              <span className="tabular w-16 shrink-0 text-right text-muted-foreground">{fmtMs(s.latency_ms)}</span>
              <span className="tabular w-14 shrink-0 text-right text-muted-foreground">{s.cost_usd > 0 ? formatCost(s.cost_usd) : "—"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
