import { parseAsString, parseAsStringEnum } from "nuqs";
import { subDays, subHours, format } from "date-fns";

/**
 * Global dashboard scope — the filters that apply across every widget/page.
 * Carried in the URL (via nuqs) so views are shareable and back-button correct.
 * Org scope is resolved server-side from the session (active_org_id), not here.
 *
 * This module is isomorphic (no "use client", no server-only imports): the
 * client hook lives in hooks/useScope.ts, the RSC cache in lib/scope-server.ts.
 */

export const RANGE_OPTIONS = ["24h", "7d", "30d", "90d"] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number];

export const ENV_OPTIONS = ["all", "production", "staging", "development"] as const;
export type EnvKey = (typeof ENV_OPTIONS)[number];

export interface Scope {
  project: string; // project_id, or "all"
  range:   RangeKey;
  env:     EnvKey;
}

/** nuqs parsers — isomorphic, safe to import from both client and server. */
export const scopeParsers = {
  project: parseAsString.withDefault("all"),
  range:   parseAsStringEnum([...RANGE_OPTIONS]).withDefault("7d"),
  env:     parseAsStringEnum([...ENV_OPTIONS]).withDefault("all"),
};

export const RANGE_LABELS: Record<RangeKey, string> = {
  "24h": "Last 24 hours",
  "7d":  "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const CH_FORMAT = "yyyy-MM-dd HH:mm:ss"; // ClickHouse / Tinybird datetime format

export interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  granularity: "hour" | "day";
}

/** Convert a range key into concrete from/to bounds in the format the API expects. */
export function resolveRange(range: RangeKey): ResolvedRange {
  const now = new Date();
  switch (range) {
    case "24h": return { from: format(subHours(now, 24), CH_FORMAT), to: format(now, CH_FORMAT), days: 1,  granularity: "hour" };
    case "30d": return { from: format(subDays(now, 30),  CH_FORMAT), to: format(now, CH_FORMAT), days: 30, granularity: "day" };
    case "90d": return { from: format(subDays(now, 90),  CH_FORMAT), to: format(now, CH_FORMAT), days: 90, granularity: "day" };
    case "7d":
    default:    return { from: format(subDays(now, 7),   CH_FORMAT), to: format(now, CH_FORMAT), days: 7,  granularity: "day" };
  }
}

/**
 * Map a Scope to the query params the /api/metrics/* routes accept
 * (from / to / project_id / environment). In the project tier, pass the route's
 * project id via `projectId` to override the global project filter.
 */
export function toQueryParams(scope: Scope, projectId?: string): Record<string, string> {
  const { from, to } = resolveRange(scope.range);
  const params: Record<string, string> = { from, to };
  const pid = projectId ?? (scope.project !== "all" ? scope.project : "");
  if (pid) params.project_id = pid;
  if (scope.env && scope.env !== "all") params.environment = scope.env;
  return params;
}

/** Stable react-query key fragment for a scope (so widgets refetch when scope changes). */
export function scopeKey(scope: Scope): string {
  return `${scope.project}:${scope.range}:${scope.env}`;
}
