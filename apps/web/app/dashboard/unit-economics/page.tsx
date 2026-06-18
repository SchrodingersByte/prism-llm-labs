"use client";

import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useCanManage } from "@/components/layout/role-context";
import { UnitEconKpis, CostByFeature, CostByAction, RoiTable, SessionPercentiles } from "@/components/unit-economics/panels";
import { ActionDefinitions } from "@/components/unit-economics/ActionDefinitions";

export default function UnitEconomicsPage() {
  const canManage = useCanManage();

  return (
    <div>
      <PageHeader title="Unit Economics" description="Cost by feature and action, ROI per outcome, and session cost percentiles." />
      {!canManage ? (
        <div className="p-5">
          <EmptyState
            icon={Calculator}
            title="Unit Economics is manager-only"
            description="Cost-per-feature, cost-per-action, and ROI are available to organization owners and admins. Ask an admin if you need access."
          />
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3 p-5">
          <div className="col-span-12"><UnitEconKpis /></div>
          <div className="col-span-12 lg:col-span-6"><CostByFeature /></div>
          <div className="col-span-12 lg:col-span-6"><CostByAction /></div>
          <div className="col-span-12 lg:col-span-8"><RoiTable /></div>
          <div className="col-span-12 lg:col-span-4"><SessionPercentiles /></div>
          <div className="col-span-12"><ActionDefinitions /></div>
        </div>
      )}
    </div>
  );
}
