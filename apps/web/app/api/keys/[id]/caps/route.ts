/**
 * GET  /api/keys/[id]/caps  — list all spend caps for this key
 * POST /api/keys/[id]/caps  — add a new cap (max one per period+rolling combo)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const CreateCapSchema = z.object({
  period:      z.enum(["daily", "weekly", "monthly"]),
  is_rolling:  z.boolean().default(false),
  amount_usd:  z.number().positive(),
  environment: z.enum(["production", "staging", "development"]).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (admin as any)
    .from("api_keys").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!keyRow) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("key_caps")
    .select("id, period, is_rolling, amount_usd, environment, created_at")
    .eq("api_key_id", params.id)
    .order("period");

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
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

  const parsed = CreateCapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (admin as any)
    .from("api_keys").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!keyRow) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("key_caps")
    .upsert(
      {
        api_key_id:  params.id,
        org_id:      ctx.orgId,
        period:      parsed.data.period,
        is_rolling:  parsed.data.is_rolling,
        amount_usd:  parsed.data.amount_usd,
        environment: parsed.data.environment ?? null,
      },
      { onConflict: "api_key_id,period,is_rolling,environment" },
    )
    .select("id, period, is_rolling, amount_usd, environment, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
