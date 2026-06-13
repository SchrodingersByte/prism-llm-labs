import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { recordGatewayError } from "@/lib/upstash/circuit-breaker";

/**
 * POST /api/telemetry/errors
 *
 * Advisory endpoint called fire-and-forget by SDK wrapper mode when its
 * in-process circuit breaker opens. Updates the shared Redis cb:open key so
 * the gateway and other SDK instances also see the tripped state.
 *
 * No session auth required — authenticated by the Prism API key in the body.
 * Rate impact is negligible: the SDK only calls this once per breaker-open event
 * (5 errors in 60s), not on every request.
 */
export async function POST(req: NextRequest) {
  let body: { apiKey?: unknown; provider?: unknown; error_type?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { apiKey, provider, error_type } = body;

  if (typeof apiKey !== "string" || !apiKey.startsWith("prism_")) {
    return NextResponse.json({ error: "invalid api key" }, { status: 400 });
  }
  if (typeof provider !== "string" || !provider) {
    return NextResponse.json({ error: "provider required" }, { status: 400 });
  }

  const normalizedErrorType =
    error_type === "cost_spike" || error_type === "rate_limit"
      ? (error_type as "cost_spike" | "rate_limit")
      : "provider_error";

  // Resolve org_id + key id from the API key hash — same pattern as the gateway route.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    // Unknown key — return 200 anyway to avoid leaking key existence to the SDK.
    return NextResponse.json({ ok: true });
  }

  try {
    await recordGatewayError(keyRow.org_id, keyRow.id, normalizedErrorType);
  } catch {
    // Redis unavailable — not fatal, breaker state just stays in-process only.
  }

  return NextResponse.json({ ok: true });
}
