"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { apiGet, apiPost, apiDelete } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  environment: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  provider: string | null;
  project_name: string | null;
}
interface ProjectLite { id: string; name: string }
const ENVS = ["production", "staging", "development"] as const;

export default function AccessPage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const isOwner = role === "owner";
  const qc = useQueryClient();

  const { data: keys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: ({ signal }) => apiGet<{ data: KeyRow[] }>("/api/keys", undefined, signal).then((r) => r.data ?? []),
    enabled: canManage,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: ({ signal }) => apiGet<{ data: ProjectLite[] }>("/api/projects", undefined, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<string>("production");
  const [projectId, setProjectId] = useState("org");
  const [created, setCreated] = useState<string | null>(null);  // one-time raw key
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="p-5">
        <EmptyState icon={KeyRound} title="Access control is manager-only" description="API keys, caps, and provider links are managed by organization owners and admins." />
      </div>
    );
  }

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ data: { key: string } }>("/api/keys", {
        name: n, environment, project_id: projectId === "org" ? undefined : projectId,
      });
      setCreated(res.data.key);
      setName(""); setProjectId("org"); setEnvironment("production");
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create key");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await apiDelete(`/api/keys/${id}`);
      setConfirmId(null);
      toast.success("Key revoked");
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke key");
    }
  }
  function closeCreate() { setOpen(false); setCreated(null); setCopied(false); }

  const rows = keys ?? [];

  return (
    <div className="p-5">
      <div className="dash-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h3 className="text-sm font-medium">API keys</h3>
            <p className="text-xs text-muted-foreground">Authenticate the SDK and gateway. Link provider keys for gateway routing.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New key</Button>
        </div>
        <div className="p-4">
          {isLoading ? <Skeleton className="h-48 w-full" />
            : rows.length === 0 ? <EmptyState icon={KeyRound} title="No API keys yet" description="Create a key to start sending telemetry or routing through the gateway." action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New key</Button>} />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-normal">Name</th>
                      <th className="text-left font-normal">Prefix</th>
                      <th className="text-left font-normal">Env</th>
                      <th className="text-left font-normal">Scope</th>
                      <th className="text-left font-normal">Provider</th>
                      <th className="text-left font-normal">Last used</th>
                      {isOwner && <th className="text-right font-normal" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((k) => (
                      <tr key={k.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 font-medium">{k.name}</td>
                        <td className="font-mono text-xs text-muted-foreground">{k.key_prefix}…</td>
                        <td className="text-muted-foreground">{k.environment}</td>
                        <td className="text-muted-foreground">{k.project_name ?? "Org"}</td>
                        <td className="text-muted-foreground">{k.provider ?? "—"}</td>
                        <td className="text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}</td>
                        {isOwner && (
                          <td className="text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => setConfirmId(k.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </div>
      </div>

      {/* Create / reveal dialog */}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeCreate())}>
        <DialogContent className="max-w-md">
          {created ? (
            <>
              <DialogHeader><DialogTitle>Your API key</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Copy it now — for security it won&apos;t be shown again.</p>
              <div className="break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">{created}</div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(created); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy</>}
                </Button>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>New API key</DialogTitle></DialogHeader>
              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label htmlFor="key-name">Name</Label>
                  <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-gateway" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Environment</Label>
                    <Select value={environment} onValueChange={setEnvironment}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ENVS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Project</Label>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="org">Org-wide</SelectItem>
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Spend caps and provider-key links can be set per key after creation.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate} disabled={busy}>Cancel</Button>
                <Button onClick={create} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create key</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Revoke key?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Requests using this key will immediately fail. This can&apos;t be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmId && revoke(confirmId)}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
