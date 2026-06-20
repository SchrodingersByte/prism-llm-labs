"use client";

import { FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/components/layout/project-context";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface PromptRow { id: string; name: string; description: string | null; updated_at: string; latest_version: number; labels: { label: string; version: number }[] }
const labelClass = (l: string) => (l === "production" || l === "prod" ? "positive-chip" : l === "staging" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-muted text-muted-foreground");

export default function ProjectPromptsPage() {
  const project = useProject();
  const { data, isLoading } = useQuery({
    queryKey: ["prompts", project.id],
    queryFn: ({ signal }) => apiGet<{ prompts: PromptRow[] }>("/api/prompts", { project_id: project.id }, signal).then((r) => r.prompts ?? []),
    staleTime: 60_000,
  });
  const rows = data ?? [];

  return (
    <div>
      <PageHeader title="Prompts" description={`Prompts scoped to ${project.name}.`} />
      <div className="p-5">
        <ChartCard title="Registry">
          {isLoading ? <Skeleton className="h-48 w-full" />
            : rows.length === 0 ? <EmptyState icon={FileText} title="No prompts in this project" description="Prompts created with this project's scope appear here. Manage them from the org Prompts page." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Name</th>
                    <th className="text-left font-normal">Labels</th>
                    <th className="pl-3 text-right font-normal">Latest</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2"><span className="font-medium">{p.name}</span>{p.description && <span className="ml-2 text-xs text-muted-foreground">{p.description}</span>}</td>
                        <td><div className="flex flex-wrap gap-1">{p.labels.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : p.labels.map((l) => <span key={l.label} className={cn("rounded px-1.5 py-0.5 text-[11px] capitalize", labelClass(l.label))}>{l.label} v{l.version}</span>)}</div></td>
                        <td className="tabular pl-3 text-right text-muted-foreground">v{p.latest_version}</td>
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
