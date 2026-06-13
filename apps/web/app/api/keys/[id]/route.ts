import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const PatchKeySchema = z.object({
  name:               z.string().min(1).max(100).optional(),
  provider_key_id:    z.string().uuid().nullable().optional(),  // owners can link/unlink provider keys
  assigned_user_id:   z.string().uuid().nullable().optional(),  // null = unassign; owners can assign any member
  cost_hard_cap_usd:  z.number().positive().nullable().optional(),
  daily_cost_cap_usd: z.number().positive().nullable().optional(),
  renewal_period:     z.enum(["monthly", "quarterly", "annual", "none"]).nullable().optional(),
  usage_buffer_pct:        z.number().int().min(0).max(100).optional(),
  auto_renew:              z.boolean().optional(),
  expires_at:              z.string().datetime().nullable().optional(),
  prompt_logging_enabled:  z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  if (!ctx.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // If reassigning a member, verify they belong to this org
  if (parsed.data.assigned_user_id !== undefined && parsed.data.assigned_user_id !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: assignee } = await (admin as any)
      .from("members")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("user_id", parsed.data.assigned_user_id)
      .maybeSingle();
    if (!assignee) {
      return NextResponse.json({ error: "Assigned user is not an org member" }, { status: 400 });
    }
  }

  // Only name / expires_at / prompt_logging_enabled remain live columns on api_keys.
  // provider_key_id / assigned_user_id / cost_hard_cap_usd / daily_cost_cap_usd /
  // usage_buffer_pct / renewal_period / auto_renew were dropped (caps live in key_caps,
  // links in key_provider_links), so they're accepted but not persisted here.
  const keyUpdates: Record<string, unknown> = {};
  if (parsed.data.name                   !== undefined) keyUpdates.name                   = parsed.data.name;
  if (parsed.data.expires_at             !== undefined) keyUpdates.expires_at             = parsed.data.expires_at;
  if (parsed.data.prompt_logging_enabled !== undefined) keyUpdates.prompt_logging_enabled = parsed.data.prompt_logging_enabled;

  if (Object.keys(keyUpdates).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (admin as any)
      .from("api_keys")
      .update(keyUpdates)
      .eq("id", params.id)
      .eq("org_id", ctx.orgId);

    if (updateErr) return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }

  // Auto-apply: mark any pending extension requests satisfied by this change
  const fieldToRequestType: Record<string, string> = {
    cost_hard_cap_usd:  "cost_increase",
    daily_cost_cap_usd: "daily_cap_increase",
    expires_at:         "expire_extension",
    renewal_period:     "renewal",
    usage_buffer_pct:   "usage_buffer",
  };

  const updatedFields = Object.keys(parsed.data).filter(f => f in fieldToRequestType);
  if (updatedFields.length > 0) {
    const requestTypes = updatedFields.map(f => fieldToRequestType[f]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("key_extension_requests" as any)
      .update({ status: "auto_applied", approved_by: ctx.user.id, resolved_at: new Date().toISOString() })
      .eq("api_key_id", params.id)
      .eq("status", "pending")
      .in("request_type", requestTypes);
  }

  // If this PATCH includes a member assignment change, emit a dedicated audit event
  const action = ("assigned_user_id" in parsed.data)
    ? (parsed.data.assigned_user_id ? "key.assigned" : "key.unassigned")
    : "key.updated";

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action,
    targetType:  "api_key",
    targetId:    params.id,
    metadata:    parsed.data as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("api_keys")
    .select("id, name")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle() as { data: { id: string; name: string } | null };

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // api_keys.assigned_user_id was dropped — keys are no longer user-scoped, so the
  // per-user "revoke your own key" path can't be verified. Only owners may revoke.
  if (!ctx.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (dbErr) return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action:      "key.revoked",
    targetType:  "api_key",
    targetId:    params.id,
    metadata:    { name: existing.name },
  });

  return NextResponse.json({ success: true });
}
