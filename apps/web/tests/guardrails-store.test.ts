import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the underlying @upstash/redis client at module level (same approach as
// gateway.test.ts / budget.test.ts) so the store's redis.get resolves to null
// instantly and falls through to the (faked) Supabase load.
const mockGet = vi.fn().mockResolvedValue(null);
const mockSet = vi.fn().mockResolvedValue("OK");
const mockDel = vi.fn().mockResolvedValue(0);

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(() => ({ get: mockGet, set: mockSet, del: mockDel })),
}));

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(null);
  mockSet.mockReset().mockResolvedValue("OK");
  mockDel.mockReset().mockResolvedValue(0);
});

// A fake Supabase whose query chains terminate at .order() (both store queries do).
function fakeSupabase(rulesData: unknown[], profilesData: unknown[]) {
  const builder = (data: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq     = vi.fn(() => b);
    b.order  = vi.fn(() => Promise.resolve({ data, error: null }));
    return b;
  };
  return {
    from: vi.fn((table: string) =>
      table === "guardrail_rules" ? builder(rulesData) : builder(profilesData)),
  };
}

const load = () => import("@/lib/gateway/guardrails/store");

describe("loadOrgGuardrails()", () => {
  it("maps DB rows into rule + profile bundles", async () => {
    const { loadOrgGuardrails } = await load();
    const sb = fakeSupabase(
      [{ id: "r1", profile_id: "p1", name: "block ssn", priority: 5, apply_to: "input", action: "block", condition: null, sampling_rate: 1, is_active: true }],
      [{ id: "p1", name: "All PII", type: "builtin_pii", pii_types: ["ssn"], custom_patterns: [], config: {} }],
    );

    const bundle = await loadOrgGuardrails("org-map", sb as never);

    expect(bundle.rules).toHaveLength(1);
    expect(bundle.rules[0]).toMatchObject({ id: "r1", profile_id: "p1", action: "block", apply_to: "input", priority: 5 });
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0]).toMatchObject({ id: "p1", type: "builtin_pii" });
    expect(bundle.profiles[0].pii_types).toEqual(["ssn"]);
  });

  it("caches in-memory: a second load for the same org does not re-query", async () => {
    const { loadOrgGuardrails } = await load();
    const sb = fakeSupabase([], []);
    await loadOrgGuardrails("org-cache", sb as never);
    await loadOrgGuardrails("org-cache", sb as never);
    expect(sb.from).toHaveBeenCalledTimes(2); // 2 tables on the first load only; second hits mem cache
  });

  it("returns a Redis-cached bundle without touching Supabase", async () => {
    mockGet.mockResolvedValueOnce({ rules: [{ id: "cached" }], profiles: [] });
    const { loadOrgGuardrails } = await load();
    const sb = fakeSupabase([{ id: "fresh" }], []);
    const bundle = await loadOrgGuardrails("org-redis", sb as never);
    expect(bundle.rules[0]?.id).toBe("cached");
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("fails open (empty bundle) when Supabase throws", async () => {
    const { loadOrgGuardrails } = await load();
    const sb = { from: vi.fn(() => { throw new Error("db down"); }) };
    const bundle = await loadOrgGuardrails("org-fail", sb as never);
    expect(bundle).toEqual({ rules: [], profiles: [] });
  });
});

describe("invalidateGuardrailsCache()", () => {
  it("deletes the org's Redis key", async () => {
    const { invalidateGuardrailsCache } = await load();
    await invalidateGuardrailsCache("org-inv");
    expect(mockDel).toHaveBeenCalledWith("guardrails:org-inv");
  });
});
