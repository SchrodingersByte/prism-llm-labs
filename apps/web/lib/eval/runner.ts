/**
 * Offline experiment runner (PRD-2).
 *
 * An experiment runs ONE subject config (model + optional system prompt + params)
 * over a dataset's samples, scores each completion with the PRD-1 scorer library,
 * and aggregates quality + cost onto the evaluation_runs row. This is the
 * dev-time quality loop (prove a change is better BEFORE shipping) that
 * complements PRD-1's production sampler.
 *
 * Execution goes through lib/arena/execute.ts (session-less) — NOT the Arena
 * route — so it works from a Prism-API-key CI call or a background job.
 *
 * Design: docs/implementation/02-offline-evals-datasets-experiments.impl.md
 */
import { executeModelCall } from "@/lib/arena/execute";
import { SCORERS, isScorerType, type ScorerType, type ScorerInput } from "@/lib/eval/judges";

const EDGE_THRESHOLD = 0.7;   // per-sample mean below this = an edge case
const DEFAULT_SAMPLES = 20;
const HARD_SAMPLE_CAP = 50;   // synchronous within maxDuration=300; larger runs chunk later
const CONCURRENCY     = 4;

export interface DatasetSample {
  input:           string;
  expected_output?: string;
  tags?:           Record<string, string>;
}

export interface ExperimentSubject {
  model:          string;
  system_prompt?: string;
  params?:        Record<string, unknown>;
}

export interface RunExperimentParams {
  orgId:          string;
  runId:          string;             // pre-created evaluation_runs row
  samples:        DatasetSample[];
  subject:        ExperimentSubject;
  providerKeyId:  string;
  scorers:        ScorerType[];
  judgeModel:     string;
  rubric?:        string;
  maxSamples?:    number;
  traceId?:       string;
}

export interface ExperimentResult {
  n_samples:     number;
  overall_score: number;   // 0..1 mean of per-sample mean scores
  pass_rate:     number;   // fraction of samples whose mean score passes EDGE_THRESHOLD
  edge_cases:    number;
  cost_usd:      number;   // sum of subject model-call costs
  scored:        number;   // eval_scores rows written
  errors:        number;   // samples whose model call failed
}

/** Run an async mapper over items with bounded concurrency (order preserved). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Execute + score an experiment, write eval_scores, and finalize the run row.
 * Never throws past the row update — a failed sample becomes a 0-score sample so
 * a partial run still produces a usable aggregate (and the CI gate still fires).
 */
export async function runExperiment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin:  any,
  params: RunExperimentParams,
): Promise<ExperimentResult> {
  const scorers = params.scorers.filter(isScorerType);
  const cap     = Math.max(1, Math.min(params.maxSamples ?? DEFAULT_SAMPLES, HARD_SAMPLE_CAP));
  const samples = params.samples.slice(0, cap);
  const sysMsg  = params.subject.system_prompt
    ? [{ role: "system", content: params.subject.system_prompt }]
    : [];

  let costSum   = 0;
  let errors    = 0;
  const sampleMeans: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoreRows: any[] = [];
  // Compact per-sample trail stored on the run row (for the run/compare detail view).
  const trail: Array<{ index: number; question: string; score: number; is_edge: boolean }> = [];

  const perSample = await mapLimit(samples, CONCURRENCY, async (sample, i) => {
    const messages = [...sysMsg, { role: "user", content: sample.input }];
    const exec = await executeModelCall(admin, {
      orgId:         params.orgId,
      providerKeyId: params.providerKeyId,
      model:         params.subject.model,
      messages,
      params:        params.subject.params,
      traceId:       params.traceId,
    });
    if (!exec.ok) errors++;
    costSum += exec.costUsd;

    const input: ScorerInput = {
      judgeModel: params.judgeModel,
      prompt:     sample.input,
      completion: exec.completion,
      reference:  sample.expected_output,
    };

    const results: { scorer: ScorerType; score: number; passed: boolean; reason: string; latency_ms?: number }[] = [];
    for (const st of scorers) {
      const r = await SCORERS[st](input, params.rubric);
      if (r) results.push({ scorer: st, ...r });
    }
    return { i, exec, results };
  });

  for (const { i, exec, results } of perSample) {
    if (results.length === 0) continue;
    const mean = results.reduce((s, r) => s + r.score, 0) / results.length;
    sampleMeans.push(mean);
    trail.push({
      index:    i,
      question: samples[i].input.slice(0, 80) + (samples[i].input.length > 80 ? "…" : ""),
      score:    Math.round(mean * 1000) / 1000,
      is_edge:  mean < EDGE_THRESHOLD,
    });
    results.forEach((r, ri) => {
      scoreRows.push({
        org_id:      params.orgId,
        eval_run_id: params.runId,
        scorer_type: r.scorer,
        model:       params.subject.model,
        judge_model: r.scorer === "exact_match" ? null : params.judgeModel,
        score:       r.score,
        passed:      r.passed,
        reason:      r.reason,
        // Subject call cost on the first scorer row only → SUM = run cost (no
        // double count across scorers); AVG over non-null = per-sample call cost.
        cost_usd:    ri === 0 ? exec.costUsd : null,
        latency_ms:  r.latency_ms ?? null,
      });
    });
  }

  if (scoreRows.length > 0) {
    await admin.from("eval_scores").insert(scoreRows);
  }

  const nScored    = sampleMeans.length;
  const overall    = nScored > 0 ? sampleMeans.reduce((s, v) => s + v, 0) / nScored : 0;
  const edgeCases  = sampleMeans.filter(m => m < EDGE_THRESHOLD).length;
  const passRate   = nScored > 0 ? (nScored - edgeCases) / nScored : 0;
  const result: ExperimentResult = {
    n_samples:     nScored,
    overall_score: Math.round(overall * 1000) / 1000,
    pass_rate:     Math.round(passRate * 1000) / 1000,
    edge_cases:    edgeCases,
    cost_usd:      Math.round(costSum * 1_000_000) / 1_000_000,
    scored:        scoreRows.length,
    errors,
  };

  await admin
    .from("evaluation_runs")
    .update({
      status:        "done",
      overall_score: result.overall_score,
      n_samples:     result.n_samples,
      edge_cases:    result.edge_cases,
      cost_usd:      result.cost_usd,
      samples:       trail,
      completed_at:  new Date().toISOString(),
    })
    .eq("id", params.runId)
    .eq("org_id", params.orgId);

  return result;
}
