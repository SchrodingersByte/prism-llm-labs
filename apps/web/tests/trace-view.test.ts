/**
 * Tests for the unified trace view (lib/traces/service.ts) — the Phase 3
 * consolidation contract. Verifies it stitches spans + rollup + eval_runs and,
 * crucially, resolves the eval -> recommendation linkage (eval_run.rec_id ->
 * recommendation_actions) that closes the trace⇄eval⇄rec graph.
 */
import { describe, it, expect, vi } from "vitest";

// Per-table fixture data, returned by a thenable query-builder chain.
const tableData: Record<string, unknown> = {
  traces: {
    trace_id: "t1", status: "completed", total_cost_usd: 0.5,
    started_at: "2026-06-16T00:00:00.000Z", ended_at: "2026-06-16T00:00:02.000Z",
    metadata: null, root_session_id: "sess-1",
  },
  evaluation_runs: [
    { id: "e1", rec_id: "rec-1", dataset_id: null, mode: "synthetic", status: "done",
      n_samples: 8, overall_score: 0.94, current_model: "gpt-4o", target_model: "gpt-4o-mini",
      validation_score: 0.94, cost_usd: 0.01 },
  ],
  recommendation_actions: [
    { rec_id: "rec-1", rec_type: "cheaper_model", title: "Switch to gpt-4o-mini", status: "applied",
      current_model: "gpt-4o", suggested_model: "gpt-4o-mini", feature: null,
      validation_score: 0.94, applied_at: "2026-06-16T00:05:00.000Z" },
  ],
  pii_incidents: [],
};

function chainFor(table: string) {
  const data = tableData[table] ?? [];
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select      = vi.fn(self);
  c.eq          = vi.fn(self);
  c.in          = vi.fn(self);
  c.gte         = vi.fn(self);
  c.lte         = vi.fn(self);
  c.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  // Thenable: resolves to { data, error } for bare-await / explicit .then chains.
  c.then        = (onF: (v: { data: unknown; error: null }) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(onF, onR);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn((t: string) => chainFor(t)) })),
}));

vi.mock("@/lib/tinybird/client", () => ({
  queryTinybird: vi.fn(() => Promise.resolve([
    { span_kind: "llm", trace_id: "t1", span_id: "s1", parent_span_id: "",
      timestamp: "2026-06-16T00:00:00.500Z", service: "gateway", operation: "chat",
      cost_usd: 0.25, latency_ms: 420, status_int: 200, status_str: "OK" },
  ])),
}));

describe("getTraceView()", () => {
  it("stitches spans + rollup + eval_runs and links eval -> recommendation", async () => {
    const { getTraceView } = await import("@/lib/traces/service");
    const view = await getTraceView("org-1", "t1");

    expect(view.trace?.trace_id).toBe("t1");
    expect(view.trace?.root_session_id).toBe("sess-1");   // traces <-> sessions cross-link
    expect(view.spans).toHaveLength(1);
    expect(view.eval_runs).toHaveLength(1);
    expect(view.eval_runs[0].rec_id).toBe("rec-1");

    // The keystone of Phase 3: the eval run's rec_id resolves to its recommendation.
    expect(view.recommendations).toHaveLength(1);
    expect(view.recommendations[0]).toMatchObject({ rec_id: "rec-1", status: "applied" });
  });
});
