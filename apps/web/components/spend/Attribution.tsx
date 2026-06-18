"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { Donut } from "@/components/charts/Donut";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { useCanManage } from "@/components/layout/role-context";
import { fetchSpendByProject, fetchSpendByWorkload, fetchSpendByTeam, fetchSpendByBranch } from "@/lib/api/metrics";
import { cn, formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

interface Row { label: string; cost: number; requests: number; tokens?: number; href?: string }

function exportCsv(rows: Row[]) {
  const head = ["label", "cost_usd", "requests", "tokens"];
  const body = rows.map((r) => [`"${r.label}"`, r.cost, r.requests, r.tokens ?? ""].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "attribution.csv"; a.click();
  URL.revokeObjectURL(url);
}

function AttributionPanel({ rows, isLoading, emptyMsg }: { rows: Row[]; isLoading: boolean; emptyMsg: string }) {
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (rows.length === 0) return <div className="flex h-[200px] items-center justify-center px-4 text-center text-sm text-muted-foreground">{emptyMsg}</div>;

  const total = rows.reduce((s, r) => s + r.cost, 0);
  const sorted = [...rows].sort((a, b) => b.cost - a.cost);
  const donut = sorted.slice(0, 6).map((r) => ({ name: r.label, value: r.cost }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total attributed" color="gold"   value={formatCost(total)} />
        <KpiCard label="Entities"         color="violet" value={String(rows.length)} />
        <KpiCard label="Avg / entity"     color="sky"    value={formatCost(rows.length ? total / rows.length : 0)} />
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="Share of spend"><Donut data={donut} valueFormatter={formatCost} /></ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="Breakdown" actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(sorted)}><Download className="h-3.5 w-3.5" />Export</Button>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Name</th>
                    <th className="text-right font-normal">Cost</th>
                    <th className="text-right font-normal">%</th>
                    <th className="text-right font-normal">Requests</th>
                    <th className="pl-3 text-right font-normal">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.label} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{r.href ? <Link href={r.href} className="hover:text-primary">{r.label}</Link> : r.label}</td>
                      <td className="tabular text-right">{formatCost(r.cost)}</td>
                      <td className="tabular text-right text-muted-foreground">{total > 0 ? Math.round((r.cost / total) * 100) : 0}%</td>
                      <td className="tabular text-right text-muted-foreground">{fmtNum(r.requests)}</td>
                      <td className="tabular pl-3 text-right text-muted-foreground">{r.tokens != null ? fmtNum(r.tokens) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ManagersOnly() {
  return <div className="flex h-[200px] items-center justify-center px-4 text-center text-sm text-muted-foreground">This breakdown is available to organization owners and admins.</div>;
}

function ProjectAttribution() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("projects", scope, undefined, fetchSpendByProject);
  const rows = (data ?? []).map((d): Row => ({ label: d.project_name || d.project_id, cost: d.cost_usd, requests: d.requests, tokens: d.input_tokens + d.output_tokens, href: `/dashboard/projects/${d.project_id}` }));
  return <AttributionPanel rows={rows} isLoading={isLoading} emptyMsg="No project-attributed spend in this range." />;
}

function WorkloadAttribution() {
  const canManage = useCanManage();
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("workload", scope, undefined, fetchSpendByWorkload);
  if (!canManage) return <ManagersOnly />;
  const rows = (data ?? []).map((d): Row => ({ label: d.workload_type || "untagged", cost: d.cost_usd, requests: d.requests, tokens: d.total_tokens }));
  return <AttributionPanel rows={rows} isLoading={isLoading} emptyMsg="No workload-tagged spend — set a workload tag (training / inference / development) on requests." />;
}

function TeamAttribution() {
  const canManage = useCanManage();
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("team", scope, undefined, fetchSpendByTeam);
  if (!canManage) return <ManagersOnly />;
  const byTeam = new Map<string, { cost: number; requests: number }>();
  for (const t of data ?? []) {
    const key = t.team_id || "unassigned";
    const cur = byTeam.get(key) ?? { cost: 0, requests: 0 };
    cur.cost += t.cost_usd; cur.requests += t.requests;
    byTeam.set(key, cur);
  }
  const rows = Array.from(byTeam.entries()).map(([label, v]): Row => ({ label, cost: v.cost, requests: v.requests }));
  return <AttributionPanel rows={rows} isLoading={isLoading} emptyMsg="No team-attributed spend in this range." />;
}

function BranchAttribution() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("branches", scope, undefined, fetchSpendByBranch);
  const rows = (data ?? []).map((d): Row => ({ label: d.branch || "unknown", cost: d.cost_usd, requests: d.requests, tokens: d.total_tokens }));
  return <AttributionPanel rows={rows} isLoading={isLoading} emptyMsg="No branch attribution — connect a git repo and tag requests with x-prism-branch." />;
}

const DIMENSIONS = [
  { key: "project",  label: "Project" },
  { key: "workload", label: "Workload" },
  { key: "team",     label: "Team" },
  { key: "branch",   label: "Branch" },
] as const;
type Dim = (typeof DIMENSIONS)[number]["key"];

export function Attribution() {
  const [dim, setDim] = useState<Dim>("project");
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 w-fit">
        {DIMENSIONS.map((d) => (
          <button key={d.key} onClick={() => setDim(d.key)}
            className={cn("rounded px-2.5 py-1 text-xs transition-colors", dim === d.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {d.label}
          </button>
        ))}
      </div>
      {dim === "project"  && <ProjectAttribution />}
      {dim === "workload" && <WorkloadAttribution />}
      {dim === "team"     && <TeamAttribution />}
      {dim === "branch"   && <BranchAttribution />}
    </div>
  );
}
