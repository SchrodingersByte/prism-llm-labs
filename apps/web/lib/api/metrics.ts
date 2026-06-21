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
  AnomalyPoint,
  ProviderSpend,
  EfficiencyPoint,
  SessionCostDistribution,
  FeatureSpend,
  McpOverviewMetrics,
  CostCenterSpend,
  InfraCostCategory,
  VectorDbResourceRow,
  ActionSpend,
  WorkloadSpend,
  TeamSpend,
  BranchSpend,
  TrainingCostSummary,
  CustomerDailyPoint,
  CustomerModelBreakdown,
  McpServerSpend,
  McpToolSpend,
  AgentLoopRow,
  SessionListRow,
} from "@/lib/tinybird/queries";
import { apiGet, ApiError } from "./client";
import { toQueryParams, toPreviousQueryParams, type Scope } from "@/lib/scope";

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

// ── Command Center: triage + period-over-period deltas ──────────────────────

/** Current window + the prior equal-length window, for KPI deltas. */
export interface OverviewComparison {
  current:  OverviewMetrics | null;
  previous: OverviewMetrics | null;
}

export function fetchOverviewComparison(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<OverviewComparison> {
  return Promise.all([
    apiGet<Wrapped<OverviewMetrics | null>>("/api/metrics/overview", toQueryParams(scope, projectId), signal).then((r) => r.data ?? null),
    apiGet<Wrapped<OverviewMetrics | null>>("/api/metrics/overview", toPreviousQueryParams(scope, projectId), signal).then((r) => r.data ?? null),
  ]).then(([current, previous]) => ({ current, previous }));
}

/** Latest statistical spend spikes (anomaly_detection pipe). Org-scoped server-side. */
export function fetchAnomalies(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<AnomalyPoint[]> {
  return apiGet<{ anomalies: AnomalyPoint[] }>("/api/metrics/anomalies", toQueryParams(scope, projectId), signal).then((r) => r.anomalies ?? []);
}

export interface BudgetStatus {
  spend_usd:             number;
  limit_usd:             number | null;
  utilization_pct:       number | null;
  budget_status:         "on_track" | "at_risk" | "over_budget";
  projected_month_end:   number;
  projected_overage:     number;
  days_remaining:        number;
  daily_burn_rate:       number;
  rolling_7d_burn_rate:  number;
  forecast_series:       { date: string; projected_cumulative: number; is_actual: boolean }[];
  project_budgets:       { project_id: string; project_name: string; limit_usd: number; enforce_hard: boolean }[];
}

/** Org budget status. Org-manager-only server-side → null for developers (403). */
export function fetchBudgetStatus(signal?: AbortSignal): Promise<BudgetStatus | null> {
  return apiGet<BudgetStatus>("/api/metrics/budget-status", undefined, signal).catch((e) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  });
}

export interface AlertRule {
  id:            string;
  name:          string;
  trigger_type:  string;
  is_active:     boolean;
  last_fired_at: string | null;
  project_id:    string | null;
}

export function fetchAlerts(signal?: AbortSignal): Promise<AlertRule[]> {
  return apiGet<Wrapped<AlertRule[]>>("/api/alerts", undefined, signal)
    .then((r) => r.data ?? [])
    .catch((e) => {
      if (e instanceof ApiError && e.status === 403) return [];
      throw e;
    });
}

// ── Customization palette widgets (manager-only routes resolve to empty for devs) ──

const emptyOn403 = <T>(fallback: T) => (e: unknown): T => {
  if (e instanceof ApiError && (e.status === 403 || e.status === 402 || e.status === 404)) return fallback;
  throw e;
};

export function fetchSpendByProvider(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<ProviderSpend[]> {
  return apiGet<Wrapped<ProviderSpend[]>>("/api/metrics/vendors", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<ProviderSpend[]>([]));
}

export function fetchEfficiency(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<EfficiencyPoint[]> {
  return apiGet<Wrapped<EfficiencyPoint[]>>("/api/metrics/efficiency", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<EfficiencyPoint[]>([]));
}

export function fetchSessionDistribution(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<SessionCostDistribution | null> {
  return apiGet<Wrapped<SessionCostDistribution | null>>("/api/metrics/session-distribution", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? null).catch(emptyOn403<SessionCostDistribution | null>(null));
}

export function fetchSpendByFeature(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<FeatureSpend[]> {
  return apiGet<{ features: FeatureSpend[] }>("/api/metrics/features", toQueryParams(scope, projectId), signal)
    .then((r) => r.features ?? []).catch(emptyOn403<FeatureSpend[]>([]));
}

export function fetchMcpOverview(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<McpOverviewMetrics | null> {
  return apiGet<Wrapped<McpOverviewMetrics | null>>("/api/metrics/mcp/overview", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? null).catch(emptyOn403<McpOverviewMetrics | null>(null));
}

export interface ProviderHealthRow {
  provider:        string;
  error_rate:      number;
  status:          "ok" | "warning" | "degraded";
  model_latencies: { model: string; latency_ms: number | null }[];
}

export function fetchProviderHealth(signal?: AbortSignal): Promise<ProviderHealthRow[]> {
  return apiGet<Wrapped<ProviderHealthRow[]>>("/api/metrics/provider-health", undefined, signal)
    .then((r) => r.data ?? []).catch(emptyOn403<ProviderHealthRow[]>([]));
}

/** Org projects (Supabase metadata) — listed even when they have zero Tinybird spend. */
export interface ProjectMeta {
  id:                 string;
  name:               string;
  description:        string | null;
  monthly_budget_usd: number | null;
  created_at:         string;
}

export function fetchProjects(signal?: AbortSignal): Promise<ProjectMeta[]> {
  return apiGet<Wrapped<ProjectMeta[]>>("/api/projects", undefined, signal).then((r) => r.data ?? []);
}

// ── FinOps detail sources (all org-manager-only routes) ─────────────────────

export function fetchSpendByCostCenter(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<CostCenterSpend[]> {
  return apiGet<Wrapped<CostCenterSpend[]>>("/api/metrics/cost-centers", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<CostCenterSpend[]>([]));
}

export function fetchInfraBreakdown(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<InfraCostCategory[]> {
  return apiGet<Wrapped<InfraCostCategory[]>>("/api/metrics/infra-breakdown", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<InfraCostCategory[]>([]));
}

export interface VectorDbReconciled { resource: string; total_actual_usd: number; operations: Record<string, number> }
export interface VectorDbBreakdown { estimated: VectorDbResourceRow[]; reconciled: VectorDbReconciled[] }

export function fetchVectorDb(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<VectorDbBreakdown> {
  return apiGet<VectorDbBreakdown>("/api/metrics/vector-db", toQueryParams(scope, projectId), signal)
    .catch(emptyOn403<VectorDbBreakdown>({ estimated: [], reconciled: [] }));
}

// ── Unit economics (features/actions + outcomes are org-manager-only) ────────

export interface UnitEconTags { features: FeatureSpend[]; actions: ActionSpend[] }

export function fetchUnitEconTags(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<UnitEconTags> {
  return apiGet<UnitEconTags>("/api/metrics/features", toQueryParams(scope, projectId), signal)
    .catch(emptyOn403<UnitEconTags>({ features: [], actions: [] }));
}

export interface OutcomeMetricsRow {
  feature_tag:             string;
  total_cost_usd:          number;
  total_requests:          number;
  successful_outcomes:     number;
  failed_outcomes:         number;
  total_value_usd:         number;
  actual_cost_per_success: number;
  roi_ratio:               number;
}
export interface OutcomeBreakdown { with_outcomes: OutcomeMetricsRow[]; without_outcomes: OutcomeMetricsRow[] }

export function fetchOutcomes(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<OutcomeBreakdown> {
  return apiGet<OutcomeBreakdown>("/api/metrics/outcomes", toQueryParams(scope, projectId), signal)
    .catch(emptyOn403<OutcomeBreakdown>({ with_outcomes: [], without_outcomes: [] }));
}

// ── Spend attribution dimensions ────────────────────────────────────────────

export function fetchSpendByWorkload(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<WorkloadSpend[]> {
  return apiGet<Wrapped<WorkloadSpend[]>>("/api/metrics/workload", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<WorkloadSpend[]>([]));
}

export function fetchSpendByTeam(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<TeamSpend[]> {
  return apiGet<Wrapped<TeamSpend[]>>("/api/metrics/team", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<TeamSpend[]>([]));
}

export function fetchSpendByBranch(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<BranchSpend[]> {
  return apiGet<Wrapped<BranchSpend[]>>("/api/metrics/branches", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<BranchSpend[]>([]));
}

// ── Billing reconciliation (Prism-tracked vs provider-billed) — manager-only ──

export interface ReconciliationRow {
  provider:          string;
  model:             string;
  prism_cost:        number;
  prism_tokens:      number;
  prism_requests:    number;
  provider_cost:     number | null;
  provider_tokens:   number | null;
  provider_requests: number | null;
  coverage_pct:      number | null;
}
export interface ReconciliationResult {
  data:               ReconciliationRow[];
  has_provider_data:  boolean;
  has_per_model_keys: boolean;
}

export function fetchReconciliation(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<ReconciliationResult> {
  return apiGet<ReconciliationResult>("/api/metrics/reconciliation", toQueryParams(scope, projectId), signal)
    .catch(emptyOn403<ReconciliationResult>({ data: [], has_provider_data: false, has_per_model_keys: false }));
}

export function fetchTrainingCostSummary(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<TrainingCostSummary[]> {
  return apiGet<Wrapped<TrainingCostSummary[]>>("/api/metrics/training", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<TrainingCostSummary[]>([]));
}

// ── Customers / P&L (manager-only; revenue ingestion is a backend gap) ──────

export interface CustomerRow {
  id:                  string;
  customer_id:         string;
  display_name:        string | null;
  monthly_spend_usd:   number | null;
  monthly_token_limit: number | null;
  is_active:           boolean;
  current_cost_usd:    number;
  current_tokens:      number;
  requests:            number;
  utilization_pct:     number | null;
  status:              string;
}

export function fetchCustomers(signal?: AbortSignal): Promise<CustomerRow[]> {
  return apiGet<Wrapped<CustomerRow[]>>("/api/metrics/customers", undefined, signal)
    .then((r) => r.data ?? []).catch(emptyOn403<CustomerRow[]>([]));
}

export function fetchCustomerDaily(customerId: string, scope: Scope, signal?: AbortSignal): Promise<CustomerDailyPoint[]> {
  return apiGet<Wrapped<CustomerDailyPoint[]>>(`/api/metrics/customers/${customerId}/daily`, toQueryParams(scope), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<CustomerDailyPoint[]>([]));
}

export function fetchCustomerModels(customerId: string, scope: Scope, signal?: AbortSignal): Promise<CustomerModelBreakdown[]> {
  return apiGet<Wrapped<CustomerModelBreakdown[]>>(`/api/metrics/customers/${customerId}/models`, toQueryParams(scope), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<CustomerModelBreakdown[]>([]));
}

// ── Quality (PRD-1; online-eval scores) ─────────────────────────────────────

export interface QualityTimeseriesPoint { date: string; scores: number; avg_score: number; pass_rate: number }
export interface QualityByModelRow { model: string; avg_score: number; pass_rate: number; scores: number }
export interface QualityByScorerRow { scorer_type: string; avg_score: number; pass_rate: number; scores: number }
export interface QualityResult {
  timeseries:   QualityTimeseriesPoint[];
  by_model:     QualityByModelRow[];
  by_scorer:    QualityByScorerRow[];
  latest:       { date: string; avg_score: number; pass_rate: number } | null;
  total_scores: number;
}

const RANGE_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

export function fetchQuality(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<QualityResult> {
  const params: Record<string, string> = { days: String(RANGE_DAYS[scope.range] ?? 30) };
  const pid = projectId ?? (scope.project !== "all" ? scope.project : "");
  if (pid) params.project_id = pid;
  return apiGet<QualityResult>("/api/metrics/quality", params, signal)
    .catch(emptyOn403<QualityResult>({ timeseries: [], by_model: [], by_scorer: [], latest: null, total_scores: 0 }));
}

export interface DriftPoint { window_start: string; window_end: string; segment: string; segment_value: string | null; metric: string; value: number; sample_size: number; computed_at: string }
export interface DriftCluster { id: string; label: string; size: number; keywords: string[]; window_start: string; window_end: string; created_at: string }
export interface DriftResult { metrics: DriftPoint[]; latest: Record<string, number>; clusters: DriftCluster[] }

export function fetchDrift(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<DriftResult> {
  const params: Record<string, string> = { days: String(RANGE_DAYS[scope.range] ?? 30), segment: "all" };
  void projectId;
  return apiGet<DriftResult>("/api/metrics/drift", params, signal)
    .catch(emptyOn403<DriftResult>({ metrics: [], latest: {}, clusters: [] }));
}

export interface ErrorCluster { signature: string; source: string; occurrences: number; last_seen: string }

export function fetchErrorClusters(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<ErrorCluster[]> {
  const params: Record<string, string> = { days: String(RANGE_DAYS[scope.range] ?? 7) };
  const pid = projectId ?? (scope.project !== "all" ? scope.project : "");
  if (pid) params.project_id = pid;
  return apiGet<{ clusters: ErrorCluster[] }>("/api/metrics/errors", params, signal)
    .then((r) => r.clusters ?? []).catch(emptyOn403<ErrorCluster[]>([]));
}

// ── Agents / MCP (mcp_analytics-gated → empty for unentitled / developers) ───

export function fetchMcpServers(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<McpServerSpend[]> {
  return apiGet<Wrapped<McpServerSpend[]>>("/api/metrics/mcp/servers", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<McpServerSpend[]>([]));
}

export function fetchMcpTools(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<McpToolSpend[]> {
  return apiGet<Wrapped<McpToolSpend[]>>("/api/metrics/mcp/tools", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<McpToolSpend[]>([]));
}

/** Agent loop detection — owner/admin only (no project dimension) → empty otherwise. */
export function fetchAgentLoops(signal?: AbortSignal): Promise<AgentLoopRow[]> {
  return apiGet<Wrapped<AgentLoopRow[]>>("/api/metrics/mcp/loops", undefined, signal)
    .then((r) => r.data ?? []).catch(emptyOn403<AgentLoopRow[]>([]));
}

// ── Sessions list (session_costs / sessions_list pipe via /api/mcp/sessions) ──

export function fetchSessionsList(scope: Scope, projectId?: string, signal?: AbortSignal): Promise<SessionListRow[]> {
  return apiGet<Wrapped<SessionListRow[]>>("/api/mcp/sessions", toQueryParams(scope, projectId), signal)
    .then((r) => r.data ?? []).catch(emptyOn403<SessionListRow[]>([]));
}
