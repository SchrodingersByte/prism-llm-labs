import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

/** DELETE /api/teams/[id]/members/[user_id] — remove a member from a team */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; user_id: string } },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("team_members")
    .delete()
    .eq("team_id", params.id)
    .eq("user_id", params.user_id);

  return NextResponse.json({ success: true });
}
