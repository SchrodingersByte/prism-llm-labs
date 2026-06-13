"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Clock, Server } from "lucide-react";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useScope } from "@/hooks/useScope";
import { apiGet } from "@/lib/api/client";
import { RANGE_OPTIONS, RANGE_LABELS, ENV_OPTIONS, type RangeKey, type EnvKey } from "@/lib/scope";
import { parseProjectPath } from "@/lib/nav";

interface ProjectLite { id: string; name: string }

const ENV_LABELS: Record<EnvKey, string> = {
  all: "All envs", production: "Production", staging: "Staging", development: "Development",
};

/**
 * Global scope filters. Context-aware: in the project tier the project + env
 * selectors are hidden (project comes from the route, env from the EnvSwitcher);
 * the range selector always shows.
 */
export function ScopeBar() {
  const pathname = usePathname();
  const inProject = !!parseProjectPath(pathname);
  const { scope, setScope } = useScope();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: () => apiGet<{ data: ProjectLite[] }>("/api/projects").then((r) => r.data ?? []),
    staleTime: 60_000,
    enabled: !inProject,
  });

  return (
    <div className="flex items-center gap-2">
      {!inProject && (
        <Select value={scope.project} onValueChange={(v) => setScope({ project: v })}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={scope.range} onValueChange={(v) => setScope({ range: v as RangeKey })}>
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((r) => (
            <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!inProject && (
        <Select value={scope.env} onValueChange={(v) => setScope({ env: v as EnvKey })}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENV_OPTIONS.map((e) => (
              <SelectItem key={e} value={e}>{ENV_LABELS[e]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
