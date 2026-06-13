/**
 * Typed metric fetchers. Response shapes are reused (type-only) from the
 * server query layer in lib/tinybird/queries.ts — a single source of truth.
 * All /api/metrics/* routes return `{ data }` and accept from/to/project_id/environment.
 *
 * `projectId` is passed explicitly in the project tier (from the route); in the org
 * tier it's omitted and the server resolves scope (incl. developer project clamping).
 */
import type {
  OverviewMetrics,
  ModelSpend,
  TimeseriesPoint,
  ProjectSpend,
} from "@/lib/tinybird/queries";
import { apiGet } from "./client";
import { toQueryParams, type Scope } from "@/lib/scope";

type Wrapped<T> = { data: T };

export function fetchOverview(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<OverviewMetrics | null> {
  return apiGet<Wrapped<OverviewMetrics | null>>("/api/metrics/overview", toQueryParams(scope, projectId), signal).then((r) => r.data);
}

export function fetchSpendByModel(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<ModelSpend[]> {
  return apiGet<Wrapped<ModelSpend[]>>("/api/metrics/models", toQueryParams(scope, projectId), signal).then((r) => r.data ?? []);
}

export function fetchTimeseriesDaily(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<TimeseriesPoint[]> {
  return apiGet<Wrapped<TimeseriesPoint[]>>("/api/metrics/timeseries", toQueryParams(scope, projectId), signal).then((r) => r.data ?? []);
}

export function fetchSpendByProject(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<ProjectSpend[]> {
  return apiGet<Wrapped<ProjectSpend[]>>("/api/metrics/projects", toQueryParams(scope, projectId), signal).then((r) => r.data ?? []);
}
