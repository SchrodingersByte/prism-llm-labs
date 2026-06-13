/**
 * Tests the gateway hot-path lookup half of the Intelligence Engine loop:
 * getActiveModelSubstitution() (lib/engine/actions.ts). Given an 'applied'
 * recommendation_actions row, it must resolve to the model swap that the
 * gateway then applies (tagging model_downgraded_from + recommendation_id).
 *
 * Together with engine-run.test.ts (the cron seeds rows without clobbering
 * lifecycle), this closes the verification of the observe→optimize loop at the
 * unit level — the live end-to-end (cron → applied → gateway swap) additionally
 * needs provider keys + Tinybird + Redis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// A thenable query-builder chain: select/eq return self, and awaiting the chain
// resolves to { data, error } — matching how getActiveModelSubstitution awaits
// the builder directly after .eq() (the shared makeChain helper deliberately
// disables thenability, so a local thenable mock is used here).
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq     = vi.fn(self);
  chain.then   = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return chain;
}

const mockFrom = vi.fn(() => thenableChain([
  { rec_id: "rec-1", current_model: "gpt-4", suggested_model: "gpt-4o-mini", feature: null },
]));
const mockHget = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/upstash/redis", () => ({
  redis: {
    hget:   mockHget,
    hset:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del:    vi.fn().mockResolvedValue(1),
  },
}));

beforeEach(() => {
  mockHget.mockReset().mockResolvedValue(null);   // force the Supabase path, not Redis cache
});

describe("getActiveModelSubstitution()", () => {
  it("returns the applied substitution for a matching current_model", async () => {
    const { getActiveModelSubstitution } = await import("@/lib/engine/actions");
    // Distinct model per test avoids the module-level in-memory cache colliding.
    mockFrom.mockReturnValueOnce(thenableChain([
      { rec_id: "rec-1", current_model: "gpt-4", suggested_model: "gpt-4o-mini", feature: null },
    ]));
    const sub = await getActiveModelSubstitution("org-sub-1", "gpt-4", "");
    expect(sub).toEqual({
      rec_id: "rec-1", current_model: "gpt-4", suggested_model: "gpt-4o-mini", feature: null,
    });
  });

  it("returns null when no applied row matches the model", async () => {
    const { getActiveModelSubstitution } = await import("@/lib/engine/actions");
    mockFrom.mockReturnValueOnce(thenableChain([]));
    const sub = await getActiveModelSubstitution("org-sub-2", "claude-opus-4", "");
    expect(sub).toBeNull();
  });

  it("prefers a feature-scoped row over an org-wide one", async () => {
    const { getActiveModelSubstitution } = await import("@/lib/engine/actions");
    mockFrom.mockReturnValueOnce(thenableChain([
      { rec_id: "org-wide",  current_model: "gpt-4o", suggested_model: "gpt-4o-mini", feature: null },
      { rec_id: "feature-x", current_model: "gpt-4o", suggested_model: "gpt-3.5-turbo", feature: "checkout" },
    ]));
    const sub = await getActiveModelSubstitution("org-sub-3", "gpt-4o", "checkout");
    expect(sub?.rec_id).toBe("feature-x");
  });
});
