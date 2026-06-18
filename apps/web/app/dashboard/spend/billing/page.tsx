"use client";

import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useCanManage } from "@/components/layout/role-context";
import { Billing } from "@/components/spend/Billing";

export default function BillingPage() {
  const canManage = useCanManage();
  if (!canManage) {
    return (
      <div className="p-5">
        <EmptyState
          icon={CreditCard}
          title="Billing reconciliation is manager-only"
          description="Comparing Prism-tracked spend against provider invoices is available to organization owners and admins."
        />
      </div>
    );
  }
  return <Billing />;
}
