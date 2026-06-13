/**
 * Tests for SessionBudgetChecker.
 * Budget checks are skipped gracefully when Redis is not configured.
 *
 * Priority: P0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionBudgetChecker } from "../src/budget";
import { PrismSessionBudgetExceededError, PrismToolCallLimitError } from "../src/types";

describe("SessionBudgetChecker — no Redis (graceful degradation)", () => {
  beforeEach(() => {
    // Ensure Redis env vars are absent
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
  });

  it("skips checks when Redis is not configured (fail-open)", async () => {
    const checker = new SessionBudgetChecker("org-test");
    // Should not throw even with tiny budget because Redis is unconfigured
    await expect(checker.checkOrThrow("sess-1", 0.001)).resolves.not.toThrow();
  });
});

describe("SessionBudgetChecker — with mocked Redis", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    process.env["UPSTASH_REDIS_REST_URL"]   = "https://test.upstash.io";
    process.env["UPSTASH_REDIS_REST_TOKEN"] = "test-token";
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
  });

  function mockRedisGet(value: string | null) {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ result: value }), { status: 200 }),
    );
  }

  it("passes when session cost is below budget", async () => {
    mockRedisGet("1.50"); // $1.50 spent
    const checker = new SessionBudgetChecker("org-test");
    await expect(checker.checkOrThrow("sess-1", 5.00)).resolves.not.toThrow();
  });

  it("throws PrismSessionBudgetExceededError when cost >= budget", async () => {
    mockRedisGet("5.01"); // exceeds $5.00
    const checker = new SessionBudgetChecker("org-test");
    await expect(checker.checkOrThrow("sess-1", 5.00))
      .rejects.toThrow(PrismSessionBudgetExceededError);
  });

  it("throws PrismToolCallLimitError when tool call count >= limit", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "0.50" }), { status: 200 })) // cost check: ok
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "50" }), { status: 200 })); // tool calls: at limit

    const checker = new SessionBudgetChecker("org-test");
    await expect(checker.checkOrThrow("sess-1", 5.00, 50))
      .rejects.toThrow(PrismToolCallLimitError);
  });

  it("skips budget check when sessionBudgetUsd is 0", async () => {
    // Should never call Redis for budget when limit is 0/undefined
    const checker = new SessionBudgetChecker("org-test");
    await expect(checker.checkOrThrow("sess-1", 0)).resolves.not.toThrow();
  });

  it("fails open when Redis returns error status", async () => {
    mockFetch.mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    const checker = new SessionBudgetChecker("org-test");
    await expect(checker.checkOrThrow("sess-1", 5.00)).resolves.not.toThrow();
  });
});
