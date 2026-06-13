"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, MoreHorizontal, FolderKanban, Trash2, ShieldCheck, User, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";
import { cn } from "@/lib/utils";

type Role = "owner" | "administrator" | "developer" | "read_only";
type InvitableRole = "administrator" | "developer" | "read_only";
interface Member { user_id: string; email: string; name: string; role: Role | null; scope_type?: string; joined_at: string; projects: { id: string; name: string }[] }
interface Invite { email: string; role: string | null; created_at: string }
interface MembersResp { members: Member[]; invites: Invite[] }
interface Project { id: string; name: string }

const ROLE_VARIANT: Record<Role, BadgeProps["variant"]> = {
  owner: "violet", administrator: "info", developer: "secondary", read_only: "outline",
};
const roleLabel = (r: Role | null) => (r === null ? "project" : r === "read_only" ? "read-only" : r);

export default function TeamsPage() {
  const isOwner = useRole() === "owner";
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["team-members"] });

  const { data, isLoading } = useQuery({ queryKey: ["team-members"], queryFn: () => apiGet<MembersResp>("/api/team/members") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects-scope"], queryFn: () => apiGet<{ data: Project[] }>("/api/projects").then((r) => r.data ?? []), staleTime: 60_000 });

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("developer");
  const [inviteProject, setInviteProject] = useState("none");
  const [busy, setBusy] = useState(false);

  // Assign-projects dialog
  const [assignFor, setAssignFor] = useState<Member | null>(null);
  const [assignSel, setAssignSel] = useState<Set<string>>(new Set());

  // Remove confirm
  const [removeFor, setRemoveFor] = useState<Member | null>(null);

  async function invite() {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/team/invite", { email: email.trim(), role: inviteRole, project_id: inviteProject === "none" ? undefined : inviteProject });
      toast.success(`Invite sent to ${email.trim()}`);
      setInviteOpen(false); setEmail(""); setInviteRole("developer"); setInviteProject("none");
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't send invite"); }
    finally { setBusy(false); }
  }

  async function changeRole(m: Member, role: InvitableRole) {
    try { await apiPatch(`/api/team/members/${m.user_id}`, { role }); toast.success(`${m.name || m.email} is now ${roleLabel(role)}`); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't change role"); }
  }

  async function saveAssignments() {
    if (!assignFor) return;
    setBusy(true);
    try {
      await apiPut(`/api/team/members/${assignFor.user_id}/projects`, { project_ids: Array.from(assignSel) });
      toast.success("Project access updated");
      setAssignFor(null);
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update access"); }
    finally { setBusy(false); }
  }

  async function removeMember() {
    if (!removeFor) return;
    setBusy(true);
    try { await apiDelete(`/api/team/members/${removeFor.user_id}`); toast.success("Member removed"); setRemoveFor(null); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't remove member"); }
    finally { setBusy(false); }
  }

  function openAssign(m: Member) {
    setAssignSel(new Set(m.projects.map((p) => p.id)));
    setAssignFor(m);
  }

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Members, roles, and project access for this workspace."
        actions={
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild><Button size="sm"><UserPlus className="h-4 w-4" />Invite member</Button></DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Invite a member</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-email">Email</Label>
                  <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as InvitableRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="developer">Developer — writes within scope</SelectItem>
                      <SelectItem value="read_only">Read-only — views, no writes</SelectItem>
                      <SelectItem value="administrator">Administrator — manages org resources</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inviteRole === "developer" && (
                  <div className="space-y-1.5">
                    <Label>Assign to project (optional)</Label>
                    <Select value={inviteProject} onValueChange={setInviteProject}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No project yet</SelectItem>
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={invite} disabled={busy || !email.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-6 p-5">
        {/* Members */}
        <section className="dash-card overflow-hidden">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {(data?.members ?? []).map((m) => {
                const canRemove  = m.role !== "owner";
                const canPromote = isOwner && m.role !== "owner" && m.role !== "administrator";
                const canDemote  = isOwner && m.role === "administrator";
                const canAssign  = m.role === "developer" || m.role === "read_only" || m.scope_type === "project";
                const hasMenu = canRemove || canPromote || canDemote || canAssign;
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar className="h-8 w-8"><AvatarFallback className="bg-primary/15 text-primary">{(m.name || m.email || "··").slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{m.name || m.email}</span>
                        <Badge variant={ROLE_VARIANT[m.role ?? "developer"]}>{roleLabel(m.role)}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {(m.projects?.length ?? 0) > 0 && (
                      <div className="hidden items-center gap-1 sm:flex">
                        {m.projects.slice(0, 3).map((p) => <Badge key={p.id} variant="outline">{p.name}</Badge>)}
                        {m.projects.length > 3 && <span className="text-xs text-muted-foreground">+{m.projects.length - 3}</span>}
                      </div>
                    )}
                    {hasMenu && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Member actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {canAssign && <DropdownMenuItem onClick={() => openAssign(m)}><FolderKanban className="h-4 w-4" />Assign projects</DropdownMenuItem>}
                          {canPromote && <DropdownMenuItem onClick={() => changeRole(m, "administrator")}><ShieldCheck className="h-4 w-4" />Make administrator</DropdownMenuItem>}
                          {canDemote && <DropdownMenuItem onClick={() => changeRole(m, "developer")}><User className="h-4 w-4" />Make developer</DropdownMenuItem>}
                          {canRemove && <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setRemoveFor(m)}><Trash2 className="h-4 w-4" />Remove</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Pending invites */}
        {(data?.invites?.length ?? 0) > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Pending invites</h3>
            <div className="dash-card divide-y divide-border">
              {data!.invites.map((inv) => (
                <div key={inv.email} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 truncate text-sm">{inv.email}</span>
                  <Badge variant="secondary">{roleLabel(inv.role as Role | null)}</Badge>
                  <span className="text-xs text-muted-foreground">invited</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Assign projects dialog */}
      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Project access</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{assignFor?.name || assignFor?.email} will be scoped to the projects you select.</p>
          <div className="max-h-64 space-y-1 overflow-y-auto dash-scroll">
            {projects.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No projects yet.</p> : projects.map((p) => {
              const on = assignSel.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => setAssignSel((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors", on ? "bg-primary/10 text-primary" : "hover:bg-muted")}
                >
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveAssignments} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <ConfirmDialog
        open={!!removeFor}
        onOpenChange={(o) => !o && setRemoveFor(null)}
        title={`Remove ${removeFor?.name || removeFor?.email}?`}
        description="They'll lose access to this workspace and all assigned projects. This can't be undone."
        confirmLabel="Remove"
        destructive
        pending={busy}
        onConfirm={removeMember}
      />
    </div>
  );
}
