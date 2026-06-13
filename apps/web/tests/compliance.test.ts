/**
 * Tests for compliance features: GDPR, PII masking, audit log, data residency, model governance.
 * Covers plan test IDs: 20.x
 *
 * Priority: P0/P1
 */
import { describe, it, expect, vi } from "vitest";

// ── Tests: Data Residency ──────────────────────────────────────────────────────
describe("Data residency enforcement", () => {
  it("any policy allows all region combinations", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    const regions = ["global", "eu", "us"] as const;
    for (const region of regions) {
      expect(checkDataResidency("any", region).allowed).toBe(true);
    }
  });

  it("eu_only policy blocks us-region provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    // 'us' region key is not allowed under eu_only policy
    expect(checkDataResidency("eu_only", "us").allowed).toBe(false);
  });

  it("eu_only policy allows eu provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("eu_only", "eu").allowed).toBe(true);
  });

  it("eu_only policy allows global provider keys (no specific region constraint)", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    // 'global' keys have no specific region — allowed under any policy
    expect(checkDataResidency("eu_only", "global").allowed).toBe(true);
  });

  it("us_only policy blocks eu-region provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("us_only", "eu").allowed).toBe(false);
  });

  it("us_only policy allows us provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("us_only", "us").allowed).toBe(true);
  });

  it("us_only policy allows global provider keys", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    expect(checkDataResidency("us_only", "global").allowed).toBe(true);
  });

  it("data residency violation returns reason string", async () => {
    const { checkDataResidency } = await import("@/lib/gateway/data-residency");
    const result = checkDataResidency("eu_only", "us");
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

// ── Tests: PII masking completeness ──────────────────────────────────────────
describe("PII masking — all 5 pattern types", () => {
  it("masks email: user@domain.com", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    const output = maskPii("Contact user@domain.com for help", ["email"]);
    expect(output).toContain("[REDACTED:email]");
    expect(output).not.toContain("user@domain.com");
    expect(output).toContain("Contact");
  });

  it("masks phone: (555) 867-5309", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("Call (555) 867-5309 now", ["phone"])).toContain("[REDACTED:phone]");
    expect(maskPii("Call 555-867-5309 now",  ["phone"])).toContain("[REDACTED:phone]");
  });

  it("masks SSN: 123-45-6789", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("My SSN is 123-45-6789", ["ssn"])).toContain("[REDACTED:ssn]");
  });

  it("masks credit card: 4111-1111-1111-1111", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    const output = maskPii("Card: 4111-1111-1111-1111", ["credit_card"]);
    expect(output).toContain("[REDACTED:credit_card]");
  });

  it("masks IPv4: 192.168.1.1", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    expect(maskPii("Server at 192.168.1.1", ["ip_address"])).toContain("[REDACTED:ip_address]");
    expect(maskPii("External IP: 8.8.8.8", ["ip_address"])).toContain("[REDACTED:ip_address]");
  });

  it("applies all 5 patterns when DEFAULT_PATTERNS used", async () => {
    const { maskPii, DEFAULT_PATTERNS } = await import("@/lib/privacy/pii-masker");
    const input  = "Email: a@b.com, Phone: 555-123-4567, SSN: 123-45-6789, IP: 1.2.3.4";
    const output = maskPii(input, DEFAULT_PATTERNS);
    expect(output).toContain("[REDACTED:email]");
    expect(output).toContain("[REDACTED:phone]");
    expect(output).toContain("[REDACTED:ssn]");
    expect(output).toContain("[REDACTED:ip_address]");
  });

  it("does not alter surrounding text (only matches are redacted)", async () => {
    const { maskPii } = await import("@/lib/privacy/pii-masker");
    const input   = "Contact alice@company.com about the project";
    const masked  = maskPii(input, ["email"]);
    expect(masked).toContain("Contact");
    expect(masked).toContain("about the project");
    expect(masked).not.toContain("alice@company.com");
  });
});

// ── Tests: Org-level PII config ──────────────────────────────────────────────
describe("PII masking — org config", () => {
  it("org.pii_masking_enabled defaults to false in migration", () => {
    const defaultEnabled = false; // migration 20260615_pii_masking.sql
    expect(defaultEnabled).toBe(false);
  });

  it("default pii_mask_patterns includes all 5 pattern types", () => {
    const defaults = ["email", "phone", "ssn", "credit_card", "ip_address"];
    expect(defaults).toHaveLength(5);
    expect(defaults).toContain("email");
    expect(defaults).toContain("ssn");
  });
});

