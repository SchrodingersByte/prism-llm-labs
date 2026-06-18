"use client";

import { TriageRow } from "@/components/dashboard/TriageRow";
import { CustomizeRail } from "@/components/dashboard/CustomizeRail";
import { DashboardCanvas } from "@/components/widgets/DashboardCanvas";
import { DEFAULT_ORG_VIEW, DEFAULT_PROJECT_VIEW } from "@/components/widgets/registry";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";

/**
 * The org "Command Center" landing (and the project-tier mirror when `projectId`
 * is set): a fixed Triage zone over a per-user customizable widget canvas.
 */
export function CommandCenter({ projectId }: { projectId?: string }) {
  const isProject = !!projectId;
  const { ids, setIds, reset } = useDashboardLayout(
    isProject ? "project" : "org",
    isProject ? DEFAULT_PROJECT_VIEW : DEFAULT_ORG_VIEW,
  );

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-end">
        <CustomizeRail ids={ids} onChange={setIds} onReset={reset} />
      </div>
      {/* Triage is an org-level signal (budgets, firing alerts are org-wide). */}
      {!isProject && <TriageRow />}
      <DashboardCanvas widgetIds={ids} projectId={projectId} />
    </div>
  );
}
