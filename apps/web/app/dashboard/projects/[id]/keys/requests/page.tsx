"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/components/layout/project-context";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface KeyLite { id: string; name: string }
interface ExtReq { id: string; request_type: string; current_value: string | null; requested_value: string; reason: string; urgency: string; status: string; created_at: string }

const statusClass = (s: string) => (s === "approved" ? "positive" : s === "rejected" ? "signal" : "brand-text");
const fmtTime = (t: string) => t.slice(0, 10);

export default function ProjectKeyRequestsPage() {
  const project = useProject();
  const keysQ = useQuery({ queryKey: ["api-keys", project.id], queryFn: ({ signal }) => apiGet<{ data: KeyLite[] }>("/api/keys", { project_id: project.id }, signal).then((r) => r.data ?? []), staleTime: 60_000 });
  const keys = useMemo(() => keysQ.data ?? [], [keysQ.data]);
  const [keyId, setKeyId] = useState("");
  useEffect(() => { if (!keyId && keys.length > 0) setKeyId(keys[0]!.id); }, [keys, keyId]);

  const reqQ = useQuery({
    queryKey: ["key-requests", keyId],
    queryFn: ({ signal }) => apiGet<{ data: ExtReq[] }>(`/api/keys/${keyId}/extension-request`, undefined, signal).then((r) => r.data ?? []),
    enabled: !!keyId,
    staleTime: 60_000,
  });
  const rows = reqQ.data ?? [];

  return (
    <div className="p-5">
      <ChartCard
        title="Extension requests"
        subtitle="cap-increase / renewal approvals"
        actions={keys.length > 0 ? (
          <select value={keyId} onChange={(e) => setKeyId(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
            {keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        ) : undefined}
      >
        {keysQ.isLoading ? <Skeleton className="h-40 w-full" />
          : keys.length === 0 ? <EmptyState icon={Inbox} title="No keys in this project" description="Extension requests are raised against a key." />
          : reqQ.isLoading ? <Skeleton className="h-40 w-full" />
          : rows.length === 0 ? <EmptyState icon={Inbox} title="No requests" description="No cap-increase or renewal requests for this key." />
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Type</th>
                  <th className="text-left font-normal">Requested</th>
                  <th className="text-left font-normal">Urgency</th>
                  <th className="text-left font-normal">Status</th>
                  <th className="pl-3 text-left font-normal">When</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 capitalize">{r.request_type.replace(/_/g, " ")}</td>
                      <td className="text-muted-foreground">{r.current_value ? `${r.current_value} → ` : ""}<span className="text-foreground">{r.requested_value}</span></td>
                      <td className="capitalize text-muted-foreground">{r.urgency}</td>
                      <td><span className={cn("capitalize", statusClass(r.status))}>{r.status}</span></td>
                      <td className="pl-3 text-muted-foreground">{fmtTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
