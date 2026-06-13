/**
 * POST /api/otel/v1/traces
 *
 * OTLP/JSON ingest endpoint. Accepts OpenTelemetry trace spans from any
 * framework (LangChain, custom wrappers, OpenLLMetry, etc.) and converts
 * LLM-related spans to Prism events in Tinybird.
 *
 * Only spans with gen_ai.* or llm.* attributes are ingested; infrastructure
 * spans are filtered out and counted in the "skipped" response field.
 *
 * Auth: same Prism API key as the SDK ingest endpoint (Authorization: Bearer).
 *
 * Content-Type: application/json (OTLP JSON encoding only — no binary protobuf).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { ingestRatelimit } from "@/lib/upstash/ratelimit";
import { planToTtlDays } from "@/lib/pricing/table";
import { mapOtlpToEvents } from "@/lib/otel/mapper";
import type { OtlpTracesPayload } from "@/lib/otel/types";

export async function POST(req: NextRequest) {
  // ── Authenticate ────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const apiKey     = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, is_active, expires_at, organizations(plan)")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "API key has expired" }, { status: 401 });
  }

  // ── Rate limit ───────────────────────────────────────────────────────────────
  const { success } = await ingestRatelimit.limit(keyHash);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: OtlpTracesPayload;
  try {
    body = await req.json() as OtlpTracesPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body?.resourceSpans)) {
    return NextResponse.json({ error: "Expected { resourceSpans: [...] }" }, { status: 400 });
  }

  // ── Map spans to Prism events ─────────────────────────────────────────────────
  const orgPlan  = (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter";
  const ttlDays  = planToTtlDays(orgPlan);
  const orgId    = keyRow.org_id as string;
  const apiKeyId = (keyRow as { id: string }).id;

  const { events, skipped } = mapOtlpToEvents(body, orgId, apiKeyId, ttlDays);

  if (events.length === 0) {
    return NextResponse.json({ accepted: 0, skipped, message: "No LLM spans found" });
  }

  // Enforce batch limit (same as /api/ingest)
  const MAX_BATCH = 500;
  if (events.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large: ${events.length} events (max ${MAX_BATCH})` },
      { status: 413 },
    );
  }

  // ── Ingest to Tinybird ────────────────────────────────────────────────────────
  try {
    await ingestToTinybird(events);
  } catch (err) {
    console.error("[otel] Tinybird ingest failed:", err);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  return NextResponse.json({ accepted: events.length, skipped });
}
