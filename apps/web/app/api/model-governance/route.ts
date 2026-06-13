/**
 * GET  /api/model-governance  â€” list org model policies
 * POST /api/model-governance  â€” create a policy
 * DELETE /api/model-governance?id=â€¦ â€” delete a policy
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const PolicySchema = z.object({
  model_pattern: z.string().min(1).max(200),
  environments:  z.array(z.string()).nullable().default(null),
  policy:        z.enum(["allowed", "blocked", "requires_approval"]),
});

// â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("org_model_policies" as any)
    .select("id, model_pattern, environments, policy, created_at, created_by")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ data: data ?? [] });
}

// â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const guard = await checkFeature(member.org_id, "model_governance");
  if (guard) return guard;

  const admin = createAdminClient();

  // Only admins/owners can create policies
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members")
    .select("role")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string } | null };
  if (!["owner", "administrator"].includes(memberRow?.role ?? "")) {
    return NextResponse.json({ error: "Only admins can manage model policies" }, { status: 403 });
  }

  const body = PolicySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: insertErr } = await (admin as any)
    .from("org_model_policies" as any)
    .insert({
      org_id:        member.org_id,
      model_pattern: body.data.model_pattern,
      environments:  body.data.environments,
      policy:        body.data.policy,
      created_by:    user.id,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: "Failed to create policy" }, { status: 500 });

  await writeAuditLog({
    orgId: member.org_id, actorUserId: user.id,
    action: "model_policy.created", targetType: "org_model_policy", targetId: (data as { id: string }).id,
    metadata: body.data,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// â”€â”€ DELETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members")
    .select("role")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string } | null };
  if (!["owner", "administrator"].includes(memberRow?.role ?? "")) {
    return NextResponse.json({ error: "Only admins can delete model policies" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("org_model_policies" as any)
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  await writeAuditLog({
    orgId: member.org_id, actorUserId: user.id,
    action: "model_policy.deleted", targetType: "org_model_policy", targetId: id,
    metadata: {},
  });

  return NextResponse.json({ success: true });
}
