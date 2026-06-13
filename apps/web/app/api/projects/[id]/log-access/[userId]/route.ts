/**
 * PATCH /api/projects/[id]/log-access/[userId]
 * A manager (org owner/administrator OR project owner/administrator) approves or
 * denies a collaborator's log-access request. Approval state is the request's
 * status (the denormalized project_members.log_access_approved column was dropped).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const BodySchema = z.object({ action: z.enum(["approve", "deny"]) });

/** Org owner/admin, or a project owner/administrator grant on this project. Mirrors can_manage_project(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canManageProject(admin: any, orgId: string, userId: string, projectId: string, canManageOrg: boolean): Promise<boolean> {
  if (canManageOrg) return true;
  const { data: m } = await admin.from("members").select("id").eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { id: string } | null };
  if (!m) return false;
  const { data: g } = await admin.from("member_project_roles").select("role").eq("member_id", m.id).eq("project_id", projectId).maybeSingle() as { data: { role: string } | null };
  return g?.role === "owner" || g?.role === "administrator";
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!(await canManageProject(admin, ctx.orgId, ctx.user.id, params.id, ctx.canManage))) {
    return NextResponse.json({ error: "Only project administrators or org owners/admins can manage log access" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "action must be 'approve' or 'deny'" }, { status: 400 });

  const approved = parsed.data.action === "approve";
  const now      = new Date().toISOString();

  const { data: updated } = await admin
    .from("log_access_requests")
    .update({ status: approved ? "approved" : "denied", resolved_by: ctx.user.id, resolved_at: now })
    .eq("project_id", params.id)
    .eq("requester_id", params.userId)
    .select("id")
    .maybeSingle() as { data: { id: string } | null };

  if (!updated) return NextResponse.json({ error: "No log-access request found for this user" }, { status: 404 });

  return NextResponse.json({ ok: true, access_granted: approved });
}
