/**
 * Provider health and latency tracking via Redis.
 *
 * Each successful gateway call updates:
 *   - p50 latency (rolling 10-minute window per model)
 *   - error rate (rolling 5-minute window per provider)
 *
 * The dynamic routing strategies (latency-based, health-based) read
 * these counters to rank candidates before trying them in order.
 */

import { redis } from "@/lib/upstash/redis";
import { calculateCost } from "@/lib/pricing/table";
import { type FallbackCandidate, weightedSample } from "@/lib/gateway/routing";

const LATENCY_WINDOW_SECONDS = 600;  // 10 minutes
const ERROR_WINDOW_SECONDS   = 300;  //  5 minutes

// Health-state thresholds (mirror Bifrost's adaptive-LB triggers).
const DEGRADED_ERROR_RATE = 0.02;  // >2% error → degraded
const FAILED_ERROR_RATE   = 0.05;  // >5% error → failed

export type HealthState = "healthy" | "degraded" | "recovering" | "failed";

export interface ProviderHealth {
  state:      HealthState;
  errorRate:  number;   // current 5-min window, 0–1
  latencyP50: number;   // ms (9999 = unknown)
}

// ── Keys ─────────────────────────────────────────────────────────────────────

function latencyKey(provider: string, model: string): string {
  return `latency:${provider}:${model}`;
}

function errorKey(provider: string): string {
  const bucket = Math.floor(Date.now() / 1000 / ERROR_WINDOW_SECONDS);
  return `errors:${provider}:${bucket}`;
}

