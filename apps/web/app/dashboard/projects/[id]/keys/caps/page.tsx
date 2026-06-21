"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/components/layout/project-context";
import { apiGet, ApiError } from "@/lib/api/client";
import { formatCost } from "@/lib/utils";

interface KeyLite { id: string; name: string }
interface Cap { id: string; period: string; is_rolling: boolean; amount_usd: number; environment: string | null }

export default function ProjectCapsPage() {
  const project = useProject();
  const keysQ = useQuery({ queryKey: ["api-keys", project.id], queryFn: ({ signal }) => apiGet<{ data: KeyLite[] }>("/api/keys", { project_id: project.id }, signal).then((r) => r.data ?? []), staleTime: 60_000 });
  const keys = useMemo(() => keysQ.data ?? [], [keysQ.data]);
  const [keyId, setKeyId] = useState("");
  useEffect(() => { if (!keyId && keys.length > 0) setKeyId(keys[0]!.id); }, [keys, keyId]);

  const capsQ = useQuery({
    queryKey: ["caps", keyId],
    queryFn: ({ signal }) => apiGet<{ data: Cap[] }>(`/api/keys/${keyId}/caps`, undefined, signal).then((r) => r.data ?? []).catch((e) => {
      if (e instanceof ApiError && e.status === 403) return null;
      throw e;
    }),
    enabled: !!keyId,
    staleTime: 60_000,
  });
  const caps = capsQ.data;

  return (
    <div className="p-5">
      <ChartCard
        title="Spend caps"
        subtitle="per-key daily / weekly / monthly limits"
        actions={keys.length > 0 ? (
          <select value={keyId} onChange={(e) => setKeyId(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
            {keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        ) : undefined}
      >
        {keysQ.isLoading ? <Skeleton className="h-40 w-full" />
          : keys.length === 0 ? <EmptyState icon={Gauge} title="No keys in this project" description="Create a project key first, then set spend caps on it." />
          : capsQ.isLoading ? <Skeleton className="h-40 w-full" />
          : caps === null ? <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">Spend caps are visible to the organization owner.</div>
          : (caps?.length ?? 0) === 0 ? <EmptyState icon={Gauge} title="No caps on this key" description="This key has no spend caps. Add caps from Settings → Access." />
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Period</th>
                  <th className="text-left font-normal">Type</th>
                  <th className="text-left font-normal">Environment</th>
                  <th className="pl-3 text-right font-normal">Cap</th>
                </tr></thead>
                <tbody>
                  {caps!.map((c) => (
                    <tr key={c.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 capitalize font-medium">{c.period}</td>
                      <td className="text-muted-foreground">{c.is_rolling ? "rolling" : "calendar"}</td>
                      <td className="text-muted-foreground">{c.environment ?? "all"}</td>
                      <td className="tabular pl-3 text-right">{formatCost(c.amount_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
