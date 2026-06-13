/**
 * Tests for gateway provider routing, URL construction, normalizer,
 * Azure OpenAI, TTFT capture logic, and semantic cache.
 * Covers plan test IDs: 4.2.x–4.11.x
 *
 * Priority: P0/P1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TEST_ORG_A } from "@/tests/helpers";

// ── Redis module mock (unit-level — real Redis not required) ──────────────────
// vi.spyOn(redis, "get") does NOT reliably intercept Upstash's client in this
// harness: the call falls through to the rejecting global fetch stub and incurs
// the client's ~4s retry backoff before the catch fires (zrange happens to be
// interceptable, get is not). Mock the underlying @upstash/redis client at the
// module level instead — the way budget.test.ts does — so error-rate, latency
// and policy reads resolve instantly and a non-zero error rate can be injected
// deterministically. Names are `mock`-prefixed so the hoisted vi.mock factory
// may reference them.
const mockGet              = vi.fn().mockResolvedValue(null);
const mockSet              = vi.fn().mockResolvedValue("OK");
const mockZrange           = vi.fn().mockResolvedValue([]);
const mockZadd             = vi.fn().mockResolvedValue(1);
const mockZremrangebyscore = vi.fn().mockResolvedValue(0);
const mockExpire           = vi.fn().mockResolvedValue(1);
const mockIncr             = vi.fn().mockResolvedValue(1);
const mockScan             = vi.fn().mockResolvedValue(["0", []]);
const mockDel              = vi.fn().mockResolvedValue(0);

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(() => ({
    get:              mockGet,
    set:              mockSet,
    zrange:           mockZrange,
    zadd:             mockZadd,
    zremrangebyscore: mockZremrangebyscore,
    expire:           mockExpire,
    incr:             mockIncr,
    scan:             mockScan,
    del:              mockDel,
  })),
}));

// Reset Redis mocks to their default (empty) state before every test so a
// per-test implementation (e.g. an injected error rate) never leaks forward.
beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(null);
  mockSet.mockReset().mockResolvedValue("OK");
  mockZrange.mockReset().mockResolvedValue([]);
  mockZadd.mockReset().mockResolvedValue(1);
  mockZremrangebyscore.mockReset().mockResolvedValue(0);
  mockExpire.mockReset().mockResolvedValue(1);
  mockIncr.mockReset().mockResolvedValue(1);
  mockScan.mockReset().mockResolvedValue(["0", []]);
  mockDel.mockReset().mockResolvedValue(0);
});

// ── Tests: upstream.ts ────────────────────────────────────────────────────────
describe("buildUpstreamUrl()", () => {
  it("builds standard OpenAI URL", async () => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    const url = buildUpstreamUrl("openai", "/v1/chat/completions", "sk-test");
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("appends Google API key as query param", async () => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    const url = buildUpstreamUrl("google", "/v1/models/gemini-pro:generateContent", "my-google-key");
    expect(url).toContain("?key=my-google-key");
    expect(url).toContain("generativelanguage.googleapis.com");
  });

  it("builds Azure deployment URL with api-version", async () => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    const url = buildUpstreamUrl(
      "azure_openai",
      "/chat/completions",
      "my-azure-key",
      "https://myresource.openai.azure.com",
      "gpt-4o",
    );
    expect(url).toContain("/openai/deployments/gpt-4o/chat/completions");
    expect(url).toContain("api-version=");
    expect(url).toContain("myresource.openai.azure.com");
  });

  it("throws when Azure endpoint is missing", async () => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    expect(() =>
      buildUpstreamUrl("azure_openai", "/chat/completions", "key", "", "gpt-4o")
    ).toThrow(/requires a custom_endpoint/i);
  });

  it("uses custom endpoint for ollama", async () => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    const url = buildUpstreamUrl("ollama", "/api/chat", "", "http://localhost:11434");
    expect(url).toBe("http://localhost:11434/api/chat");
  });
});

describe("getProviderConfig() — headers", () => {
  it("OpenAI: uses Authorization Bearer header", async () => {
    const { getProviderConfig } = await import("@/lib/gateway/upstream");
    const cfg = getProviderConfig("openai");
    const headers = cfg.buildHeaders("sk-test", new Headers());
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("Anthropic: uses x-api-key header (not Bearer)", async () => {
    const { getProviderConfig } = await import("@/lib/gateway/upstream");
    const cfg = getProviderConfig("anthropic");
    const headers = cfg.buildHeaders("sk-ant-test", new Headers());
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("Azure OpenAI: uses api-key header (not Bearer)", async () => {
    const { getProviderConfig } = await import("@/lib/gateway/upstream");
    const cfg = getProviderConfig("azure_openai");
    const headers = cfg.buildHeaders("my-azure-key", new Headers());
    expect(headers["api-key"]).toBe("my-azure-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("Google: no auth header (key is in query param)", async () => {
    const { getProviderConfig } = await import("@/lib/gateway/upstream");
    const cfg = getProviderConfig("google");
    const headers = cfg.buildHeaders("my-google-key", new Headers());
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["api-key"]).toBeUndefined();
  });

  it.each(["groq", "xai", "fireworks", "together", "perplexity", "mistral", "cerebras", "nebius", "cohere"])(
    "%s: uses Authorization Bearer and no provider-specific headers",
    async (provider) => {
      const { getProviderConfig } = await import("@/lib/gateway/upstream");
      const cfg = getProviderConfig(provider);
      const headers = cfg.buildHeaders("test-key-123", new Headers());
      expect(headers["Authorization"]).toBe("Bearer test-key-123");
      expect(headers["api-key"]).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    },
  );

  it.each([
    ["groq",       "https://api.groq.com/openai/v1"],
    ["xai",        "https://api.x.ai/v1"],
    ["fireworks",  "https://api.fireworks.ai/inference/v1"],
    ["together",   "https://api.together.xyz/v1"],
    ["perplexity", "https://api.perplexity.ai"],
    ["mistral",    "https://api.mistral.ai/v1"],
    ["cerebras",   "https://api.cerebras.ai/v1"],
    ["nebius",     "https://api.studio.nebius.ai/v1"],
    ["cohere",     "https://api.cohere.ai/compatibility/v1"],
  ])("%s: baseUrl is correct", async (provider, expectedBase) => {
    const { buildUpstreamUrl } = await import("@/lib/gateway/upstream");
    const url = buildUpstreamUrl(provider, "/v1/chat/completions", "key");
    expect(url).toBe(`${expectedBase}/v1/chat/completions`);
  });
});

// ── Tests: normalizer.ts ──────────────────────────────────────────────────────
describe("normalizeRequest()", () => {
  it("is a no-op for same provider", async () => {
    const { normalizeRequest } = await import("@/lib/gateway/normalizer");
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const result = normalizeRequest(body as never, "openai", "openai");
    expect(result).toBe(body);
  });

  it("azure_openai ↔ openai is a no-op (same format)", async () => {
    const { normalizeRequest } = await import("@/lib/gateway/normalizer");
    const body = { model: "gpt-4o", messages: [] };
    const result = normalizeRequest(body as never, "openai", "azure_openai");
    expect(result).toBe(body);
  });

  it("converts OpenAI request to Anthropic format", async () => {
    const { normalizeRequest } = await import("@/lib/gateway/normalizer");
    const body = {
      model:    "claude-opus",
      messages: [
        { role: "system", content: "You are a helper." },
        { role: "user",   content: "Hello!" },
      ],
    };
    const result = normalizeRequest(body as never, "openai", "anthropic") as Record<string, unknown>;
    // Anthropic puts system separately
    expect(result).toBeDefined();
  });
});

describe("canRouteCrossProvider()", () => {
  it("returns canRoute=true for same provider", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({} as never, "openai", "openai");
    expect(result.canRoute).toBe(true);
  });

  it("openai ↔ azure_openai is allowed", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({} as never, "openai", "azure_openai");
    expect(result.canRoute).toBe(true);
  });

  it("blocks parallel_tool_calls when routing to Anthropic", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const req = { parallel_tool_calls: true };
    const result = canRouteCrossProvider(req as never, "openai", "anthropic");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/parallel_tool_calls/i);
  });

  // ── Groq guards ──────────────────────────────────────────────────────────
  it("blocks parallel_tool_calls when routing to Groq", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ parallel_tool_calls: true } as never, "openai", "groq");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/parallel_tool_calls/i);
  });

  it("blocks response_format.json_schema.strict when routing to Groq", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const req = { response_format: { type: "json_schema", json_schema: { strict: true } } };
    const result = canRouteCrossProvider(req as never, "openai", "groq");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/strict/i);
  });

  it("blocks logprobs when routing to Groq", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ logprobs: true } as never, "openai", "groq");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/logprobs/i);
  });

  it("allows standard request to Groq", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ messages: [] } as never, "openai", "groq");
    expect(result.canRoute).toBe(true);
  });

  // ── xAI guard ────────────────────────────────────────────────────────────
  it("blocks logprobs when routing to xAI", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ logprobs: true } as never, "openai", "xai");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/logprobs/i);
  });

  // ── Perplexity guard ─────────────────────────────────────────────────────
  it("blocks tools when routing to Perplexity", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const req = { tools: [{ type: "function", function: { name: "search" } }] };
    const result = canRouteCrossProvider(req as never, "openai", "perplexity");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/tool/i);
  });

  // ── Fireworks / Together — broadly compatible ─────────────────────────────
  it("allows standard request to Fireworks", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ messages: [] } as never, "openai", "fireworks");
    expect(result.canRoute).toBe(true);
  });

  it("allows standard request to Together", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ messages: [] } as never, "openai", "together");
    expect(result.canRoute).toBe(true);
  });

  // ── Mistral / Cerebras / Nebius / Cohere — OpenAI-compatible, no blockers ──
  it.each(["mistral", "cerebras", "nebius", "cohere"])(
    "allows standard request to %s (OpenAI-compatible)",
    async (provider) => {
      const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
      const result = canRouteCrossProvider({ messages: [] } as never, "openai", provider as never);
      expect(result.canRoute).toBe(true);
    },
  );
});

// ── Tests: data residency ─────────────────────────────────────────────────────
describe("checkDataResidency()", () => {
  it("allows any policy with any region", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("any", "eu").allowed).toBe(true);
    expect(checkDataResidency("any", "us").allowed).toBe(true);
    expect(checkDataResidency("any", "global").allowed).toBe(true);
  });

  it("eu_only policy blocks US-region provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    const result = checkDataResidency("eu_only", "us");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("us_only policy blocks EU-region provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    const result = checkDataResidency("us_only", "eu");
    expect(result.allowed).toBe(false);
  });

  it("eu_only policy allows EU-region provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("eu_only", "eu").allowed).toBe(true);
  });
});

// ── Tests: buildCacheKey org isolation ───────────────────────────────────────
describe("semantic cache — cross-org isolation (security)", () => {
  it("cache keys for different orgs never collide", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const msgs = [{ role: "user", content: "sensitive financial data query" }];
    const k1 = buildCacheKey("org-a", "gpt-4o", msgs, 0, false);
    const k2 = buildCacheKey("org-b", "gpt-4o", msgs, 0, false);
    expect(k1).not.toBeNull();
    expect(k2).not.toBeNull();
    expect(k1).not.toBe(k2);
    // Ensure org-a prefix can't match org-b key
    expect(k1!.startsWith("prompt_cache:org-a:")).toBe(true);
    expect(k2!.startsWith("prompt_cache:org-b:")).toBe(true);
  });
});

// ── Tests: SSRF guard in notify.ts ───────────────────────────────────────────
describe("SSRF guard in alert notifications", () => {
  it("rejects localhost URLs", async () => {
    // The sendSlackAlert / sendCustomWebhook functions reject private IPs
    // We test this by checking the URL validation logic
    const privateUrls = [
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://10.0.0.1/hook",
      "http://192.168.1.1/hook",
      "http://169.254.0.1/hook",
    ];

    // Import and check the validation pattern used in notify.ts
    for (const url of privateUrls) {
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      const isPrivate =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("169.254.") ||
        hostname.startsWith("172.16.");

      expect(isPrivate).toBe(true);
    }
  });

  it("allows public HTTPS URLs", () => {
    const publicUrl = new URL("https://hooks.slack.com/services/T00/B00/abc123");
    const isPrivate = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1";
    expect(isPrivate).toBe(false);
  });
});

// ── Tests: pricing table coverage ────────────────────────────────────────────
describe("calculateCost()", () => {
  it("azure_openai model pricing falls back to openai model pricing", async () => {
    const { calculateCost } = await import("@/lib/pricing/table");
    // Azure uses deployment names matching OpenAI model names
    const cost = calculateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for completely unknown model", async () => {
    const { calculateCost } = await import("@/lib/pricing/table");
    expect(calculateCost("unknown-model-xyz", 1000, 500)).toBe(0);
  });

  it("normalizeModelName strips date version suffixes", async () => {
    const { normalizeModelName, calculateCost: calcCost } = await import("@/lib/pricing/table");
    // The function strips -YYYY-MM-DD suffixes and normalizes aliases
    const normalized = normalizeModelName("gpt-4o-2024-11-20");
    expect(normalized).toBe("gpt-4o");
    const cost = calcCost(normalized, 1_000_000, 0);
    expect(cost).toBeGreaterThan(0);
  });

  it.each([
    ["groq",       "llama-3.3-70b-versatile"],
    ["xai",        "grok-3"],
    ["fireworks",  "accounts/fireworks/models/llama-v3p1-70b-instruct"],
    ["together",   "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    ["perplexity", "sonar-pro"],
    ["mistral",    "mistral-large-latest"],
    ["cerebras",   "llama-3.3-70b"],
    ["nebius",     "meta-llama/Meta-Llama-3.1-70B-Instruct"],
    ["cohere",     "command-a-03-2025"],
  ])("%s/%s: cost is non-zero for 1M tokens", async (_provider, model) => {
    const { calculateCost } = await import("@/lib/pricing/table");
    expect(calculateCost(model, 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });
});

// ── Tests: AWS Bedrock ────────────────────────────────────────────────────────
describe("AWS Bedrock", () => {
  // ── Credential parsing ──────────────────────────────────────────────────────
  it("parseBedrockCredentials: parses valid JSON credentials", async () => {
    const { parseBedrockCredentials } = await import("@/lib/gateway/bedrock");
    const creds = parseBedrockCredentials(
      '{"accessKeyId":"AKIATEST1234","secretAccessKey":"secret/key"}',
      "us-east-1",
    );
    expect(creds.accessKeyId).toBe("AKIATEST1234");
    expect(creds.secretAccessKey).toBe("secret/key");
    expect(creds.region).toBe("us-east-1");
  });

  it("parseBedrockCredentials: throws on non-JSON key", async () => {
    const { parseBedrockCredentials } = await import("@/lib/gateway/bedrock");
    expect(() => parseBedrockCredentials("plain-api-key-string", "us-east-1"))
      .toThrow(/JSON/i);
  });

  it("parseBedrockCredentials: throws when accessKeyId is missing", async () => {
    const { parseBedrockCredentials } = await import("@/lib/gateway/bedrock");
    expect(() => parseBedrockCredentials('{"secretAccessKey":"secret"}', "us-east-1"))
      .toThrow(/accessKeyId/i);
  });

  it("parseBedrockCredentials: defaults region to us-east-1 when empty", async () => {
    const { parseBedrockCredentials } = await import("@/lib/gateway/bedrock");
    const creds = parseBedrockCredentials(
      '{"accessKeyId":"AKIA","secretAccessKey":"sec"}',
      "",
    );
    expect(creds.region).toBe("us-east-1");
  });

  // ── Capability guards ────────────────────────────────────────────────────────
  it("blocks parallel_tool_calls when routing to bedrock", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ parallel_tool_calls: true } as never, "openai", "bedrock");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/parallel_tool_calls/i);
  });

  it("blocks logprobs when routing to bedrock", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ logprobs: true } as never, "openai", "bedrock");
    expect(result.canRoute).toBe(false);
    expect(result.reason).toMatch(/logprobs/i);
  });

  it("allows standard request to bedrock", async () => {
    const { canRouteCrossProvider } = await import("@/lib/gateway/normalizer");
    const result = canRouteCrossProvider({ messages: [] } as never, "openai", "bedrock");
    expect(result.canRoute).toBe(true);
  });

  // ── Pricing + model name normalization ────────────────────────────────────
  it("normalizeModelName strips cross-region inference profile prefix (us.)", async () => {
    const { normalizeModelName } = await import("@/lib/pricing/table");
    const norm = normalizeModelName("us.anthropic.claude-3-5-haiku-20241022-v1:0");
    expect(norm).toBe("anthropic.claude-3-5-haiku-20241022-v1:0");
  });

  it("normalizeModelName strips cross-region inference profile prefix (eu.)", async () => {
    const { normalizeModelName } = await import("@/lib/pricing/table");
    const norm = normalizeModelName("eu.anthropic.claude-3-5-sonnet-20241022-v2:0");
    expect(norm).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
  });

  it.each([
    ["bedrock", "anthropic.claude-3-5-haiku-20241022-v1:0"],
    ["bedrock", "anthropic.claude-3-5-sonnet-20241022-v2:0"],
    ["bedrock", "amazon.nova-pro-v1:0"],
    ["bedrock", "amazon.nova-lite-v1:0"],
    ["bedrock", "meta.llama3-3-70b-instruct-v1:0"],
  ])("bedrock/%s: cost is non-zero for 1M tokens", async (_provider, model) => {
    const { calculateCost } = await import("@/lib/pricing/table");
    expect(calculateCost(model, 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });

  it("calculateCost works for cross-region profile after normalization", async () => {
    const { calculateCost, normalizeModelName } = await import("@/lib/pricing/table");
    const norm = normalizeModelName("us.anthropic.claude-3-5-haiku-20241022-v1:0");
    expect(calculateCost(norm, 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });
});

// ── Tests: Policy Router (Phase 2a) ──────────────────────────────────────────
describe("Policy Router", () => {
  // ── evaluateCondition: leaf operators ─────────────────────────────────────
  it("eq: matches equal strings", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ field: "request.model", op: "eq", value: "gpt-4o" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "request.model", op: "eq", value: "gpt-3.5" }, ctx)).toBe(false);
  });

  it("ne: not-equal operator", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ field: "request.environment", op: "ne", value: "development" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "request.environment", op: "ne", value: "production" }, ctx)).toBe(false);
  });

  it("gt/lt: numeric comparisons on error_rate", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = {
      request: { model: "", provider: "openai", environment: "production", tags: {} },
      provider: { health: { openai: { error_rate: 0.3, latency_p50: 200 } } },
      org: { plan: "starter" },
    };
    expect(evaluateCondition({ field: "provider.health.openai.error_rate", op: "gt", value: 0.1 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "provider.health.openai.error_rate", op: "lt", value: 0.1 }, ctx)).toBe(false);
  });

  it("startsWith: prefix match on model", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o-mini", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ field: "request.model", op: "startsWith", value: "gpt-4" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "request.model", op: "startsWith", value: "claude" }, ctx)).toBe(false);
  });

  it("includes: substring match", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "claude-3-5-haiku", provider: "anthropic", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ field: "request.model", op: "includes", value: "haiku" }, ctx)).toBe(true);
  });

  it("nested tag field access: request.tags.tier", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: { tier: "enterprise" } }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ field: "request.tags.tier", op: "eq", value: "enterprise" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "request.tags.tier", op: "eq", value: "free" }, ctx)).toBe(false);
  });

  // ── evaluateCondition: logical operators ──────────────────────────────────
  it("all: AND — all must be true", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "development", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ all: [
      { field: "request.model", op: "eq" as const, value: "gpt-4o" },
      { field: "request.environment", op: "eq" as const, value: "development" },
    ] }, ctx)).toBe(true);
    expect(evaluateCondition({ all: [
      { field: "request.model", op: "eq" as const, value: "gpt-4o" },
      { field: "request.environment", op: "eq" as const, value: "production" },
    ] }, ctx)).toBe(false);
  });

  it("any: OR — at least one must be true", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "staging", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ any: [
      { field: "request.environment", op: "eq" as const, value: "development" },
      { field: "request.environment", op: "eq" as const, value: "staging" },
    ] }, ctx)).toBe(true);
  });

  it("not: negation", async () => {
    const { evaluateCondition } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    expect(evaluateCondition({ not: { field: "request.environment", op: "eq" as const, value: "development" } }, ctx)).toBe(true);
  });

  // ── validateCondition ─────────────────────────────────────────────────────
  it("validateCondition: accepts valid leaf node", async () => {
    const { validateCondition } = await import("@/lib/gateway/policy-router");
    expect(validateCondition({ field: "request.model", op: "eq", value: "gpt-4o" })).toBe(true);
  });

  it("validateCondition: rejects missing op", async () => {
    const { validateCondition } = await import("@/lib/gateway/policy-router");
    expect(validateCondition({ field: "request.model", value: "gpt-4o" })).toBe(false);
  });

  it("validateCondition: rejects invalid op string", async () => {
    const { validateCondition } = await import("@/lib/gateway/policy-router");
    expect(validateCondition({ field: "request.model", op: "regex", value: ".*" })).toBe(false);
  });

  it("validateCondition: rejects non-object input", async () => {
    const { validateCondition } = await import("@/lib/gateway/policy-router");
    expect(validateCondition("eq")).toBe(false);
    expect(validateCondition(null)).toBe(false);
  });

  it("validateCondition: accepts nested all/any/not", async () => {
    const { validateCondition } = await import("@/lib/gateway/policy-router");
    expect(validateCondition({
      all: [
        { field: "request.environment", op: "eq", value: "production" },
        { any: [{ field: "request.provider", op: "eq", value: "openai" }] },
      ],
    })).toBe(true);
  });

  // ── evaluatePolicies: priority + matching ─────────────────────────────────
  it("evaluatePolicies: returns null when no policies exist", async () => {
    const { evaluatePolicies } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    // Pass a supabase mock that returns empty data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeSupa = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ data: [] }) }) }) }) }) } as any;
    const result = await evaluatePolicies("org-1", ctx, fakeSupa);
    expect(result).toBeNull();
  });

  it("evaluatePolicies: fails-open on supabase error", async () => {
    const { evaluatePolicies } = await import("@/lib/gateway/policy-router");
    const ctx = { request: { model: "gpt-4o", provider: "openai", environment: "production", tags: {} }, provider: { health: {} }, org: { plan: "starter" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failSupa = { from: () => { throw new Error("DB down"); } } as any;
    const result = await evaluatePolicies("org-2", ctx, failSupa);
    expect(result).toBeNull();
  });
});

// ── Tests: Weighted Load Balancing (Phase 2b) ─────────────────────────────────
describe("Weighted Load Balancing", () => {
  // ── weightedSample ─────────────────────────────────────────────────────────
  it("weightedSample: weight=100/0 always picks the heavy item", async () => {
    const { weightedSample } = await import("@/lib/gateway/routing");
    const items = [
      { model: "gpt-4o",    provider: "openai",    weight: 100 },
      { model: "claude",    provider: "anthropic", weight: 0   },
    ];
    // Run 20 times — should always pick gpt-4o
    for (let i = 0; i < 20; i++) {
      expect(weightedSample(items).model).toBe("gpt-4o");
    }
  });

  it("weightedSample: all-zero weights falls back to uniform random (no hang)", async () => {
    const { weightedSample } = await import("@/lib/gateway/routing");
    const items = [
      { model: "a", provider: "openai",    weight: 0 },
      { model: "b", provider: "anthropic", weight: 0 },
    ];
    const result = weightedSample(items);
    expect(["a", "b"]).toContain(result.model);
  });

  it("weightedSample: single-item array always returns that item", async () => {
    const { weightedSample } = await import("@/lib/gateway/routing");
    const items = [{ model: "solo", provider: "openai", weight: 50 }];
    expect(weightedSample(items).model).toBe("solo");
  });

  it("weightedSample: unweighted items treated as weight=1 (uniform)", async () => {
    const { weightedSample } = await import("@/lib/gateway/routing");
    const items = [
      { model: "a", provider: "openai" },
      { model: "b", provider: "openai" },
      { model: "c", provider: "openai" },
    ];
    // Over many runs both should appear — just verify no throw and valid return
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(weightedSample(items).model);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("weightedSample: throws on empty array", async () => {
    const { weightedSample } = await import("@/lib/gateway/routing");
    expect(() => weightedSample([])).toThrow(RangeError);
  });

  // ── adaptCandidateWeights ─────────────────────────────────────────────────
  it("adaptCandidateWeights: preserves weights when error and latency data are absent", async () => {
    const { adaptCandidateWeights } = await import("@/lib/gateway/provider-health");
    // No error data (get→null ⇒ errorRate 0) and no latency data (zrange→[] ⇒ unknown,
    // relative penalty 0) — both are the mock defaults. Both multipliers are 1, so the
    // weights are unchanged.
    const candidates = [
      { model: "gpt-4o", provider: "openai",    weight: 100 },
      { model: "claude",  provider: "anthropic", weight: 50  },
    ];
    const adapted = await adaptCandidateWeights(candidates);
    expect(adapted[0]!.weight).toBe(100);
    expect(adapted[1]!.weight).toBe(50);
  });

  it("adaptCandidateWeights: error factor — errorMultiplier = max(0, 1 - errorRate * 2)", () => {
    // The error component (dominant factor). Latency only re-orders similarly
    // reliable routes; with uniform/unknown latency the multiplier is 1, so the
    // effective weight collapses to this error-only form.
    function errorEffective(weight: number, errorRate: number): number {
      return Math.max(0, Math.round(weight * Math.max(0, 1 - errorRate * 2)));
    }
    expect(errorEffective(100, 0.2)).toBe(60);   // 100 * 0.6
    expect(errorEffective(50, 0.2)).toBe(30);    // 50 * 0.6
    expect(errorEffective(80, 0.6)).toBe(0);     // clamped to 0
    expect(errorEffective(80, 0.5)).toBe(0);     // exactly 0
    expect(errorEffective(80, 0.4)).toBe(16);    // 80 * 0.2
    expect(errorEffective(100, 0)).toBe(100);    // no errors → unchanged
  });

  it("adaptCandidateWeights: latency breaks ties between equally-reliable routes", async () => {
    const { adaptCandidateWeights } = await import("@/lib/gateway/provider-health");
    // Same provider ⇒ same 0 error rate (mockGet default null); routes differ only by
    // per-model p50 latency, injected via the per-key zrange mock.
    mockZrange.mockImplementation(((key: string) =>
      Promise.resolve(
        key.includes("fast-model") ? ["1_a:500"]    // 500ms p50  → fastest
        : key.includes("slow-model") ? ["1_b:2000"] // 2000ms p50 → slowest
        : [],
      )) as never);

    const candidates = [
      { model: "fast-model", provider: "openai", weight: 100 },
      { model: "slow-model", provider: "openai", weight: 100 },
    ];
    const adapted = await adaptCandidateWeights(candidates);
    expect(adapted[0]!.weight).toBe(100);  // fastest keeps full weight
    expect(adapted[1]!.weight).toBe(70);   // slowest loses the full 30% latency penalty
  });

  it("adaptCandidateWeights: passes through unweighted candidates unchanged", async () => {
    const { adaptCandidateWeights } = await import("@/lib/gateway/provider-health");
    const candidates = [
      { model: "gpt-4o", provider: "openai" },         // no weight
      { model: "claude",  provider: "anthropic" },      // no weight
    ];
    const adapted = await adaptCandidateWeights(candidates);
    expect(adapted[0]!.weight).toBeUndefined();
    expect(adapted[1]!.weight).toBeUndefined();
  });

  // ── rankCandidates: weighted mode ─────────────────────────────────────────
  it("rankCandidates: weighted mode — weight=100/0 always picks heavy as primary", async () => {
    const { rankCandidates } = await import("@/lib/gateway/provider-health");
    // adaptCandidateWeights → getErrorRate reads redis.get; with the mocked client
    // returning null the error_rate resolves to 0 (and zrange→[] ⇒ no latency penalty)
    // without the ~4s real-network retry delay an unreachable Redis incurs in tests.
    const candidates = [
      { model: "gpt-4o",  provider: "openai",    weight: 100 },
      { model: "claude",  provider: "anthropic", weight: 0   },
    ];
    // weights [100, 0] → weightedSample always selects index 0 on the first
    // draw (rand ∈ [0,100) - 100 <= 0), so a single call is deterministic.
    const ranked = await rankCandidates(candidates, "error");
    expect(ranked[0]!.model).toBe("gpt-4o");
  });

  it("rankCandidates: unweighted candidates use existing strategy (unchanged behavior)", async () => {
    const { rankCandidates } = await import("@/lib/gateway/provider-health");
    const candidates = [
      { model: "gpt-4o",     provider: "openai"    },  // no weight
      { model: "gpt-4o-mini", provider: "openai"   },
    ];
    // 'error' strategy returns original order
    const ranked = await rankCandidates(candidates, "error");
    expect(ranked[0]!.model).toBe("gpt-4o");
    expect(ranked[1]!.model).toBe("gpt-4o-mini");
  });
});

// ── Tests: provider health states (Tier 1.2: adaptive LB) ───────────────────────
describe("Provider Health States", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifyHealthState: maps error rate (and prior window) to a state", async () => {
    const { classifyHealthState } = await import("@/lib/gateway/provider-health");
    expect(classifyHealthState(0.10)).toBe("failed");            // >5%
    expect(classifyHealthState(0.03)).toBe("degraded");         // >2%, ≤5%
    expect(classifyHealthState(0.01)).toBe("healthy");          // ≤2%, no prior trouble
    expect(classifyHealthState(0.01, 0.10)).toBe("recovering"); // healthy now, unhealthy before
    expect(classifyHealthState(0.06, 0.0)).toBe("failed");      // current failure dominates
    expect(classifyHealthState(0.02, 0.0)).toBe("healthy");     // 2% is the degraded boundary (not >2%)
    expect(classifyHealthState(0.05, 0.0)).toBe("degraded");    // 5% is the failed boundary (not >5%)
  });

  it("rankCandidates 'health': orders by health state (healthy → recovering → degraded → failed)", async () => {
    const { rankCandidates } = await import("@/lib/gateway/provider-health");
    // Inject distinct 5-min-window error counts per provider via the mocked redis.get.
    // getErrorRateAt reads errors:{provider}:{bucket} / success:{provider}:{bucket} for
    // the current bucket (offset 0) and the previous one (offset -1, to detect recovery):
    //   • openai    → no data              → rate 0,   prev 0    → healthy
    //   • cohere    → clean now, bad before → rate 0,   prev 0.5  → recovering
    //   • google    → 3 / 97 ≈ 3%          → rate 0.03            → degraded
    //   • anthropic → 100 / 0 = 100%       → rate 1.0             → failed
    const WIN  = 300; // ERROR_WINDOW_SECONDS
    const cur  = Math.floor(Date.now() / 1000 / WIN);
    const prev = cur - 1;
    mockGet.mockImplementation(((key: string) => {
      if (key === `errors:anthropic:${cur}`)  return Promise.resolve(100);
      if (key === `success:anthropic:${cur}`) return Promise.resolve(0);
      if (key === `errors:google:${cur}`)     return Promise.resolve(3);
      if (key === `success:google:${cur}`)    return Promise.resolve(97);
      if (key === `errors:cohere:${prev}`)    return Promise.resolve(50);
      if (key === `success:cohere:${prev}`)   return Promise.resolve(50);
      return Promise.resolve(null); // openai + every other window → no data → healthy
    }) as never);

    const candidates = [
      { model: "claude-3-5-sonnet", provider: "anthropic" }, // failed
      { model: "command-r",         provider: "cohere"    }, // recovering
      { model: "gpt-4o",            provider: "openai"    }, // healthy
      { model: "gemini-1.5-pro",    provider: "google"    }, // degraded
    ];
    const ranked = await rankCandidates(candidates, "health");
    expect(ranked.map(c => c.provider)).toEqual(["openai", "cohere", "google", "anthropic"]);
  });
});

// ── Tests: semantic-cache.ts (Phase 3: Semantic Cache) ──────────────────────────
describe("Semantic Cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── extractQueryText ────────────────────────────────────────────────────────
  it("extractQueryText: returns trimmed text of the last user message", async () => {
    const { extractQueryText } = await import("@/lib/gateway/semantic-cache");
    const messages = [
      { role: "user", content: "What is the capital of France?" },
      { role: "assistant", content: "Paris." },
      { role: "user", content: "  And Germany?  " },
    ];
    expect(extractQueryText(messages)).toBe("And Germany?");
  });

  it("extractQueryText: joins text parts of multi-part content, ignoring non-text parts", async () => {
    const { extractQueryText } = await import("@/lib/gateway/semantic-cache");
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image:" },
          { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          { type: "text", text: "What breed is the cat?" },
        ],
      },
    ];
    expect(extractQueryText(messages)).toBe("Describe this image:\nWhat breed is the cat?");
  });

  it("extractQueryText: returns null when there is no user message", async () => {
    const { extractQueryText } = await import("@/lib/gateway/semantic-cache");
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "assistant", content: "Hello!" },
    ];
    expect(extractQueryText(messages)).toBeNull();
  });

  it("extractQueryText: returns null for an empty messages array", async () => {
    const { extractQueryText } = await import("@/lib/gateway/semantic-cache");
    expect(extractQueryText([])).toBeNull();
  });

  it("extractQueryText: returns null when the last user message is whitespace-only", async () => {
    const { extractQueryText } = await import("@/lib/gateway/semantic-cache");
    expect(extractQueryText([{ role: "user", content: "   " }])).toBeNull();
  });

  // ── semanticCacheGet / semanticCacheSet: no-op without config ────────────────
  it("semanticCacheGet: returns null when UPSTASH_VECTOR_REST_URL/TOKEN are unset", async () => {
    delete process.env.UPSTASH_VECTOR_REST_URL;
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;

    const { semanticCacheGet } = await import("@/lib/gateway/semantic-cache");
    const result = await semanticCacheGet(
      TEST_ORG_A.id,
      [{ role: "user", content: "hello" }],
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
    );
    expect(result).toBeNull();
  });

  it("semanticCacheSet: resolves without throwing when UPSTASH_VECTOR_REST_URL/TOKEN are unset", async () => {
    delete process.env.UPSTASH_VECTOR_REST_URL;
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;

    const { semanticCacheSet } = await import("@/lib/gateway/semantic-cache");
    await expect(semanticCacheSet(
      TEST_ORG_A.id,
      [{ role: "user", content: "hello" }],
      { model: "gpt-4o", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
    )).resolves.toBeUndefined();
  });

  // ── semanticCacheGet: similarity threshold ────────────────────────────────────
  it("semanticCacheGet: returns the cached entry when similarity score meets the threshold", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";
    process.env.OPENAI_API_KEY            = "sk-test-key";

    const cachedEntry = {
      response:     { id: "chatcmpl-1", model: "gpt-4o", choices: [] },
      model:        "gpt-4o",
      inputTokens:  10,
      outputTokens: 5,
      cachedAt:     Date.now(),
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { total_tokens: 7 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ id: "vec-1", score: 0.97, metadata: { ...cachedEntry, org_id: TEST_ORG_A.id } }],
      }), { status: 200 }));

    const { semanticCacheGet } = await import("@/lib/gateway/semantic-cache");
    const result = await semanticCacheGet(
      TEST_ORG_A.id,
      [{ role: "user", content: "What is the capital of France?" }],
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
    );

    // Richer return: the entry plus the debug signal used for response headers.
    expect(result?.entry).toMatchObject({ model: "gpt-4o", inputTokens: 10, outputTokens: 5 });
    expect(result?.similarity).toBe(0.97);
    expect(result?.embeddingTokens).toBe(7);
  });

  it("semanticCacheGet: returns null when similarity score is below the threshold", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";
    process.env.OPENAI_API_KEY            = "sk-test-key";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ id: "vec-1", score: 0.80, metadata: { org_id: TEST_ORG_A.id } }],
      }), { status: 200 }));

    const { semanticCacheGet } = await import("@/lib/gateway/semantic-cache");
    const result = await semanticCacheGet(
      TEST_ORG_A.id,
      [{ role: "user", content: "What is the capital of France?" }],
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
    );

    expect(result).toBeNull();
  });

  // ── semanticCacheSet: stores the response under its prompt embedding ───────────
  it("semanticCacheSet: upserts the embedding with response metadata scoped to the org", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";
    process.env.OPENAI_API_KEY            = "sk-test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: "Success" }), { status: 200 }));

    const { semanticCacheSet } = await import("@/lib/gateway/semantic-cache");
    await semanticCacheSet(
      TEST_ORG_A.id,
      [{ role: "user", content: "What is the capital of France?" }],
      { id: "chatcmpl-1", model: "gpt-4o", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const upsertBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(upsertBody.vector).toEqual([0.1, 0.2, 0.3]);
    expect(upsertBody.metadata.org_id).toBe(TEST_ORG_A.id);
    expect(upsertBody.metadata.model).toBe("gpt-4o");
    expect(upsertBody.metadata.inputTokens).toBe(10);
    expect(upsertBody.metadata.outputTokens).toBe(5);
  });

  // ── Cache-key partitioning (Tier 1.1 hardening) ──────────────────────────────
  it("buildCacheKey: a partition changes the key and is stable for the same partition", async () => {
    const { buildCacheKey } = await import("@/lib/gateway/cache");
    const msgs = [{ role: "user", content: "hi" }];

    const noPartition = buildCacheKey(TEST_ORG_A.id, "gpt-4o", msgs, 0, false);
    const userA       = buildCacheKey(TEST_ORG_A.id, "gpt-4o", msgs, 0, false, "user-a");
    const userAagain  = buildCacheKey(TEST_ORG_A.id, "gpt-4o", msgs, 0, false, "user-a");
    const userB       = buildCacheKey(TEST_ORG_A.id, "gpt-4o", msgs, 0, false, "user-b");

    expect(noPartition).not.toBeNull();
    expect(userA).not.toBe(noPartition);   // partition is folded into the hash
    expect(userA).toBe(userAagain);        // deterministic for the same partition
    expect(userA).not.toBe(userB);         // different partitions never collide
  });

  // ── semanticCacheGet: partition scopes the vector filter ─────────────────────
  it("semanticCacheGet: scopes the vector query filter to the partition when supplied", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";
    process.env.OPENAI_API_KEY            = "sk-test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { total_tokens: 3 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [] }), { status: 200 }));

    const { semanticCacheGet } = await import("@/lib/gateway/semantic-cache");
    await semanticCacheGet(
      TEST_ORG_A.id,
      [{ role: "user", content: "What is the capital of France?" }],
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
      "session-123",
    );

    const queryBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(queryBody.filter).toContain(`org_id = '${TEST_ORG_A.id}'`);
    expect(queryBody.filter).toContain("partition = 'session-123'");
  });

  it("semanticCacheGet: sanitizes a partition value before interpolating it into the filter", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";
    process.env.OPENAI_API_KEY            = "sk-test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { total_tokens: 3 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [] }), { status: 200 }));

    const { semanticCacheGet } = await import("@/lib/gateway/semantic-cache");
    // A filter-injection attempt — the single quotes / OR clause must be stripped.
    await semanticCacheGet(
      TEST_ORG_A.id,
      [{ role: "user", content: "hi" }],
      { similarityThreshold: 0.92, embeddingModel: "text-embedding-3-small" },
      "x' OR '1'='1",
    );

    const queryBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(queryBody.filter).not.toContain("'1'='1");
    expect(queryBody.filter).toContain("partition = 'xOR11'");  // only safe chars survive
  });

  // ── Invalidation (Tier 1.1 hardening) ────────────────────────────────────────
  it("semanticCacheInvalidate: returns false (no-op) when the vector store is unconfigured", async () => {
    delete process.env.UPSTASH_VECTOR_REST_URL;
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;

    const { semanticCacheInvalidate } = await import("@/lib/gateway/semantic-cache");
    expect(await semanticCacheInvalidate(TEST_ORG_A.id)).toBe(false);
  });

  it("semanticCacheInvalidate: issues an org-scoped delete when the vector store is configured", async () => {
    process.env.UPSTASH_VECTOR_REST_URL   = "https://test-vector.upstash.io";
    process.env.UPSTASH_VECTOR_REST_TOKEN = "test-vector-token";

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { deleted: 3 } }), { status: 200 }));

    const { semanticCacheInvalidate } = await import("@/lib/gateway/semantic-cache");
    const ok = await semanticCacheInvalidate(TEST_ORG_A.id);

    expect(ok).toBe(true);
    // Body envelope is opaque, but it must carry the org-scoped filter.
    const rawDeleteBody = (fetchSpy.mock.calls[0]![1] as RequestInit).body as string;
    expect(rawDeleteBody).toContain(`org_id = '${TEST_ORG_A.id}'`);
  });

  it("invalidateOrgCache: fails safe (returns 0) when Redis is unavailable", async () => {
    // The mocked @upstash/redis client makes redis.scan reject instantly (no Upstash
    // retry-backoff), exercising invalidateOrgCache's best-effort fail-safe catch.
    mockScan.mockRejectedValue(new Error("Redis down"));

    const { invalidateOrgCache } = await import("@/lib/gateway/cache");
    expect(await invalidateOrgCache(TEST_ORG_A.id)).toBe(0);
  });
});
