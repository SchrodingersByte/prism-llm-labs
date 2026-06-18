"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchSessionsList, fetchSessionDistribution } from "@/lib/api/metrics";
import { useProject } from "@/components/layout/project-context";
import { formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const fmtTime = (t: string) => t.slice(5, 16).replace("T", " ");

export default function ProjectSessionsPage() {
  const { scope } = useScope();
  const { id } = useProject();
  const list = useWidgetData("sessions-list", scope, id, fetchSessionsList);
  const dist = useWidgetData("session-dist", scope, id, fetchSessionDistribution);
  const rows = list.data ?? [];
  const d = dist.data;

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Sessions" color="sky"   value={dist.isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(d?.session_count ?? 0)} />
        <KpiCard label="P50 cost" color="gold"  value={dist.isLoading ? <Skeleton className="h-7 w-16" /> : formatCost(d?.p50_cost_usd ?? 0)} />
        <KpiCard label="P90 cost" color="amber" value={dist.isLoading ? <Skeleton className="h-7 w-16" /> : formatCost(d?.p90_cost_usd ?? 0)} />
        <KpiCard label="P99 cost" color="coral" value={dist.isLoading ? <Skeleton className="h-7 w-16" /> : formatCost(d?.p99_cost_usd ?? 0)} />
      </div>
      <ChartCard title="Sessions" subtitle="most recent in range">
        {list.isLoading ? <Skeleton className="h-64 w-full" />
          : rows.length === 0 ? <EmptyState icon={Activity} title="No sessions in this range" description="Set a sessionId in the SDK to group this project's multi-step runs." />
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Session</th><th className="text-left font-normal">Started</th><th className="text-right font-normal">Duration</th><th className="text-right font-normal">Calls</th><th className="text-right font-normal">Tools</th><th className="text-right font-normal">Cost</th>
                </tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.session_id} className="border-b border-border/60 last:border-0">
                      <td className="py-2"><Link href={`/dashboard/sessions/${s.session_id}`} className="font-mono text-xs hover:text-primary">{s.session_id.slice(0, 12)}…</Link></td>
                      <td className="text-muted-foreground">{fmtTime(s.started_at)}</td>
                      <td className="tabular text-right text-muted-foreground">{fmtDur(s.duration_seconds)}</td>
                      <td className="tabular text-right">{fmtNum(s.llm_calls)}</td>
                      <td className="tabular text-right text-muted-foreground">{s.distinct_tool_count > 0 ? `${fmtNum(s.calls_with_mcp)} · ${s.distinct_tool_count}` : "—"}</td>
                      <td className="tabular text-right">{formatCost(s.llm_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
