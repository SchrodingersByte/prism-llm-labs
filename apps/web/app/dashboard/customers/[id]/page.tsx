"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Users2 } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useCanManage } from "@/components/layout/role-context";
import { scopeKey } from "@/lib/scope";
import { fetchCustomerDaily, fetchCustomerModels } from "@/lib/api/metrics";
import { formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = decodeURIComponent(String(params.id ?? ""));
  const canManage = useCanManage();
  const { scope } = useScope();

  const daily = useQuery({
    queryKey: ["customer-daily", customerId, scopeKey(scope)],
    queryFn: ({ signal }) => fetchCustomerDaily(customerId, scope, signal),
    enabled: canManage,
    staleTime: 60_000,
  });
  const models = useQuery({
    queryKey: ["customer-models", customerId, scopeKey(scope)],
    queryFn: ({ signal }) => fetchCustomerModels(customerId, scope, signal),
    enabled: canManage,
    staleTime: 60_000,
  });

  const series = daily.data ?? [];
  const totalCost = series.reduce((s, p) => s + p.cost_usd, 0);
  const totalReq = series.reduce((s, p) => s + p.requests, 0);
  const totalTokens = series.reduce((s, p) => s + p.total_tokens, 0);
  const modelRows = [...(models.data ?? [])].sort((a, b) => b.cost_usd - a.cost_usd);

  return (
    <div>
      <div className="border-b border-border px-5 py-4">
        <Link href="/dashboard/customers" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Customers</Link>
        <h1 className="text-lg font-medium">Customer <span className="font-mono text-base text-muted-foreground">{customerId}</span></h1>
      </div>

      {!canManage ? (
        <div className="p-5"><EmptyState icon={Users2} title="Customers is manager-only" description="Per-customer cost detail is available to organization owners and admins." /></div>
      ) : (
        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Cost to serve" color="gold"    value={daily.isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(totalCost)} />
            <KpiCard label="Requests"      color="sky"     value={daily.isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(totalReq)} />
            <KpiCard label="Tokens"        color="violet"  value={daily.isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(totalTokens)} />
          </div>

          <ChartCard title="Daily cost" subtitle="cost to serve over time">
            {daily.isLoading ? <Skeleton className="h-[200px] w-full" />
              : series.length === 0 ? <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">No spend for this customer in range</div>
              : <AreaTrend data={series as unknown as Record<string, unknown>[]} xKey="date" yKey="cost_usd" height={200} valueFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />}
          </ChartCard>

          <ChartCard title="Model breakdown">
            {models.isLoading ? <Skeleton className="h-48 w-full" />
              : modelRows.length === 0 ? <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">No model usage for this customer in range</div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Model</th>
                        <th className="text-left font-normal">Provider</th>
                        <th className="text-right font-normal">Cost</th>
                        <th className="text-right font-normal">Requests</th>
                        <th className="pl-3 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelRows.map((m) => (
                        <tr key={`${m.provider}/${m.model}`} className="border-b border-border/60 last:border-0">
                          <td className="py-2 font-medium">{m.model}</td>
                          <td className="capitalize text-muted-foreground">{m.provider}</td>
                          <td className="tabular text-right">{formatCost(m.cost_usd)}</td>
                          <td className="tabular text-right text-muted-foreground">{fmtNum(m.requests)}</td>
                          <td className="tabular pl-3 text-right text-muted-foreground">{fmtNum(m.input_tokens + m.output_tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
