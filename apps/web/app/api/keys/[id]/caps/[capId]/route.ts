/**
 * PATCH  /api/keys/[id]/caps/[capId]  — update amount on an existing cap
 * DELETE /api/keys/[id]/caps/[capId]  — remove a cap
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const PatchSchema = z.object({
  amount_usd: z.number().positive(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; capId: string } },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("key_caps")
    .update({ amount_usd: parsed.data.amount_usd })
    .eq("id", params.capId)
    .eq("org_id", ctx.orgId)
    .select("id, period, is_rolling, amount_usd")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; capId: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("key_caps")
    .delete()
    .eq("id", params.capId)
    .eq("org_id", ctx.orgId);

  return NextResponse.json({ ok: true });
}
