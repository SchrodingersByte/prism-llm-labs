/**
 * POST /api/outcomes
 *
 * Inbound outcome webhook — records that a feature or action produced a result.
 * Feeds the `cost_per_outcome` Tinybird pipe to compute actual (not estimated)
 * cost per successful action in the Unit Economics dashboard.
 *
 * Auth: Prism API key (Authorization: Bearer {key})
 *
 * Body:
 *   feature_tag  string   required  — matches x-prism-feature tag on LLM events
 *   action_tag   string?  optional  — matches x-prism-action tag
 *   session_id   string?  optional  — correlates to an agent session
 *   success      boolean  default true
 *   value_usd    number?  optional  — monetary value of this outcome (for ROI)
 *   metadata     object?  optional  — arbitrary context
 *   occurred_at  string?  optional  — ISO timestamp (defaults to now)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@supabase/supabase-js";
import { createHash }                from "crypto";
import { ingestToTinybird }          from "@/lib/tinybird/client";
import { z }                         from "zod";
import { v4 as uuidv4 }              from "uuid";

const OutcomeSchema = z.object({
  feature_tag:  z.string().min(1).max(100),
  action_tag:   z.string().max(100).optional(),
  session_id:   z.string().max(200).optional(),
  success:      z.boolean().default(true),
  value_usd:    z.number().nonnegative().optional(),
  metadata:     z.record(z.unknown()).optional(),
  occurred_at:  z.string().optional(),
});

const BatchSchema = z.object({
  events: z.array(OutcomeSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
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
    .select("id, org_id, is_active, expires_at")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "API key has expired" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Support both single event and batch envelope
  const normalised = (body as Record<string, unknown>)?.events
    ? body
    : { events: [body] };

  const parsed = BatchSchema.safeParse(normalised);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const now    = new Date().toISOString();
  const orgId  = keyRow.org_id  as string;
  const keyId  = (keyRow as { id: string }).id;

  const dbRows = parsed.data.events.map(e => ({
    org_id:      orgId,
    api_key_id:  keyId,
    feature_tag: e.feature_tag,
    action_tag:  e.action_tag  ?? null,
    session_id:  e.session_id  ?? null,
    success:     e.success,
    value_usd:   e.value_usd   ?? null,
    metadata:    e.metadata    ?? null,
    occurred_at: e.occurred_at ?? now,
  }));

  // Persist to Supabase for SQL queries
  const { error: dbErr } = await supabaseAdmin
    .from("outcome_events")
    .insert(dbRows);

  if (dbErr) {
    console.error("[outcomes] DB insert failed:", dbErr.message);
  }

  // Also ingest to Tinybird for analytics joins
  const tbEvents = parsed.data.events.map((e, i) => ({
    event_id:    uuidv4(),
    org_id:      orgId,
    feature_tag: e.feature_tag,
    action_tag:  e.action_tag  ?? "",
    session_id:  e.session_id  ?? "",
    success:     e.success ? 1 : 0,
    value_usd:   e.value_usd   ?? 0,
    occurred_at: e.occurred_at ?? now,
  }));

  try {
    await ingestToTinybird(tbEvents, "outcome_events");
  } catch (err) {
    console.error("[outcomes] Tinybird ingest failed:", err);
  }

  return NextResponse.json({ ok: true, recorded: dbRows.length });
}
