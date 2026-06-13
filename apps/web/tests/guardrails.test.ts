import { describe, it, expect } from "vitest";
import type { GuardrailRule, GuardrailProfile, GuardrailContext, ExternalChecker } from "@/lib/gateway/guardrails/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROFILES: GuardrailProfile[] = [
  { id: "p_all",     name: "All PII",   type: "builtin_pii" },
  { id: "p_ssn",     name: "SSN only",  type: "builtin_pii", pii_types: ["ssn"] },
  { id: "p_bedrock", name: "Bedrock",   type: "bedrock", config: {} },
];

const SSN_INPUT    = [{ role: "user",      content: "my ssn is 123-45-6789" }];
const EMAIL_INPUT  = [{ role: "user",      content: "ping me at jane@acme.com" }];
const CLEAN_INPUT  = [{ role: "user",      content: "what is the capital of France?" }];
const SSN_OUTPUT   = [{ role: "assistant", content: "your ssn 123-45-6789 is on file" }];

function ctx(direction: "input" | "output", requestOver: Record<string, unknown> = {}): GuardrailContext {
  return {
    direction,
    request: { model: "gpt-4o", provider: "openai", environment: "production", ...requestOver },
    org:     { plan: "startup" },
  };
}

function rule(over: Partial<GuardrailRule> = {}): GuardrailRule {
  return { id: "r1", priority: 1, is_active: true, apply_to: "input", action: "block", profile_id: "p_all", ...over };
}

const load = () => import("@/lib/gateway/guardrails/evaluator");

// ── Tests ───────────────────────────────────────────────────────────────────

