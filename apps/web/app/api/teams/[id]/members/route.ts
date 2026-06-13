import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

const AddSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
});

/** POST /api/teams/[id]/members — add one or more org members to a team */
export async function POST(
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

  // Verify team belongs to org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team } = await (admin as any)
    .from("teams").select("id").eq("id", params.id).eq("org_id", member.org_id).maybeSingle();
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  // Only add users who are actual org members
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgMembers } = await (admin as any)
    .from("members")
    .select("user_id")
    .eq("org_id", member.org_id)
    .in("user_id", parsed.data.user_ids) as { data: { user_id: string }[] | null };

  const validUserIds = (orgMembers ?? []).map(m => m.user_id);
  if (validUserIds.length === 0) {
    return NextResponse.json({ error: "None of the specified users are org members" }, { status: 400 });
  }

  const inserts = validUserIds.map(uid => ({
    team_id: params.id, user_id: uid, added_by: user.id,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("team_members")
    .upsert(inserts, { onConflict: "team_id,user_id", ignoreDuplicates: true });

  return NextResponse.json({ success: true, added: validUserIds.length });
}
