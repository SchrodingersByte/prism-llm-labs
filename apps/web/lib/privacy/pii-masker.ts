/**
 * PII masking utility for request logs.
 *
 * Replaces sensitive patterns with [REDACTED:type] tokens before content
 * is stored in the request_logs table. Only runs when the org has
 * pii_masking_enabled = true.
 *
 * Patterns are applied in order; each replaces non-overlapping matches.
 * The credit_card pattern uses a Luhn-checksum guard to reduce false positives.
 */

export type { PiiPatternType } from "./pii-patterns";
export { DEFAULT_PATTERNS } from "./pii-patterns";
import { ALL_PATTERNS, type PiiPatternType } from "./pii-patterns";

/** Mask PII in a plain string. Returns the masked string. */
export function maskPii(
  text: string,
  enabledTypes: PiiPatternType[] = ALL_PATTERNS.map(p => p.type),
): string {
  let result = text;
  for (const { type, re, validate } of ALL_PATTERNS) {
    if (!enabledTypes.includes(type)) continue;
    re.lastIndex = 0;
    // Respect per-match validation (e.g. Aadhaar Verhoeff): leave unvalidated
    // matches untouched rather than redacting a false positive.
    result = result.replace(re, (m) => (validate && !validate(m)) ? m : `[REDACTED:${type}]`);
  }
  return result;
}

/**
 * Deep-walk a messages array (OpenAI chat format) and mask PII in all
 * string leaf values. Returns a new array — does not mutate the input.
 */
export function maskMessages(
  messages: unknown,
  enabledTypes: PiiPatternType[] = ALL_PATTERNS.map(p => p.type),
): unknown {
  if (typeof messages === "string") return maskPii(messages, enabledTypes);
  if (Array.isArray(messages))      return messages.map(m => maskMessages(m, enabledTypes));
  if (messages !== null && typeof messages === "object") {
    return Object.fromEntries(
      Object.entries(messages as Record<string, unknown>).map(
        ([k, v]) => [k, maskMessages(v, enabledTypes)],
      ),
    );
  }
  return messages;
}
