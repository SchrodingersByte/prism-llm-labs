import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("report_schedules")
    .delete()
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = ["is_active", "recipients", "frequency", "day_of_week", "day_of_month", "format"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in (body as Record<string, unknown>)) {
      updates[key] = (body as Record<string, unknown>)[key];
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("report_schedules")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
