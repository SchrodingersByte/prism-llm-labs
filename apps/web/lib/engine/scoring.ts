/**
 * Efficiency score calculation (0–100).
 * Measures how well an org is using models across 4 dimensions.
 */
import type { EfficiencyScore } from "./types";
import type { ModelSpend } from "@/lib/tinybird/queries";
import { MODEL_PRICING, normalizeModelName as resolveModel } from "@/lib/pricing/table";

/** Models with 128k+ context that cost more (large-context premium). */
const LARGE_CONTEXT_MODELS = new Set([
  "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4o",
  "claude-3-opus-20240229", "claude-3-5-sonnet-20241022",
  "gemini-1.5-pro",
]);

/** Models considered "lightweight" / low-cost tier. */
const LIGHTWEIGHT_MODELS = new Set([
  "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-5-mini", "gpt-5-nano",
  "claude-3-5-haiku-20241022", "claude-haiku-4-5",
  "gemini-1.5-flash", "gemini-flash-1.5",
]);

export function computeEfficiencyScore(
  modelSpend:      ModelSpend[],
  appliedRecs:     number,
  totalRecs:       number,
): EfficiencyScore {
  if (!modelSpend.length) {
    return { score: 50, cost_efficiency: 0.5, model_alignment: 0.5, cache_utilisation: 0.5, adoption_rate: 0.5 };
  }

  // ── 1. Cost efficiency: tokens_per_dollar vs provider benchmark ──────────
  // Benchmark: a "reasonable" tokens/$ for the provider mix
  const BENCHMARKS: Record<string, number> = {
    openai:    400_000, // ~gpt-4o-mini baseline
    anthropic: 300_000,
    google:    500_000,
    openrouter: 350_000,
  };

  const totalCost = modelSpend.reduce((s, m) => s + m.total_cost_usd, 0);
  let weightedEfficiency = 0;
  for (const row of modelSpend) {
    const bench = BENCHMARKS[row.provider] ?? 350_000;
    const ratio = Math.min(row.tokens_per_dollar / bench, 1.5); // cap at 1.5x
    weightedEfficiency += ratio * (row.total_cost_usd / Math.max(totalCost, 0.0001));
  }
  const cost_efficiency = Math.min(weightedEfficiency / 1.5, 1); // normalise to 0-1

  // ── 2. Model alignment: are expensive models used only when necessary? ───
  // Proxy: what % of requests use lightweight models?
  const totalRequests = modelSpend.reduce((s, m) => s + m.requests, 0);
  const lightweightRequests = modelSpend
    .filter(m => LIGHTWEIGHT_MODELS.has(resolveModel(m.model) ?? ""))
    .reduce((s, m) => s + m.requests, 0);
  // Good alignment: 40-60% lightweight. Pure lightweight OR pure expensive both score lower.
  const lightFraction = lightweightRequests / Math.max(totalRequests, 1);
  // Bell curve: peak at 0.5 (50% lightweight), lower at extremes
  const model_alignment = 1 - Math.pow(2 * lightFraction - 1, 2) * 0.6;

  // ── 3. Cache utilisation: actual vs theoretical ──────────────────────────
  const cacheCapableSpend = modelSpend.filter(m => {
    const pricing = MODEL_PRICING[resolveModel(m.model) ?? ""];
    return pricing?.cached_input !== undefined;
  });
  let cache_utilisation = 0.5; // default if no cache-capable models
  if (cacheCapableSpend.length > 0) {
    const weightedHitRate = cacheCapableSpend.reduce(
      (s, m) => s + m.cache_hit_rate * (m.total_cost_usd / totalCost), 0,
    );
    // Normalise: 0.3 hit rate = 0.6 score, 0.6 hit rate = 1.0 score
    cache_utilisation = Math.min(weightedHitRate / 0.6, 1);
  }

  // ── 4. Recommendation adoption rate ─────────────────────────────────────
  const adoption_rate = totalRecs > 0 ? Math.min(appliedRecs / totalRecs, 1) : 0.5;

  // ── Weighted composite ────────────────────────────────────────────────────
  const score = Math.round(
    (cost_efficiency  * 0.30 +
     model_alignment  * 0.30 +
     cache_utilisation * 0.20 +
     adoption_rate    * 0.20) * 100,
  );

  return {
    score:            Math.max(10, Math.min(100, score)),
    cost_efficiency,
    model_alignment,
    cache_utilisation,
    adoption_rate,
  };
}
