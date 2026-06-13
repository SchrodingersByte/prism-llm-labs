"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { apiPatch } from "@/lib/api/client";

export interface OrgOption {
  id: string;
  name: string;
}

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: OrgOption[]; activeOrgId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  async function switchOrg(id: string) {
    if (id === activeOrgId || pending) return;
    setPending(true);
    try {
      await apiPatch("/api/user/active-org", { org_id: id });
      router.refresh();
      toast.success("Workspace switched");
    } catch {
      toast.error("Couldn't switch workspace");
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-2 px-2" disabled={pending}>
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[160px] truncate text-sm font-medium">{active?.name ?? "Workspace"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)}>
            <span className="truncate">{o.name}</span>
            {o.id === activeOrgId && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
