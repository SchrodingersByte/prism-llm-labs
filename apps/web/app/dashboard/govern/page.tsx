import { ShieldHalf } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";

export default function GovernPage() {
  return (
    <div>
      <PageHeader title="Govern" description="Enforcement, model governance, routing, guardrails, and alerts." />
      <div className="p-5">
        <EmptyState
          icon={ShieldHalf}
          title="Governance Studio is coming together"
          description="Enforcement policies, model allow/block rules, routing, guardrails, and alerts land in Phase 4 of the rebuild."
        />
      </div>
    </div>
  );
}
