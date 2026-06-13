import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  // When approving, optionally apply the change to the key immediately
  apply:  z.boolean().default(true),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  if (!ctx.isOwner) {
    return NextResponse.json({ error: "Only org owners can review extension requests" }, { status: 403 });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: extReq } = await (admin as any)
    .from("key_extension_requests" as any)
    .select("id, api_key_id, org_id, request_type, requested_value, status")
    .eq("id", params.reqId)
    .eq("api_key_id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!extReq) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (extReq.status !== "pending") return NextResponse.json({ error: "Request already resolved" }, { status: 409 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const newStatus = parsed.data.action === "approve" ? "approved" : "rejected";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("key_extension_requests" as any)
    .update({ status: newStatus, approved_by: ctx.user.id, resolved_at: new Date().toISOString() })
    .eq("id", params.reqId);

  // If approved and apply=true, write the change directly to the key.
  // NOTE: cost_hard_cap_usd / daily_cost_cap_usd / usage_buffer_pct / renewal_period
  // were dropped from api_keys (caps now live in key_caps), so only expire_extension
  // still maps to a live column. Approving the other request types records the
  // approval but no longer mutates the key — set those caps via /api/keys/[id]/caps.
  if (parsed.data.action === "approve" && parsed.data.apply && extReq.request_type === "expire_extension") {
    const val = extReq.requested_value as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("api_keys")
      .update({ expires_at: val === "none" ? null : val })
      .eq("id", extReq.api_key_id);
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
