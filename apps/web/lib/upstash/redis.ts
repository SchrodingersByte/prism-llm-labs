import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function monthKey(orgId: string, projectId: string): string {
  const m = new Date().toISOString().slice(0, 7); // "2026-05"
  return `budget:${orgId}:${projectId}:${m}`;
}

function dayKey(apiKeyId: string): string {
  const d = new Date().toISOString().slice(0, 10); // "2026-05-29"
  return `daily:apikey:${apiKeyId}:${d}`;
}

function keyMonthKey(apiKeyId: string): string {
  const m = new Date().toISOString().slice(0, 7);
  return `budget:apikey:${apiKeyId}:${m}`;
}

export async function incrementSpend(
  orgId: string,
  projectId: string,
  costUsd: number,
): Promise<void> {
  const key  = monthKey(orgId, projectId);
  await redis.incrbyfloat(key, costUsd);
  // Expire at UTC midnight on the 1st of next month
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  await redis.expireat(key, Math.floor(next.getTime() / 1000));
}

export async function getSpend(orgId: string, projectId: string): Promise<number> {
  const val = await redis.get<number>(monthKey(orgId, projectId));
  return val ?? 0;
}

/**
 * Atomically adds costUsd to the spend counter only if the result would stay
 * at or below limitUsd. Returns 'ok' on success, 'exceeded' if the cap would
 * be breached. Safe under concurrent requests — no TOCTOU gap.
 */
export async function incrementSpendIfBelowLimit(
  orgId: string,
  projectId: string,
  costUsd: number,
  limitUsd: number,
): Promise<"ok" | "exceeded"> {
  const key = monthKey(orgId, projectId);

  // Set expiry on the same key after the Lua script runs
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  const expireAt = Math.floor(next.getTime() / 1000);

  const script = `
    local cur = tonumber(redis.call('GET', KEYS[1]) or 0)
    if cur + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 'exceeded' end
    redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
    redis.call('EXPIREAT', KEYS[1], ARGV[3])
    return 'ok'
  `;

  const result = await redis.eval(script, [key], [costUsd, limitUsd, expireAt]);
  return result === "exceeded" ? "exceeded" : "ok";
}

/** Track per-key monthly spend. Called at ingest time alongside project tracking. */
export async function incrementKeySpend(apiKeyId: string, costUsd: number): Promise<void> {
  const key  = keyMonthKey(apiKeyId);
  await redis.incrbyfloat(key, costUsd);
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  await redis.expireat(key, Math.floor(next.getTime() / 1000));
}

// ── Team budget helpers ───────────────────────────────────────────────────────

function teamMonthKey(orgId: string, teamId: string): string {
  const m = new Date().toISOString().slice(0, 7);
  return `budget:team:${orgId}:${teamId}:${m}`;
}

/** Increment per-team monthly spend. Expires at start of next month like project counters. */
export async function incrementTeamSpend(orgId: string, teamId: string, costUsd: number): Promise<void> {
  if (!teamId) return;
  const key  = teamMonthKey(orgId, teamId);
  await redis.incrbyfloat(key, costUsd);
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  await redis.expireat(key, Math.floor(next.getTime() / 1000));
}

export async function getTeamSpend(orgId: string, teamId: string): Promise<number> {
  if (!teamId) return 0;
  const val = await redis.get<number>(teamMonthKey(orgId, teamId));
  return val ?? 0;
}

/** Atomically check team budget cap + increment. Returns 'ok' or 'exceeded'. */
export async function incrementTeamSpendIfBelowLimit(
  orgId:    string,
  teamId:   string,
  costUsd:  number,
  limitUsd: number,
): Promise<"ok" | "exceeded"> {
  if (!teamId) return "ok";
  const key = teamMonthKey(orgId, teamId);
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  const expireAt = Math.floor(next.getTime() / 1000);

  const script = `
    local cur = tonumber(redis.call('GET', KEYS[1]) or 0)
    if cur + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 'exceeded' end
    redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
    redis.call('EXPIREAT', KEYS[1], ARGV[3])
    return 'ok'
  `;

  const result = await redis.eval(script, [key], [costUsd, limitUsd, expireAt]);
  return result === "exceeded" ? "exceeded" : "ok";
}

