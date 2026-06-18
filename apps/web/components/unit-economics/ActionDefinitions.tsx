"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api/client";
import { fetchUnitEconTags } from "@/lib/api/metrics";
import { formatCost } from "@/lib/utils";

interface ActionDef {
  id: string;
  name: string;
  feature_tag: string;
  calls_per_action: number;
  description: string | null;
}

export function ActionDefinitions() {
  const qc = useQueryClient();
  const { scope } = useScope();
  const { data: defs, isLoading } = useQuery({
    queryKey: ["action-definitions"],
    queryFn: ({ signal }) => apiGet<{ data: ActionDef[] }>("/api/action-definitions", undefined, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
  });
  const tags = useWidgetData("unit-tags", scope, undefined, fetchUnitEconTags);
  const featureById = new Map((tags.data?.features ?? []).map((f) => [f.feature, f]));

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [featureTag, setFeatureTag] = useState("");
  const [calls, setCalls] = useState("1");
  const [saving, setSaving] = useState(false);

  function costPerAction(d: ActionDef): string {
    const f = featureById.get(d.feature_tag);
    if (!f || f.requests <= 0 || d.calls_per_action <= 0) return "—";
    return formatCost((f.cost_usd * d.calls_per_action) / f.requests);
  }

  async function create() {
    if (!name.trim() || !featureTag.trim()) { toast.error("Name and feature tag are required"); return; }
    setSaving(true);
    try {
      await apiPost("/api/action-definitions", { name: name.trim(), feature_tag: featureTag.trim(), calls_per_action: Number(calls) || 1 });
      toast.success("Action defined");
      setOpen(false); setName(""); setFeatureTag(""); setCalls("1");
      qc.invalidateQueries({ queryKey: ["action-definitions"] });
    } catch (e) {
      toast.error("Couldn't save", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/action-definitions?id=${id}`);
      qc.invalidateQueries({ queryKey: ["action-definitions"] });
    } catch (e) {
      toast.error("Couldn't delete", { description: e instanceof ApiError ? e.message : "Try again." });
    }
  }

  const rows = defs ?? [];

  return (
    <ChartCard
      title="Action definitions"
      subtitle="map a feature tag to a business action to model cost per action"
      actions={<Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Define action</Button>}
    >
      {isLoading ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <div className="flex h-[120px] items-center justify-center px-4 text-center text-xs text-muted-foreground">No actions defined yet. Map a feature to a business action (e.g. &ldquo;Support ticket&rdquo; = 3 calls of <code>support_chat</code>) to see cost per action.</div>
        : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Action</th>
                  <th className="text-left font-normal">Feature tag</th>
                  <th className="text-right font-normal">Calls/action</th>
                  <th className="text-right font-normal">Cost/action</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 font-medium">{d.name}</td>
                    <td><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{d.feature_tag}</code></td>
                    <td className="tabular text-right text-muted-foreground">{d.calls_per_action}</td>
                    <td className="tabular text-right">{costPerAction(d)}</td>
                    <td className="text-right">
                      <button onClick={() => remove(d.id)} aria-label={`Delete ${d.name}`} className="text-muted-foreground hover:text-[hsl(var(--signal))]"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Define an action</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Action name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support ticket" className="mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Feature tag</span>
              <Input value={featureTag} onChange={(e) => setFeatureTag(e.target.value)} placeholder="support_chat" className="mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">LLM calls per action</span>
              <Input type="number" min="1" value={calls} onChange={(e) => setCalls(e.target.value)} className="mt-1 w-32" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChartCard>
  );
}
