/**
 * Tests for the engine driver's persistence half (lib/engine/run.ts).
 *
 * The load-bearing guarantee here is clobber-prevention: when the daily cron
 * recomputes recommendations, persistNewRecommendations must seed rows ONLY
 * for recs that have no persisted lifecycle row yet — never re-writing an
 * already validated/staged/applied/rejected row. A regression here would reset
 * an applied model substitution back to 'new' and silently disable it on the
 * gateway, so it is worth a direct test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Recommendation } from "@/lib/engine/types";

const mockGetActions = vi.fn();
const mockUpsert     = vi.fn().mockResolvedValue({ rec_id: "seeded" });

vi.mock("@/lib/engine/actions", () => ({
  getRecommendationActions:   mockGetActions,
  upsertRecommendationAction: mockUpsert,
}));

beforeEach(() => {
  mockGetActions.mockReset();
  mockUpsert.mockReset().mockResolvedValue({ rec_id: "seeded" });
});

function rec(id: string, extra: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    type:                  "cheaper_model",
    title:                 `rec ${id}`,
    description:           "",
    potential_savings_usd: 10,
    confidence:            0.9,
    status:                "new",
    ...extra,
  } as unknown as Recommendation;
}

describe("persistNewRecommendations()", () => {
  it("seeds 'new' rows only for recs without a persisted row", async () => {
    const { persistNewRecommendations } = await import("@/lib/engine/run");

    // rec-applied already has a persisted lifecycle row; rec-new does not.
    mockGetActions.mockResolvedValue(new Map([
      ["rec-applied", { rec_id: "rec-applied", status: "applied", current_model: "gpt-4", suggested_model: "gpt-4o-mini" }],
    ]));

    const recs = [
      rec("rec-applied", { current_model: "gpt-4", suggested_model: "gpt-4o-mini" }),
      rec("rec-new",     { current_model: "gpt-4o", suggested_model: "gpt-4o-mini", feature: "support" }),
    ];

    const seeded = await persistNewRecommendations("org-1", recs);

    expect(seeded).toBe(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      orgId:  "org-1",
      status: "new",
      rec:    expect.objectContaining({ id: "rec-new", feature: "support" }),
    }));
  });

  it("never re-writes an already-applied recommendation (clobber prevention)", async () => {
    const { persistNewRecommendations } = await import("@/lib/engine/run");

    mockGetActions.mockResolvedValue(new Map([
      ["rec-applied", { rec_id: "rec-applied", status: "applied" }],
    ]));

    const recs = [rec("rec-applied", { current_model: "gpt-4", suggested_model: "gpt-4o-mini" })];

    const seeded = await persistNewRecommendations("org-1", recs);

    expect(seeded).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("seeds every rec when nothing is persisted yet", async () => {
    const { persistNewRecommendations } = await import("@/lib/engine/run");
    mockGetActions.mockResolvedValue(new Map());

    const recs = [rec("a"), rec("b"), rec("c")];

    const seeded = await persistNewRecommendations("org-1", recs);
    expect(seeded).toBe(3);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });
});
