/**
 * Unified content store (PRD-0).
 *
 * Single chokepoint that persists prompt/completion/retrieved-context/tool-IO
 * to the `request_logs` table for every capture path (gateway, sdk, otel).
 * Applies PII redaction, retention TTL, and per-project capture settings.
 *
 * Falls through silently on any error — content capture must NEVER block or
 * break the caller (mirrors the original request-logger contract).
 *
 * Design: docs/implementation/00-content-embedding-capture.impl.md
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { maskMessages, maskPii, type PiiPatternType } from "@/lib/privacy/pii-masker";
import { redis } from "@/lib/upstash/redis";
import type { CustomPattern } from "@/lib/privacy/pii-detector";
import type { Database, Json } from "@/lib/supabase/database.types";

// Lazy-init so Next.js can evaluate this module at build time without env vars.
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

// ── Org PII config ────────────────────────────────────────────────────────────
// Moved here from lib/gateway/request-logger.ts (re-exported there for callers
// that use it for pre-flight detection) so the gateway logger can delegate to
// writeContent() without a circular import.

const PII_CACHE_TTL = 60;

export interface OrgPiiConfig {
  masking_enabled:    boolean;
  mask_patterns:      PiiPatternType[];
  detection_enabled:  boolean;
  detection_action:   "warn" | "block";
  custom_patterns:    CustomPattern[] | null;
}

export async function getOrgPiiConfig(orgId: string): Promise<OrgPiiConfig> {
  const cacheKey = `pii_config:${orgId}`;
  try {
    const cached = await redis.get<OrgPiiConfig>(cacheKey);
    if (cached) return cached;
  } catch { /* Redis unavailable — fall through to DB */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (getSupabase() as any)
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
    return { masking_enabled: false, mask_patterns: [], detection_enabled: false, detection_action: "warn", custom_patterns: null };
  }
}

// ── Capture settings ──────────────────────────────────────────────────────────

export type CaptureLevel = "off" | "metadata_only" | "redacted_content" | "full_content";

export interface CaptureSettings {
  level:            CaptureLevel;
  payload_ttl_days: number;
  embed_enabled:    boolean;
}

const SETTINGS_CACHE_TTL = 60;

/**
 * Resolve the effective capture settings for an (org, project): a project-scoped
 * row wins over the org-default (project_id = null). When no row exists, fall back
 * to the legacy per-key `prompt_logging_enabled` flag — preserving the gateway's
 * prior behaviour (mask when org PII masking is on with patterns, else store raw).
 */
export async function resolveCaptureSettings(
  orgId:     string,
  projectId: string | null,
  opts?:     { promptLoggingEnabled?: boolean },
): Promise<CaptureSettings> {
  const cacheKey = `ccs:${orgId}:${projectId ?? "_"}:${opts?.promptLoggingEnabled ? 1 : 0}`;
  try {
    const cached = await redis.get<CaptureSettings>(cacheKey);
    if (cached) return cached;
  } catch { /* fall through */ }

  let settings: CaptureSettings | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (getSupabase() as any)
      .from("content_capture_settings")
      .select("project_id, level, payload_ttl_days, embed_enabled")
      .eq("org_id", orgId);

    const rows = (data ?? []) as Array<{ project_id: string | null; level: CaptureLevel; payload_ttl_days: number; embed_enabled: boolean }>;
    const row  = rows.find(r => r.project_id === projectId) ?? rows.find(r => r.project_id === null);
    if (row) settings = { level: row.level, payload_ttl_days: row.payload_ttl_days, embed_enabled: row.embed_enabled };
  } catch { /* table may not exist yet — fall through to back-compat */ }

  if (!settings) {
    let level: CaptureLevel = "off";
    if (opts?.promptLoggingEnabled) {
      const pii = await getOrgPiiConfig(orgId);
      level = (pii.masking_enabled && pii.mask_patterns.length > 0) ? "redacted_content" : "full_content";
    }
    settings = { level, payload_ttl_days: 30, embed_enabled: false };
  }

  try { await redis.set(cacheKey, settings, { ex: SETTINGS_CACHE_TTL }); } catch { /* ignore */ }
  return settings;
}

// ── Content writer ────────────────────────────────────────────────────────────