// ── Session budget helpers ────────────────────────────────────────────────────
// Session keys expire after 24 h — agent runs don't span multiple days.
// Used by the MCP middleware circuit breaker.

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 h

function sessionCostKey(orgId: string, sessionId: string): string {
  return `session:${orgId}:${sessionId}:cost`;
}

function sessionToolKey(orgId: string, sessionId: string): string {
  return `session:${orgId}:${sessionId}:tool_calls`;
}

/** Increment session cost counter. Returns new total. */
export async function incrementSessionSpend(
  orgId: string, sessionId: string, costUsd: number,
): Promise<number> {
  const key = sessionCostKey(orgId, sessionId);
  const newVal = await redis.incrbyfloat(key, costUsd);
  await redis.expire(key, SESSION_TTL_SECONDS);
  return Number(newVal) || 0;
}

/** Increment session tool call counter. Returns new total. */
export async function incrementSessionToolCalls(
  orgId: string, sessionId: string, count: number,
): Promise<number> {
  const key = sessionToolKey(orgId, sessionId);
  const newVal = await redis.incrby(key, count);
  await redis.expire(key, SESSION_TTL_SECONDS);
  return Number(newVal) || 0;
}

/** Read current session spend. Returns 0 if key doesn't exist. */
export async function getSessionSpend(orgId: string, sessionId: string): Promise<number> {
  const val = await redis.get<number>(sessionCostKey(orgId, sessionId));
  return val ?? 0;
}

/** Read current session tool call count. */
export async function getSessionToolCalls(orgId: string, sessionId: string): Promise<number> {
  const val = await redis.get<number>(sessionToolKey(orgId, sessionId));
  return val ?? 0;
}

/**
 * Atomically check session budget + increment if below limit.
 * Returns 'ok' | 'exceeded'. Used by MCP middleware before executing a tool call.
 */
export async function checkAndIncrementSession(
  orgId:       string,
  sessionId:   string,
  toolCostUsd: number,
  budgetUsd:   number,
): Promise<"ok" | "exceeded"> {
  const costKey = sessionCostKey(orgId, sessionId);

  const script = `
    local cur = tonumber(redis.call('GET', KEYS[1]) or 0)
    if cur + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 'exceeded' end
    redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return 'ok'
  `;

  const result = await redis.eval(
    script,
    [costKey],
    [toolCostUsd, budgetUsd, SESSION_TTL_SECONDS],
  );
  return result === "exceeded" ? "exceeded" : "ok";
}

/** Track per-key daily spend. Expires at end of UTC day. */
export async function incrementKeyDailySpend(apiKeyId: string, costUsd: number): Promise<void> {
  const key = dayKey(apiKeyId);
  await redis.incrbyfloat(key, costUsd);
  // expire at start of next UTC day
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  await redis.expireat(key, Math.floor(tomorrow.getTime() / 1000));
}

/**
 * Atomically check key-level caps via a single Lua script — no TOCTOU race.
 * Returns 'exceeded_monthly' | 'exceeded_daily' | 'ok'.
 */
