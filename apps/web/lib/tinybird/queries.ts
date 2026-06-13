import { queryTinybird, querySql } from "./client";

export interface OverviewMetrics {
  total_requests: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  avg_latency_ms: number;
  error_count: number;
  error_rate: number;
}

export interface ProjectSpend {
  project_id: string;
  project_name: string;
  cost_usd: number;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  avg_latency_ms: number;
}

export interface ModelSpend {
  model:                string;
  provider:             string;
  total_cost_usd:       number;
  requests:             number;
  input_tokens:         number;
  output_tokens:        number;
  cached_tokens:        number;
  avg_latency_ms:       number;
  error_count:          number;
  avg_cost_per_request: number;
  output_input_ratio:   number;
  cache_hit_rate:       number;
  tokens_per_dollar:    number;
  error_rate:           number;
}

export interface TeamSpend {
  user_id: string;
  team_id: string;
  cost_usd: number;
  requests: number;
  avg_latency_ms: number;
}

export interface TimeseriesPoint {
  date: string;
  cost_usd: number;
  requests: number;
  total_tokens: number;
}

export interface AnomalyPoint {
  date: string;
  daily_cost: number;
  rolling_7d_avg: number;
  spike_ratio: number;
}

export interface DashboardFilters {
  projectId?: string;
  /** Restrict to this set of projects (project_id IN (...)). Used to scope a
   *  developer to their assigned projects. Empty/undefined = no list filter. */
  projectIds?: string[];
  userId?: string;
  provider?: string;
  environment?: string;
}

export async function getOverviewMetrics(
  orgId: string,
  fromDate: string,
  toDate: string,
  filters: DashboardFilters = {},
): Promise<OverviewMetrics | null> {
  const rows = await queryTinybird("overview_metrics", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: filters.projectId ?? "",
    project_ids: (filters.projectIds ?? []).join(","),
    user_id:    filters.userId    ?? "",
    provider:   filters.provider  ?? "",
    environment: filters.environment ?? "",
  });
  return (rows[0] as OverviewMetrics) ?? null;
}

export async function getSpendByProject(
  orgId: string,
  fromDate: string,
  toDate: string,
  filters: DashboardFilters = {},
): Promise<ProjectSpend[]> {
  return queryTinybird("spend_by_project", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    user_id:    filters.userId    ?? "",
    provider:   filters.provider  ?? "",
    project_id: filters.projectId ?? "",
    project_ids: (filters.projectIds ?? []).join(","),
    environment: filters.environment ?? "",
  }) as Promise<ProjectSpend[]>;
}

export async function getSpendByModel(
  orgId: string,
  fromDate: string,
  toDate?: string,
  filters: DashboardFilters = {},
): Promise<ModelSpend[]> {
  const params: Record<string, string> = {
    org_id:      orgId,
    from_date:   fromDate,
    project_id:  filters.projectId ?? "",
    project_ids: (filters.projectIds ?? []).join(","),
    environment: filters.environment ?? "",
  };
  if (toDate) params.to_date = toDate;
  return queryTinybird("spend_by_model", params) as Promise<ModelSpend[]>;
}

export async function getSpendByTeam(
  orgId: string,
  fromDate: string,
  toDate: string,
  filters: DashboardFilters = {},
): Promise<TeamSpend[]> {
  return queryTinybird("spend_by_team", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: filters.projectId ?? "",
    user_id:    filters.userId    ?? "",
  }) as Promise<TeamSpend[]>;
}

export async function getTimeseriesDaily(
  orgId: string,
  projectId: string,
  fromDate: string,
  toDate: string,
  filters: DashboardFilters = {},
): Promise<TimeseriesPoint[]> {
  return queryTinybird("timeseries_daily", {
    org_id:     orgId,
    project_id: projectId || filters.projectId || "",
    project_ids: (filters.projectIds ?? []).join(","),
    from_date:  fromDate,
    to_date:    toDate,
    user_id:     filters.userId     ?? "",
    provider:    filters.provider    ?? "",
    environment: filters.environment ?? "",
  }) as Promise<TimeseriesPoint[]>;
}

