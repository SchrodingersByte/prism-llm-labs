/**
 * Extended EventTracker tests covering:
 *   - TTFT capture (F1)
 *   - system_prompt_hash auto-generation (P2.1)
 *   - recordOutcome() (T2.2)
 *   - recordGpuInference() (T3.3)
 *   - Tool call detection (OpenAI + Anthropic format)
 *   - Modality detection
 *
 * Priority: P0/P1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventTracker } from "../src/tracker";

const PRISM_KEY = "prism_live_testorg_randomkey";

function mockFetch(status = 202) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status }),
  );
}

describe("EventTracker — ttft_ms in events", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = mockFetch();
  });
  afterEach(() => vi.restoreAllMocks());

  it("defaults ttft_ms to 0 when not provided", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: null } },
      300,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].ttft_ms).toBe(0);
  });

  it("passes through ttft_ms when provided as 9th argument", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      500, "", "", "production", "openai", [], {}, 123,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].ttft_ms).toBe(123);
  });
});

describe("EventTracker — system_prompt_hash (P2.1)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = mockFetch();
  });
  afterEach(() => vi.restoreAllMocks());

  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user",   content: "Hello!" },
  ];

  it("auto-populates system_prompt_hash in event tags", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", messages,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    const tags = body.events[0].tags as Record<string, string>;
    expect(tags["system_prompt_hash"]).toBeDefined();
    expect(tags["system_prompt_hash"]).toHaveLength(12);
    expect(tags["system_prompt_hash"]).toMatch(/^[a-f0-9]{12}$/);
  });

  it("produces consistent hash for same system prompt", async () => {
    const tracker = new EventTracker(PRISM_KEY);

    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", messages,
    );
    await tracker.flush();
    const body1 = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    const hash1 = (body1.events[0].tags as Record<string, string>)["system_prompt_hash"];

    await tracker.capture(
      { id: "r2", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", messages,
    );
    await tracker.flush();
    const body2 = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    const hash2 = (body2.events[0].tags as Record<string, string>)["system_prompt_hash"];

    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different system prompts", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const msgs1 = [{ role: "system", content: "Be helpful." }, { role: "user", content: "Hi" }];
    const msgs2 = [{ role: "system", content: "Be concise." }, { role: "user", content: "Hi" }];

    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", msgs1,
    );
    await tracker.flush();
    await tracker.capture(
      { id: "r2", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", msgs2,
    );
    await tracker.flush();

    const body1 = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    const body2 = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    const h1 = (body1.events[0].tags as Record<string, string>)["system_prompt_hash"];
    const h2 = (body2.events[0].tags as Record<string, string>)["system_prompt_hash"];
    expect(h1).not.toBe(h2);
  });

  it("does not overwrite system_prompt_hash if caller already set it", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const callTags = { system_prompt_hash: "caller_provided_hash" };
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", messages, callTags,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect((body.events[0].tags as Record<string, string>)["system_prompt_hash"])
      .toBe("caller_provided_hash");
  });

  it("sets no system_prompt_hash when no system message exists", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const userOnlyMessages = [{ role: "user", content: "Hello!" }];
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", userOnlyMessages,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect((body.events[0].tags as Record<string, string>)["system_prompt_hash"]).toBeUndefined();
  });
});

describe("EventTracker — tool call detection", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchSpy = mockFetch(); });
  afterEach(() => vi.restoreAllMocks());

  it("detects OpenAI tool_calls in choices[0].message.tool_calls", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const response = {
      id:    "chatcmpl-tools",
      model: "gpt-4o",
      usage: { prompt_tokens: 50, completion_tokens: 20 },
      choices: [{
        message: {
          tool_calls: [
            { function: { name: "search_web" } },
            { function: { name: "lookup_db" } },
          ],
        },
      }],
    };
    await tracker.capture(response, 200);
    await tracker.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    const tags = body.events[0].tags as Record<string, string>;
    expect(tags["tool_calls_count"]).toBe("2");
    expect(tags["tool_names"]).toContain("search_web");
    expect(tags["tool_names"]).toContain("lookup_db");
  });

  it("detects Anthropic tool_use blocks in content array", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const response = {
      id:    "msg-ant-123",
      model: "claude-opus-4",
      usage: { input_tokens: 30, output_tokens: 10 },
      content: [
        { type: "tool_use", name: "calculator" },
        { type: "text",     text: "Here is the result" },
      ],
    };
    await tracker.capture(response, 150, "", "", "production", "anthropic");
    await tracker.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    const tags = body.events[0].tags as Record<string, string>;
    expect(tags["tool_calls_count"]).toBe("1");
    expect(tags["tool_names"]).toBe("calculator");
  });
});

describe("EventTracker — recordOutcome() (T2.2)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchSpy = mockFetch(); });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /api/outcomes with correct body", async () => {
    const tracker = new EventTracker(
      PRISM_KEY,
      "https://app.useprism.dev/api/ingest",
    );
    await tracker.recordOutcome({
      featureTag: "customer-support",
      actionTag:  "ticket-resolved",
      sessionId:  "sess-abc123",
      success:    true,
      valueUsd:   3.00,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/api/outcomes");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.feature_tag).toBe("customer-support");
    expect(body.action_tag).toBe("ticket-resolved");
    expect(body.session_id).toBe("sess-abc123");
    expect(body.success).toBe(true);
    expect(body.value_usd).toBe(3.00);
  });

  it("never throws on fetch error", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    const tracker = new EventTracker(PRISM_KEY);
    await expect(
      tracker.recordOutcome({ featureTag: "test", success: true }),
    ).resolves.not.toThrow();
  });
});

describe("EventTracker — recordGpuInference() (T3.3)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchSpy = mockFetch(); });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /api/gpu-inference with wrapped body", async () => {
    const tracker = new EventTracker(
      PRISM_KEY,
      "https://app.useprism.dev/api/ingest",
    );
    await tracker.recordGpuInference({
      provider:         "aws_sagemaker",
      endpointName:     "my-model-endpoint",
      costUsd:          0.042,
      instanceType:     "ml.p3.2xlarge",
      durationSeconds:  120,
      requests:         50,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/api/gpu-inference");
    const body = JSON.parse(init?.body as string);
    expect(body.runs[0].provider).toBe("aws_sagemaker");
    expect(body.runs[0].endpoint_name).toBe("my-model-endpoint");
    expect(body.runs[0].cost_usd).toBe(0.042);
  });

  it("never throws on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("down"));
    const tracker = new EventTracker(PRISM_KEY);
    await expect(
      tracker.recordGpuInference({ provider: "runpod", endpointName: "ep", costUsd: 0.01 }),
    ).resolves.not.toThrow();
  });
});

describe("EventTracker — modality detection", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchSpy = mockFetch(); });
  afterEach(() => vi.restoreAllMocks());

  it("detects image modality from image_url content blocks", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    const messages = [
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }] },
    ];
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 100, completion_tokens: 20 } },
      300, "", "", "production", "openai", messages,
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].modalities).toContain("image");
    expect(body.events[0].modalities).toContain("text");
  });

  it("returns 'text' modality for text-only messages", async () => {
    const tracker = new EventTracker(PRISM_KEY);
    await tracker.capture(
      { id: "r1", model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      300, "", "", "production", "openai", [{ role: "user", content: "hello" }],
    );
    await tracker.flush();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.events[0].modalities).toBe("text");
  });
});
