"use client";

import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/patterns/EmptyState";
import { useCanManage } from "@/components/layout/role-context";
import { Training } from "@/components/spend/Training";

export default function TrainingSpendPage() {
  const canManage = useCanManage();
  if (!canManage) {
    return (
      <div className="p-5">
        <EmptyState
          icon={GraduationCap}
          title="Training spend is manager-only"
          description="Per-run training and fine-tune costs are available to organization owners and admins."
        />
      </div>
    );
  }
  return <Training />;
}
