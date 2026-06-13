/**
 * Per-key circuit breaker for the gateway.
 *
 * Redis keys (both use orgId+apiKeyId to scope per customer key):
 *   cb:open:{orgId}:{apiKeyId}   — exists = circuit open  (TTL = CB_OPEN_TTL_S)
 *   cb:errs:{orgId}:{apiKeyId}   — consecutive error count (TTL = CB_ERR_WINDOW_S)
 *
 * State machine:
 *   closed  → open  after CB_ERROR_THRESHOLD errors within CB_ERR_WINDOW_S seconds
 *   open    → half_open when the cb:open key within its TTL is close to expiry (last 30s)
 *   open    → closed on explicit reset (used by admin APIs)
 *
 * The gateway checks state via checkCircuitBreaker() before calling the upstream.
 * On provider 5xx it calls recordGatewayError() to count toward the threshold.
 * On success it calls resetCircuitBreaker() to clear accumulated errors.
 */

import { redis } from "@/lib/upstash/redis";

const CB_ERROR_THRESHOLD = 5;
const CB_ERR_WINDOW_S    = 60;   // rolling error count window
const CB_OPEN_TTL_S      = 300;  // 5 minutes — breaker stays open
const CB_HALF_OPEN_BEFORE = 30;  // report half_open when TTL < 30s

export type BreakerState = "closed" | "open" | "half_open";

function openKey(orgId: string, apiKeyId: string): string {
  return `cb:open:${orgId}:${apiKeyId}`;
}

function errKey(orgId: string, apiKeyId: string): string {
  return `cb:errs:${orgId}:${apiKeyId}`;
}

/**
 * Returns the current circuit breaker state for the org+key pair.
 * Fails open (returns 'closed') if Redis is unavailable.
 */
export async function getCircuitBreakerState(
  orgId:    string,
  apiKeyId: string,
): Promise<BreakerState> {
  try {
    const ttl = await redis.ttl(openKey(orgId, apiKeyId));
    if (ttl < 0) return "closed";  // key doesn't exist
    if (ttl <= CB_HALF_OPEN_BEFORE) return "half_open";
    return "open";
  } catch {
    return "closed";
  }
}

/**
 * Record a provider-level error for this org+key.
 * Opens the circuit after CB_ERROR_THRESHOLD errors within CB_ERR_WINDOW_S seconds.
 *
 * Uses a Lua script so the INCR → compare → SET sequence is atomic.
 */
export async function recordGatewayError(
  orgId:     string,
  apiKeyId:  string,
  errorType: "provider_error" | "cost_spike" | "rate_limit",
): Promise<void> {
  try {
    const ek = errKey(orgId, apiKeyId);
    const ok = openKey(orgId, apiKeyId);

    const script = `
      local count = redis.call('INCR', KEYS[1])
      redis.call('EXPIRE', KEYS[1], ARGV[1])
      if tonumber(count) >= tonumber(ARGV[2]) then
        redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4], 'NX')
      end
      return count
    `;

    await redis.eval(
      script,
      [ek, ok],
      [CB_ERR_WINDOW_S, CB_ERROR_THRESHOLD, errorType, CB_OPEN_TTL_S],
    );
  } catch { /* never block the hot path */ }
}

/**
 * Reset the circuit breaker for an org+key pair.
 * Called on a successful upstream response; clears both the open flag and error counter.
 */
export async function resetCircuitBreaker(
  orgId:    string,
  apiKeyId: string,
): Promise<void> {
  try {
    await redis.del(openKey(orgId, apiKeyId), errKey(orgId, apiKeyId));
  } catch { /* never block */ }
}

/**
 * Returns the current error count in the rolling window for this key.
 * Returns 0 if the key is not in Redis or Redis is unavailable.
 */
export async function getCircuitBreakerErrCount(
  orgId:    string,
  apiKeyId: string,
): Promise<number> {
  try {
    const count = await redis.get(errKey(orgId, apiKeyId));
    return count ? parseInt(String(count), 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Read-only check: returns true if the circuit is open or half-open.
 * Intended for the gateway pre-flight check — does not modify state.
 */
export async function isCircuitOpen(
  orgId:    string,
  apiKeyId: string,
): Promise<boolean> {
  try {
    const exists = await redis.exists(openKey(orgId, apiKeyId));
    return exists > 0;
  } catch {
    return false;  // fail open
  }
}
