/**
 * PATCH /api/admin/keys/[id]
 *
 * Admin endpoint to clear an auto-paused API key.
 * Requires: authenticated org owner.
 *
 * Body:
 *   { action: "unblock" }   — clears auto_paused_at + auto_pause_reason
 *
 * Returns:
 *   200 { ok: true, key_id: string }
 *   401/403 if not authorized
 *   404 if key not found or doesn't belong to caller's org
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient }       from "@supabase/supabase-js";
import { requireAuth }        from "@/lib/supabase/auth";
import { clearAutoPause }     from "@/lib/gateway/auto-pause";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // Require owner role — only org owners can unblock keys
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: { action?: string };
  try { body = await req.json(); }
  catch { body = {}; }

  if (body.action !== "unblock") {
    return NextResponse.json(
      { error: "Unsupported action. Use { action: 'unblock' }" },
      { status: 400 },
    );
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Verify the key belongs to this org before clearing
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, auto_paused_at")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!keyRow) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  if (!(keyRow as { auto_paused_at?: string | null }).auto_paused_at) {
    return NextResponse.json({ ok: true, key_id: params.id, message: "Key is not paused" });
  }

  await clearAutoPause(supabaseAdmin, params.id);

  return NextResponse.json({ ok: true, key_id: params.id, message: "Key unblocked successfully" });
}
