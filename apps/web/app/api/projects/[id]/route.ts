import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const PatchSchema = z.object({
  status:            z.enum(["active", "inactive"]).optional(),
  name:              z.string().min(1).max(100).optional(),
  description:       z.string().max(500).optional(),
  cost_center_code:  z.string().max(50).optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (admin as any)
    .from("projects")
    .select("id, name, description, status, monthly_budget_usd, daily_budget_usd, created_at")
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: project });
}

/**
 * Can the caller manage this project's settings? Org owner/administrator (canManage)
 * OR a project-scoped member holding an owner/administrator grant on this project.
 * Mirrors the can_manage_project() RLS helper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canManageProject(admin: any, orgId: string, userId: string, projectId: string, canManageOrg: boolean): Promise<boolean> {
  if (canManageOrg) return true;
  const { data: m } = await admin.from("members").select("id").eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { id: string } | null };
  if (!m) return false;
  const { data: g } = await admin.from("member_project_roles").select("role").eq("member_id", m.id).eq("project_id", projectId).maybeSingle() as { data: { role: string } | null };
  return g?.role === "owner" || g?.role === "administrator";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (admin as any)
    .from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Org owners/admins manage any project; a project administrator manages theirs.
  if (!(await canManageProject(admin, ctx.orgId, ctx.user.id, params.id, ctx.canManage))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.status           !== undefined) updates.status           = parsed.data.status;
  if (parsed.data.name             !== undefined) updates.name             = parsed.data.name;
  if (parsed.data.description      !== undefined) updates.description      = parsed.data.description;
  if (parsed.data.cost_center_code !== undefined) updates.cost_center_code = parsed.data.cost_center_code;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (admin as any)
    .from("projects").update(updates).eq("id", params.id);
  if (updateErr) return NextResponse.json({ error: "Failed to update project" }, { status: 500 });

  // When marking inactive: revoke all associated active keys
  let revokedCount = 0;
  if (parsed.data.status === "inactive") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: activeKeys } = await (admin as any)
      .from("api_keys")
      .select("id, name")
      .eq("project_id", params.id)
      .eq("is_active", true);

    if (activeKeys?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (activeKeys as any[]).map((k: { id: string }) => k.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from("api_keys").update({ is_active: false }).in("id", ids);
      revokedCount = ids.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const k of activeKeys as any[]) {
        await writeAuditLog({
          orgId: ctx.orgId, actorUserId: ctx.user.id,
          action: "key.revoked", targetType: "api_key", targetId: k.id,
          metadata: { name: k.name, reason: "project_deactivated", project_id: params.id },
        });
      }
    }
  }

  return NextResponse.json({ success: true, revoked_count: revokedCount });
}