export async function checkKeyCaps(
  apiKeyId:    string,
  costUsd:     number,
  hardCapUsd:  number | null,
  dailyCapUsd: number | null,
  bufferPct:   number,
): Promise<"exceeded_monthly" | "exceeded_daily" | "ok"> {
  if (!hardCapUsd && !dailyCapUsd) return "ok";

  const bufferMult = 1 + (bufferPct ?? 0) / 100;

  const script = `
    local hardCap  = tonumber(ARGV[1])
    local dailyCap = tonumber(ARGV[2])
    local cost     = tonumber(ARGV[3])
    local mult     = tonumber(ARGV[4])
    if hardCap > 0 then
      local ms = tonumber(redis.call('GET', KEYS[1]) or 0)
      if ms + cost > hardCap * mult then return 'exceeded_monthly' end
    end
    if dailyCap > 0 then
      local ds = tonumber(redis.call('GET', KEYS[2]) or 0)
      if ds + cost > dailyCap * mult then return 'exceeded_daily' end
    end
    return 'ok'
  `;

  const result = await redis.eval(
    script,
    [keyMonthKey(apiKeyId), dayKey(apiKeyId)],
    [hardCapUsd ?? 0, dailyCapUsd ?? 0, costUsd, bufferMult],
  );
  return (result as string) === "exceeded_monthly" ? "exceeded_monthly"
       : (result as string) === "exceeded_daily"   ? "exceeded_daily"
       : "ok";
}

// ── Rolling-window cap helpers ────────────────────────────────────────────────
// Events are stored in a Redis sorted set: score = Unix timestamp (seconds),
// member = "{nanoid}:{costUsd}". To get the rolling spend we sum all members
// whose score falls inside [now - windowSeconds, now].

const PERIOD_WINDOW_SECONDS: Record<string, number> = {
  daily:   86_400,
  weekly:  86_400 * 7,
  monthly: 86_400 * 30,
};

function rollingKey(apiKeyId: string, period: string): string {
  return `rolling:${apiKeyId}:${period}`;
}

/**
 * Add a spend event to the rolling sorted set and prune events outside the
 * window. The set TTL is set to 2× the window so old data is auto-cleaned.
 */
export async function addRollingSpend(
  apiKeyId:  string,
  period:    string,
  costUsd:   number,
): Promise<void> {
  const key    = rollingKey(apiKeyId, period);
  const now    = Math.floor(Date.now() / 1000);
  const window = PERIOD_WINDOW_SECONDS[period] ?? 86_400 * 30;
  const member = `${now}_${Math.random().toString(36).slice(2, 8)}:${costUsd}`;

  // ZADD + prune old entries + refresh TTL in one pipeline
  await redis.zadd(key, { score: now, member });
  // Remove entries older than the window
  await redis.zremrangebyscore(key, 0, now - window);
  await redis.expire(key, window * 2);
}

/**
 * Sum spend in the rolling window for this key + period.
 * Returns 0 if no events exist.
 */
export async function getRollingSpend(
  apiKeyId: string,
  period:   string,
): Promise<number> {
  const key    = rollingKey(apiKeyId, period);
  const now    = Math.floor(Date.now() / 1000);
  const window = PERIOD_WINDOW_SECONDS[period] ?? 86_400 * 30;

  const members = await redis.zrange(key, now - window, now, { byScore: true }) as string[];
  return members.reduce((sum, m) => {
    const cost = parseFloat(m.split(":")[1] ?? "0");
    return sum + (isNaN(cost) ? 0 : cost);
  }, 0);
}

// ── Real-time spend velocity tracking ────────────────────────────────────────
// Writes cost events into a sorted set keyed by timestamp. Used by the
// velocity_spike alert type to detect runaway agent loops or API abuse
// within a 5-minute window, not just at daily-boundary comparison.

function velocityKey(orgId: string, apiKeyId: string): string {
  return `velocity:${orgId}:${apiKeyId}`;
}

const VELOCITY_TTL_SECONDS = 60 * 60 * 2; // keep 2 hours of velocity data

/**
 * Record a cost event into the org+key velocity sorted set.
 * Score = Unix timestamp (seconds); member = "{ts}_{nonce}:{costUsd}".
 * Fire-and-forget — never throws.
 */
export async function trackSpendVelocity(
  orgId:     string,
  apiKeyId:  string,
  costUsd:   number,
): Promise<void> {
  try {
    const key    = velocityKey(orgId, apiKeyId);
    const now    = Math.floor(Date.now() / 1000);
    const member = `${now}_${Math.random().toString(36).slice(2, 7)}:${costUsd}`;
    await redis.zadd(key, { score: now, member });
    // Prune entries older than 2 hours to bound set size
    await redis.zremrangebyscore(key, 0, now - VELOCITY_TTL_SECONDS);
    await redis.expire(key, VELOCITY_TTL_SECONDS);
  } catch { /* velocity tracking must never break the hot path */ }
}

