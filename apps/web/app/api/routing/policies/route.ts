import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";
import { validateCondition, validateAction, invalidatePolicyCache } from "@/lib/gateway/policy-router";
import { z } from "zod";

const PolicySchema = z.object({
  name:      z.string().min(1).max(120),
  priority:  z.number().int().min(0).max(9999).default(100),
  condition: z.unknown(),   // validated structurally below via validateCondition()
  action:    z.unknown(),   // validated structurally below via validateAction()
  is_active: z.boolean().default(true),
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
    .from("routing_policies")
    .select("id, name, priority, condition, action, is_active, created_at, updated_at")
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

  const guard = await checkFeature(member.org_id, "routing_rules");
  if (guard) return guard;

  const body = PolicySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  // Structural validation of condition DSL and action
  if (!validateCondition(body.data.condition)) {
    return NextResponse.json({ error: "Invalid condition: must be a valid JSON DSL node (field/op/value, all, any, or not)" }, { status: 400 });
  }
  if (!validateAction(body.data.action)) {
    return NextResponse.json({ error: "Invalid action: must include model (string) and provider (string)" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("routing_policies")
    .insert({
      org_id:    member.org_id,
      name:      body.data.name,
      priority:  body.data.priority,
      condition: body.data.condition,
      action:    body.data.action,
      is_active: body.data.is_active,
    })
    .select("id, name, priority, condition, action, is_active, created_at, updated_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  void invalidatePolicyCache(member.org_id);
  return NextResponse.json({ data }, { status: 201 });
}
