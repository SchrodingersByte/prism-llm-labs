import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const UpdateBudgetSchema = z.object({
  amount_usd:       z.number().positive().optional(),
  alert_pct:        z.number().int().min(1).max(100).optional(),
  enforce_hard_cap: z.boolean().optional(),
  period:           z.enum(["monthly", "daily"]).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: dbErr } = await (admin as any)
    .from("budgets")
    .update(parsed.data)
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (dbErr) return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("budgets")
    .delete()
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (dbErr) return NextResponse.json({ error: "Failed to delete budget" }, { status: 500 });

  return NextResponse.json({ success: true });
}
