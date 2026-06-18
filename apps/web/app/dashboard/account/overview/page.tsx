"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";

interface OrgSettings {
  name: string; slug: string;
  data_residency_policy?: string; gateway_mode?: string;
  cache_enabled?: boolean; cache_mode?: string; cache_ttl_seconds?: number;
}
interface Member { user_id: string; email: string; name: string; role: string | null }

const RESIDENCY = [["any", "Any region"], ["eu_only", "EU only"], ["us_only", "US only"], ["india_only", "India only"]] as const;
const GATEWAY = [["sdk_optional", "SDK optional"], ["gateway_required", "Gateway required"]] as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
      <div className="min-w-0"><p className="text-sm">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function OrganizationPage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const isOwner = role === "owner";
  const qc = useQueryClient();

  const { data: org, isLoading } = useQuery({
    queryKey: ["org-settings"],
    queryFn: ({ signal }) => apiGet<OrgSettings>("/api/org", undefined, signal),
    enabled: canManage,
  });
  const { data: members = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: ({ signal }) => apiGet<{ members: Member[] }>("/api/team/members", undefined, signal).then((r) => r.members ?? []),
    enabled: isOwner,
  });

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [transferring, setTransferring] = useState(false);
  useEffect(() => { if (org?.name) setName(org.name); }, [org?.name]);

  if (!canManage) {
    return <div className="p-5"><EmptyState icon={Building2} title="Organization settings are manager-only" description="Workspace, governance, and ownership settings are available to owners and admins." /></div>;
  }

  async function patch(p: Partial<OrgSettings>) {
    try { await apiPatch("/api/org", p); await qc.invalidateQueries({ queryKey: ["org-settings"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  }
  async function saveName() {
    if (!name.trim() || name === org?.name) return;
    setSavingName(true);
    try { await apiPatch("/api/org", { name: name.trim() }); await qc.invalidateQueries({ queryKey: ["org-settings"] }); toast.success("Workspace renamed"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't rename"); }
    finally { setSavingName(false); }
  }
  async function transfer() {
    if (!newOwner || transferring) return;
    setTransferring(true);
    try {
      await apiPost("/api/org/transfer-ownership", { new_owner_user_id: newOwner });
      toast.success("Ownership transferred");
      setTransferOpen(false);
      window.location.href = "/dashboard";
    } catch (e) { toast.error(e instanceof Error ? e.message : "Transfer failed"); }
    finally { setTransferring(false); }
  }

  const transferable = members.filter((m) => m.role !== "owner" && m.user_id);

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      <div className="col-span-12 lg:col-span-6">
        <ChartCard title="Workspace">
          {isLoading ? <Skeleton className="h-24 w-full" />
            : <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="org-name">Name</Label>
                  <div className="flex gap-2">
                    <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
                    <Button onClick={saveName} disabled={savingName || !name.trim() || name === org?.name}>{savingName && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Slug: <span className="font-mono">{org?.slug}</span></p>
              </div>}
        </ChartCard>
      </div>

      <div className="col-span-12 lg:col-span-6">
        <ChartCard title="Governance">
          {isLoading ? <Skeleton className="h-32 w-full" />
            : <div className="space-y-2">
                <Row label="Data residency" hint="Restrict where requests may be routed">
                  <Select value={org?.data_residency_policy ?? "any"} onValueChange={(v) => patch({ data_residency_policy: v })}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{RESIDENCY.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Row>
                <Row label="Gateway mode" hint="Require all traffic through the gateway">
                  <Select value={org?.gateway_mode ?? "sdk_optional"} onValueChange={(v) => patch({ gateway_mode: v })}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{GATEWAY.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Row>
              </div>}
        </ChartCard>
      </div>

      <div className="col-span-12 lg:col-span-6">
        <ChartCard title="Response caching">
          {isLoading ? <Skeleton className="h-32 w-full" />
            : <div className="space-y-2">
                <Row label="Caching enabled"><Switch checked={!!org?.cache_enabled} onCheckedChange={(v) => patch({ cache_enabled: v })} /></Row>
                <Row label="Mode">
                  <Select value={org?.cache_mode ?? "exact"} onValueChange={(v) => patch({ cache_mode: v })}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="exact">Exact</SelectItem><SelectItem value="semantic">Semantic</SelectItem></SelectContent>
                  </Select>
                </Row>
                <Row label="TTL (seconds)">
                  <Input type="number" className="h-8 w-28" defaultValue={org?.cache_ttl_seconds ?? 3600} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n >= 60) patch({ cache_ttl_seconds: n }); }} />
                </Row>
              </div>}
        </ChartCard>
      </div>

      {isOwner && (
        <div className="col-span-12 lg:col-span-6">
          <ChartCard title="Danger zone">
            <div className="flex items-center justify-between gap-4 rounded-md border border-[hsl(var(--signal))]/30 px-3 py-2.5">
              <div><p className="text-sm font-medium">Transfer ownership</p><p className="text-xs text-muted-foreground">Hand the org to another member. You become an admin.</p></div>
              <Button variant="outline" className="shrink-0 border-[hsl(var(--signal))]/40 text-[hsl(var(--signal-text))]" onClick={() => setTransferOpen(true)}><ShieldAlert className="h-4 w-4" />Transfer</Button>
            </div>
          </ChartCard>
        </div>
      )}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Transfer ownership</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The new owner gains full control; you&apos;ll be demoted to administrator.</p>
          <div className="space-y-1.5">
            <Label>New owner</Label>
            <Select value={newOwner} onValueChange={setNewOwner}>
              <SelectTrigger><SelectValue placeholder="Select a member" /></SelectTrigger>
              <SelectContent>{transferable.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name || m.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferring}>Cancel</Button>
            <Button variant="destructive" onClick={transfer} disabled={transferring || !newOwner}>{transferring && <Loader2 className="h-4 w-4 animate-spin" />}Transfer ownership</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
