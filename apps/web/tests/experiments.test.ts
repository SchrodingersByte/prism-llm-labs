/**
 * PRD-2 experiment runner tests (lib/eval/runner.ts).
 *
 * Verifies the load-bearing aggregation: per-sample mean → overall_score,
 * edge-case counting (mean < 0.7), cost summation, and the eval_scores rows +
 * run finalize. Uses the deterministic `exact_match` scorer so no judge network
 * call is needed; executeModelCall is mocked to control each completion.
 */
import { describe, it, expect, vi } from "vitest";

const mockExecute = vi.fn();
vi.mock("@/lib/arena/execute", () => ({
  executeModelCall: mockExecute,
  // resolveProviderKey/providerForModel are unused by the runner but exported from the same module.
  resolveProviderKey: vi.fn(),
  providerForModel:   vi.fn(),
}));

/** Minimal chainable fake of the Supabase admin client used by the runner. */
function makeAdmin() {
  const inserts: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];
  const eqChain = {
    eq: () => eqChain,
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  };
  const admin = {
    from: () => ({
      insert: (rows: unknown[]) => { inserts.push(rows); return Promise.resolve({ data: rows, error: null }); },
      update: (patch: Record<string, unknown>) => { updates.push(patch); return eqChain; },
    }),
  };
  return { admin, inserts, updates };
}

describe("runExperiment()", () => {
  it("aggregates per-sample scores, counts edge cases, and sums cost", async () => {
    const { runExperiment } = await import("@/lib/eval/runner");
    mockExecute.mockClear();
    const { admin } = makeAdmin();

    // 2 of 3 completions match their expected answer (exact_match → 1); the third is wrong (→ 0).
    const answers: Record<string, string> = { a: "yes", b: "no", c: "WRONG" };
    // executeModelCall(admin, params) — params (arg 2) carries the messages array.
    mockExecute.mockImplementation((_admin: unknown, p: { messages: { content: string }[] }) => {
      const userMsg = p.messages[p.messages.length - 1].content;
      return Promise.resolve({
        ok: true, completion: answers[userMsg] ?? "WRONG",
        inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0.001, latencyMs: 5,
      });
    });

    const result = await runExperiment(admin, {
      orgId: "org-1", runId: "run-1",
      samples: [
        { input: "a", expected_output: "yes" },
        { input: "b", expected_output: "no" },
        { input: "c", expected_output: "maybe" },
      ],
      subject: { model: "test-model" },
      providerKeyId: "pk-1",
      scorers: ["exact_match"],
      judgeModel: "claude-haiku-4-5",
    });

    expect(result.n_samples).toBe(3);
    expect(result.overall_score).toBeCloseTo(0.667, 2);
    expect(result.edge_cases).toBe(1);              // the wrong sample (mean 0 < 0.7)
    expect(result.pass_rate).toBeCloseTo(0.667, 2);
    expect(result.cost_usd).toBeCloseTo(0.003, 6);  // 3 × 0.001
    expect(result.scored).toBe(3);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("writes eval_scores linked to the run and finalizes the run row as done", async () => {
    const { runExperiment } = await import("@/lib/eval/runner");
    const { admin, inserts, updates } = makeAdmin();

    mockExecute.mockResolvedValue({
      ok: true, completion: "match", inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0.002, latencyMs: 3,
    });

    await runExperiment(admin, {
      orgId: "org-9", runId: "run-9",
      samples: [{ input: "q", expected_output: "match" }],
      subject: { model: "m1" },
      providerKeyId: "pk-9",
      scorers: ["exact_match"],
      judgeModel: "claude-haiku-4-5",
    });

    // One eval_scores row, linked + deterministic exact_match (no judge model).
    const scoreRows = inserts[0] as Record<string, unknown>[];
    expect(scoreRows).toHaveLength(1);
    expect(scoreRows[0]).toMatchObject({
      org_id: "org-9", eval_run_id: "run-9", scorer_type: "exact_match",
      model: "m1", judge_model: null, score: 1, passed: true, cost_usd: 0.002,
    });

    // Run finalized.
    const finalize = updates[0];
    expect(finalize).toMatchObject({ status: "done", overall_score: 1, n_samples: 1, edge_cases: 0 });
  });

  it("treats a failed model call as a scored 0 (CI gate still fires)", async () => {
    const { runExperiment } = await import("@/lib/eval/runner");
    const { admin } = makeAdmin();

    mockExecute.mockResolvedValue({
      ok: false, completion: "", inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, latencyMs: 1, error: "boom",
    });

    const result = await runExperiment(admin, {
      orgId: "o", runId: "r",
      samples: [{ input: "q", expected_output: "expected" }],
      subject: { model: "m" },
      providerKeyId: "pk",
      scorers: ["exact_match"],
      judgeModel: "claude-haiku-4-5",
    });

    expect(result.errors).toBe(1);
    expect(result.overall_score).toBe(0);
    expect(result.edge_cases).toBe(1);
  });
});
