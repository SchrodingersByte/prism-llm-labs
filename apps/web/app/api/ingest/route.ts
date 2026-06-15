import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { incrementSpend, incrementSpendIfBelowLimit, checkKeyCaps, checkAllKeyCaps, incrementKeySpend, incrementKeyDailySpend, incrementTeamSpend, incrementTeamSpendIfBelowLimit, trackSpendVelocity } from "@/lib/upstash/redis";
import { ingestRatelimit } from "@/lib/upstash/ratelimit";
import { planToTtlDays } from "@/lib/pricing/table";
import { checkOrgModelPolicy } from "@/lib/gateway/model-policy";
import { autoPauseKey } from "@/lib/gateway/auto-pause";
import { writeContent } from "@/lib/content/store";
import { z } from "zod";

const EventSchema = z.object({
  event_id:      z.string(),
  timestamp:     z.string(),
  org_id:        z.string().default(""),   // overridden from authenticated key â€” not required in body
  project_id:    z.string().default(""),
  project_name:  z.string().default(""),
  team_id:       z.string().default(""),
  user_id:       z.string().default(""),
  environment:   z.string().default("production"),
  provider:      z.string(),
  model:         z.string(),
  input_tokens:  z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative().default(0),
  cost_usd:      z.number().nonnegative(),
  latency_ms:    z.number().int().nonnegative(),
  ttft_ms:       z.number().int().nonnegative().default(0),
  status_code:   z.number().int(),
  request_id:    z.string().default(""),
  tags:          z.record(z.string()).default({}),
  // Multi-modal token sub-fields (optional; default 0 / empty)
  image_tokens:  z.number().int().nonnegative().default(0),
  audio_tokens:  z.number().int().nonnegative().default(0),
  text_tokens:   z.number().int().nonnegative().default(0),
  modalities:    z.string().default("text"),
  // OpenTelemetry-style trace context (optional; default empty string)
  trace_id:       z.string().default(""),
  span_id:        z.string().default(""),
  parent_span_id: z.string().default(""),
  // PRD-0 — optional captured content. Persisted (redacted) to request_logs via
  // writeContent(); stripped before Tinybird so raw content never leaves for analytics.
  payload: z.object({
    prompt:       z.array(z.unknown()).optional(),
    completion:   z.string().optional(),
    context:      z.array(z.unknown()).optional(),
    tool_io:      z.array(z.unknown()).optional(),
    pre_redacted: z.boolean().optional(),
  }).optional(),
});