export interface ContentEntry {
  orgId:        string;
  source:       "gateway" | "sdk" | "otel";
  apiKeyId?:    string | null;
  projectId?:   string | null;
  eventId?:     string | null;
  model:        string;
  provider:     string;
  prompt?:      unknown;          // messages array or string
  completion?:  string | null;
  context?:     unknown;          // retrieved RAG docs/chunks
  toolIo?:      unknown;          // tool call inputs/outputs
  inputTokens?: number;
  outputTokens?: number;
  costUsd?:     number;
  latencyMs?:   number;
  statusCode?:  number;
  sessionId?:   string;
  gitBranch?:   string;
  gitAuthor?:   string;
  keyType?:     string;
  routedFrom?:  string;
  traceId?:     string;
  spanId?:      string;
  /** SDK already redacted client-side — store as-is, mark redacted. */
  preRedacted?: boolean;
  /** Legacy opt-in hint when no content_capture_settings row exists. */
  promptLoggingEnabled?: boolean;
}

function countRedactions(...parts: unknown[]): number {
  let n = 0;
  for (const p of parts) {
    if (p == null) continue;
    const s = typeof p === "string" ? p : JSON.stringify(p);
    n += (s.match(/\[REDACTED:/g) ?? []).length;
  }
  return n;
}

/**
 * Persist captured content for one event. No-op when the resolved capture level
 * is `off` or `metadata_only`. Redacts inline for `redacted_content`.
 */
export async function writeContent(entry: ContentEntry, settings?: CaptureSettings): Promise<void> {
  try {
    const s = settings ?? await resolveCaptureSettings(
      entry.orgId,
      entry.projectId ?? null,
      { promptLoggingEnabled: entry.promptLoggingEnabled },
    );
    if (s.level === "off" || s.level === "metadata_only") return;

    let prompt:     unknown        = entry.prompt     ?? null;
    let completion: string | null  = entry.completion ?? null;
    let context:    unknown        = entry.context    ?? null;
    let toolIo:     unknown        = entry.toolIo     ?? null;
    let redactionLevel: "none" | "redacted" = "none";
    let piiFound = 0;

    if (s.level === "redacted_content" && !entry.preRedacted) {
      const pii      = await getOrgPiiConfig(entry.orgId);
      const patterns = pii.mask_patterns.length > 0 ? pii.mask_patterns : undefined; // undefined → mask all
      if (prompt     != null) prompt     = maskMessages(prompt, patterns);
      if (completion != null) completion = maskPii(completion, patterns);
      if (context    != null) context    = maskMessages(context, patterns);
      if (toolIo     != null) toolIo     = maskMessages(toolIo, patterns);
      redactionLevel = "redacted";
      piiFound       = countRedactions(prompt, completion, context, toolIo);
    } else if (entry.preRedacted) {
      redactionLevel = "redacted";
    }

    const expiresAt = new Date(Date.now() + s.payload_ttl_days * 86_400_000).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (getSupabase() as any).from("request_logs").insert({
      org_id:          entry.orgId,
      api_key_id:      entry.apiKeyId ?? null,
      project_id:      entry.projectId || null,
      model:           entry.model,
      provider:        entry.provider,
      prompt:          prompt as Json | null,
      completion,
      context:         context as Json | null,
      tool_io:         toolIo as Json | null,
      input_tokens:    entry.inputTokens  ?? null,
      output_tokens:   entry.outputTokens ?? null,
      cost_usd:        entry.costUsd       ?? null,
      latency_ms:      entry.latencyMs     ?? null,
      status_code:     entry.statusCode    ?? null,
      session_id:      entry.sessionId  || null,
      git_branch:      entry.gitBranch  || null,
      git_author:      entry.gitAuthor  || null,
      key_type:        entry.keyType    ?? null,
      routed_from:     entry.routedFrom || null,
      trace_id:        entry.traceId    || null,
      span_id:         entry.spanId     || null,
      source:          entry.source,
      event_id:        entry.eventId    || null,
      redaction_level: redactionLevel,
      pii_found:       piiFound,
      expires_at:      expiresAt,
    });
  } catch { /* silent — content capture must never break the caller */ }
}
