"use client";

import { usePathname } from "next/navigation";
import { Server } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useScope } from "@/hooks/useScope";
import { ENV_OPTIONS, type EnvKey } from "@/lib/scope";
import { parseProjectPath } from "@/lib/nav";

const ENV_LABELS: Record<EnvKey, string> = {
  all: "All envs", production: "Production", staging: "Staging", development: "Development",
};

/** Environment switcher — project tier only (org tier filters env via the scope bar). */
export function EnvSwitcher() {
  const pathname = usePathname();
  const { scope, setScope } = useScope();
  if (!parseProjectPath(pathname)) return null;

  return (
    <Select value={scope.env} onValueChange={(v) => setScope({ env: v as EnvKey })}>
      <SelectTrigger className="h-8 w-[140px] text-xs">
        <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ENV_OPTIONS.map((e) => (
          <SelectItem key={e} value={e}>{ENV_LABELS[e]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
