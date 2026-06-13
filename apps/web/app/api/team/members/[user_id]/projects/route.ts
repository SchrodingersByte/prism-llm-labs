import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * PUT /api/team/members/[user_id]/projects — set a member's project assignments.
 *
 * New scope model: assigning specific projects makes the member PROJECT-SCOPED
 * (scope_type='project', role NULL) with one member_project_roles grant per
 * project (default 'developer'). Owner-only; the owner cannot be reassigned this
 * way (use ownership transfer / org-role change instead).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { user_id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { user_id } = params;

  const { data: targetMember } = await admin
    .from("members").select("id, role")
    .eq("org_id", ctx.orgId).eq("user_id", user_id).maybeSingle() as { data: { id: string; role: string | null } | null };
  if (!targetMember) return NextResponse.json({ error: "User not found in org" }, { status: 404 });
  if (targetMember.role === "owner") {
    return NextResponse.json({ error: "The owner cannot be scoped to projects — transfer ownership first" }, { status: 400 });
  }

  let body: { project_ids?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const projectIds: string[] = Array.isArray(body.project_ids) ? body.project_ids : [];

  if (projectIds.length > 0) {
    const { data: valid } = await admin
      .from("projects").select("id").eq("org_id", ctx.orgId).in("id", projectIds);
    if ((valid ?? []).length !== projectIds.length) {
      return NextResponse.json({ error: "One or more invalid project IDs" }, { status: 400 });
    }
  }

  // Make the member project-scoped and replace their grants with exactly these.
  await admin.from("members")
    .update({ scope_type: "project", role: null })
    .eq("org_id", ctx.orgId).eq("user_id", user_id);

  await admin.from("member_project_roles").delete().eq("member_id", targetMember.id);

  if (projectIds.length > 0) {
    await admin.from("member_project_roles").insert(
      projectIds.map(pid => ({ member_id: targetMember.id, project_id: pid, role: "developer" })),
    );
  }

  return NextResponse.json({ success: true });
}
