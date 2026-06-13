import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { decryptKey } from "@/lib/crypto/keys";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { dispatchEvent } from "@/lib/export/dispatcher";
import { incrementSpend, incrementKeySpend, incrementKeyDailySpend, checkKeyCaps, checkAllKeyCaps, incrementAllCapCounters, trackSpendVelocity } from "@/lib/upstash/redis";
import { ingestRatelimit } from "@/lib/upstash/ratelimit";
import { planToTtlDays, calculateCost, normalizeModelName } from "@/lib/pricing/table";
import { getProviderConfig, buildUpstreamUrl, type GatewayProvider } from "@/lib/gateway/upstream";
import { extractUsage, newUsageSummary, type UsageSummary } from "@/lib/gateway/stream-parser";
import { getFallbackCandidates, type FallbackCandidate } from "@/lib/gateway/routing";
import { normalizeRequest, normalizeResponse, canRouteCrossProvider, extractTraceHeaders, injectTraceHeaders, type OAIRequest, type GatewayTraceContext } from "@/lib/gateway/normalizer";
import { recordLatency, recordError, rankCandidates, getHealthSnapshot } from "@/lib/gateway/provider-health";
import { getGatewaySoftCapStatus } from "@/lib/gateway/budget";
import { checkDataResidency, type ResidencyPolicy, type DataRegion } from "@/lib/gateway/data-residency";
import { checkOrgModelPolicy } from "@/lib/gateway/model-policy";
import { v4 as uuidv4 } from "uuid";
import { writeRequestLog, getOrgPiiConfig } from "@/lib/gateway/request-logger";
import { detectPII, recordPIIIncident } from "@/lib/privacy/pii-detector";
import { getOrgCacheConfig, buildCacheKey, getCached, setCached, type CachedEntry } from "@/lib/gateway/cache";
import { semanticCacheGet, semanticCacheSet } from "@/lib/gateway/semantic-cache";
import { getCustomerQuotaProfile } from "@/lib/gateway/customer-quota";
import { resolveTeamId } from "@/lib/gateway/team-resolver";
import { getActiveModelSubstitution } from "@/lib/engine/actions";
import { upsertTraceRollup } from "@/lib/gateway/trace-writer";
import { checkCustomerQuota, incrementCustomerSpend } from "@/lib/upstash/redis";
import { recordGatewayError, resetCircuitBreaker } from "@/lib/upstash/circuit-breaker";
import { autoPauseKey } from "@/lib/gateway/auto-pause";
import { logGatewayRejection } from "@/lib/gateway/enforcement-log";
import { bedrockFetch, parseBedrockCredentials, type BedrockCredentials } from "@/lib/gateway/bedrock";
import { evaluatePolicies, type PolicyContext } from "@/lib/gateway/policy-router";
import { loadOrgGuardrails } from "@/lib/gateway/guardrails/store";
import { evaluateGuardrails } from "@/lib/gateway/guardrails/evaluator";
import type { GuardrailContext } from "@/lib/gateway/guardrails/types";

export const runtime = "nodejs";

const VALID_PROVIDERS = [
  "openai", "anthropic", "google", "ollama", "openai_compatible", "azure_openai",
  "groq", "xai", "fireworks", "together", "perplexity",
  "mistral", "cerebras", "nebius", "cohere",
  "bedrock",
] as const;
type AnyGatewayProvider = typeof VALID_PROVIDERS[number];

// ── P1-A: Extract runtime feature tags from x-prism-* headers ─────────────────

function extractRuntimeTags(headers: Headers): Record<string, string> {
  const tags: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "x-prism-tags") {
      try { Object.assign(tags, JSON.parse(value)); } catch { /* ignore */ }
    } else if (lower.startsWith("x-prism-") &&
               lower !== "x-prism-key" &&
               lower !== "x-prism-branch" &&
               lower !== "x-prism-commit" &&
               lower !== "x-prism-soft-cap-model" &&
               lower !== "x-prism-soft-cap-pct" &&
               lower !== "x-prism-customer-id" &&
               lower !== "x-prism-team-id") {
      // Strip "x-prism-" and normalize the remaining hyphens to underscores so
      // header `x-prism-session-id` becomes tag `session_id` (what every consumer
      // reads), not `session-id`. Same for cost-center, etc.
      tags[lower.slice(8).replace(/-/g, "_")] = value;
    }
  });
  return tags;
}