export async function getAnomalies(orgId: string, filters: DashboardFilters = {}): Promise<AnomalyPoint[]> {
  return queryTinybird("anomaly_detection", {
    org_id:      orgId,
    project_id:  filters.projectId ?? "",
    project_ids: (filters.projectIds ?? []).join(","),
    environment: filters.environment ?? "",
  }) as Promise<AnomalyPoint[]>;
}

export interface KeySpend {
  api_key_id:    string;
  cost_usd:      number;
  requests:      number;
  input_tokens:  number;
  output_tokens: number;
  cached_tokens: number;
  image_tokens:  number;
  audio_tokens:  number;
  avg_latency_ms: number;
  error_count:   number;
}

export interface KeyTimeseriesPoint {
  date:          string;
  api_key_id:    string;
  cost_usd:      number;
  requests:      number;
  total_tokens:  number;
  image_tokens:  number;
  audio_tokens:  number;
}

export async function getSpendByKey(
  orgId: string,
  fromDate: string,
  toDate: string,
  apiKeyId?: string,
  projectId?: string,
): Promise<KeySpend[]> {
  return queryTinybird("spend_by_key", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    api_key_id: apiKeyId  ?? "",
    project_id: projectId ?? "",
  }) as Promise<KeySpend[]>;
}

export async function getKeyTimeseries(
  orgId: string,
  apiKeyId: string,
  fromDate: string,
  toDate: string,
): Promise<KeyTimeseriesPoint[]> {
  return queryTinybird("key_timeseries", {
    org_id:     orgId,
    api_key_id: apiKeyId,
    from_date:  fromDate,
    to_date:    toDate,
  }) as Promise<KeyTimeseriesPoint[]>;
}

export interface BranchSpend {
  branch:        string;
  commit_sha:    string;
  cost_usd:      number;
  requests:      number;
  total_tokens:  number;
  avg_latency_ms: number;
}

export async function getSpendByBranch(
  orgId: string,
  fromDate: string,
  toDate: string,
  projectId?: string,
  keyType?: string,
): Promise<BranchSpend[]> {
  return queryTinybird("spend_by_branch", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: projectId ?? "",
    key_type:   keyType   ?? "",
  }) as Promise<BranchSpend[]>;
}

/** Fetch spend aggregated for a single branch name. Returns null if no data. */
export async function getSpendByBranchName(
  orgId:      string,
  branchName: string,
  fromDate:   string,
  toDate:     string,
  projectId?: string,
): Promise<BranchSpend | null> {
  const all = await getSpendByBranch(orgId, fromDate, toDate, projectId);
  // Sum all commit rows for this branch (a branch can have many commits in the window)
  const rows = all.filter(r => r.branch === branchName);
  if (rows.length === 0) return null;
  return {
    branch:         branchName,
    commit_sha:     rows[rows.length - 1]!.commit_sha, // most recent commit
    cost_usd:       rows.reduce((s, r) => s + r.cost_usd, 0),
    requests:       rows.reduce((s, r) => s + r.requests, 0),
    total_tokens:   rows.reduce((s, r) => s + r.total_tokens, 0),
    avg_latency_ms: rows.reduce((s, r) => s + r.avg_latency_ms, 0) / rows.length,
  };
}

// ── Session / MCP queries ──────────────────────────────────────────────────

export interface SessionListRow {
  session_id:          string;
  started_at:          string;
  last_seen_at:        string;
  duration_seconds:    number;
  llm_calls:           number;
  llm_cost_usd:        number;
  total_tokens:        number;
  avg_latency_ms:      number;
  models_used:         string[];
  calls_with_mcp:      number;   // LLM calls that triggered ≥1 MCP primitive
  distinct_tool_count: number;   // unique tool names used across session
  project_id:          string;
  user_id:             string;
}

export interface SessionCosts {
  session_id:      string;
  llm_cost_usd:    number;
  tool_cost_usd:   number;
  total_cost_usd:  number;
  llm_calls:       number;
  tool_calls:      number;
}

