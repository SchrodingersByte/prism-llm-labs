"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";
import { DashboardCanvas } from "@/components/widgets/DashboardCanvas";
import { DEFAULT_ORG_VIEW } from "@/components/widgets/registry";
import { useCanManage } from "@/components/layout/role-context";
import { apiGet } from "@/lib/api/client";

export default function OverviewPage() {
  const canManage = useCanManage();

  // Developers with zero assigned projects get an empty state, not the org dashboard.
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: () => apiGet<{ data: { id: string }[] }>("/api/projects").then((r) => r.data ?? []),
    staleTime: 60_000,
  });
  const devNoProjects = !canManage && !isLoading && (projects?.length ?? 0) === 0;

  return (
    <div>
      <PageHeader title="Overview" description="Organization-wide cost, usage, and performance." />
      {devNoProjects ? (
        <div className="p-5">
          <EmptyState
            icon={FolderKanban}
            title="No projects assigned"
            description="You haven't been assigned to any projects yet. Ask an org owner or admin to add you — your metrics will appear here once you are."
          />
        </div>
      ) : (
        <DashboardCanvas widgetIds={DEFAULT_ORG_VIEW} />
      )}
    </div>
  );
}
