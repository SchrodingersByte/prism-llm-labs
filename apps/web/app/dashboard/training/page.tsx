"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduationCap, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useCanManage } from "@/components/layout/role-context";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { cn, formatCost } from "@/lib/utils";

interface TrainingRun {
  id: string; run_id: string; provider: string; display_name: string | null;
  training_type: string; base_model: string | null; fine_tuned_model: string | null;
  status: string; started_at: string | null; completed_at: string | null;
  cost_usd: number | null; tokens_trained: number | null; epochs: number | null;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtTime = (t: string | null) => (t ? t.slice(0, 16).replace("T", " ") : "—");
const fmtDur = (a: string | null, b: string | null) => {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms <= 0) return "—";
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const STATUS_CLASS: Record<string, string> = {
  completed: "positive", running: "brand-text", pending: "brand-text", failed: "signal", cancelled: "text-muted-foreground",
};

export default function TrainingPage() {
  const canManage = useCanManage();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["training-runs"],
    queryFn: ({ signal }) => apiGet<{ data: TrainingRun[] }>("/api/training-runs", undefined, signal).then((r) => r.data ?? []).catch((e) => {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) return [];
      throw e;
    }),
    staleTime: 60_000,
  });
  const runs = data ?? [];

  const totalCost = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const active = runs.filter((r) => r.status === "running" || r.status === "pending").length;
  const totalTokens = runs.reduce((s, r) => s + (r.tokens_trained ?? 0), 0);

  async function sync() {
    setSyncing(true);
    try {
      const r = await apiPost<{ synced: number }>("/api/training-runs/sync");
      toast.success(`Synced ${r.synced} run${r.synced === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["training-runs"] });
    } catch (e) {
      toast.error("Sync failed", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Training"
        description="Fine-tuning and training run costs, synced from provider training APIs."
        actions={canManage ? (
          <Button size="sm" className="gap-1.5" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />Sync
          </Button>
        ) : undefined}
      />

      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Training cost"  color="gold"    value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
          <KpiCard label="Runs"           color="sky"     value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(runs.length)} />
          <KpiCard label="Active"         color="amber"   value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(active)} />
          <KpiCard label="Tokens trained" color="emerald" value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(totalTokens)} />
        </div>

        <ChartCard title="Training runs">
          {isLoading ? <Skeleton className="h-64 w-full" />
            : runs.length === 0 ? <EmptyState icon={GraduationCap} title="No training runs" description="Fine-tuning and training runs appear here. Connect an OpenAI provider key and hit Sync to pull fine-tuning jobs." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-normal">Run</th>
                      <th className="text-left font-normal">Provider</th>
                      <th className="text-left font-normal">Type</th>
                      <th className="text-left font-normal">Status</th>
                      <th className="text-right font-normal">Cost</th>
                      <th className="text-right font-normal">Tokens</th>
                      <th className="text-left font-normal">Started</th>
                      <th className="pl-3 text-right font-normal">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2">
                          <span className="font-medium">{r.display_name || r.fine_tuned_model || r.base_model || r.run_id}</span>
                          {r.base_model && r.fine_tuned_model && <span className="ml-1.5 text-[11px] text-muted-foreground">{r.base_model} →</span>}
                        </td>
                        <td className="capitalize text-muted-foreground">{r.provider}</td>
                        <td className="capitalize text-muted-foreground">{r.training_type.replace(/_/g, " ")}</td>
                        <td><span className={cn("capitalize", STATUS_CLASS[r.status] ?? "text-muted-foreground")}>{r.status}</span></td>
                        <td className="tabular text-right">{r.cost_usd != null ? formatCost(r.cost_usd) : "—"}</td>
                        <td className="tabular text-right text-muted-foreground">{r.tokens_trained != null ? fmtNum(r.tokens_trained) : "—"}</td>
                        <td className="text-muted-foreground">{fmtTime(r.started_at)}</td>
                        <td className="tabular pl-3 text-right text-muted-foreground">{fmtDur(r.started_at, r.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </ChartCard>
      </div>
    </div>
  );
}
