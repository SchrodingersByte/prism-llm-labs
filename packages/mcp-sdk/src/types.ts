export type McpPrimitiveType = "tool" | "resource" | "prompt" | "sampling";

export interface McpEvent {
  event_id:             string;
  timestamp:            string;
  session_id:           string;
  org_id:               string;
  project_id:           string;
  team_id:              string;
  user_id:              string;
  environment:          string;
  mcp_server_name:      string;
  /** tool name, resource URI, prompt name, or model hint for sampling */
  tool_name:            string;
  downstream_resource:  string;
  execution_latency_ms: number;
  tool_cost_usd:        number;
  status:               "ok" | "error" | "timeout";
  error_message:        string;
  llm_request_id:       string;
  primitive_type:       McpPrimitiveType;
  /**
   * Whether tool_cost_usd is an estimate from the built-in catalog ("estimated")
   * or a real figure provided by the tool via ctx.reportActualCost() ("actual").
   */
  cost_status:          "estimated" | "actual";
  tags:                 Record<string, string>;
  /**
   * Operator's opaque end-customer identifier.
   * Stamped on every tool event for per-customer metering and chargeback.
   * Empty string if not set.
   */
  customer_id:          string;
}

export interface PrismMcpOptions {
  /** Prism API key — or set PRISM_API_KEY env var */
  prismKey?:      string;
  /** Project ID for cost attribution */
  project?:       string;
  /** Team attribution tag */
  team?:          string;
  /** "production" | "staging" | "development" */
  environment?:   string;
  /** Explicit session ID. Auto-generated UUID if omitted. */
  sessionId?:     string;
  /** MCP server name shown in the dashboard */
  serverName?:    string;
  /** Override ingest URL (for testing) */
  ingestUrl?:     string;
  /**
   * Session budget in USD. Tool/resource/prompt calls are blocked when the
   * combined session cost exceeds this value.
   */
  sessionBudgetUsd?: number;
  /**
   * Maximum MCP primitive calls per session. Blocks further calls when exceeded.
   * Loop detection guard — default unlimited.
   */
  maxToolCallsPerSession?: number;
  /**
   * Log call arguments into tags['tool_input'] (truncated to 1000 chars).
   * Opt-in only — disabled by default for privacy.
   */
  captureInputs?: boolean;
  /**
   * Log call results into tags['tool_output'] (truncated to 1000 chars).
   * Opt-in only — disabled by default for privacy.
   */
  captureOutputs?: boolean;
  /**
   * Keys to redact from captured inputs/outputs.
   * Default: ['password', 'token', 'key', 'secret', 'api_key', 'authorization']
   */
  redactKeys?: string[];
  /**
   * When true, automatically emits a success outcome_event when the session
   * ends normally (no budget exception, no loop error, at least one tool call completed).
   * The outcome is tagged with the session's feature tags.
   * Default: false
   */
  autoOutcome?: boolean;
  /**
   * Operator's opaque end-customer identifier.
   * Stamped on every tool event so you can track per-customer MCP tool costs.
   * Equivalent to the `x-prism-customer-id` header in gateway mode.
   */
  customerId?: string;
}

export class PrismSessionBudgetExceededError extends Error {
  constructor(sessionId: string, budgetUsd: number) {
    super(
      `[prism-mcp] Session budget of $${budgetUsd} exceeded for session ${sessionId}. ` +
      `Tool call blocked to prevent runaway agent costs.`,
    );
    this.name = "PrismSessionBudgetExceededError";
  }
}

export class PrismToolCallLimitError extends Error {
  constructor(sessionId: string, limit: number) {
    super(
      `[prism-mcp] Tool call limit of ${limit} reached for session ${sessionId}. ` +
      `Possible agent loop detected — tool call blocked.`,
    );
    this.name = "PrismToolCallLimitError";
  }
}
