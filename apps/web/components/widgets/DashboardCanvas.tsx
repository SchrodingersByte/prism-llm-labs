"use client";

import { getWidget, type WidgetSize } from "./registry";
import { useScope } from "@/hooks/useScope";

const SPAN: Record<WidgetSize, string> = {
  sm: "col-span-12 sm:col-span-6 lg:col-span-3",
  md: "col-span-12 lg:col-span-6",
  lg: "col-span-12",
};

/**
 * Renders a dashboard view (an ordered list of widget ids) into a 12-col grid.
 * Scope (range/env/project filter) comes from the URL; `projectId` (project tier)
 * is passed to every widget so its data is scoped to the route's project.
 */
export function DashboardCanvas({ widgetIds, projectId }: { widgetIds: string[]; projectId?: string }) {
  const { scope } = useScope();
  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      {widgetIds.map((id, i) => {
        const def = getWidget(id);
        if (!def) return null;
        const W = def.Component;
        return (
          <div key={`${id}-${i}`} className={SPAN[def.size]}>
            <W scope={scope} projectId={projectId} />
          </div>
        );
      })}
    </div>
  );
}
