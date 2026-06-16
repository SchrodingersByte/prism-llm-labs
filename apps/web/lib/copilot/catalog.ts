/**
 * Copilot semantic layer / metrics catalog (PRD-7).
 *
 * The ONLY pipes the Copilot agent is allowed to call. This is the core safety
 * guarantee: the planner emits `query_metrics(pipe, params)` tool calls, the
 * runner rejects any `pipe` not in this catalog, and `org_id` + project scope are
 * injected server-side — so the agent can never read another org's data and never
 * runs raw SQL/DML. Adding analytics surface = adding a catalog entry (no agent
 * change). Mirrors the pipe list in CLAUDE.md.
 *
 * Design: docs/implementation/07-prism-copilot-nl-agentic-rca.impl.md §4.1
 */
export interface CatalogEntry {
  /** Tinybird pipe name (the tool's `pipe` value). */
  pipe:        string;
  /** What the pipe answers, in plain language (shown to the planner). */
  description: string;
  /** Model-facing params (besides the auto-injected org_id + project scope). */
  params:      string[];
  /** Notable result columns, so the planner knows what it gets back. */
  returns:     string[];
}

/** Params injected by the RUNNER, never by the model (scope/safety). */
export const INJECTED_PARAMS = ["org_id", "project_id", "project_ids"] as const;

export const CATALOG: CatalogEntry[] = [
  {
    pipe: "overview_metrics",
    description: "Headline KPIs for the org: total cost, request count, token count, error rate.",
    params: ["from_date", "to_date", "environment"],
    returns: ["total_cost_usd", "total_requests", "total_tokens", "error_rate"],
  },
  {
    pipe: "timeseries_daily",
    description: "Daily time series of cost / requests / tokens. Use for trends over time.",
    params: ["from_date", "to_date"],
    returns: ["date", "cost_usd", "requests", "tokens"],
  },
  {
    pipe: "spend_by_model",
    description: "Cost and usage broken down per model, with cache hit rate and tokens-per-dollar efficiency.",
    params: ["from_date", "to_date"],
    returns: ["model", "provider", "total_cost_usd", "requests", "cache_hit_rate", "tokens_per_dollar", "error_rate"],
  },
  {
    pipe: "spend_by_provider",
    description: "Cost broken down per vendor/provider (openai, anthropic, google, ...). Use for vendor questions.",
    params: ["from_date", "to_date"],
    returns: ["provider", "cost_usd", "requests"],
  },
  {
    pipe: "spend_by_feature",
    description: "Cost per product feature (the x-prism-feature tag). Use for unit-economics / 'which feature costs most'.",
    params: ["from_date", "to_date"],
    returns: ["feature", "cost_usd", "requests", "avg_cost_per_call"],
  },
  {
    pipe: "spend_by_project",
    description: "Cost broken down per project. Use to attribute spend across projects.",
    params: ["from_date", "to_date"],
    returns: ["project_id", "project_name", "cost_usd", "requests"],
  },
  {
    pipe: "spend_by_customer",
    description: "Cost broken down per end customer (the customer tag). Use for cost-to-serve questions.",
    params: ["from_date", "to_date"],
    returns: ["customer", "cost_usd", "requests"],
  },
  {
    pipe: "spend_by_cost_center",
    description: "Cost broken down per finance GL cost center. Use for chargeback / finance questions.",
    params: ["from_date", "to_date"],
    returns: ["cost_center", "cost_usd", "requests"],
  },
  {
    pipe: "anomaly_detection",
    description: "Daily cost spikes vs a rolling 7-day average (spike_ratio > 2). Use to find WHEN spend spiked.",
    params: [],
    returns: ["date", "daily_cost", "rolling_7d_avg", "spike_ratio"],
  },
  {
    pipe: "efficiency_timeseries",
    description: "Daily efficiency trend: cache hit rate and tokens-per-dollar. Use for 'are we getting more efficient'.",
    params: ["from_date", "to_date"],
    returns: ["date", "cache_hit_rate", "tokens_per_dollar", "cost_usd"],
  },
  {
    pipe: "quality_timeseries",
    description: "Daily online-eval quality: average judge score + pass rate (PRD-1). Use for output-quality trends.",
    params: ["from_date", "to_date", "scorer_type", "model"],
    returns: ["date", "scores", "avg_score", "pass_rate"],
  },
  {
    pipe: "quality_by_model",
    description: "Online-eval quality per model: average score + pass rate (PRD-1). Use to compare model quality.",
    params: ["from_date", "to_date", "scorer_type"],
    returns: ["model", "scores", "avg_score", "pass_rate"],
  },
  {
    pipe: "error_clusters",
    description: "Failing LLM calls + failing spans grouped by error signature, with counts (PRD-6). Use for 'what's erroring'.",
    params: ["from_date", "to_date"],
    returns: ["signature", "source", "occurrences", "last_seen"],
  },
  {
    pipe: "session_cost_distribution",
    description: "Session cost percentiles (P50/P90/P99). Use for 'how expensive is a typical session'.",
    params: ["from_date", "to_date"],
    returns: ["p50_cost_usd", "p90_cost_usd", "p99_cost_usd", "avg_cost_usd"],
  },
  {
    pipe: "spend_by_mcp_tool",
    description: "Cost per MCP tool call. Use for agent/tool cost questions.",
    params: ["from_date", "to_date"],
    returns: ["tool_name", "mcp_server_name", "cost_usd", "calls"],
  },
];

export const CATALOG_PIPES = new Set(CATALOG.map(e => e.pipe));

export function isCatalogPipe(pipe: string): boolean {
  return CATALOG_PIPES.has(pipe);
}

/** Render the catalog as compact text for the planner's system prompt. */
export function renderCatalog(): string {
  return CATALOG.map(e =>
    `- ${e.pipe}: ${e.description}` +
    (e.params.length ? ` Params: ${e.params.join(", ")}.` : " No params.") +
    ` Returns: ${e.returns.join(", ")}.`,
  ).join("\n");
}
