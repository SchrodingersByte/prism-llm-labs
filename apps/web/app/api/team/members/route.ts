import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDisplayName } from "@/lib/supabase/users";

/**
 * GET /api/team/members — org members (email/name, role, scope, project
 * assignments) plus pending invites. Owner/administrator only.
 *
 * Project assignments come from member_project_roles, which is keyed by
 * members.id — so we map member_id → user_id to attribute them.
 */
export async function GET() {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: projects } = await admin.from("projects").select("id, name").eq("org_id", ctx.orgId);
  const projName = new Map<string, string>((projects ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

  const [{ data: members }, { data: invites }, authRes] = await Promise.all([
    admin.from("members").select("id, user_id, role, scope_type, created_at").eq("org_id", ctx.orgId),
    admin.from("pending_invites").select("email, role, scope_type, created_at").eq("org_id", ctx.orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const memberList = (members ?? []) as Array<{ id: string; user_id: string; role: string | null; scope_type: string; created_at: string }>;

  // Per-project grants (member_project_roles is keyed by member_id).
  const memberIds = memberList.map(m => m.id);
  const memberIdToUser = new Map<string, string>(memberList.map(m => [m.id, m.user_id]));
  const { data: mprs } = memberIds.length
    ? await admin.from("member_project_roles").select("member_id, project_id, role").in("member_id", memberIds)
    : { data: [] as Array<{ member_id: string; project_id: string; role: string }> };

  const assignments = new Map<string, { id: string; name: string; role: string }[]>();
  for (const r of (mprs ?? []) as Array<{ member_id: string; project_id: string; role: string }>) {
    const uid = memberIdToUser.get(r.member_id);
    if (!uid) continue;
    const arr = assignments.get(uid) ?? [];
    arr.push({ id: r.project_id, name: projName.get(r.project_id) ?? "", role: r.role });
    assignments.set(uid, arr);
  }

  const userInfo = new Map<string, { email: string; name: string }>();
  for (const u of authRes?.data?.users ?? []) userInfo.set(u.id, { email: u.email ?? "", name: resolveDisplayName(u) });

  const memberRows = memberList.map(m => ({
    user_id:    m.user_id,
    email:      userInfo.get(m.user_id)?.email ?? "",
    name:       userInfo.get(m.user_id)?.name ?? "",
    role:       m.role,          // null for project-scoped members
    scope_type: m.scope_type,
    joined_at:  m.created_at,
    projects:   assignments.get(m.user_id) ?? [],
  }));

  return NextResponse.json({
    members: memberRows,
    invites: (invites ?? []).map((i: { email: string; role: string | null; scope_type: string; created_at: string }) => ({
      email: i.email, role: i.role, scope_type: i.scope_type, created_at: i.created_at,
    })),
  });
}
