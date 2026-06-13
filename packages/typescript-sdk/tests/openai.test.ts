import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateCost, MODEL_PRICING } from "../src/pricing";
import { EventTracker } from "../src/tracker";

// ─── Pricing tests ────────────────────────────────────────────────────────────

describe("calculateCost", () => {
  it("computes gpt-4o cost correctly", () => {
    const cost = calculateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.50 + 10.00, 4);
  });

  it("uses cached_input price for cached tokens", () => {
    const full   = calculateCost("gpt-4o", 1_000_000, 0, 0);
    const cached = calculateCost("gpt-4o", 1_000_000, 0, 1_000_000);
    expect(cached).toBeLessThan(full);
    expect(cached).toBeCloseTo(1.25, 4);
  });

  it("returns 0 for unknown model", () => {
    expect(calculateCost("gpt-99-ultra", 1000, 500)).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });

  it("all models have non-negative prices", () => {
    for (const [, p] of Object.entries(MODEL_PRICING)) {
      expect(p.input).toBeGreaterThanOrEqual(0);
      expect(p.output).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes anthropic model cost correctly", () => {
    const cost = calculateCost("claude-3-5-sonnet-20241022", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3.00 + 15.00, 4);
  });
});

// ─── EventTracker tests ───────────────────────────────────────────────────────

describe("EventTracker", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ imported_rows: 1 }), { status: 202 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockResponse = (overrides = {}) => ({
    id: "chatcmpl-test123",
    model: "gpt-4o",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: null,
    },
    ...overrides,
  });

  it("posts event wrapped in events array", async () => {
    const tracker = new EventTracker("prism_live_abcd_xyz", "https://custom.ingest.test/api/ingest");
    await tracker.capture(mockResponse(), 300, "my-project", "team-a", "production");
    await tracker.flush();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://custom.ingest.test/api/ingest");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    const event = body.events[0];
    expect(event.model).toBe("gpt-4o");
    expect(event.input_tokens).toBe(100);
    expect(event.output_tokens).toBe(50);
    expect(event.latency_ms).toBe(300);
    expect(event.project_id).toBe("my-project");
    expect(event.team_id).toBe("team-a");
    expect(event.environment).toBe("production");
  });

  it("never throws on fetch failure", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    const tracker = new EventTracker("prism_live_abcd_xyz");
    await expect(
      tracker.capture(mockResponse(), 300, "proj", "team", "test"),
    ).resolves.toBeUndefined();
  });

  it("never throws on non-2xx response", async () => {
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));
    const tracker = new EventTracker("prism_live_abcd_xyz");
    await expect(
      tracker.capture(mockResponse(), 0, "", "", "test"),
    ).resolves.toBeUndefined();
  });

  it("extracts org from key", async () => {
    const tracker = new EventTracker("prism_live_myorg_randomstuff");
    await tracker.capture(mockResponse(), 0, "", "", "test");
    await tracker.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].org_id).toBe("myorg");
  });

  it("computes cost_usd from token counts", async () => {
    const tracker = new EventTracker("prism_live_abcd_xyz");
    await tracker.capture(
      mockResponse({ usage: { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: null } }),
      0, "", "", "test",
    );
    await tracker.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].cost_usd).toBeCloseTo(2.50, 3);
  });
});
