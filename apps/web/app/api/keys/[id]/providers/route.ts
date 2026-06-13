/**
 * PATCH /api/keys/[id]/providers
 * Adds or removes provider key links for a gateway Prism key.
 *
 * Body: { add?: string[], remove?: string[] }
 *   add    — array of provider_key UUIDs to link to this Prism key
 *   remove — array of provider_key UUIDs to unlink from this Prism key
 *
 * GET /api/keys/[id]/providers
 * Returns all provider keys currently linked to this Prism key (from key_provider_links).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const PatchSchema = z.object({
  add:    z.array(z.string().uuid()).optional(),
  remove: z.array(z.string().uuid()).optional(),
}).refine(
  (d) => (d.add?.length ?? 0) > 0 || (d.remove?.length ?? 0) > 0,
  { message: "Provide at least one provider_key_id in add or remove" },
);

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Verify key belongs to org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (admin as any)
    .from("api_keys")
    .select("id, org_id")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!keyRow) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  // Fetch linked provider keys from junction table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: links } = await (admin as any)
    .from("key_provider_links")
    .select(`
      provider_key_id,
      is_primary,
      provider_keys ( id, name, provider, key_hint, is_active, created_at, allowed_models )
    `)
    .eq("api_key_id", params.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linked = (links ?? []).map((l: any) => ({
    provider_key_id: l.provider_key_id,
    is_primary:      l.is_primary,
    ...(l.provider_keys ?? {}),
  }));

  // (The legacy api_keys.provider_key_id fallback was removed — that column was
  // dropped from api_keys; key_provider_links is now the sole source of links.)

  return NextResponse.json({ data: linked });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify key belongs to org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (admin as any)
    .from("api_keys")
    .select("id, org_id")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!keyRow) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  const { add = [], remove = [] } = parsed.data;

  // Validate all provider_key_ids belong to this org
  const allIds = [...add, ...remove];
  if (allIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pkRows } = await (admin as any)
      .from("provider_keys")
      .select("id")
      .eq("org_id", ctx.orgId)
      .in("id", allIds);

    const validIds = new Set((pkRows ?? []).map((r: { id: string }) => r.id));
    const invalid  = allIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Provider key(s) not found in org: ${invalid.join(", ")}` },
        { status: 404 },
      );
    }
  }

  const errors: string[] = [];

  // Add links
  if (add.length > 0) {
    // Determine is_primary: first linked key for each provider gets primary flag
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (admin as any)
      .from("key_provider_links")
      .select("provider_key_id, provider_keys ( provider )")
      .eq("api_key_id", params.id);

    const linkedProviders = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (existing ?? []).map((r: any) => r.provider_keys?.provider as string),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: addPks } = await (admin as any)
      .from("provider_keys")
      .select("id, provider")
      .in("id", add);

    const insertRows = (addPks ?? []).map((pk: { id: string; provider: string }) => ({
      api_key_id:      params.id,
      provider_key_id: pk.id,
      is_primary:      !linkedProviders.has(pk.provider),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = await (admin as any)
      .from("key_provider_links")
      .upsert(insertRows, { onConflict: "api_key_id,provider_key_id", ignoreDuplicates: true });

    if (insertErr) errors.push(`add: ${insertErr.message}`);
  }

  // Remove links
  if (remove.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteErr } = await (admin as any)
      .from("key_provider_links")
      .delete()
      .eq("api_key_id", params.id)
      .in("provider_key_id", remove);

    if (deleteErr) errors.push(`remove: ${deleteErr.message}`);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
  }

  // Return updated list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated } = await (admin as any)
    .from("key_provider_links")
    .select(`
      provider_key_id,
      is_primary,
      provider_keys ( id, name, provider, key_hint, is_active, created_at, allowed_models )
    `)
    .eq("api_key_id", params.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ data: (updated ?? []).map((l: any) => ({ provider_key_id: l.provider_key_id, is_primary: l.is_primary, ...(l.provider_keys ?? {}) })) });
}
