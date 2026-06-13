/**
 * PII pre-flight detector.
 *
 * Pure detection â€” no mutation, no side effects.
 * Called at the gateway before proxying to the LLM provider.
 *
 * detectPII() walks the full message tree (all roles including system and
 * tool calls) and returns a description of what was found without modifying
 * the input. recordPIIIncident() logs the finding fire-and-forget.
 */
import { ALL_PATTERNS, type PiiPatternType } from "./pii-patterns";
import { createClient } from "@supabase/supabase-js";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CustomPattern {
  name:    string;
  pattern: string; // raw regex string
  enabled: boolean;
}

export interface PIIMatch {
  type:      string;
  fieldPath: string;
  count:     number;
}

export interface PIIDetectionResult {
  detected:      boolean;
  matches:       PIIMatch[];
  detectedTypes: string[]; // deduplicated
}

// â”€â”€ Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type CompiledPattern = { type: string; re: RegExp; validate?: (match: string) => boolean };

function buildPatterns(customPatterns?: CustomPattern[]): CompiledPattern[] {
  const base: CompiledPattern[] = ALL_PATTERNS.map(p => ({ type: p.type as string, re: p.re, validate: p.validate }));
  if (!customPatterns) return base;

  const custom = customPatterns
    .filter(p => p.enabled && p.pattern)
    .map(p => {
      try {
        return { type: p.name, re: new RegExp(p.pattern, "g") };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CompiledPattern[];

  return [...base, ...custom];
}

function scanString(
  text:     string,
  path:     string,
  patterns: CompiledPattern[],
  results:  Map<string, PIIMatch>,
): void {
  for (const { type, re, validate } of patterns) {
    re.lastIndex = 0;
    const found = text.match(re);
    if (!found) continue;
    // Apply optional per-match validation (e.g. Aadhaar Verhoeff) to drop FPs.
    const matches = validate ? found.filter(validate) : found;
    if (matches.length > 0) {
      const key = `${type}::${path}`;
      const existing = results.get(key);
      if (existing) {
        existing.count += matches.length;
      } else {
        results.set(key, { type, fieldPath: path, count: matches.length });
      }
    }
  }
}

function walkNode(
  node:     unknown,
  path:     string,
  patterns: CompiledPattern[],
  results:  Map<string, PIIMatch>,
): void {
  if (typeof node === "string") {
    scanString(node, path, patterns, results);
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => walkNode(item, `${path}[${i}]`, patterns, results));
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkNode(v, path ? `${path}.${k}` : k, patterns, results);
    }
  }
}

/**
 * Scan a messages array for PII. Pure function â€” does not mutate input.
 * Walks all roles (system, user, assistant) and tool call arguments.
 *
 * @param opts.earlyExit  Default true. Stop scanning after the first message
 *   that contains PII â€” significantly reduces cost on long multi-turn histories
 *   in "block" mode where detection is binary (found / not found).
 *   Pass false to collect the full match list across all messages.
 */
export function detectPII(
  messages:        unknown[],
  customPatterns?: CustomPattern[],
  opts?:           { earlyExit?: boolean },
): PIIDetectionResult {
  const patterns  = buildPatterns(customPatterns);
  const results   = new Map<string, PIIMatch>();
  const earlyExit = opts?.earlyExit ?? true;

  for (let i = 0; i < messages.length; i++) {
    walkNode(messages[i], `messages[${i}]`, patterns, results);
    // Short-circuit: once we have any match we have enough information to block
    // or warn â€” no need to scan the rest of the conversation history.
    if (earlyExit && results.size > 0) break;
  }

  const matches       = Array.from(results.values());
  const detectedTypes = Array.from(new Set(matches.map(m => m.type)));

  return {
    detected:      matches.length > 0,
    matches,
    detectedTypes,
  };
}

// â”€â”€ Incident recorder (fire-and-forget) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface RecordPIIIncidentParams {
  orgId:      string;
  apiKeyId:   string;
  userId?:    string;
  provider:   string;
  model:      string;
  result:     PIIDetectionResult;
  action:     "warn" | "block";
}

/**
 * Insert a PII incident row â€” fire-and-forget.
 * Never throws; never blocks the gateway hot path.
 */
export function recordPIIIncident(params: RecordPIIIncidentParams): void {
  const { orgId, apiKeyId, userId, provider, model, result, action } = params;

  getAdmin()
    .from("pii_incidents" as any)
    .insert({
      org_id:       orgId,
      api_key_id:   apiKeyId || null,
      user_id:      userId   || null,
      provider,
      model,
      pii_types:    result.detectedTypes,
      action_taken: action,
      field_paths:  result.matches.map(m => m.fieldPath),
    })
    .then(() => {}, () => {});
}
