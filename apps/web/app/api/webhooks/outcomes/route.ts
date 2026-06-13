/**
 * POST /api/webhooks/outcomes?org_id=...
 *
 * Generic outcome webhook for Zapier, Make, n8n, or any HTTP-capable integration.
 * Accepts arbitrary JSON payloads and maps them to outcome_events via configured rules.
 *
 * Security: HMAC-SHA256 signature using the org's webhook_secret (stored in organizations).
 * Header: x-prism-signature: sha256=<hmac>
 *
 * Alternatively: accept via Prism API key in Authorization header for simpler setups.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { processOutcomeRules } from "@/lib/outcomes/rules";
import { z } from "zod";

const SingleEventSchema = z.object({
  feature_tag:  z.string().min(1).max(100),
  action_tag:   z.string().max(100).optional(),
  session_id:   z.string().max(200).optional(),
  success:      z.boolean().default(true),
  value_usd:    z.number().nonnegative().optional(),
  metadata:     z.record(z.unknown()).optional(),
  occurred_at:  z.string().optional(),
});

export async function POST(req: NextRequest) {
  const orgId  = req.nextUrl.searchParams.get("org_id");
  const rawKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let resolvedOrgId: string;

  if (rawKey) {
    // API-key auth path (simpler, works the same as /api/outcomes)
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const { data: keyRow } = await supabaseAdmin
      .from("api_keys")
      .select("org_id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();
    if (!keyRow) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    resolvedOrgId = keyRow.org_id as string;
  } else if (orgId) {
    // HMAC signature path (for third-party integrations)
    const signature = req.headers.get("x-prism-signature") ?? "";
    const rawBody   = await req.text();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: org } = await (supabaseAdmin as any)
      .from("organizations")
      .select("webhook_secret")
      .eq("id", orgId)
      .maybeSingle() as { data: { webhook_secret?: string } | null };

    const secret = org?.webhook_secret;
    if (secret && signature) {
      const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
      try {
        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
          return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }
    resolvedOrgId = orgId;
  } else {
    return NextResponse.json({ error: "Provide Authorization header or org_id query param" }, { status: 400 });
  }

  let body: unknown;
  try { body = JSON.parse(await req.text().catch(() => "{}")); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // If body is a direct outcome event, dispatch it via processOutcomeRules
  const parsed = SingleEventSchema.safeParse(body);
  if (parsed.success) {
    // Direct single-event format — store immediately without rule processing
    const { error } = await supabaseAdmin.from("outcome_events").insert({
      org_id:      resolvedOrgId,
      feature_tag: parsed.data.feature_tag,
      action_tag:  parsed.data.action_tag  ?? null,
      session_id:  parsed.data.session_id  ?? null,
      success:     parsed.data.success,
      value_usd:   parsed.data.value_usd   ?? null,
      metadata:    parsed.data.metadata    ?? null,
      occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Generic payload — run through outcome rules
  await processOutcomeRules(
    "generic_webhook",
    body as Record<string, unknown>,
    resolvedOrgId,
  );

  return NextResponse.json({ ok: true });
}