const BatchSchema = z.object({
  events: z.array(EventSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("cf-connecting-ip")
    ?? null;

  // Fire-and-forget helper â€” never blocks the response path
  function writeLog(params: {
    org_id?:     string;
    api_key_id?: string;
    key_prefix?: string;
    project_id?: string;
    event_count?: number;
    total_cost?:  number;
    status:       "ok" | "invalid_key" | "rate_limited" | "budget_exceeded" | "branch_required" | "error";
    error_code?:  string;
  }) {
    void Promise.resolve(
      supabaseAdmin.from("ingest_log").insert({
        org_id:      params.org_id      ?? null,
        api_key_id:  params.api_key_id  ?? null,
        key_prefix:  params.key_prefix  ?? null,
        project_id:  params.project_id  ?? null,
        event_count: params.event_count ?? 0,
        total_cost:  params.total_cost  ?? 0,
        status:      params.status,
        error_code:  params.error_code  ?? null,
        latency_ms:  Date.now() - requestStart,
        source_ip:   sourceIp,
      }),
    ).catch(() => {});
  }

  // Authenticate via Prism API key in Authorization header
  const authHeader = req.headers.get("authorization") ?? "";
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!apiKey) {
    writeLog({ status: "invalid_key", error_code: "missing_key" });
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const keyHash   = createHash("sha256").update(apiKey).digest("hex");
  const keyPrefix = apiKey.slice(0, 12);
  // NOTE: user_id / assigned_user_id / cost_hard_cap_usd / daily_cost_cap_usd /
  // usage_buffer_pct were dropped from api_keys (caps now live in key_caps). The
  // code below reads each via an optional cast; with them absent the legacy per-key
  // cap pre-check simply no-ops and user attribution falls back to "".
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, project_id, is_active, expires_at, auto_paused_at, auto_pause_reason, key_prefix, prompt_logging_enabled, organizations(plan)")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    writeLog({ status: "invalid_key", error_code: "key_not_found", key_prefix: keyPrefix });
    return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, status: "invalid_key", error_code: "key_expired" });
    return NextResponse.json({ error: "API key has expired" }, { status: 401 });
  }

  // â”€â”€ Auto-pause check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if ((keyRow as { auto_paused_at?: string | null }).auto_paused_at) {
    writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, status: "budget_exceeded", error_code: "key_auto_paused" });
    return NextResponse.json(
      {
        error:        "key_auto_paused",
        reason:       (keyRow as { auto_pause_reason?: string | null }).auto_pause_reason ?? "hard_cap_exceeded",
        paused_since: (keyRow as { auto_paused_at: string }).auto_paused_at,
        message:      "This API key has been automatically paused due to a hard budget cap being exceeded. Contact your workspace admin to unblock it.",
      },
      { status: 403 },
    );
  }

  // Gap 5 â€” rate limit per API key (500 events/min)
  const { success, limit, remaining } = await ingestRatelimit.limit(keyHash);
  if (!success) {
    writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, status: "rate_limited" });
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After":          "60",
          "X-RateLimit-Limit":    String(limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Key-level cost cap pre-check (fast path before parsing all events)
  const kr = keyRow as {
    id: string; cost_hard_cap_usd?: number | null;
    daily_cost_cap_usd?: number | null; usage_buffer_pct?: number | null;
  };
  if (kr.cost_hard_cap_usd || kr.daily_cost_cap_usd) {
    // Rough total cost from the raw body to check caps before full parse
    let roughCost = 0;
    try {
      const rawEvents = (body as { events?: { cost_usd?: number }[] })?.events ?? [];
      roughCost = rawEvents.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
    } catch { /* skip */ }

    const capStatus = await checkKeyCaps(
      kr.id, roughCost,
      kr.cost_hard_cap_usd ?? null,
      kr.daily_cost_cap_usd ?? null,
      kr.usage_buffer_pct ?? 0,
    );
    if (capStatus !== "ok") {
      writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, status: "budget_exceeded", error_code: capStatus });
      return NextResponse.json(
        { error: capStatus === "exceeded_daily" ? "daily_key_budget_exceeded" : "key_budget_exceeded" },
        { status: 402 },
      );
    }
  }

  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, status: "error", error_code: "validation_failed" });
    return NextResponse.json(
      { error: parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request" },
      { status: 400 },
    );
  }

  const { events } = parsed.data;

  // Branch tracking enforcement: reject if project has a connected repo but no branch tag
  const enforcedProjectId = (keyRow as { project_id?: string | null }).project_id;
  if (enforcedProjectId) {
    const { count } = await supabaseAdmin
      .from("project_github_repos" as any)
      .select("id", { count: "exact", head: true })
      .eq("project_id", enforcedProjectId);

    if ((count ?? 0) > 0) {
      const hasBranch = events.some(e => (e.tags["git_branch"] ?? "") !== "");
      if (!hasBranch) {
        writeLog({ org_id: keyRow.org_id, api_key_id: keyRow.id, key_prefix: (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix, project_id: enforcedProjectId, event_count: events.length, status: "branch_required" });
        return NextResponse.json({
          error:   "branch_tracking_required",
          message: "This project requires git branch tracking. Set GITHUB_REF_NAME env var or ensure the SDK is running inside a git repo.",
        }, { status: 422 });
      }
    }
  }

  // â”€â”€ SDK mode policy enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Closes the gap between gateway and SDK wrapper modes. The gateway enforces
  // all 8 access-control layers; SDK wrapper mode previously bypassed them all.
  // Here we enforce the two stateless-enough policies to run post-hoc:
  //
  //   âœ…  Multi-period spend caps  (key_caps table via checkAllKeyCaps)
  //   âœ…  Model governance policy  (org_model_policies + 60s in-process cache)
  //   âŒ  Data residency           â€” impossible; provider call already happened
  //   âŒ  PII detection            â€” ingest events carry no message content;
  //                                  enforce at the SDK call site or use gateway mode
  {
    type CapsRow = { id: string; period: string; is_rolling: boolean; amount_usd: number; environment: string | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sdkCapsRows } = await (supabaseAdmin as any)
      .from("key_caps")
      .select("id, period, is_rolling, amount_usd, environment")
      .eq("api_key_id", (keyRow as { id: string }).id) as { data: CapsRow[] | null };

    const sdkCaps = sdkCapsRows ?? [];
    if (sdkCaps.length > 0) {
      try {
        const firstEnv  = events[0]?.environment ?? "production";
        const capResult = await checkAllKeyCaps(
          (keyRow as { id: string }).id,
          sdkCaps,
          firstEnv,
          keyRow.org_id,
        );
        if (capResult === "circuit_open") {
          writeLog({
            org_id:      keyRow.org_id,
            api_key_id:  (keyRow as { id: string }).id,
            key_prefix:  (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix,
            status:      "budget_exceeded",
            error_code:  "circuit_open",
          });
          return NextResponse.json(
            { error: "circuit_open", message: "Upstream provider circuit is open. Retry after 5 minutes." },
            { status: 503 },
          );
        }
        if (capResult !== "ok") {
          // Auto-pause: lock the key so subsequent requests get fast 403
          void autoPauseKey(supabaseAdmin, (keyRow as { id: string }).id, "hard_cap_exceeded");
          writeLog({
            org_id:      keyRow.org_id,
            api_key_id:  (keyRow as { id: string }).id,
            key_prefix:  (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix,
            status:      "budget_exceeded",
            error_code:  capResult,
          });
          return NextResponse.json(
            { error: "key_budget_exceeded", cap_id: capResult.split(":")[1] },
            { status: 402 },
          );
        }
      } catch { /* Redis unavailable â€” fail open; never block SDK telemetry on infra error */ }
    }

    // Model governance â€” check each unique model in the batch (60s in-memory cache, negligible overhead)
    const uniqueModels = Array.from(new Set(events.map(e => e.model).filter(Boolean)));
    for (const model of uniqueModels) {
      const eventEnv = events.find(e => e.model === model)?.environment ?? "production";
      try {
        const policyResult = await checkOrgModelPolicy(
          supabaseAdmin,
          keyRow.org_id,
          model,
          eventEnv,
          (keyRow as { id: string }).id,
        );
        if (!policyResult.allowed) {
          return NextResponse.json(
            {
              error:   policyResult.requiresApproval ? "model_requires_approval" : "model_blocked_by_policy",
              message: policyResult.reason,
            },
            { status: 403 },
          );
        }
      } catch { /* fail open â€” never block ingestion due to policy lookup failure */ }
    }
  }

  // Gap 10 â€” derive ttl_days from org plan
  const orgPlan   = (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter";
  const ttlDays   = planToTtlDays(orgPlan);

  // Portal is source of truth â€” override org, project, user, and key from the key record
  const sanitised = events.map((e) => ({
    ...e,
    // Normalize timestamp to "YYYY-MM-DD HH:MM:SS.mmm" â€” Tinybird DateTime64 rejects ISO 8601 Z-suffix
    timestamp:  new Date(e.timestamp).toISOString().replace("T", " ").slice(0, 23),
    org_id:     keyRow.org_id,
    project_id: (keyRow as { project_id?: string | null }).project_id || e.project_id || "",
    user_id:    (keyRow as { assigned_user_id?: string | null; user_id?: string | null }).assigned_user_id
                  ?? (keyRow as { user_id?: string | null }).user_id
                  ?? "",
    api_key_id:       (keyRow as { id: string }).id,
    ttl_days:         ttlDays,
    key_type:         "analytics",   // ingest route is always SDK/analytics path
    prism_cache_hit:  0,             // not applicable in SDK mode
  }));

  // PRD-0: drop captured content from the Tinybird payload (it is persisted,
  // redacted, to request_logs via writeContent() below; raw content stays out of Tinybird).
  for (const o of sanitised) delete (o as { payload?: unknown }).payload;

  // Gap 4 â€” atomic hard-cap enforcement before ingesting
  const byProject = new Map<string, number>();
  for (const e of sanitised) {
    const pid = e.project_id || "default";
    byProject.set(pid, (byProject.get(pid) ?? 0) + e.cost_usd);
  }

  // Fetch budgets for projects that have hard caps
  for (const [pid, totalCost] of Array.from(byProject.entries())) {
    const { data: budgetRow } = await supabaseAdmin
      .from("budgets")
      .select("amount_usd, enforce_hard_cap")
      .eq("org_id", keyRow.org_id)
      .eq("project_id", pid)
      .eq("enforce_hard_cap", true)
      .eq("period", "monthly")
      .limit(1)
      .maybeSingle();

    if (budgetRow) {
      const result = await incrementSpendIfBelowLimit(
        keyRow.org_id, pid, totalCost, budgetRow.amount_usd,
      );
      if (result === "exceeded") {
        return NextResponse.json({ error: "budget_exceeded" }, { status: 402 });
      }
      // Already incremented atomically â€” skip this project in the normal increment pass
      byProject.delete(pid);
    }
  }

  // Team-level hard-cap enforcement (analogous to project budget check above)
  const byTeam = new Map<string, number>();
  for (const e of sanitised) {
    if (e.team_id) {
      byTeam.set(e.team_id, (byTeam.get(e.team_id) ?? 0) + e.cost_usd);
    }
  }
  for (const [tid, totalCost] of Array.from(byTeam.entries())) {
    const { data: teamBudget } = await supabaseAdmin
      .from("budgets")
      .select("amount_usd, enforce_hard_cap")
      .eq("org_id", keyRow.org_id)
      .eq("team_id", tid)
      .eq("enforce_hard_cap", true)
      .eq("period", "monthly")
      .limit(1)
      .maybeSingle();

    if (teamBudget) {
      const result = await incrementTeamSpendIfBelowLimit(
        keyRow.org_id, tid, totalCost, teamBudget.amount_usd,
      );
      if (result === "exceeded") {
        return NextResponse.json({ error: "team_budget_exceeded" }, { status: 402 });
      }
      byTeam.delete(tid); // already atomically incremented
    }
  }

  // Gap 3 â€” forward to Tinybird with retry; Redis increment still runs on failure
  try {
    await ingestToTinybird(sanitised);
  } catch (err) {
    console.error("[prism] Tinybird ingest failed after retries:", err);

    // Increment Redis for projects not handled by the atomic path above
    await Promise.all(
      Array.from(byProject.entries()).map(([pid, cost]) =>
        incrementSpend(keyRow.org_id, pid, cost),
      ),
    );

    await supabaseAdmin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("key_hash", keyHash);

    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  // ── PRD-0: persist captured content (fire-and-forget; never blocks ingest) ──
  {
    const promptLoggingEnabled = (keyRow as { prompt_logging_enabled?: boolean }).prompt_logging_enabled ?? false;
    const keyProjectId         = (keyRow as { project_id?: string | null }).project_id ?? null;
    for (const e of events) {
      const p = e.payload;
      if (!p) continue;
      void writeContent({
        orgId:        keyRow.org_id,
        source:       "sdk",
        apiKeyId:     (keyRow as { id: string }).id,
        projectId:    keyProjectId || e.project_id || null,
        eventId:      e.event_id,
        model:        e.model,
        provider:     e.provider,
        prompt:       p.prompt,
        completion:   p.completion ?? null,
        context:      p.context,
        toolIo:       p.tool_io,
        inputTokens:  e.input_tokens,
        outputTokens: e.output_tokens,
        costUsd:      e.cost_usd,
        latencyMs:    e.latency_ms,
        statusCode:   e.status_code,
        sessionId:    e.tags?.session_id,
        traceId:      e.trace_id,
        spanId:       e.span_id,
        preRedacted:  p.pre_redacted,
        promptLoggingEnabled,
      });
    }
  }

  // Increment Redis for non-hard-cap projects (those not already atomically incremented)
  await Promise.all([
    ...Array.from(byProject.entries()).map(([pid, cost]) =>
      incrementSpend(keyRow.org_id, pid, cost),
    ),
    // Team counters â€” increment remaining teams not handled by atomic path
    ...Array.from(byTeam.entries()).map(([tid, cost]) =>
      incrementTeamSpend(keyRow.org_id, tid, cost),
    ),
  ]);

  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash);

  // Key-level spend counters â€” only needed when caps are configured
  const totalEventCost = sanitised.reduce((s, e) => s + e.cost_usd, 0);
  if (totalEventCost > 0 && (kr.cost_hard_cap_usd || kr.daily_cost_cap_usd)) {
    await Promise.all([
      incrementKeySpend((keyRow as { id: string }).id, totalEventCost),
      incrementKeyDailySpend((keyRow as { id: string }).id, totalEventCost),
    ]);
  }

  // Velocity tracking (fire-and-forget) â€” feeds the velocity_spike alert type
  if (totalEventCost > 0) {
    void trackSpendVelocity(keyRow.org_id, (keyRow as { id: string }).id, totalEventCost);
  }

  const totalCostFinal = sanitised.reduce((s, e) => s + e.cost_usd, 0);
  writeLog({
    org_id:      keyRow.org_id,
    api_key_id:  (keyRow as { id: string }).id,
    key_prefix:  (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix,
    project_id:  (keyRow as { project_id?: string | null }).project_id ?? undefined,
    event_count: sanitised.length,
    total_cost:  totalCostFinal,
    status:      "ok",
  });

  return NextResponse.json(
    { ok: true, ingested: sanitised.length },
    {
      headers: {
        "X-RateLimit-Limit":     String(limit),
        "X-RateLimit-Remaining": String(remaining),
      },
    },
  );
}
