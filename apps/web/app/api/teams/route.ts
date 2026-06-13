import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";

const CreateSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  description: z.string().max(500).trim().optional(),
  user_ids:    z.array(z.string().uuid()).default([]),
});

/** GET /api/teams — list all teams for the caller's org with member count */
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();

  // Fetch teams with member counts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: teams, error: dbErr } = await (admin as any)
    .from("teams")
    .select("id, name, description, created_by, created_at, team_members(user_id)")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false });

  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  // Shape: include member_count and user_ids list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shaped = (teams ?? []).map((t: any) => ({
    id:           t.id,
    name:         t.name,
    description:  t.description,
    created_by:   t.created_by,
    created_at:   t.created_at,
    member_count: (t.team_members ?? []).length,
    user_ids:     (t.team_members ?? []).map((m: { user_id: string }) => m.user_id),
  }));

  return NextResponse.json({ data: shaped });
}

/** POST /api/teams — create a new team (owner/admin only) */
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();

  // Any member except viewer can create a team (developers can organise their own groups)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members").select("role")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as
    { data: { role: string } | null };

  if ((memberRow?.role ?? "viewer") === "viewer") {
    return NextResponse.json({ error: "Viewers cannot create teams" }, { status: 403 });
  }

  const guard = await checkFeature(member.org_id, "team_management");
  if (guard) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const { name, description, user_ids } = parsed.data;

  // Insert team
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team, error: insertErr } = await (admin as any)
    .from("teams")
    .insert({ org_id: member.org_id, name, description: description ?? null, created_by: user.id })
    .select("id, name, description, created_at")
    .single() as { data: { id: string; name: string; description: string | null; created_at: string } | null; error: unknown };

  if (!team) return NextResponse.json({ error: "Failed to create team" }, { status: 500 });

  // Add initial members (if any)
  if (user_ids.length > 0) {
    const memberInserts = user_ids.map(uid => ({
      team_id: team.id, user_id: uid, added_by: user.id,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("team_members").insert(memberInserts);
  }

  return NextResponse.json({ data: { ...team, member_count: user_ids.length, user_ids } }, { status: 201 });
}
