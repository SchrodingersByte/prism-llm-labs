/**
 * Upstash Redis mock helpers for unit tests.
 * All Redis functions are vi.fn() that can be configured per-test.
 */
import { vi } from "vitest";

export const mockRedis = {
  get:               vi.fn().mockResolvedValue(null),
  set:               vi.fn().mockResolvedValue("OK"),
  incrbyfloat:       vi.fn().mockResolvedValue(0),
  expire:            vi.fn().mockResolvedValue(1),
  expireat:          vi.fn().mockResolvedValue(1),
  zadd:              vi.fn().mockResolvedValue(1),
  zrange:            vi.fn().mockResolvedValue([]),
  zremrangebyscore:  vi.fn().mockResolvedValue(0),
  eval:              vi.fn().mockResolvedValue("ok"),
  incrby:            vi.fn().mockResolvedValue(1),
};

/** Standard Redis mock module — use with vi.mock("@/lib/upstash/redis", ...) */
export const mockRedisModule = {
  redis:                      mockRedis,
  incrementSpend:             vi.fn().mockResolvedValue(undefined),
  getSpend:                   vi.fn().mockResolvedValue(0),
  incrementSpendIfBelowLimit: vi.fn().mockResolvedValue("ok"),
  incrementKeySpend:          vi.fn().mockResolvedValue(undefined),
  incrementKeyDailySpend:     vi.fn().mockResolvedValue(undefined),
  incrementTeamSpend:         vi.fn().mockResolvedValue(undefined),
  incrementTeamSpendIfBelowLimit: vi.fn().mockResolvedValue("ok"),
  checkKeyCaps:               vi.fn().mockResolvedValue("ok"),
  checkAllKeyCaps:            vi.fn().mockResolvedValue("ok"),
  incrementAllCapCounters:    vi.fn().mockResolvedValue(undefined),
  trackSpendVelocity:         vi.fn().mockResolvedValue(undefined),
  getWindowSpend:             vi.fn().mockResolvedValue(0),
  addRollingSpend:            vi.fn().mockResolvedValue(undefined),
  getRollingSpend:            vi.fn().mockResolvedValue(0),
  incrementSessionSpend:      vi.fn().mockResolvedValue(0),
  incrementSessionToolCalls:  vi.fn().mockResolvedValue(0),
  getSessionSpend:            vi.fn().mockResolvedValue(0),
  getSessionToolCalls:        vi.fn().mockResolvedValue(0),
  checkAndIncrementSession:   vi.fn().mockResolvedValue("ok"),
};

/** Reset all Redis mock call counts between tests */
export function resetRedisMocks() {
  for (const fn of Object.values(mockRedisModule)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  // Restore default return values
  mockRedisModule.incrementSpendIfBelowLimit.mockResolvedValue("ok");
  mockRedisModule.checkKeyCaps.mockResolvedValue("ok");
  mockRedisModule.checkAllKeyCaps.mockResolvedValue("ok");
  mockRedisModule.trackSpendVelocity.mockResolvedValue(undefined);
}