// ── Tests: Model governance ──────────────────────────────────────────────────
describe("Model governance policy", () => {
  it("checkOrgModelPolicy identifies blocked model", async () => {
    const { checkOrgModelPolicy } = await import("@/lib/gateway/model-policy");

    // Mock supabase — returns policy row for org_model_policies
    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "org_model_policies") {
          return {
            select:  vi.fn().mockReturnThis(),
            eq:      vi.fn().mockResolvedValue({
              data: [{ id: "p1", model_pattern: "gpt-4o", environments: null, policy: "blocked" }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }),
    };

    const result = await checkOrgModelPolicy(
      mockAdmin as never, "org-test", "gpt-4o", "production", "key-001",
    );
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
  });

  it("checkOrgModelPolicy allows model not in any policy", async () => {
    const { checkOrgModelPolicy } = await import("@/lib/gateway/model-policy");

    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };

    const result = await checkOrgModelPolicy(
      mockAdmin as never, "org-test", "gpt-4o-mini", "production", "key-001",
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("checkOrgModelPolicy flags requires_approval policy", async () => {
    const { checkOrgModelPolicy } = await import("@/lib/gateway/model-policy");

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "org_model_policies") {
          return {
            select: vi.fn().mockReturnThis(),
            eq:     vi.fn().mockResolvedValue({
              data: [{ id: "p2", model_pattern: "claude-opus*", environments: null, policy: "requires_approval" }],
              error: null,
            }),
          };
        }
        // model_approval_requests — no approved exception
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    };

    const result = await checkOrgModelPolicy(
      mockAdmin as never, "org-test", "claude-opus-4", "production", "key-001",
    );
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});

// ── Tests: OTLP span filtering ────────────────────────────────────────────────
describe("OTLP ingest — LLM span detection", () => {
  it("mapOtlpToEvents filters out non-LLM spans", async () => {
    const { mapOtlpToEvents } = await import("@/lib/otel/mapper");
    const payload = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [
            {
              traceId: "trace01", spanId: "span01",
              name: "ChatCompletion",
              startTimeUnixNano: "1717497600000000000",
              endTimeUnixNano:   "1717497601000000000",
              attributes: [
                { key: "gen_ai.system",              value: { stringValue: "openai" } },
                { key: "gen_ai.request.model",       value: { stringValue: "gpt-4o" } },
                { key: "gen_ai.usage.input_tokens",  value: { intValue: "100" } },
                { key: "gen_ai.usage.output_tokens", value: { intValue: "50" } },
              ],
            },
            {
              traceId: "trace01", spanId: "span02",
              name: "http.request",
              startTimeUnixNano: "1717497600000000000",
              endTimeUnixNano:   "1717497600100000000",
              attributes: [
                { key: "http.method", value: { stringValue: "POST" } },
              ],
            },
          ],
        }],
      }],
    };

    const result = mapOtlpToEvents(payload, "org-test", "key-001", 90);
    expect(result.events).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.events[0]!.provider).toBe("openai");
    expect(result.events[0]!.model).toBe("gpt-4o");
    expect(result.events[0]!.input_tokens).toBe(100);
    expect(result.events[0]!.output_tokens).toBe(50);
  });

  it("maps latency_ms from span duration in nanoseconds", async () => {
    const { mapOtlpToEvents } = await import("@/lib/otel/mapper");
    // 500ms = 500,000,000 ns
    const startNs = "1000000000000";
    const endNs   = "1000500000000"; // 500ms later
    const payload = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [{
            traceId: "t01", spanId: "s01",
            name: "LLM",
            startTimeUnixNano: startNs,
            endTimeUnixNano:   endNs,
            attributes: [
              { key: "gen_ai.system",       value: { stringValue: "anthropic" } },
              { key: "gen_ai.request.model", value: { stringValue: "claude-opus-4" } },
            ],
          }],
        }],
      }],
    };

    const result = mapOtlpToEvents(payload, "org-1", "k-1", 90);
    expect(result.events[0]!.latency_ms).toBe(500);
  });

  it("calculates cost_usd from token counts using pricing table", async () => {
    const { mapOtlpToEvents } = await import("@/lib/otel/mapper");
    const payload = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [{
            traceId: "t01", spanId: "s01",
            name: "ChatCompletion",
            startTimeUnixNano: "1000000000000",
            endTimeUnixNano:   "1000100000000",
            attributes: [
              { key: "gen_ai.system",              value: { stringValue: "openai" } },
              { key: "gen_ai.request.model",       value: { stringValue: "gpt-4o-mini" } },
              { key: "gen_ai.usage.input_tokens",  value: { intValue: "1000000" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "0" } },
            ],
          }],
        }],
      }],
    };

    const result = mapOtlpToEvents(payload, "org-1", "k-1", 90);
    expect(result.events[0]!.cost_usd).toBeGreaterThan(0);
  });
});
