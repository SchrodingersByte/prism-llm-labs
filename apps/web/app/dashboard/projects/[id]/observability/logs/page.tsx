"use client";

import { LogsExplorer } from "@/components/observability/LogsExplorer";
import { useProject } from "@/components/layout/project-context";

export default function ProjectLogsPage() {
  const project = useProject();
  return <div className="p-5"><LogsExplorer projectId={project.id} /></div>;
}
