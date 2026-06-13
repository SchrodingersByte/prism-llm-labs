/**
 * PATCH  /api/training-runs/[id]  — update a training run (cost, status)
 * DELETE /api/training-runs/[id]  — remove a training run entry
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { z } from "zod";

const PatchSchema = z.object({
  display_name:     z.string().max(200).optional(),
  status:           z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  cost_usd:         z.number().min(0).optional(),
  tokens_trained:   z.number().int().min(0).optional(),
  completed_at:     z.string().datetime().optional(),
  cost_center_code: z.string().max(50).optional().nullable(),
  fine_tuned_model: z.string().max(200).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: updateErr } = await (admin as any)
    .from("training_runs")
    .update({ ...body.data, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("org_id", member.org_id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("training_runs")
    .delete()
    .eq("id", params.id)
    .eq("org_id", member.org_id);

  return NextResponse.json({ success: true });
}
