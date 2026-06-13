/**
 * Tests for the Trace Engine rollup writer (lib/gateway/trace-writer.ts).
 *
 * Verifies the gateway hot-path contract: arg mapping into the
 * upsert_trace_rollup RPC, status derivation, the root-span/session omission,
 * the orgId/traceId guard, and — critically — that it fails open (never throws)
 * when the admin client or RPC blows up, so a tracing fault can't break a live
 * gateway request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client so the RPC call is observable without a real Supabase
// connection. `mock`-prefixed so the hoisted vi.mock factory may reference it.
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc })),
}));

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("upsertTraceRollup()", () => {
  it("maps a successful root span into upsert_trace_rollup args", async () => {
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await upsertTraceRollup("org-1", "trace-abc", {
      rootSpanId:    "span-root",
      rootSessionId: "sess-1",
      costUsd:       0.0125,
      startedAt:     "2026-06-16T00:00:00.000Z",
      endedAt:       "2026-06-16T00:00:01.000Z",
      isError:       false,
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("upsert_trace_rollup", {
      p_org_id:          "org-1",
      p_trace_id:        "trace-abc",
      p_cost_usd:        0.0125,
      p_started_at:      "2026-06-16T00:00:00.000Z",
      p_ended_at:        "2026-06-16T00:00:01.000Z",
      p_status:          "completed",
      p_root_span_id:    "span-root",
      p_root_session_id: "sess-1",
    });
  });

  it("derives status 'error' for an error span", async () => {
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await upsertTraceRollup("org-1", "trace-err", {
      costUsd:   0,
      startedAt: "2026-06-16T00:00:00.000Z",
      endedAt:   "2026-06-16T00:00:00.500Z",
      isError:   true,
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_trace_rollup",
      expect.objectContaining({ p_status: "error" }),
    );
  });

  it("omits root_span_id / root_session_id when absent (non-root span)", async () => {
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await upsertTraceRollup("org-1", "trace-noroot", {
      costUsd: 1, startedAt: "a", endedAt: "b", isError: false,
    });
    const [, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_root_span_id).toBeUndefined();
    expect(args.p_root_session_id).toBeUndefined();
  });

  it("coerces a non-finite cost to 0", async () => {
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await upsertTraceRollup("org-1", "trace-nan", {
      costUsd: Number.NaN, startedAt: "a", endedAt: "b", isError: false,
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_trace_rollup",
      expect.objectContaining({ p_cost_usd: 0 }),
    );
  });

  it("skips the RPC entirely when orgId or traceId is missing", async () => {
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await upsertTraceRollup("", "trace-x", { costUsd: 1, startedAt: "a", endedAt: "b", isError: false });
    await upsertTraceRollup("org-1", "", { costUsd: 1, startedAt: "a", endedAt: "b", isError: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails open (resolves, never throws) when the RPC rejects", async () => {
    mockRpc.mockRejectedValueOnce(new Error("supabase down"));
    const { upsertTraceRollup } = await import("@/lib/gateway/trace-writer");
    await expect(
      upsertTraceRollup("org-1", "trace-boom", { costUsd: 1, startedAt: "a", endedAt: "b", isError: false }),
    ).resolves.toBeUndefined();
  });
});
