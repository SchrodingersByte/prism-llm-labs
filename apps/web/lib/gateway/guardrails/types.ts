/**
 * Guardrails type model.
 *
 * Mirrors the Supabase schema added in the guardrails migration:
 *   guardrail_profiles — reusable check configs (built-in PII or an external
 *                        safety provider) that rules reference.
 *   guardrail_rules    — bind a profile to an action + scope (input/output/both)
 *                        with an optional predicate (the policy-router DSL) and
 *                        a sampling rate.
 *
 * The predicate reuses ConditionNode from policy-router.ts — see evaluator.ts.
 */

import type { ConditionNode } from "@/lib/gateway/policy-router";
import type { PiiPatternType } from "@/lib/privacy/pii-patterns";

export type GuardrailDirection   = "input" | "output";
export type GuardrailApplyTo     = "input" | "output" | "both";
export type GuardrailActionType  = "warn" | "block" | "redact";
export type GuardrailProfileType  = "builtin_pii" | "bedrock" | "azure";

/** A custom regex pattern (matches the shape pii-detector.ts already accepts). */
export interface GuardrailCustomPattern {
  name:    string;
  pattern: string;
  enabled: boolean;
}

export interface GuardrailProfile {
  id:    string;
  name:  string;
  type:  GuardrailProfileType;
  /** builtin_pii: which PII types to enforce. Undefined ⇒ all built-in types. */
  pii_types?:       PiiPatternType[];
  /** builtin_pii: extra custom regex patterns (detect/warn/block; not redacted). */
  custom_patterns?: GuardrailCustomPattern[];
  /** External providers (bedrock/azure): opaque config resolved by the provider module. */
  config?:          Record<string, unknown>;
}

export interface GuardrailRule {
  id:         string;
  /** Lower = evaluated first. Severity still dominates priority (block > redact > warn). */
  priority:   number;
  is_active:  boolean;
  apply_to:   GuardrailApplyTo;
  action:     GuardrailActionType;
  profile_id: string;
  /** Optional predicate over GuardrailContext (policy-router DSL). Absent ⇒ always applies. */
  condition?:     ConditionNode | null;
  /** 0..1 — fraction of requests this rule evaluates. Default 1 (always). */
  sampling_rate?: number;
}

/**
 * Context a rule predicate is evaluated against. Resolved by dot-path
 * (evaluateCondition), e.g. { field: "request.model", op: "eq", value: "gpt-4o" }
 * or { field: "direction", op: "eq", value: "output" }.
 */
export interface GuardrailContext {
  direction: GuardrailDirection;
  request: {
    model:        string;
    provider:     string;
    environment:  string;
    tags?:        Record<string, string>;
  };
  org: { plan: string };
}

export type GuardrailDecisionAction = "allow" | "warn" | "block" | "redact";

export interface GuardrailDecision {
  action:            GuardrailDecisionAction;
  detectedTypes:     string[];
  matchedRuleId?:    string;
  matchedProfileId?: string;
  /** Present when action === "redact": a masked copy of the scanned payload. */
  redactedPayload?:  unknown[];
  reason?:           string;
}

/** Result of an external safety-provider check (Bedrock/Azure). */
export interface ExternalCheckResult {
  flagged:          boolean;
  types:            string[];
  redactedPayload?: unknown[];
}

/**
 * Injected at call time so the evaluator core stays free of HTTP/SDK deps.
 * Task 2.1.7 supplies the Bedrock implementation; absent ⇒ external-profile
 * rules are skipped.
 */
export type ExternalChecker = (
  profile:   GuardrailProfile,
  payload:   unknown[],
  direction: GuardrailDirection,
) => Promise<ExternalCheckResult>;
