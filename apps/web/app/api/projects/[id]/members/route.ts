import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

// Project grants use the org_role vocabulary (owner is org-level, not assignable here).
const AddMemberSchema = z.object({
  user_id: z.string().uuid(),
  role:    z.enum(["administrator", "developer", "read_only"]).default("developer"),
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
 * GET — project-scoped collaborators (member_project_roles grants on this project).
 * Org-scoped members have implicit access to every project and are not listed here.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: rows } = await admin
    .from("member_project_roles")
    .select("role, created_at, members ( user_id )")
    .eq("project_id", params.id) as {
      data: Array<{ role: string; created_at: string; members: { user_id: string } | null }> | null;
    };

  const data = (rows ?? [])
    .filter(r => r.members?.user_id)
    .map(r => ({ user_id: r.members!.user_id, role: r.role, created_at: r.created_at }));

  return NextResponse.json({ data });
}

/**
 * POST — grant an org member a project-scoped role on this project.
 * Auth: org owner/admin or a project administrator.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!(await canManageProject(admin, ctx.orgId, ctx.user.id, params.id, ctx.canManage))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = AddMemberSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });

  const { user_id, role } = parsed.data;

  // Target must be an org member; the grant attaches to their members row.
  const { data: target } = await admin.from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", user_id).maybeSingle() as { data: { id: string } | null };
  if (!target) return NextResponse.json({ error: "User is not an org member" }, { status: 400 });

  const { error: upsertErr } = await admin
    .from("member_project_roles")
    .upsert({ member_id: target.id, project_id: params.id, role }, { onConflict: "member_id,project_id" });
  if (upsertErr) return NextResponse.json({ error: "Failed to add member" }, { status: 500 });

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "member.joined", targetType: "project", targetId: params.id,
    metadata: { user_id, role },
  });

  return NextResponse.json({ success: true });
}
