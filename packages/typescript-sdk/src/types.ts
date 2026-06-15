export interface LLMEvent {
  event_id:     string;
  timestamp:    string;
  org_id:       string;
  project_id:   string;
  project_name: string;
  team_id:      string;
  user_id:      string;
  environment:  string;
  provider:     string;
  model:        string;
  input_tokens:  number;
  output_tokens: number;
  cached_tokens: number;
  image_tokens:  number;
  audio_tokens:  number;
  text_tokens:   number;
  modalities:    string;
  cost_usd:     number;
  latency_ms:   number;
  ttft_ms:      number;
  status_code:  number;
  request_id:   string;
  tags:         Record<string, string>;
  trace_id?:       string;
  span_id?:        string;
  parent_span_id?: string;
  /** JSON-serialized TraceContext.attributes — git context, downstream_resource, cost_center_code. */
  attributes?:     string;
  /** PRD-0 captured content (sent only when capturePayloads !== "off"). */
  payload?: {
    prompt?:       unknown[];
    completion?:   string;
    context?:      unknown[];
    tool_io?:      unknown[];
    pre_redacted?: boolean;
  };
}

export interface PrismOptions {
  prismKey?:    string;
  project?:     string;  // Prism project name / id
  team?:        string;  // team attribution tag
  environment?: string;  // "production" | "staging" | "development"
  ingestUrl?:   string;  // override ingest endpoint (useful for testing)
  /**
   * Group multiple LLM calls in one agent run under a shared session_id.
   * Auto-generated UUID per client instantiation if not provided.
   * Stored in tags['session_id'] — no schema migration needed.
   */
  sessionId?:   string;
  /**
   * Cheaper model to switch to when spend reaches softCapPct of the budget.
   * The original model is preserved in tags['model_downgraded_from'].
   * Example: "gpt-4o-mini" when primary model is "gpt-4o".
   */
  softCapModel?: string;
  /**
   * Spend percentage (0–100) at which softCapModel activates. Default: 80.
   * The hard cap (100%) still throws BudgetExceededError.
   */
  softCapPct?: number;
  /**
   * "sdk"     (default) — SDK patches the client and ships telemetry directly.
   * "gateway" — routes all API calls through Prism's server-side proxy.
   *             Requires provider_key_id to be set on the API key in the dashboard.
   *             No monkey-patching; baseURL is set to PRISM_APP_URL/api/gateway/{provider}.
   */
  mode?: "sdk" | "gateway";
  /**
   * Seed a specific trace_id for all LLM events from this client.
   * Gateway mode: forwarded as x-prism-trace-id request header.
   * SDK mode: only active if no trace() context is present; prefer wrapping
   * calls with trace() for automatic parent-child span wiring instead.
   */
  traceId?: string;
  /**
   * Capture prompt/completion content alongside metadata (PRD-0). Default "off".
   * "redacted" applies the optional `redact` hook client-side before sending;
   * "full" sends raw (the server still redacts per the project's capture settings).
   */
  capturePayloads?: "off" | "redacted" | "full";
  /** Client-side redactor applied to captured strings when capturePayloads === "redacted". */
  redact?: (text: string) => string;
}
