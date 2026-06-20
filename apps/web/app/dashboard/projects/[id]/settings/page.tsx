"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useProject } from "@/components/layout/project-context";
import { useRole } from "@/components/layout/role-context";
import { apiGet, apiPut, ApiError } from "@/lib/api/client";

interface CaptureSetting { id: string; project_id: string | null; level: string; payload_ttl_days: number; embed_enabled: boolean }
const LEVELS = [
  { v: "off", label: "Off" },
  { v: "metadata_only", label: "Metadata only" },
  { v: "redacted_content", label: "Redacted content" },
  { v: "full_content", label: "Full content" },
];

export default function ProjectSettingsPage() {
  const project = useProject();
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["content-capture"],
    queryFn: ({ signal }) => apiGet<{ settings: CaptureSetting[] }>("/api/settings/content-capture", undefined, signal).then((r) => r.settings ?? []),
    enabled: canManage,
  });
  const projectRow = (data ?? []).find((s) => s.project_id === project.id);
  const orgDefault = (data ?? []).find((s) => s.project_id === null);
  const effective = projectRow ?? orgDefault;

  const [level, setLevel] = useState("off");
  const [ttl, setTtl] = useState(30);
  const [embed, setEmbed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (effective) { setLevel(effective.level); setTtl(effective.payload_ttl_days); setEmbed(effective.embed_enabled); }
  }, [effective]);

  async function save() {
    setSaving(true);
    try {
      await apiPut("/api/settings/content-capture", { project_id: project.id, level, payload_ttl_days: ttl, embed_enabled: embed });
      toast.success("Content capture updated");
      qc.invalidateQueries({ queryKey: ["content-capture"] });
    } catch (e) {
      toast.error("Couldn't save", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Settings" description={`Configuration for ${project.name}.`} />
      <div className="grid grid-cols-12 gap-3 p-5">
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="Project">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{project.name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Cost center</dt><dd>{project.cost_center_code || <span className="text-muted-foreground">—</span>}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Slug</dt><dd className="font-mono text-xs text-muted-foreground">{project.slug || "—"}</dd></div>
            </dl>
          </ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="Content capture" subtitle={projectRow ? "project override" : "inheriting org default"}>
            {!canManage ? <p className="text-sm text-muted-foreground">Owner or administrator required to change content capture.</p>
              : isLoading ? <Skeleton className="h-40 w-full" />
              : <div className="space-y-3">
                  <label className="block text-sm"><span className="text-xs text-muted-foreground">Capture level</span>
                    <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm"><span className="text-xs text-muted-foreground">Payload TTL (days)</span>
                    <Input type="number" min="1" max="3650" value={ttl} onChange={(e) => setTtl(Number(e.target.value) || 30)} className="mt-1 w-32" />
                  </label>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                    <span className="text-sm">Embeddings enabled</span>
                    <Switch checked={embed} onCheckedChange={setEmbed} />
                  </div>
                  <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
                </div>}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
