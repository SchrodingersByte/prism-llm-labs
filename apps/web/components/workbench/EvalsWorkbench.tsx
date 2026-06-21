"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Play, Plus, Loader2, Database } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useRole } from "@/components/layout/role-context";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { cn, formatCost } from "@/lib/utils";

interface Experiment { id: string; name: string | null; status: string; overall_score: number | null; n_samples: number | null; cost_usd: number | null; config_snapshot: { model?: string } | null; created_at: string }
interface Dataset { id: string; name: string; description: string | null; created_at: string; sample_count: number }
interface CompareRow {
  run_id: string; name: string | null; model: string | null; status: string;
  overall_score: number | null; pass_rate: number | null; sample_count: number; cost_usd: number | null;
  scorers: Record<string, { avg_score: number; pass_rate: number; count: number }>;
  is_baseline: boolean; score_delta: number | null; regression: boolean;
}

const SCORERS = ["correctness", "rubric", "faithfulness", "answer_relevancy", "context_precision", "context_recall", "toxicity", "hallucination", "exact_match"] as const;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const fmtTime = (t: string) => t.slice(0, 16).replace("T", " ");
const statusClass = (s: string) => (s === "completed" ? "positive" : s === "error" ? "signal" : "brand-text");

export function EvalsWorkbench() {
  const role = useRole();
  const canWrite = role !== "read_only";
  const qc = useQueryClient();
  const [view, setView] = useState<"experiments" | "datasets">("experiments");
  const [selected, setSelected] = useState<string[]>([]);
  const [runOpen, setRunOpen] = useState(false);
  const [dsOpen, setDsOpen] = useState(false);

  const experiments = useQuery({ queryKey: ["experiments"], queryFn: ({ signal }) => apiGet<{ experiments: Experiment[] }>("/api/evaluations/experiments", undefined, signal).then((r) => r.experiments ?? []), staleTime: 30_000 });
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: ({ signal }) => apiGet<{ datasets: Dataset[] }>("/api/evaluations/datasets", undefined, signal).then((r) => r.datasets ?? []), staleTime: 30_000 });
  const compare = useQuery({
    queryKey: ["compare", selected.join(",")],
    queryFn: ({ signal }) => apiGet<{ compare: CompareRow[] }>("/api/evaluations/scores", { run_ids: selected.join(",") }, signal).then((r) => r.compare ?? []),
    enabled: selected.length >= 2,
    staleTime: 30_000,
  });

  function toggleSel(id: string) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 6 ? [...s, id] : s);
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 w-fit">
          {(["experiments", "datasets"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("rounded px-2.5 py-1 text-xs capitalize transition-colors", view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>{v}</button>
          ))}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDsOpen(true)}><Plus className="h-4 w-4" />New dataset</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setRunOpen(true)}><Play className="h-4 w-4" />Run experiment</Button>
          </div>
        )}
      </div>

      {view === "experiments" ? (
        <>
          {selected.length >= 2 && (
            <ChartCard title="Compare" subtitle="per-scorer deltas vs the baseline run">
              {compare.isLoading ? <Skeleton className="h-40 w-full" />
                : <div className="flex flex-col gap-3 lg:flex-row">
                    {(compare.data ?? []).map((r) => (
                      <div key={r.run_id} className="dash-card min-w-0 flex-1 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{r.model || r.name || r.run_id.slice(0, 8)}</span>
                          {r.is_baseline ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">baseline</span>
                            : r.regression ? <span className="signal-chip shrink-0 rounded px-1.5 py-0.5 text-[10px]">regression</span> : null}
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="tabular text-2xl font-medium">{pct(r.overall_score)}</span>
                          {r.score_delta != null && <span className={cn("tabular text-xs", r.score_delta >= 0 ? "positive" : "signal")}>{r.score_delta >= 0 ? "+" : ""}{Math.round(r.score_delta * 100)}%</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{pct(r.pass_rate)} pass · {r.sample_count} samples · {formatCost(r.cost_usd ?? 0)}</div>
                        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
                          {Object.entries(r.scorers).map(([st, a]) => (
                            <div key={st}>
                              <div className="flex justify-between text-[11px]"><span className="capitalize text-muted-foreground">{st.replace(/_/g, " ")}</span><span className="tabular">{pct(a.avg_score)}</span></div>
                              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(a.avg_score * 100, 100)}%`, background: a.avg_score >= 0.8 ? "hsl(var(--positive))" : a.avg_score >= 0.6 ? "hsl(var(--primary))" : "hsl(var(--signal))" }} /></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>}
            </ChartCard>
          )}

          <ChartCard title="Experiments" subtitle={selected.length > 0 ? `${selected.length} selected — pick ≥2 to compare` : "select runs to compare"}>
            {experiments.isLoading ? <Skeleton className="h-64 w-full" />
              : (experiments.data ?? []).length === 0 ? <EmptyState icon={FlaskConical} title="No experiments yet" description="Run an experiment to score a model+prompt over a dataset. Compare runs here, with per-scorer deltas and a CI regression gate." />
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="w-8"></th>
                        <th className="py-1.5 text-left font-normal">Run</th>
                        <th className="text-left font-normal">Status</th>
                        <th className="text-right font-normal">Score</th>
                        <th className="text-right font-normal">Samples</th>
                        <th className="text-right font-normal">Cost</th>
                        <th className="pl-3 text-left font-normal">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(experiments.data ?? []).map((e) => (
                        <tr key={e.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2"><input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSel(e.id)} /></td>
                          <td className="font-medium">{e.config_snapshot?.model || e.name || e.id.slice(0, 8)}</td>
                          <td><span className={cn("capitalize", statusClass(e.status))}>{e.status}</span></td>
                          <td className="tabular text-right">{pct(e.overall_score)}</td>
                          <td className="tabular text-right text-muted-foreground">{e.n_samples ?? "—"}</td>
                          <td className="tabular text-right text-muted-foreground">{formatCost(e.cost_usd ?? 0)}</td>
                          <td className="pl-3 text-muted-foreground">{fmtTime(e.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </>
      ) : (
        <ChartCard title="Datasets" subtitle="evaluation sample sets">
          {datasets.isLoading ? <Skeleton className="h-48 w-full" />
            : (datasets.data ?? []).length === 0 ? <EmptyState icon={Database} title="No datasets yet" description="Create a dataset of input (and optional expected-output) samples to run experiments against." />
            : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(datasets.data ?? []).map((d) => (
                  <div key={d.id} className="dash-card p-3">
                    <div className="text-sm font-medium">{d.name}</div>
                    {d.description && <div className="mt-0.5 truncate text-xs text-muted-foreground">{d.description}</div>}
                    <div className="mt-2 text-xs text-muted-foreground">{d.sample_count} samples · {fmtTime(d.created_at)}</div>
                  </div>
                ))}
              </div>}
        </ChartCard>
      )}

      <RunExperimentDialog open={runOpen} onOpenChange={setRunOpen} datasets={datasets.data ?? []} onDone={() => qc.invalidateQueries({ queryKey: ["experiments"] })} />
      <NewDatasetDialog open={dsOpen} onOpenChange={setDsOpen} onDone={() => qc.invalidateQueries({ queryKey: ["datasets"] })} />
    </div>
  );
}

function RunExperimentDialog({ open, onOpenChange, datasets, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; datasets: Dataset[]; onDone: () => void }) {
  const [datasetId, setDatasetId] = useState("");
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState("claude-haiku-4-5");
  const [scorers, setScorers] = useState<string[]>(["correctness"]);
  const [threshold, setThreshold] = useState("");
  const [running, setRunning] = useState(false);

  async function run() {
    if (!datasetId) { toast.error("Pick a dataset"); return; }
    if (!model.trim()) { toast.error("Enter a subject model"); return; }
    if (scorers.length === 0) { toast.error("Pick at least one scorer"); return; }
    setRunning(true);
    try {
      const res = await apiPost<{ overall_score: number; passed: boolean; regression: boolean }>("/api/evaluations/experiments", {
        dataset_id: datasetId, subject: { model: model.trim() }, scorers, judge_model: judge.trim() || undefined,
        threshold: threshold ? Number(threshold) / 100 : undefined,
      });
      toast.success(`Run complete — ${Math.round(res.overall_score * 100)}%`, { description: threshold ? (res.passed ? "Gate passed" : "Gate failed") : undefined });
      onOpenChange(false); onDone();
    } catch (e) {
      toast.error("Experiment failed", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setRunning(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Run experiment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm"><span className="text-xs text-muted-foreground">Dataset</span>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">Select a dataset…</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sample_count})</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="text-xs text-muted-foreground">Subject model</span>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" className="mt-1" />
          </label>
          <div>
            <span className="text-xs text-muted-foreground">Scorers</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {SCORERS.map((s) => (
                <button key={s} onClick={() => setScorers((sc) => sc.includes(s) ? sc.filter((x) => x !== s) : [...sc, s])}
                  className={cn("rounded-md border px-2 py-1 text-xs capitalize transition-colors", scorers.includes(s) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <label className="block flex-1 text-sm"><span className="text-xs text-muted-foreground">Judge model</span>
              <Input value={judge} onChange={(e) => setJudge(e.target.value)} className="mt-1" />
            </label>
            <label className="block w-32 text-sm"><span className="text-xs text-muted-foreground">Gate threshold %</span>
              <Input type="number" min="0" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="—" className="mt-1" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Runs synchronously and scores each sample — this can take up to a few minutes.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={run} disabled={running}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDatasetDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [samplesText, setSamplesText] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    const samples = samplesText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [input, expected] = l.split("|").map((s) => s.trim());
      return expected ? { input, expected_output: expected } : { input };
    });
    if (samples.length === 0) { toast.error("Add at least one sample"); return; }
    setSaving(true);
    try {
      await apiPost("/api/evaluations/datasets", { name: name.trim(), description: desc.trim() || undefined, samples });
      toast.success(`Dataset created (${samples.length} samples)`);
      onOpenChange(false); setName(""); setDesc(""); setSamplesText(""); onDone();
    } catch (e) {
      toast.error("Couldn't create dataset", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New dataset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm"><span className="text-xs text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-qa" className="mt-1" />
          </label>
          <label className="block text-sm"><span className="text-xs text-muted-foreground">Description (optional)</span>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm"><span className="text-xs text-muted-foreground">Samples — one per line, optional <code className="text-[11px]">input | expected output</code></span>
            <Textarea value={samplesText} onChange={(e) => setSamplesText(e.target.value)} rows={6} placeholder={"What is 2+2? | 4\nSummarize the refund policy…"} className="mt-1 font-mono text-xs" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={create} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
