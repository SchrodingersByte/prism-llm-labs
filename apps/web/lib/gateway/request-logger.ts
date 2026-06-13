/**
 * Opt-in request/response logger.
 * Writes to the request_logs Supabase table when prompt_logging_enabled = true
 * on the API key. Falls through silently on any error â€” never blocks the caller.
 *
 * When the org has pii_masking_enabled = true, prompt/completion content is
 * redacted via the PII masker before storage.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { maskMessages, maskPii, type PiiPatternType } from "@/lib/privacy/pii-masker";
import { redis } from "@/lib/upstash/redis";
import type { CustomPattern } from "@/lib/privacy/pii-detector";
import type { Database, Json } from "@/lib/supabase/database.types";

// Lazy-init: don't create the client at module load time so Next.js can
// evaluate this module during build even when env vars are not set.
let _supabase: SupabaseClient<Database> | null = null;
function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

// Cache PII config for 60 s per org to avoid a DB round-trip on every log write
const PII_CACHE_TTL = 60;

export interface OrgPiiConfig {
  // Masking (post-request, applied to stored logs)
  masking_enabled:    boolean;
  mask_patterns:      PiiPatternType[];
  // Detection (pre-flight, applied before proxying)
  detection_enabled:  boolean;
  detection_action:   "warn" | "block";
  custom_patterns:    CustomPattern[] | null;
}

export async function getOrgPiiConfig(orgId: string): Promise<OrgPiiConfig> {
  const cacheKey = `pii_config:${orgId}`;
  try {
    const cached = await redis.get<OrgPiiConfig>(cacheKey);
    if (cached) return cached;
  } catch { /* Redis unavailable â€” fall through to DB */ }

  try {
    const { data } = await getSupabase()
      .from("organizations")
      .select("pii_masking_enabled, pii_mask_patterns, pii_detection_enabled, pii_detection_action, pii_custom_patterns")
      .eq("id", orgId)
      .maybeSingle();

    type OrgData = {
      pii_masking_enabled?:   boolean;
      pii_mask_patterns?:     PiiPatternType[];
      pii_detection_enabled?: boolean;
      pii_detection_action?:  string;
      pii_custom_patterns?:   CustomPattern[] | null;
    } | null;

    const d = data as OrgData;
    const config: OrgPiiConfig = {
      masking_enabled:   d?.pii_masking_enabled   ?? false,
      mask_patterns:     (d?.pii_mask_patterns    ?? []) as PiiPatternType[],
      detection_enabled: d?.pii_detection_enabled ?? false,
      detection_action:  (d?.pii_detection_action ?? "warn") as "warn" | "block",
      custom_patterns:   d?.pii_custom_patterns   ?? null,
    };

    await redis.set(cacheKey, config, { ex: PII_CACHE_TTL }).catch(() => {});
    return config;
  } catch {
    return {
      masking_enabled:   false,
      mask_patterns:     [],
      detection_enabled: false,
      detection_action:  "warn",
      custom_patterns:   null,
    };
  }
}

export interface RequestLogEntry {
  orgId:        string;
  apiKeyId:     string;
  projectId:    string;
  model:        string;
  provider:     string;
  prompt:       unknown[] | null;    // messages array or null
  completion:   string | null;
  inputTokens:  number;
  outputTokens: number;
  costUsd:      number;
  latencyMs:    number;
  statusCode:   number;
  sessionId:    string;
  gitBranch:    string;
  gitAuthor:    string;
  keyType:      string;
  routedFrom:   string;
  traceId?:     string;
  spanId?:      string;
}

export async function writeRequestLog(entry: RequestLogEntry): Promise<void> {
  try {
    let prompt     = entry.prompt;
    let completion = entry.completion;

    // Apply PII masking if enabled for this org
    const piiConfig = await getOrgPiiConfig(entry.orgId);
    if (piiConfig.masking_enabled && piiConfig.mask_patterns.length > 0) {
      if (prompt)     prompt     = maskMessages(prompt, piiConfig.mask_patterns) as unknown[];
      if (completion) completion = maskPii(completion, piiConfig.mask_patterns);
    }

    await getSupabase().from("request_logs" as any).insert({
      org_id:        entry.orgId,
      api_key_id:    entry.apiKeyId,
      project_id:    entry.projectId || null,
      model:         entry.model,
      provider:      entry.provider,
      prompt: prompt as Json | null,
      completion,
      input_tokens:  entry.inputTokens,
      output_tokens: entry.outputTokens,
      cost_usd:      entry.costUsd,
      latency_ms:    entry.latencyMs,
      status_code:   entry.statusCode,
      session_id:    entry.sessionId || null,
      git_branch:    entry.gitBranch || null,
      git_author:    entry.gitAuthor || null,
      key_type:      entry.keyType,
      routed_from:   entry.routedFrom || null,
      trace_id:      entry.traceId  || null,
      span_id:       entry.spanId   || null,
    });
  } catch { /* silent â€” logging must never break the gateway */ }
}
