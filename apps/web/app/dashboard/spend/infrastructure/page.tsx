"use client";

import { Server } from "lucide-react";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useCanManage } from "@/components/layout/role-context";
import { Infrastructure } from "@/components/spend/Infrastructure";

export default function InfrastructurePage() {
  const canManage = useCanManage();
  if (!canManage) {
    return (
      <div className="p-5">
        <EmptyState
          icon={Server}
          title="Infrastructure is manager-only"
          description="Unified infrastructure and vector-DB costs are available to organization owners and admins."
        />
      </div>
    );
  }
  return <Infrastructure />;
}