function successKey(provider: string): string {
  const bucket = Math.floor(Date.now() / 1000 / ERROR_WINDOW_SECONDS);
  return `success:${provider}:${bucket}`;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Record a successful call's latency in the rolling sorted set. */
export async function recordLatency(
  provider:  string,
  model:     string,
  latencyMs: number,
): Promise<void> {
  try {
    const key = latencyKey(provider, model);
    const now = Math.floor(Date.now() / 1000);
    await redis.zadd(key, { score: now, member: `${now}_${Math.random().toString(36).slice(2)}:${latencyMs}` });
    // Remove old entries and refresh TTL
    await redis.zremrangebyscore(key, 0, now - LATENCY_WINDOW_SECONDS);
    await redis.expire(key, LATENCY_WINDOW_SECONDS * 2);

    // Increment success counter
    await redis.incr(successKey(provider));
    await redis.expire(successKey(provider), ERROR_WINDOW_SECONDS * 3);
  } catch { /* never block the gateway */ }
}

/** Record a failed upstream call (429, 503, 502, network error). */
export async function recordError(provider: string): Promise<void> {
  try {
    await redis.incr(errorKey(provider));
    await redis.expire(errorKey(provider), ERROR_WINDOW_SECONDS * 3);
  } catch { /* never block */ }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Get median (p50) latency in ms for a provider+model over the last 10 min. */
export async function getMedianLatency(provider: string, model: string): Promise<number> {
  try {
    const key  = latencyKey(provider, model);
    const now  = Math.floor(Date.now() / 1000);
    const members = await redis.zrange(key, now - LATENCY_WINDOW_SECONDS, now, { byScore: true }) as string[];
    if (!members.length) return 9999;  // unknown — sort last

    const latencies = members
      .map(m => parseFloat(m.split(":")[1] ?? "0"))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    return latencies[Math.floor(latencies.length / 2)] ?? 9999;
  } catch { return 9999; }
}

/**
 * Error rate (0–1) for a provider in a 5-min bucket relative to now.
 * offset 0 = current window, -1 = the previous window (used to detect recovery).
 */
async function getErrorRateAt(provider: string, offset: number): Promise<number> {
  try {
    const bucket = Math.floor(Date.now() / 1000 / ERROR_WINDOW_SECONDS) + offset;
    const [errors, successes] = await Promise.all([
      redis.get<number>(`errors:${provider}:${bucket}`),
      redis.get<number>(`success:${provider}:${bucket}`),
    ]);
    const e = Number(errors   ?? 0);
    const s = Number(successes ?? 0);
    const total = e + s;
    return total === 0 ? 0 : e / total;
  } catch { return 0; }
}

/** Get error rate (0–1) for a provider over the last 5 min. */
export async function getErrorRate(provider: string): Promise<number> {
  return getErrorRateAt(provider, 0);
}

/**
 * Classify a provider's health from its current and previous 5-min error rates.
 * >5% = failed, >2% = degraded. When the current window is healthy but the
 * previous one was not, the route is 'recovering' — callers can ramp traffic
 * back gradually rather than all at once.
 */
export function classifyHealthState(errorRate: number, prevErrorRate = 0): HealthState {
  if (errorRate > FAILED_ERROR_RATE)       return "failed";
  if (errorRate > DEGRADED_ERROR_RATE)     return "degraded";
  if (prevErrorRate > DEGRADED_ERROR_RATE) return "recovering";
  return "healthy";
}

/**
 * Full health read for a provider: state machine + raw error rate + p50 latency.
 * Reads the current and previous error windows so a recovering route is visible.
 * Never throws — degrades to a 'healthy' default on Redis failure.
 */
export async function getProviderHealth(provider: string, model = ""): Promise<ProviderHealth> {
  const [errorRate, prevErrorRate, latencyP50] = await Promise.all([
    getErrorRateAt(provider, 0),
    getErrorRateAt(provider, -1),
    getMedianLatency(provider, model),
  ]);
  return { state: classifyHealthState(errorRate, prevErrorRate), errorRate, latencyP50 };
}

/**
 * Fetch a point-in-time health snapshot for a set of providers.
 * Used by the routing policy evaluator to populate condition context.
 * Returns {} on Redis failure — never blocks the hot path.
 */
export async function getHealthSnapshot(
  providers: string[],
): Promise<Record<string, { error_rate: number; latency_p50: number }>> {
  if (!providers.length) return {};
  try {
    const deduped = Array.from(new Set(providers));
    const [rates, latencies] = await Promise.all([
      Promise.all(deduped.map(p => getErrorRate(p))),
      Promise.all(deduped.map(p => getMedianLatency(p, ""))),  // model="" → global p50
    ]);
    return Object.fromEntries(
      deduped.map((p, i) => [p, { error_rate: rates[i] ?? 0, latency_p50: latencies[i] ?? 9999 }]),
    );
  } catch { return {}; }
}

/**
 * Adjust each weighted candidate's effective weight by live provider health,
 * using two multiplicative factors:
 *   • error   — errorMultiplier   = max(0, 1 − errorRate*2); errorRate ≥ 0.5 ⇒ 0 (drop)
 *   • latency — latencyMultiplier = 1 − (relativeLatency * 0.3); the slowest route in
 *               the set loses up to 30%, the fastest loses nothing
 * effective = round(weight * errorMultiplier * latencyMultiplier).
 *
 * Errors can zero a route on their own; latency only re-orders routes that are
 * similarly reliable. Latency is relative within the candidate set, so when no
 * latency data exists (e.g. Redis down → all 9999) it contributes no penalty and
 * weights collapse to the original error-only behaviour. Candidates without a
 * weight field are returned unchanged (unweighted / legacy).
 */
export async function adaptCandidateWeights(
  candidates: FallbackCandidate[],
): Promise<FallbackCandidate[]> {
  const weighted = candidates.filter(c => c.weight !== undefined);
  if (!weighted.length) return candidates;

  const providers = Array.from(new Set(weighted.map(c => c.provider as string)));
  const rates     = await Promise.all(providers.map(p => getErrorRate(p)));
  const rateMap   = Object.fromEntries(providers.map((p, i) => [p, rates[i] ?? 0]));

  // Latency is tracked per provider+model; fold it in as a relative secondary factor.
  const latencies = await Promise.all(weighted.map(c => getMedianLatency(c.provider as string, c.model)));
  const latMap    = new Map<FallbackCandidate, number>(weighted.map((c, i) => [c, latencies[i] ?? 9999]));
  const known     = latencies.filter(l => l < 9999);
  const minLat    = known.length ? Math.min(...known) : 0;
  const maxLat    = known.length ? Math.max(...known) : 0;
  const latRange  = maxLat - minLat;

  return candidates.map(c => {
    if (c.weight === undefined) return c;
    const errorRate         = rateMap[c.provider as string] ?? 0;
    const errorMultiplier   = Math.max(0, 1 - errorRate * 2);
    const lat               = latMap.get(c) ?? 9999;
    const latencyPenalty    = (latRange > 0 && lat < 9999) ? (lat - minLat) / latRange : 0;
    const latencyMultiplier = 1 - latencyPenalty * 0.3;
    const effective         = Math.max(0, Math.round(c.weight * errorMultiplier * latencyMultiplier));
    return { ...c, weight: effective };
  });
}

/**
 * Sort fallback candidates using the specified strategy.
 * 'error' = keep original order (error-triggered fallback, already handled upstream)
 * 'latency' = fastest first based on rolling p50
 * 'cost' = cheapest model first (requires pricing table)
 * 'health' = order by health state (healthy → recovering → degraded → failed)
 *
 * When ANY candidate has an explicit `weight` field, weighted selection is used
 * instead of a sort: one candidate is picked proportionally (with adaptive weight
 * reduction for unhealthy providers), then the rest follow in weight-desc order as
 * fallbacks. This is independent of the strategy parameter.
 */
export async function rankCandidates(
  candidates: Array<{ model: string; provider: string }>,
  strategy:   "error" | "latency" | "cost" | "health",
): Promise<Array<{ model: string; provider: string }>> {
  if (candidates.length <= 1) return candidates;

  // Weighted mode: any candidate with an explicit weight triggers weighted selection
  const fc = candidates as FallbackCandidate[];
  if (fc.some(c => c.weight !== undefined)) {
    const adapted = await adaptCandidateWeights(fc);
    const primary = weightedSample(adapted);
    const rest    = adapted
      .filter(c => c !== primary)
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    return [primary, ...rest];
  }

  if (strategy === "error") return candidates;

  if (strategy === "latency") {
    const latencies = await Promise.all(
      candidates.map(c => getMedianLatency(c.provider, c.model))
    );
    return candidates
      .map((c, i) => ({ ...c, latency: latencies[i] ?? 9999 }))
      .sort((a, b) => a.latency - b.latency);
  }

  if (strategy === "health") {
    const providers = Array.from(new Set(candidates.map(c => c.provider)));
    const healths   = await Promise.all(providers.map(p => getProviderHealth(p)));
    const order: Record<HealthState, number> = { healthy: 0, recovering: 1, degraded: 2, failed: 3 };
    const rankOf    = Object.fromEntries(providers.map((p, i) => [p, order[healths[i]!.state]]));
    // Healthy first, failed last; stable for providers in the same state.
    return [...candidates].sort((a, b) => (rankOf[a.provider] ?? 0) - (rankOf[b.provider] ?? 0));
  }

  if (strategy === "cost") {
    // Cheapest model first. Local providers (ollama, openai_compatible) are not in
    // the pricing table → calculateCost returns 0 → they are always ranked first.
    // Use a representative 1k/1k token call for comparison — relative order only.
    return [...candidates].sort((a, b) => {
      const aCost = calculateCost(a.model, 1000, 1000);
      const bCost = calculateCost(b.model, 1000, 1000);
      return aCost - bCost;
    });
  }

  return candidates;
}
