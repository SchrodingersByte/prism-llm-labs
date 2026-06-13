import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { validateCondition, validateAction, invalidatePolicyCache } from "@/lib/gateway/policy-router";
import { z } from "zod";

// Routing policies are org governance — owner/administrator only (enforced
// explicitly; the admin client bypasses RLS).

const PatchSchema = z.object({
  name:      z.string().min(1).max(120).optional(),
  priority:  z.number().int().min(0).max(9999).optional(),
  condition: z.unknown().optional(),
  action:    z.unknown().optional(),
  is_active: z.boolean().optional(),
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
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  if (body.data.condition !== undefined && !validateCondition(body.data.condition)) {
    return NextResponse.json({ error: "Invalid condition DSL" }, { status: 400 });
  }
  if (body.data.action !== undefined && !validateAction(body.data.action)) {
    return NextResponse.json({ error: "Invalid action: must include model and provider" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.name      !== undefined) updates.name      = body.data.name;
  if (body.data.priority  !== undefined) updates.priority  = body.data.priority;
  if (body.data.condition !== undefined) updates.condition = body.data.condition;
  if (body.data.action    !== undefined) updates.action    = body.data.action;
  if (body.data.is_active !== undefined) updates.is_active = body.data.is_active;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("routing_policies")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", member.org_id)
    .select("id, name, priority, condition, action, is_active, created_at, updated_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "Policy not found" }, { status: 404 });

  void invalidatePolicyCache(member.org_id);
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
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("routing_policies")
    .delete()
    .eq("id", params.id)
    .eq("org_id", member.org_id);

  void invalidatePolicyCache(member.org_id);
  return NextResponse.json({ ok: true });
}
