"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Plus, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useRole } from "@/components/layout/role-context";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface PromptLabel { label: string; version: number }
interface PromptRow { id: string; name: string; description: string | null; updated_at: string; latest_version: number; labels: PromptLabel[] }

const fmtTime = (t: string) => (t ? t.slice(0, 10) : "—");
const labelClass = (l: string) => (l === "production" || l === "prod" ? "positive-chip" : l === "staging" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-muted text-muted-foreground");

export default function PromptsPage() {
  const role = useRole();
  const canWrite = role !== "read_only";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["prompts"],
    queryFn: ({ signal }) => apiGet<{ prompts: PromptRow[] }>("/api/prompts", undefined, signal).then((r) => r.prompts ?? []),
    staleTime: 60_000,
  });
  const rows = data ?? [];
  const labeled = rows.filter((p) => p.labels.length > 0).length;

  async function create() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await apiPost("/api/prompts", { name: name.trim(), description: desc.trim() || undefined });
      toast.success("Prompt created");
      setOpen(false); setName(""); setDesc("");
      qc.invalidateQueries({ queryKey: ["prompts"] });
    } catch (e) {
      toast.error("Couldn't create prompt", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader
        title="Prompts"
        description="Versioned prompt registry with labels for production and staging."
        actions={canWrite ? <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New prompt</Button> : undefined}
      />

      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Prompts"  color="gold"    value={isLoading ? <Skeleton className="h-7 w-12" /> : String(rows.length)} />
          <KpiCard label="Labeled"  color="emerald" value={isLoading ? <Skeleton className="h-7 w-12" /> : String(labeled)} />
          <KpiCard label="Versions" color="violet"  value={isLoading ? <Skeleton className="h-7 w-12" /> : String(rows.reduce((s, p) => s + p.latest_version, 0))} />
        </div>

        <ChartCard title="Registry">
          {isLoading ? <Skeleton className="h-64 w-full" />
            : rows.length === 0 ? <EmptyState icon={FileText} title="No prompts yet" description="Create a prompt to start versioning it. Each version is immutable; promote a version to production or staging with a label." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-normal">Name</th>
                      <th className="text-left font-normal">Labels</th>
                      <th className="text-right font-normal">Latest</th>
                      <th className="pl-3 text-right font-normal">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2">
                          <span className="font-medium">{p.name}</span>
                          {p.description && <span className="ml-2 text-xs text-muted-foreground">{p.description}</span>}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {p.labels.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : p.labels.map((l) => (
                              <span key={l.label} className={cn("rounded px-1.5 py-0.5 text-[11px] capitalize", labelClass(l.label))}>{l.label} v{l.version}</span>
                            ))}
                          </div>
                        </td>
                        <td className="tabular text-right text-muted-foreground">v{p.latest_version}</td>
                        <td className="tabular pl-3 text-right text-muted-foreground">{fmtTime(p.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </ChartCard>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New prompt</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-reply" className="mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Description (optional)</span>
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={create} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
