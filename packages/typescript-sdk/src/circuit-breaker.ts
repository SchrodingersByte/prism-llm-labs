/**
 * In-process circuit breaker for SDK wrapper mode.
 *
 * Teams using the SDK without a gateway (no PRISM_GATEWAY_URL) route calls
 * directly to upstream providers. If the provider is degraded, nothing trips the
 * server-side Redis breaker. This module provides a local fast-path breaker keyed
 * by `${apiKey}:${provider}`, and fires a fire-and-forget advisory POST to the
 * Prism ingest endpoint so the gateway's shared Redis key is also set.
 */

export class PrismCircuitOpenError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`Prism circuit open for provider "${provider}" — too many recent errors. Retry after ${CB_OPEN_TTL_MS / 1000}s.`);
    this.name     = "PrismCircuitOpenError";
    this.provider = provider;
  }
}

const CB_THRESHOLD   = 5;        // consecutive errors within window to open
const CB_WINDOW_MS   = 60_000;   // 60-second error counting window
const CB_OPEN_TTL_MS = 300_000;  // 5 minutes open before auto-close

interface BreakerEntry {
  errors:      number;
  windowStart: number;
  openedAt:    number | null;
}

const _breakers = new Map<string, BreakerEntry>();

function _key(apiKey: string, provider: string): string {
  return `${apiKey}:${provider}`;
}

function _now(): number {
  return Date.now();
}

/** Returns true when the breaker for this key is open (requests should be rejected). */
export function isCircuitOpen(apiKey: string, provider: string): boolean {
  const entry = _breakers.get(_key(apiKey, provider));
  if (!entry?.openedAt) return false;
  if (_now() - entry.openedAt >= CB_OPEN_TTL_MS) {
    // Auto-close after TTL — allow one probe through (half-open)
    entry.openedAt = null;
    entry.errors   = 0;
    return false;
  }
  return true;
}

/**
 * Record a provider error. Opens the breaker after CB_THRESHOLD errors within
 * CB_WINDOW_MS. When the breaker opens, fires an advisory POST to Prism so the
 * server-side Redis key is also set (shared state across gateway + other instances).
 */
export function recordProviderError(
  apiKey:    string,
  provider:  string,
  ingestUrl: string,
  errorType: "provider_error" | "rate_limit" | "cost_spike" = "provider_error",
): void {
  const k   = _key(apiKey, provider);
  const now = _now();
  let entry = _breakers.get(k);

  if (!entry || now - entry.windowStart > CB_WINDOW_MS) {
    entry = { errors: 0, windowStart: now, openedAt: null };
    _breakers.set(k, entry);
  }

  entry.errors += 1;

  if (entry.errors >= CB_THRESHOLD && entry.openedAt === null) {
    entry.openedAt = now;
    // Advisory sync to shared Redis — fire-and-forget, never awaited
    const base = ingestUrl.replace(/\/api\/ingest$/, "");
    fetch(`${base}/api/telemetry/errors`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ apiKey, provider, error_type: errorType }),
    }).catch(() => {});
  }
}

/** Reset the breaker on a successful call. */
export function resetBreaker(apiKey: string, provider: string): void {
  const entry = _breakers.get(_key(apiKey, provider));
  if (entry) {
    entry.errors   = 0;
    entry.openedAt = null;
  }
}
