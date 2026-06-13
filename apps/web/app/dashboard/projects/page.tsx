"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api/client";
import { projectHref } from "@/lib/nav";
import { useCanManage } from "@/components/layout/role-context";

interface Project { id: string; name: string; description?: string | null; created_at?: string }

export default function ProjectsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCanManage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: () => apiGet<{ data: Project[] }>("/api/projects").then((r) => r.data ?? []),
  });

  async function create() {
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const res = await apiPost<{ data: { id: string } }>("/api/projects", { name: name.trim() });
      toast.success("Project created");
      setOpen(false);
      setName("");
      await qc.invalidateQueries({ queryKey: ["projects-scope"] });
      if (res?.data?.id) router.push(projectHref(res.data.id, ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create project");
    } finally {
      setPending(false);
    }
  }

  const createDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" />New project</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="proj-name">Name</Label>
          <Input
            id="proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Customer support bot"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={create} disabled={pending || !name.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Each project scopes its own keys, metrics, governance, and configuration."
        actions={canManage ? createDialog : undefined}
      />

      <div className="p-5">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : !projects || projects.length === 0 ? (
          canManage ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create your first project to start attributing spend, keys, and governance."
              action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New project</Button>}
            />
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="No projects assigned"
              description="You haven't been assigned to any projects yet. Ask an org owner or admin to add you to one."
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={projectHref(p.id, "")} className="group dash-card p-4 transition-colors hover:border-primary/40">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FolderKanban className="h-4 w-4" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-3 truncate text-sm font-medium">{p.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description || "No description"}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