describe("evaluateGuardrails()", () => {
  it("allows when there are no rules", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({ rules: [], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input") });
    expect(d.action).toBe("allow");
  });

  it("allows when the payload is clean (block rule, nothing detected)", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({ rules: [rule()], profiles: PROFILES, payload: CLEAN_INPUT, context: ctx("input") });
    expect(d.action).toBe("allow");
  });

  it("blocks input when a built-in PII rule matches", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({ rules: [rule()], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input") });
    expect(d.action).toBe("block");
    expect(d.detectedTypes).toContain("ssn");
    expect(d.matchedRuleId).toBe("r1");
    expect(d.matchedProfileId).toBe("p_all");
  });

  it("redacts input and returns a masked payload", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({
      rules: [rule({ action: "redact" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"),
    });
    expect(d.action).toBe("redact");
    const json = JSON.stringify(d.redactedPayload);
    expect(json).toContain("[REDACTED:ssn]");
    expect(json).not.toContain("123-45-6789");
  });

  it("warns without mutating the payload", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({
      rules: [rule({ action: "warn" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"),
    });
    expect(d.action).toBe("warn");
    expect(d.detectedTypes).toContain("ssn");
    expect(d.redactedPayload).toBeUndefined();
  });

  it("does not apply an output-only rule on the input side", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({
      rules: [rule({ apply_to: "output" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"),
    });
    expect(d.action).toBe("allow");
  });

  it("severity precedence: block dominates a higher-priority warn", async () => {
    const { evaluateGuardrails } = await load();
    const rules = [
      rule({ id: "rw", priority: 1, action: "warn" }),
      rule({ id: "rb", priority: 2, action: "block" }),
    ];
    const d = await evaluateGuardrails({ rules, profiles: PROFILES, payload: SSN_INPUT, context: ctx("input") });
    expect(d.action).toBe("block");
    expect(d.matchedRuleId).toBe("rb");
  });

  it("severity precedence: redact dominates warn", async () => {
    const { evaluateGuardrails } = await load();
    const rules = [
      rule({ id: "rw", priority: 1, action: "warn" }),
      rule({ id: "rr", priority: 2, action: "redact" }),
    ];
    const d = await evaluateGuardrails({ rules, profiles: PROFILES, payload: SSN_INPUT, context: ctx("input") });
    expect(d.action).toBe("redact");
  });

  it("predicate gates on request.model via the policy DSL", async () => {
    const { evaluateGuardrails } = await load();
    const r = rule({ condition: { field: "request.model", op: "eq", value: "gpt-4o" } });
    const hit  = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input", { model: "gpt-4o" }) });
    const miss = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input", { model: "gpt-5" }) });
    expect(hit.action).toBe("block");
    expect(miss.action).toBe("allow");
  });

  it("predicate can gate on direction (apply_to=both)", async () => {
    const { evaluateGuardrails } = await load();
    const r = rule({ apply_to: "both", condition: { field: "direction", op: "eq", value: "output" } });
    const onInput  = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: SSN_INPUT,  context: ctx("input") });
    const onOutput = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: SSN_OUTPUT, context: ctx("output") });
    expect(onInput.action).toBe("allow");
    expect(onOutput.action).toBe("block");
  });

  it("respects a profile's pii_types subset (SSN-only ignores email)", async () => {
    const { evaluateGuardrails } = await load();
    const r = rule({ profile_id: "p_ssn" });
    const email = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: EMAIL_INPUT, context: ctx("input") });
    const ssn   = await evaluateGuardrails({ rules: [r], profiles: PROFILES, payload: SSN_INPUT,   context: ctx("input") });
    expect(email.action).toBe("allow");
    expect(ssn.action).toBe("block");
  });

  it("sampling: rate 0 never fires, rate 1 always fires (injected rng)", async () => {
    const { evaluateGuardrails } = await load();
    const off = await evaluateGuardrails({ rules: [rule({ sampling_rate: 0 })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), rng: () => 0.5 });
    const on  = await evaluateGuardrails({ rules: [rule({ sampling_rate: 1 })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), rng: () => 0.5 });
    expect(off.action).toBe("allow");
    expect(on.action).toBe("block");
  });

  it("sampling: rate 0.5 fires below the draw, skips at/above it", async () => {
    const { evaluateGuardrails } = await load();
    const fires = await evaluateGuardrails({ rules: [rule({ sampling_rate: 0.5 })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), rng: () => 0.4 });
    const skips = await evaluateGuardrails({ rules: [rule({ sampling_rate: 0.5 })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), rng: () => 0.6 });
    expect(fires.action).toBe("block");
    expect(skips.action).toBe("allow");
  });

  it("skips external-profile rules when no externalCheck is injected", async () => {
    const { evaluateGuardrails } = await load();
    const d = await evaluateGuardrails({ rules: [rule({ profile_id: "p_bedrock" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input") });
    expect(d.action).toBe("allow");
  });

  it("invokes the injected externalCheck and blocks on a flag", async () => {
    const { evaluateGuardrails } = await load();
    const externalCheck: ExternalChecker = async () => ({ flagged: true, types: ["toxicity"] });
    const d = await evaluateGuardrails({ rules: [rule({ profile_id: "p_bedrock" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), externalCheck });
    expect(d.action).toBe("block");
    expect(d.detectedTypes).toContain("toxicity");
  });

  it("uses an external provider's redactedPayload on a redact rule", async () => {
    const { evaluateGuardrails } = await load();
    const externalCheck: ExternalChecker = async () => ({ flagged: true, types: ["hate"], redactedPayload: [{ role: "assistant", content: "***" }] });
    const d = await evaluateGuardrails({ rules: [rule({ profile_id: "p_bedrock", action: "redact", apply_to: "output" })], profiles: PROFILES, payload: SSN_OUTPUT, context: ctx("output"), externalCheck });
    expect(d.action).toBe("redact");
    expect(JSON.stringify(d.redactedPayload)).toContain("***");
  });

  it("fails open when an external check throws", async () => {
    const { evaluateGuardrails } = await load();
    const externalCheck: ExternalChecker = async () => { throw new Error("provider down"); };
    const d = await evaluateGuardrails({ rules: [rule({ profile_id: "p_bedrock" })], profiles: PROFILES, payload: SSN_INPUT, context: ctx("input"), externalCheck });
    expect(d.action).toBe("allow");
  });
});
