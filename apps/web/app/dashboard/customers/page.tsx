"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users2, Plug } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanManage } from "@/components/layout/role-context";
import { fetchCustomers } from "@/lib/api/metrics";
import { cn, formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

const STATUS_CLASS: Record<string, string> = {
  over_budget: "signal", at_risk: "brand-text", on_track: "positive", unlimited: "text-muted-foreground",
};

export default function CustomersPage() {
  const canManage = useCanManage();
  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: ({ signal }) => fetchCustomers(signal),
    staleTime: 60_000,
    enabled: canManage,
  });
  const rows = [...(data ?? [])].sort((a, b) => b.current_cost_usd - a.current_cost_usd);
  const totalCost = rows.reduce((s, r) => s + r.current_cost_usd, 0);
  const atRisk = rows.filter((r) => r.status === "at_risk" || r.status === "over_budget").length;

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Customers" description="Customer P&L — cost-to-serve, margin, and at-risk flags." />
        <div className="p-5"><EmptyState icon={Users2} title="Customers is manager-only" description="Customer cost-to-serve and P&L are available to organization owners and admins." /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Customers" description="Cost-to-serve per customer, quota utilization, and at-risk flags." />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Customers"    color="sky"   value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(rows.length)} />
          <KpiCard label="Cost to serve" color="gold" value={isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
          <KpiCard label="At risk"      color={atRisk > 0 ? "coral" : "emerald"} value={isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(atRisk)} />
          <KpiCard label="Avg / customer" color="violet" value={isLoading ? <Skeleton className="h-7 w-16" /> : formatCost(rows.length ? totalCost / rows.length : 0)} />
        </div>

        <div className="dash-card card-rule-gold flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Revenue not connected</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Showing cost-to-serve only. Connect a revenue source (billing sync, API, or manual) to unlock gross margin and P&L.</p>
          </div>
          <Link href="/dashboard/settings/integrations"><span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><Plug className="h-4 w-4" />Connect revenue</span></Link>
        </div>

        <ChartCard title="Customers" subtitle="cost-to-serve this month">
          {isLoading ? <Skeleton className="h-64 w-full" />
            : rows.length === 0 ? <EmptyState icon={Users2} title="No customers yet" description="Tag requests with x-prism-customer-id (or create customer profiles) to meter per-customer cost-to-serve." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-normal">Customer</th>
                      <th className="text-right font-normal">Cost to serve</th>
                      <th className="text-right font-normal">Requests</th>
                      <th className="text-right font-normal">Tokens</th>
                      <th className="text-right font-normal">Quota used</th>
                      <th className="pl-3 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.customer_id} className="border-b border-border/60 last:border-0">
                        <td className="py-2">
                          <Link href={`/dashboard/customers/${encodeURIComponent(c.customer_id)}`} className="font-medium hover:text-primary">{c.display_name || c.customer_id}</Link>
                        </td>
                        <td className="tabular text-right">{formatCost(c.current_cost_usd)}</td>
                        <td className="tabular text-right text-muted-foreground">{fmtNum(c.requests)}</td>
                        <td className="tabular text-right text-muted-foreground">{fmtNum(c.current_tokens)}</td>
                        <td className="tabular text-right text-muted-foreground">{c.utilization_pct != null ? `${c.utilization_pct}%` : "—"}</td>
                        <td className="pl-3"><span className={cn("capitalize", STATUS_CLASS[c.status] ?? "text-muted-foreground")}>{c.status.replace(/_/g, " ")}</span></td>
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
