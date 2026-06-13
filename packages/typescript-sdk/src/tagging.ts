/**
 * prismTags() — typed call-site helper for Prism feature/action/cost-center tagging.
 *
 * Eliminates manual header string spelling errors and provides IDE autocomplete
 * for the most common Prism attribution headers.
 *
 * Usage with OpenAI SDK:
 *   const response = await openai.chat.completions.create({
 *     model: "gpt-4o",
 *     messages,
 *     headers: prismTags({ feature: "chat", action: "message", costCenter: "eng-product" }),
 *   });
 *
 * Usage with gateway-mode fetch:
 *   fetch(url, { headers: { ...prismTags({ feature: "summarize" }), "Content-Type": "application/json" } });
 *
 * Usage with tracker.capture() callTags:
 *   await tracker.capture(response, latencyMs, projectId, teamId, env, provider, messages,
 *     prismTags({ feature: "chat", action: "reply" }));
 */
export interface PrismTagInput {
  /**
   * Feature bucket shown in the Unit Economics → Cost by Feature chart.
   * Maps to the `x-prism-feature` header and `tags['feature']` on llm_events.
   * Example: "chat", "search", "summarize", "code-review"
   */
  feature?: string;

  /**
   * Action label for cost-per-action tracking.
   * Maps to the `x-prism-action` header and `tags['action']` on llm_events.
   * Example: "message-sent", "document-processed", "pr-reviewed"
   */
  action?: string;

  /**
   * Finance GL cost-center code for chargeback reporting.
   * Maps to the `x-prism-cost-center` header.
   * Example: "eng-platform", "sales", "support"
   */
  costCenter?: string;

  /**
   * Prism project ID to route this call's cost to a specific project.
   * Maps to the `x-prism-project` header.
   */
  project?: string;

  /**
   * Session ID for grouping multiple LLM calls into a user session.
   * Maps to the `x-prism-session-id` header.
   */
  sessionId?: string;

  /**
   * Free-form extra tags — each key is mapped to `x-prism-<key>`.
   * Example: { "customer-id": "acme-corp", "experiment": "v2" }
   */
  [key: string]: string | undefined;
}

/**
 * Build a headers object (or callTags dict) from a typed tag input.
 *
 * The returned Record<string, string> can be passed directly to:
 *   - OpenAI/Anthropic SDK `headers` option
 *   - `tracker.capture(..., callTags)` / `tracker.captureRaw(..., callTags)`
 *   - Any fetch `headers` via spread
 */
export function prismTags(tags: PrismTagInput): Record<string, string> {
  const out: Record<string, string> = {};

  if (tags.feature)    out["x-prism-feature"]      = tags.feature;
  if (tags.action)     out["x-prism-action"]       = tags.action;
  if (tags.costCenter) out["x-prism-cost-center"]  = tags.costCenter;
  if (tags.project)    out["x-prism-project"]      = tags.project;
  if (tags.sessionId)  out["x-prism-session-id"]   = tags.sessionId;

  // Extra keys — skip the five named properties above to avoid double-writing
  const reserved = new Set(["feature", "action", "costCenter", "project", "sessionId"]);
  for (const [k, v] of Object.entries(tags)) {
    if (v && !reserved.has(k)) {
      out[`x-prism-${k}`] = v;
    }
  }

  return out;
}
