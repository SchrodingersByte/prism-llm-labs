/**
 * Scorer interface + concrete scorer implementations.
 *
 * A scorer takes a model output (and optionally the original input) and
 * returns a numeric 0–1 score plus a pass/fail decision. Scorers are
 * composable — a ValidationRun can apply several scorers and combine their
 * ScorerSummaries. The same scorer interface powers both synthetic benchmark
 * runs (recordValidationFromEval) and real-sample replay runs.
 */

import { detectPII, type CustomPattern } from "@/lib/privacy/pii-detector";
import { buildUpstreamUrl, getProviderConfig } from "@/lib/gateway/upstream";

// ── Core interfaces ───────────────────────────────────────────────────────────

export interface ScorerResult {
  score:     number;             // 0–1
  passed:    boolean;
  reason?:   string;
  metadata?: Record<string, unknown>;
}

export interface ScorerSummary {
  mean:      number;
  pass_rate: number;
  n:         number;
}

export interface Scorer<TOutput = unknown, TInput = unknown> {
  name: string;
  score(output: TOutput, input?: TInput): Promise<ScorerResult>;
  summarize(results: ScorerResult[]): ScorerSummary;
}

// ── Shared summarize helper ───────────────────────────────────────────────────

function defaultSummarize(results: ScorerResult[]): ScorerSummary {
  if (!results.length) return { mean: 0, pass_rate: 0, n: 0 };
  const mean      = results.reduce((s, r) => s + r.score, 0) / results.length;
  const pass_rate = results.filter(r => r.passed).length / results.length;
  return { mean, pass_rate, n: results.length };
}

// ── SemanticSimilarityScorer ──────────────────────────────────────────────────
// Computes cosine similarity between two text strings via an embeddings
// endpoint. Passes when similarity >= threshold (default 0.85).
//
// Uses the existing gateway upstream utilities so it respects provider
// config (auth header format, base URL) without duplicating that logic.

export interface SemanticScorerOptions {
  providerKey:    string;    // decrypted provider key
  provider?:      string;    // "openai" (default) | "azure_openai" | etc.
  embeddingModel?: string;   // "text-embedding-3-small" by default
  threshold?:     number;    // cosine similarity threshold, default 0.85
  customEndpoint?: string;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(
  text:     string,
  opts:     SemanticScorerOptions,
): Promise<number[]> {
  const provider = opts.provider ?? "openai";
  const model    = opts.embeddingModel ?? "text-embedding-3-small";
  const config   = getProviderConfig(provider, opts.customEndpoint);
  const url      = buildUpstreamUrl(provider, "/v1/embeddings", opts.providerKey, opts.customEndpoint);

  const builtHeaders = config.buildHeaders(opts.providerKey, new Headers({ "Content-Type": "application/json" }));
  const res = await fetch(url, {
    method:  "POST",
    headers: { ...builtHeaders, "Content-Type": "application/json" },
    body:    JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Embeddings request failed (${res.status}): ${msg}`);
  }

  const json = await res.json() as { data?: Array<{ embedding: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("Embeddings response missing data[0].embedding");
  return embedding;
}

export class SemanticSimilarityScorer implements Scorer<string, string> {
  readonly name = "semantic_similarity";

  constructor(private readonly opts: SemanticScorerOptions) {}

  async score(output: string, input?: string): Promise<ScorerResult> {
    if (!input) return { score: 0, passed: false, reason: "No reference input provided" };

    const threshold = this.opts.threshold ?? 0.85;

    try {
      const [outEmb, inEmb] = await Promise.all([embed(output, this.opts), embed(input, this.opts)]);
      const sim = cosine(outEmb, inEmb);
      return {
        score:   sim,
        passed:  sim >= threshold,
        reason:  `cosine similarity ${sim.toFixed(4)} (threshold ${threshold})`,
        metadata: { similarity: sim, threshold },
      };
    } catch (err) {
      return {
        score:   0,
        passed:  false,
        reason:  String(err),
      };
    }
  }

  summarize(results: ScorerResult[]): ScorerSummary {
    return defaultSummarize(results);
  }
}

// ── PIIGuardrailScorer ────────────────────────────────────────────────────────
// Runs detectPII() on the model output. Passes (score=1) when no PII is found;
// fails (score=0) when PII is detected. This is called directly — it does NOT
// read pii_config from the DB and is not gated behind pii_detection_enabled,
// so it always evaluates regardless of org-level settings.

export interface PIIScorerOptions {
  customPatterns?: CustomPattern[];
}

export class PIIGuardrailScorer implements Scorer<string> {
  readonly name = "pii_guardrail";

  constructor(private readonly opts: PIIScorerOptions = {}) {}

  async score(output: string): Promise<ScorerResult> {
    const result = detectPII([{ role: "assistant", content: output }], this.opts.customPatterns);

    if (!result.detected) {
      return { score: 1, passed: true, reason: "No PII detected" };
    }

    const types = result.matches.map(m => m.type).join(", ");
    return {
      score:   0,
      passed:  false,
      reason:  `PII detected: ${types}`,
      metadata: { pii_types: result.matches.map(m => m.type), match_count: result.matches.length },
    };
  }

  summarize(results: ScorerResult[]): ScorerSummary {
    return defaultSummarize(results);
  }
}

// ── Exact match scorer ────────────────────────────────────────────────────────
// Simple structural equality check — useful as a fast baseline when the
// expected output is known exactly (e.g. classification labels, JSON schemas).

export class ExactMatchScorer implements Scorer<unknown, unknown> {
  readonly name = "exact_match";

  async score(output: unknown, input?: unknown): Promise<ScorerResult> {
    const out = typeof output === "string" ? output.trim() : JSON.stringify(output);
    const ref = typeof input  === "string" ? input.trim()  : JSON.stringify(input);
    const passed = out === ref;
    return { score: passed ? 1 : 0, passed, reason: passed ? "exact match" : "no match" };
  }

  summarize(results: ScorerResult[]): ScorerSummary {
    return defaultSummarize(results);
  }
}
