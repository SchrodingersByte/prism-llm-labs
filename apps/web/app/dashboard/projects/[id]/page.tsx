"use client";

import { PageHeader } from "@/components/patterns/PageHeader";
import { CommandCenter } from "@/components/dashboard/CommandCenter";
import { useProject } from "@/components/layout/project-context";

export default function ProjectOverviewPage() {
  const project = useProject();
  return (
    <div>
      <PageHeader title="Overview" description={`Metrics for ${project.name}, filtered by the selected environment.`} />
      <CommandCenter projectId={project.id} />
    </div>
  );
}
