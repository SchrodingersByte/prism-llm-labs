/**
 * Offline-eval CI helper (PRD-2).
 *
 * Run a dataset through a subject config (model + prompt + params) from CI, score
 * it server-side with Prism's scorer library, and gate the build on a quality
 * threshold and/or a regression vs a baseline run. `gateEval` throws
 * EvalGateError when the run does not pass — wire it into a CI step so a
 * regression fails the pipeline (non-zero exit via `runEvalCli`).
 *
 *   import { gateEval } from "@prism-llm-labs/sdk";
 *   await gateEval({
 *     dataset: "DATASET_UUID",
 *     subject: { model: "gpt-4o-mini" },
 *     scorers: ["correctness"],
 *     threshold: 0.8,
 *     baselineRunId: process.env.PRISM_BASELINE_RUN_ID,
 *   });
 *
 * Server: POST /api/evaluations/experiments (authenticated by PRISM_API_KEY).
 */

export interface EvalSubject {
  model:          string;
  systemPrompt?:  string;
  promptVersion?: string;
  params?:        Record<string, unknown>;
}

export interface EvalItem {
  input:           string;
  expected_output?: string;
}

export interface RunEvalOptions {
  /** Prism API key. Defaults to process.env.PRISM_API_KEY. */
  apiKey?:  string;
  /** App base URL. Defaults to PRISM_GATEWAY_URL / PRISM_APP_URL / NEXT_PUBLIC_APP_URL / https://useprism.dev. */
  baseUrl?: string;

  /** A server dataset id… */
  dataset?: string;
  /** …or inline items (for a local/CI dataset). One of `dataset` or `items` is required. */
  items?:   EvalItem[];

  name?:           string;
  subject:         EvalSubject;
  scorers?:        string[];   // default ["correctness"]
  judgeModel?:     string;
  rubric?:         string;
  providerKeyId?:  string;
  baselineRunId?:  string;
  /** Git commit under test. Defaults to GITHUB_SHA / GIT_COMMIT / PRISM_GIT_SHA. */
  gitSha?:         string;
  maxSamples?:     number;
  /** Pass requires overall_score >= threshold. */
  threshold?:      number;
  /** Regression if baseline_score - score > this (default 0.05). */
  regressionThreshold?: number;
}

export interface EvalResult {
  runId:          string;
  overallScore:   number;
  passRate:       number;
  nSamples:       number;
  edgeCases:      number;
  costUsd:        number;
  errors:         number;
  threshold:      number | null;
  meetsThreshold: boolean;
  baselineRunId:  string | null;
  baselineScore:  number | null;
  scoreDelta:     number | null;
  regression:     boolean;
  passed:         boolean;
}

export class EvalGateError extends Error {
  readonly result: EvalResult;
  constructor(result: EvalResult) {
    super(
      `Prism eval gate failed: score ${result.overallScore}` +
      (result.threshold != null ? ` (threshold ${result.threshold})` : "") +
      (result.regression ? `, REGRESSION vs baseline (Δ ${result.scoreDelta})` : ""),
    );
    this.name   = "EvalGateError";
    this.result = result;
  }
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

function resolveGitSha(explicit?: string): string | undefined {
  return explicit ?? process.env["GITHUB_SHA"] ?? process.env["GIT_COMMIT"] ?? process.env["PRISM_GIT_SHA"] ?? undefined;
}

/**
 * Run an experiment and return its verdict. Does NOT throw on a failing gate —
 * inspect `result.passed`. Throws only on transport/auth/validation errors.
 */
export async function runEval(opts: RunEvalOptions): Promise<EvalResult> {
  const apiKey = opts.apiKey ?? process.env["PRISM_API_KEY"];
  if (!apiKey) throw new Error("Prism eval: missing API key (set PRISM_API_KEY or pass apiKey).");
  if (!opts.dataset && !opts.items) throw new Error("Prism eval: provide `dataset` (id) or `items`.");

  const body = {
    dataset_id:           opts.dataset,
    items:                opts.items,
    name:                 opts.name,
    subject: {
      model:          opts.subject.model,
      system_prompt:  opts.subject.systemPrompt,
      prompt_version: opts.subject.promptVersion,
      params:         opts.subject.params,
    },
    scorers:              opts.scorers ?? ["correctness"],
    judge_model:          opts.judgeModel,
    rubric:               opts.rubric,
    provider_key_id:      opts.providerKeyId,
    baseline_run_id:      opts.baselineRunId,
    git_sha:              resolveGitSha(opts.gitSha),
    max_samples:          opts.maxSamples,
    threshold:            opts.threshold,
    regression_threshold: opts.regressionThreshold,
  };

  const res = await fetch(`${resolveBaseUrl(opts.baseUrl)}/api/evaluations/experiments`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Prism eval failed (${res.status}): ${String(json.error ?? res.statusText)}`);
  }

  return {
    runId:          String(json.run_id ?? ""),
    overallScore:   Number(json.overall_score ?? 0),
    passRate:       Number(json.pass_rate ?? 0),
    nSamples:       Number(json.n_samples ?? 0),
    edgeCases:      Number(json.edge_cases ?? 0),
    costUsd:        Number(json.cost_usd ?? 0),
    errors:         Number(json.errors ?? 0),
    threshold:      json.threshold == null ? null : Number(json.threshold),
    meetsThreshold: Boolean(json.meets_threshold),
    baselineRunId:  (json.baseline_run_id as string | null) ?? null,
    baselineScore:  json.baseline_score == null ? null : Number(json.baseline_score),
    scoreDelta:     json.score_delta == null ? null : Number(json.score_delta),
    regression:     Boolean(json.regression),
    passed:         Boolean(json.passed),
  };
}

/** Like runEval, but throws EvalGateError when the gate did not pass (for CI). */
export async function gateEval(opts: RunEvalOptions): Promise<EvalResult> {
  const result = await runEval(opts);
  if (!result.passed) throw new EvalGateError(result);
  return result;
}

/**
 * CLI entry: read a JSON config (path from argv[0] or PRISM_EVAL_CONFIG), run the
 * gate, print a summary, and exit non-zero on failure. Wired via the package bin
 * `prism-evals`:  npx prism-evals ./prism.eval.json
 */
export async function runEvalCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = argv[0] ?? process.env["PRISM_EVAL_CONFIG"];
  if (!configPath) {
    console.error("Usage: prism-evals <config.json>  (or set PRISM_EVAL_CONFIG)");
    process.exit(2);
  }
  let opts: RunEvalOptions;
  try {
    const fs = await import("node:fs/promises");
    opts = JSON.parse(await fs.readFile(configPath, "utf8")) as RunEvalOptions;
  } catch (e) {
    console.error(`prism-evals: could not read config ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
    return;
  }

  try {
    const r = await runEval(opts);
    const tag = r.passed ? "PASS" : "FAIL";
    console.log(
      `[prism-evals] ${tag} — score ${r.overallScore} (pass-rate ${r.passRate}, ${r.nSamples} samples, $${r.costUsd})` +
      (r.threshold != null ? ` · threshold ${r.threshold}` : "") +
      (r.scoreDelta != null ? ` · Δ vs baseline ${r.scoreDelta}` : "") +
      (r.regression ? " · REGRESSION" : ""),
    );
    console.log(`[prism-evals] run: ${r.runId}`);
    process.exit(r.passed ? 0 : 1);
  } catch (e) {
    console.error(`[prism-evals] error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
