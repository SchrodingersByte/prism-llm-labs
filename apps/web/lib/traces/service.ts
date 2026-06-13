/**
 * Unified trace view — the single read model behind the Trace Engine surface.
 *
 * Stitches together the stores that describe one trace, all keyed on
 * trace_id / org_id, into the contract the trace detail API and the Phase 5 UI
 * both consume:
 *
 *   - spans            the span tree from Tinybird (trace_tree pipe: LLM +
 *                      tool + guardrail spans, ordered by time)
 *   - trace            the Supabase rollup row (cost / status / window /
 *                      root_session_id) written by lib/gateway/trace-writer
 *   - eval_runs        validations linked to this trace (evaluation_runs.trace_id)
 *   - recommendations  the recommendation_actions rows those eval_runs point at
 *                      (eval_run.rec_id -> recommendation) — closing eval <-> rec
 *   - pii_incidents    incidents within the trace's wall-clock window
 *
 * Unlike the previous inline detail-route logic, eval_runs are fetched
 * UNCONDITIONALLY (not gated on the rollup row existing), so a validation links
 * to its trace even before — or without — a rollup row.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { queryTinybird } from "@/lib/tinybird/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface TraceSpanRow {
  span_kind:      string;
  trace_id:       string;
  span_id:        string;
  parent_span_id: string;
  timestamp:      string;
  service:        string;
  operation:      string;
  cost_usd:       number;
  latency_ms:     number;
  status_int:     number;
  status_str:     string;
}

export interface TraceRollup {
  trace_id:        string;
  status:          string;
  total_cost_usd:  number | null;
  started_at:      string | null;
  ended_at:        string | null;
  metadata:        unknown;
  root_session_id: string | null;
}

export interface TraceEvalRun {
  id:               string;
  rec_id:           string | null;
  dataset_id:       string | null;
  mode:             string;
  status:           string;
  n_samples:        number | null;
  overall_score:    number | null;
  current_model:    string | null;
  target_model:     string | null;
  validation_score: number | null;
  cost_usd:         number | null;
}

export interface TraceLinkedRec {
  rec_id:           string;
  rec_type:         string | null;
  title:            string | null;
  status:           string;
  current_model:    string | null;
  suggested_model:  string | null;
  feature:          string | null;
  validation_score: number | null;
  applied_at:       string | null;
}

export interface TracePiiIncident {
  id:           string;
  api_key_id:   string;
  user_id:      string | null;
  model:        string;
  provider:     string;
  pii_types:    string[];
  field_paths:  string[];
  action_taken: string;
  created_at:   string;
}

export interface TraceView {
  trace:           TraceRollup | null;
  spans:           TraceSpanRow[];
  eval_runs:       TraceEvalRun[];
  recommendations: TraceLinkedRec[];
  pii_incidents:   TracePiiIncident[];
}

const PII_WINDOW_MS = 30 * 60_000;

/**
 * Assemble the unified view for one trace. Org-scoped; every store is queried
 * with an explicit org_id filter. Each source fails soft so a single backing
 * store being unavailable degrades the view rather than erroring the request.
 */
export async function getTraceView(orgId: string, traceId: string): Promise<TraceView> {
  const admin = createAdminClient() as SupabaseClient<Database>;

  const [spansRaw, trace, evalRuns] = await Promise.all([
    queryTinybird("trace_tree", { trace_id: traceId, org_id: orgId }).catch(() => [] as unknown[]),

    admin
      .from("traces")
      .select("trace_id, status, total_cost_usd, started_at, ended_at, metadata, root_session_id")
      .eq("trace_id", traceId)
      .eq("org_id", orgId)
      .maybeSingle()
      .then((r) => (r.data as TraceRollup | null) ?? null, () => null),

    // Unconditional — a validation links to its trace even with no rollup row yet.
    admin
      .from("evaluation_runs")
      .select("id, rec_id, dataset_id, mode, status, n_samples, overall_score, current_model, target_model, validation_score, cost_usd")
      .eq("trace_id", traceId)
      .eq("org_id", orgId)
      .then((r) => (r.data ?? []) as unknown as TraceEvalRun[], () => []),
  ]);

  const spans = spansRaw as TraceSpanRow[];

  // eval <-> rec: resolve the recommendations the eval runs point at.
  const recIds = Array.from(new Set(evalRuns.map((e) => e.rec_id).filter((x): x is string => !!x)));
  let recommendations: TraceLinkedRec[] = [];
  if (recIds.length > 0) {
    recommendations = await admin
      .from("recommendation_actions")
      .select("rec_id, rec_type, title, status, current_model, suggested_model, feature, validation_score, applied_at")
      .eq("org_id", orgId)
      .in("rec_id", recIds)
      .then((r) => (r.data ?? []) as unknown as TraceLinkedRec[], () => []);
  }

  // PII within the trace window, anchored on the rollup row when present, else
  // on the span timestamps.
  let pii_incidents: TracePiiIncident[] = [];
  const anchorStart = trace?.started_at ?? spans[0]?.timestamp ?? null;
  if (anchorStart) {
    const anchorEnd   = trace?.ended_at ?? spans[spans.length - 1]?.timestamp ?? anchorStart;
    const windowStart = new Date(new Date(anchorStart).getTime() - PII_WINDOW_MS).toISOString();
    const windowEnd   = new Date(new Date(anchorEnd).getTime() + PII_WINDOW_MS).toISOString();
    pii_incidents = await admin
      .from("pii_incidents")
      .select("id, api_key_id, user_id, model, provider, pii_types, field_paths, action_taken, created_at")
      .eq("org_id", orgId)
      .gte("created_at", windowStart)
      .lte("created_at", windowEnd)
      .then((r) => (r.data ?? []) as unknown as TracePiiIncident[], () => []);
  }

  return { trace, spans, eval_runs: evalRuns, recommendations, pii_incidents };
}
