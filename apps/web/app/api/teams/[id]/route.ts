import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

const PatchSchema = z.object({
  name:        z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).trim().nullable().optional(),
});

async function resolveTeam(admin: unknown, teamId: string, orgId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("teams").select("id, org_id, name, description")
    .eq("id", teamId).eq("org_id", orgId).maybeSingle() as
    { data: { id: string; org_id: string; name: string; description: string | null } | null };
  return data;
}

/** GET /api/teams/[id] — get a team with its full member list */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  const team = await resolveTeam(admin, params.id, member.org_id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: members } = await (admin as any)
    .from("team_members")
    .select("user_id, added_by, created_at")
    .eq("team_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ data: { ...team, members: members ?? [] } });
}

/** PATCH /api/teams/[id] — rename or update description */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members").select("role")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as
    { data: { role: string } | null };

  if (!["owner", "administrator"].includes(memberRow?.role ?? "")) {
    return NextResponse.json({ error: "Owner or admin required" }, { status: 403 });
  }

  const team = await resolveTeam(admin, params.id, member.org_id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated } = await (admin as any)
    .from("teams")
    .update({ ...parsed.data })
    .eq("id", params.id)
    .select("id, name, description")
    .single();

  return NextResponse.json({ data: updated });
}

/** DELETE /api/teams/[id] — delete a team (members are unaffected) */
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
  const { data: memberRow } = await (admin as any)
    .from("members").select("role")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as
    { data: { role: string } | null };

  if (!["owner", "administrator"].includes(memberRow?.role ?? "")) {
    return NextResponse.json({ error: "Owner or admin required" }, { status: 403 });
  }

  const team = await resolveTeam(admin, params.id, member.org_id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("teams").delete().eq("id", params.id);

  return NextResponse.json({ success: true });
}
