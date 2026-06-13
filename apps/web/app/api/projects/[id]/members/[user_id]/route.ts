import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";

const PatchSchema = z.object({
  role: z.enum(["administrator", "developer", "read_only"]),
});

/** Org owner/admin, or a project owner/administrator grant on this project. Mirrors can_manage_project(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canManageProject(admin: any, orgId: string, userId: string, projectId: string, canManageOrg: boolean): Promise<boolean> {
  if (canManageOrg) return true;
  const { data: m } = await admin.from("members").select("id").eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { id: string } | null };
  if (!m) return false;
  const { data: g } = await admin.from("member_project_roles").select("role").eq("member_id", m.id).eq("project_id", projectId).maybeSingle() as { data: { role: string } | null };
  return g?.role === "owner" || g?.role === "administrator";
}

/**
 * PATCH /api/projects/[id]/members/[user_id] — change a collaborator's project role.
 * Auth: org owner/admin or a project administrator.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; user_id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!(await canManageProject(admin, ctx.orgId, ctx.user.id, params.id, ctx.canManage))) {
    return NextResponse.json({ error: "Forbidden — project administrator or org owner/admin required" }, { status: 403 });
  }

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid role" }, { status: 400 });

  const { data: target } = await admin.from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", params.user_id).maybeSingle() as { data: { id: string } | null };
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { data: updated } = await admin
    .from("member_project_roles")
    .update({ role: parsed.data.role })
    .eq("member_id", target.id)
    .eq("project_id", params.id)
    .select("id")
    .maybeSingle() as { data: { id: string } | null };

  if (!updated) return NextResponse.json({ error: "User is not a project-scoped member of this project" }, { status: 404 });

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "member.role_changed", targetType: "project", targetId: params.id,
    metadata: { target_user_id: params.user_id, role: parsed.data.role },
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/projects/[id]/members/[user_id] — remove a collaborator's grant.
 * Auth: org owner/admin, a project administrator, or the member removing themselves.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; user_id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const isSelfExit = params.user_id === ctx.user.id;
  if (!isSelfExit && !(await canManageProject(admin, ctx.orgId, ctx.user.id, params.id, ctx.canManage))) {
    return NextResponse.json({ error: "Forbidden — project administrator or org owner/admin required" }, { status: 403 });
  }

  const { data: target } = await admin.from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", params.user_id).maybeSingle() as { data: { id: string } | null };
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { error: deleteErr } = await admin
    .from("member_project_roles")
    .delete()
    .eq("member_id", target.id)
    .eq("project_id", params.id);
  if (deleteErr) return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "member.removed", targetType: "project", targetId: params.id,
    metadata: { target_user_id: params.user_id, self_exit: isSelfExit },
  });

  return NextResponse.json({ success: true });
}
