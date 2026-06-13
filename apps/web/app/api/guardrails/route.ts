import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { validateCondition } from "@/lib/gateway/policy-router";
import { invalidateGuardrailsCache } from "@/lib/gateway/guardrails/store";
import { z } from "zod";

// Guardrail RULES CRUD. Profiles live at /api/guardrails/profiles.
// Reads: any org member. Writes: org owner/administrator only (governance) —
// enforced explicitly because the admin client bypasses RLS.

const RuleSchema = z.object({
  profile_id:    z.string().uuid(),
  name:          z.string().min(1),
  apply_to:      z.enum(["input", "output", "both"]).default("both"),
  action:        z.enum(["warn", "block", "redact"]),
  priority:      z.number().int().min(0).optional(),
  sampling_rate: z.number().min(0).max(1).optional(),
  condition:     z.any().optional(),
});

const RulePatchSchema = z.object({
  id:            z.string().uuid(),
  name:          z.string().min(1).optional(),
  apply_to:      z.enum(["input", "output", "both"]).optional(),
  action:        z.enum(["warn", "block", "redact"]).optional(),
  priority:      z.number().int().min(0).optional(),
  sampling_rate: z.number().min(0).max(1).optional(),
  condition:     z.any().optional(),
  is_active:     z.boolean().optional(),
});

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("guardrail_rules" as any)
    .select(`
      id, profile_id, name, priority, apply_to, action, condition,
      sampling_rate, is_active, created_at,
      guardrail_profiles ( name, type )
    `)
    .eq("org_id", member.org_id)
    .order("priority", { ascending: true });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = RuleSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  const { profile_id, name, apply_to, action, priority, sampling_rate, condition } = body.data;

  if (condition !== undefined && condition !== null && !validateCondition(condition)) {
    return NextResponse.json({ error: "Invalid condition DSL" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The referenced profile must belong to this org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (admin as any)
    .from("guardrail_profiles" as any)
    .select("id")
    .eq("id", profile_id)
    .eq("org_id", member.org_id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not found in this org" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("guardrail_rules" as any)
    .insert({
      org_id:        member.org_id,
      profile_id,
      name,
      apply_to,
      action,
      priority:      priority ?? 100,
      sampling_rate: sampling_rate ?? 1,
      condition:     condition ?? null,
      is_active:     true,
    })
    .select("id, profile_id, name, priority, apply_to, action, condition, sampling_rate, is_active, created_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  await invalidateGuardrailsCache(member.org_id);
  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = RulePatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  const { id, condition, ...rest } = body.data;

  if (condition !== undefined && condition !== null && !validateCondition(condition)) {
    return NextResponse.json({ error: "Invalid condition DSL" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { ...rest };
  if (condition !== undefined) patch.condition = condition;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("guardrail_rules" as any)
    .update(patch)
    .eq("id", id)
    .eq("org_id", member.org_id)
    .select("id, profile_id, name, priority, apply_to, action, condition, sampling_rate, is_active, created_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  await invalidateGuardrailsCache(member.org_id);
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("guardrail_rules" as any)
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  await invalidateGuardrailsCache(member.org_id);
  return NextResponse.json({ ok: true });
}
