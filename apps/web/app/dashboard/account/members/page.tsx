"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";

interface Member { user_id: string; email: string; name: string; role: string | null; scope_type: string; joined_at: string; projects: { id: string; name: string; role: string }[] }
interface Invite { email: string; role: string | null; scope_type: string; created_at: string }
interface ProjectLite { id: string; name: string }
const ROLES = ["administrator", "developer", "read_only"] as const;
const roleLabel = (r: string | null) => (r === "read_only" ? "Read only" : r ? r[0].toUpperCase() + r.slice(1) : "Project-scoped");

export default function MembersPage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: ({ signal }) => apiGet<{ members: Member[]; invites: Invite[] }>("/api/team/members", undefined, signal),
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
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [projectId, setProjectId] = useState("org");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!canManage) {
    return <div className="p-5"><EmptyState icon={Users} title="Members are manager-only" description="Member and invite management is available to owners and admins." /></div>;
  }

  async function invite() {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ invite_url?: string; warning?: string }>("/api/team/invite", {
        email: email.trim(), role: inviteRole, project_id: projectId === "org" ? undefined : projectId,
      });
      await qc.invalidateQueries({ queryKey: ["team-members"] });
      if (res.warning && res.invite_url) { setInviteUrl(res.invite_url); }
      else { toast.success("Invite sent"); setOpen(false); setEmail(""); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send invite");
    } finally { setBusy(false); }
  }
  async function changeRole(userId: string, newRole: string) {
    try { await apiPatch(`/api/team/members/${userId}`, { role: newRole }); await qc.invalidateQueries({ queryKey: ["team-members"] }); toast.success("Role updated"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update role"); }
  }
  async function remove(userId: string) {
    try { await apiDelete(`/api/team/members/${userId}`); setConfirmId(null); toast.success("Member removed"); await qc.invalidateQueries({ queryKey: ["team-members"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't remove member"); }
  }
  function closeInvite() { setOpen(false); setInviteUrl(null); setEmail(""); setProjectId("org"); setInviteRole("developer"); setCopied(false); }

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  return (
    <div className="space-y-3 p-5">
      <div className="dash-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div><h3 className="text-sm font-medium">Members</h3><p className="text-xs text-muted-foreground">Roles, scope, and project grants.</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Invite</Button>
        </div>
        <div className="p-4">
          {isLoading ? <Skeleton className="h-48 w-full" />
            : members.length === 0 ? <EmptyState icon={Users} title="No members" description="Invite teammates to collaborate." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Member</th><th className="text-left font-normal">Role</th><th className="text-left font-normal">Projects</th><th className="text-left font-normal">Joined</th><th className="text-right font-normal" />
                  </tr></thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id} className="border-b border-border/60 last:border-0">
                        <td className="py-2"><div className="font-medium">{m.name || m.email.split("@")[0]}</div><div className="text-xs text-muted-foreground">{m.email}</div></td>
                        <td>
                          {m.role === "owner" ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Owner</span>
                            : m.scope_type === "project" ? <span className="text-xs text-muted-foreground">Project-scoped</span>
                            : <Select value={m.role ?? "developer"} onValueChange={(v) => changeRole(m.user_id, v)}>
                                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
                              </Select>}
                        </td>
                        <td className="text-muted-foreground">{m.projects.length > 0 ? m.projects.map((p) => p.name).join(", ") : (m.scope_type === "organization" ? "All" : "—")}</td>
                        <td className="text-muted-foreground">{new Date(m.joined_at).toLocaleDateString()}</td>
                        <td className="text-right">{m.role !== "owner" && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => setConfirmId(m.user_id)}><Trash2 className="h-4 w-4" /></Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </div>
      </div>

      {invites.length > 0 && (
        <div className="dash-card p-4">
          <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
          <div className="flex flex-col gap-1.5">
            {invites.map((i) => (
              <div key={i.email} className="flex items-center justify-between text-sm">
                <span>{i.email}</span>
                <span className="text-xs text-muted-foreground">{roleLabel(i.role)} · invited {new Date(i.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeInvite())}>
        <DialogContent className="max-w-md">
          {inviteUrl ? (
            <>
              <DialogHeader><DialogTitle>Invite created</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Email delivery wasn&apos;t configured — share this link directly (expires in 24h).</p>
              <div className="break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">{inviteUrl}</div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy</>}</Button>
                <Button onClick={closeInvite}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>Invite member</DialogTitle></DialogHeader>
              <div className="space-y-4 py-1">
                <div className="space-y-1.5"><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Role</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1.5"><Label>Scope</Label>
                    <Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="org">Whole org</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeInvite} disabled={busy}>Cancel</Button>
                <Button onClick={invite} disabled={busy || !email.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send invite</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove member?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">They&apos;ll lose access to this organization immediately.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmId && remove(confirmId)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
