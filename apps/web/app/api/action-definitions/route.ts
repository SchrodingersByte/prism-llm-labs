/**
 * GET    /api/action-definitions       — list action definitions for org
 * POST   /api/action-definitions       — create an action definition
 * DELETE /api/action-definitions?id=…  — delete an action definition
 *
 * Action definitions map feature tags to business actions:
 * e.g. "Support Ticket" = feature=support_chat, calls_per_action=3
 * Enables cost_per_action = feature_cost / (feature_requests / calls_per_action)
 *
 * Reads: any org member. Writes: org owner/administrator (config).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { z } from "zod";

const CreateSchema = z.object({
  name:             z.string().min(1).max(100),
  feature_tag:      z.string().min(1).max(100),
  calls_per_action: z.number().positive().default(1),
  description:      z.string().max(500).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("action_definitions")
    .select("id, name, feature_tag, calls_per_action, description, created_at")
    .eq("org_id", member.org_id)
    .order("name");

  return NextResponse.json({ data: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: insertErr } = await (admin as any)
    .from("action_definitions")
    .insert({
      org_id:           member.org_id,
      name:             body.data.name,
      feature_tag:      body.data.feature_tag,
      calls_per_action: body.data.calls_per_action,
      description:      body.data.description ?? null,
    })
    .select("id, name, feature_tag, calls_per_action, description, created_at")
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("action_definitions")
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  return NextResponse.json({ success: true });
}
