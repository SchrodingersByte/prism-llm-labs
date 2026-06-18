"use client";

import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useCanManage } from "@/components/layout/role-context";
import {
  BudgetForecast, BudgetStats, VendorTable, InfraBreakdown,
  CostCenters, EfficiencyPanel, AnomalyWatchlist, VectorDbPanel,
} from "@/components/finops/panels";

export default function FinOpsPage() {
  const canManage = useCanManage();

  return (
    <div>
      <PageHeader title="FinOps" description="Vendor spend, budgets, cost centers, and unified infrastructure costs." />
      {!canManage ? (
        <div className="p-5">
          <EmptyState
            icon={Banknote}
            title="FinOps is manager-only"
            description="Vendor spend, budgets, and cost-center chargeback are available to organization owners and admins. Ask an admin if you need access."
          />
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3 p-5">
          <div className="col-span-12 lg:col-span-8"><BudgetForecast /></div>
          <div className="col-span-12 lg:col-span-4"><BudgetStats /></div>
          <div className="col-span-12 lg:col-span-8"><VendorTable /></div>
          <div className="col-span-12 lg:col-span-4"><InfraBreakdown /></div>
          <div className="col-span-12 lg:col-span-6"><CostCenters /></div>
          <div className="col-span-12 lg:col-span-6"><EfficiencyPanel /></div>
          <div className="col-span-12 lg:col-span-6"><AnomalyWatchlist /></div>
          <div className="col-span-12 lg:col-span-6"><VectorDbPanel /></div>
        </div>
      )}
    </div>
  );
}
