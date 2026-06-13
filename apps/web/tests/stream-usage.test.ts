/**
 * Streaming usage extraction regression net (AREA 1 / T1.3).
 *
 * Guards the cost-correctness contract: every provider's streamed usage must be
 * extracted into the shared `inputTokens / outputTokens / cachedTokens` shape
 * that `calculateCost` consumes. The bug this protects against: native
 * anthropic/google streams reporting 0 tokens → $0 cost on every streamed call.
 *
 * `extractUsage` is pure, so these tests need no gateway/Redis/Supabase harness.
 */
import { describe, it, expect } from "vitest";
import { extractUsage, newUsageSummary, type UsageSummary } from "@/lib/gateway/stream-parser";
import { calculateCost } from "@/lib/pricing/table";

function fresh(): UsageSummary {
  return newUsageSummary();
}

function run(provider: string, chunks: Record<string, unknown>[]): UsageSummary {
  const s = fresh();
  for (const c of chunks) extractUsage(provider, c, s);
  return s;
}

describe("extractUsage — OpenAI wire format", () => {
  it("captures usage from the final include_usage chunk", () => {
    const s = run("openai", [
      { id: "chatcmpl-1", model: "gpt-4o", choices: [{ delta: { content: "hi" } }] },
      { id: "chatcmpl-1", model: "gpt-4o", choices: [{ delta: {} }] },
      {
        id: "chatcmpl-1", model: "gpt-4o", choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 25 } },
      },
    ]);
    expect(s.inputTokens).toBe(100);
    expect(s.outputTokens).toBe(40);
    expect(s.cachedTokens).toBe(25);
    expect(s.model).toBe("gpt-4o");
    expect(s.requestId).toBe("chatcmpl-1");
  });

  it("does not clobber on intermediate usage: null chunks", () => {
    const s = run("openai", [
      { model: "gpt-4o", usage: null, choices: [{ delta: { content: "x" } }] },
      { model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]);
    expect(s.inputTokens).toBe(10);
    expect(s.outputTokens).toBe(5);
  });

  it("routes OpenAI-compatible providers (groq) through the default branch", () => {
    const s = run("groq", [
      { model: "llama-3.3-70b", usage: { prompt_tokens: 200, completion_tokens: 80 } },
    ]);
    expect(s.inputTokens).toBe(200);
    expect(s.outputTokens).toBe(80);
  });

  it("captures reasoning + audio sub-counts from usage details", () => {
    const s = run("openai", [
      {
        model: "o3", choices: [],
        usage: {
          prompt_tokens: 500, completion_tokens: 1200,
          prompt_tokens_details: { cached_tokens: 0, audio_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 900, audio_tokens: 10 },
        },
      },
    ]);
    expect(s.outputTokens).toBe(1200);
    expect(s.reasoningTokens).toBe(900);   // subset of completion_tokens — NOT added to cost
    expect(s.audioTokens).toBe(50);        // 40 prompt + 10 completion
    expect(s.imageTokens).toBe(0);         // OpenAI does not expose image sub-count
  });
});

describe("extractUsage — Anthropic streaming", () => {
  it("reads message_start input + message_delta output", () => {
    const s = run("anthropic", [
      { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 320, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
      { type: "message_delta", usage: { output_tokens: 95 } },
    ]);
    expect(s.inputTokens).toBe(320);
    expect(s.outputTokens).toBe(95);
    expect(s.cachedTokens).toBe(0);
    expect(s.model).toBe("claude-sonnet-4-5");
    expect(s.requestId).toBe("msg_1");
  });

  it("folds cache read+creation tokens back into the prompt total", () => {
    const s = run("anthropic", [
      {
        type: "message_start",
        message: {
          id: "msg_2", model: "claude-opus-4-5",
          usage: { input_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        },
      },
      { type: "message_delta", usage: { output_tokens: 30 } },
    ]);
    // inputTokens must be the FULL prompt so calculateCost can subtract cached.
    expect(s.inputTokens).toBe(1250);     // 50 + 1000 + 200
    expect(s.cachedTokens).toBe(1000);    // only the discounted read subset
    expect(s.outputTokens).toBe(30);
  });

  it("produces a non-zero cost (the bug was $0 on streamed native calls)", () => {
    const s = run("anthropic", [
      { type: "message_start", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 1000 } } },
      { type: "message_delta", usage: { output_tokens: 500 } },
    ]);
    const cost = calculateCost("claude-sonnet-4-5", s.inputTokens, s.outputTokens, s.cachedTokens);
    expect(cost).toBeGreaterThan(0);
    // 1000 * $3/1M + 500 * $15/1M = 0.003 + 0.0075
    expect(cost).toBeCloseTo(0.0105, 6);
  });
});

describe("extractUsage — Google Gemini streaming", () => {
  it("reads cumulative usageMetadata from the final chunk", () => {
    const s = run("google", [
      { candidates: [{ content: { parts: [{ text: "par" }] } }] },
      {
        candidates: [{ content: { parts: [{ text: "tial" }] } }],
        modelVersion: "gemini-2.0-flash",
        usageMetadata: { promptTokenCount: 410, candidatesTokenCount: 120, cachedContentTokenCount: 60 },
      },
    ]);
    expect(s.inputTokens).toBe(410);     // promptTokenCount already includes cached
    expect(s.outputTokens).toBe(120);
    expect(s.cachedTokens).toBe(60);
    expect(s.model).toBe("gemini-2.0-flash");
  });

  it("captures per-modality image/audio + thinking tokens", () => {
    const s = run("google", [
      {
        modelVersion: "gemini-2.5-pro",
        usageMetadata: {
          promptTokenCount: 800, candidatesTokenCount: 300, thoughtsTokenCount: 220,
          promptTokensDetails:    [{ modality: "TEXT", tokenCount: 500 }, { modality: "IMAGE", tokenCount: 258 }, { modality: "AUDIO", tokenCount: 42 }],
          candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 300 }],
        },
      },
    ]);
    expect(s.inputTokens).toBe(800);
    expect(s.reasoningTokens).toBe(220);
    expect(s.imageTokens).toBe(258);
    expect(s.audioTokens).toBe(42);
  });
});