/**
 * Sum cost events in the last `windowSeconds` seconds for the given org+key.
 * Returns 0 if no data or Redis is unavailable.
 */
export async function getWindowSpend(
  orgId:         string,
  apiKeyId:      string,
  windowSeconds: number,
): Promise<number> {
  try {
    const key     = velocityKey(orgId, apiKeyId);
    const now     = Math.floor(Date.now() / 1000);
    const members = await redis.zrange(key, now - windowSeconds, now, { byScore: true }) as string[];
    return members.reduce((sum, m) => {
      const cost = parseFloat(m.split(":")[1] ?? "0");
      return sum + (isNaN(cost) ? 0 : cost);
    }, 0);
  } catch {
    return 0;
  }
}

// ── Environment-scoped key helpers (used only for env-specific caps) ─────────

function envDayKey(apiKeyId: string, env: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `daily:apikey:${apiKeyId}:${d}:${env}`;
}

function envMonthKey(apiKeyId: string, env: string): string {
  const m = new Date().toISOString().slice(0, 7);
  return `budget:apikey:${apiKeyId}:${m}:${env}`;
}

function rollingEnvKey(apiKeyId: string, period: string, env: string): string {
  return `rolling:${apiKeyId}:${period}:${env}`;
}

async function getRollingSpendForKey(key: string, period: string): Promise<number> {
  const now    = Math.floor(Date.now() / 1000);
  const window = PERIOD_WINDOW_SECONDS[period] ?? 86_400 * 30;
  const members = await redis.zrange(key, now - window, now, { byScore: true }) as string[];
  return members.reduce((sum, m) => {
    const cost = parseFloat(m.split(":")[1] ?? "0");
    return sum + (isNaN(cost) ? 0 : cost);
  }, 0);
}

/**
 * Check all caps from the key_caps table.
 * For calendar caps  → reads existing budget:apikey:{id}:{month} / daily:apikey:{id}:{day} keys.
 * For rolling caps   → reads rolling sorted sets.
 * Caps with environment set are only applied when the event environment matches.
 * Caps with environment = null apply to all environments.
 * Returns 'ok' | 'exceeded:{capId}' | 'circuit_open'.
 */
export async function checkAllKeyCaps(
  apiKeyId:    string,
  caps:        Array<{ id: string; period: string; is_rolling: boolean; amount_usd: number; environment?: string | null }>,
  environment: string = "production",
  orgId:       string = "",
): Promise<"ok" | string> {
  // Circuit breaker check — slot into Layer 2 before spend cap evaluation
  if (orgId) {
    try {
      const cbOpen = await redis.exists(`cb:open:${orgId}:${apiKeyId}`);
      if (cbOpen > 0) return "circuit_open";
    } catch { /* Redis unavailable — fail open */ }
  }

  if (!caps.length) return "ok";

  // Apply only universal caps (env = null) and caps matching the event's environment
  const applicable = caps.filter(c => !c.environment || c.environment === environment);
  if (!applicable.length) return "ok";

  // Issue all cap reads in a single pipeline round-trip instead of N sequential awaits.
  const now  = Math.floor(Date.now() / 1000);
  const pipe = redis.pipeline();

  for (const cap of applicable) {
    const isEnvSpecific = !!cap.environment;
    if (cap.is_rolling) {
      const key    = isEnvSpecific
        ? rollingEnvKey(apiKeyId, cap.period, cap.environment!)
        : rollingKey(apiKeyId, cap.period);
      const window = PERIOD_WINDOW_SECONDS[cap.period] ?? 86_400 * 30;
      pipe.zrange(key, now - window, now, { byScore: true });
    } else if (cap.period === "daily") {
      const key = isEnvSpecific ? envDayKey(apiKeyId, cap.environment!) : dayKey(apiKeyId);
      pipe.get(key);
    } else {
      // weekly and monthly both use the monthly key for calendar mode
      const key = isEnvSpecific ? envMonthKey(apiKeyId, cap.environment!) : keyMonthKey(apiKeyId);
      pipe.get(key);
    }
  }

  let pipeResults: unknown[];
  try {
    pipeResults = await pipe.exec();
  } catch {
    return "ok"; // Redis unavailable — fail open
  }

  for (let i = 0; i < applicable.length; i++) {
    const cap = applicable[i]!;
    const raw = pipeResults[i];
    let spend = 0;
    try {
      if (cap.is_rolling) {
        const members = (Array.isArray(raw) ? raw : []) as string[];
        spend = members.reduce((sum, m) => {
          const cost = parseFloat(m.split(":")[1] ?? "0");
          return sum + (isNaN(cost) ? 0 : cost);
        }, 0);
      } else {
        spend = Number(raw) || 0;
      }
    } catch { /* parse error — treat as 0 */ }
    if (spend >= cap.amount_usd) return `exceeded:${cap.id}`;
  }
  return "ok";
}

