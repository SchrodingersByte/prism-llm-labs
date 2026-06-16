/**
 * Offline-eval CI helper tests (PRD-2): request shaping, verdict mapping, and
 * the gate throwing on a failing/regressed run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEval, gateEval, EvalGateError } from "../src/evals";

const API_KEY = "prism_live_testorg_randomkey";

function mockFetch(payload: Record<string, unknown>, status = 201) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

const PASS_PAYLOAD = {
  run_id: "run-1", overall_score: 0.91, pass_rate: 0.95, n_samples: 20, edge_cases: 1,
  cost_usd: 0.0123, errors: 0, threshold: 0.8, meets_threshold: true,
  baseline_run_id: null, baseline_score: null, score_delta: null, regression: false, passed: true,
};

describe("runEval", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = mockFetch(PASS_PAYLOAD); });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to the experiments endpoint with bearer auth + mapped body", async () => {
    await runEval({
      apiKey: API_KEY,
      baseUrl: "https://example.test",
      dataset: "ds-1",
      subject: { model: "gpt-4o-mini", systemPrompt: "be terse" },
      scorers: ["correctness"],
      threshold: 0.8,
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://example.test/api/evaluations/experiments");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.dataset_id).toBe("ds-1");
    expect(body.subject.model).toBe("gpt-4o-mini");
    expect(body.subject.system_prompt).toBe("be terse");
    expect(body.scorers).toEqual(["correctness"]);
    expect(body.threshold).toBe(0.8);
  });

  it("maps the snake_case verdict into a camelCase EvalResult", async () => {
    const r = await runEval({ apiKey: API_KEY, dataset: "ds-1", subject: { model: "gpt-4o-mini" } });
    expect(r.runId).toBe("run-1");
    expect(r.overallScore).toBe(0.91);
    expect(r.meetsThreshold).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("throws on a non-2xx response", async () => {
    vi.restoreAllMocks();
    mockFetch({ error: "No active provider key" }, 400);
    await expect(runEval({ apiKey: API_KEY, dataset: "ds-1", subject: { model: "x" } }))
      .rejects.toThrow(/No active provider key/);
  });

  it("requires an API key", async () => {
    const prev = process.env.PRISM_API_KEY;
    delete process.env.PRISM_API_KEY;
    await expect(runEval({ dataset: "ds-1", subject: { model: "x" } })).rejects.toThrow(/missing API key/);
    if (prev) process.env.PRISM_API_KEY = prev;
  });
});

describe("gateEval", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the result when passed", async () => {
    mockFetch(PASS_PAYLOAD);
    const r = await gateEval({ apiKey: API_KEY, dataset: "ds-1", subject: { model: "x" } });
    expect(r.passed).toBe(true);
  });

  it("throws EvalGateError on a regression", async () => {
    mockFetch({ ...PASS_PAYLOAD, overall_score: 0.7, score_delta: -0.12, regression: true, passed: false });
    await expect(gateEval({ apiKey: API_KEY, dataset: "ds-1", subject: { model: "x" }, baselineRunId: "base-1" }))
      .rejects.toBeInstanceOf(EvalGateError);
  });
});
