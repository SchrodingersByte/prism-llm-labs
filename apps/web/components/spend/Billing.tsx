"use client";

import Link from "next/link";
import { Download, Plug } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchReconciliation, type ReconciliationRow } from "@/lib/api/metrics";
import { cn, formatCost } from "@/lib/utils";

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatCost(Math.abs(v))}`;

function exportCsv(rows: ReconciliationRow[]) {
  const head = ["provider", "model", "prism_cost", "provider_cost", "variance", "coverage_pct"];
  const body = rows.map((r) => [
    `"${r.provider}"`, `"${r.model}"`, r.prism_cost, r.provider_cost ?? "",
    r.provider_cost != null ? r.provider_cost - r.prism_cost : "", r.coverage_pct ?? "",
  ].join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "billing-reconciliation.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function Billing() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("reconciliation", scope, undefined, fetchReconciliation);
  const rows = [...(data?.data ?? [])].sort((a, b) => b.prism_cost - a.prism_cost);
  const hasProvider = data?.has_provider_data ?? false;

  const tracked = rows.reduce((s, r) => s + r.prism_cost, 0);
  const reconciled = rows.filter((r) => r.provider_cost != null);
  const billed = reconciled.reduce((s, r) => s + (r.provider_cost ?? 0), 0);
  const trackedReconciled = reconciled.reduce((s, r) => s + r.prism_cost, 0);
  const variance = billed - trackedReconciled;
  const variancePct = trackedReconciled > 0 ? (variance / trackedReconciled) * 100 : 0;
  const coverage = rows.length > 0 ? (reconciled.length / rows.length) * 100 : 0;

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Prism tracked"  color="gold" value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(tracked)} />
        <KpiCard label="Provider billed" color="sky"  value={isLoading ? <Skeleton className="h-7 w-20" /> : hasProvider ? formatCost(billed) : "—"} />
        <KpiCard
          label="Variance"
          color={!hasProvider || variance === 0 ? "violet" : variance > 0 ? "coral" : "emerald"}
          value={isLoading ? <Skeleton className="h-7 w-20" /> : hasProvider ? `${signed(variance)} (${variancePct >= 0 ? "+" : "−"}${Math.abs(variancePct).toFixed(1)}%)` : "—"}
        />
        <KpiCard label="Coverage" color="emerald" value={isLoading ? <Skeleton className="h-7 w-14" /> : `${Math.round(coverage)}%`} />
      </div>

      {!isLoading && !hasProvider && (
        <div className="dash-card card-rule-gold flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">No provider billing connected</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Showing Prism-tracked spend only. Connect a provider billing API to reconcile against actual invoices.</p>
          </div>
          <Link href="/dashboard/settings/integrations">
            <Button size="sm" className="gap-1.5"><Plug className="h-4 w-4" />Connect billing</Button>
          </Link>
        </div>
      )}

      <ChartCard
        title="Reconciliation by model"
        subtitle="Prism-tracked vs provider-billed actuals"
        actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(rows)} disabled={rows.length === 0}><Download className="h-3.5 w-3.5" />Export</Button>}
      >
        {isLoading ? <Skeleton className="h-64 w-full" />
          : rows.length === 0 ? <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">No tracked spend in this range.</div>
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Model</th>
                    <th className="text-right font-normal">Prism cost</th>
                    <th className="text-right font-normal">Provider cost</th>
                    <th className="text-right font-normal">Variance</th>
                    <th className="pl-3 text-right font-normal">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const v = r.provider_cost != null ? r.provider_cost - r.prism_cost : null;
                    return (
                      <tr key={`${r.provider}/${r.model}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2"><span className="font-medium">{r.model}</span><span className="ml-1.5 text-xs text-muted-foreground">{r.provider}</span></td>
                        <td className="tabular text-right">{formatCost(r.prism_cost)}</td>
                        <td className="tabular text-right">{r.provider_cost != null ? formatCost(r.provider_cost) : <span className="text-muted-foreground/60">—</span>}</td>
                        <td className={cn("tabular text-right", v == null ? "text-muted-foreground/60" : v > 0 ? "signal" : "positive")}>{v == null ? "—" : signed(v)}</td>
                        <td className="tabular pl-3 text-right text-muted-foreground">{r.coverage_pct != null ? `${r.coverage_pct}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