/**
 * Increment all relevant Redis counters after a successful call.
 * Env-specific caps use separate counters keyed by environment.
 * Universal caps (environment = null) use the original counter keys.
 */
export async function incrementAllCapCounters(
  apiKeyId:    string,
  costUsd:     number,
  caps:        Array<{ period: string; is_rolling: boolean; environment?: string | null }>,
  environment: string = "production",
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const seen = new Set<string>();

  for (const cap of caps) {
    const isEnvSpecific = !!cap.environment;
    // Only increment env-specific counters when the event matches that environment
    if (isEnvSpecific && cap.environment !== environment) continue;

    const ck = `${cap.period}:${cap.is_rolling}:${cap.environment ?? ""}`;
    if (seen.has(ck)) continue;
    seen.add(ck);

    if (cap.is_rolling) {
      const key = isEnvSpecific
        ? rollingEnvKey(apiKeyId, cap.period, cap.environment!)
        : rollingKey(apiKeyId, cap.period);
      const now    = Math.floor(Date.now() / 1000);
      const window = PERIOD_WINDOW_SECONDS[cap.period] ?? 86_400 * 30;
      const member = `${now}_${Math.random().toString(36).slice(2, 8)}:${costUsd}`;
      tasks.push(
        redis.zadd(key, { score: now, member })
          .then(() => redis.zremrangebyscore(key, 0, now - window))
          .then(() => redis.expire(key, window * 2))
          .catch(() => {}),
      );
    } else if (cap.period === "daily") {
      if (isEnvSpecific) {
        const key      = envDayKey(apiKeyId, cap.environment!);
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        tasks.push(
          redis.incrbyfloat(key, costUsd)
            .then(() => redis.expireat(key, Math.floor(tomorrow.getTime() / 1000)))
            .catch(() => {}),
        );
      } else {
        tasks.push(incrementKeyDailySpend(apiKeyId, costUsd).catch(() => {}));
      }
    } else {
      if (isEnvSpecific) {
        const key  = envMonthKey(apiKeyId, cap.environment!);
        const next = new Date();
        next.setUTCMonth(next.getUTCMonth() + 1, 1);
        next.setUTCHours(0, 0, 0, 0);
        tasks.push(
          redis.incrbyfloat(key, costUsd)
            .then(() => redis.expireat(key, Math.floor(next.getTime() / 1000)))
            .catch(() => {}),
        );
      } else {
        tasks.push(incrementKeySpend(apiKeyId, costUsd).catch(() => {}));
      }
    }
  }

  await Promise.all(tasks);
}

// ── Multi-tenant customer spend counters ──────────────────────────────────────
// Keys: customer:{orgId}:{customerId}:{YYYY-MM}:spend   (USD as float)
//       customer:{orgId}:{customerId}:{YYYY-MM}:tokens  (bigint)
// TTL: same as org/project counters — expires at start of next month.

