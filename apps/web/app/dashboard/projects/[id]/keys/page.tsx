"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/components/layout/project-context";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface KeyRow { id: string; name: string; key_prefix: string; environment: string; is_active: boolean; last_used_at: string | null; provider: string | null }
const envClass = (e: string) => (e === "production" ? "positive" : e === "staging" ? "brand-text" : "text-muted-foreground");

export default function ProjectKeysPage() {
  const project = useProject();
  const { data, isLoading } = useQuery({
    queryKey: ["api-keys", project.id],
    queryFn: ({ signal }) => apiGet<{ data: KeyRow[] }>("/api/keys", { project_id: project.id }, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
  });
  const rows = data ?? [];

  return (
    <div className="p-5">
      <ChartCard title="Project keys" subtitle="manage keys org-wide under Settings → Access">
        {isLoading ? <Skeleton className="h-48 w-full" />
          : rows.length === 0 ? <EmptyState icon={KeyRound} title="No keys for this project" description="Create a project-scoped key from Settings → Access (set the project on the new key)." />
          : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Name</th>
                  <th className="text-left font-normal">Key</th>
                  <th className="text-left font-normal">Env</th>
                  <th className="text-left font-normal">Provider</th>
                  <th className="pl-3 text-left font-normal">Last used</th>
                </tr></thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-medium">{k.name}{k.provider && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">gateway</span>}</td>
                      <td><code className="text-xs text-muted-foreground">{k.key_prefix}…</code></td>
                      <td><span className={cn("capitalize", envClass(k.environment))}>{k.environment}</span></td>
                      <td className="text-muted-foreground">{k.provider ?? "—"}</td>
                      <td className="pl-3 text-muted-foreground">{k.last_used_at ? k.last_used_at.slice(0, 10) : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </ChartCard>
    </div>
  );
}
