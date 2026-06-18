"use client";

import { PageHeader } from "@/components/patterns/PageHeader";
import { DashboardCanvas } from "@/components/widgets/DashboardCanvas";
import { useProject } from "@/components/layout/project-context";

const SPEND_WIDGETS = [
  "kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors",
  "spend-trend", "top-models", "cache-gauge", "token-scatter", "efficiency",
];

export default function ProjectSpendPage() {
  const project = useProject();
  return (
    <div>
      <PageHeader title="Spend" description={`Cost, tokens, and efficiency for ${project.name}.`} />
      <div className="p-5">
        <DashboardCanvas widgetIds={SPEND_WIDGETS} projectId={project.id} />
      </div>
    </div>
  );
}
