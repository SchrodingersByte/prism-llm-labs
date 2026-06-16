/**
 * End-user feedback helper tests (PRD-3): request shaping + error paths.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendFeedback } from "../src/feedback";

const API_KEY = "prism_live_testorg_randomkey";

function mockFetch(payload: Record<string, unknown>, status = 201) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("sendFeedback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /api/feedback with bearer auth + mapped body", async () => {
    const fetchSpy = mockFetch({ ok: true, recorded: 1 });
    const r = await sendFeedback({
      apiKey: API_KEY, baseUrl: "https://example.test",
      value: 1, traceId: "tr-1", featureTag: "support", comment: "great",
    });
    expect(r).toEqual({ ok: true, recorded: 1 });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://example.test/api/feedback");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ value: 1, trace_id: "tr-1", feature_tag: "support", comment: "great" });
  });

  it("requires an API key", async () => {
    const prev = process.env.PRISM_API_KEY;
    delete process.env.PRISM_API_KEY;
    await expect(sendFeedback({ value: 1 })).rejects.toThrow(/missing API key/);
    if (prev) process.env.PRISM_API_KEY = prev;
  });

  it("throws on a non-2xx response", async () => {
    mockFetch({ error: "Invalid or inactive API key" }, 401);
    await expect(sendFeedback({ apiKey: API_KEY, value: 0 })).rejects.toThrow(/Invalid or inactive API key/);
  });
});
