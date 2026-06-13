/**
 * POST /api/projects/[id]/log-access — a non-manager requests access to this
 *   project's prompt/completion logs.
 * GET  /api/projects/[id]/log-access — managers see all requests; others see own.
 *
 * "Manager" = org owner/administrator OR a project owner/administrator grant
 * (mirrors can_manage_project). Managers already have log access — they don't
 * request. Approval state lives in log_access_requests.status.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type AuthContext } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const BodySchema = z.object({ message: z.string().max(500).optional() });

// Caller's access to a project: canRead (org-scoped any role, or a project grant)
// and canManage (org owner/admin, or project owner/administrator grant).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function projectAccess(admin: any, ctx: AuthContext, projectId: string): Promise<{ canRead: boolean; canManage: boolean }> {
  if (ctx.scopeType === "organization") return { canRead: true, canManage: ctx.canManage };
  const { data: m } = await admin.from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", ctx.user.id).maybeSingle() as { data: { id: string } | null };
  if (!m) return { canRead: false, canManage: false };
  const { data: g } = await admin.from("member_project_roles").select("role").eq("member_id", m.id).eq("project_id", projectId).maybeSingle() as { data: { role: string } | null };
  if (!g) return { canRead: false, canManage: false };
  return { canRead: true, canManage: g.role === "owner" || g.role === "administrator" };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const access = await projectAccess(admin, ctx, params.id);
  if (!access.canRead) return NextResponse.json({ error: "You are not a collaborator on this project" }, { status: 403 });
  if (access.canManage) return NextResponse.json({ error: "You already have log access to this project" }, { status: 400 });

  const { data: existing } = await admin
    .from("log_access_requests").select("status")
    .eq("project_id", params.id).eq("requester_id", ctx.user.id).maybeSingle() as { data: { status: string } | null };
  if (existing?.status === "approved") return NextResponse.json({ error: "You already have log access" }, { status: 400 });

  let body: unknown;
  try { body = await req.json().catch(() => ({})); } catch { body = {}; }
  const parsed = BodySchema.safeParse(body);
  const message = parsed.success ? (parsed.data.message ?? null) : null;

  // Upsert so re-requesting after a denial resets to pending.
  const { data: inserted, error } = await admin
    .from("log_access_requests")
    .upsert(
      { project_id: params.id, requester_id: ctx.user.id, org_id: ctx.orgId, message, status: "pending", resolved_by: null, resolved_at: null },
      { onConflict: "project_id,requester_id" },
    )
    .select("id, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  return NextResponse.json({ data: inserted }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: project } = await admin.from("projects").select("id").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const access = await projectAccess(admin, ctx, params.id);

  let query = admin
    .from("log_access_requests")
    .select("id, requester_id, message, status, resolved_at, created_at")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false });

  // Non-managers only see their own request.
  if (!access.canManage) query = query.eq("requester_id", ctx.user.id);

  const { data } = await query;
  return NextResponse.json({ data: data ?? [] });
}