export interface ToolBreakdownRow {
  tool_name:          string;
  mcp_server_name:    string;
  primitive_type:     string;   // "tool" | "resource" | "prompt" | "sampling"
  cost_status:        string;   // "estimated" | "actual"
  call_count:         number;
  error_count:        number;
  total_cost_usd:     number;
  avg_cost_per_call:  number;
  avg_latency_ms:     number;
  max_latency_ms:     number;
}

export interface AgentLoopRow {
  session_id:      string;
  tool_name:       string;
  call_count:      number;
  first_call:      string;
  last_call:       string;
  window_seconds:  number;
  cost_usd:        number;
}

export async function getSessionsList(
  orgId:      string,
  fromDate:   string,
  toDate:     string,
  projectId?: string,
  limit       = 100,
): Promise<SessionListRow[]> {
  return queryTinybird("sessions_list", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: projectId ?? "",
    limit:      String(limit),
  }) as Promise<SessionListRow[]>;
}

export async function getSessionCosts(
  orgId:     string,
  sessionId: string,
): Promise<SessionCosts | null> {
  const rows = await queryTinybird("session_costs", {
    org_id:     orgId,
    session_id: sessionId,
  });
  return (rows[0] as SessionCosts) ?? null;
}

export async function getToolBreakdown(
  orgId:          string,
  fromDate:       string,
  toDate:         string,
  sessionId?:     string,
  projectId?:     string,
  primitiveType?: string,  // filter to "tool" | "resource" | "prompt" | "sampling" | "" = all
): Promise<ToolBreakdownRow[]> {
  return queryTinybird("tool_breakdown", {
    org_id:         orgId,
    from_date:      fromDate,
    to_date:        toDate,
    session_id:     sessionId     ?? "",
    project_id:     projectId     ?? "",
    primitive_type: primitiveType ?? "",
  }) as Promise<ToolBreakdownRow[]>;
}

export async function getAgentLoops(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  minCalls  = 5,
): Promise<AgentLoopRow[]> {
  return queryTinybird("agent_loop_detection", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    min_calls: String(minCalls),
  }) as Promise<AgentLoopRow[]>;
}

export interface KeyModelSpend {
  api_key_id:   string;
  model:        string;
  provider:     string;
  cost_usd:     number;
  requests:     number;
  input_tokens: number;
  output_tokens: number;
}

export async function getSpendByKeyModel(
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<KeyModelSpend[]> {
  // Use ad-hoc SQL — works in both Tinybird Forward and Classic workspaces.
  // Named pipe (spend_by_key_model.pipe) only works in Classic via `tb push`.
  // orgId comes from auth session (UUID), dates are zod-validated — safe to interpolate.
  const safeOrgId   = orgId.replace(/[^a-f0-9-]/gi, "");  // strip anything non-UUID
  const safeFrom    = fromDate.replace(/[^0-9 :-]/g, "");
  const safeTo      = toDate.replace(/[^0-9 :-]/g, "");

  // llm_events_filtered: v2 datasource with GDPR-erased events removed.
  // v1 (llm_events) does not have api_key_id column — queries against it always return empty strings.
  const sql = `
    SELECT
      api_key_id,
      model,
      provider,
      sum(cost_usd)      AS cost_usd,
      count()            AS requests,
      sum(input_tokens)  AS input_tokens,
      sum(output_tokens) AS output_tokens
    FROM llm_events_filtered
    WHERE org_id    = '${safeOrgId}'
      AND timestamp >= '${safeFrom}'
      AND timestamp <= '${safeTo}'
    GROUP BY api_key_id, model, provider
    ORDER BY cost_usd DESC
  `;
  return querySql(sql) as Promise<KeyModelSpend[]>;
}

// ── MCP overview + org-level tool analytics ───────────────────────────────

export interface McpOverviewMetrics {
  total_tool_calls:    number;
  total_tool_cost_usd: number;
  tool_error_count:    number;
  tool_error_rate:     number;
  avg_tool_latency_ms: number;
  sessions_with_tools: number;
  distinct_tools_used: number;
  reconciliation_rate: number;
}

export interface McpServerSpend {
  mcp_server_name:  string;
  total_calls:      number;
  cost_usd:         number;
  error_count:      number;
  avg_latency_ms:   number;
}

export interface McpToolSpend {
  tool_name:              string;
  mcp_server_name:        string;
  primitive_type:         string;
  total_calls:            number;
  error_count:            number;
  success_count:          number;
  cost_usd:               number;
  avg_cost_per_call:      number;
  error_rate:             number;
  avg_latency_ms:         number;
  max_latency_ms:         number;
  actual_cost_events:     number;
  estimated_cost_events:  number;
}

export async function getMcpOverviewMetrics(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  projectIds: string[] = [],
): Promise<McpOverviewMetrics | null> {
  const rows = await queryTinybird("mcp_overview_metrics", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    project_ids: projectIds.join(","),
  });
  return (rows[0] as McpOverviewMetrics) ?? null;
}

