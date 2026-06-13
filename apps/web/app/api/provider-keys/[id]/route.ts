import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const PatchSchema = z.object({
  name:                    z.string().min(1).max(100).optional(),
  description:             z.string().max(500).optional(),
  account_label:           z.string().max(100).optional(),
  use_for_reconciliation:  z.boolean().optional(),
  azure_endpoint:          z.string().url().optional().or(z.literal("")),
  /** Allowlist of model names. Pass [] to remove restrictions. */
  allowed_models:          z.array(z.string()).optional(),
  aws_region:              z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify ownership
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("provider_keys")
    .select("id, provider, name")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle() as { data: { id: string; provider: string; name: string } | null };

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build update payload — only include fields that were provided
  const updates: Record<string, unknown> = {};
  if (body.data.name                    !== undefined) updates.name                   = body.data.name;
  // description & account_label were dropped from provider_keys — accepted but not persisted.
  if (body.data.use_for_reconciliation  !== undefined) updates.use_for_reconciliation = body.data.use_for_reconciliation;
  if (body.data.azure_endpoint          !== undefined) updates.azure_endpoint         = body.data.azure_endpoint || null;
  if (body.data.allowed_models          !== undefined) updates.allowed_models          = body.data.allowed_models;
  if (body.data.aws_region              !== undefined) updates.aws_region              = body.data.aws_region || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("provider_keys")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (dbErr) return NextResponse.json({ error: "Failed to update" }, { status: 500 });

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "provider.updated", targetType: "provider_key", targetId: params.id,
    metadata: { name: existing.name, fields_updated: Object.keys(updates) },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("provider_keys")
    .select("id, provider, name")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle() as { data: { id: string; provider: string; name: string } | null };

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cascade: revoke all active Prism keys linked to this provider key.
  // Links live in key_provider_links now (api_keys.provider_key_id was dropped).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: links } = await (admin as any)
    .from("key_provider_links")
    .select("api_key_id")
    .eq("provider_key_id", params.id);
  const linkedKeyIds = Array.from(
    new Set(((links ?? []) as Array<{ api_key_id: string }>).map((l) => l.api_key_id)),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linkedKeys } = linkedKeyIds.length
    ? await (admin as any)
        .from("api_keys")
        .select("id, name")
        .in("id", linkedKeyIds)
        .eq("is_active", true)
    : { data: [] as Array<{ id: string; name: string }> };

  if (linkedKeys?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = (linkedKeys as any[]).map((k: { id: string }) => k.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("api_keys").update({ is_active: false }).in("id", ids);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const k of linkedKeys as any[]) {
      await writeAuditLog({
        orgId: ctx.orgId, actorUserId: ctx.user.id,
        action: "key.revoked", targetType: "api_key", targetId: k.id,
        metadata: { name: k.name, reason: "provider_key_deleted", provider_key_id: params.id },
      });
    }
  }

  // Soft-delete (keeps audit trail intact)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("provider_keys")
    .update({ is_active: false })
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (dbErr) return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action:      "provider.deleted",
    targetType:  "provider_key",
    targetId:    params.id,
    metadata:    { provider: existing.provider, name: existing.name, revoked_key_count: linkedKeys?.length ?? 0 },
  });

  return NextResponse.json({ success: true, revoked_key_count: linkedKeys?.length ?? 0 });
}
