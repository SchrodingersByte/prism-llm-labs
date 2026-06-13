/**
 * Session budget circuit breaker.
 * Checks Redis session cost + tool-call counters before each tool invocation.
 * If the UPSTASH env vars are absent, checks are skipped (graceful degradation).
 */

import {
  PrismSessionBudgetExceededError,
  PrismToolCallLimitError,
} from "./types";

async function redisGet(url: string, token: string, key: string): Promise<number> {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return 0;
  const json = await res.json() as { result: string | null };
  return parseFloat(json.result ?? "0") || 0;
}

export class SessionBudgetChecker {
  private readonly url:   string | null;
  private readonly token: string | null;
  private readonly orgId: string;

  constructor(orgId: string) {
    this.url   = process.env["UPSTASH_REDIS_REST_URL"]   ?? null;
    this.token = process.env["UPSTASH_REDIS_REST_TOKEN"] ?? null;
    this.orgId = orgId;
  }

  /**
   * Throws PrismSessionBudgetExceededError or PrismToolCallLimitError
   * if the session has exceeded its configured limits.
   */
  async checkOrThrow(
    sessionId:             string,
    sessionBudgetUsd?:     number,
    maxToolCallsPerSession?: number,
  ): Promise<void> {
    if (!this.url || !this.token) return; // No Redis configured — skip

    if (sessionBudgetUsd != null && sessionBudgetUsd > 0) {
      const costKey = `session:${this.orgId}:${sessionId}:cost`;
      const current = await redisGet(this.url, this.token, costKey);
      if (current >= sessionBudgetUsd) {
        throw new PrismSessionBudgetExceededError(sessionId, sessionBudgetUsd);
      }
    }

    if (maxToolCallsPerSession != null && maxToolCallsPerSession > 0) {
      const toolKey = `session:${this.orgId}:${sessionId}:tool_calls`;
      const count   = await redisGet(this.url, this.token, toolKey);
      if (count >= maxToolCallsPerSession) {
        throw new PrismToolCallLimitError(sessionId, maxToolCallsPerSession);
      }
    }
  }
}
