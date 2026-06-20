/**
 * Client fetchers for the Trace Engine surfaces (session detail, waterfall, payload).
 * Types are reused (type-only) from the server trace service — erased at build, so
 * no server code reaches the client bundle.
 */
import { apiGet, ApiError } from "./client";
import type { TraceView } from "@/lib/traces/service";

export interface SessionTrace {
  trace_id:        string;
  status:          string;
  total_cost_usd:  number | null;
  started_at:      string | null;
  ended_at:        string | null;
  root_session_id: string | null;
  root_span_id:    string | null;
}

/** Traces belonging to a session (root_session_id match), newest-first. */
export function fetchSessionTraces(sessionId: string, signal?: AbortSignal): Promise<SessionTrace[]> {
  return apiGet<{ traces: SessionTrace[] }>("/api/traces", { session_id: sessionId, limit: "200" }, signal).then((r) => r.traces ?? []);
}

/** Full unified view for one trace (spans + rollup + linked eval/rec/PII). */
export function fetchTraceView(traceId: string, signal?: AbortSignal): Promise<TraceView> {
  return apiGet<TraceView>(`/api/traces/${traceId}`, undefined, signal);
}

export interface ContentRow {
  id:               string;
  model:            string;
  provider:         string;
  prompt:           string | null;
  completion:       string | null;
  context:          string | null;
  tool_io:          string | null;
  redaction_level:  string | null;
  pii_found:        boolean | null;
  source:           string | null;
  created_at:       string;
}

/** Captured (redacted) payload for one event. null when not captured / not permitted. */
export function fetchContent(eventId: string, signal?: AbortSignal): Promise<ContentRow | null> {
  return apiGet<{ content: ContentRow }>(`/api/content/${eventId}`, undefined, signal)
    .then((r) => r.content)
    .catch((e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
      throw e;
    });
}
