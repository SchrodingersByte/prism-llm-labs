"use client";

import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchReconciliation } from "@/lib/api/metrics";
import { apiGet } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";
import { cn, formatCost } from "@/lib/utils";

interface AuditEntry {
  id: string; action: string; target_type: string | null;
  created_at: string; actor_user_id: string | null;
}
const fmtTime = (t: string) => t.slice(0, 16).replace("T", " ");

export default function CompliancePage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const { scope } = useScope();

  const audit = useQuery({
    queryKey: ["audit-log"],
    queryFn: ({ signal }) => apiGet<{ data: AuditEntry[] }>("/api/audit-log", undefined, signal).then((r) => r.data ?? []),
    enabled: canManage,
  });
  const recon = useWidgetData("reconciliation", scope, undefined, fetchReconciliation);

  if (!canManage) {
    return <div className="p-5"><EmptyState icon={FileCheck2} title="Compliance is manager-only" description="The audit log and cost reconciliation are available to organization owners and admins." /></div>;
  }

  const entries = audit.data ?? [];
  const rrows = recon.data?.data ?? [];

  return (
    <div className="space-y-3 p-5">
      <ChartCard title="Audit log" subtitle="recent governance, access, and billing events">
        {audit.isLoading ? <Skeleton className="h-56 w-full" />
          : entries.length === 0 ? <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">No audit events yet.</div>
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Time</th><th className="text-left font-normal">Action</th><th className="text-left font-normal">Target</th><th className="text-left font-normal">Actor</th>
                </tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-mono text-xs text-muted-foreground">{fmtTime(e.created_at)}</td>
                      <td className="font-mono text-xs">{e.action}</td>
                      <td className="text-muted-foreground">{e.target_type ?? "—"}</td>
                      <td className="font-mono text-xs text-muted-foreground">{e.actor_user_id ? `${e.actor_user_id.slice(0, 8)}…` : "system"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>

      <ChartCard title="Reconciliation" subtitle="Prism-tracked cost vs provider-billed cost">
        {recon.isLoading ? <Skeleton className="h-48 w-full" />
          : rrows.length === 0 ? <div className="flex h-24 items-center justify-center px-6 text-center text-xs text-muted-foreground">{recon.data?.has_provider_data === false ? "Connect a provider's billing API (or add per-model provider keys) to reconcile estimated vs actual cost." : "No reconciliation data in this range."}</div>
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Provider / model</th><th className="text-right font-normal">Prism cost</th><th className="text-right font-normal">Provider cost</th><th className="pl-3 text-right font-normal">Coverage</th>
                </tr></thead>
                <tbody>
                  {rrows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="py-2"><span className="font-medium">{r.model}</span><span className="ml-1.5 text-xs text-muted-foreground">{r.provider}</span></td>
                      <td className="tabular text-right">{formatCost(r.prism_cost)}</td>
                      <td className="tabular text-right text-muted-foreground">{r.provider_cost != null ? formatCost(r.provider_cost) : "—"}</td>
                      <td className={cn("tabular pl-3 text-right", r.coverage_pct != null && (r.coverage_pct >= 0.9 ? "positive" : "signal"))}>{r.coverage_pct != null ? `${Math.round(r.coverage_pct * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