export async function getSpendByMcpServer(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  projectIds: string[] = [],
): Promise<McpServerSpend[]> {
  return queryTinybird("spend_by_mcp_server", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    project_ids: projectIds.join(","),
  }) as Promise<McpServerSpend[]>;
}

export async function getSpendByMcpTool(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  projectIds: string[] = [],
): Promise<McpToolSpend[]> {
  return queryTinybird("spend_by_mcp_tool", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    project_ids: projectIds.join(","),
  }) as Promise<McpToolSpend[]>;
}

export interface BranchDeveloperSpend {
  branch:         string;
  commit_sha:     string;
  user_id:        string;
  cost_usd:       number;
  requests:       number;
  total_tokens:   number;
  avg_latency_ms: number;
}

// ── Pillar 3: Resource Tagging ────────────────────────────────────────────────

export interface CostCenterSpend {
  cost_center:   string;
  cost_usd:      number;
  requests:      number;
  total_tokens:  number;
  project_count: number;
  key_count:     number;
}

export interface WorkloadSpend {
  workload_type:  string;
  cost_usd:       number;
  requests:       number;
  total_tokens:   number;
  avg_latency_ms: number;
}

export interface InfraCostCategory {
  category:  string;
  cost_usd:  number;
  events:    number;
}

export interface TrainingCostSummary {
  provider:             string;
  training_type:        string;
  base_model:           string;
  run_count:            number;
  total_cost_usd:       number;
  total_tokens_trained: number;
  avg_cost_per_run:     number;
}

