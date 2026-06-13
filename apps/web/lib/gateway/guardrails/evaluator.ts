/**
 * Guardrails evaluator — pure, deterministic decision core.
 *
 * Given rules + profiles and a payload (request messages on the input side, or
 * the assistant output wrapped in an array on the output side), decides whether
 * to allow / warn / redact / block. This module adds orchestration only — it
 * reuses existing primitives rather than reimplementing detection:
 *
 *   evaluateCondition (policy-router.ts) → rule predicate DSL (AND/OR/NOT + 8 ops)
 *   detectPII         (pii-detector.ts)  → built-in PII detection
 *   maskMessages      (pii-masker.ts)    → redaction
 *
 * External safety providers (Bedrock/Azure) are invoked via an injected
 * `externalCheck` callback so this core has no HTTP/SDK deps and is fully
 * unit-testable. When the callback is absent, external-profile rules are skipped.
 *
 * Severity precedence: block > redact > warn > allow (dominates rule priority).
 * Fails open: any internal error yields { action: "allow" }.
 *
 * Known v1 limitation: redaction masks built-in PII types only (maskMessages
 * does not apply custom regex patterns). Custom patterns can still warn/block.
 */

import { evaluateCondition, type ConditionNode, type PolicyContext } from "@/lib/gateway/policy-router";
import { detectPII } from "@/lib/privacy/pii-detector";
import { maskMessages } from "@/lib/privacy/pii-masker";
import { DEFAULT_PATTERNS, type PiiPatternType } from "@/lib/privacy/pii-patterns";
import type {
  GuardrailRule, GuardrailProfile, GuardrailContext, GuardrailDecision, ExternalChecker,
} from "./types";

export interface EvaluateGuardrailsArgs {
  rules:          GuardrailRule[];
  profiles:       GuardrailProfile[];
  /** Array to scan/redact: request messages (input) or [assistantText] (output). */
  payload:        unknown[];
  context:        GuardrailContext;
  externalCheck?: ExternalChecker;
  /** Injectable for deterministic sampling in tests. Default Math.random. */
  rng?:           () => number;
}

const BUILTIN_TYPES = new Set<string>(DEFAULT_PATTERNS as string[]);

export async function evaluateGuardrails(args: EvaluateGuardrailsArgs): Promise<GuardrailDecision> {
  const { rules, profiles, payload, context, externalCheck } = args;
  const rng = args.rng ?? Math.random;

  try {
    const profileById = new Map(profiles.map(p => [p.id, p]));

    const applicable = rules
      .filter(r => r.is_active)
      .filter(r => r.apply_to === "both" || r.apply_to === context.direction)
      .sort((a, b) => a.priority - b.priority);

    // The predicate DSL resolves dot-paths structurally; a guardrail context is
    // shaped to satisfy those paths. `direction` is added for predicates like
    // { field: "direction", op: "eq", value: "output" }.
    const policyCtx = {
      direction: context.direction,
      request:   { ...context.request, tags: context.request.tags ?? {} },
      provider:  { health: {} },
      org:       context.org,
    } as unknown as PolicyContext;

    const redactTypes = new Set<string>();
    const warnTypes   = new Set<string>();
    let   workingPayload: unknown[] = payload;

    for (const rule of applicable) {
      // Sampling — skip when the draw exceeds the configured rate.
      const rate = rule.sampling_rate ?? 1;
      if (rate < 1 && rng() >= rate) continue;

      // Predicate gate (request metadata, not content).
      if (rule.condition && !evaluateCondition(rule.condition as ConditionNode, policyCtx)) continue;

      const profile = profileById.get(rule.profile_id);
      if (!profile) continue;

      let flagged = false;
      let types:  string[] = [];

      if (profile.type === "builtin_pii") {
        const enabledSet = new Set<string>([
          ...(profile.pii_types ?? (DEFAULT_PATTERNS as PiiPatternType[])),
          ...(profile.custom_patterns ?? []).filter(c => c.enabled).map(c => c.name),
        ]);
        const det = detectPII(workingPayload, profile.custom_patterns, { earlyExit: false });
        types   = det.detectedTypes.filter(t => enabledSet.has(t));
        flagged = types.length > 0;
      } else {
        // External provider (bedrock/azure) — skipped unless a checker is injected.
        if (!externalCheck) continue;
        const res = await externalCheck(profile, workingPayload, context.direction);
        flagged = res.flagged;
        types   = res.types;
        if (res.redactedPayload) workingPayload = res.redactedPayload;
      }

      if (!flagged) continue;

      if (rule.action === "block") {
        return {
          action:           "block",
          matchedRuleId:    rule.id,
          matchedProfileId: profile.id,
          detectedTypes:    types,
          reason:           `Blocked by guardrail (${profile.type}): ${types.join(", ") || "policy match"}`,
        };
      }
      if (rule.action === "redact") {
        types.forEach(t => redactTypes.add(t));
      } else {
        types.forEach(t => warnTypes.add(t));
      }
    }

    if (redactTypes.size > 0) {
      const redactList   = Array.from(redactTypes);
      const builtinToMask = redactList.filter((t): t is PiiPatternType => BUILTIN_TYPES.has(t));
      const masked = builtinToMask.length
        ? (maskMessages(workingPayload, builtinToMask) as unknown[])
        : workingPayload;
      return {
        action:          "redact",
        detectedTypes:   redactList,
        redactedPayload: masked,
        reason:          `Redacted: ${redactList.join(", ")}`,
      };
    }

    if (warnTypes.size > 0) {
      const warnList = Array.from(warnTypes);
      return { action: "warn", detectedTypes: warnList, reason: `Flagged: ${warnList.join(", ")}` };
    }

    return { action: "allow", detectedTypes: [] };
  } catch {
    return { action: "allow", detectedTypes: [] };  // fail-open — never block the hot path on a bug
  }
}
