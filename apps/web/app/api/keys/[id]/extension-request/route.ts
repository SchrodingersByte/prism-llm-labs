import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const RequestSchema = z.object({
  request_type:    z.enum(["expire_extension", "cost_increase", "daily_cap_increase", "usage_buffer", "renewal"]),
  current_value:   z.string().optional(),
  requested_value: z.string().min(1),
  reason:          z.string().min(10).max(1000),
  urgency:         z.enum(["low", "medium", "high"]).default("medium"),
});

// POST — assignee submits an extension request
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // Verify the key is assigned to this user (or they're an admin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: key } = await (admin as any)
    .from("api_keys")
    .select("id, name, org_id, expires_at")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  // assigned_user_id was dropped from api_keys — keys are no longer user-scoped, so
  // any authenticated member of the key's org may submit an extension request (the
  // key is already verified to belong to ctx.orgId above); an owner reviews it.

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  // Derive current_value from the key if not provided. cost/daily/usage_buffer caps
  // live in key_caps and renewal_period was dropped, so only the expiry has a live
  // current value to derive here; the rest default to "none".
  let currentValue = parsed.data.current_value ?? "";
  if (!currentValue) {
    currentValue = parsed.data.request_type === "expire_extension"
      ? (key.expires_at ?? "no expiry")
      : "none";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (admin as any)
    .from("key_extension_requests" as any)
    .insert({
      api_key_id:      key.id,
      requester_id:    ctx.user.id,
      org_id:          ctx.orgId,
      request_type:    parsed.data.request_type,
      current_value:   currentValue,
      requested_value: parsed.data.requested_value,
      reason:          parsed.data.reason,
      urgency:         parsed.data.urgency,
      status:          "pending",
    })
    .select("id, request_type, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });

  return NextResponse.json({ data: inserted }, { status: 201 });
}

// GET — list extension requests for a key (admin/owner + assignee can see their own)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: key } = await (admin as any)
    .from("api_keys")
    .select("id, org_id")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  const isPrivileged = ctx.isOwner;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("key_extension_requests" as any)
    .select("id, request_type, current_value, requested_value, reason, urgency, status, approved_by, resolved_at, created_at, requester_id")
    .eq("api_key_id", params.id)
    .order("created_at", { ascending: false });

  if (!isPrivileged) {
    query = query.eq("requester_id", ctx.user.id);
  }

  const { data } = await query;
  return NextResponse.json({ data: data ?? [] });
}