async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path?: string[] } },
) {
  const provider = params.provider as AnyGatewayProvider;
  if (!(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  // ── Authenticate via Prism API key ───────────────────────────────────────
  const authHeader = req.headers.get("x-prism-key") ?? req.headers.get("authorization") ?? "";
  const prismKey   = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!prismKey) {
    const rej = NextResponse.json({ error: "Missing Prism API key (x-prism-key header)" }, { status: 401 });
    void logGatewayRejection({ orgId: "", apiKeyId: "", provider, model: "", environment: "production", layer: "auth", rejectionCode: "missing_key", httpStatus: 401, reason: "Missing x-prism-key header", traceId: "" });
    return rej;
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const keyHash = createHash("sha256").update(prismKey).digest("hex");
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    // NOTE: user_id / assigned_user_id / provider_key_id / cost_hard_cap_usd /
    // daily_cost_cap_usd / usage_buffer_pct were dropped from api_keys when caps
    // moved to key_caps and provider-linking to key_provider_links. The code
    // below already reads them defensively (optional casts + those tables as the
    // primary source), but listing them here made PostgREST 400 the whole auth
    // query — silently failing every gateway request. Select only live columns.
    .select("id, org_id, project_id, is_active, expires_at, auto_paused_at, auto_pause_reason, prompt_logging_enabled, organizations(plan, data_residency_policy, gateway_mode)")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    const rej = NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
    void logGatewayRejection({ orgId: "", apiKeyId: "", provider, model: "", environment: "production", layer: "auth", rejectionCode: "invalid_key", httpStatus: 401, reason: "Invalid or inactive API key", traceId: "" });
    return rej;
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    const rej = NextResponse.json({ error: "API key has expired" }, { status: 401 });
    void logGatewayRejection({ orgId: (keyRow as { org_id: string }).org_id ?? "", apiKeyId: (keyRow as { id: string }).id ?? "", provider, model: "", environment: "production", layer: "auth", rejectionCode: "key_expired", httpStatus: 401, reason: "API key has expired", traceId: "" });
    return rej;
  }

  // ── Auto-pause check ─────────────────────────────────────────────────────
  // Triggered when a hard spend cap is exceeded; cleared by admin PATCH action.
  if ((keyRow as { auto_paused_at?: string | null }).auto_paused_at) {
    const autoRej = NextResponse.json(
      {
        error:        "key_auto_paused",
        reason:       (keyRow as { auto_pause_reason?: string | null }).auto_pause_reason ?? "hard_cap_exceeded",
        paused_since: (keyRow as { auto_paused_at: string }).auto_paused_at,
        message:      "This API key has been automatically paused due to a hard budget cap being exceeded. Contact your workspace admin to unblock it.",
      },
      { status: 403 },
    );
    void logGatewayRejection({ orgId: (keyRow as { org_id: string }).org_id ?? "", apiKeyId: (keyRow as { id: string }).id ?? "", provider, model: "", environment: "production", layer: "auth", rejectionCode: "key_auto_paused", httpStatus: 403, reason: "Key auto-paused: hard cap exceeded", traceId: "" });
    return autoRej;
  }

  // ── Branch tracking enforcement ──────────────────────────────────────────
  const branchTag = req.headers.get("x-prism-branch") ?? "";
  const commitTag = req.headers.get("x-prism-commit") ?? "";

  // ── Distributed trace context ─────────────────────────────────────────────
  // Extract incoming trace headers (from SDK or upstream caller) and create
  // a gateway-level span. The span_id is fresh for this hop; trace_id is
  // propagated unchanged so the full call hierarchy is queryable in Tinybird.
  const incomingTrace = extractTraceHeaders(req.headers);
  const gatewaySpanId = crypto.randomUUID().replace(/-/g, "");
  const traceCtx: GatewayTraceContext = {
    traceId:      incomingTrace?.traceId ?? crypto.randomUUID().replace(/-/g, ""),
    spanId:       gatewaySpanId,
    parentSpanId: incomingTrace?.spanId ?? "",
  };

  // Environment for cap scoping — defaults to "production"
  const gatewayEnvironment = (
    req.headers.get("x-prism-environment") ?? "production"
  ).toLowerCase() as "production" | "staging" | "development";

  // ── Batch 1: parallel post-auth lookups ─────────────────────────────────
  // These four queries are all independent of each other — only the api_keys
  // auth result above is a prerequisite. Running them in parallel eliminates
  // 3 sequential Supabase + 1 Upstash round-trips from the critical path.
  const apiKeyId  = (keyRow as { id: string }).id;
  const earlyOrgId = (keyRow as { org_id: string }).org_id;

  type CapsRow = { id: string; period: string; is_rolling: boolean; amount_usd: number; environment: string | null };
  const [
    rateLimitResult,
    capsQueryResult,
    linksQueryResult,
    projectRepoResult,
  ] = await Promise.all([
    // Layer 3: rate limit
    ingestRatelimit.limit(keyHash),
    // Layer 4a: key_caps rows (needed by checkAllKeyCaps)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabaseAdmin as any)
      .from("key_caps")
      .select("id, period, is_rolling, amount_usd, environment")
      .eq("api_key_id", apiKeyId) as Promise<{ data: CapsRow[] | null }>,
    // Resolve provider key (was sequential after cap check — run in parallel)
    supabaseAdmin
      .from("key_provider_links")
      .select("provider_key_id")
      .eq("api_key_id", apiKeyId),
    // Layer 2: branch tracking (conditional — skip if no project)
    (keyRow as { project_id?: string | null }).project_id
      ? supabaseAdmin
          .from("project_github_repos" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", (keyRow as { project_id: string }).project_id)
      : Promise.resolve({ count: 0 }),
  ]);

  // Check results in enforcement priority order.

  // Layer 2: branch tracking
  if ((projectRepoResult.count ?? 0) > 0 && !branchTag) {
    const rej = NextResponse.json({
      error:   "branch_tracking_required",
      message: "This project has a connected GitHub repo. Pass X-Prism-Branch header.",
    }, { status: 422 });
    void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "auth", rejectionCode: "branch_tracking_required", httpStatus: 422, reason: "Branch tracking required", traceId: traceCtx.traceId });
    return rej;
  }

  // Layer 3: rate limit
  const { success, limit, remaining } = rateLimitResult;
  if (!success) {
    const rej = new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Retry-After": "60", "Content-Type": "application/json" },
    });
    void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "rate_limit", rejectionCode: "rate_limit_exceeded", httpStatus: 429, reason: "Rate limit exceeded", traceId: traceCtx.traceId });
    return rej;
  }

  // Layer 4: key-level spend caps
  // Checks all caps in the key_caps table (new multi-cap system).
  // Falls back to legacy cost_hard_cap_usd / daily_cost_cap_usd if no key_caps rows.
  const activeCaps = (capsQueryResult as { data: CapsRow[] | null }).data ?? [];

  if (activeCaps.length > 0) {
    try {
      const capResult = await checkAllKeyCaps(apiKeyId, activeCaps, gatewayEnvironment, earlyOrgId);
      if (capResult === "circuit_open") {
        const rej = new NextResponse(JSON.stringify({ error: "circuit_open", message: "Upstream provider is experiencing errors. Retry after 5 minutes." }), {
          status: 503,
          headers: { "Retry-After": "300", "Content-Type": "application/json" },
        });
        void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "circuit_breaker", rejectionCode: "circuit_open", httpStatus: 503, reason: "Circuit breaker open", traceId: traceCtx.traceId });
        return rej;
      }
      if (capResult !== "ok") {
        // Auto-pause: lock the key so subsequent requests get fast 403 without
        // re-evaluating caps. Idempotent and fire-and-forget — never blocks the response.
        void autoPauseKey(supabaseAdmin, apiKeyId, "hard_cap_exceeded");
        const rej = NextResponse.json({ error: "key_budget_exceeded", cap_id: capResult.split(":")[1] }, { status: 402 });
        void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "spend_cap", rejectionCode: "key_budget_exceeded", httpStatus: 402, reason: `Cap exceeded: ${capResult}`, traceId: traceCtx.traceId });
        return rej;
      }
    } catch {
      console.warn("[gateway] cap check failed — Redis may not be configured");
    }
  } else {
    // Legacy fallback: check old columns if key_caps table is empty
    const hardCap  = (keyRow as { cost_hard_cap_usd?: number | null }).cost_hard_cap_usd  ?? null;
    const dailyCap = (keyRow as { daily_cost_cap_usd?: number | null }).daily_cost_cap_usd ?? null;
    const bufferPct= (keyRow as { usage_buffer_pct?: number | null }).usage_buffer_pct     ?? 0;
    if (hardCap !== null || dailyCap !== null) {
      try {
        const capStatus = await checkKeyCaps(apiKeyId, 0, hardCap, dailyCap, bufferPct);
        if (capStatus !== "ok") {
          const rej = NextResponse.json({ error: "key_budget_exceeded" }, { status: 402 });
          void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "spend_cap", rejectionCode: "key_budget_exceeded_legacy", httpStatus: 402, reason: "Legacy cap exceeded", traceId: traceCtx.traceId });
          return rej;
        }
      } catch {
        console.warn("[gateway] legacy cap check failed");
      }
    }
  }

  // ── Resolve provider key ─────────────────────────────────────────────────
  // Fetch all provider key IDs explicitly linked to this Prism key via the
  // junction table.  This is checked before org-wide fallback so each key
  // can route to exactly the provider keys it was configured with.
  const linkedProviderKeyIds: string[] = ((linksQueryResult as { data: { provider_key_id: string }[] | null }).data ?? []).map(
    (l: { provider_key_id: string }) => l.provider_key_id,
  );

  // ── Model allowlist helper ────────────────────────────────────────────────
  // [] = unrestricted (any model passes). Non-empty = explicit allowlist.
  // Uses normalizeModelName() for canonical prefix matching so that
  // versioned IDs like "gpt-4o-2024-11-20" match against "gpt-4o".
  function isModelAllowed(requestedModel: string, allowedModels: string[]): boolean {
    if (allowedModels.length === 0) return true;
    const canonical = normalizeModelName(requestedModel);
    return allowedModels.includes(canonical) || allowedModels.includes(requestedModel);
  }

  // ── Resolved key cache — carries allowed_models, data_region, customEndpoint
  type ResolvedEntry = { key: string; allowedModels: string[]; dataRegion: DataRegion; customEndpoint?: string; awsRegion?: string };
  const resolvedProviderKeys = new Map<string, ResolvedEntry>();

  let providerKey: string | null = null;
  let primaryAllowedModels: string[] = [];
  let primaryDataRegion: DataRegion  = "global";

  // 1. Look for the requested provider in explicit key links
  if (linkedProviderKeyIds.length > 0) {
    const { data: pk } = await supabaseAdmin
      .from("provider_keys")
      .select("key_encrypted, allowed_models, data_region, custom_endpoint, aws_region")
      .in("id", linkedProviderKeyIds)
      .eq("provider", provider)
      .eq("is_active", true)
      .maybeSingle();
    if (pk) {
      const raw = pk as { key_encrypted: string; allowed_models?: string[]; data_region?: string; custom_endpoint?: string; aws_region?: string };
      providerKey = raw.key_encrypted ? decryptKey(raw.key_encrypted) : (raw.custom_endpoint ?? "");
      primaryAllowedModels = raw.allowed_models ?? [];
      primaryDataRegion    = (raw.data_region ?? "global") as DataRegion;
      if (raw.custom_endpoint) resolvedProviderKeys.set(provider, { key: providerKey, allowedModels: primaryAllowedModels, dataRegion: primaryDataRegion, customEndpoint: raw.custom_endpoint, awsRegion: raw.aws_region ?? undefined });
    }
  }

  // 2. Backward-compat: fall back to the legacy 1:1 FK if no junction entry.
  // provider_key_id was dropped from api_keys (provider linking now lives in
  // key_provider_links), so read it defensively — null here just means there
  // is no legacy direct link to fall back to.
  const legacyProviderKeyId = (keyRow as { provider_key_id?: string | null }).provider_key_id ?? null;
  if (!providerKey && legacyProviderKeyId) {
    const { data: pk } = await supabaseAdmin
      .from("provider_keys")
      .select("key_encrypted, provider, allowed_models, data_region, custom_endpoint, aws_region")
      .eq("id", legacyProviderKeyId)
      .eq("is_active", true)
      .maybeSingle();
    if (pk?.provider === provider) {
      const raw = pk as { key_encrypted: string; provider: string; allowed_models?: string[]; data_region?: string; custom_endpoint?: string; aws_region?: string };
      providerKey = raw.key_encrypted ? decryptKey(raw.key_encrypted) : (raw.custom_endpoint ?? "");
      primaryAllowedModels = raw.allowed_models ?? [];
      primaryDataRegion    = (raw.data_region ?? "global") as DataRegion;
      if (raw.custom_endpoint) resolvedProviderKeys.set(provider, { key: providerKey, allowedModels: primaryAllowedModels, dataRegion: primaryDataRegion, customEndpoint: raw.custom_endpoint, awsRegion: raw.aws_region ?? undefined });
    }
  }

  if (!providerKey) {
    const rej = NextResponse.json(
      { error: `No active ${provider} provider key linked to this API key — add one in the dashboard` },
      { status: 403 },
    );
    void logGatewayRejection({ orgId: earlyOrgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "auth", rejectionCode: "no_provider_key", httpStatus: 403, reason: `No active ${provider} provider key`, traceId: traceCtx.traceId });
    return rej;
  }

  // Populate the cache entry for the primary provider (if not already set above)
  if (!resolvedProviderKeys.has(provider)) {
    resolvedProviderKeys.set(provider, { key: providerKey, allowedModels: primaryAllowedModels, dataRegion: primaryDataRegion, awsRegion: undefined });
  }

  const orgId     = keyRow.org_id;
  const projectId = (keyRow as { project_id?: string | null }).project_id ?? "";
  const userId    = (keyRow as { assigned_user_id?: string | null; user_id?: string | null }).assigned_user_id
                    ?? (keyRow as { user_id?: string | null }).user_id
                    ?? "";
  const orgMeta   = keyRow.organizations as { plan?: string; data_residency_policy?: string; gateway_mode?: string } | null;
  const orgPlan             = orgMeta?.plan                    ?? "starter";
  const orgResidencyPolicy  = (orgMeta?.data_residency_policy  ?? "any")          as ResidencyPolicy;
  const orgGatewayMode      = (orgMeta?.gateway_mode           ?? "sdk_optional");
  const ttlDays   = planToTtlDays(orgPlan);

  // ── Gateway-only mode check ──────────────────────────────────────────────
  // When gateway_required, all requests MUST come through the gateway URL
  // (SDK injects x-prism-gateway: true when PRISM_GATEWAY_URL is set).
  if (orgGatewayMode === "gateway_required" && !req.headers.get("x-prism-gateway")) {
    const rej = NextResponse.json(
      {
        error:   "gateway_required",
        message: "This org requires all LLM calls to route through the Prism gateway. " +
                 "Set PRISM_GATEWAY_URL in your environment — see /dashboard/settings/enforce.",
      },
      { status: 403 },
    );
    void logGatewayRejection({ orgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "gateway_mode", rejectionCode: "gateway_required", httpStatus: 403, reason: "Org requires gateway mode", traceId: traceCtx.traceId });
    return rej;
  }

  // ── Data residency check for primary provider key ────────────────────────
  const residencyCheck = checkDataResidency(orgResidencyPolicy, primaryDataRegion);
  if (!residencyCheck.allowed) {
    const rej = NextResponse.json(
      { error: "data_residency_violation", message: residencyCheck.reason },
      { status: 451 },
    );
    void logGatewayRejection({ orgId, apiKeyId, provider, model: "", environment: gatewayEnvironment, layer: "data_residency", rejectionCode: "data_residency_violation", httpStatus: 451, reason: residencyCheck.reason ?? "Data residency violation", traceId: traceCtx.traceId });
    return rej;
  }

  // ── P1-A: Runtime feature tags ───────────────────────────────────────────
  const runtimeTags = extractRuntimeTags(req.headers);
  if (branchTag) runtimeTags["git_branch"] = branchTag;
  if (commitTag) runtimeTags["git_commit"] = commitTag;

  // ── Multi-tenant customer attribution ────────────────────────────────────
  // x-prism-customer-id is the operator's opaque end-customer identifier.
  // Stamped as tags['customer_id'] on every llm_event for Tinybird aggregation.
  const customerIdTag = req.headers.get("x-prism-customer-id")?.trim() ?? "";
  if (customerIdTag) runtimeTags["customer_id"] = customerIdTag;

  // ── Cost center stamping ─────────────────────────────────────────────────
  // Callers can set cost_center via x-prism-cost-center header or x-prism-tags.
  // If not set, fall back to the project's cost_center_code from Supabase.
  if (!runtimeTags["cost_center"] && projectId) {
    try {
      const { data: proj } = await supabaseAdmin
        .from("projects")
        .select("cost_center_code")
        .eq("id", projectId)
        .maybeSingle();
      if ((proj as { cost_center_code?: string | null } | null)?.cost_center_code) {
        runtimeTags["cost_center"] = (proj as { cost_center_code: string }).cost_center_code;
      }
    } catch { /* never block the gateway */ }
  }

  // ── Team attribution ─────────────────────────────────────────────────────
  // x-prism-team-id is an explicit override — the industry-standard "X-Team-ID"
  // header allocation pattern lets the caller stamp its own team (e.g. a CI job
  // tagging its squad) directly, the same way x-prism-customer-id works above.
  // tags['team_id'] (set via x-prism-tags JSON) is honoured too. Absent either,
  // we fall back to resolving the authenticated user's team_members membership.
  // Stamped on the dedicated `team_id` column (not `tags`) so spend_by_team works.
  const teamIdTag = req.headers.get("x-prism-team-id")?.trim()
                 || (runtimeTags["team_id"] as string | undefined);
  const teamId    = await resolveTeamId(orgId, userId, teamIdTag);

  // ── Build upstream request ───────────────────────────────────────────────
  const urlPath    = req.nextUrl.pathname.replace(`/api/gateway/${provider}`, "") || "/";
  const config     = getProviderConfig(provider);

  const requestBody = req.body ? await req.arrayBuffer() : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsedBody: any = null;
  let isStreaming = false;
  if (requestBody) {
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(requestBody));
      isStreaming = !!parsedBody.stream;
    } catch { /* non-JSON body */ }
  }

  // ── Prompt cache check ───────────────────────────────────────────────────
  // Only applies to non-streaming deterministic requests when org has cache enabled.
  const cacheConfig = await getOrgCacheConfig(orgId);
  let promptCacheKey: string | null = null;

  // Per-request cache overrides (mirror Bifrost's x-bf-cache-* controls):
  //   x-prism-cache-key       — partition the cache (per user/session/feature)
  //   x-prism-cache-ttl       — override TTL (seconds) for this write
  //   x-prism-cache-threshold — override semantic similarity threshold (0–1)
  //   x-prism-cache-type      — limit lookup to "exact" or "semantic"
  //   x-prism-cache-no-store  — serve hits but don't write this response
  const cachePartition  = req.headers.get("x-prism-cache-key")  ?? "";
  const cacheType       = (req.headers.get("x-prism-cache-type") ?? "").toLowerCase();
  const cacheNoStore    = (req.headers.get("x-prism-cache-no-store") ?? "") === "true";
  const ttlOverride     = parseInt(req.headers.get("x-prism-cache-ttl") ?? "", 10);
  const effectiveTtl    = Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : cacheConfig.ttlSeconds;
  const thresholdOverride   = parseFloat(req.headers.get("x-prism-cache-threshold") ?? "");
  const effectiveThreshold  = Number.isFinite(thresholdOverride)
    ? Math.min(1, Math.max(0, thresholdOverride))
    : cacheConfig.similarityThreshold;
  // Skip caching entirely for long conversations (they churn and rarely repeat).
  const cacheMsgCount  = Array.isArray(parsedBody?.messages) ? parsedBody.messages.length : 0;
  const convoTooLong   = cacheConfig.conversationHistoryThreshold > 0
    && cacheMsgCount > cacheConfig.conversationHistoryThreshold;

  // Builds the early-return response for a cache hit (Tier 1 exact-match or
  // Tier 2 semantic), recording a zero-cost cache-hit event to Tinybird
  // (fire-and-forget).
  const buildCacheHitResponse = (
    hit: CachedEntry,
    cacheTag: "hit" | "semantic",
    debug?: { similarity?: number; embeddingTokens?: number },
  ) => {
    void ingestToTinybird([{
      event_id:        uuidv4(),
      timestamp:       new Date().toISOString().replace("T", " ").slice(0, 23),
      org_id:          orgId,
      project_id:      projectId,
      project_name:    projectId,
      team_id:         teamId,
      user_id:         userId,
      environment:     gatewayEnvironment,
      provider,
      model:           hit.model,
      input_tokens:    hit.inputTokens,
      output_tokens:   hit.outputTokens,
      cached_tokens:   hit.inputTokens + hit.outputTokens,
      image_tokens:    0,
      audio_tokens:    0,
      text_tokens:     0,
      modalities:      "text",
      cost_usd:        0,   // no charge on cache hit
      latency_ms:      0,
      ttft_ms:         0,
      status_code:     200,
      request_id:      "",
      tags:            { ...extractRuntimeTags(req.headers), prism_cache: cacheTag },
      ttl_days:        planToTtlDays((keyRow.organizations as { plan?: string } | null)?.plan ?? "starter"),
      api_key_id:      apiKeyId,
      key_type:        "gateway",
      prism_cache_hit: 1,
      // Propagate trace context so cache-hit spans appear in the trace tree.
      trace_id:        traceCtx.traceId,
      span_id:         traceCtx.spanId,
      parent_span_id:  traceCtx.parentSpanId,
    }]);

    // Trace rollup for this cache-hit span — zero cost, completed, recorded now.
    void upsertTraceRollup(orgId, traceCtx.traceId, {
      rootSpanId:    traceCtx.parentSpanId ? null : traceCtx.spanId,
      rootSessionId: (runtimeTags["session_id"] as string | undefined) || null,
      costUsd:       0,
      startedAt:     new Date().toISOString(),
      endedAt:       new Date().toISOString(),
      isError:       false,
    });

    const headers: Record<string, string> = {
      "x-prism-cache":      cacheTag,
      "x-prism-cache-type": cacheTag === "semantic" ? "semantic" : "exact",
      "x-prism-cache-age":  String(Math.floor((Date.now() - hit.cachedAt) / 1000)) + "s",
    };
    if (debug?.similarity !== undefined) headers["x-prism-cache-similarity"] = debug.similarity.toFixed(4);
    if (debug?.embeddingTokens)          headers["x-prism-cache-embedding-tokens"] = String(debug.embeddingTokens);
    return NextResponse.json(hit.response, { headers });
  };

  if (cacheConfig.enabled && parsedBody && !isStreaming && !convoTooLong) {
    // Tier 1: exact-match (skipped when the caller forces semantic-only lookup).
    if (cacheType !== "semantic") {
      promptCacheKey = buildCacheKey(
        orgId,
        parsedBody.model ?? "",
        parsedBody.messages ?? [],
        parsedBody.temperature,
        isStreaming,
        cachePartition,
      );
      if (promptCacheKey) {
        const hit = await getCached(promptCacheKey);
        if (hit) return buildCacheHitResponse(hit, "hit");
      }
    }

    // Tier 2: semantic similarity — catches paraphrased prompts that miss the
    // exact-match hash. Only runs in semantic mode (and not when forced exact-only).
    if (cacheConfig.mode === "semantic" && cacheType !== "exact") {
      const semanticHit = await semanticCacheGet(orgId, parsedBody.messages ?? [], {
        similarityThreshold: effectiveThreshold,
        embeddingModel:      "text-embedding-3-small",
      }, cachePartition);
      if (semanticHit) {
        return buildCacheHitResponse(semanticHit.entry, "semantic", {
          similarity:      semanticHit.similarity,
          embeddingTokens: semanticHit.embeddingTokens,
        });
      }
    }
  }

  // ── Recommendation-driven model substitution ────────────────────────────
  // An "applied" Model Intelligence Engine recommendation is a human-confirmed,
  // validated, standing decision to swap one model for a cheaper equivalent on
  // a given workload — e.g. "switch the customer-support feature from gpt-4 to
  // gpt-4o-mini: validated at 94% semantic agreement with <5% edge cases, save
  // ~$420/mo". Runs BEFORE the soft-cap/quota downgrades below so those
  // emergency mechanisms see the org's real steady-state model choice — and,
  // since the swap is already cheaper, are correspondingly less likely to ever
  // need to fire. Mirrors the soft-cap-model mechanism exactly: replace `model`
  // in the parsed body, tag the original + recommendation for observability.
  // Narrow (exact current_model match, optional feature scope), proven
  // (identical mechanism to the soft-cap downgrade below), reversible (the
  // human who applied it can roll back from the dashboard at any time).
  if (parsedBody?.model) {
    const featureTag    = (runtimeTags["feature"] as string | undefined) ?? "";
    const substitution  = await getActiveModelSubstitution(orgId, parsedBody.model, featureTag);
    if (substitution) {
      runtimeTags["model_downgraded_from"] = parsedBody.model;
      runtimeTags["recommendation_id"]     = substitution.rec_id;
      parsedBody = { ...parsedBody, model: substitution.suggested_model };
    }
  }

  // ── P1-B: Soft-cap model downgrade ───────────────────────────────────────
  const softCapModel = req.headers.get("x-prism-soft-cap-model") ?? "";
  const softCapPct   = parseInt(req.headers.get("x-prism-soft-cap-pct") ?? "80", 10);
  const originalModel: string = parsedBody?.model ?? "";

  if (softCapModel && parsedBody) {
    const { status } = await getGatewaySoftCapStatus(supabaseAdmin, orgId, projectId, softCapPct, provider);
    if (status === "hard_cap_exceeded") {
      const rej = NextResponse.json({ error: "budget_exceeded", message: "Monthly budget hard cap reached." }, { status: 402 });
      void logGatewayRejection({ orgId, apiKeyId, provider, model: parsedBody?.model ?? "", environment: gatewayEnvironment, layer: "spend_cap", rejectionCode: "budget_exceeded_soft_cap", httpStatus: 402, reason: "Monthly budget hard cap reached", traceId: traceCtx.traceId });
      return rej;
    }
    if (status === "soft_cap_hit") {
      parsedBody = { ...parsedBody, model: softCapModel };
      runtimeTags["model_downgraded_from"] = originalModel;
    }
  }

  // ── Org-level model governance check ────────────────────────────────────
  // Evaluated BEFORE the per-key provider allowlist. The org policy is the
  // highest authority; per-key allowlists refine within what the policy permits.
  const requestedEnvironment = (runtimeTags["environment"] as string | undefined) ?? "production";

  // ── Phase 2a: Policy-driven routing ─────────────────────────────────────
  // Runs after financial controls (substitution, soft-cap) but BEFORE model
  // governance so governance validates the final policy-selected model.
  // Always fails-open: any exception → no override, request continues normally.
  let policyOverrideProvider: string | undefined;
  let policyFallbackCandidates: FallbackCandidate[] | undefined;
  let policyStrategy: string | undefined;
  {
    const policyCtx: PolicyContext = {
      request: {
        model:       parsedBody?.model ?? "",
        provider,
        environment: requestedEnvironment,
        tags:        runtimeTags as Record<string, string>,
      },
      provider: {
        health: await getHealthSnapshot([provider, "openai", "anthropic", "google", "bedrock"]),
      },
      org: { plan: (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter" },
    };
    const policyAction = await evaluatePolicies(orgId, policyCtx, supabaseAdmin);
    if (policyAction && parsedBody) {
      parsedBody               = { ...parsedBody, model: policyAction.model };
      policyOverrideProvider   = policyAction.provider;
      policyFallbackCandidates = policyAction.fallback_candidates as FallbackCandidate[] | undefined;
      policyStrategy           = policyAction.strategy;
      runtimeTags["routed_by_policy"] = "true";
    }
  }

  const governanceCheck = await checkOrgModelPolicy(
    supabaseAdmin,
    orgId,
    parsedBody?.model ?? "",
    requestedEnvironment,
    apiKeyId,
  );
  if (!governanceCheck.allowed) {
    const rejCode = governanceCheck.requiresApproval ? "model_requires_approval" : "model_blocked_by_policy";
    const rej = NextResponse.json(
      {
        error:            rejCode,
        message:          governanceCheck.reason,
        approval_url:     governanceCheck.requiresApproval ? "/dashboard/settings/model-governance" : undefined,
      },
      { status: 403 },
    );
    void logGatewayRejection({ orgId, apiKeyId, provider, model: parsedBody?.model ?? "", environment: gatewayEnvironment, layer: "model_governance", rejectionCode: rejCode, httpStatus: 403, reason: governanceCheck.reason ?? "Model blocked by governance policy", traceId: traceCtx.traceId });
    return rej;
  }

  // ── Model allowlist check for primary provider ──────────────────────────
  // Must happen after soft-cap downgrade so we check the final model name.
  const requestedModel: string = parsedBody?.model ?? "";
  if (requestedModel && !isModelAllowed(requestedModel, primaryAllowedModels)) {
    const rej = NextResponse.json(
      {
        error:   "model_not_allowed",
        message: `Model "${requestedModel}" is not in the allowed list for the linked ${provider} provider key. Allowed: [${primaryAllowedModels.join(", ")}]`,
      },
      { status: 403 },
    );
    void logGatewayRejection({ orgId, apiKeyId, provider, model: requestedModel, environment: gatewayEnvironment, layer: "model_governance", rejectionCode: "model_not_allowed", httpStatus: 403, reason: `Model "${requestedModel}" not in allowed list`, traceId: traceCtx.traceId });
    return rej;
  }

  // ── PII pre-flight detection ─────────────────────────────────────────────
  // Scan the request body for PII before proxying to the provider.
  // Startup+: logs the incident and continues (warn mode).
  // Enterprise+: can also hard-reject the request (block mode).
  // Runs only when pii_detection_enabled = true on the org.
  {
    const piiConfig = await getOrgPiiConfig(orgId);
    if (piiConfig.detection_enabled && Array.isArray(parsedBody?.messages)) {
      const piiResult = detectPII(
        parsedBody.messages as unknown[],
        piiConfig.custom_patterns ?? undefined,
      );
      if (piiResult.detected) {
        const userId = req.headers.get("x-prism-user-id") ?? undefined;
        recordPIIIncident({
          orgId,
          apiKeyId,
          userId,
          provider,
          model: parsedBody?.model ?? "",
          result: piiResult,
          action: piiConfig.detection_action,
        });

        // Emit a guardrail span to Tinybird for trace-tree visibility.
        // Fire-and-forget — never blocks request path regardless of outcome.
        void ingestToTinybird([{
          event_id:      uuidv4(),
          timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
          org_id:        orgId,
          project_id:    projectId,
          project_name:  projectId,
          team_id:       "",
          user_id:       req.headers.get("x-prism-user-id") ?? "",
          environment:   gatewayEnvironment,
          provider:      provider,
          model:         parsedBody?.model ?? "",
          input_tokens:  0,
          output_tokens: 0,
          cached_tokens: 0,
          image_tokens:  0,
          audio_tokens:  0,
          text_tokens:   0,
          modalities:    "text",
          cost_usd:      0,
          latency_ms:    0,
          ttft_ms:       0,
          status_code:   piiConfig.detection_action === "block" ? 422 : 200,
          request_id:    uuidv4(),
          tags: {
            span_kind:        "guardrail",
            pii_detected:     "true",
            pii_types:        piiResult.detectedTypes.join(","),
            detection_action: piiConfig.detection_action,
          },
          ttl_days:        ttlDays,
          api_key_id:      apiKeyId,
          key_type:        "gateway",
          prism_cache_hit: 0,
          trace_id:        traceCtx.traceId,
          span_id:         uuidv4().replace(/-/g, ""),
          parent_span_id:  traceCtx.spanId,
        }]);

        if (piiConfig.detection_action === "block") {
          const rej = NextResponse.json(
            { error: "pii_detected", pii_types: piiResult.detectedTypes },
            { status: 422 },
          );
          void logGatewayRejection({ orgId, apiKeyId, provider, model: parsedBody?.model ?? "", environment: gatewayEnvironment, layer: "pii_guard", rejectionCode: "pii_detected", httpStatus: 422, reason: `PII detected: ${piiResult.detectedTypes.join(", ")}`, traceId: traceCtx.traceId });
          return rej;
        }
        // Warn mode: tag the request and continue
        runtimeTags["pii_detected"] = "true";
      }
    }
  }

  // ── Guardrails: input-side rules (warn / block / redact) ──────────────────
  // Additive layer over the legacy PII config above — rule-driven via the
  // guardrail_rules / guardrail_profiles tables, reusing the policy DSL for
  // predicates. This pass evaluates built-in PII profiles; external safety
  // providers (Bedrock/Azure) attach in a later layer. Fails open end-to-end
  // (store + evaluator both return safe defaults), so a guardrails fault never
  // blocks live traffic.
  if (Array.isArray(parsedBody?.messages)) {
    const { rules: gRules, profiles: gProfiles } = await loadOrgGuardrails(orgId, supabaseAdmin);
    const inputRules = gRules.filter(r => r.apply_to === "input" || r.apply_to === "both");
    if (inputRules.length > 0) {
      const gctx: GuardrailContext = {
        direction: "input",
        request:   { model: parsedBody?.model ?? "", provider, environment: requestedEnvironment, tags: runtimeTags as Record<string, string> },
        org:       { plan: (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter" },
      };
      const gDecision = await evaluateGuardrails({
        rules: inputRules, profiles: gProfiles, payload: parsedBody.messages as unknown[], context: gctx,
      });

      if (gDecision.action !== "allow") {
        void ingestToTinybird([{
          event_id:      uuidv4(),
          timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
          org_id:        orgId,
          project_id:    projectId,
          project_name:  projectId,
          team_id:       "",
          user_id:       req.headers.get("x-prism-user-id") ?? "",
          environment:   gatewayEnvironment,
          provider:      provider,
          model:         parsedBody?.model ?? "",
          input_tokens:  0,
          output_tokens: 0,
          cached_tokens: 0,
          image_tokens:  0,
          audio_tokens:  0,
          text_tokens:   0,
          modalities:    "text",
          cost_usd:      0,
          latency_ms:    0,
          ttft_ms:       0,
          status_code:   gDecision.action === "block" ? 422 : 200,
          request_id:    uuidv4(),
          tags: {
            span_kind:        "guardrail",
            guardrail_dir:    "input",
            guardrail_action: gDecision.action,
            guardrail_types:  gDecision.detectedTypes.join(","),
          },
          ttl_days:        ttlDays,
          api_key_id:      apiKeyId,
          key_type:        "gateway",
          prism_cache_hit: 0,
          trace_id:        traceCtx.traceId,
          span_id:         uuidv4().replace(/-/g, ""),
          parent_span_id:  traceCtx.spanId,
        }]);
      }

      if (gDecision.action === "block") {
        const rej = NextResponse.json(
          { error: "guardrail_blocked", reason: gDecision.reason, types: gDecision.detectedTypes },
          { status: 422 },
        );
        void logGatewayRejection({ orgId, apiKeyId, provider, model: parsedBody?.model ?? "", environment: gatewayEnvironment, layer: "guardrail", rejectionCode: "guardrail_blocked", httpStatus: 422, reason: gDecision.reason ?? "Guardrail blocked input", traceId: traceCtx.traceId });
        return rej;
      }
      if (gDecision.action === "redact" && gDecision.redactedPayload) {
        parsedBody = { ...parsedBody, messages: gDecision.redactedPayload };
        runtimeTags["guardrail_redacted"] = gDecision.detectedTypes.join(",") || "true";
      } else if (gDecision.action === "warn") {
        runtimeTags["guardrail_flagged"] = gDecision.detectedTypes.join(",") || "true";
      }
    }
  }

  // ── Customer quota enforcement (multi-tenant billing) ───────────────────
  // Runs only when the caller passes x-prism-customer-id. Fails open — never
  // blocks a request due to Redis or Supabase unavailability.
  if (customerIdTag) {
    try {
      const quotaProfile = await getCustomerQuotaProfile(orgId, customerIdTag);
      if (quotaProfile) {
        const quotaStatus = await checkCustomerQuota(orgId, customerIdTag, {
          monthly_spend_usd:   quotaProfile.monthly_spend_usd,
          monthly_token_limit: quotaProfile.monthly_token_limit,
          soft_cap_pct:        quotaProfile.soft_cap_pct,
        });

        if (quotaStatus === "exceeded") {
          const rej = NextResponse.json(
            {
              error:       "customer_quota_exceeded",
              customer_id: customerIdTag,
              message:     "This customer has reached their monthly AI usage limit.",
            },
            { status: 402 },
          );
          void logGatewayRejection({ orgId, apiKeyId, provider, model: parsedBody?.model ?? "", environment: gatewayEnvironment, layer: "customer_quota", rejectionCode: "customer_quota_exceeded", httpStatus: 402, reason: `Customer ${customerIdTag} has reached monthly AI usage limit`, traceId: traceCtx.traceId });
          return rej;
        }

        if (quotaStatus === "soft_cap" && quotaProfile.soft_cap_model && parsedBody) {
          // Downgrade to cheaper model — mirrors the existing soft-cap-model behaviour
          runtimeTags["model_downgraded_from"]    = parsedBody.model ?? "";
          runtimeTags["customer_quota_soft_cap"]  = "true";
          parsedBody = { ...parsedBody, model: quotaProfile.soft_cap_model };
        }
      }
    } catch { /* quota check must never break the gateway hot path */ }
  }

  // ── P1-C V2: Model routing with cross-provider support ──────────────────
  // Local providers (ollama, openai_compatible) use OpenAI-format natively and
  // have no routing rules in the DB — fall back to "openai" for rule lookup.
  // If Phase 2a policy routing fired, use the policy-selected provider.
  const effectiveProvider = (policyOverrideProvider ?? provider) as AnyGatewayProvider;
  const ruleProvider: GatewayProvider =
    (effectiveProvider === "ollama" || effectiveProvider === "openai_compatible") ? "openai" : effectiveProvider as GatewayProvider;
  const { candidates: fallbackCandidates, triggerCodes } =
    await getFallbackCandidates(orgId, parsedBody?.model ?? "", ruleProvider, supabaseAdmin, apiKeyId);

  // Build full candidate list: original model + fallbacks.
  // Policy-supplied fallback_candidates override DB rules when present.
  const rawCandidates: FallbackCandidate[] = [
    { model: parsedBody?.model ?? "", provider: effectiveProvider },
    ...(policyFallbackCandidates ?? fallbackCandidates),
  ].filter((c) => c.model);

  // Routing strategy: policy override → x-prism-strategy header → default "error"
  const routingStrategy = (policyStrategy ?? req.headers.get("x-prism-strategy") ?? "error") as
    "error" | "latency" | "cost" | "health";
  const allCandidates = await rankCandidates(rawCandidates, routingStrategy);

  async function resolveProviderKey(targetProvider: string): Promise<string | null> {
    if (resolvedProviderKeys.has(targetProvider)) return resolvedProviderKeys.get(targetProvider)!.key;

    type PKRow = { key_encrypted: string; allowed_models?: string[]; data_region?: string; custom_endpoint?: string; azure_endpoint?: string; aws_region?: string };

    function resolveEndpoint(row: PKRow, prov: string): string | undefined {
      // Azure stores its resource endpoint in azure_endpoint; locals use custom_endpoint
      return prov === "azure_openai" ? (row.azure_endpoint ?? row.custom_endpoint) : row.custom_endpoint;
    }

    // 1. Key-scoped: look in the junction table for this Prism key's explicit links
    if (linkedProviderKeyIds.length > 0) {
      const { data: pk } = await supabaseAdmin
        .from("provider_keys")
        .select("key_encrypted, allowed_models, data_region, custom_endpoint, azure_endpoint, aws_region")
        .in("id", linkedProviderKeyIds)
        .eq("provider", targetProvider)
        .eq("is_active", true)
        .maybeSingle();
      if (pk) {
        const row = pk as PKRow;
        const endpoint = resolveEndpoint(row, targetProvider);
        const key = row.key_encrypted ? decryptKey(row.key_encrypted) : (endpoint ?? "");
        resolvedProviderKeys.set(targetProvider, {
          key,
          allowedModels:  row.allowed_models ?? [],
          dataRegion:     (row.data_region ?? "global") as DataRegion,
          customEndpoint: endpoint,
          awsRegion:      row.aws_region ?? undefined,
        });
        return key;
      }
    }

    // 2. Org-wide fallback: any active key for this provider in the org
    const { data: pk } = await supabaseAdmin
      .from("provider_keys")
      .select("key_encrypted, allowed_models, data_region, custom_endpoint, azure_endpoint, aws_region")
      .eq("org_id", orgId)
      .eq("provider", targetProvider)
      .eq("is_active", true)
      .maybeSingle();
    if (!pk) return null;
    const row = pk as PKRow;
    const endpoint = resolveEndpoint(row, targetProvider);
    const key = row.key_encrypted ? decryptKey(row.key_encrypted) : (endpoint ?? "");
    resolvedProviderKeys.set(targetProvider, {
      key,
      allowedModels:  row.allowed_models ?? [],
      dataRegion:     (row.data_region ?? "global") as DataRegion,
      customEndpoint: endpoint,
      awsRegion:      row.aws_region ?? undefined,
    });
    return key;
  }

  let upstreamRes!: Response;
  let usedModel:    string = allCandidates[0]?.model ?? "";
  let usedProvider: string = provider;
  let fallbackCount        = 0;
  const start          = Date.now();

  for (let i = 0; i < allCandidates.length; i++) {
    const candidate = allCandidates[i]!;

    // Resolve provider key for this candidate
    const candidateKey = await resolveProviderKey(candidate.provider);
    if (!candidateKey) {
      console.warn(`[gateway] No active ${candidate.provider} key for org ${orgId} — skipping fallback`);
      fallbackCount++;
      continue;
    }

    const cProvider = candidate.provider;

    // ── Data residency check for this candidate's provider key ─────────────
    const candidateRegion = resolvedProviderKeys.get(cProvider)?.dataRegion ?? "global";
    const candidateResidency = checkDataResidency(orgResidencyPolicy, candidateRegion);
    if (!candidateResidency.allowed) {
      console.warn(`[gateway] Skipping ${cProvider} fallback — data residency violation: ${candidateResidency.reason}`);
      fallbackCount++;
      if (i === allCandidates.length - 1) {
        const rej = NextResponse.json(
          { error: "data_residency_violation", message: candidateResidency.reason },
          { status: 451 },
        );
        void logGatewayRejection({ orgId, apiKeyId, provider: cProvider, model: candidate.model, environment: gatewayEnvironment, layer: "data_residency", rejectionCode: "data_residency_violation", httpStatus: 451, reason: candidateResidency.reason ?? "Data residency violation", traceId: traceCtx.traceId });
        return rej;
      }
      continue;
    }

    // Check model allowlist for this candidate's provider key
    const candidateAllowed = resolvedProviderKeys.get(cProvider)?.allowedModels ?? [];
    if (!isModelAllowed(candidate.model, candidateAllowed)) {
      console.warn(`[gateway] Model "${candidate.model}" not allowed on ${cProvider} provider key — skipping`);
      fallbackCount++;
      if (i === allCandidates.length - 1) {
        const rej = NextResponse.json(
          { error: "no_allowed_candidate",
            message: "All fallback candidates were excluded by model allowlists on their provider keys." },
          { status: 403 },
        );
        void logGatewayRejection({ orgId, apiKeyId, provider: cProvider, model: candidate.model, environment: gatewayEnvironment, layer: "model_governance", rejectionCode: "no_allowed_candidate", httpStatus: 403, reason: "All fallback candidates excluded by model allowlists", traceId: traceCtx.traceId });
        return rej;
      }
      continue;
    }
    const cCustomEndpoint   = resolvedProviderKeys.get(cProvider)?.customEndpoint;
    const candidateConfig   = getProviderConfig(cProvider, cCustomEndpoint);
    const candidateHeaders  = candidateConfig.buildHeaders(candidateKey, req.headers);
    Object.keys(candidateHeaders).forEach((k) => { if (!candidateHeaders[k]) delete candidateHeaders[k]; });
    // Propagate trace context to upstream provider (W3C + Prism headers)
    injectTraceHeaders(candidateHeaders, traceCtx);
    // For Azure OpenAI, pass the model name so it can be used as the deployment name in the URL
    const candidateUrl      = buildUpstreamUrl(cProvider, urlPath, candidateKey, cCustomEndpoint, candidate.model);
    // Check capability guard before attempting cross-provider routing.
    // Local providers and azure_openai use OpenAI-format natively — skip guard.
    const isLocalProvider = cProvider === "ollama" || cProvider === "openai_compatible" || cProvider === "azure_openai";
    if (cProvider !== provider && !isLocalProvider && parsedBody) {
      const guard = canRouteCrossProvider(parsedBody as OAIRequest, provider as GatewayProvider, cProvider as GatewayProvider);
      if (!guard.canRoute) {
        console.warn(`[gateway] cross-provider guard blocked ${provider} → ${cProvider}: ${guard.reason}`);
        fallbackCount++;
        if (i === allCandidates.length - 1) {
          const rej = NextResponse.json(
            { error: "cross_provider_routing_blocked", reason: guard.reason },
            { status: 422 },
          );
          void logGatewayRejection({ orgId, apiKeyId, provider: cProvider, model: candidate.model, environment: gatewayEnvironment, layer: "pii_guard", rejectionCode: "cross_provider_routing_blocked", httpStatus: 422, reason: guard.reason ?? "Cross-provider routing blocked", traceId: traceCtx.traceId });
          return rej;
        }
        continue;
      }
    }

    // For streaming requests, inject stream_options.include_usage=true so OpenAI
    // sends a final SSE chunk with token counts that the stream parser can capture.
    const bodyForModel = parsedBody
      ? {
          ...parsedBody,
          model: candidate.model,
          ...(isStreaming ? { stream_options: { ...(parsedBody.stream_options ?? {}), include_usage: true } } : {}),
        }
      : null;

    // AWS Bedrock: SDK-based execution (SigV4 + OAI-to-Converse + EventStream streaming).
    // Intercepts before the standard fetch() path; response is already OAI format.
    if (cProvider === "bedrock") {
      const bedrockEntry = resolvedProviderKeys.get("bedrock");
      if (!bedrockEntry) {
        console.warn(`[gateway] No Bedrock provider key for org ${orgId} — skipping`);
        fallbackCount++;
        if (i === allCandidates.length - 1) {
          return NextResponse.json({ error: "No Bedrock provider key configured" }, { status: 403 });
        }
        continue;
      }
      let bedrockCreds: BedrockCredentials;
      try {
        bedrockCreds = parseBedrockCredentials(bedrockEntry.key, bedrockEntry.awsRegion ?? "us-east-1");
      } catch (err) {
        console.error("[gateway] Invalid Bedrock credentials:", err);
        if (i === allCandidates.length - 1) {
          return NextResponse.json({ error: "Invalid Bedrock credentials format" }, { status: 502 });
        }
        fallbackCount++;
        continue;
      }
      try {
        upstreamRes = await bedrockFetch(
          bedrockCreds, candidate.model, (bodyForModel ?? {}) as OAIRequest, isStreaming,
        );
      } catch (err) {
        console.error(`[gateway] Bedrock ${candidate.model} error:`, err);
        void recordGatewayError(earlyOrgId, apiKeyId, "provider_error");
        if (i === allCandidates.length - 1) {
          return NextResponse.json({ error: "Bedrock request failed" }, { status: 502 });
        }
        fallbackCount++;
        continue;
      }
      usedModel    = candidate.model;
      usedProvider = cProvider;
      void resetCircuitBreaker(earlyOrgId, apiKeyId);
      break;
    }

    // Normalize request format when routing cross-provider (skip for local providers)
    const normalizedBody = bodyForModel && cProvider !== provider && !isLocalProvider
      ? normalizeRequest(bodyForModel as OAIRequest, provider as GatewayProvider, cProvider as GatewayProvider)
      : bodyForModel;

    const bodyToSend = normalizedBody ? JSON.stringify(normalizedBody) : null;

    try {
      upstreamRes = await fetch(candidateUrl, {
        method:  req.method,
        headers: candidateHeaders,
        body:    bodyToSend ?? requestBody,
      });
    } catch (err) {
      console.error(`[gateway] Upstream ${candidate.provider}/${candidate.model} unreachable:`, err);
      void recordGatewayError(earlyOrgId, apiKeyId, "provider_error");
      if (i === allCandidates.length - 1) {
        return NextResponse.json({ error: "Upstream provider unreachable" }, { status: 502 });
      }
      fallbackCount++;
      continue;
    }

    if (upstreamRes.ok || !triggerCodes.has(upstreamRes.status)) {
      usedModel    = candidate.model;
      usedProvider = cProvider;
      void resetCircuitBreaker(earlyOrgId, apiKeyId);
      break;
    }

    // Trigger code — record the error for health tracking, then try next fallback
    void recordError(cProvider);
    void recordGatewayError(earlyOrgId, apiKeyId, "provider_error");
    console.warn(`[gateway] ${candidate.provider}/${candidate.model} returned ${upstreamRes.status}, trying fallback`);
    fallbackCount++;
    if (i === allCandidates.length - 1) {
      const text = await upstreamRes.text();
      return new NextResponse(text, {
        status: upstreamRes.status,
        headers: { "Content-Type": upstreamRes.headers.get("content-type") ?? "application/json" },
      });
    }
  }

  const latencyMs = Date.now() - start;
  // Track which provider actually served this response (may differ from original after fallback)
  const respondingProvider = usedProvider;

  if (!upstreamRes!.ok || !upstreamRes!.body) {
    const text = await upstreamRes!.text();
    return new NextResponse(text, {
      status:  upstreamRes!.status,
      headers: {
        "Content-Type":          upstreamRes!.headers.get("content-type") ?? "application/json",
        // Always stamp routing headers even on error responses so callers know
        // which provider/model actually served (or failed to serve) the request.
        ...(fallbackCount > 0 ? { "X-Prism-Routed-From": originalModel } : {}),
        ...(usedProvider !== provider ? { "X-Prism-Routed-To-Provider": usedProvider } : {}),
      },
    });
  }

  // Add routing metadata to tags if a fallback was used
  if (fallbackCount > 0 || usedModel !== originalModel) {
    runtimeTags["routed_from"]        = originalModel;
    runtimeTags["fallback_attempts"]  = String(fallbackCount);
    if (usedProvider !== provider) {
      runtimeTags["routed_to_provider"] = usedProvider;
    }
  }

  // ── Response handling + telemetry ────────────────────────────────────────

  const promptLoggingEnabled = !!(keyRow as { prompt_logging_enabled?: boolean }).prompt_logging_enabled;
  // Capture parsed request body for optional prompt logging
  const requestMessages: unknown[] | null = promptLoggingEnabled
    ? (parsedBody?.messages as unknown[] | undefined) ?? null
    : null;

  async function recordTelemetry(
    model: string, inputTokens: number, outputTokens: number,
    cachedTokens: number, requestId: string,
    completionText?: string,
    ttftMs = 0,
    modality?: { reasoningTokens?: number; imageTokens?: number; audioTokens?: number },
  ) {
    try {
      const cost  = calculateCost(model || usedModel, inputTokens, outputTokens, cachedTokens);
      const mod = {
        reasoningTokens: modality?.reasoningTokens ?? 0,
        imageTokens:     modality?.imageTokens ?? 0,
        audioTokens:     modality?.audioTokens ?? 0,
      };

      // ── Trace rollup (keystone) ── fire BEFORE the Tinybird ingest so a
      // Tinybird outage/misconfig can never skip the trace write: traces live
      // in Supabase, events in Tinybird, and the two must stay decoupled.
      // Fire-and-forget; never blocks the response.
      {
        const tEndedMs = Date.now();
        void upsertTraceRollup(orgId, traceCtx.traceId, {
          rootSpanId:    traceCtx.parentSpanId ? null : traceCtx.spanId,
          rootSessionId: (runtimeTags["session_id"] as string | undefined) || null,
          costUsd:       cost,
          startedAt:     new Date(tEndedMs - (latencyMs || 0)).toISOString(),
          endedAt:       new Date(tEndedMs).toISOString(),
          isError:       (upstreamRes?.status ?? 0) >= 400,
        });
      }

      const event = {
        event_id:      uuidv4(),
        timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
        org_id:        orgId,
        project_id:    projectId,
        project_name:  projectId,
        team_id:       teamId,
        user_id:       userId,
        environment:   "production",
        provider:      usedProvider,
        model:         model || usedModel,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        // Modality sub-counts (analytics only — NOT separate cost terms: reasoning is
        // already inside output_tokens; image/audio prompt tokens inside input_tokens).
        reasoning_tokens: mod.reasoningTokens,
        image_tokens:  mod.imageTokens,
        audio_tokens:  mod.audioTokens,
        text_tokens:   Math.max(0, inputTokens + outputTokens - mod.imageTokens - mod.audioTokens),
        modalities:    ["text", ...(mod.imageTokens > 0 ? ["image"] : []), ...(mod.audioTokens > 0 ? ["audio"] : [])].join(","),
        cost_usd:      cost,
        latency_ms:    latencyMs,
        ttft_ms:       ttftMs,
        status_code:   upstreamRes!.status,
        request_id:    requestId,
        tags:          runtimeTags,
        ttl_days:        ttlDays,
        api_key_id:      apiKeyId,
        key_type:        "gateway",
        prism_cache_hit: 0,
        trace_id:        traceCtx.traceId,
        span_id:         traceCtx.spanId,
        parent_span_id:  traceCtx.parentSpanId,
      };
      await ingestToTinybird([event]);

      // Forward event to registered export destinations (fire-and-forget)
      dispatchEvent({
        event_id:     event.event_id,
        org_id:       orgId,
        api_key_id:   apiKeyId,
        project_id:   projectId || undefined,
        model:        event.model,
        provider:     event.provider,
        input_tokens: event.input_tokens,
        output_tokens: event.output_tokens,
        cached_tokens: event.cached_tokens ?? 0,
        cost_usd:     event.cost_usd,
        latency_ms:   event.latency_ms,
        status_code:  event.status_code,
        timestamp:    event.timestamp,
        tags:         event.tags as Record<string, string> | undefined,
        session_id:   (event.tags as Record<string, string>)?.["session_id"] || undefined,
      });

      // Record latency + success for dynamic routing strategies (fire-and-forget)
      void recordLatency(usedProvider, model || usedModel, latencyMs);

      // Optional prompt/completion logging (when enabled on the key)
      if (promptLoggingEnabled) {
        void writeRequestLog({
          orgId:        orgId,
          apiKeyId:     apiKeyId,
          projectId:    projectId || "",
          model:        model || usedModel,
          provider:     usedProvider,
          prompt:       requestMessages,
          completion:   completionText ?? null,
          inputTokens, outputTokens, costUsd: cost,
          latencyMs:    latencyMs,
          statusCode:   upstreamRes!.status,
          sessionId:    runtimeTags["session_id"] ?? "",
          gitBranch:    runtimeTags["git_branch"]  ?? "",
          gitAuthor:    runtimeTags["git_author_email"] ?? runtimeTags["git_author_name"] ?? "",
          keyType:      "gateway",
          routedFrom:   runtimeTags["routed_from"] ?? "",
          traceId:      traceCtx.traceId,
          spanId:       traceCtx.spanId,
        });
      }

      // Update last_used_at on the gateway key (fire-and-forget)
      void supabaseAdmin.from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKeyId)
        .then(() => {}, () => {});
      // Increment org/project counter + all key-level cap counters + customer counter
      await Promise.all([
        incrementSpend(orgId, projectId || "default", cost),
        // Per-customer metering counter (multi-tenant billing)
        ...(customerIdTag ? [
          incrementCustomerSpend(orgId, customerIdTag, cost, inputTokens + outputTokens).catch(() => {}),
        ] : []),
        incrementAllCapCounters(apiKeyId, cost, activeCaps, gatewayEnvironment).catch(() => {}),
        // Legacy fallback counters
        ...(activeCaps.length === 0 ? [
          incrementKeySpend(apiKeyId, cost).catch(() => {}),
        ] : []),
        // Velocity tracking — feeds velocity_spike alert (fire-and-forget)
        trackSpendVelocity(orgId, apiKeyId, cost).catch(() => {}),
      ]);
    } catch (err) {
      console.error("[gateway] Failed to record telemetry:", err);
    }
  }

  if (!isStreaming) {
    // Non-streaming: buffer the entire body, parse usage directly from JSON.
    // Avoid tee() — it's unreliable for non-streaming responses in some runtimes.
    const buffered = await new Response(upstreamRes!.body).arrayBuffer();
    const bodyText = new TextDecoder().decode(buffered);

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
    let reasoningTokens = 0, audioTokens = 0;
    let model = usedModel, requestId = "", completionText = "";

    // Normalize cross-provider response to OpenAI format before returning to client
    let finalBodyText = bodyText;
    if (respondingProvider !== provider) {
      try {
        const rawJson = JSON.parse(bodyText);
        const normalized = normalizeResponse(rawJson, respondingProvider as GatewayProvider, usedModel);
        finalBodyText = JSON.stringify(normalized);
      } catch { /* not JSON, pass through */ }
    }

    try {
      const raw = JSON.parse(finalBodyText);
      // For telemetry we need an OpenAI-shaped view. finalBodyText is already
      // OpenAI-shaped for openai/azure/openai-compatible providers and for
      // cross-provider responses (normalized above). It is still NATIVE only for
      // same-provider anthropic/google calls (e.g. Claude Code → /gateway/anthropic,
      // returned verbatim to the client) — normalize those *for extraction* so
      // their usage (input_tokens / usageMetadata) and cost aren't recorded as 0.
      const nativeUnnormalized =
        respondingProvider === provider &&
        (respondingProvider === "anthropic" || respondingProvider === "google");
      const json = (nativeUnnormalized
        ? normalizeResponse(raw, respondingProvider as GatewayProvider, usedModel)
        : raw) as {
          model?: string; id?: string;
          usage?: {
            prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number; audio_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number; audio_tokens?: number };
          };
          choices?: Array<{ message?: { content?: string } }>;
        };
      model          = json.model        ?? usedModel;
      requestId      = json.id           ?? "";
      inputTokens    = json.usage?.prompt_tokens     ?? json.usage?.input_tokens  ?? 0;
      outputTokens   = json.usage?.completion_tokens ?? json.usage?.output_tokens ?? 0;
      cachedTokens   = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      // Modality sub-counts (OpenAI-family exposes these; native anthropic/google
      // are normalized above and don't carry the detail breakdown → 0, acceptable).
      reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      audioTokens     = (json.usage?.prompt_tokens_details?.audio_tokens ?? 0) + (json.usage?.completion_tokens_details?.audio_tokens ?? 0);
      completionText = json.choices?.[0]?.message?.content ?? "";
    } catch { /* non-JSON response — record with 0 tokens */ }

    // ── Guardrails: output-side rules (warn / block / redact) ─────────────
    // Non-streaming only — streaming output validation is a documented follow-up.
    // Reuses the mem-cached bundle; evaluates output/both rules against the
    // assistant message. Fails open. block → content replaced + finish_reason
    // "content_filter" (OpenAI-compatible); redact → masked content. A filtered
    // body is re-encoded into returnBuffer and never written to either cache.
    let guardrailFiltered = false;
    if (completionText) {
      try {
        const { rules: oRules, profiles: oProfiles } = await loadOrgGuardrails(orgId, supabaseAdmin);
        const outputRules = oRules.filter(r => r.apply_to === "output" || r.apply_to === "both");
        if (outputRules.length > 0) {
          const gctxOut: GuardrailContext = {
            direction: "output",
            request:   { model, provider, environment: requestedEnvironment, tags: runtimeTags as Record<string, string> },
            org:       { plan: (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter" },
          };
          const oDecision = await evaluateGuardrails({
            rules: outputRules, profiles: oProfiles, payload: [completionText], context: gctxOut,
          });

          if (oDecision.action !== "allow") {
            void ingestToTinybird([{
              event_id:      uuidv4(),
              timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
              org_id:        orgId,
              project_id:    projectId,
              project_name:  projectId,
              team_id:       "",
              user_id:       req.headers.get("x-prism-user-id") ?? "",
              environment:   gatewayEnvironment,
              provider:      provider,
              model:         model,
              input_tokens:  0,
              output_tokens: 0,
              cached_tokens: 0,
              image_tokens:  0,
              audio_tokens:  0,
              text_tokens:   0,
              modalities:    "text",
              cost_usd:      0,
              latency_ms:    0,
              ttft_ms:       0,
              status_code:   200,
              request_id:    uuidv4(),
              tags: {
                span_kind:        "guardrail",
                guardrail_dir:    "output",
                guardrail_action: oDecision.action,
                guardrail_types:  oDecision.detectedTypes.join(","),
              },
              ttl_days:        ttlDays,
              api_key_id:      apiKeyId,
              key_type:        "gateway",
              prism_cache_hit: 0,
              trace_id:        traceCtx.traceId,
              span_id:         uuidv4().replace(/-/g, ""),
              parent_span_id:  traceCtx.spanId,
            }]);
          }

          if (oDecision.action === "block") {
            const parsed = JSON.parse(finalBodyText);
            if (parsed?.choices?.[0]?.message) {
              parsed.choices[0].message.content = "[blocked by guardrail]";
              parsed.choices[0].finish_reason   = "content_filter";
            }
            finalBodyText  = JSON.stringify(parsed);
            completionText = "[blocked by guardrail]";
            guardrailFiltered = true;
            runtimeTags["guardrail_output_blocked"] = oDecision.detectedTypes.join(",") || "true";
            void logGatewayRejection({ orgId, apiKeyId, provider, model, environment: gatewayEnvironment, layer: "guardrail", rejectionCode: "guardrail_output_blocked", httpStatus: 200, reason: oDecision.reason ?? "Guardrail blocked output", traceId: traceCtx.traceId });
          } else if (oDecision.action === "redact" && oDecision.redactedPayload) {
            const maskedContent = String(oDecision.redactedPayload[0] ?? "");
            const parsed = JSON.parse(finalBodyText);
            if (parsed?.choices?.[0]?.message) parsed.choices[0].message.content = maskedContent;
            finalBodyText  = JSON.stringify(parsed);
            completionText = maskedContent;
            guardrailFiltered = true;
            runtimeTags["guardrail_output_redacted"] = oDecision.detectedTypes.join(",") || "true";
          } else if (oDecision.action === "warn") {
            runtimeTags["guardrail_output_flagged"] = oDecision.detectedTypes.join(",") || "true";
          }
        }
      } catch { /* fail open — never block delivery on a guardrails fault */ }
    }

    // Return the (possibly normalized / guardrail-filtered) body
    const returnBuffer = (respondingProvider !== provider || guardrailFiltered)
      ? new TextEncoder().encode(finalBodyText).buffer
      : buffered;

    await recordTelemetry(model, inputTokens, outputTokens, cachedTokens, requestId, completionText, 0, {
      reasoningTokens, imageTokens: 0, audioTokens,
    });

    // Store in prompt cache for future identical requests (fire-and-forget).
    // Skipped when the caller sent x-prism-cache-no-store. Uses the per-request
    // TTL override when present.
    if (cacheConfig.enabled && promptCacheKey && !cacheNoStore && upstreamRes!.ok && !guardrailFiltered) {
      const entry: CachedEntry = {
        response:     JSON.parse(finalBodyText),
        model,
        inputTokens,
        outputTokens,
        cachedAt:     Date.now(),
      };
      void setCached(promptCacheKey, entry, effectiveTtl);
    }

    // Tier 2: index the response under its prompt embedding so future
    // semantically-similar requests can hit it (fire-and-forget).
    if (cacheConfig.enabled && cacheConfig.mode === "semantic" && !cacheNoStore && !convoTooLong && upstreamRes!.ok && !guardrailFiltered) {
      try {
        const parsedResponse = JSON.parse(finalBodyText) as Record<string, unknown>;
        void semanticCacheSet(orgId, parsedBody?.messages ?? [], parsedResponse, {
          similarityThreshold: effectiveThreshold,
          embeddingModel:      "text-embedding-3-small",
        }, cachePartition);
      } catch { /* non-JSON response — skip semantic caching */ }
    }

    return new NextResponse(returnBuffer, {
      status:  upstreamRes!.status,
      headers: {
        "Content-Type":          "application/json",
        "X-RateLimit-Limit":     String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-Prism-Trace-Id":      traceCtx.traceId,
        "X-Prism-Span-Id":       traceCtx.spanId,
        ...(fallbackCount > 0 ? { "X-Prism-Routed-From": originalModel } : {}),
      },
    });
  }

  // Streaming: use a TransformStream to intercept SSE chunks as they flow to
  // the client. The flush() callback fires synchronously when the last chunk
  // passes through — the function is still alive at that point — so we can
  // await ingestToTinybird before the stream fully closes.
  // This avoids the tee() + fire-and-forget pattern where Vercel may starve
  // background microtasks after the response is sent (causing ~4 min delays).

  const decoder = new TextDecoder();
  // Provider-aware usage accumulation. Without branching on usedProvider, native
  // anthropic (message_start / message_delta) and google (usageMetadata) streams
  // never match the OpenAI usage shape → 0 tokens recorded → $0 cost on every
  // streamed native call (e.g. Claude Code → /gateway/anthropic).
  const usage: UsageSummary = newUsageSummary(usedModel);
  let   sseBuf        = "";
  let   sseCompletion = "";   // accumulate streamed completion text for logging
  let   sseTtftMs     = 0;    // time-to-first-token (ms from request start to first content delta)

  // Pull streamed completion text out of whichever native chunk shape applies so
  // prompt logging + TTFT work regardless of which provider actually served.
  const captureDelta = (json: Record<string, unknown>): void => {
    let text: string | undefined;
    if (usedProvider === "anthropic") {
      if (json.type === "content_block_delta") {
        text = (json.delta as { text?: string } | undefined)?.text;
      }
    } else if (usedProvider === "google") {
      const cands = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      text = cands?.[0]?.content?.parts?.map(p => p.text ?? "").join("") || undefined;
    } else {
      const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
      text = choices?.[0]?.delta?.content;
    }
    if (text) {
      sseCompletion += text;
      if (sseTtftMs === 0) sseTtftMs = Date.now() - start;
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);   // pass through to client immediately

      // Parse SSE lines for usage data + completion text
      sseBuf += decoder.decode(chunk, { stream: true });
      const lines = sseBuf.split("\n");
      sseBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        try {
          const json = JSON.parse(data) as Record<string, unknown>;
          extractUsage(usedProvider, json, usage);
          captureDelta(json);
        } catch { /* not JSON (e.g. anthropic `event:` lines) — ignore */ }
      }
    },
    async flush() {
      // All chunks delivered to client — now record telemetry synchronously.
      await recordTelemetry(usage.model || usedModel, usage.inputTokens, usage.outputTokens, usage.cachedTokens, usage.requestId, sseCompletion, sseTtftMs, {
        reasoningTokens: usage.reasoningTokens, imageTokens: usage.imageTokens, audioTokens: usage.audioTokens,
      });
    },
  });

  upstreamRes!.body!.pipeTo(transform.writable).catch(() => {});

  return new NextResponse(transform.readable, {
    status:  upstreamRes!.status,
    headers: {
      "Content-Type":          upstreamRes!.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control":         "no-cache",
      "X-Accel-Buffering":     "no",
      "X-RateLimit-Limit":     String(limit),
      "X-RateLimit-Remaining": String(remaining),
      ...(fallbackCount > 0 ? { "X-Prism-Routed-From": originalModel } : {}),
    },
  });
}

export { handle as GET, handle as POST };
