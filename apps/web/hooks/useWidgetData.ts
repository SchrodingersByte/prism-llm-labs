"use client";

import { useQuery } from "@tanstack/react-query";
import { scopeKey, type Scope } from "@/lib/scope";

/**
 * react-query wrapper for widget data. Keyed by data `source` (not widget id) so
 * multiple widgets backed by the same pipe (e.g. four KPI cards off `overview`)
 * dedupe to a single request. Re-fetches when scope (range/env/project filter) or
 * the route projectId changes.
 */
export function useWidgetData<T>(
  source: string,
  scope: Scope,
  projectId: string | undefined,
  fetcher: (scope: Scope, projectId?: string, signal?: AbortSignal) => Promise<T>,
) {
  return useQuery({
    queryKey: ["metrics", source, scopeKey(scope), projectId ?? ""],
    queryFn: ({ signal }) => fetcher(scope, projectId, signal),
    staleTime: 30_000,
  });
}
