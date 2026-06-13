"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { apiGet } from "@/lib/api/client";
import { parseProjectPath, projectHref } from "@/lib/nav";

interface ProjectLite { id: string; name: string }

/** Breadcrumb project switcher — only renders in the project tier. */
export function ProjectSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const ctx = parseProjectPath(pathname);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: () => apiGet<{ data: ProjectLite[] }>("/api/projects").then((r) => r.data ?? []),
    staleTime: 60_000,
    enabled: !!ctx,
  });

  if (!ctx) return null;
  const current = projects.find((p) => p.id === ctx.id);

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
            <DropdownMenuItem key={p.id} onClick={() => router.push(projectHref(p.id, ctx.section))}>
              <span className="truncate">{p.name}</span>
              {p.id === ctx.id && <Check className="ml-auto h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