function customerSpendKey(orgId: string, customerId: string): string {
  const m = new Date().toISOString().slice(0, 7);
  return `customer:${orgId}:${customerId}:${m}:spend`;
}

function customerTokenKey(orgId: string, customerId: string): string {
  const m = new Date().toISOString().slice(0, 7);
  return `customer:${orgId}:${customerId}:${m}:tokens`;
}

function nextMonthExpiry(): number {
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  next.setUTCHours(0, 0, 0, 0);
  return Math.floor(next.getTime() / 1000);
}

/** Increment both spend (USD) and token counters for a customer. Fire-and-forget safe. */
export async function incrementCustomerSpend(
  orgId:      string,
  customerId: string,
  costUsd:    number,
  tokens:     number,
): Promise<void> {
  const expiry = nextMonthExpiry();
  const sk     = customerSpendKey(orgId, customerId);
  const tk     = customerTokenKey(orgId, customerId);
  await Promise.all([
    redis.incrbyfloat(sk, costUsd).then(() => redis.expireat(sk, expiry)),
    redis.incrby(tk, Math.round(tokens)).then(() => redis.expireat(tk, expiry)),
  ]);
}

/** Read current-month spend + token totals for a customer. Returns zeros if no data. */
export async function getCustomerMonthSpend(
  orgId:      string,
  customerId: string,
): Promise<{ spend_usd: number; tokens: number }> {
  const [spendRaw, tokensRaw] = await Promise.all([
    redis.get<number>(customerSpendKey(orgId, customerId)),
    redis.get<number>(customerTokenKey(orgId, customerId)),
  ]);
  return {
    spend_usd: Number(spendRaw)  || 0,
    tokens:    Number(tokensRaw) || 0,
  };
}

/**
 * Atomic quota check for a customer before a gateway request.
 * Returns:
 *   "ok"        — within quota (or no quota configured)
 *   "soft_cap"  — at or above soft_cap_pct of the monthly limit
 *   "exceeded"  — at or above 100% of the monthly limit
 *
 * Uses a single Lua script to avoid TOCTOU races. Always fails open (returns "ok")
 * if Redis is unavailable — never block a request due to infrastructure issues.
 */
export async function checkCustomerQuota(
  orgId:      string,
  customerId: string,
  limits: {
    monthly_spend_usd:   number | null;
    monthly_token_limit: number | null;
    soft_cap_pct:        number;
  },
): Promise<"ok" | "soft_cap" | "exceeded"> {
  const { monthly_spend_usd, monthly_token_limit, soft_cap_pct } = limits;
  if (!monthly_spend_usd && !monthly_token_limit) return "ok";

  try {
    const sk = customerSpendKey(orgId, customerId);
    const tk = customerTokenKey(orgId, customerId);

    const script = `
      local spendCap  = tonumber(ARGV[1])
      local tokenCap  = tonumber(ARGV[2])
      local softPct   = tonumber(ARGV[3]) / 100

      local spend  = tonumber(redis.call('GET', KEYS[1]) or 0)
      local tokens = tonumber(redis.call('GET', KEYS[2]) or 0)

      -- Hard cap check
      if spendCap  > 0 and spend  >= spendCap  then return 'exceeded' end
      if tokenCap  > 0 and tokens >= tokenCap  then return 'exceeded' end

      -- Soft cap check
      if spendCap  > 0 and spend  >= spendCap  * softPct then return 'soft_cap' end
      if tokenCap  > 0 and tokens >= tokenCap  * softPct then return 'soft_cap' end

      return 'ok'
    `;

    const result = await redis.eval(
      script,
      [sk, tk],
      [monthly_spend_usd ?? 0, monthly_token_limit ?? 0, soft_cap_pct],
    );
    return (result as string) === "exceeded" ? "exceeded"
         : (result as string) === "soft_cap"  ? "soft_cap"
         : "ok";
  } catch {
    return "ok"; // fail open — Redis unavailable
  }
}