export async function getSpendByCostCenter(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<CostCenterSpend[]> {
  return queryTinybird("spend_by_cost_center", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<CostCenterSpend[]>;
}

export async function getSpendByWorkload(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<WorkloadSpend[]> {
  return queryTinybird("spend_by_workload", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<WorkloadSpend[]>;
}

export async function getInfraCostBreakdown(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<InfraCostCategory[]> {
  return queryTinybird("infra_cost_breakdown", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<InfraCostCategory[]>;
}

export async function getTrainingCostSummary(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<TrainingCostSummary[]> {
  return queryTinybird("training_cost_summary", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<TrainingCostSummary[]>;
}

// ── Pillar 4: Vector DB ───────────────────────────────────────────────────────

export interface VectorDbResourceRow {
  resource:            string;   // e.g. "pinecone:my-index", "qdrant:support-docs"
  tool_calls:          number;
  estimated_cost_usd:  number;
  avg_latency_ms:      number;
  max_latency_ms:      number;
  error_count:         number;
  error_rate:          number;
}

export async function getVectorDbCostBreakdown(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<VectorDbResourceRow[]> {
  return queryTinybird("vector_db_cost_breakdown", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<VectorDbResourceRow[]>;
}

// ── Pillar 5: Unified AI FinOps ───────────────────────────────────────────────

export interface ProviderSpend {
  provider:           string;
  total_cost_usd:     number;
  total_requests:     number;
  total_tokens:       number;
  cost_per_1m_tokens: number;
  daily_series:       Array<[string, number]>;  // [date, daily_cost]
  days_tracked:       number;
}

export async function getSpendByProvider(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<ProviderSpend[]> {
  return queryTinybird("spend_by_provider", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<ProviderSpend[]>;
}

// ── Pillar 6: Unit Economics ───────────────────────────────────────────────────

export interface FeatureSpend {
  feature:          string;
  cost_usd:         number;
  requests:         number;
  total_tokens:     number;
  avg_latency_ms:   number;
  error_rate:       number;
  cache_hit_rate:   number;
  avg_cost_per_call: number;
}

export interface ActionSpend {
  action:           string;
  cost_usd:         number;
  requests:         number;
  total_tokens:     number;
  avg_latency_ms:   number;
  error_rate:       number;
  cache_hit_rate:   number;
  avg_cost_per_call: number;
}

export interface EfficiencyPoint {
  date:             string;
  cache_hit_rate:   number;
  tokens_per_dollar: number;
  cost_usd:         number;
  requests:         number;
  cached_tokens:    number;
  input_tokens:     number;
  output_tokens:    number;
}

export interface SessionCostDistribution {
  p50_cost_usd:          number;
  p90_cost_usd:          number;
  p99_cost_usd:          number;
  avg_cost_usd:          number;
  session_count:         number;
  total_cost_usd:        number;
  avg_calls_per_session: number;
  avg_tokens_per_session: number;
}

export async function getSpendByFeature(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<FeatureSpend[]> {
  return queryTinybird("spend_by_feature", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<FeatureSpend[]>;
}

export async function getSpendByAction(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<ActionSpend[]> {
  return queryTinybird("spend_by_action", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
  }) as Promise<ActionSpend[]>;
}

export async function getEfficiencyTimeseries(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  projectIds: string[] = [],
): Promise<EfficiencyPoint[]> {
  return queryTinybird("efficiency_timeseries", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    project_ids: projectIds.join(","),
  }) as Promise<EfficiencyPoint[]>;
}

export async function getSessionCostDistribution(
  orgId:    string,
  fromDate: string,
  toDate:   string,
  projectIds: string[] = [],
): Promise<SessionCostDistribution | null> {
  const rows = await queryTinybird("session_cost_distribution", {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    project_ids: projectIds.join(","),
  });
  return (rows[0] as SessionCostDistribution) ?? null;
}

export async function getSpendByBranchDeveloper(
  orgId: string,
  fromDate: string,
  toDate: string,
  projectId?: string,
  keyType?: string,
): Promise<BranchDeveloperSpend[]> {
  return queryTinybird("spend_by_branch_developer", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: projectId ?? "",
    key_type:   keyType   ?? "",
  }) as Promise<BranchDeveloperSpend[]>;
}

// ── Per-user cost tracking (startup COGS) ─────────────────────────────────────

export interface UserSpend {
  user_id:          string;
  cost_usd:         number;
  requests:         number;
  total_tokens:     number;
  features_used:    string[];
  avg_latency_ms:   number;
  error_rate:       number;
  avg_cost_per_call: number;
}

// ── Multi-tenant customer metering ───────────────────────────────────────────

export interface CustomerSpend {
  customer_id:    string;
  total_cost_usd: number;
  input_tokens:   number;
  output_tokens:  number;
  cached_tokens:  number;
  total_tokens:   number;
  requests:       number;
  error_count:    number;
  error_rate:     number;
  avg_latency_ms: number;
}

export interface CustomerModelBreakdown {
  customer_id:          string;
  model:                string;
  provider:             string;
  cost_usd:             number;
  input_tokens:         number;
  output_tokens:        number;
  cached_tokens:        number;
  requests:             number;
  error_count:          number;
  avg_cost_per_request: number;
}

export interface CustomerDailyPoint {
  date:         string;
  cost_usd:     number;
  requests:     number;
  total_tokens: number;
}

export async function getSpendByCustomer(
  orgId:      string,
  fromDate:   string,
  toDate:     string,
  customerId?: string,
  limit        = 500,
): Promise<CustomerSpend[]> {
  const params: Record<string, string> = {
    org_id:    orgId,
    from_date: fromDate,
    to_date:   toDate,
    limit:     String(limit),
  };
  if (customerId) params.customer_id = customerId;
  return queryTinybird("spend_by_customer", params) as Promise<CustomerSpend[]>;
}

export async function getCustomerModelBreakdown(
  orgId:      string,
  customerId: string,
  fromDate:   string,
  toDate:     string,
): Promise<CustomerModelBreakdown[]> {
  return queryTinybird("customer_model_breakdown", {
    org_id:      orgId,
    customer_id: customerId,
    from_date:   fromDate,
    to_date:     toDate,
  }) as Promise<CustomerModelBreakdown[]>;
}

export async function getCustomerDailyTimeseries(
  orgId:      string,
  customerId: string,
  fromDate:   string,
  toDate:     string,
): Promise<CustomerDailyPoint[]> {
  return queryTinybird("customer_timeseries_daily", {
    org_id:      orgId,
    customer_id: customerId,
    from_date:   fromDate,
    to_date:     toDate,
  }) as Promise<CustomerDailyPoint[]>;
}

export async function getSpendByUser(
  orgId:      string,
  fromDate:   string,
  toDate:     string,
  projectId?: string,
  limit       = 100,
): Promise<UserSpend[]> {
  return queryTinybird("spend_by_user", {
    org_id:     orgId,
    from_date:  fromDate,
    to_date:    toDate,
    project_id: projectId ?? "",
    limit:      String(limit),
  }) as Promise<UserSpend[]>;
}

// ── Model Intelligence Engine ─────────────────────────────────────────────────

export interface ModelFeatureRow {
  feature:            string;
  model:              string;
  provider:           string;
  cost_usd:           number;
  requests:           number;
  avg_input_tokens:   number;
  avg_output_tokens:  number;
  output_input_ratio: number;
  cache_hit_rate:     number;
  error_rate:         number;
  p95_input_tokens:   number;
}

/**
 * Feature × model cross-tab — the core data source for Phase 1 recommendations.
 * Groups events by feature tag AND model, giving per-feature cost + complexity signals.
 * Only rows with feature tag set and ≥10 requests are returned.
 */
export async function getModelFeatureMatrix(
  orgId:    string,
  fromDate: string,
  toDate:   string,
): Promise<ModelFeatureRow[]> {
  const safeOrgId = orgId.replace(/[^a-f0-9-]/gi, "");
  const safeFrom  = fromDate.replace(/[^0-9 :-]/g, "");
  const safeTo    = toDate.replace(/[^0-9 :-]/g, "");

  const sql = `
    SELECT
      tags['feature']                                        AS feature,
      model,
      provider,
      sum(cost_usd)                                          AS cost_usd,
      count()                                                AS requests,
      avg(input_tokens)                                      AS avg_input_tokens,
      avg(output_tokens)                                     AS avg_output_tokens,
      avg(output_tokens / nullIf(toFloat64(input_tokens), 0)) AS output_input_ratio,
      sumIf(cached_tokens, cached_tokens > 0)
        / nullIf(toFloat64(sum(input_tokens + cached_tokens)), 0)  AS cache_hit_rate,
      countIf(status_code >= 400) / toFloat64(count())      AS error_rate,
      quantile(0.95)(input_tokens)                           AS p95_input_tokens
    FROM llm_events_filtered
    WHERE org_id    = '${safeOrgId}'
      AND timestamp >= '${safeFrom}'
      AND timestamp <= '${safeTo}'
      AND tags['feature'] != ''
    GROUP BY feature, model, provider
    HAVING requests >= 10
    ORDER BY cost_usd DESC
    LIMIT 100
  `;

  const rows = await querySql(sql) as ModelFeatureRow[];
  // Ensure numerics (Tinybird can return strings for aggregates)
  return rows.map(r => ({
    ...r,
    cost_usd:           Number(r.cost_usd)           || 0,
    requests:           Number(r.requests)           || 0,
    avg_input_tokens:   Number(r.avg_input_tokens)   || 0,
    avg_output_tokens:  Number(r.avg_output_tokens)  || 0,
    output_input_ratio: Number(r.output_input_ratio) || 0,
    cache_hit_rate:     Number(r.cache_hit_rate)     || 0,
    error_rate:         Number(r.error_rate)         || 0,
    p95_input_tokens:   Number(r.p95_input_tokens)   || 0,
  }));
}
