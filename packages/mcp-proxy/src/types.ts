export interface ProxyOptions {
  /** Prism API key — or set PRISM_API_KEY env var */
  prismKey?: string;
  /**
   * Name shown in the Prism dashboard as the MCP server name.
   * Defaults to the basename of the target command.
   */
  serverName?: string;
  /** Project ID for cost attribution */
  project?: string;
  /** Team attribution tag */
  team?: string;
  /** "production" | "staging" | "development" (default: "production") */
  environment?: string;
  /**
   * Explicit session ID. Auto-generated UUID if omitted.
   * One proxy process = one session = one agent run.
   */
  sessionId?: string;
  /**
   * Session budget in USD. All tool/resource/prompt calls are blocked
   * when combined session cost exceeds this value.
   */
  sessionBudgetUsd?: number;
  /**
   * Maximum MCP primitive calls per session.
   * Blocks further calls when exceeded — loop detection guard.
   */
  maxToolCallsPerSession?: number;
  /**
   * Log call arguments into tags["tool_input"] (truncated to 1000 chars).
   * Opt-in only — disabled by default for privacy.
   */
  captureInputs?: boolean;
  /**
   * Log call results into tags["tool_output"] (truncated to 1000 chars).
   * Opt-in only — disabled by default for privacy.
   */
  captureOutputs?: boolean;
  /**
   * Keys to redact from captured inputs/outputs.
   * Default: ["password", "token", "key", "secret", "api_key", "authorization"]
   */
  redactKeys?: string[];
  /** Override ingest URL (for testing / self-hosted Prism) */
  ingestUrl?: string;
  /** Per-tool cost overrides in USD per call (tool_name → usd) */
  costOverrides?: Record<string, number>;
}
