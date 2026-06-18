"use client";

import { Plug } from "lucide-react";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useRole } from "@/components/layout/role-context";
import { ProviderKeysPanel, RoutingPanel, ConnectionsPanel } from "@/components/integrations/panels";

export default function IntegrationsPage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";

  if (!canManage) {
    return (
      <div className="p-5">
        <EmptyState icon={Plug} title="Integrations are manager-only" description="Provider keys, routing, and cloud-billing connections are managed by organization owners and admins." />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      <div className="col-span-12"><ProviderKeysPanel /></div>
      <div className="col-span-12 lg:col-span-7"><RoutingPanel /></div>
      <div className="col-span-12 lg:col-span-5"><ConnectionsPanel /></div>
    </div>
  );
}
