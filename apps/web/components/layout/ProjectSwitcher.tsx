"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost } from "@/lib/api/client";
import { parseProjectPath, projectHref } from "@/lib/nav";

interface ProjectLite { id: string; name: string }

/** Breadcrumb project switcher — only renders in the project tier. */
export function ProjectSwitcher({ canManage }: { canManage?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const ctx = parseProjectPath(pathname);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: () => apiGet<{ data: ProjectLite[] }>("/api/projects").then((r) => r.data ?? []),
    staleTime: 60_000,
    enabled: !!ctx,
  });

  if (!ctx) return null;
  const section = ctx.section;
  const activeId = ctx.id;
  const current = projects.find((p) => p.id === activeId);

  async function createProject() {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const res = await apiPost<{ data: { id: string } }>("/api/projects", { name: n });
      toast.success("Project created");
      setCreateOpen(false);
      setName("");
      await qc.invalidateQueries({ queryKey: ["projects-scope"] });
      if (res?.data?.id) router.push(projectHref(res.data.id, section));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <span className="text-sm text-muted-foreground">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 gap-2 px-2">
            <span className="max-w-[160px] truncate text-sm font-medium">{current?.name ?? "Project"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => router.push(projectHref(p.id, section))}>
              <span className="truncate">{p.name}</span>
              {p.id === activeId && <Check className="ml-auto h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCreateOpen(true); }}>
                <Plus className="h-4 w-4" />
                Create project
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="switcher-proj-name">Name</Label>
            <Input
              id="switcher-proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="Customer support bot"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createProject} disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
