/**
 * Trace rollup writer — the Supabase-side keystone of the Trace Engine.
 *
 * The gateway emits one span per hop to Tinybird (llm_events + guardrail spans)
 * and stamps every event with trace_id / span_id / parent_span_id; Tinybird's
 * `trace_tree` pipe reconstructs the span hierarchy. What was missing was a
 * writer for the `traces` ROLLUP table — so it stayed permanently empty, the
 * trace detail API returned loose spans with a null trace-level rollup, and no
 * trace LIST was possible at all. This module is that writer.
 *
 * It is called fire-and-forget from the gateway hot path right after each
 * main-response / cache-hit Tinybird ingest, folding the request's cost +
 * wall-clock window + status into the trace's (trace_id, org_id) row through
 * the `upsert_trace_rollup` RPC. The accumulation happens in SQL (INSERT ...
 * ON CONFLICT) precisely because one trace spans multiple concurrent gateway
 * calls — see supabase/migrations/20260616000000_trace_rollup_fn.sql.
 *
 * Contract (mirrors the fire-and-forget store/cache idioms in this directory,
 * e.g. lib/gateway/cache.ts and lib/engine/actions.ts):
 *   - never throws — a tracing fault must never break a live request
 *   - fails open — a dropped rollup self-heals on the trace's next span
 *   - returns void; always invoked as `void upsertTraceRollup(...)`
 */
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface TraceRollupInput {
  /**
   * span_id of THIS hop. Promoted to the trace's root_span_id only when this is
   * the first (parent-less) span — pass null for non-root spans. The RPC
   * coalesces, so a later span can never clobber an already-established root.
   */
  rootSpanId?:    string | null;
  /** Session tag (runtimeTags["session_id"]) — links the trace to a session. */
  rootSessionId?: string | null;
  /** This span's cost in USD (0 for cache hits and other zero-cost spans). */
  costUsd:        number;
  /** ISO-8601 timestamps bounding this span's wall-clock window. */
  startedAt:      string;
  endedAt:        string;
  /** true when this span's outcome was an error (non-2xx) — sticky on the trace. */
  isError:        boolean;
}

/**
 * Accumulate one finished span into its trace's rollup row. Fire-and-forget:
 * resolves quietly whether the upsert succeeds, returns an error, or the admin
 * client is unavailable.
 */
export async function upsertTraceRollup(
  orgId:   string,
  traceId: string,
  input:   TraceRollupInput,
): Promise<void> {
  // Both keys are required to address a row. trace_id is always present on the
  // gateway path (one is generated when the caller doesn't propagate it), but
  // guard regardless so this is safe to call from anywhere.
  if (!orgId || !traceId) return;

  try {
    const admin = createAdminClient() as SupabaseClient<Database>;
    await admin.rpc("upsert_trace_rollup", {
      p_org_id:          orgId,
      p_trace_id:        traceId,
      p_cost_usd:        Number.isFinite(input.costUsd) ? input.costUsd : 0,
      p_started_at:      input.startedAt,
      p_ended_at:        input.endedAt,
      p_status:          input.isError ? "error" : "completed",
      p_root_span_id:    input.rootSpanId    || undefined,
      p_root_session_id: input.rootSessionId || undefined,
    });
  } catch {
    // Fail open — the span is already durably in Tinybird; a missed Supabase
    // rollup is recoverable on the trace's next span and never worth blocking
    // (or throwing on) a live request.
  }
}
