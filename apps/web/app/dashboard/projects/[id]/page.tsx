"use client";

import { PageHeader } from "@/components/patterns/PageHeader";
import { DashboardCanvas } from "@/components/widgets/DashboardCanvas";
import { DEFAULT_PROJECT_VIEW } from "@/components/widgets/registry";
import { useProject } from "@/components/layout/project-context";

export default function ProjectOverviewPage() {
  const project = useProject();
  return (
    <div>
      <PageHeader title="Overview" description={`Metrics for ${project.name}, filtered by the selected environment.`} />
      <DashboardCanvas widgetIds={DEFAULT_PROJECT_VIEW} projectId={project.id} />
    </div>
  );
}
