"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, SkipForward } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TraceWaterfall } from "@/components/observability/TraceWaterfall";
import { PayloadViewer } from "@/components/observability/PayloadViewer";
import { useRole } from "@/components/layout/role-context";
import { apiGet, apiPut, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface QueueItem {
  id: string; project_id: string | null; trace_id: string; span_id: string | null;
  session_id: string | null; eval_run_id: string | null; status: string;
  priority: number; reason: string; assignee: string | null; created_at: string;
}

const STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "in_review", label: "In review" },
  { key: "done", label: "Done" },
  { key: "skipped", label: "Skipped" },
] as const;

const PASS = 70;
const fmtTime = (t: string) => t.slice(5, 16).replace("T", " ");

export function AnnotationReviewer() {
  const role = useRole();
  const readOnly = role === "read_only";
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [score, setScore] = useState(80);
  const [comment, setComment] = useState("");
  const [spanEventId, setSpanEventId] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["annotation-queue", status],
    queryFn: ({ signal }) => apiGet<{ items: QueueItem[]; total: number }>("/api/annotations/queue", { status, limit: "100" }, signal),
    staleTime: 30_000,
  });
  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  function reset() { setScore(80); setComment(""); setSelectedId(null); }

  async function act(id: string, action: "submit" | "skip") {
    setSubmitting(true);
    try {
      await apiPut(`/api/annotations/queue/${id}`, action === "submit"
        ? { action, score: score / 100, comment: comment || undefined }
        : { action });
      toast.success(action === "submit" ? "Review submitted" : "Skipped");
      qc.invalidateQueries({ queryKey: ["annotation-queue"] });
      reset();
    } catch (e) {
      toast.error("Action failed", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 w-fit">
        {STATUSES.map((s) => (
          <button key={s.key} onClick={() => { setStatus(s.key); reset(); }}
            className={cn("rounded px-2.5 py-1 text-xs transition-colors", status === s.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Queue */}
        <div className="col-span-12 lg:col-span-4">
          <ChartCard title="Review queue" subtitle={`${data?.total ?? 0} ${status}`} contentClassName="p-0">
            {isLoading ? <div className="p-4"><Skeleton className="h-64 w-full" /></div>
              : items.length === 0 ? <div className="flex h-48 items-center justify-center px-4 text-center text-xs text-muted-foreground">Nothing {status} to review.</div>
              : <div className="dash-scroll max-h-[560px] overflow-y-auto">
                  {items.map((it) => (
                    <button key={it.id} onClick={() => { setSelectedId(it.id); setScore(80); setComment(""); }}
                      className={cn("flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0", selectedId === it.id ? "bg-accent" : "hover:bg-muted")}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">{it.trace_id.slice(0, 14)}…</span>
                        {it.priority > 0 && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">P{it.priority}</span>}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="capitalize text-primary">{it.reason.replace(/_/g, " ")}</span>· {fmtTime(it.created_at)}
                      </span>
                    </button>
                  ))}
                </div>}
          </ChartCard>
        </div>

        {/* Workspace */}
        <div className="col-span-12 space-y-3 lg:col-span-8">
          {!selected ? (
            <ChartCard title="Reviewer">
              <div className="flex h-[300px] items-center justify-center px-4 text-center text-sm text-muted-foreground">Select an item from the queue to review its trace and score it.</div>
            </ChartCard>
          ) : (
            <>
              <ChartCard title="Trace" subtitle="click a span to inspect its payload">
                <TraceWaterfall traceId={selected.trace_id} onSelectSpan={(s) => { setSpanEventId(s.span_id); setPayloadOpen(true); }} />
              </ChartCard>

              <ChartCard title="Your review">
                {readOnly ? (
                  <p className="text-sm text-muted-foreground">Read-only members can view the queue but can&apos;t submit reviews.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Score</span>
                        <span className="flex items-center gap-2">
                          <span className="tabular font-medium">{score}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px]", score >= PASS ? "positive-chip" : "signal-chip")}>{score >= PASS ? "PASS" : "FAIL"}</span>
                        </span>
                      </div>
                      <input type="range" min={0} max={100} step={1} value={score} onChange={(e) => setScore(Number(e.target.value))} className="w-full" />
                    </div>
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional) — what's right or wrong about this response?" rows={3} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="gap-1.5" disabled={submitting} onClick={() => act(selected.id, "submit")}><Check className="h-4 w-4" />Submit review</Button>
                      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={submitting} onClick={() => act(selected.id, "skip")}><SkipForward className="h-4 w-4" />Skip</Button>
                    </div>
                  </div>
                )}
              </ChartCard>
            </>
          )}
        </div>
      </div>

      <PayloadViewer eventId={spanEventId} open={payloadOpen} onOpenChange={setPayloadOpen} />
    </div>
  );
}
