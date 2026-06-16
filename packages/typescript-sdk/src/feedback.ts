/**
 * End-user feedback helper (PRD-3).
 *
 * Send a thumbs / score / comment linked to a trace (and span/session) from
 * anywhere in your app — e.g. a 👍/👎 button handler. When `traceId`/`spanId`
 * are omitted they default from the active Prism trace context, so feedback
 * lands on the right call automatically inside a `trace()` block.
 *
 *   import { sendFeedback } from "@prism-llm-labs/sdk";
 *   await sendFeedback({ value: 1, comment: "spot on" });          // 👍 on current trace
 *   await sendFeedback({ value: 0, traceId, featureTag: "support" }); // 👎 on a specific trace
 *
 * Server: POST /api/feedback (authenticated by PRISM_API_KEY).
 */
import { getCurrentTrace } from "./trace";

export interface FeedbackOptions {
  /** Thumbs (1 = up, 0 = down) or a 0..1 score. */
  value:       number;
  traceId?:    string;
  spanId?:     string;
  sessionId?:  string;
  /** Correlates to the x-prism-feature tag for per-feature thumbs aggregation. */
  featureTag?: string;
  comment?:    string;
  source?:     "end_user" | "reviewer";
  projectId?:  string;
  /** Prism API key. Defaults to process.env.PRISM_API_KEY. */
  apiKey?:     string;
  /** App base URL. Defaults to PRISM_GATEWAY_URL / PRISM_APP_URL / NEXT_PUBLIC_APP_URL / https://useprism.dev. */
  baseUrl?:    string;
}

function resolveBaseUrl(explicit?: string): string {
  const url =
    explicit ??
    process.env["PRISM_GATEWAY_URL"] ??
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev";
  return url.replace(/\/$/, "");
}

/**
 * Record end-user feedback. Resolves on success; throws on missing key or a
 * non-2xx response (wrap in try/catch if feedback must never affect your flow).
 */
export async function sendFeedback(opts: FeedbackOptions): Promise<{ ok: boolean; recorded: number }> {
  const apiKey = opts.apiKey ?? process.env["PRISM_API_KEY"];
  if (!apiKey) throw new Error("Prism feedback: missing API key (set PRISM_API_KEY or pass apiKey).");

  const trace = getCurrentTrace();
  const body = {
    value:       opts.value,
    trace_id:    opts.traceId   ?? trace?.traceId,
    span_id:     opts.spanId    ?? trace?.spanId,
    session_id:  opts.sessionId,
    feature_tag: opts.featureTag,
    comment:     opts.comment,
    source:      opts.source,
    project_id:  opts.projectId,
  };

  const res = await fetch(`${resolveBaseUrl(opts.baseUrl)}/api/feedback`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({})) as { error?: string; recorded?: number };
  if (!res.ok) throw new Error(`Prism feedback failed (${res.status}): ${json.error ?? res.statusText}`);
  return { ok: true, recorded: Number(json.recorded ?? 1) };
}
