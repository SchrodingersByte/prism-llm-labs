"use client";

import { ShieldHalf } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Policy { id: string; model_pattern: string; environments: string[] | null; policy: string; created_at: string }
const policyClass = (p: string) => (p === "blocked" ? "signal" : p === "requires_approval" ? "brand-text" : "positive");

export default function ProjectGovernancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["model-governance"],
    queryFn: ({ signal }) => apiGet<{ data: Policy[] }>("/api/model-governance", undefined, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
  });
  const rows = data ?? [];

  return (
    <div>
      <PageHeader title="Governance" description="Model allow / block / approval policies — applied org-wide, including this project." />
      <div className="p-5">
        <ChartCard title="Model policies" subtitle="managed under Settings → Access">
          {isLoading ? <Skeleton className="h-48 w-full" />
            : rows.length === 0 ? <EmptyState icon={ShieldHalf} title="No model policies" description="No allow/block/approval rules are set, so models route freely. Add policies from Settings → Access." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Model pattern</th>
                    <th className="text-left font-normal">Environments</th>
                    <th className="pl-3 text-left font-normal">Policy</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.model_pattern}</code></td>
                        <td className="text-muted-foreground">{p.environments?.length ? p.environments.join(", ") : "all"}</td>
                        <td className="pl-3"><span className={cn("capitalize", policyClass(p.policy))}>{p.policy.replace(/_/g, " ")}</span></td>
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
