/**
 * Tests for budget caps and Redis velocity tracking.
 * Covers plan test IDs: 2.6–2.9, 5.1.x, 5.2.x, 5.3.x
 *
 * Priority: P0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TEST_ORG_A } from "@/tests/helpers";

// ── Redis module mock (unit-level — real Redis not required) ──────────────────
const mockZadd              = vi.fn().mockResolvedValue(1);
const mockZrange            = vi.fn().mockResolvedValue([]);
const mockZremrangebyscore  = vi.fn().mockResolvedValue(0);
const mockExpire            = vi.fn().mockResolvedValue(1);
const mockExpireat          = vi.fn().mockResolvedValue(1);
const mockGet               = vi.fn().mockResolvedValue(null);
const mockSet               = vi.fn().mockResolvedValue("OK");
const mockIncrbyfloat       = vi.fn().mockResolvedValue(0);
const mockEval              = vi.fn().mockResolvedValue("ok");

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(() => ({
    zadd:             mockZadd,
    zrange:           mockZrange,
    zremrangebyscore: mockZremrangebyscore,
    expire:           mockExpire,
    expireat:         mockExpireat,
    get:              mockGet,
    set:              mockSet,
    incrbyfloat:      mockIncrbyfloat,
    eval:             mockEval,
    incrby:           vi.fn().mockResolvedValue(1),
    // checkAllKeyCaps() batches its cap reads into a single pipeline. The fake
    // pipeline queues .get/.zrange (chainable) and resolves them through the
    // existing per-cap mocks on .exec(), so mockGet/mockZrange setups (and the
    // fail-open mockRejectedValue case) keep working unchanged.
    pipeline: () => {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe = {
        get:    (key: string)      => { ops.push(() => mockGet(key));      return pipe; },
        zrange: (...args: unknown[]) => { ops.push(() => mockZrange(...args)); return pipe; },
        exec:   () => Promise.all(ops.map(fn => fn())),
      };
      return pipe;
    },
  })),
}));

// ── Tests: buildCacheKey ──────────────────────────────────────────────────────
describe("buildCacheKey()", () => {
  it("returns null for streaming requests", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const key = buildCacheKey("org-1", "gpt-4o", [{ role: "user", content: "hi" }], 0, true);
    expect(key).toBeNull();
  });

  it("returns null when temperature > 0.1 (non-deterministic)", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const key = buildCacheKey("org-1", "gpt-4o", [{ role: "user", content: "hi" }], 0.5, false);
    expect(key).toBeNull();
  });

  it("returns a string key for deterministic non-streaming requests", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const key = buildCacheKey("org-1", "gpt-4o", [{ role: "user", content: "hi" }], 0, false);
    expect(key).toMatch(/^prompt_cache:org-1:[a-f0-9]{32}$/);
  });

  it("produces different keys for different orgs (org-scoped)", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const msgs = [{ role: "user", content: "test" }];
    const k1 = buildCacheKey("org-a", "gpt-4o", msgs, 0, false);
    const k2 = buildCacheKey("org-b", "gpt-4o", msgs, 0, false);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBeNull();
    expect(k2).not.toBeNull();
  });

  it("produces same key for identical messages in same org", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const msgs = [{ role: "user", content: "What is LLM caching?" }];
    const k1 = buildCacheKey("org-1", "gpt-4o", msgs, 0, false);
    const k2 = buildCacheKey("org-1", "gpt-4o", msgs, 0, false);
    expect(k1).toBe(k2);
  });

  it("produces different keys for different messages", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const k1 = buildCacheKey("org-1", "gpt-4o", [{ role: "user", content: "hello" }], 0, false);
    const k2 = buildCacheKey("org-1", "gpt-4o", [{ role: "user", content: "goodbye" }], 0, false);
    expect(k1).not.toBe(k2);
  });
});

// ── Tests: trackSpendVelocity + getWindowSpend ────────────────────────────────
describe("trackSpendVelocity()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZadd.mockResolvedValue(1);
    mockZremrangebyscore.mockResolvedValue(0);
    mockExpire.mockResolvedValue(1);
    mockZrange.mockResolvedValue([]);
  });

  it("writes to Redis sorted set with cost in member format", async () => {
    const { trackSpendVelocity } = await import("@/lib/upstash/redis");
    await trackSpendVelocity("org-1", "key-1", 0.05);

    expect(mockZadd).toHaveBeenCalledOnce();
    const call = mockZadd.mock.calls[0]!;
    const key    = call[0] as string;
    const entry  = call[1] as { score: number; member: string };
    expect(key).toMatch(/^velocity:org-1:key-1$/);
    expect(entry.score).toBeGreaterThan(0);
    expect(entry.member).toMatch(/^\d+_\w+:0\.05$/);
  });

  it("prunes entries older than 2 hours", async () => {
    const { trackSpendVelocity } = await import("@/lib/upstash/redis");
    await trackSpendVelocity("org-1", "key-1", 0.01);
    expect(mockZremrangebyscore).toHaveBeenCalledOnce();
  });

  it("sets 2-hour TTL on the sorted set", async () => {
    const { trackSpendVelocity } = await import("@/lib/upstash/redis");
    await trackSpendVelocity("org-1", "key-1", 0.01);
    expect(mockExpire).toHaveBeenCalledWith("velocity:org-1:key-1", 7200);
  });

  it("never throws even when Redis fails", async () => {
    mockZadd.mockRejectedValue(new Error("Redis unavailable"));
    const { trackSpendVelocity } = await import("@/lib/upstash/redis");
    await expect(trackSpendVelocity("org-1", "key-1", 0.01)).resolves.not.toThrow();
  });
});

describe("getWindowSpend()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZrange.mockResolvedValue([]);
  });

  it("returns 0 when no entries in window", async () => {
    const { getWindowSpend } = await import("@/lib/upstash/redis");
    const spend = await getWindowSpend("org-1", "key-1", 300);
    expect(spend).toBe(0);
  });

  it("sums costs from sorted set member strings", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockZrange.mockResolvedValue([
      `${now}_abc12:0.05`,
      `${now}_def34:0.10`,
      `${now}_ghi56:0.025`,
    ]);
    const { getWindowSpend } = await import("@/lib/upstash/redis");
    const spend = await getWindowSpend("org-1", "key-1", 300);
    expect(spend).toBeCloseTo(0.175, 6);
  });

  it("returns 0 and doesn't throw when Redis fails", async () => {
    mockZrange.mockRejectedValue(new Error("Redis down"));
    const { getWindowSpend } = await import("@/lib/upstash/redis");
    const spend = await getWindowSpend("org-1", "key-1", 300);
    expect(spend).toBe(0);
  });
});

// ── Tests: checkAllKeyCaps ────────────────────────────────────────────────────
describe("checkAllKeyCaps()", () => {
  const API_KEY_ID = "key-test-001";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);        // default: no spend
    mockZrange.mockResolvedValue([]);       // default: no rolling spend
    mockEval.mockResolvedValue("ok");
  });

  it("returns 'ok' when caps array is empty", async () => {
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(API_KEY_ID, []);
    expect(result).toBe("ok");
  });

  it("returns 'ok' when monthly spend is below cap", async () => {
    mockGet.mockResolvedValue(5.0);  // $5 spent
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(API_KEY_ID, [
      { id: "cap-1", period: "monthly", is_rolling: false, amount_usd: 10.0, environment: null },
    ]);
    expect(result).toBe("ok");
  });

  it("returns 'exceeded:{capId}' when monthly spend meets or exceeds cap", async () => {
    mockGet.mockResolvedValue(10.0);  // exactly at cap
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(API_KEY_ID, [
      { id: "cap-prod-monthly", period: "monthly", is_rolling: false, amount_usd: 10.0, environment: null },
    ]);
    expect(result).toBe("exceeded:cap-prod-monthly");
  });

  it("skips production cap when environment='staging'", async () => {
    mockGet.mockResolvedValue(999);  // way over any cap
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(
      API_KEY_ID,
      [{ id: "cap-prod", period: "daily", is_rolling: false, amount_usd: 1.0, environment: "production" }],
      "staging",  // event is staging
    );
    // Staging events should NOT be blocked by production-only cap
    expect(result).toBe("ok");
  });

  it("blocks production events with production-only cap exceeded", async () => {
    mockGet.mockResolvedValue(100);
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(
      API_KEY_ID,
      [{ id: "cap-prod-only", period: "daily", is_rolling: false, amount_usd: 1.0, environment: "production" }],
      "production",
    );
    expect(result).toBe("exceeded:cap-prod-only");
  });

  it("fails open (returns ok) when Redis throws", async () => {
    mockGet.mockRejectedValue(new Error("Redis down"));
    const { checkAllKeyCaps } = await import("@/lib/upstash/redis");
    const result = await checkAllKeyCaps(API_KEY_ID, [
      { id: "cap-1", period: "monthly", is_rolling: false, amount_usd: 1.0, environment: null },
    ]);
    expect(result).toBe("ok");
  });
});

// ── Tests: incrementSpendIfBelowLimit ────────────────────────────────────────
describe("incrementSpendIfBelowLimit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEval.mockResolvedValue("ok");
  });

  it("returns 'ok' when spend is below limit", async () => {
    mockEval.mockResolvedValue("ok");
    const { incrementSpendIfBelowLimit } = await import("@/lib/upstash/redis");
    const result = await incrementSpendIfBelowLimit(TEST_ORG_A.id, "proj-1", 0.05, 10.0);
    expect(result).toBe("ok");
    expect(mockEval).toHaveBeenCalledOnce();
  });

  it("returns 'exceeded' when Lua script returns exceeded", async () => {
    mockEval.mockResolvedValue("exceeded");
    const { incrementSpendIfBelowLimit } = await import("@/lib/upstash/redis");
    const result = await incrementSpendIfBelowLimit(TEST_ORG_A.id, "proj-1", 1.0, 0.5);
    expect(result).toBe("exceeded");
  });
});

// ── Tests: pii-masker ────────────────────────────────────────────────────────
describe("pii-masker", () => {
  it("masks email addresses", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    const input  = "Contact me at alice@example.com for details";
    const output = maskPii(input, ["email"]);
    expect(output).not.toContain("alice@example.com");
    expect(output).toContain("[REDACTED:email]");
  });

  it("masks US phone numbers", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("Call 123-456-7890", ["phone"])).toContain("[REDACTED:phone]");
    expect(maskPii("Call (123) 456-7890", ["phone"])).toContain("[REDACTED:phone]");
  });

  it("masks SSNs", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("SSN: 123-45-6789", ["ssn"])).toContain("[REDACTED:ssn]");
  });

  it("masks IPv4 addresses", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("IP: 192.168.1.100", ["ip_address"])).toContain("[REDACTED:ip_address]");
  });

  it("does not mask when pattern type not enabled", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    const input = "user@test.com";
    const output = maskPii(input, ["phone"]); // email not in enabled list
    expect(output).toContain("user@test.com");
  });

  it("maskMessages deep-walks nested message objects", async () => {
    const { maskMessages } = await import("@/lib/privacy/pii-masker");
    const messages = [
      { role: "user",   content: "My email is test@test.com" },
      { role: "system", content: "No PII here" },
    ];
    const result = maskMessages(messages, ["email"]) as typeof messages;
    expect((result[0] as { content: string }).content).toContain("[REDACTED:email]");
    expect((result[1] as { content: string }).content).toBe("No PII here");
  });

  it("maskMessages returns original for non-string, non-object values", async () => {
    const { maskMessages } = await import("@/lib/privacy/pii-masker");
    expect(maskMessages(42, ["email"])).toBe(42);
    expect(maskMessages(null, ["email"])).toBeNull();
  });
});
